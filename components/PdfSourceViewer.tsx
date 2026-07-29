// components/PdfSourceViewer.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { SourceLocation } from '@/lib/parsers/types';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface Props {
  /** The raw file the location refers to — pass the original File object
   *  (kept in memory client-side from the upload step), not a re-fetched copy. */
  file: File | null;
  location: SourceLocation | null;
}

/**
 * Renders one PDF page to a canvas and overlays the target bounding box.
 * If `location` is null or not a PDF location, shows an explicit
 * "source not verified" state instead of silently rendering nothing —
 * that distinction is the entire point of building traceability at all.
 */
export default function PdfSourceViewer({ file, location }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderScale, setRenderScale] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !location || location.kind !== 'pdf') return;
    let cancelled = false;

    async function render() {
      try {
        const buffer = await file!.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (location!.kind !== 'pdf') return;
        const page = await doc.getPage(location!.pageNum);

        // Render at a higher scale than the bbox coordinate space (which was
        // captured at scale 1 in the parser) for on-screen legibility, then
        // scale the overlay box by the same factor so it still lines up.
        const scale = 1.5;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (!cancelled) setRenderScale(scale);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render source page.');
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [file, location]);

  if (!location) {
    return (
      <div className="source-viewer source-viewer--unverified">
        <p>Source not verified — this value could not be confidently located in the original document.</p>
      </div>
    );
  }

  if (location.kind !== 'pdf') {
    // DOCX/XLSX: no pixel geometry to draw a box over (see parser design notes).
    // A simpler paragraph/cell preview belongs here instead — left as a
    // follow-up, not faked as a bounding box.
    return (
      <div className="source-viewer source-viewer--non-pdf">
        {location.kind === 'docx' && <p>Source: paragraph #{location.paragraphIndex} of the document.</p>}
        {location.kind === 'xlsx' && (
          <p>
            Source: sheet &quot;{location.sheetName}&quot;, cell {location.cellRef}.
          </p>
        )}
      </div>
    );
  }

  if (error) {
    return <div className="source-viewer source-viewer--error">Could not render source: {error}</div>;
  }

  const { bbox } = location;
  return (
    <div className="source-viewer source-viewer--pdf" style={{ position: 'relative', display: 'inline-block' }}>
      <canvas ref={canvasRef} />
      <div
        style={{
          position: 'absolute',
          left: bbox.x * renderScale,
          top: bbox.y * renderScale,
          width: bbox.width * renderScale,
          height: bbox.height * renderScale,
          border: '2px solid var(--highlight-color, #f59e0b)',
          backgroundColor: 'rgba(245, 158, 11, 0.15)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
