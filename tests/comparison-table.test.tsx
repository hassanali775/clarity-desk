// tests/comparison-table.test.tsx
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
}

const FLAGGED_BASE_SALARY: FlaggedField = {
  fieldPath: 'baseSalary',
  reason: 'VALUE_NOT_DERIVABLE_FROM_QUOTE',
  message:
    'Field "baseSalary" value 210000 is not derivable from the quoted range [185000, 195000] ("$185,000 - $195,000").',
  rawQuote: '$185,000 - $195,000',
};

function makeExtraction(): OfferLetterExtraction {
  return {
    candidateName: { value: 'Alex Morgan', rawQuote: 'Alex Morgan', pageNum: 1, confidence: 'high' },
    baseSalary: { value: 210000, rawQuote: '$185,000 - $195,000', pageNum: 1, confidence: 'low' },
  } as unknown as OfferLetterExtraction;
}

function renderTable(results: DocResult[]): string {
  return renderToStaticMarkup(
    <ComparisonTable schemaType="offer_letter" results={results} alignment={null} files={{}} />,
  );
}

describe('ComparisonTable verification indicators', () => {
  it('renders a warning indicator for a field with a matching flaggedFields entry and keeps the value visible', () => {
    const html = renderTable([
      {
        fileName: 'offer_a.pdf',
        trusted: false,
        flaggedFields: [FLAGGED_BASE_SALARY],
        extractions: makeExtraction(),
        locations: {},
        mathDiscrepancies: [],
      },
    ]);

    expect(html).toContain('data-field="baseSalary"');
    expect(html).toContain('VALUE_NOT_DERIVABLE_FROM_QUOTE');
    expect(html).toContain('value 210000 is not derivable from the quoted range');
    expect(html).toContain('210,000');
  });

  it('does not render an indicator for a field with no matching flaggedFields entry', () => {
    const html = renderTable([
      {
        fileName: 'offer_a.pdf',
        trusted: false,
        flaggedFields: [FLAGGED_BASE_SALARY],
        extractions: makeExtraction(),
        locations: {},
        mathDiscrepancies: [],
      },
    ]);

    expect(html).not.toContain('data-field="candidateName"');
  });

  it('shows a document-level Needs Review badge when a result is untrusted', () => {
    const html = renderTable([
      {
        fileName: 'offer_a.pdf',
        trusted: false,
        flaggedFields: [FLAGGED_BASE_SALARY],
        extractions: makeExtraction(),
        locations: {},
        mathDiscrepancies: [],
      },
    ]);

    expect(html).toContain('Needs Review');
    expect(html.match(/Needs Review/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('renders no indicators for a fully trusted result', () => {
    const html = renderTable([
      {
        fileName: 'offer_b.pdf',
        trusted: true,
        flaggedFields: [],
        extractions: makeExtraction(),
        locations: {},
        mathDiscrepancies: [],
      },
    ]);

    expect(html).not.toContain('data-field=');
    expect(html).not.toContain('Needs Review');
    expect(html).not.toContain('VALUE_NOT_DERIVABLE_FROM_QUOTE');
  });
});
