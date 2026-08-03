// lib/extraction/providers/gemini.ts
//
// Gemini extraction provider. Uses the official @google/genai SDK directly
// (rather than the Vercel AI SDK's Google provider) for two reasons:
//
//  1. Symmetry with the existing Anthropic path, which also uses the vendor
//     SDK directly — two direct clients, one shared system prompt + schema.
//  2. Raw-response observability. This task's whole point is to inspect what
//     the model actually returned and run it through the verification layer.
//     The direct SDK exposes response.text verbatim and the exact HTTP error
//     shape; the AI SDK layers its own conversion/retry machinery on top,
//     which obscures exactly what was sent to and received from the API.
//
// Structured output uses `responseJsonSchema` (not `responseSchema`): it
// accepts a full JSON Schema and supports anyOf / minimum / maximum /
// additionalProperties — the exact constructs Zod 4's z.toJSONSchema()
// emits for the nullable FieldEnvelope contract. The schema IS the same
// JSON Schema passed to Anthropic's tool input_schema; only the transport
// differs.
//
// Model selection: `gemini-1.5-flash` is RETIRED (404 NOT_FOUND on the API
// as of Aug 2026), and `gemini-2.5-flash` / `gemini-2.5-flash-lite` are no
// longer available to new users. The free-tier Flash successor that still
// serves this key is `gemini-3.5-flash`. Override via GEMINI_MODEL env.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { ParsedDocument } from '@/lib/parsers/types';
import { schemaFor, type DocumentSchemaType } from '@/lib/schemas/extraction';
import { buildPageMarkedText } from '@/lib/extraction/pageText';
import { EXTRACTION_SYSTEM_PROMPT } from '@/lib/extraction/prompt';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set — add it to .env.local or your platform env.');
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export function geminiModelId(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

/**
 * Runs one document through Gemini's structured-output extraction against the
 * same schema + system prompt used by the Anthropic provider. Returns the same
 * { fileName, schemaType, parsed, raw } shape so callers are provider-agnostic.
 */
export async function extractWithGemini(doc: ParsedDocument, schemaType: DocumentSchemaType) {
  const schema = schemaFor(schemaType);

  const response = await getClient().models.generateContent({
    model: geminiModelId(),
    contents: [
      {
        role: 'user',
        parts: [{ text: `Document: ${doc.fileName}\n\n${buildPageMarkedText(doc)}` }],
      },
    ],
    config: {
      systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
      responseMimeType: 'application/json',
      responseJsonSchema: z.toJSONSchema(schema),
      maxOutputTokens: 8192,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error(`Gemini returned an empty response for "${doc.fileName}".`);
  }

  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error(
      `Gemini returned non-JSON output for "${doc.fileName}": ${JSON.stringify(text.slice(0, 500))}…`,
    );
  }

  const parseResult = schema.safeParse(input);
  if (!parseResult.success) {
    // Same diagnostic convention as the Anthropic path: surface the raw model
    // output next to the validation error so you can tell model-vs-schema.
    throw new Error(
      `Extraction output for "${doc.fileName}" failed schema validation: ${parseResult.error.message}\n` +
        `Raw output: ${JSON.stringify(input)}`,
    );
  }

  return { fileName: doc.fileName, schemaType, parsed: parseResult.data, raw: input };
}
