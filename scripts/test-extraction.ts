// scripts/test-extraction.ts
//
// Sanity check for PR2's extraction pipeline.
//
// Two modes:
//   1. MOCK MODE (default — always runs):
//      Builds a synthetic ParsedDocument, calls schemaFor().safeParse(...)
//      with a hand-crafted extraction object, and exercises locate.ts on
//      each field's (rawQuote, pageNum) pair. Verifies that the envelope
//      validation accepts a well-formed payload, rejects null-as-omission,
//      and that locateQuote resolves bounding boxes for PDF runs.
//
//   2. LIVE MODE (only if ANTHROPIC_API_KEY is set in env):
//      Builds a synthetic ParsedDocument and calls extractDocument() for
//      real. Verifies that the live LLM output (a) sets missing fields to
//      null instead of hallucinating, and (b) returns rawQuote strings that
//      appear verbatim in the source text.
//
// Run:
//   npx tsx scripts/test-extraction.ts             (mock only)
//   ANTHROPIC_API_KEY=sk-... npx tsx scripts/test-extraction.ts   (mock + live)

import { schemaFor, type OfferLetterExtraction, type VendorQuoteExtraction } from '../lib/schemas/extraction';
import { locateQuote } from '../lib/extraction/locate';
import type { ParsedDocument, TextRun } from '../lib/parsers/types';
import { checkVendorQuoteMath } from '../lib/validation/mathCheck';

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

