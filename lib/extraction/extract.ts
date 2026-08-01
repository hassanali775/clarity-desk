// lib/extraction/extract.ts
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ParsedDocument } from '@/lib/parsers/types';
import { schemaFor, type DocumentSchemaType } from '@/lib/schemas/extraction';
import { buildPageMarkedText } from '@/lib/extraction/pageText';

export { buildPageMarkedText } from '@/lib/extraction/pageText';

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env — set in Vercel project settings, never commit it

export const EXTRACTION_SYSTEM_PROMPT = `You extract structured data from a single document's text.

Rules you must follow exactly:
1. For every field, if you use a value, you MUST also copy the exact verbatim
   substring from the source text into "rawQuote" and the page number it came
   from into "pageNum". Never invent a rawQuote that doesn't appear in the text.
2. If a field is genuinely not present in the document, set "value" to null,
   "rawQuote" to null, "pageNum" to null, and "confidence" to "low". Do not guess
   a plausible-sounding value to fill the field — an honest null beats a wrong number.
3. "confidence" reflects how directly the source text states the value:
   - "high": stated explicitly and unambiguously
   - "medium": inferred from context or requires minor interpretation
   - "low": guessed, ambiguous, or absent
4. Numbers must be plain numbers with currency symbols and thousands separators
   stripped (e.g. "$120,000" becomes 120000).`;

/**
 * Runs one document through structured extraction against the given schema type.
 * Returns the raw (unvalidated) tool-call input plus a parsed+validated result;
 * callers should prefer `parsed` and only fall back to `raw` for debugging/logging.
 *
 * NOTE: uses Zod 4's native z.toJSONSchema() — do NOT reintroduce the
 * zod-to-json-schema package. It ships types built for Zod 3 and doesn't
 * cleanly support Zod 4 schema objects; the native method exists specifically
 * to replace it and needs no cast, no `as never`, and one fewer dependency.
 */
export async function extractDocument(doc: ParsedDocument, schemaType: DocumentSchemaType) {
  const schema = schemaFor(schemaType);
  const jsonSchema = z.toJSONSchema(schema);
  const toolName = schemaType === 'offer_letter' ? 'extract_offer_letter' : 'extract_vendor_quote';

  const response = await anthropic.messages.create({
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
