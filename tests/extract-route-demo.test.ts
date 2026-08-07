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
import { EXTRACT_RATE_LIMIT, extractRateLimiter, InMemoryRateLimiter } from '@/lib/ratelimit';
import { MAX_DOCUMENT_CHARS, MAX_DOCUMENT_PAGES } from '@/lib/payloadLimit';

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

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(new NextRequest('http://localhost/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  extractMock.mockReset();
  extractRateLimiter.reset();
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

describe('POST /api/extract payload size guard', () => {
  it('rejects a document over the 50,000 character threshold before any LLM call', async () => {
    const res = await post({
      documents: [sourceDocument('huge.pdf', 'x'.repeat(MAX_DOCUMENT_CHARS + 1))],
      schemaType: 'offer_letter',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Vercel serverless size threshold');
    expect(extractMock).not.toHaveBeenCalled();
  });

  it('rejects a document with more than 10 pages before any LLM call', async () => {
    const pages = Array.from({ length: MAX_DOCUMENT_PAGES + 1 }, (_, i) => ({
      pageNum: i + 1,
      text: 'page',
      runs: [],
    }));

    const res = await post({
      documents: [{ fileName: 'long.pdf', sourceFormat: 'pdf', pages }],
      schemaType: 'offer_letter',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Vercel serverless size threshold');
    expect(extractMock).not.toHaveBeenCalled();
  });

  it('accepts a document exactly at the limits', async () => {
    const pages = Array.from({ length: MAX_DOCUMENT_PAGES }, (_, i) => ({
      pageNum: i + 1,
      text: 'a'.repeat(Math.ceil(MAX_DOCUMENT_CHARS / MAX_DOCUMENT_PAGES)),
      runs: [],
    }));
    extractMock.mockResolvedValueOnce({
      parsed: { candidateName: { value: 'Alice Chen', rawQuote: 'Alice Chen', pageNum: 1, confidence: 'high' } },
    });

    const res = await post({
      documents: [{ fileName: 'at-limit.pdf', sourceFormat: 'pdf', pages }],
      schemaType: 'offer_letter',
    });

    expect(res.status).toBe(200);
  });
});

describe('POST /api/extract rate limiting', () => {
  it('throttles an IP once the sliding window is exhausted and recovers a different key', () => {
    const limiter = new InMemoryRateLimiter(2, 1_000);

    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(true);
    expect(limiter.allow('1.2.3.4')).toBe(false);
    expect(limiter.allow('5.6.7.8')).toBe(true);
  });

  it('returns 429 for a throttled IP and never calls the provider', async () => {
    const ip = '203.0.113.99';
    for (let i = 0; i < EXTRACT_RATE_LIMIT; i++) {
      extractRateLimiter.allow(ip);
    }

    const res = await post(
      {
        documents: [sourceDocument('offer_a.pdf', OFFER_A_SOURCE_TEXT)],
        schemaType: 'offer_letter',
      },
      { 'x-forwarded-for': ip },
    );

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain('Too many requests');
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(extractMock).not.toHaveBeenCalled();
  });
});
