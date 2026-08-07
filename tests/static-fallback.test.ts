// tests/static-fallback.test.ts
//
// Honesty tests for the degraded-mode fallback:
//  - the quota classifier only matches real quota/rate-limit/billing failures
//  - static payloads exist ONLY for known sample documents
//  - every static payload re-verifies cleanly against the exact source text of
//    its sample PDF (the same gate the API route applies at request time)

import { describe, it, expect } from 'vitest';
import { isProviderQuotaError } from '@/lib/extraction/providers/errors';
import { isKnownSampleDocument, staticExtractionForSample } from '@/lib/extraction/staticFallback';
import { verifyExtractions } from '@/lib/extraction/verifier';
import { buildPageMarkedText } from '@/lib/extraction/pageText';
import type { ParsedDocument } from '@/lib/parsers/types';

// Exact buildPageMarkedText output captured from the real parser for each
// bundled sample PDF (see scripts/test-gemini.ts for the live harness).
const SAMPLE_SOURCE_TEXT: Record<string, string> = {
  'offer_a.pdf':
    'Acme Corp Offer Letter Candidate: Alice Chen Job Title: Senior Software Engineer Base Salary: 185,000 ' +
    'Signing Bonus: 30,000 Equity Value: 100,000 Vesting Schedule: 4 years with 1-year cliff Performance Bonus: 15% ' +
    'PTO Days: 20 Remote Policy: Hybrid Notice Period: 60 days Offer Expiration: 2026-09-30',
  'offer_b.pdf':
    'Beta Labs Offer Letter Candidate: Bob Nguyen Job Title: Senior Software Engineer Base Salary: 178,000 ' +
    'Signing Bonus: 25,000 Equity Value: 80,000 Vesting Schedule: 4 years with 1-year cliff Performance Bonus: 12% ' +
    'PTO Days: 18 Remote Policy: Fully Remote Notice Period: 30 days Offer Expiration: 2026-10-15',
  'offer_missing_pto.pdf':
    'Acme Corp Offer Letter Candidate: Alice Chen Job Title: Senior Software Engineer Base Salary: 185,000 ' +
    'Signing Bonus: 30,000 Equity Value: 100,000 Vesting Schedule: 4 years with 1-year cliff Performance Bonus: 15% ' +
    'Remote Policy: Hybrid Notice Period: 60 days Offer Expiration: 2026-09-30',
};

function sourceDocument(fileName: string): ParsedDocument {
  return {
    fileName,
    sourceFormat: 'pdf',
    pages: [{ pageNum: 1, text: SAMPLE_SOURCE_TEXT[fileName], runs: [] }],
  };
}

describe('isProviderQuotaError classifier', () => {
  it('matches HTTP status 429 (too many requests)', () => {
    const err = Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 });
    expect(isProviderQuotaError(err)).toBe(true);
  });

  it('matches HTTP status 402 (billing/payment required)', () => {
    const err = Object.assign(new Error('billing error'), { status: 402 });
    expect(isProviderQuotaError(err)).toBe(true);
  });

  it('matches HTTP status 503 (service unavailable / capacity)', () => {
    const err = Object.assign(new Error('backend unavailable'), { status: 503 });
    expect(isProviderQuotaError(err)).toBe(true);
  });

  it('matches quota/rate-limit phrasing in the message regardless of status', () => {
    expect(isProviderQuotaError(new Error('quota exceeded for requests per minute'))).toBe(true);
    expect(isProviderQuotaError(new Error('API rate limit reached'))).toBe(true);
    expect(isProviderQuotaError(new Error('Insufficient quota to execute this request'))).toBe(true);
    expect(isProviderQuotaError(new Error('RESOURCE_EXHAUSTED: The model is overloaded'))).toBe(true);
  });

  it('matches 503 / UNAVAILABLE / overloaded capacity spikes regardless of status', () => {
    expect(isProviderQuotaError(new Error('503 Service Unavailable'))).toBe(true);
    expect(isProviderQuotaError(new Error('UNAVAILABLE: server overloaded'))).toBe(true);
    expect(isProviderQuotaError(new Error('The model is overloaded'))).toBe(true);
    expect(isProviderQuotaError(Object.assign(new Error('overloaded'), { statusCode: 503 }))).toBe(true);
  });

  it('does NOT match unrelated provider errors', () => {
    expect(isProviderQuotaError(new Error('Invalid argument: bad schema'))).toBe(false);
    expect(isProviderQuotaError(new Error('Model not found'))).toBe(false);
    expect(isProviderQuotaError(Object.assign(new Error('server error'), { status: 500 }))).toBe(false);
    expect(isProviderQuotaError(Object.assign(new Error('unauthorized'), { status: 401 }))).toBe(false);
  });

  it('does not throw on non-Error values', () => {
    expect(isProviderQuotaError('some string')).toBe(false);
    expect(isProviderQuotaError(undefined)).toBe(false);
  });
});

describe('static fallback sample gating', () => {
  it('treats only the bundled samples as known documents', () => {
    for (const name of ['offer_a.pdf', 'offer_b.pdf', 'offer_missing_pto.pdf']) {
      expect(isKnownSampleDocument(name)).toBe(true);
    }
    expect(isKnownSampleDocument('contract.pdf')).toBe(false);
    expect(isKnownSampleDocument('../../etc/passwd')).toBe(false);
  });

  it('returns a static payload only for known offer-letter samples', () => {
    for (const name of ['offer_a.pdf', 'offer_b.pdf', 'offer_missing_pto.pdf']) {
      expect(staticExtractionForSample(name, 'offer_letter')).not.toBeNull();
    }
    expect(staticExtractionForSample('contract.pdf', 'offer_letter')).toBeNull();
  });

  it('never serves static data for the vendor_quote schema (samples are offer letters)', () => {
    expect(staticExtractionForSample('offer_a.pdf', 'vendor_quote')).toBeNull();
  });

  it('offer_missing_pto.pdf statically reports ptoDays as an honest null', () => {
    const ext = staticExtractionForSample('offer_missing_pto.pdf', 'offer_letter')!;
    expect(ext.ptoDays.value).toBeNull();
    expect(ext.ptoDays.rawQuote).toBeNull();
  });
});

describe('static payload honesty (request-time re-verification)', () => {
  for (const name of ['offer_a.pdf', 'offer_b.pdf', 'offer_missing_pto.pdf']) {
    it(`${name}: static payload verifies trusted with zero flagged fields against its real source text`, () => {
      const ext = staticExtractionForSample(name, 'offer_letter')!;
      const { trusted, flaggedFields } = verifyExtractions(ext, buildPageMarkedText(sourceDocument(name)));
      expect(flaggedFields).toEqual([]);
      expect(trusted).toBe(true);
    });
  }
});
