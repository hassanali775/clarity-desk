// components/DemoModeBanner.tsx
//
// Visible indicator for degraded-mode fallback results. Rendered whenever the
// API marked a response demoMode: true (i.e. live extraction was rate-limited
// and a pre-verified static sample payload was served instead). Must be
// impossible to mistake for a live extraction — a real user reading this
// banner knows the numbers below are NOT their document's data.
//
// `banner` = full-width callout above the results dashboard (app/page.tsx).
// `badge`  = compact pill inside the table header (ComparisonTable.tsx).
export function DemoModeBanner({ variant = 'banner' }: { variant?: 'banner' | 'badge' }) {
  if (variant === 'badge') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/40">
        <span aria-hidden="true">⚠</span>
        Static Example
      </span>
    );
  }

  return (
    <div
      role="alert"
      className="w-full bg-amber-500/10 border-2 border-amber-500/50 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
    >
      <div className="shrink-0 w-9 h-9 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center font-bold text-base">
        ⚠
      </div>
      <div className="flex-1">
        <h3 className="text-sm font-bold text-amber-900 dark:text-amber-300">
          Showing a static example — live extraction is rate-limited right now
        </h3>
        <p className="text-xs text-amber-800/90 dark:text-amber-400/90 mt-0.5 max-w-2xl">
          The comparison below is a pre-verified sample document, not a live extraction of your upload.
          It is shown so the audit view keeps working during the outage. Retry shortly, or upload a different
          document, to get live extraction results.
        </p>
      </div>
      <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 bg-slate-950/10 dark:bg-slate-950/50 border border-amber-500/40">
        Demo data — not live
      </span>
    </div>
  );
}
