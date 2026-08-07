// lib/payloadLimit.ts
//
// Pre-flight size guard for the live-extraction pipeline. Large documents are
// rejected up front (before any LLM call) so a single oversized upload can
// neither blow the Vercel serverless body ceiling nor burn expensive model
// tokens. Applies to /api/extract and /api/parse.
import type { ParsedDocument } from '@/lib/parsers/types';

/** Total characters across all pages a document may carry before rejection. */
export const MAX_DOCUMENT_CHARS = 50_000;

/** Maximum number of pages/units a document may carry before rejection. */
export const MAX_DOCUMENT_PAGES = 10;

export const PAYLOAD_LIMIT_ERROR_MESSAGE =
  'Document exceeds Vercel serverless size threshold for live extraction.';

export function documentTotalChars(doc: ParsedDocument): number {
  return doc.pages.reduce((sum, page) => sum + page.text.length, 0);
}

export function exceedsPayloadLimit(doc: ParsedDocument): boolean {
  return doc.pages.length > MAX_DOCUMENT_PAGES || documentTotalChars(doc) > MAX_DOCUMENT_CHARS;
}
