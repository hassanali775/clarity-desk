// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ComparisonTable } from '@/components/ComparisonTable';
import type { SourceLocation } from '@/lib/parsers/types';
import type { OfferLetterExtraction, VendorQuoteExtraction } from '@/lib/schemas/extraction';
import type { MathDiscrepancy } from '@/lib/validation/mathCheck';
import type { FlaggedField } from '@/lib/extraction/verifier';

vi.mock('next/dynamic', () => ({
  default: () => function MockDynamic() {
    return null;
  },
}));

interface DocResult {
  fileName: string;
  trusted: boolean;
  flaggedFields: FlaggedField[];
  extractions: OfferLetterExtraction | VendorQuoteExtraction;
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

const FLAGGED_LINE_TOTAL: FlaggedField = {
  fieldPath: 'lineItems[0].total',
  reason: 'VALUE_NOT_DERIVABLE_FROM_QUOTE',
  message: 'Line item total 21 does not match the quoted unit price × quantity (2 × 10 = 20).',
  rawQuote: '2 × $10',
};

function makeExtraction(): OfferLetterExtraction {
  return {
    candidateName: { value: 'Alex Morgan', rawQuote: 'Alex Morgan', pageNum: 1, confidence: 'high' },
    baseSalary: { value: 210000, rawQuote: '$185,000 - $195,000', pageNum: 1, confidence: 'low' },
  } as unknown as OfferLetterExtraction;
}

function makeVendorExtraction(): VendorQuoteExtraction {
  return {
    vendorName: { value: 'Acme Corp', rawQuote: 'Acme Corp', pageNum: 1, confidence: 'high' },
    lineItems: [
      {
        description: { value: 'Widget', rawQuote: 'Widget', pageNum: 1, confidence: 'high' },
        qty: { value: 2, rawQuote: '2', pageNum: 1, confidence: 'high' },
        unitPrice: { value: 10, rawQuote: '$10', pageNum: 1, confidence: 'high' },
        total: { value: 21, rawQuote: '$21', pageNum: 1, confidence: 'high' },
      },
    ],
  } as unknown as VendorQuoteExtraction;
}

interface Alignment {
  groups: { canonicalDescription: string; members: { quoteIndex: number; lineItemIndex: number }[] }[];
  unmatched: { quoteIndex: number; lineItemIndex: number }[];
  trusted: boolean;
}

function setup(results: DocResult[], alignment: Alignment | null, schemaType: 'offer_letter' | 'vendor_quote') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ComparisonTable schemaType={schemaType} results={results} alignment={alignment} files={{}} />,
    );
  });
  return { container, root };
}

describe('ComparisonTable flag disclosure (click/tap)', () => {
  beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('collapses by default and reveals the flag reason + message on click, hiding on second click', () => {
    const { container, root } = setup(
      [
        {
          fileName: 'offer_a.pdf',
          trusted: false,
          flaggedFields: [FLAGGED_BASE_SALARY],
          extractions: makeExtraction(),
          locations: {},
          mathDiscrepancies: [],
        },
      ],
      null,
      'offer_letter',
    );

    const badge = container.querySelector('[data-field="baseSalary"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('Needs Review');

    expect(container.textContent).not.toContain('VALUE_NOT_DERIVABLE_FROM_QUOTE');
    expect(badge?.getAttribute('aria-expanded')).toBe('false');

    act(() => {
      (badge as HTMLButtonElement).click();
    });

    expect(badge?.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('VALUE_NOT_DERIVABLE_FROM_QUOTE');
    expect(container.textContent).toContain('value 210000 is not derivable from the quoted range');
    expect(container.textContent).toContain('$185,000 - $195,000');

    const panelId = badge?.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(container.querySelector(`#${panelId}`)).not.toBeNull();

    act(() => {
      (badge as HTMLButtonElement).click();
    });

    expect(badge?.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('VALUE_NOT_DERIVABLE_FROM_QUOTE');

    act(() => root.unmount());
    container.remove();
  });

  it('toggles a line-item flag badge via its bracket path', () => {
    const alignment: Alignment = {
      groups: [{ canonicalDescription: 'Widget', members: [{ quoteIndex: 0, lineItemIndex: 0 }] }],
      unmatched: [],
      trusted: true,
    };
    const { container, root } = setup(
      [
        {
          fileName: 'vendor_a.pdf',
          trusted: false,
          flaggedFields: [FLAGGED_LINE_TOTAL],
          extractions: makeVendorExtraction(),
          locations: {},
          mathDiscrepancies: [],
        },
      ],
      alignment,
      'vendor_quote',
    );

    const badge = container.querySelector('[data-field="lineItems[0].total"]');
    expect(badge).not.toBeNull();

    expect(container.textContent).not.toContain('does not match the quoted unit price');
    act(() => {
      (badge as HTMLButtonElement).click();
    });
    expect(container.textContent).toContain('does not match the quoted unit price');

    act(() => root.unmount());
    container.remove();
  });
});
