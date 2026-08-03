// lib/extraction/staticFallback.ts
//
// HONEST degraded-mode fallback for the bundled sample documents.
//
// When live extraction fails with a quota/rate-limit/billing error (see
// lib/extraction/providers/errors.ts) AND the document being processed is one
// of the known sample PDFs shipped under public/samples, the API may serve the
// pre-verified static extraction below instead of returning nothing. The
// payload is still run through the exact same verification pipeline at request
// time (verifyExtractions + locateQuote + math check), so locations are real
// and flags are honest — but the response MUST be marked demoMode: true so the
// UI can never present it as a live extraction.
//
// For any document that is NOT a known sample, a provider failure must surface
// as a plain error. Never substitute fake data for an unknown document.

import { OfferLetterExtractionSchema, type DocumentSchemaType, type OfferLetterExtraction } from '@/lib/schemas/extraction';

/** The bundled sample PDFs that have a pre-verified static payload. */
export const KNOWN_SAMPLE_FILE_NAMES: ReadonlySet<string> = new Set([
  'offer_a.pdf',
  'offer_b.pdf',
  'offer_missing_pto.pdf',
]);

export function isKnownSampleDocument(fileName: string): boolean {
  return KNOWN_SAMPLE_FILE_NAMES.has(fileName);
}

function envelope<T>(value: T, rawQuote: string, confidence: 'high' | 'medium' | 'low'): OfferLetterExtraction['candidateName'] & { value: T } {
  return { value, rawQuote, pageNum: 1, confidence } as never;
}

/**
 * Static extractions for the bundled sample offer letters. Values and
 * rawQuotes are taken verbatim from the parsed text of each PDF (verified
 * against the live parser output), so request-time re-verification passes.
 */
const OFFER_A = OfferLetterExtractionSchema.parse({
  candidateName: envelope('Alice Chen', 'Alice Chen', 'high'),
  jobTitle: envelope('Senior Software Engineer', 'Senior Software Engineer', 'high'),
  baseSalary: envelope(185000, '185,000', 'high'),
  signingBonus: envelope(30000, '30,000', 'high'),
  equityValue: envelope('100,000', '100,000', 'high'),
  vestingSchedule: envelope('4 years with 1-year cliff', '4 years with 1-year cliff', 'high'),
  performanceBonus: envelope('15%', '15%', 'high'),
  ptoDays: envelope(20, '20', 'high'),
  remotePolicy: envelope('Hybrid', 'Hybrid', 'high'),
  noticePeriod: envelope('60 days', '60 days', 'high'),
  offerExpiration: envelope('2026-09-30', '2026-09-30', 'high'),
});

const OFFER_B = OfferLetterExtractionSchema.parse({
  candidateName: envelope('Bob Nguyen', 'Bob Nguyen', 'high'),
  jobTitle: envelope('Senior Software Engineer', 'Senior Software Engineer', 'high'),
  baseSalary: envelope(178000, '178,000', 'high'),
  signingBonus: envelope(25000, '25,000', 'high'),
  equityValue: envelope('80,000', '80,000', 'high'),
  vestingSchedule: envelope('4 years with 1-year cliff', '4 years with 1-year cliff', 'high'),
  performanceBonus: envelope('12%', '12%', 'high'),
  ptoDays: envelope(18, '18', 'high'),
  remotePolicy: envelope('Fully Remote', 'Fully Remote', 'high'),
  noticePeriod: envelope('30 days', '30 days', 'high'),
  offerExpiration: envelope('2026-10-15', '2026-10-15', 'high'),
});

// offer_missing_pto.pdf is the offer_a letter with the PTO line removed —
// ptoDays is deliberately absent (honest null) to exercise the null path.
const OFFER_MISSING_PTO = OfferLetterExtractionSchema.parse({
  ...OFFER_A,
  ptoDays: { value: null, rawQuote: null, pageNum: null, confidence: 'low' },
});

const STATIC_OFFER_LETTERS: Record<string, OfferLetterExtraction> = {
  'offer_a.pdf': OFFER_A,
  'offer_b.pdf': OFFER_B,
  'offer_missing_pto.pdf': OFFER_MISSING_PTO,
};

/**
 * Returns the pre-verified static extraction for a known sample document, or
 * null when the document isn't a sample (or the schema type has no static
 * payload for it — the samples are offer letters, not vendor quotes).
 */
export function staticExtractionForSample(
  fileName: string,
  schemaType: DocumentSchemaType,
): OfferLetterExtraction | null {
  if (schemaType !== 'offer_letter') return null;
  return STATIC_OFFER_LETTERS[fileName] ?? null;
}
