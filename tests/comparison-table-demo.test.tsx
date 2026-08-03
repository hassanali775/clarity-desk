// tests/comparison-table-demo.test.tsx
//
// The ComparisonTable must make degraded-mode (demoMode) results impossible to
// mistake for live data: a prominent banner + badge when demoMode is on, and
// nothing when it is off.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ComparisonTable } from '@/components/ComparisonTable';
import type { SourceLocation } from '@/lib/parsers/types';
import type { OfferLetterExtraction } from '@/lib/schemas/extraction';
import type { MathDiscrepancy } from '@/lib/validation/mathCheck';
import type { FlaggedField } from '@/lib/extraction/verifier';

interface DocResult {
  fileName: string;
  trusted: boolean;
  flaggedFields: FlaggedField[];
  extractions: OfferLetterExtraction;
  locations: Record<string, SourceLocation | null>;
  mathDiscrepancies: MathDiscrepancy[];
  source?: 'live' | 'static-fallback';
}

function makeExtraction(): OfferLetterExtraction {
  return {
    candidateName: { value: 'Alice Chen', rawQuote: 'Alice Chen', pageNum: 1, confidence: 'high' },
    baseSalary: { value: 185000, rawQuote: '185,000', pageNum: 1, confidence: 'high' },
  } as unknown as OfferLetterExtraction;
}

function renderTable(demoMode: boolean): string {
  const results: DocResult[] = [
    {
      fileName: 'offer_a.pdf',
      trusted: true,
      flaggedFields: [],
      extractions: makeExtraction(),
      locations: {},
      mathDiscrepancies: [],
      source: demoMode ? 'static-fallback' : 'live',
    },
  ];
  return renderToStaticMarkup(
    <ComparisonTable
      schemaType="offer_letter"
      results={results}
      alignment={null}
      files={{}}
      demoMode={demoMode}
    />,
  );
}

describe('ComparisonTable demoMode indicator', () => {
  it('renders a prominent "not live data" banner and badge when demoMode is true', () => {
    const html = renderTable(true);

    expect(html).toContain('Static Example');
    expect(html).toContain('rate-limited');
    expect(html).toContain('this is not live data from your upload');
  });

  it('renders no demoMode banner or badge when demoMode is false', () => {
    const html = renderTable(false);

    expect(html).not.toContain('Static Example');
    expect(html).not.toContain('rate-limited');
    expect(html).not.toContain('this is not live data');
  });
});
