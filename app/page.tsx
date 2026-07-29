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

  return (
    <main style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto' }}>
      <h1>ClarityDesk</h1>
      <p>Upload documents to extract, verify, and compare them side by side.</p>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', margin: '1rem 0' }}>
        <label>
          Document type:{' '}
          <select value={schemaType} onChange={(e) => setSchemaType(e.target.value as DocumentSchemaType)}>
            <option value="offer_letter">Job offer letters</option>
            <option value="vendor_quote">Vendor quotations</option>
          </select>
        </label>
        <input
          type="file"
          multiple
          accept=".pdf,.docx,.xlsx,.xls"
          onChange={(e) => handleFilesSelected(e.target.files)}
        />
      </div>

      {stage === 'parsing' && <p>Parsing documents…</p>}
      {stage === 'extracting' && <p>Extracting and comparing — this calls the LLM once per document, please wait…</p>}

      {errors.length > 0 && (
        <div className="error-list" style={{ background: '#fef2f2', border: '1px solid #fca5a5', padding: '0.75rem', margin: '1rem 0' }}>
          <strong>Some documents had issues:</strong>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>
                {e.fileName}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stage === 'done' && results.length > 0 && (
        <ComparisonTable schemaType={schemaType} results={results} alignment={alignment} files={files} />
      )}

      {stage === 'done' && results.length === 0 && <p>No documents could be extracted — see errors above.</p>}
    </main>
  );
}