// -----------------------------------------------------------------------------
// Build a synthetic PDF ParsedDocument with real bbox metadata so locate.ts
// has something to union together.
// -----------------------------------------------------------------------------
function buildSampleOfferLetter(): ParsedDocument {
  const pages = [
    {
      pageNum: 1,
      text: '',
      runs: [] as TextRun[],
    },
    {
      pageNum: 2,
      text: '',
      runs: [] as TextRun[],
    },
  ];

  // Page 1 — name, title, base salary, signing bonus, equity, vesting
  const p1: TextRun[] = [
    { text: 'OFFER OF EMPLOYMENT', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 100, width: 400, height: 30 } } },
    { text: 'Dear', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 160, width: 30, height: 20 } } },
    { text: 'Aisha', location: { kind: 'pdf', pageNum: 1, bbox: { x: 140, y: 160, width: 60, height: 20 } } },
    { text: 'Khan', location: { kind: 'pdf', pageNum: 1, bbox: { x: 210, y: 160, width: 60, height: 20 } } },
    { text: ',', location: { kind: 'pdf', pageNum: 1, bbox: { x: 270, y: 160, width: 10, height: 20 } } },
    { text: 'We are pleased to offer you the position of', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 200, width: 400, height: 20 } } },
    { text: 'Senior', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 240, width: 80, height: 20 } } },
    { text: 'Software', location: { kind: 'pdf', pageNum: 1, bbox: { x: 190, y: 240, width: 100, height: 20 } } },
    { text: 'Engineer', location: { kind: 'pdf', pageNum: 1, bbox: { x: 300, y: 240, width: 110, height: 20 } } },
    { text: '.', location: { kind: 'pdf', pageNum: 1, bbox: { x: 410, y: 240, width: 10, height: 20 } } },
    { text: 'Your', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 280, width: 50, height: 20 } } },
    { text: 'annual', location: { kind: 'pdf', pageNum: 1, bbox: { x: 160, y: 280, width: 60, height: 20 } } },
    { text: 'base', location: { kind: 'pdf', pageNum: 1, bbox: { x: 230, y: 280, width: 50, height: 20 } } },
    { text: 'salary', location: { kind: 'pdf', pageNum: 1, bbox: { x: 290, y: 280, width: 60, height: 20 } } },
    { text: 'will', location: { kind: 'pdf', pageNum: 1, bbox: { x: 360, y: 280, width: 40, height: 20 } } },
    { text: 'be', location: { kind: 'pdf', pageNum: 1, bbox: { x: 410, y: 280, width: 30, height: 20 } } },
    { text: '$185,000', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 320, width: 100, height: 30 } } },
    { text: '.', location: { kind: 'pdf', pageNum: 1, bbox: { x: 200, y: 320, width: 10, height: 20 } } },
    { text: 'You', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 360, width: 30, height: 20 } } },
    { text: 'will', location: { kind: 'pdf', pageNum: 1, bbox: { x: 140, y: 360, width: 40, height: 20 } } },
    { text: 'also', location: { kind: 'pdf', pageNum: 1, bbox: { x: 190, y: 360, width: 40, height: 20 } } },
    { text: 'receive', location: { kind: 'pdf', pageNum: 1, bbox: { x: 240, y: 360, width: 70, height: 20 } } },
    { text: 'a', location: { kind: 'pdf', pageNum: 1, bbox: { x: 320, y: 360, width: 15, height: 20 } } },
    { text: 'signing', location: { kind: 'pdf', pageNum: 1, bbox: { x: 345, y: 360, width: 60, height: 20 } } },
    { text: 'bonus', location: { kind: 'pdf', pageNum: 1, bbox: { x: 415, y: 360, width: 50, height: 20 } } },
    { text: 'of', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 400, width: 20, height: 20 } } },
    { text: '$25,000', location: { kind: 'pdf', pageNum: 1, bbox: { x: 130, y: 400, width: 100, height: 30 } } },
    { text: 'and', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 440, width: 35, height: 20 } } },
    { text: 'an', location: { kind: 'pdf', pageNum: 1, bbox: { x: 145, y: 440, width: 25, height: 20 } } },
    { text: 'equity', location: { kind: 'pdf', pageNum: 1, bbox: { x: 180, y: 440, width: 60, height: 20 } } },
    { text: 'grant', location: { kind: 'pdf', pageNum: 1, bbox: { x: 250, y: 440, width: 55, height: 20 } } },
    { text: 'of', location: { kind: 'pdf', pageNum: 1, bbox: { x: 315, y: 440, width: 20, height: 20 } } },
    { text: '4,000', location: { kind: 'pdf', pageNum: 1, bbox: { x: 345, y: 440, width: 60, height: 30 } } },
    { text: 'RSUs', location: { kind: 'pdf', pageNum: 1, bbox: { x: 415, y: 440, width: 50, height: 20 } } },
    { text: 'vesting', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 480, width: 70, height: 20 } } },
    { text: 'over', location: { kind: 'pdf', pageNum: 1, bbox: { x: 180, y: 480, width: 40, height: 20 } } },
    { text: '4', location: { kind: 'pdf', pageNum: 1, bbox: { x: 230, y: 480, width: 15, height: 20 } } },
    { text: 'years', location: { kind: 'pdf', pageNum: 1, bbox: { x: 255, y: 480, width: 50, height: 20 } } },
    { text: 'with', location: { kind: 'pdf', pageNum: 1, bbox: { x: 315, y: 480, width: 40, height: 20 } } },
    { text: 'a', location: { kind: 'pdf', pageNum: 1, bbox: { x: 365, y: 480, width: 15, height: 20 } } },
    { text: '1-year', location: { kind: 'pdf', pageNum: 1, bbox: { x: 390, y: 480, width: 60, height: 20 } } },
    { text: 'cliff', location: { kind: 'pdf', pageNum: 1, bbox: { x: 460, y: 480, width: 50, height: 20 } } },
  ];
  pages[0].runs = p1;
  pages[0].text = p1.map((r) => r.text).join(' ');

  // Page 2 — PTO, remote, notice, expiration. No performance bonus, no bonus.
  const p2: TextRun[] = [
    { text: 'BENEFITS', location: { kind: 'pdf', pageNum: 2, bbox: { x: 100, y: 100, width: 200, height: 30 } } },
    { text: 'You', location: { kind: 'pdf', pageNum: 2, bbox: { x: 100, y: 160, width: 30, height: 20 } } },
    { text: 'will', location: { kind: 'pdf', pageNum: 2, bbox: { x: 140, y: 160, width: 40, height: 20 } } },
    { text: 'receive', location: { kind: 'pdf', pageNum: 2, bbox: { x: 190, y: 160, width: 70, height: 20 } } },
    { text: '25', location: { kind: 'pdf', pageNum: 2, bbox: { x: 270, y: 160, width: 30, height: 30 } } },
    { text: 'days', location: { kind: 'pdf', pageNum: 2, bbox: { x: 310, y: 160, width: 50, height: 20 } } },
    { text: 'of', location: { kind: 'pdf', pageNum: 2, bbox: { x: 370, y: 160, width: 20, height: 20 } } },
    { text: 'paid', location: { kind: 'pdf', pageNum: 2, bbox: { x: 400, y: 160, width: 40, height: 20 } } },
    { text: 'time', location: { kind: 'pdf', pageNum: 2, bbox: { x: 100, y: 200, width: 40, height: 20 } } },
    { text: 'off', location: { kind: 'pdf', pageNum: 2, bbox: { x: 150, y: 200, width: 30, height: 20 } } },
    { text: '.', location: { kind: 'pdf', pageNum: 2, bbox: { x: 180, y: 200, width: 10, height: 20 } } },
    { text: 'This', location: { kind: 'pdf', pageNum: 2, bbox: { x: 100, y: 240, width: 40, height: 20 } } },
    { text: 'is', location: { kind: 'pdf', pageNum: 2, bbox: { x: 150, y: 240, width: 20, height: 20 } } },
    { text: 'a', location: { kind: 'pdf', pageNum: 2, bbox: { x: 180, y: 240, width: 15, height: 20 } } },
    { text: 'fully', location: { kind: 'pdf', pageNum: 2, bbox: { x: 205, y: 240, width: 50, height: 20 } } },
    { text: 'remote', location: { kind: 'pdf', pageNum: 2, bbox: { x: 265, y: 240, width: 70, height: 20 } } },
    { text: 'role', location: { kind: 'pdf', pageNum: 2, bbox: { x: 345, y: 240, width: 40, height: 20 } } },
    { text: '.', location: { kind: 'pdf', pageNum: 2, bbox: { x: 385, y: 240, width: 10, height: 20 } } },
    { text: 'Notice', location: { kind: 'pdf', pageNum: 2, bbox: { x: 100, y: 300, width: 60, height: 20 } } },
    { text: 'period', location: { kind: 'pdf', pageNum: 2, bbox: { x: 170, y: 300, width: 60, height: 20 } } },
    { text: 'is', location: { kind: 'pdf', pageNum: 2, bbox: { x: 240, y: 300, width: 20, height: 20 } } },
    { text: '30', location: { kind: 'pdf', pageNum: 2, bbox: { x: 270, y: 300, width: 30, height: 30 } } },
    { text: 'days', location: { kind: 'pdf', pageNum: 2, bbox: { x: 310, y: 300, width: 50, height: 20 } } },
    { text: '.', location: { kind: 'pdf', pageNum: 2, bbox: { x: 360, y: 300, width: 10, height: 20 } } },
    { text: 'This', location: { kind: 'pdf', pageNum: 2, bbox: { x: 100, y: 340, width: 40, height: 20 } } },
    { text: 'offer', location: { kind: 'pdf', pageNum: 2, bbox: { x: 150, y: 340, width: 50, height: 20 } } },
    { text: 'expires', location: { kind: 'pdf', pageNum: 2, bbox: { x: 210, y: 340, width: 70, height: 20 } } },
    { text: 'on', location: { kind: 'pdf', pageNum: 2, bbox: { x: 290, y: 340, width: 25, height: 20 } } },
    { text: '2026-08-15', location: { kind: 'pdf', pageNum: 2, bbox: { x: 325, y: 340, width: 100, height: 20 } } },
    { text: '.', location: { kind: 'pdf', pageNum: 2, bbox: { x: 425, y: 340, width: 10, height: 20 } } },
  ];
  pages[1].runs = p2;
  pages[1].text = p2.map((r) => r.text).join(' ');

  return { fileName: 'sample-offer-letter.pdf', sourceFormat: 'pdf', pages };
}

