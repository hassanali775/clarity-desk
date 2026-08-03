// lib/extraction/extract.ts
//
// Provider-agnostic extraction entry point. The system prompt and the Zod
// schema are the contract; only the provider client differs. Default provider
// is Gemini (free tier). The Anthropic path stays fully callable via the
// EXTRACTION_PROVIDER env flag or an explicit provider argument.
//
//   EXTRACTION_PROVIDER=anthropic  -> use Claude (claude-sonnet-4-6)
//   EXTRACTION_PROVIDER=gemini     -> use Gemini (GEMINI_MODEL, default gemini-3.5-flash)
//
// The schema is the same JSON Schema in both cases:
//   - Anthropic receives it as a tool's input_schema (tool-call extraction).
//   - Gemini receives it via responseJsonSchema (structured output).
// See lib/extraction/prompt.ts for why the prompt lives apart from the clients.
import type { ParsedDocument } from '@/lib/parsers/types';
import type { DocumentSchemaType } from '@/lib/schemas/extraction';
import { extractWithAnthropic } from '@/lib/extraction/providers/anthropic';
import { extractWithGemini } from '@/lib/extraction/providers/gemini';

export { buildPageMarkedText } from '@/lib/extraction/pageText';
export { EXTRACTION_SYSTEM_PROMPT } from '@/lib/extraction/prompt';

export type ExtractionProviderName = 'gemini' | 'anthropic';

const VALID_PROVIDERS: ReadonlySet<string> = new Set(['gemini', 'anthropic']);

/**
 * Resolves the active provider from EXTRACTION_PROVIDER (default: gemini —
 * the zero-budget provider). Unknown values fall back to the default rather
 * than throwing, so a typo in a platform env var degrades to the free path.
 */
export function selectExtractionProvider(): ExtractionProviderName {
  const fromEnv = process.env.EXTRACTION_PROVIDER?.trim().toLowerCase() ?? '';
  return VALID_PROVIDERS.has(fromEnv) ? (fromEnv as ExtractionProviderName) : 'gemini';
}

/**
 * Runs one document through structured extraction against the given schema type.
 * Returns the raw (unvalidated) model output plus a parsed+validated result;
 * callers should prefer `parsed` and only fall back to `raw` for debugging/logging.
 *
 * NOTE: uses Zod 4's native z.toJSONSchema() — do NOT reintroduce the
 * zod-to-json-schema package. It ships types built for Zod 3 and doesn't
 * cleanly support Zod 4 schema objects; the native method exists specifically
 * to replace it and needs no cast, no `as never`, and one fewer dependency.
 */
export async function extractDocument(
  doc: ParsedDocument,
  schemaType: DocumentSchemaType,
  provider: ExtractionProviderName = selectExtractionProvider(),
) {
  if (provider === 'anthropic') {
    return extractWithAnthropic(doc, schemaType);
  }
  return extractWithGemini(doc, schemaType);
}
