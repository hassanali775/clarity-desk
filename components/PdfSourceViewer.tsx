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
  const containerRef = useRef<HTMLDivElement>(null);
  const [userZoom, setUserZoom] = useState<number>(1.0);
  const [renderScale, setRenderScale] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [resizeTick, setResizeTick] = useState<number>(0);

  // Re-render the page whenever its container resizes. The canvas is rendered
  // at exactly its displayed pixel size, so the highlight overlay must be
  // redrawn with it to keep a 1:1 mapping onto the visible glyphs.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setResizeTick((t) => t + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!file || !location || location.kind !== 'pdf') return;
    let cancelled = false;

    async function render() {
      setIsLoading(true);
      setError(null);

      try {
        const buffer = await file!.arrayBuffer();
        if (cancelled) return;

        const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (cancelled || location!.kind !== 'pdf') return;

        const page = await doc.getPage(location!.pageNum);
        if (cancelled) return;

        // Render the page at a scale that fits the container width at zoom=1.0,
        // then multiply by the user's zoom. The canvas is rendered at exactly
        // its displayed pixel size (no CSS downscaling), so the overlay below
        // maps 1:1 onto the visible glyphs instead of drifting off them.
        const pageWidth = page.getViewport({ scale: 1 }).width;
        const availableWidth = Math.max(120, (containerRef.current?.clientWidth ?? 800) - 40);
        const fitScale = Math.max(0.2, availableWidth / pageWidth);
        const effectiveScale = fitScale * userZoom;
        const viewport = page.getViewport({ scale: effectiveScale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx || cancelled) return;

        await page.render({
          canvasContext: ctx,
          viewport,
          canvas,
        }).promise;

        if (!cancelled) {
          setRenderScale(effectiveScale);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render source page.');
          setIsLoading(false);
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [file, location, userZoom, resizeTick]);

  return (
    <div className="flex flex-col bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl text-slate-200 w-full h-full min-h-[500px]">
      {/* Header Status Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950/80 border-b border-slate-800 text-xs font-medium">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-slate-300 font-mono truncate max-w-[180px]" title={file?.name ?? 'No File'}>
            {file?.name ?? 'No File Loaded'}
          </span>
        </div>

        {/* Verification Status Pill */}
        {!location ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800/80 text-slate-400 border border-slate-700/50 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
            Source Not Located
          </span>
        ) : location.kind === 'pdf' ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Verified (Page {location.pageNum})
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Verified ({location.kind.toUpperCase()})
          </span>
        )}
      </div>

      {/* Main Canvas Body */}
      <div ref={containerRef} className="relative flex-1 overflow-auto bg-slate-950/50 p-4 flex items-center justify-center min-h-[400px]">
        {!location ? (
          <div className="flex flex-col items-center justify-center p-8 text-center max-w-sm">
            <div className="w-12 h-12 rounded-full bg-slate-800/60 border border-slate-700 flex items-center justify-center mb-3 text-slate-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h4 className="text-sm font-semibold text-slate-200 mb-1">Source Not Verified</h4>
            <p className="text-xs text-slate-400">
              This value could not be confidently bound to exact source coordinates in the original document.
            </p>
          </div>
        ) : location.kind !== 'pdf' ? (
          <div className="flex flex-col items-center justify-center p-8 text-center max-w-sm">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-3 text-amber-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h4 className="text-sm font-semibold text-slate-200 mb-1">Non-PDF Source Document</h4>
            {location.kind === 'docx' && (
              <p className="text-xs text-slate-300 bg-slate-900 border border-slate-800 p-3 rounded-lg font-mono">
                Source: Paragraph #{location.paragraphIndex}
              </p>
            )}
            {location.kind === 'xlsx' && (
              <p className="text-xs text-slate-300 bg-slate-900 border border-slate-800 p-3 rounded-lg font-mono">
                Source: Sheet &quot;{location.sheetName}&quot;, Cell {location.cellRef}
              </p>
            )}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center p-8 text-center max-w-sm">
            <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mb-3 text-rose-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-xs text-rose-400 font-medium">{error}</p>
          </div>
        ) : (
          <div className="relative inline-block border border-slate-800 shadow-2xl rounded overflow-hidden">
            {isLoading && (
              <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-10">
                <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            <canvas ref={canvasRef} className="block" />
            <div
              style={{
                position: 'absolute',
                left: location.bbox.x * renderScale,
                // The parse-time bbox is the font's em box (baseline − font size
                // → baseline), which leaves whitespace above the caps and floats
                // above the visible glyph ink. Shift the box down ~20% of the
                // line height and trim the same margin so it hugs the rendered
                // characters (ascenders → descenders) instead of hovering over
                // the empty line above them.
                top: (location.bbox.y + location.bbox.height * 0.2) * renderScale,
                width: location.bbox.width * renderScale,
                height: location.bbox.height * 0.9 * renderScale,
              }}
              className="border-2 border-amber-500 bg-amber-500/20 shadow-[0_0_12px_rgba(245,158,11,0.4)] pointer-events-none rounded-xs transition-all duration-200"
            />
          </div>
        )}
      </div>

      {/* Footer Canvas Controls */}
      {location?.kind === 'pdf' && !error && (
        <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-t border-slate-800 text-xs">
          <span className="text-slate-400 font-mono">
            Zoom: {Math.round(userZoom * 100)}%
          </span>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setUserZoom((z) => Math.max(0.75, z - 0.25))}
              className="p-1 rounded hover:bg-slate-800 text-slate-300 disabled:opacity-40 transition-colors cursor-pointer"
              title="Zoom Out"
              disabled={userZoom <= 0.75}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
            </button>
            <button
              onClick={() => setUserZoom(1.0)}
              className="px-2 py-0.5 rounded hover:bg-slate-800 text-slate-300 font-mono text-[11px] transition-colors cursor-pointer"
              title="Reset Zoom"
            >
              100%
            </button>
            <button
              onClick={() => setUserZoom((z) => Math.min(2.5, z + 0.25))}
              className="p-1 rounded hover:bg-slate-800 text-slate-300 disabled:opacity-40 transition-colors cursor-pointer"
              title="Zoom In"
              disabled={userZoom >= 2.5}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

