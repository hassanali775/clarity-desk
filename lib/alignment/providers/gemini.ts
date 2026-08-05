// lib/alignment/providers/gemini.ts
//
// Gemini line-item alignment provider. Mirrors lib/extraction/providers/gemini.ts:
// same lazy client, same structured-output transport (responseJsonSchema +
// responseMimeType), and the SAME model selection (GEMINI_MODEL env, default
// gemini-3.5-flash) so one env var controls both extraction and alignment.
// Only the prompt and schema differ.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { geminiModelId } from '@/lib/extraction/providers/gemini';
import { AlignmentResultSchema, type AlignmentResult, type QuoteForAlignment } from '@/lib/alignment/schema';
import { ALIGNMENT_SYSTEM_PROMPT, buildAlignmentPrompt } from '@/lib/alignment/prompt';

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

/**
 * Runs the line-item grouping task through Gemini's structured output against
 * the same prompt + AlignmentResultSchema used by the Anthropic provider.
 * Returns the parsed result; the caller (alignLineItems) validates it
 * deterministically before trusting it.
 */
export async function alignWithGemini(quotes: QuoteForAlignment[]): Promise<AlignmentResult> {
  const response = await getClient().models.generateContent({
    model: geminiModelId(),
    contents: [{ role: 'user', parts: [{ text: buildAlignmentPrompt(quotes) }] }],
    config: {
      systemInstruction: { parts: [{ text: ALIGNMENT_SYSTEM_PROMPT }] },
      responseMimeType: 'application/json',
      responseJsonSchema: z.toJSONSchema(AlignmentResultSchema),
      maxOutputTokens: 2048,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Gemini returned an empty alignment response.');
  }

  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned non-JSON alignment output: ${JSON.stringify(text.slice(0, 500))}…`);
  }

  const parsed = AlignmentResultSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `Alignment output failed schema validation: ${parsed.error.message}\n` +
        `Raw output: ${JSON.stringify(input)}`,
    );
  }

  return parsed.data;
}
