// lib/parsers/xlsx.ts
import * as XLSX from 'xlsx';
import type { ParseResult, ParsedPage, TextRun } from './types';

/**
 * Honesty note: spreadsheets have no pixel geometry either — the natural
 * traceability unit is a cell reference (e.g. "B7" on sheet "Quote"), not
 * a bounding box. We use that as the location, and treat each non-empty
 * sheet as one "page" for chunking purposes.
 */
export async function parseXlsx(fileName: string, buffer: ArrayBuffer): Promise<ParseResult> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array' });
  } catch (cause) {
    return {
      ok: false,
      fileName,
      error: { code: 'CORRUPTED_FILE', message: `Could not open "${fileName}" as a spreadsheet.`, cause },
    };
  }

  if (workbook.SheetNames.length === 0) {
    return { ok: false, fileName, error: { code: 'EMPTY_DOCUMENT', message: `"${fileName}" has no sheets.` } };
  }

  const pages: ParsedPage[] = [];

  workbook.SheetNames.forEach((sheetName, sheetIdx) => {
    const sheet = workbook.Sheets[sheetName];
    const ref = sheet['!ref'];
    if (!ref) return; // genuinely empty sheet — common in vendor templates with unused tabs

    const range = XLSX.utils.decode_range(ref);
    const runs: TextRun[] = [];
    const textParts: string[] = [];

    for (let row = range.s.r; row <= range.e.r; row++) {
      const rowParts: string[] = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = sheet[cellRef];
        if (!cell || cell.v === undefined || cell.v === null || cell.v === '') continue;
        const text = String(cell.v);
        rowParts.push(text);
        runs.push({ text, location: { kind: 'xlsx', sheetName, cellRef } });
      }
      if (rowParts.length > 0) textParts.push(rowParts.join(' | '));
    }

    if (runs.length === 0) return; // sheet had a !ref but every cell in range was blank

    pages.push({ pageNum: sheetIdx + 1, text: textParts.join('\n'), runs });
  });

  if (pages.length === 0) {
    return { ok: false, fileName, error: { code: 'EMPTY_DOCUMENT', message: `"${fileName}" has no non-empty sheets.` } };
  }

  return { ok: true, document: { fileName, sourceFormat: 'xlsx', pages } };
}
