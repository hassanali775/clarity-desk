// lib/schemas/extraction.ts
import { z } from 'zod';

/**
 * Every extracted field carries the same envelope: the value, a verbatim
 * quote of the source text used to find it, which page/unit it came from,
 * and a confidence label. `rawQuote` + `pageNum` are what let us resolve
 * a real source location later (see lib/extraction/locate.ts) — the model
 * never outputs a bounding box or cell reference directly.
 */
const FieldEnvelope = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    rawQuote: z.string().nullable().describe('Verbatim substring copied from the source text, or null if not found.'),
    pageNum: z.number().int().nullable().describe('The pageNum this value was found on, matching ParsedPage.pageNum.'),
    confidence: z.enum(['high', 'medium', 'low']),
  });

export const OfferLetterExtractionSchema = z.object({
  candidateName: FieldEnvelope(z.string()),
  jobTitle: FieldEnvelope(z.string()),
  baseSalary: FieldEnvelope(z.number()),
  signingBonus: FieldEnvelope(z.number()),
  equityValue: FieldEnvelope(z.string()), // kept as string: "500 RSUs" vs "2,000 options" aren't directly comparable numbers
  vestingSchedule: FieldEnvelope(z.string()),
  performanceBonus: FieldEnvelope(z.string()),
  ptoDays: FieldEnvelope(z.number()),
  remotePolicy: FieldEnvelope(z.string()),
  noticePeriod: FieldEnvelope(z.string()),
  offerExpiration: FieldEnvelope(z.string()), // ISO date string; validate/parse at the UI boundary, not here
});
export type OfferLetterExtraction = z.infer<typeof OfferLetterExtractionSchema>;

const LineItemSchema = z.object({
  description: FieldEnvelope(z.string()),
  qty: FieldEnvelope(z.number()),
  unitPrice: FieldEnvelope(z.number()),
  total: FieldEnvelope(z.number()),
});

export const VendorQuoteExtractionSchema = z.object({
  vendorName: FieldEnvelope(z.string()),
  quoteReference: FieldEnvelope(z.string()),
  quoteExpiration: FieldEnvelope(z.string()),
  lineItems: z.array(LineItemSchema),
  subtotal: FieldEnvelope(z.number()),
  taxAmount: FieldEnvelope(z.number()),
  grandTotal: FieldEnvelope(z.number()),
  paymentTerms: FieldEnvelope(z.string()),
  deliverySla: FieldEnvelope(z.string()),
  warrantyPeriod: FieldEnvelope(z.string()),
});
export type VendorQuoteExtraction = z.infer<typeof VendorQuoteExtractionSchema>;

export type DocumentSchemaType = 'offer_letter' | 'vendor_quote';

export function schemaFor(type: DocumentSchemaType) {
  return type === 'offer_letter' ? OfferLetterExtractionSchema : VendorQuoteExtractionSchema;
}
