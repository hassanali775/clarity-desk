// lib/extraction/providers/anthropic.ts
//
// Original Anthropic extraction path, moved verbatim from lib/extraction/
// extract.ts into a provider module. Kept callable via the EXTRACTION_PROVIDER
// env flag or an explicit provider argument — never deleted.
//
// The client is created lazily so importing this module (e.g. from a test that
// mocks the provider boundary) never throws just because a key is unset.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ParsedDocument } from '@/lib/parsers/types';
import { schemaFor, type DocumentSchemaType } from '@/lib/schemas/extraction';
import { buildPageMarkedText } from '@/lib/extraction/pageText';
import { EXTRACTION_SYSTEM_PROMPT } from '@/lib/extraction/prompt';

let anthropic: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env — set in Vercel project settings, never commit it
  }
  return anthropic;
}

/**
 * Runs one document through Claude's tool-call extraction. Returns the same
 * { fileName, schemaType, parsed, raw } shape as the Gemini provider.
 */
export async function extractWithAnthropic(doc: ParsedDocument, schemaType: DocumentSchemaType) {
  const schema = schemaFor(schemaType);
  const jsonSchema = z.toJSONSchema(schema);
  const toolName = schemaType === 'offer_letter' ? 'extract_offer_letter' : 'extract_vendor_quote';

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Document: ${doc.fileName}\n\n${buildPageMarkedText(doc)}`,
      },
    ],
    tools: [
      {
        name: toolName,
        description: `Extract structured fields from a ${schemaType.replace('_', ' ')}.`,
        input_schema: jsonSchema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: toolName },
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );

  if (!toolUseBlock) {
    throw new Error(`No tool_use block returned for "${doc.fileName}" — check tool_choice and model response.`);
  }

  const parseResult = schema.safeParse(toolUseBlock.input);

  if (!parseResult.success) {
    // Surface the raw model output alongside the validation error — this is
    // the single most useful thing to log when extraction quality is bad,
    // since it tells you whether the model or the schema is wrong.
    throw new Error(
      `Extraction output for "${doc.fileName}" failed schema validation: ${parseResult.error.message}\n` +
        `Raw output: ${JSON.stringify(toolUseBlock.input)}`,
    );
  }

  return { fileName: doc.fileName, schemaType, parsed: parseResult.data, raw: toolUseBlock.input };
}
