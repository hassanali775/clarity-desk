// app/page.tsx
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { ParsedDocument, SourceLocation } from '@/lib/parsers/types';
import type { OfferLetterExtraction, VendorQuoteExtraction, DocumentSchemaType } from '@/lib/schemas/extraction';
import type { MathDiscrepancy } from '@/lib/validation/mathCheck';

const ComparisonTable = dynamic(
  () => import('@/components/ComparisonTable').then((mod) => mod.ComparisonTable),
  { ssr: false }
);

// Explicit dynamic import of PdfSourceViewer with ssr: false for client-only evaluation
export const PdfSourceViewer = dynamic(
  () => import('@/components/PdfSourceViewer'),
  { ssr: false }
);

interface DocResult {
  fileName: string;
  extraction: OfferLetterExtraction | VendorQuoteExtraction;
  locations: Record<string, SourceLocation | null>;
  mathDiscrepancies?: MathDiscrepancy[];
}

interface AlignmentOutcome {
  groups: { canonicalDescription: string; members: { quoteIndex: number; lineItemIndex: number }[] }[];
  unmatched: { quoteIndex: number; lineItemIndex: number }[];
  trusted: boolean;
}

type Stage = 'idle' | 'parsing' | 'extracting' | 'done' | 'error';

const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;

async function readErrorResponse(res: Response): Promise<string> {
  const text = await res.text();
  if (res.status === 413 || text.trimStart().startsWith('<')) {
    return 'Server limit reached (413). Please upload a smaller document.';
  }
  try {
    const body = JSON.parse(text) as { message?: string; error?: string };
    return body.message ?? body.error ?? `Request failed with status ${res.status}.`;
  } catch {
    return `Request failed with status ${res.status}.`;
  }
}

