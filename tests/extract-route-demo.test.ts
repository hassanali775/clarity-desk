// tests/extract-route-demo.test.ts
//
// Integration tests for the /api/extract route's degraded-mode fallback:
//  - a quota error on a KNOWN sample serves the pre-verified static payload
//    and marks the response demoMode: true
//  - a quota error on an UNKNOWN document surfaces as a plain honest error
//  - a non-quota provider error never triggers the static fallback

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { ParsedDocument } from '@/lib/parsers/types';

const { extractMock } = vi.hoisted(() => ({ extractMock: vi.fn() }));

vi.mock('@/lib/extraction/extract', () => ({
  extractDocument: extractMock,
}));

import { POST } from '@/app/api/extract/route';

const OFFER_A_SOURCE_TEXT =
  'Acme Corp Offer Letter Candidate: Alice Chen Job Title: Senior Software Engineer Base Salary: 185,000 ' +
  'Signing Bonus: 30,000 Equity Value: 100,000 Vesting Schedule: 4 years with 1-year cliff Performance Bonus: 15% ' +
  'PTO Days: 20 Remote Policy: Hybrid Notice Period: 60 days Offer Expiration: 2026-09-30';

function sourceDocument(fileName: string, text: string): ParsedDocument {
  return { fileName, sourceFormat: 'pdf', pages: [{ pageNum: 1, text, runs: [] }] };
}

function quotaError(): Error {
  return Object.assign(new Error('RESOURCE_EXHAUSTED: requests per minute exceeded'), { status: 429 });
}

function post(body: unknown): Promise<Response> {
  return POST(new NextRequest('http://localhost/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  extractMock.mockReset();
});

describe('POST /api/extract degraded-mode fallback', () => {
  it('serves the static sample payload with demoMode=true on a quota error for a known sample', async () => {
    extractMock.mockRejectedValueOnce(quotaError());

    const res = await post({
      documents: [sourceDocument('offer_a.pdf', OFFER_A_SOURCE_TEXT)],
      schemaType: 'offer_letter',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.demoMode).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].source).toBe('static-fallback');
    expect(body.results[0].fileName).toBe('offer_a.pdf');
    expect(body.results[0].extractions.baseSalary.value).toBe(185000);
    expect(body.results[0].trusted).toBe(true);
  });

  it('passes through the provider override to extractDocument', async () => {
    extractMock.mockRejectedValueOnce(quotaError());

    await post({
      documents: [sourceDocument('offer_a.pdf', OFFER_A_SOURCE_TEXT)],
      schemaType: 'offer_letter',
      provider: 'anthropic',
    });

    expect(extractMock).toHaveBeenCalledWith(expect.anything(), 'offer_letter', 'anthropic');
  });

  it('never serves static data for an unknown document — reports an honest error instead', async () => {
    extractMock.mockRejectedValueOnce(quotaError());

    const res = await post({
      documents: [sourceDocument('real-contract.pdf', OFFER_A_SOURCE_TEXT)],
      schemaType: 'offer_letter',
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.demoMode).toBe(false);
    expect(body.results).toHaveLength(0);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].fileName).toBe('real-contract.pdf');
  });

  it('does NOT trigger the fallback on a non-quota provider error, even for a known sample', async () => {
    extractMock.mockRejectedValueOnce(new Error('Invalid argument: schema mismatch'));

    const res = await post({
      documents: [sourceDocument('offer_a.pdf', OFFER_A_SOURCE_TEXT)],
      schemaType: 'offer_letter',
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.demoMode).toBe(false);
    expect(body.results).toHaveLength(0);
    expect(body.errors[0].message).toContain('schema mismatch');
  });

  it('rejects an invalid provider override', async () => {
    const res = await post({
      documents: [sourceDocument('offer_a.pdf', OFFER_A_SOURCE_TEXT)],
      schemaType: 'offer_letter',
      provider: 'openai',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('provider');
  });

  it('serves live results (no demoMode) when extraction succeeds', async () => {
    extractMock.mockResolvedValueOnce({
      parsed: {
        candidateName: { value: 'Alice Chen', rawQuote: 'Alice Chen', pageNum: 1, confidence: 'high' },
      },
    });

    const res = await post({
      documents: [sourceDocument('offer_a.pdf', OFFER_A_SOURCE_TEXT)],
      schemaType: 'offer_letter',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.demoMode).toBe(false);
    expect(body.results[0].source).toBe('live');
  });
});
