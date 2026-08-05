// tests/alignment-quota.test.ts
//
// Unit tests for the line-item alignment dispatcher (lib/alignment/lineItems.ts):
//  - provider selection follows EXTRACTION_PROVIDER (default Gemini)
//  - a quota / rate-limit / billing error degrades to an honest, untrusted
//    empty outcome instead of throwing
//  - any other error still propagates
//  - the deterministic validate() guardrails stay intact

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  alignWithGemini: vi.fn(),
  alignWithAnthropic: vi.fn(),
}));

vi.mock('@/lib/alignment/providers/gemini', () => ({ alignWithGemini: mocks.alignWithGemini }));
vi.mock('@/lib/alignment/providers/anthropic', () => ({ alignWithAnthropic: mocks.alignWithAnthropic }));

import { alignLineItems, validate, type QuoteForAlignment } from '@/lib/alignment/lineItems';

function lineItem(desc: string, qty: number, unitPrice: number, total: number) {
  return {
    description: { value: desc, rawQuote: desc, pageNum: 1, confidence: 'high' as const },
    qty: { value: qty, rawQuote: String(qty), pageNum: 1, confidence: 'high' as const },
    unitPrice: { value: unitPrice, rawQuote: String(unitPrice), pageNum: 1, confidence: 'high' as const },
    total: { value: total, rawQuote: String(total), pageNum: 1, confidence: 'high' as const },
  };
}

function quotes(): QuoteForAlignment[] {
  // Total items = 3 (quote 0 has 2, quote 1 has 1)
  return [
    {
      fileName: 'vendor_a.pdf',
      lineItems: [lineItem('Widget A', 10, 5, 50), lineItem('Widget B', 5, 10, 50)],
    },
    {
      fileName: 'vendor_b.pdf',
      lineItems: [lineItem('Widget Model A', 10, 5, 50)],
    },
  ];
}

const ALL_UNMATCHED = [
  { quoteIndex: 0, lineItemIndex: 0 },
  { quoteIndex: 0, lineItemIndex: 1 },
  { quoteIndex: 1, lineItemIndex: 0 },
];

function quotaError(): Error {
  return Object.assign(new Error('RESOURCE_EXHAUSTED: requests per minute exceeded'), { status: 429 });
}

describe('alignLineItems provider selection + quota degrade', () => {
  beforeEach(() => {
    mocks.alignWithGemini.mockReset();
    mocks.alignWithAnthropic.mockReset();
    delete process.env.EXTRACTION_PROVIDER;
  });

  afterEach(() => {
    delete process.env.EXTRACTION_PROVIDER;
  });

  it('skips the API call entirely with fewer than two quotes', async () => {
    const single: QuoteForAlignment[] = [
      { fileName: 'q.pdf', lineItems: [lineItem('X', 1, 2, 2)] },
    ];

    const res = await alignLineItems(single);

    expect(res).toEqual({
      groups: [],
      unmatched: [{ quoteIndex: 0, lineItemIndex: 0 }],
      trusted: true,
    });
    expect(mocks.alignWithGemini).not.toHaveBeenCalled();
    expect(mocks.alignWithAnthropic).not.toHaveBeenCalled();
  });

  it('uses Gemini by default (EXTRACTION_PROVIDER unset)', async () => {
    mocks.alignWithGemini.mockResolvedValue({ groups: [], unmatched: ALL_UNMATCHED });

    await alignLineItems(quotes());

    expect(mocks.alignWithGemini).toHaveBeenCalledTimes(1);
    expect(mocks.alignWithAnthropic).not.toHaveBeenCalled();
  });

  it('uses Anthropic when EXTRACTION_PROVIDER=anthropic', async () => {
    process.env.EXTRACTION_PROVIDER = 'anthropic';
    mocks.alignWithAnthropic.mockResolvedValue({ groups: [], unmatched: ALL_UNMATCHED });

    await alignLineItems(quotes());

    expect(mocks.alignWithAnthropic).toHaveBeenCalledTimes(1);
    expect(mocks.alignWithGemini).not.toHaveBeenCalled();
  });

  it('degrades to an honest untrusted outcome on a quota error instead of throwing', async () => {
    mocks.alignWithGemini.mockRejectedValueOnce(quotaError());

    const res = await alignLineItems(quotes());

    expect(res.trusted).toBe(false);
    expect(res.groups).toEqual([]);
    expect(res.unmatched).toEqual(ALL_UNMATCHED);
  });

  it('propagates non-quota provider errors', async () => {
    mocks.alignWithGemini.mockRejectedValueOnce(new Error('Invalid argument: schema mismatch'));

    await expect(alignLineItems(quotes())).rejects.toThrow('schema mismatch');
  });
});

describe('validate deterministic guardrails', () => {
  it('trusts a valid alignment where every real item is accounted for exactly once', () => {
    const valid = {
      groups: [
        {
          canonicalDescription: 'Widget A',
          members: [
            { quoteIndex: 0, lineItemIndex: 0 },
            { quoteIndex: 1, lineItemIndex: 0 },
          ],
        },
      ],
      unmatched: [{ quoteIndex: 0, lineItemIndex: 1 }],
    };

    expect(validate(valid, quotes()).trusted).toBe(true);
  });

  it('flags a duplicate item reference', () => {
    const duplicate = {
      groups: [
        {
          canonicalDescription: 'Widget A',
          members: [
            { quoteIndex: 0, lineItemIndex: 0 },
            { quoteIndex: 1, lineItemIndex: 0 },
          ],
        },
      ],
      unmatched: [{ quoteIndex: 0, lineItemIndex: 0 }], // duplicate of (0,0)
    };

    expect(validate(duplicate, quotes()).trusted).toBe(false);
  });

  it('flags an out-of-bounds index reference', () => {
    const invalidIndex = {
      groups: [
        {
          canonicalDescription: 'Non-existent item',
          members: [{ quoteIndex: 0, lineItemIndex: 99 }],
        },
      ],
      unmatched: [
        { quoteIndex: 0, lineItemIndex: 0 },
        { quoteIndex: 0, lineItemIndex: 1 },
        { quoteIndex: 1, lineItemIndex: 0 },
      ],
    };

    expect(validate(invalidIndex, quotes()).trusted).toBe(false);
  });

  it('flags a dropped (missing) item', () => {
    const missing = {
      groups: [
        {
          canonicalDescription: 'Widget A',
          members: [{ quoteIndex: 0, lineItemIndex: 0 }],
        },
      ],
      unmatched: [], // dropped (0,1) and (1,0)
    };

    expect(validate(missing, quotes()).trusted).toBe(false);
  });
});