function buildSampleVendorQuote(): ParsedDocument {
  const p1: TextRun[] = [
    { text: 'Acme', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 100, width: 60, height: 30 } } },
    { text: 'Industrial', location: { kind: 'pdf', pageNum: 1, bbox: { x: 170, y: 100, width: 110, height: 30 } } },
    { text: 'Supplies', location: { kind: 'pdf', pageNum: 1, bbox: { x: 290, y: 100, width: 100, height: 30 } } },
    { text: 'Quote', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 160, width: 60, height: 20 } } },
    { text: 'ref', location: { kind: 'pdf', pageNum: 1, bbox: { x: 170, y: 160, width: 30, height: 20 } } },
    { text: 'Q-2026-0042', location: { kind: 'pdf', pageNum: 1, bbox: { x: 210, y: 160, width: 120, height: 20 } } },
    { text: 'Steel', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 220, width: 60, height: 20 } } },
    { text: 'beams', location: { kind: 'pdf', pageNum: 1, bbox: { x: 170, y: 220, width: 70, height: 20 } } },
    { text: '100', location: { kind: 'pdf', pageNum: 1, bbox: { x: 300, y: 220, width: 50, height: 20 } } },
    { text: '12.50', location: { kind: 'pdf', pageNum: 1, bbox: { x: 360, y: 220, width: 60, height: 20 } } },
    { text: '1250.00', location: { kind: 'pdf', pageNum: 1, bbox: { x: 430, y: 220, width: 80, height: 20 } } },
    { text: 'Bolts', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 250, width: 50, height: 20 } } },
    { text: 'M8', location: { kind: 'pdf', pageNum: 1, bbox: { x: 160, y: 250, width: 30, height: 20 } } },
    { text: '500', location: { kind: 'pdf', pageNum: 1, bbox: { x: 300, y: 250, width: 50, height: 20 } } },
    { text: '0.75', location: { kind: 'pdf', pageNum: 1, bbox: { x: 360, y: 250, width: 50, height: 20 } } },
    { text: '375.00', location: { kind: 'pdf', pageNum: 1, bbox: { x: 430, y: 250, width: 80, height: 20 } } },
    { text: 'Subtotal', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 320, width: 100, height: 20 } } },
    { text: '1625.00', location: { kind: 'pdf', pageNum: 1, bbox: { x: 430, y: 320, width: 90, height: 20 } } },
    { text: 'Tax', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 360, width: 50, height: 20 } } },
    { text: '162.50', location: { kind: 'pdf', pageNum: 1, bbox: { x: 430, y: 360, width: 80, height: 20 } } },
    { text: 'Total', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 400, width: 60, height: 20 } } },
    { text: '1787.50', location: { kind: 'pdf', pageNum: 1, bbox: { x: 430, y: 400, width: 90, height: 20 } } },
    { text: 'Net', location: { kind: 'pdf', pageNum: 1, bbox: { x: 100, y: 440, width: 40, height: 20 } } },
    { text: '30', location: { kind: 'pdf', pageNum: 1, bbox: { x: 150, y: 440, width: 30, height: 20 } } },
    { text: 'delivery', location: { kind: 'pdf', pageNum: 1, bbox: { x: 190, y: 440, width: 80, height: 20 } } },
    { text: '5', location: { kind: 'pdf', pageNum: 1, bbox: { x: 280, y: 440, width: 15, height: 20 } } },
    { text: 'business', location: { kind: 'pdf', pageNum: 1, bbox: { x: 305, y: 440, width: 90, height: 20 } } },
    { text: 'days', location: { kind: 'pdf', pageNum: 1, bbox: { x: 405, y: 440, width: 50, height: 20 } } },
  ];
  return {
    fileName: 'sample-quote.pdf',
    sourceFormat: 'pdf',
    pages: [{ pageNum: 1, text: p1.map((r) => r.text).join(' '), runs: p1 }],
  };
}

