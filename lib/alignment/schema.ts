// lib/alignment/schema.ts
//
// Contract for the line-item alignment layer: the Zod schema that validates a
// model's grouping output plus the shared types. Both providers
// (lib/alignment/providers/*) validate against this same schema, mirroring how
// the extraction layer shares one schema between its Gemini and Anthropic paths.
import { z } from 'zod';
import type { VendorQuoteExtraction } from '@/lib/schemas/extraction';

const ItemRef = z.object({ quoteIndex: z.number().int(), lineItemIndex: z.number().int() });

const AlignmentResultSchema = z.object({
  groups: z.array(
    z.object({
      canonicalDescription: z.string(),
      members: z.array(ItemRef),
    }),
  ),
  unmatched: z.array(ItemRef),
});

type AlignmentResult = z.infer<typeof AlignmentResultSchema>;

/** One vendor quote's worth of line items, fed to the alignment prompt. */
export interface QuoteForAlignment {
  fileName: string;
  lineItems: VendorQuoteExtraction['lineItems'];
}

export interface AlignedGroup {
  canonicalDescription: string;
  members: { quoteIndex: number; lineItemIndex: number }[];
}

export interface AlignmentOutcome {
  groups: AlignedGroup[];
  unmatched: { quoteIndex: number; lineItemIndex: number }[];
  /** True only when every real line item was accounted for exactly once.
   *  If false, callers should treat `groups` as untrustworthy and fall
   *  back to showing items unaligned rather than displaying a broken grouping. */
  trusted: boolean;
}

export { ItemRef, AlignmentResultSchema };
export type { AlignmentResult };
