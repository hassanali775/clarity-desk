// app/api/extract/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { extractDocument, type ExtractionProviderName } from '@/lib/extraction/extract';
import { buildPageMarkedText } from '@/lib/extraction/pageText';
import { locateQuote } from '@/lib/extraction/locate';
import { verifyExtractions } from '@/lib/extraction/verifier';
import { isProviderQuotaError } from '@/lib/extraction/providers/errors';
import { isKnownSampleDocument, staticExtractionForSample } from '@/lib/extraction/staticFallback';
import { checkVendorQuoteMath } from '@/lib/validation/mathCheck';
import { alignLineItems } from '@/lib/alignment/lineItems';
import { exceedsPayloadLimit, PAYLOAD_LIMIT_ERROR_MESSAGE } from '@/lib/payloadLimit';
import { extractRateLimiter } from '@/lib/ratelimit';
import type { ParsedDocument } from '@/lib/parsers/types';
import type { DocumentSchemaType } from '@/lib/schemas/extraction';
import type { OfferLetterExtraction, VendorQuoteExtraction } from '@/lib/schemas/extraction';

export const runtime = 'nodejs';

interface RequestBody {
  documents: ParsedDocument[];
  schemaType: DocumentSchemaType;
  /** Optional provider override; falls back to EXTRACTION_PROVIDER (default gemini). */
  provider?: ExtractionProviderName;
}

/** Where a result's data came from. `static-fallback` implies demoMode. */
export type ExtractionSource = 'live' | 'static-fallback';

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

/**
 * Runs one extraction (live or static) through the shared verification
 * pipeline: quote re-check, source location resolution, math validation.
 * Both live and static-fallback results pass through here, so a static
 * payload gets exactly the same scrutiny as a live one.
 */
function buildResult(
  doc: ParsedDocument,
  parsed: OfferLetterExtraction | VendorQuoteExtraction,
  schemaType: DocumentSchemaType,
  source: ExtractionSource,
) {
  const sourceText = buildPageMarkedText(doc);
  const { trusted, flaggedFields, extractions } = verifyExtractions(parsed, sourceText);
  const locations = resolveLocations(doc, extractions);
  const mathDiscrepancies =
    schemaType === 'vendor_quote' ? checkVendorQuoteMath(extractions as VendorQuoteExtraction) : undefined;

  return { fileName: doc.fileName, trusted, flaggedFields, extractions, locations, mathDiscrepancies, source };
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
  if (body.provider !== undefined && body.provider !== 'gemini' && body.provider !== 'anthropic') {
    return NextResponse.json({ error: '"provider" must be "gemini" or "anthropic".' }, { status: 400 });
  }

  // Per-IP sliding-window throttle (in-memory). Cheap check that runs before
  // any LLM call so automated scripts are shed early. Best-effort, not a
  // distributed quota — see lib/ratelimit.ts.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  if (!extractRateLimiter.allow(ip)) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, {
      status: 429,
      headers: { 'Retry-After': '60' },
    });
  }

  // Pre-flight size guard: reject oversized documents before any model call.
  // The 4.5MB serverless body ceiling can be hit far below that by an
  // image-heavy PDF; failing fast keeps the failure honest and cheap.
  const oversized = body.documents.find((doc) => exceedsPayloadLimit(doc));
  if (oversized) {
    return NextResponse.json({ error: PAYLOAD_LIMIT_ERROR_MESSAGE }, { status: 400 });
  }

  const results: Array<ReturnType<typeof buildResult>> = [];
  const errors: Array<{ fileName: string; message: string }> = [];

  // Sequential, not Promise.all: keeps this predictable and easy to reason
  // about under your API budget constraints — you can see exactly how many
  // calls are in flight, and one document's failure is isolated cleanly
  // without needing Promise.allSettled bookkeeping.
  for (const doc of body.documents) {
    try {
      const { parsed } = await extractDocument(doc, body.schemaType, body.provider);
      results.push(buildResult(doc, parsed, body.schemaType, 'live'));
    } catch (err) {
      // Degraded-mode fallback: ONLY a quota/rate-limit/billing failure on a
      // KNOWN sample document may serve the pre-verified static payload. The
      // response is marked demoMode so the UI renders a visible banner. Any
      // other failure (or any non-sample document) stays a plain, honest error.
      if (isProviderQuotaError(err) && isKnownSampleDocument(doc.fileName)) {
        const staticParsed = staticExtractionForSample(doc.fileName, body.schemaType);
        if (staticParsed) {
          results.push(buildResult(doc, staticParsed, body.schemaType, 'static-fallback'));
          continue;
        }
      }
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

  const demoMode = results.some((r) => r.source === 'static-fallback');

  return NextResponse.json(
    { results, errors, alignment, demoMode },
    { status: results.length > 0 ? 200 : 422 },
  );
}
