// lib/parsers/pdf.ts
//
// NOTE ON RUNTIME: pdfjs-dist's default entry point assumes a browser (it wants
// a Worker + DOM canvas for rendering). In a Next.js API route running on Node,
// import the legacy Node build instead of the default one. Verify the exact path
// against your installed pdfjs-dist version — this has moved between major versions:
//   import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
// If that path 404s for your version, check node_modules/pdfjs-dist/legacy/build/.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'node:path';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { ParseResult, ParsedPage, TextRun, BoundingBox } from './types';

// No worker in a server context — pdfjs-dist falls back to running inline via
// the "fake worker", which dynamically imports the worker module. The legacy
// build's pdf.worker.mjs must be resolvable from node_modules at runtime.
// (An empty string here makes pdf.js throw "No GlobalWorkerOptions.workerSrc
// specified" — it must be a truthy module specifier.)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

// Standard 14 fonts (Helvetica etc.) have no embedded font data, so pdf.js
// needs the shipped LiberationSans metrics. Node's BinaryDataFactory reads
// these from disk with fs.readFile, which resolves relative to process.cwd().
const STANDARD_FONT_DATA_URL =
  path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/';

function itemToBoundingBox(item: TextItem, viewportHeight: number): BoundingBox {
  // item.transform = [scaleX, skewX, skewY, scaleY, translateX, translateY]
  // PDF coordinate space has its origin at the bottom-left; we flip to
  // top-left here so the UI can overlay a highlight box the same way it
  // positions any normal top-left-origin HTML/canvas element.
  const [scaleX, , , scaleY, translateX, translateY] = item.transform;
  const width = item.width ?? Math.abs(scaleX) * Math.max(item.str?.length ?? 1, 1) * 0.5;
  const height = item.height ?? Math.abs(scaleY);
  const x = translateX;
  const y = viewportHeight - translateY - height;
  return { x, y, width, height };
}

export async function parsePdf(fileName: string, buffer: ArrayBuffer): Promise<ParseResult> {
  let doc;
  try {
    // NOTE: `isEvalSupported: false` was removed from DocumentInitParameters in
    // pdfjs-dist 6.x. In Node the default is already to skip JS-in-PDF
    // evaluation (no `eval()` for embedded PDF scripts), so dropping the flag
    // is the safe default. Re-add `verbosity: 0` if PDF parser logs get noisy.
    doc = await pdfjsLib.getDocument({ data: buffer, standardFontDataUrl: STANDARD_FONT_DATA_URL }).promise;
  } catch (cause) {
    return {
      ok: false,
      fileName,
      error: { code: 'CORRUPTED_FILE', message: `Could not open "${fileName}" as a PDF.`, cause },
    };
  }

  if (doc.numPages === 0) {
    return { ok: false, fileName, error: { code: 'EMPTY_DOCUMENT', message: `"${fileName}" has no pages.` } };
  }

  const pages: ParsedPage[] = [];
  let totalChars = 0;

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();

      const runs: TextRun[] = [];
      let pageText = '';

      for (const item of textContent.items) {
        // pdf.js's TextContent items can be TextMarkedContent (no `str`) — skip those.
        if (!('str' in item) || typeof (item as TextItem).str !== 'string') continue;
        const textItem = item as TextItem;
        if (textItem.str.length === 0) continue;

        const bbox = itemToBoundingBox(textItem, viewport.height);
        runs.push({ text: textItem.str, location: { kind: 'pdf', pageNum, bbox } });
        pageText += (pageText.length > 0 ? ' ' : '') + textItem.str;
      }

      totalChars += pageText.length;
      pages.push({ pageNum, text: pageText, runs });
    } catch (cause) {
      return {
        ok: false,
        fileName,
        error: { code: 'PARSE_FAILURE', message: `Failed reading page ${pageNum} of "${fileName}".`, cause },
      };
    }
  }

  // A PDF with real pages but zero extractable characters is almost always a
  // scanned image with no text layer. OCR is explicitly out of scope for v1
  // (documented limitation in the PRD) — fail loudly and clearly instead of
  // silently returning an empty comparison row.
  if (totalChars === 0) {
    return {
      ok: false,
      fileName,
      error: {
        code: 'SCANNED_NO_TEXT_LAYER',
        message: `"${fileName}" appears to be a scanned/image PDF with no extractable text layer. OCR is not supported in v1.`,
      },
    };
  }

  return { ok: true, document: { fileName, sourceFormat: 'pdf', pages } };
}
