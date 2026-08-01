// app/api/extract/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { extractDocument } from '@/lib/extraction/extract';
import { buildPageMarkedText } from '@/lib/extraction/pageText';
import { locateQuote } from '@/lib/extraction/locate';
import { verifyExtractions, type FlaggedField } from '@/lib/extraction/verifier';
import { checkVendorQuoteMath } from '@/lib/validation/mathCheck';
import { alignLineItems } from '@/lib/alignment/lineItems';
import type { ParsedDocument } from '@/lib/parsers/types';
import type { DocumentSchemaType } from '@/lib/schemas/extraction';
import type { OfferLetterExtraction, VendorQuoteExtraction } from '@/lib/schemas/extraction';

export const runtime = 'nodejs';

interface RequestBody {
  documents: ParsedDocument[];
  schemaType: DocumentSchemaType;
}

/**
 * Walks every field-envelope in an extraction result and resolves its
 * rawQuote/pageNum to a real SourceLocation. Returns a flat map keyed by
 * a dotted field path, e.g. "baseSalary" or "lineItems.2.unitPrice" —
 * simple to look up from the UI, and keeps this function agnostic to the
 * exact shape of either schema.
 */
function resolveLocations(
  doc: ParsedDocument,
  extraction: OfferLetterExtraction | VendorQuoteExtraction,
): Record<string, ReturnType<typeof locateQuote>> {
  const locations: Record<string, ReturnType<typeof locateQuote>> = {};

  function walk(node: unknown, path: string) {
    if (node === null || typeof node !== 'object') return;

    // A field envelope has this exact shape — check for it before recursing.
    if ('rawQuote' in node && 'pageNum' in node && 'confidence' in node) {
      const envelope = node as { rawQuote: string | null; pageNum: number | null };
      locations[path] = locateQuote(doc, envelope.rawQuote, envelope.pageNum);
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}.${i}`));
      return;
    }

    Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
      walk(value, path ? `${path}.${key}` : key);
    });
  }

  walk(extraction, '');
  return locations;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON body with { documents, schemaType }.' }, { status: 400 });
  }

  if (!Array.isArray(body.documents) || body.documents.length === 0) {
    return NextResponse.json({ error: '"documents" must be a non-empty array.' }, { status: 400 });
  }
  if (body.schemaType !== 'offer_letter' && body.schemaType !== 'vendor_quote') {
    return NextResponse.json({ error: '"schemaType" must be "offer_letter" or "vendor_quote".' }, { status: 400 });
  }

  const results: Array<{
    fileName: string;
    trusted: boolean;
    flaggedFields: FlaggedField[];
    extractions: OfferLetterExtraction | VendorQuoteExtraction;
    locations: Record<string, ReturnType<typeof locateQuote>>;
    mathDiscrepancies?: ReturnType<typeof checkVendorQuoteMath>;
  }> = [];
  const errors: Array<{ fileName: string; message: string }> = [];

  // Sequential, not Promise.all: keeps this predictable and easy to reason
  // about under your API budget constraints — you can see exactly how many
  // calls are in flight, and one document's failure is isolated cleanly
  // without needing Promise.allSettled bookkeeping.
  for (const doc of body.documents) {
    try {
      const { parsed } = await extractDocument(doc, body.schemaType);
      // Rebuild the exact page-marked text the extractor quoted from, and
      // re-check every rawQuote against it server-side — no client input
      // is trusted for verification.
      const sourceText = buildPageMarkedText(doc);
      const { trusted, flaggedFields, extractions } = verifyExtractions(parsed, sourceText);
      const locations = resolveLocations(doc, extractions);
      const mathDiscrepancies =
        body.schemaType === 'vendor_quote' ? checkVendorQuoteMath(extractions as VendorQuoteExtraction) : undefined;

      results.push({ fileName: doc.fileName, trusted, flaggedFields, extractions, locations, mathDiscrepancies });
    } catch (err) {
      errors.push({ fileName: doc.fileName, message: err instanceof Error ? err.message : String(err) });
    }
  }

  let alignment = null;
  if (body.schemaType === 'vendor_quote' && results.length >= 2) {
    try {
      alignment = await alignLineItems(
        results.map((r) => ({ fileName: r.fileName, lineItems: (r.extractions as VendorQuoteExtraction).lineItems })),
      );
    } catch (err) {
      // Alignment failing should never take down the whole response — the
      // per-document extraction is still useful on its own without grouping.
      errors.push({ fileName: '(alignment)', message: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json(
    { results, errors, alignment },
    { status: results.length > 0 ? 200 : 422 },
  );
}
