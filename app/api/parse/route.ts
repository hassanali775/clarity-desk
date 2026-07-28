// app/api/parse/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { parsePdf } from '@/lib/parsers/pdf';
import { parseDocx } from '@/lib/parsers/docx';
import { parseXlsx } from '@/lib/parsers/xlsx';
import type { ParseResult } from '@/lib/parsers/types';

// pdfjs-dist and mammoth need Node APIs (Buffer, fs internals) — the Edge
// runtime will not work here. Keep this explicit; it's an easy thing to
// break by accident later if someone adds `runtime = 'edge'` for latency.
export const runtime = 'nodejs';

// Generous for offer letters/vendor quotes; guards against accidental huge uploads.
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx === -1 ? '' : fileName.slice(idx + 1).toLowerCase();
}

async function parseOne(file: File): Promise<ParseResult> {
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      fileName: file.name,
      error: {
        code: 'PARSE_FAILURE',
        message: `"${file.name}" exceeds the ${MAX_FILE_BYTES / (1024 * 1024)}MB limit.`,
      },
    };
  }

  const buffer = await file.arrayBuffer();
  const ext = extensionOf(file.name);

  switch (ext) {
    case 'pdf':
      return parsePdf(file.name, buffer);
    case 'docx':
      return parseDocx(file.name, buffer);
    case 'xlsx':
    case 'xls':
      return parseXlsx(file.name, buffer);
    default:
      return {
        ok: false,
        fileName: file.name,
        error: {
          code: 'UNSUPPORTED_FORMAT',
          message: `Unsupported file type ".${ext}". Supported: pdf, docx, xlsx.`,
        },
      };
  }
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data with one or more "files" entries.' },
      { status: 400 },
    );
  }

  const files = formData.getAll('files').filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: 'No files found under the "files" field.' }, { status: 400 });
  }

  // Parse concurrently, but never let one bad file take down the whole batch —
  // this is the entire reason ParseResult is a discriminated union instead of
  // something that throws. A demo with 4 good files and 1 scanned PDF should
  // still show 4 working rows, not a 500 error.
  const results = await Promise.all(files.map(parseOne));

  const succeeded = results.filter((r): r is Extract<ParseResult, { ok: true }> => r.ok);
  const failed = results.filter((r): r is Extract<ParseResult, { ok: false }> => !r.ok);

  return NextResponse.json(
    {
      documents: succeeded.map((r) => r.document),
      errors: failed.map((r) => ({ fileName: r.fileName, code: r.error.code, message: r.error.message })),
    },
    { status: succeeded.length > 0 ? 200 : 422 },
  );
}