// -----------------------------------------------------------------------------
// Mock mode
// -----------------------------------------------------------------------------
async function runMockMode() {
  section('Mock mode — offer letter (PDF)');

  const doc = buildSampleOfferLetter();
  const schema = schemaFor('offer_letter');

  const wellFormed: OfferLetterExtraction = {
    candidateName: { value: 'Aisha Khan', rawQuote: 'Aisha Khan', pageNum: 1, confidence: 'high' },
    jobTitle: { value: 'Senior Software Engineer', rawQuote: 'Senior Software Engineer', pageNum: 1, confidence: 'high' },
    baseSalary: { value: 185000, rawQuote: '$185,000', pageNum: 1, confidence: 'high' },
    signingBonus: { value: 25000, rawQuote: '$25,000', pageNum: 1, confidence: 'high' },
    equityValue: { value: '4,000 RSUs', rawQuote: '4,000 RSUs', pageNum: 1, confidence: 'high' },
    vestingSchedule: { value: '4 years with a 1-year cliff', rawQuote: 'vesting over 4 years with a 1-year cliff', pageNum: 1, confidence: 'high' },
    performanceBonus: { value: null, rawQuote: null, pageNum: null, confidence: 'low' }, // not in document
    ptoDays: { value: 25, rawQuote: '25 days of paid time off', pageNum: 2, confidence: 'high' },
    remotePolicy: { value: 'fully remote', rawQuote: 'fully remote', pageNum: 2, confidence: 'high' },
    noticePeriod: { value: '30 days', rawQuote: '30 days', pageNum: 2, confidence: 'high' },
    offerExpiration: { value: '2026-08-15', rawQuote: '2026-08-15', pageNum: 2, confidence: 'high' },
  };

  const parsed = schema.safeParse(wellFormed);
  check('Schema accepts a well-formed extraction envelope', parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues));

  // Missing fields must be null, not hallucinated. (The schema permits any
  // string for performanceBonus, so a hallucinated string *would* parse —
  // protection against that lives in the SYSTEM PROMPT, which the mock can't
  // enforce. We verify a *truly malformed* payload does get rejected.)
  const malformed = { ...wellFormed, baseSalary: { value: 'one hundred eighty five thousand', rawQuote: '??', pageNum: 1, confidence: 'high' } };
  const malformedResult = schema.safeParse(malformed);
  check('Schema rejects baseSalary given as a string (type enforcement)', !malformedResult.success);

  // Locate envelope values
  for (const [fieldName, env] of Object.entries(wellFormed) as [keyof OfferLetterExtraction, OfferLetterExtraction[keyof OfferLetterExtraction]][]) {
    if (env.value === null) continue;
    const loc = locateQuote(doc, env.rawQuote, env.pageNum);
    check(
      `locateQuote(${fieldName}) returns a PDF source location`,
      loc !== null && loc.kind === 'pdf',
      loc === null ? 'returned null' : `kind=${loc.kind}`,
    );
    if (loc?.kind === 'pdf') {
      // PDF: bbox should be a non-degenerate rectangle
      const degenerate = loc.bbox.x === 0 && loc.bbox.y === 0 && loc.bbox.width === 0 && loc.bbox.height === 0;
      check(`locateQuote(${fieldName}) bbox is non-empty`, !degenerate, JSON.stringify(loc.bbox));
    }
  }

  section('Mock mode — offer letter: missing-field behavior');

  // Now verify that *omitting* required fields (setting them to undefined-shape, not just null)
  // is also caught — the schema requires confidence to be present even when value is null.
  const incompleteMissing = {
    ...wellFormed,
    performanceBonus: { value: null, rawQuote: null, pageNum: null }, // missing confidence
  };
  const incompleteResult = schema.safeParse(incompleteMissing);
  check('Schema rejects a missing field envelope (confidence required even when value is null)', !incompleteResult.success);

  section('Mock mode — vendor quote (PDF) + math check');

  const quote = buildSampleVendorQuote();
  const qSchema = schemaFor('vendor_quote');

  const wellFormedQuote: VendorQuoteExtraction = {
    vendorName: { value: 'Acme Industrial Supplies', rawQuote: 'Acme Industrial Supplies', pageNum: 1, confidence: 'high' },
    quoteReference: { value: 'Q-2026-0042', rawQuote: 'Q-2026-0042', pageNum: 1, confidence: 'high' },
    quoteExpiration: { value: null, rawQuote: null, pageNum: null, confidence: 'low' },
    lineItems: [
      { description: { value: 'Steel beams', rawQuote: 'Steel beams', pageNum: 1, confidence: 'high' }, qty: { value: 100, rawQuote: '100', pageNum: 1, confidence: 'high' }, unitPrice: { value: 12.5, rawQuote: '12.50', pageNum: 1, confidence: 'high' }, total: { value: 1250, rawQuote: '1250.00', pageNum: 1, confidence: 'high' } },
      { description: { value: 'Bolts M8', rawQuote: 'Bolts M8', pageNum: 1, confidence: 'high' }, qty: { value: 500, rawQuote: '500', pageNum: 1, confidence: 'high' }, unitPrice: { value: 0.75, rawQuote: '0.75', pageNum: 1, confidence: 'high' }, total: { value: 375, rawQuote: '375.00', pageNum: 1, confidence: 'high' } },
    ],
    subtotal: { value: 1625, rawQuote: '1625.00', pageNum: 1, confidence: 'high' },
    taxAmount: { value: 162.5, rawQuote: '162.50', pageNum: 1, confidence: 'high' },
    grandTotal: { value: 1787.5, rawQuote: '1787.50', pageNum: 1, confidence: 'high' },
    paymentTerms: { value: 'Net 30', rawQuote: 'Net 30', pageNum: 1, confidence: 'high' },
    deliverySla: { value: '5 business days', rawQuote: '5 business days', pageNum: 1, confidence: 'high' },
    warrantyPeriod: { value: null, rawQuote: null, pageNum: null, confidence: 'low' },
  };
  const qParsed = qSchema.safeParse(wellFormedQuote);
  check('Schema accepts a well-formed vendor quote envelope', qParsed.success, qParsed.success ? undefined : JSON.stringify(qParsed.error.issues));

  const discrepancies = checkVendorQuoteMath(wellFormedQuote);
  check('Math check finds ZERO discrepancies for a self-consistent quote', discrepancies.length === 0, `got ${discrepancies.length}: ${JSON.stringify(discrepancies)}`);

  // Now introduce a deliberate discrepancy and ensure mathCheck catches it
  const brokenQuote: VendorQuoteExtraction = {
    ...wellFormedQuote,
    lineItems: [
      { ...wellFormedQuote.lineItems[0], total: { value: 9999, rawQuote: '9999', pageNum: 1, confidence: 'low' } }, // wrong
      wellFormedQuote.lineItems[1],
    ],
  };
  const brokenDiscrepancies = checkVendorQuoteMath(brokenQuote);
  check('Math check flags an inconsistent line-item total', brokenDiscrepancies.length > 0 && brokenDiscrepancies.some((d) => d.field.startsWith('lineItems[0]')), JSON.stringify(brokenDiscrepancies));

  // Locate quote
  for (const fieldName of ['vendorName', 'quoteReference', 'subtotal', 'grandTotal', 'paymentTerms', 'deliverySla'] as const) {
    const env = wellFormedQuote[fieldName];
    if (env.value === null) continue;
    const loc = locateQuote(quote, env.rawQuote, env.pageNum);
    check(`locateQuote(quote.${fieldName}) returns a PDF source location`, loc !== null && loc.kind === 'pdf', loc === null ? 'null' : loc.kind);
  }

  // Quote field for which the doc has no source — must return null
  const warrantyLoc = locateQuote(quote, '24 months', 1);
  check('locateQuote for a non-existent quote returns null (no false positive)', warrantyLoc === null, warrantyLoc === null ? '' : JSON.stringify(warrantyLoc));
}

