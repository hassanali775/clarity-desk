// lib/alignment/lineItems.ts
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { VendorQuoteExtraction } from '@/lib/schemas/extraction';

const anthropic = new Anthropic();

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

const SYSTEM_PROMPT = `You match line items across multiple vendor quotes that describe the
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

function buildAlignmentPrompt(quotes: QuoteForAlignment[]): string {
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

/**
 * Deterministically validates the model's alignment output against the real
 * input data: every referenced index must exist, and every real item must be
 * accounted for exactly once. This is the actual trust boundary — the LLM
 * proposes groupings, this function is the only thing that decides whether
 * they're believed.
 */
export function validate(result: AlignmentResult, quotes: QuoteForAlignment[]): AlignmentOutcome {
  const realItemCount = quotes.map((q) => q.lineItems.length);
  const seen = new Set<string>();
  let allRefsValid = true;

  const isValidRef = (ref: { quoteIndex: number; lineItemIndex: number }) => {
    const count = realItemCount[ref.quoteIndex];
    return count !== undefined && ref.lineItemIndex >= 0 && ref.lineItemIndex < count;
  };

  const markSeen = (ref: { quoteIndex: number; lineItemIndex: number }) => {
    const key = `${ref.quoteIndex}:${ref.lineItemIndex}`;
    if (!isValidRef(ref)) {
      allRefsValid = false;
      return;
    }
    if (seen.has(key)) {
      allRefsValid = false; // duplicate reference — violates the "exactly once" invariant
      return;
    }
    seen.add(key);
  };

  result.groups.forEach((g) => g.members.forEach(markSeen));
  result.unmatched.forEach(markSeen);

  const totalRealItems = realItemCount.reduce((sum, n) => sum + n, 0);
  const allItemsAccountedFor = seen.size === totalRealItems;
  const trusted = allRefsValid && allItemsAccountedFor;

  return { groups: result.groups, unmatched: result.unmatched, trusted };
}

export async function alignLineItems(quotes: QuoteForAlignment[]): Promise<AlignmentOutcome> {
  // Nothing to align with fewer than two quotes — skip the API call entirely.
  if (quotes.length < 2) {
    const unmatched = quotes.flatMap((q, quoteIndex) =>
      q.lineItems.map((_, lineItemIndex) => ({ quoteIndex, lineItemIndex })),
    );
    return { groups: [], unmatched, trusted: true };
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildAlignmentPrompt(quotes) }],
    tools: [
      {
        name: 'align_line_items',
        description: 'Group line items across quotes that refer to the same product/service.',
        input_schema: z.toJSONSchema(AlignmentResultSchema) as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'align_line_items' },
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );
  if (!toolUseBlock) {
    throw new Error('Alignment call returned no tool_use block.');
  }

  const parsed = AlignmentResultSchema.safeParse(toolUseBlock.input);
  if (!parsed.success) {
    throw new Error(`Alignment output failed schema validation: ${parsed.error.message}`);
  }

  return validate(parsed.data, quotes);
}
