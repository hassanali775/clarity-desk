// lib/parsers/types.ts

/** Pixel-space bounding box on a rendered PDF page. Origin: top-left,
 *  in PDF page-space units at scale 1 (multiply by your render scale in the UI). */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where an extracted value physically came from, per source format.
 * Formats differ in what "location" even means — a discriminated union
 * keeps that honest instead of faking bounding boxes for formats that
 * don't have real page geometry (DOCX, XLSX).
 */
export type SourceLocation =
  | { kind: 'pdf'; pageNum: number; bbox: BoundingBox }
  | { kind: 'docx'; paragraphIndex: number }
  | { kind: 'xlsx'; sheetName: string; cellRef: string };

export interface TextRun {
  text: string;
  location: SourceLocation;
}

export interface ParsedPage {
  /** 1-indexed. For PDF: a real page number. For DOCX: a paragraph-batch
   *  chunk index (see docx.ts — DOCX has no native pages). For XLSX: sheet index. */
  pageNum: number;
  /** Plain concatenated text for this unit — cheap to feed into an LLM prompt. */
  text: string;
  /** Fine-grained runs with source location, for traceability lookups after extraction. */
  runs: TextRun[];
}

export type ParseErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'CORRUPTED_FILE'
  | 'SCANNED_NO_TEXT_LAYER'
  | 'EMPTY_DOCUMENT'
  | 'DOCUMENT_TOO_LARGE'
  | 'PARSE_FAILURE';

export interface ParseError {
  code: ParseErrorCode;
  message: string;
  /** Original error for server-side logging only — never serialize this to the client. */
  cause?: unknown;
}

export interface ParsedDocument {
  fileName: string;
  sourceFormat: 'pdf' | 'docx' | 'xlsx';
  pages: ParsedPage[];
}

/**
 * Every parser returns this instead of throwing, so the API route can
 * report partial success across a batch of uploaded files — one bad
 * file should never take down an entire comparison session.
 */
export type ParseResult =
  | { ok: true; document: ParsedDocument }
  | { ok: false; fileName: string; error: ParseError };
