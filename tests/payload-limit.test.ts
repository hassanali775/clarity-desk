// tests/payload-limit.test.ts
//
// Unit tests for the shared pre-flight size guard used by /api/extract and
// /api/parse (lib/payloadLimit.ts): the 50,000-character and 10-page ceilings
// that gate the live-extraction pipeline.
import { describe, expect, it } from 'vitest';
import { documentTotalChars, exceedsPayloadLimit, MAX_DOCUMENT_CHARS, MAX_DOCUMENT_PAGES } from '@/lib/payloadLimit';
import type { ParsedDocument } from '@/lib/parsers/types';

function doc(pages: Array<{ pageNum: number; text: string }>): ParsedDocument {
  return { fileName: 'doc.pdf', sourceFormat: 'pdf', pages: pages.map((p) => ({ ...p, runs: [] })) };
}

describe('payload size guard', () => {
  it('sums text across all pages', () => {
    expect(documentTotalChars(doc([{ pageNum: 1, text: 'ab' }, { pageNum: 2, text: 'cde' }]))).toBe(5);
    expect(documentTotalChars(doc([{ pageNum: 1, text: '' }]))).toBe(0);
  });

  it('rejects documents over the 50,000 character threshold and accepts those at it', () => {
    expect(exceedsPayloadLimit(doc([{ pageNum: 1, text: 'x'.repeat(MAX_DOCUMENT_CHARS + 1) }]))).toBe(true);
    expect(exceedsPayloadLimit(doc([{ pageNum: 1, text: 'x'.repeat(MAX_DOCUMENT_CHARS) }]))).toBe(false);
    // Characters add up across pages, not per page.
    expect(
      exceedsPayloadLimit(
        doc([
          { pageNum: 1, text: 'x'.repeat(MAX_DOCUMENT_CHARS / 2) },
          { pageNum: 2, text: 'x'.repeat(MAX_DOCUMENT_CHARS / 2 + 1) },
        ]),
      ),
    ).toBe(true);
  });

  it('rejects documents with more than 10 pages and accepts those at it', () => {
    const over = Array.from({ length: MAX_DOCUMENT_PAGES + 1 }, (_, i) => ({ pageNum: i + 1, text: 'a' }));
    const at = Array.from({ length: MAX_DOCUMENT_PAGES }, (_, i) => ({ pageNum: i + 1, text: 'a' }));
    expect(exceedsPayloadLimit(doc(over))).toBe(true);
    expect(exceedsPayloadLimit(doc(at))).toBe(false);
  });
});