// -----------------------------------------------------------------------------
// Live mode
// -----------------------------------------------------------------------------
async function runLiveMode() {
  if (!process.env.ANTHROPIC_API_KEY) {
    section('Live mode — SKIPPED (no ANTHROPIC_API_KEY in env)');
    return;
  }

  section('Live mode — offer letter extraction');
  const doc = buildSampleOfferLetter();
  const { extractDocument } = await import('../lib/extraction/extract');
  const result = await extractDocument(doc, 'offer_letter');
  const ext = result.parsed as OfferLetterExtraction;

  console.log('  Extracted envelope:');
  for (const [k, v] of Object.entries(ext)) {
    if (v === null) {
      console.log(`    ${k}: null`);
    } else {
      // v is a FieldEnvelope here, narrowed by ts
      const env = v as { value: unknown; rawQuote: string | null; pageNum: number | null; confidence: string };
      console.log(`    ${k}: ${JSON.stringify(env.value)}  (rawQuote=${JSON.stringify(env.rawQuote)}, pageNum=${env.pageNum}, conf=${env.confidence})`);
    }
  }

  // 1. Missing fields must be null
  check('Live: performanceBonus is null (not present in source)', ext.performanceBonus.value === null);
  check('Live: performanceBonus confidence is "low" when null', ext.performanceBonus.confidence === 'low');

  // 2. rawQuote verbatim check
  for (const [fieldName, env] of Object.entries(ext) as [keyof OfferLetterExtraction, OfferLetterExtraction[keyof OfferLetterExtraction]][]) {
    if (env.value === null || env.rawQuote === null) continue;
    const page = doc.pages.find((p) => p.pageNum === env.pageNum);
    const pageText = page?.text ?? '';
    check(`Live: ${fieldName} rawQuote is verbatim substring of source page text`, pageText.includes(env.rawQuote), `rawQuote=${JSON.stringify(env.rawQuote)}`);
  }

  // 3. Locate resolution
  for (const [fieldName, env] of Object.entries(ext) as [keyof OfferLetterExtraction, OfferLetterExtraction[keyof OfferLetterExtraction]][]) {
    if (env.value === null || env.rawQuote === null || env.pageNum === null) continue;
    const loc = locateQuote(doc, env.rawQuote, env.pageNum);
    check(`Live: locateQuote(${fieldName}) returns a non-null SourceLocation`, loc !== null, loc === null ? 'null returned' : '');
  }
}

async function main() {
  console.log('\x1b[1mPR2 Sanity Check — scripts/test-extraction.ts\x1b[0m');
  await runMockMode();
  await runLiveMode();

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
