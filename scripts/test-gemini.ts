// scripts/test-gemini.ts
//
// LIVE verification harness for the Gemini extraction provider.
//
// Feeds the actual bundled sample offer letters (public/samples/*.pdf) AND the
// canonical AEGIS offer letter from the verifier fixture suite through the real
// Gemini API with the exact production schema + system prompt, then re-checks
// every rawQuote against the source via verifyExtractions() — the same gate the
// API route applies to Claude output.
//
// This is the honest-equivalence check: Gemini's structured output habits
// (quote formatting, confidence usage, fabrication tendency) are NOT assumed to
// match Claude's. Whatever this script reports is the finding.
//
// Requires GEMINI_API_KEY in env (loaded from .env.local).
//
//   npx tsx scripts/test-gemini.ts
//   GEMINI_MODEL=gemini-3.5-flash-lite npx tsx scripts/test-gemini.ts

import { readFileSync } from 'node:fs';
import { parsePdf } from '../lib/parsers/pdf';
import type { ParsedDocument, TextRun } from '../lib/parsers/types';
import { buildPageMarkedText } from '../lib/extraction/pageText';
import { verifyExtractions, type FlaggedField } from '../lib/extraction/verifier';
import { extractWithGemini, geminiModelId } from '../lib/extraction/providers/gemini';
import type { OfferLetterExtraction } from '../lib/schemas/extraction';

const SAMPLE_PDFS = ['offer_a.pdf', 'offer_b.pdf', 'offer_missing_pto.pdf'];

// The canonical AEGIS letter from tests/fixtures/adversarial-offer-letters.json,
// rendered as a single-page ParsedDocument so the harness exercises the same
// document family the verifier suite was built against.
const AEGIS_TEXT =
  'AEGIS ROBOTICS\nOffer of Employment\n\nDear Morgan Alvarez,\n\n' +
  'We are pleased to offer you the position of Senior Software Engineer at AEGIS Robotics.\n\n' +
  'Annual Target Compensation: $185,000 - $195,000 (DOE)\n' +
  'Signing Bonus: $25,000\n' +
  'Equity: 4,000 RSUs vesting over 4 years with a 1-year cliff\n' +
  'Performance Bonus: up to 15% of Annual Target Compensation\n' +
  'Paid Time Off: 25 days\n' +
  'Remote Policy: fully remote\n' +
  'Notice Period: 30 days\n' +
  'This offer expires 2026-08-15.\n';

function aegisDocument(): ParsedDocument {
  const runs: TextRun[] = [];
  const text = AEGIS_TEXT.replace(/\n+/g, ' ');
  return {
    fileName: 'aegis-offer-letter.txt',
    sourceFormat: 'pdf',
    pages: [
      {
        pageNum: 1,
        text,
        runs,
      },
    ],
  };
}

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

function envelopeReport(label: string, extraction: OfferLetterExtraction) {
  console.log(`  [${label}] envelope summary:`);
  for (const [k, env] of Object.entries(extraction) as [keyof OfferLetterExtraction, OfferLetterExtraction[keyof OfferLetterExtraction]][]) {
    if (env.value === null) {
      console.log(`    ${k}: null`);
    } else {
      const e = env as { value: unknown; rawQuote: string | null; confidence: string };
      console.log(`    ${k}: ${JSON.stringify(e.value)}  quote=${JSON.stringify(e.rawQuote)}  conf=${e.confidence}`);
    }
  }
}

function summarizeFlags(fileName: string, flagged: FlaggedField[]) {
  if (flagged.length === 0) {
    console.log(`    → 0 flagged fields (trusted)`);
    return;
  }
  console.log(`    → ${flagged.length} flagged field(s):`);
  for (const f of flagged) {
    console.log(`      - ${f.fieldPath}: [${f.reason}] ${f.message}`);
  }
}

async function runDocument(label: string, doc: ParsedDocument) {
  const section = `Live Gemini extraction — ${label} (model ${geminiModelId()})`;
  console.log(`\n\x1b[1m=== ${section} ===\x1b[0m`);

  let result: { raw: unknown; parsed: OfferLetterExtraction };
  try {
    result = (await extractWithGemini(doc, 'offer_letter')) as {
      raw: unknown;
      parsed: OfferLetterExtraction;
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(`${label}: live Gemini call succeeded`, false, msg);
    console.log(`  Raw failure output: ${msg.slice(0, 400)}`);
    return;
  }

  console.log(`  Raw response (first 1200 chars):`);
  console.log(`    ${JSON.stringify(result.raw).slice(0, 1200)}`);

  const sourceText = buildPageMarkedText(doc);
  const { trusted, flaggedFields, extractions } = verifyExtractions(result.parsed, sourceText);

  envelopeReport('verified', extractions);
  summarizeFlags(label, flaggedFields);

  // Honesty checks — the same invariants test-extraction.ts asserts for Claude.
  check(`${label}: verification reports trusted`, trusted, flaggedFields.map((f) => f.message).join(' | '));

  // Every non-null value must carry a verbatim rawQuote that survives verification.
  for (const [k, env] of Object.entries(extractions) as [keyof OfferLetterExtraction, OfferLetterExtraction[keyof OfferLetterExtraction]][]) {
    if (env.value === null) continue;
    const e = env as { rawQuote: string | null };
    check(
      `${label}: ${k} has a rawQuote`,
      typeof e.rawQuote === 'string' && e.rawQuote.trim().length > 0,
      `value=${JSON.stringify(env.value)}`,
    );
  }

  return extractions;
}

async function main() {
  console.log('\x1b[1mLive Gemini extraction + verification harness\x1b[0m');
  console.log(`Model: ${geminiModelId()}   (override with GEMINI_MODEL env)`);

  const extractions: Record<string, OfferLetterExtraction> = {};

  for (const f of SAMPLE_PDFS) {
    const parsed = await parsePdf(f, new Uint8Array(readFileSync(`./public/samples/${f}`)).buffer);
    if (!parsed.ok) {
      check(`${f}: parse succeeded`, false, parsed.error.message);
      continue;
    }
    const ext = await runDocument(f, parsed.document);
    if (ext) extractions[f] = ext;
  }

  const aegis = await runDocument('aegis-offer-letter (verifier fixture source)', aegisDocument());
  if (aegis) extractions['aegis'] = aegis;

  // offer_missing_pto.pdf has no PTO line — the honest answer is a null ptoDays.
  if (extractions['offer_missing_pto.pdf']) {
    check(
      'offer_missing_pto.pdf: ptoDays is an honest null (absent from the document)',
      extractions['offer_missing_pto.pdf'].ptoDays.value === null,
      `value=${JSON.stringify(extractions['offer_missing_pto.pdf'].ptoDays.value)}`,
    );
  }

  console.log(`\n\x1b[1mSummary\x1b[0m`);
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
