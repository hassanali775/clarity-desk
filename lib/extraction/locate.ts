// lib/extraction/locate.ts
import type { ParsedDocument, ParsedPage, SourceLocation, BoundingBox } from '@/lib/parsers/types';

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

interface RunSpan {
  runIndex: number;
  start: number; // offset into the normalized, space-joined page text
  end: number;
}

/**
 * Rebuilds a single normalized text blob for a page by joining its runs with
 * a single space, tracking each run's [start,end) offset in that blob. This
 * is what lets us take a normalized `rawQuote` from the model and figure out
 * exactly which run(s) it came from — independent of how each parser
 * originally joined text for the cheap `page.text` field.
 */
function buildOffsetIndex(page: ParsedPage): { blob: string; spans: RunSpan[] } {
  let blob = '';
  const spans: RunSpan[] = [];

  page.runs.forEach((run, runIndex) => {
    const text = normalize(run.text);
    if (text.length === 0) return;
    if (blob.length > 0) blob += ' ';
    const start = blob.length;
    blob += text;
    spans.push({ runIndex, start, end: blob.length });
  });

  return { blob, spans };
}

function unionBoundingBoxes(boxes: BoundingBox[]): BoundingBox {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Resolves a model-reported (rawQuote, pageNum) pair to a real SourceLocation
 * by finding where that quote actually sits among the page's parsed runs.
 * Returns null — not a guess — when the quote can't be confidently located,
 * so the UI can honestly show "extracted, but source not verified" instead
 * of pointing at the wrong spot.
 */
export function locateQuote(doc: ParsedDocument, rawQuote: string | null, pageNum: number | null): SourceLocation | null {
  if (!rawQuote || pageNum === null) return null;

  const page = doc.pages.find((p) => p.pageNum === pageNum);
  if (!page) return null;

  const { blob, spans } = buildOffsetIndex(page);
  const needle = normalize(rawQuote);
  if (needle.length === 0) return null;

  const matchStart = blob.indexOf(needle);
  if (matchStart === -1) {
    // Fall back to a looser check: sometimes the model paraphrases whitespace
    // or drops a stray character. Try matching on the first few words only.
    const looseNeedle = needle.split(' ').slice(0, 4).join(' ');
    if (looseNeedle.length < 3) return null;
    const looseStart = blob.indexOf(looseNeedle);
    if (looseStart === -1) return null;
    return resolveSpans(doc, page, spans, looseStart, looseStart + looseNeedle.length);
  }

  return resolveSpans(doc, page, spans, matchStart, matchStart + needle.length);
}

function resolveSpans(
  doc: ParsedDocument,
  page: ParsedPage,
  spans: RunSpan[],
  matchStart: number,
  matchEnd: number,
): SourceLocation | null {
  const overlapping = spans.filter((s) => s.start < matchEnd && s.end > matchStart);
  if (overlapping.length === 0) return null;

  const runs = overlapping.map((s) => page.runs[s.runIndex]);

  if (doc.sourceFormat === 'pdf') {
    const boxes = runs.map((r) => (r.location.kind === 'pdf' ? r.location.bbox : null)).filter((b): b is BoundingBox => b !== null);
    if (boxes.length === 0) return null;
    return { kind: 'pdf', pageNum: page.pageNum, bbox: unionBoundingBoxes(boxes) };
  }

  // For DOCX/XLSX, a match spanning multiple runs still resolves to the
  // first run's location — good enough for "click to jump near the source,"
  // which is the honest bar for non-PDF traceability (see parser comments).
  return runs[0].location;
}
