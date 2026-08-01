// tests/verifier.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isFieldEnvelope, verifyExtractions, type VerificationReason, type VerifyExtractionResult } from '@/lib/extraction/verifier';
import {
  OfferLetterExtractionSchema,
  VendorQuoteExtractionSchema,
  type OfferLetterExtraction,
  type VendorQuoteExtraction,
} from '@/lib/schemas/extraction';

type Confidence = 'high' | 'medium' | 'low';

interface FixtureCase {
  id: string;
  category: string;
  description: string;
  sourceText: string;
  extraction: OfferLetterExtraction;
  expect: {
    trusted: boolean;
    flaggedFieldPaths: string[];
    downgradedFieldPaths: string[];
    preservedConfidence?: Record<string, Confidence>;
    reasons?: Record<string, VerificationReason>;
  };
}

const fixturePath = new URL('./fixtures/adversarial-offer-letters.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { schemaType: string; cases: FixtureCase[] };

function getEnvelopeByPath<T>(extraction: T, path: string) {
  let node: unknown = extraction;
  const tokens = path.split('.').flatMap((seg) => seg.match(/^\w+|\[\d+\]/g) ?? []);
  for (const token of tokens) {
    if (token.startsWith('[')) {
      node = (node as unknown[])[Number(token.slice(1, -1))];
    } else {
      node = (node as Record<string, unknown>)[token];
    }
  }
  return isFieldEnvelope(node) ? node : undefined;
}

function reasonFor(result: VerifyExtractionResult<OfferLetterExtraction>, path: string) {
  return result.flaggedFields.find((field) => field.fieldPath === path)?.reason;
}

function caseById(id: string): FixtureCase {
  const found = fixture.cases.find((c) => c.id === id);
  if (!found) throw new Error(`Fixture case "${id}" not found`);
  return found;
}

describe('fixture integrity', () => {
  it('every fixture case is a valid OfferLetterExtraction', () => {
    for (const fixtureCase of fixture.cases) {
      const parsed = OfferLetterExtractionSchema.safeParse(fixtureCase.extraction);
      expect(parsed.success, `case "${fixtureCase.id}": ${parsed.success ? '' : parsed.error.message}`).toBe(true);
    }
  });
});

describe('adversarial offer-letter fixtures', () => {
  for (const fixtureCase of fixture.cases) {
    it(`${fixtureCase.id} — ${fixtureCase.description}`, () => {
      const extraction = OfferLetterExtractionSchema.parse(fixtureCase.extraction);
      const result = verifyExtractions(extraction, fixtureCase.sourceText);

      expect(result.trusted).toBe(fixtureCase.expect.trusted);
      expect(result.flaggedFields.map((field) => field.fieldPath).sort()).toEqual(
        [...fixtureCase.expect.flaggedFieldPaths].sort(),
      );

      for (const path of fixtureCase.expect.downgradedFieldPaths) {
        expect(getEnvelopeByPath(result.extractions, path)?.confidence, `"${path}" downgraded to low`).toBe('low');
      }

      if (fixtureCase.expect.preservedConfidence) {
        for (const [path, confidence] of Object.entries(fixtureCase.expect.preservedConfidence)) {
          expect(getEnvelopeByPath(result.extractions, path)?.confidence, `"${path}" keeps ${confidence}`).toBe(
            confidence,
          );
        }
      }

      if (fixtureCase.expect.reasons) {
        for (const [path, reason] of Object.entries(fixtureCase.expect.reasons)) {
          expect(reasonFor(result, path), `"${path}" flagged as ${reason}`).toBe(reason);
        }
      }
    });
  }
});

describe('regressions', () => {
  it('explicit regression: honest midpoint within the quoted range stays trusted', () => {
    const fixtureCase = caseById('salary-range-inferred-value-honest-quote');
    const result = verifyExtractions(
      OfferLetterExtractionSchema.parse(fixtureCase.extraction),
      fixtureCase.sourceText,
    );
    expect(result.trusted).toBe(true);
    expect(result.flaggedFields).toEqual([]);
    expect(getEnvelopeByPath(result.extractions, 'baseSalary')?.confidence).toBe('medium');
  });
});

describe('reason codes', () => {
  it('QUOTE_NOT_FOUND for a fabricated rawQuote', () => {
    const fixtureCase = caseById('salary-range-hallucinated-beyond-quoted');
    const result = verifyExtractions(
      OfferLetterExtractionSchema.parse(fixtureCase.extraction),
      fixtureCase.sourceText,
    );
    expect(reasonFor(result, 'baseSalary')).toBe('QUOTE_NOT_FOUND');
  });

  it('QUOTE_NOT_FOUND even when value is an honest null but the quote is fabricated', () => {
    const fixtureCase = caseById('null-value-fabricated-quote-flagged');
    const result = verifyExtractions(
      OfferLetterExtractionSchema.parse(fixtureCase.extraction),
      fixtureCase.sourceText,
    );
    expect(reasonFor(result, 'ptoDays')).toBe('QUOTE_NOT_FOUND');
  });

  it('MISSING_QUOTE for a value with no rawQuote', () => {
    const fixtureCase = caseById('hallucinated-fill-without-quote');
    const result = verifyExtractions(
      OfferLetterExtractionSchema.parse(fixtureCase.extraction),
      fixtureCase.sourceText,
    );
    expect(reasonFor(result, 'equityValue')).toBe('MISSING_QUOTE');
  });

  it('VALUE_NOT_DERIVABLE_FROM_QUOTE for a value above the quoted range', () => {
    const fixtureCase = caseById('salary-range-value-outside-range');
    const result = verifyExtractions(
      OfferLetterExtractionSchema.parse(fixtureCase.extraction),
      fixtureCase.sourceText,
    );
    expect(reasonFor(result, 'baseSalary')).toBe('VALUE_NOT_DERIVABLE_FROM_QUOTE');
    // The quote is genuine source text, so it must never also be QUOTE_NOT_FOUND.
    expect(result.flaggedFields.some((field) => field.reason === 'QUOTE_NOT_FOUND')).toBe(false);
    expect(getEnvelopeByPath(result.extractions, 'baseSalary')?.confidence).toBe('low');
    const flag = result.flaggedFields.find((field) => field.fieldPath === 'baseSalary');
    expect(flag?.message).toContain('210000');
    expect(flag?.message).toContain('185000');
    expect(flag?.message).toContain('195000');
  });

  it('VALUE_NOT_DERIVABLE_FROM_QUOTE for a single quoted number that does not match', () => {
    const extraction = OfferLetterExtractionSchema.parse({
      candidateName: { value: 'Morgan Alvarez', rawQuote: 'Morgan Alvarez', pageNum: 1, confidence: 'high' },
      jobTitle: { value: 'Senior Software Engineer', rawQuote: 'Senior Software Engineer', pageNum: 1, confidence: 'high' },
      baseSalary: { value: 185000, rawQuote: '$185,000 - $195,000 (DOE)', pageNum: 1, confidence: 'high' },
      signingBonus: { value: 25000, rawQuote: '$25,000', pageNum: 1, confidence: 'high' },
      equityValue: { value: '4,000 RSUs', rawQuote: '4,000 RSUs', pageNum: 1, confidence: 'high' },
      vestingSchedule: { value: '4 years with a 1-year cliff', rawQuote: 'vesting over 4 years with a 1-year cliff', pageNum: 1, confidence: 'high' },
      performanceBonus: { value: 'up to 15% of Annual Target Compensation', rawQuote: 'up to 15% of Annual Target Compensation', pageNum: 1, confidence: 'medium' },
      ptoDays: { value: 20, rawQuote: '25 days', pageNum: 1, confidence: 'high' },
      remotePolicy: { value: 'fully remote', rawQuote: 'fully remote', pageNum: 1, confidence: 'high' },
      noticePeriod: { value: '30 days', rawQuote: '30 days', pageNum: 1, confidence: 'high' },
      offerExpiration: { value: '2026-08-15', rawQuote: '2026-08-15', pageNum: 1, confidence: 'high' },
    });
    const result = verifyExtractions(extraction, caseById('salary-range-value-outside-range').sourceText);
    expect(reasonFor(result, 'ptoDays')).toBe('VALUE_NOT_DERIVABLE_FROM_QUOTE');
    expect(getEnvelopeByPath(result.extractions, 'ptoDays')?.confidence).toBe('low');
  });

  it('flag messages are surfaced with the offending quote for debugging', () => {
    const fixtureCase = caseById('salary-range-hallucinated-beyond-quoted');
    const result = verifyExtractions(
      OfferLetterExtractionSchema.parse(fixtureCase.extraction),
      fixtureCase.sourceText,
    );
    const flag = result.flaggedFields.find((field) => field.fieldPath === 'baseSalary');
    expect(flag?.rawQuote).toBe('$210,000');
    expect(flag?.message).toContain('$210,000');
  });
});

describe('vendor quote nested line items', () => {
  const sourceText = [
    'ACME Industrial Supplies',
    'Quote Q-2026-0042',
    'Steel beams 100 @ $12.50 = $1250.00',
    'Bolts M8 500 @ $0.75 = $375.00',
    'Subtotal $1,625.00  Tax $162.50  Grand Total $1,787.50',
    'Payment terms: Net 30. Delivery: 5 business days.',
  ].join('\n');

  function validQuote(): VendorQuoteExtraction {
    return VendorQuoteExtractionSchema.parse({
      vendorName: { value: 'ACME Industrial Supplies', rawQuote: 'ACME Industrial Supplies', pageNum: 1, confidence: 'high' },
      quoteReference: { value: 'Q-2026-0042', rawQuote: 'Q-2026-0042', pageNum: 1, confidence: 'high' },
      quoteExpiration: { value: null, rawQuote: null, pageNum: null, confidence: 'low' },
      lineItems: [
        {
          description: { value: 'Steel beams', rawQuote: 'Steel beams', pageNum: 1, confidence: 'high' },
          qty: { value: 100, rawQuote: '100', pageNum: 1, confidence: 'high' },
          unitPrice: { value: 12.5, rawQuote: '$12.50', pageNum: 1, confidence: 'high' },
          total: { value: 1250, rawQuote: '$1250.00', pageNum: 1, confidence: 'high' },
        },
        {
          description: { value: 'Bolts M8', rawQuote: 'Bolts M8', pageNum: 1, confidence: 'high' },
          qty: { value: 500, rawQuote: '500', pageNum: 1, confidence: 'high' },
          unitPrice: { value: 0.75, rawQuote: '$0.75', pageNum: 1, confidence: 'high' },
          total: { value: 375, rawQuote: '375.00', pageNum: 1, confidence: 'high' },
        },
      ],
      subtotal: { value: 1625, rawQuote: '$1,625.00', pageNum: 1, confidence: 'high' },
      taxAmount: { value: 162.5, rawQuote: '$162.50', pageNum: 1, confidence: 'high' },
      grandTotal: { value: 1787.5, rawQuote: '$1,787.50', pageNum: 1, confidence: 'high' },
      paymentTerms: { value: 'Net 30', rawQuote: 'Net 30', pageNum: 1, confidence: 'high' },
      deliverySla: { value: '5 business days', rawQuote: '5 business days', pageNum: 1, confidence: 'high' },
      warrantyPeriod: { value: null, rawQuote: null, pageNum: null, confidence: 'low' },
    });
  }

  it('a fully honest quote verifies as trusted', () => {
    const result = verifyExtractions(validQuote(), sourceText);
    expect(result.trusted).toBe(true);
    expect(result.flaggedFields).toEqual([]);
  });

  it('flags a hallucinated nested line item and downgrades it', () => {
    const quote = validQuote();
    quote.lineItems.push({
      description: { value: 'Pallet Jack', rawQuote: 'Pallet Jack', pageNum: 1, confidence: 'high' },
      qty: { value: 1, rawQuote: '1', pageNum: 1, confidence: 'high' },
      unitPrice: { value: 999, rawQuote: '$999.00', pageNum: 1, confidence: 'high' },
      total: { value: 999, rawQuote: '$999.00', pageNum: 1, confidence: 'high' },
    });

    const result = verifyExtractions(quote, sourceText);

    expect(result.trusted).toBe(false);
    // qty rawQuote "1" is NOT flagged: it is a genuine substring of the source ("Steel beams 100").
    expect(result.flaggedFields.map((field) => field.fieldPath).sort()).toEqual(
      ['lineItems[2].description', 'lineItems[2].total', 'lineItems[2].unitPrice'],
    );
    expect(getEnvelopeByPath(result.extractions, 'lineItems[2].total')?.confidence).toBe('low');
    expect(getEnvelopeByPath(result.extractions, 'lineItems[1].total')?.confidence).toBe('high');
  });
});

describe('verifier guarantees', () => {
  it('does not mutate the caller input object', () => {
    const fixtureCase = caseById('salary-range-hallucinated-beyond-quoted');
    const extraction = OfferLetterExtractionSchema.parse(fixtureCase.extraction);
    const before = structuredClone(extraction);

    verifyExtractions(extraction, fixtureCase.sourceText);

    expect(extraction).toEqual(before);
  });

  it('OCR punctuation drift is tolerated narrowly: number tokens yes, non-number whitespace no', () => {
    const extraction = OfferLetterExtractionSchema.parse({
      candidateName: { value: 'Morgan Alvarez', rawQuote: 'Morgan\n  Alvarez', pageNum: 1, confidence: 'high' },
      jobTitle: { value: 'Senior Software Engineer', rawQuote: 'Senior Software Engineer', pageNum: 1, confidence: 'high' },
      baseSalary: { value: 195000, rawQuote: '$185,000 - $195,000 (DOE)', pageNum: 1, confidence: 'high' },
      signingBonus: { value: 25000, rawQuote: '$25 , 000', pageNum: 1, confidence: 'high' },
      equityValue: { value: '4,000 RSUs', rawQuote: '4,000 RSUs', pageNum: 1, confidence: 'high' },
      vestingSchedule: { value: '4 years with a 1-year cliff', rawQuote: 'vesting over 4 years with a 1-year cliff', pageNum: 1, confidence: 'high' },
      performanceBonus: { value: 'up to 15% of Annual Target Compensation', rawQuote: 'up to 15% of Annual Target Compensation', pageNum: 1, confidence: 'medium' },
      ptoDays: { value: 25, rawQuote: '2 5 days', pageNum: 1, confidence: 'high' },
      remotePolicy: { value: 'fully remote', rawQuote: 'fully remote', pageNum: 1, confidence: 'high' },
      noticePeriod: { value: '30 days', rawQuote: '30 days', pageNum: 1, confidence: 'high' },
      offerExpiration: { value: '2026-08-15', rawQuote: '2026-08-15', pageNum: 1, confidence: 'high' },
    });
    const source = [
      '[[PAGE 1]]',
      'AEGIS ROBOTICS',
      'Offer of Employment',
      '',
      'Dear Morgan Alvarez,',
      '',
      'We are pleased to offer you the position of Senior Software Engineer at AEGIS Robotics.',
      '',
      '[[PAGE 2]]',
      '',
      'Annual Target Compensation: $185,000 - $195,000 (DOE)',
      'Signing Bonus: $25,000',
      'Equity: 4,000 RSUs vesting over 4 years with a 1-year cliff',
      'Performance Bonus: up to 15% of Annual Target Compensation',
      'Paid Time Off: 25 days',
      'Remote Policy: fully remote',
      'Notice Period: 30 days',
      'This offer expires 2026-08-15.',
    ].join('\n');

    const result = verifyExtractions(extraction, source);

    expect(result.trusted).toBe(false);
    // Number-token OCR punctuation drift IS tolerated: "$25 , 000" resolves to "$25,000".
    expect(result.flaggedFields.map((field) => field.fieldPath)).not.toContain('signingBonus');
    // Digit-space-digit WITHOUT a separator is NOT merged: "2 5" is not "25".
    expect(reasonFor(result, 'ptoDays')).toBe('QUOTE_NOT_FOUND');
    // Non-number whitespace (line break inside a name) is NOT collapsed.
    expect(reasonFor(result, 'candidateName')).toBe('QUOTE_NOT_FOUND');
    // A clean range quote still verifies (substring + derivability both pass).
    expect(reasonFor(result, 'baseSalary')).toBeUndefined();
  });
});
