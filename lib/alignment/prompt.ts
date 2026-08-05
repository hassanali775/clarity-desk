// lib/alignment/prompt.ts
//
// The alignment prompt lives apart from the provider clients (same convention
// as lib/extraction/prompt.ts) because both the Gemini and Anthropic paths use
// the exact same instruction + payload — only the transport differs.
import type { QuoteForAlignment } from '@/lib/alignment/schema';

export const ALIGNMENT_SYSTEM_PROMPT = `You match line items across multiple vendor quotes that describe the
same underlying product or service, even when wording, units, or ordering differ
(e.g. "50x Widget A" and "Widget Model A, Blue, qty 50" may be the same item).

You will be given each quote's line items as a JSON array, indexed by quoteIndex
(which quote) and lineItemIndex (position within that quote's lineItems array).

Rules:
1. Only reference (quoteIndex, lineItemIndex) pairs that actually appear in the input.
   Never invent an index.
2. Every line item across every quote must appear exactly once, either inside
   a group's "members" or inside "unmatched". Do not drop items, do not
   duplicate items across groups.
3. Put an item in "unmatched" if you cannot confidently match it to anything —
   do not force a low-confidence match into a group just to avoid an unmatched item.`;

export function buildAlignmentPrompt(quotes: QuoteForAlignment[]): string {
  const payload = quotes.map((q, quoteIndex) => ({
    quoteIndex,
    fileName: q.fileName,
    lineItems: q.lineItems.map((item, lineItemIndex) => ({
      lineItemIndex,
      description: item.description.value,
      qty: item.qty.value,
      unitPrice: item.unitPrice.value,
    })),
  }));
  return JSON.stringify(payload, null, 2);
}
