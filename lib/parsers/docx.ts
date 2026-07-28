// lib/parsers/docx.ts
import mammoth from 'mammoth';
import type { ParseResult, ParsedPage, TextRun } from './types';

/**
 * Honesty note (read this before "fixing" it to add bounding boxes):
 * DOCX has no fixed "page" concept at the file-format level — pagination
 * only exists after a rendering engine (Word, LibreOffice) lays the
 * document out, which depends on fonts, margins, and printer settings.
 * We do NOT fake page numbers or pixel coordinates here. Instead we index
 * by paragraph, which is a real, stable unit in the file format, and use
 * that as the traceability anchor. The UI's "click to highlight source"
 * feature for DOCX should highlight the matched paragraph text (e.g. via
 * a text-search/scroll-to in a rendered preview), not draw a pixel box —
 * that's a UI-layer decision, not something to fake in the parser.
 */
export async function parseDocx(fileName: string, buffer: ArrayBuffer): Promise<ParseResult> {
  let rawText: string;
  try {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    rawText = result.value;
  } catch (cause) {
    return {
      ok: false,
      fileName,
      error: { code: 'CORRUPTED_FILE', message: `Could not open "${fileName}" as a DOCX file.`, cause },
    };
  }

  const paragraphs = rawText
    .split(/\r?\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    return {
      ok: false,
      fileName,
      error: { code: 'EMPTY_DOCUMENT', message: `"${fileName}" has no extractable text.` },
    };
  }

  // Batch paragraphs into chunks purely so the LLM extraction layer gets
  // manageable input sizes — this is a chunking convenience, NOT a real
  // page number. Per-paragraph runs are preserved so traceability still
  // points to the exact paragraph, not just "somewhere in chunk 2."
  const PARAGRAPHS_PER_CHUNK = 20;
  const pages: ParsedPage[] = [];

  for (let i = 0; i < paragraphs.length; i += PARAGRAPHS_PER_CHUNK) {
    const chunk = paragraphs.slice(i, i + PARAGRAPHS_PER_CHUNK);
    const runs: TextRun[] = chunk.map((text, idx) => ({
      text,
      location: { kind: 'docx', paragraphIndex: i + idx },
    }));
    pages.push({
      pageNum: Math.floor(i / PARAGRAPHS_PER_CHUNK) + 1,
      text: chunk.join('\n'),
      runs,
    });
  }

  return { ok: true, document: { fileName, sourceFormat: 'docx', pages } };
}
