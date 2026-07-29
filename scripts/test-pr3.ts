// scripts/test-pr3.ts
//
// Verification script for PR3a (Orchestration Endpoint) and PR3b (Line-Item Alignment Engine)
//

import { alignLineItems, validate, type QuoteForAlignment } from '../lib/alignment/lineItems';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failed++;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `  ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m=== ${title} ===\x1b[0m`);
}

function mockLineItem(desc: string, qty: number, unitPrice: number, total: number) {
  return {
    description: { value: desc, rawQuote: desc, pageNum: 1, confidence: 'high' as const },
    qty: { value: qty, rawQuote: String(qty), pageNum: 1, confidence: 'high' as const },
    unitPrice: { value: unitPrice, rawQuote: String(unitPrice), pageNum: 1, confidence: 'high' as const },
    total: { value: total, rawQuote: String(total), pageNum: 1, confidence: 'high' as const },
  };
}

async function testPR3bEarlyExit() {
  section('PR3b — Early Exit for quotes.length <= 1');

  // Case 0 quotes
  const res0 = await alignLineItems([]);
  check('0 quotes returns empty groups & empty unmatched', res0.groups.length === 0 && res0.unmatched.length === 0);
  check('0 quotes is trusted', res0.trusted === true);

  // Case 1 quote
  const singleQuote: QuoteForAlignment[] = [
    {
      fileName: 'quote1.pdf',
      lineItems: [
        mockLineItem('Steel Beams', 10, 100, 1000),
        mockLineItem('Bolts M8', 500, 0.5, 250),
      ],
    },
  ];
  const res1 = await alignLineItems(singleQuote);
  check('1 quote skips API call and returns 0 groups', res1.groups.length === 0);
  check('1 quote puts all items in unmatched', res1.unmatched.length === 2);
  check('1 quote unmatched has correct indices', res1.unmatched[0].lineItemIndex === 0 && res1.unmatched[1].lineItemIndex === 1);
  check('1 quote alignment is trusted', res1.trusted === true);
}

function testPR3bValidationGuardrails() {
  section('PR3b — Deterministic Validation Guardrails');

  const quotes: QuoteForAlignment[] = [
    {
      fileName: 'vendor_a.pdf',
      lineItems: [
        mockLineItem('Widget A', 10, 5, 50),
        mockLineItem('Widget B', 5, 10, 50),
      ],
    },
    {
      fileName: 'vendor_b.pdf',
      lineItems: [
        mockLineItem('Widget Model A', 10, 5, 50),
      ],
    },
  ];
  // Total items = 3 (quote 0 has 2, quote 1 has 1)

  // 1. Valid alignment
  const validResult = {
    groups: [
      {
        canonicalDescription: 'Widget A',
        members: [
          { quoteIndex: 0, lineItemIndex: 0 },
          { quoteIndex: 1, lineItemIndex: 0 },
        ],
      },
    ],
    unmatched: [
      { quoteIndex: 0, lineItemIndex: 1 },
    ],
  };
  const val1 = validate(validResult, quotes);
  check('Valid 3-item alignment is trusted = true', val1.trusted === true);

  // 2. Duplicate item reference
  const duplicateRefResult = {
    groups: [
      {
        canonicalDescription: 'Widget A',
        members: [
          { quoteIndex: 0, lineItemIndex: 0 },
          { quoteIndex: 1, lineItemIndex: 0 },
        ],
      },
    ],
    unmatched: [
      { quoteIndex: 0, lineItemIndex: 0 }, // duplicate of (0,0)
    ],
  };
  const val2 = validate(duplicateRefResult, quotes);
  check('Duplicate item reference sets trusted = false', val2.trusted === false);

  // 3. Out of bound index
  const invalidIndexResult = {
    groups: [
      {
        canonicalDescription: 'Non-existent item',
        members: [
          { quoteIndex: 0, lineItemIndex: 99 }, // out of bounds
        ],
      },
    ],
    unmatched: [
      { quoteIndex: 0, lineItemIndex: 0 },
      { quoteIndex: 0, lineItemIndex: 1 },
      { quoteIndex: 1, lineItemIndex: 0 },
    ],
  };
  const val3 = validate(invalidIndexResult, quotes);
  check('Out of bound index reference sets trusted = false', val3.trusted === false);

  // 4. Missing item (dropped item)
  const missingItemResult = {
    groups: [
      {
        canonicalDescription: 'Widget A',
        members: [
          { quoteIndex: 0, lineItemIndex: 0 },
        ],
      },
    ],
    unmatched: [], // dropped (0,1) and (1,0)
  };
  const val4 = validate(missingItemResult, quotes);
  check('Missing item (dropped item) sets trusted = false', val4.trusted === false);
}

async function main() {
  console.log('\x1b[1mPR3 Verification — scripts/test-pr3.ts\x1b[0m');
  await testPR3bEarlyExit();
  testPR3bValidationGuardrails();

  section('Summary');
  console.log(`  passed: \x1b[32m${passed}\x1b[0m   failed: \x1b[31m${failed}\x1b[0m`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