export default function Home() {
  const [schemaType, setSchemaType] = useState<DocumentSchemaType>('offer_letter');
  const [files, setFiles] = useState<Record<string, File>>({});
  const [stage, setStage] = useState<Stage>('idle');
  const [results, setResults] = useState<DocResult[]>([]);
  const [alignment, setAlignment] = useState<AlignmentOutcome | null>(null);
  const [errors, setErrors] = useState<{ fileName: string; message: string }[]>([]);

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    const selectedFiles = Array.from(fileList);
    const oversized = selectedFiles.filter((f) => f.size > MAX_FILE_SIZE_BYTES);
    if (oversized.length > 0) {
      setErrors(
        oversized.map((f) => ({ fileName: f.name, message: 'File exceeds 4MB limit for serverless processing.' }))
      );
      setStage('error');
      return;
    }
    const fileMap: Record<string, File> = {};
    selectedFiles.forEach((f) => (fileMap[f.name] = f));
    setFiles(fileMap);
    setErrors([]);
    setResults([]);
    setAlignment(null);

    // Step 1: parse
    setStage('parsing');
    const formData = new FormData();
    selectedFiles.forEach((f) => formData.append('files', f));

    let parsedDocuments: ParsedDocument[];
    try {
      const parseRes = await fetch('/api/parse', { method: 'POST', body: formData });
      if (!parseRes.ok) {
        const message = await readErrorResponse(parseRes);
        setErrors((prev) => [...prev, { fileName: '(parse)', message }]);
        setStage('error');
        return;
      }
      const parseBody = await parseRes.json();
      parsedDocuments = parseBody.documents ?? [];
      if (parseBody.errors?.length) {
        setErrors((prev) => [...prev, ...parseBody.errors]);
      }
      if (parsedDocuments.length === 0) {
        setStage('error');
        return;
      }
    } catch (err) {
      setErrors((prev) => [...prev, { fileName: '(parse)', message: err instanceof Error ? err.message : String(err) }]);
      setStage('error');
      return;
    }

    // Step 2: extract + align
    setStage('extracting');
    try {
      const extractRes = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: parsedDocuments, schemaType }),
      });
      if (!extractRes.ok) {
        const message = await readErrorResponse(extractRes);
        setErrors((prev) => [...prev, { fileName: '(extract)', message }]);
        setStage('error');
        return;
      }
      const extractBody = await extractRes.json();
      setResults(extractBody.results ?? []);
      setAlignment(extractBody.alignment ?? null);
      if (extractBody.errors?.length) {
        setErrors((prev) => [...prev, ...extractBody.errors]);
      }
      setStage('done');
    } catch (err) {
      setErrors((prev) => [...prev, { fileName: '(extract)', message: err instanceof Error ? err.message : String(err) }]);
      setStage('error');
    }
  }

  const selectedFileNames = Object.keys(files);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans selection:bg-amber-500/30">
      {/* Top Header Navigation */}
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shadow-xs text-slate-950 font-bold text-lg">
              C
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  ClarityDesk
                </h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Audit Engine v2.0
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Precision Document Comparison, Mathematical Audit & Traceable Citations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700">
              PDF / DOCX / XLSX
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-8">
        {/* Upload & Control Card */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs flex flex-col gap-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                1. Select Document Schema
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Choose the target extraction schema for comparative audit.
              </p>
            </div>

            {/* Schema Selector Tabs */}
            <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSchemaType('offer_letter')}
                className={`px-4 py-2 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                  schemaType === 'offer_letter'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs border border-slate-200/80 dark:border-slate-700'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                💼 Job Offer Letters
              </button>
              <button
                type="button"
                onClick={() => setSchemaType('vendor_quote')}
                className={`px-4 py-2 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                  schemaType === 'vendor_quote'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs border border-slate-200/80 dark:border-slate-700'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                📊 Vendor Quotations
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                2. Upload Documents for Comparison
              </h2>
              {selectedFileNames.length > 0 && (
                <span className="text-xs font-mono text-slate-500">
                  {selectedFileNames.length} file{selectedFileNames.length > 1 ? 's' : ''} loaded
                </span>
              )}
            </div>

            {/* File Upload Dropzone */}
            <label className="relative flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-amber-500 dark:hover:border-amber-500 bg-slate-50/50 dark:bg-slate-950/40 rounded-xl p-8 transition-all cursor-pointer group">
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.xlsx,.xls"
                onChange={(e) => handleFilesSelected(e.target.files)}
                className="sr-only"
                disabled={stage === 'parsing' || stage === 'extracting'}
              />
              <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 mb-3 group-hover:scale-110 transition-transform">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 0115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Drop PDF, DOCX, or XLSX files here, or <span className="text-amber-500 underline underline-offset-2">browse</span>
              </p>
              <p className="text-xs text-slate-400 font-mono">
                Select 2 or more files to compare side-by-side with full citation verification
              </p>
            </label>

            {/* Uploaded File Chips */}
            {selectedFileNames.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                {selectedFileNames.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-700 dark:text-slate-300"
                  >
                    <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Processing Indicator Banner */}
        {(stage === 'parsing' || stage === 'extracting') && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {stage === 'parsing' ? 'Parsing Document Structures…' : 'Executing LLM Extraction & Math Verification…'}
                </h3>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {stage === 'parsing'
                    ? 'Extracting fine-grained text runs and source locations from PDF / DOCX / XLSX files.'
                    : 'Running structured field extraction, resolving bounding-box citations, and validating arithmetic integrity.'}
                </p>
              </div>
            </div>

            {/* Stepper */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-amber-500/20 text-xs">
              <div className={`flex items-center gap-1.5 font-mono ${stage === 'parsing' ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-slate-400'}`}>
                <span>1. Structure Parse</span>
              </div>
              <div className={`flex items-center gap-1.5 font-mono ${stage === 'extracting' ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-slate-400'}`}>
                <span>2. AI Extraction & Math</span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-slate-400">
                <span>3. Alignment & Citation</span>
              </div>
            </div>
          </div>
        )}

        {/* Error Callout Banner */}
        {errors.length > 0 && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-700 dark:text-rose-400 text-xs">
            <div className="flex items-center gap-2 font-semibold mb-2">
              <svg className="w-4 h-4 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Document Processing Issue Detected:</span>
            </div>
            <ul className="list-disc pl-5 space-y-1 font-mono">
              {errors.map((e, i) => (
                <li key={i}>
                  <strong className="font-semibold">{e.fileName}:</strong> {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Results Audit Dashboard Table */}
        {stage === 'done' && results.length > 0 && (
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Audit Comparison & Traceability Dashboard
              </h2>
              <span className="text-xs font-mono text-slate-500">
                {results.length} Document{results.length > 1 ? 's' : ''} Analyzed
              </span>
            </div>

            <ComparisonTable
              schemaType={schemaType}
              results={results}
              alignment={alignment}
              files={files}
            />
          </section>
        )}

        {stage === 'done' && results.length === 0 && (
          <div className="p-8 text-center bg-slate-100 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 text-xs">
            No documents could be successfully extracted. Please review the error list above or try uploading again.
          </div>
        )}
      </main>
    </div>
  );
}

