// lib/extraction/pageText.ts
//
// Client-safe, dependency-free helper for rendering a parsed document as the
// page-marked text string that is fed to the LLM. Lives in its own module so
// the client (app/page.tsx) can compute the exact same sourceText per document
// and send it to the API for verification, WITHOUT pulling in the server-only
// Anthropic SDK that lib/extraction/extract.ts imports.
import type { ParsedDocument } from '@/lib/parsers/types';

export function buildPageMarkedText(doc: ParsedDocument): string {
  return doc.pages.map((p) => `[[PAGE ${p.pageNum}]]\n${p.text}`).join('\n\n');
}
