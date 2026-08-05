// lib/alignment/providers/anthropic.ts
//
// Original Anthropic line-item alignment path, moved verbatim out of
// lib/alignment/lineItems.ts into a provider module. Kept callable via the
// EXTRACTION_PROVIDER=anthropic flag — the same env var that selects the
// extraction provider (see lib/alignment/lineItems.ts).
//
// The client is created lazily so importing this module never throws just
// because a key is unset.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AlignmentResultSchema, type AlignmentResult, type QuoteForAlignment } from '@/lib/alignment/schema';
import { ALIGNMENT_SYSTEM_PROMPT, buildAlignmentPrompt } from '@/lib/alignment/prompt';

let anthropic: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env — set in Vercel project settings, never commit it
  }
  return anthropic;
}

/**
 * Runs the line-item grouping task through Claude's tool-call transport against
 * the same prompt + AlignmentResultSchema used by the Gemini provider. Returns
 * the parsed result; the caller (alignLineItems) validates it deterministically.
 */
export async function alignWithAnthropic(quotes: QuoteForAlignment[]): Promise<AlignmentResult> {
  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: ALIGNMENT_SYSTEM_PROMPT,
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

  return parsed.data;
}
