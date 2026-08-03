// components/ComparisonTable.tsx
'use client';

import { useState } from 'react';
import type { SourceLocation } from '@/lib/parsers/types';
import type { OfferLetterExtraction, VendorQuoteExtraction, DocumentSchemaType } from '@/lib/schemas/extraction';
import type { MathDiscrepancy } from '@/lib/validation/mathCheck';
import type { FlaggedField } from '@/lib/extraction/verifier';
import { DemoModeBanner } from '@/components/DemoModeBanner';
import dynamic from 'next/dynamic';

const PdfSourceViewer = dynamic(() => import('./PdfSourceViewer'), { ssr: false });

interface DocResult {
  fileName: string;
  trusted: boolean;
  flaggedFields: FlaggedField[];
  extractions: OfferLetterExtraction | VendorQuoteExtraction;
  locations: Record<string, SourceLocation | null>;
  mathDiscrepancies?: MathDiscrepancy[];
  /** Where this result's data came from; `static-fallback` implies demoMode. */
  source?: 'live' | 'static-fallback';
}

interface AlignmentOutcome {
  groups: { canonicalDescription: string; members: { quoteIndex: number; lineItemIndex: number }[] }[];
  unmatched: { quoteIndex: number; lineItemIndex: number }[];
  trusted: boolean;
}

interface Props {
  schemaType: DocumentSchemaType;
  results: DocResult[];
  alignment: AlignmentOutcome | null;
  /** Original uploaded files, keyed by fileName, so the source viewer can
   *  re-render the exact PDF the location refers to. */
  files: Record<string, File>;
  /** True when the API served pre-verified static sample data because live
   *  extraction was rate-limited. Renders a prominent "not live data" banner. */
  demoMode?: boolean;
}

const OFFER_LETTER_FIELDS: (keyof OfferLetterExtraction)[] = [
  'candidateName', 'jobTitle', 'baseSalary', 'signingBonus', 'equityValue',
  'vestingSchedule', 'performanceBonus', 'ptoDays', 'remotePolicy',
  'noticePeriod', 'offerExpiration',
];

const VENDOR_TOP_FIELDS: (keyof VendorQuoteExtraction)[] = [
  'vendorName', 'quoteReference', 'quoteExpiration', 'subtotal',
  'taxAmount', 'grandTotal', 'paymentTerms', 'deliverySla', 'warrantyPeriod',
];

function formatFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    candidateName: 'Candidate Name',
    jobTitle: 'Job Title',
    baseSalary: 'Base Salary',
    signingBonus: 'Signing Bonus',
    equityValue: 'Equity Value',
    vestingSchedule: 'Vesting Schedule',
    performanceBonus: 'Performance Bonus',
    ptoDays: 'PTO Days',
    remotePolicy: 'Remote Policy',
    noticePeriod: 'Notice Period',
    offerExpiration: 'Offer Expiration',
    vendorName: 'Vendor Name',
    quoteReference: 'Quote Reference',
    quoteExpiration: 'Quote Expiration',
    subtotal: 'Subtotal',
    taxAmount: 'Tax Amount',
    grandTotal: 'Grand Total',
    paymentTerms: 'Payment Terms',
    deliverySla: 'Delivery SLA',
    warrantyPeriod: 'Warranty Period',
  };
  return labels[field] ?? field.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
}

function fieldValue(extraction: Record<string, unknown>, field: string): unknown {
  const envelope = extraction[field] as { value: unknown } | undefined;
  return envelope?.value ?? null;
}

function isNumericValue(value: unknown): boolean {
  return typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()));
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  return String(value);
}

/**
 * Normalizes a flagged fieldPath to dot notation so paths produced by the
 * verifier (lineItems[0].total) match the UI's dotted lookup keys
 * (lineItems.0.total). Top-level field paths (baseSalary) pass through
 * unchanged.
 */
function canonicalizeFieldPath(path: string): string {
  return path.replace(/\[(\d+)\]/g, '.$1');
}

/**
 * Builds a stable, selector-safe id for a flag's disclosure panel.
 */
function flagPanelId(key: string): string {
  return `flag-panel-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/**
 * Toggleable flag badge. A real <button> so the flag's reason + message are
 * reachable on touch/mobile (hover-only `title` is kept as a desktop
 * enhancement). Clicking/tapping expands an inline panel — inline expansion
 * is preferred over a CSS popover because the table lives inside an
 * `overflow-x-auto` container that would clip an absolutely-positioned
 * popover, and inline avoids viewport-edge issues on small screens.
 */
function FlagBadge({
  flag,
  dataField,
  panelId,
  open,
  onToggle,
}: {
  flag: FlaggedField;
  dataField: string;
  panelId: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        data-field={dataField}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        title={`${flag.reason}: ${flag.message}`}
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 dark:text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20 cursor-pointer hover:bg-rose-500/20 transition-colors"
      >
        <span aria-hidden="true">⚠</span>
        <span>Needs Review</span>
        <svg
          aria-hidden="true"
          className={`w-2.5 h-2.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div
          id={panelId}
          className="mt-0.5 text-[11px] text-slate-700 dark:text-slate-300 bg-rose-500/5 border border-rose-500/20 rounded p-2 max-w-[260px]"
        >
          <div className="font-semibold text-rose-700 dark:text-rose-400">{flag.reason}</div>
          <div className="mt-0.5">{flag.message}</div>
          {flag.rawQuote && (
            <div className="mt-1 font-mono text-[10px] text-slate-500 dark:text-slate-400 border-l-2 border-rose-500/40 pl-2">
              Document: “{flag.rawQuote}”
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ComparisonTable({ schemaType, results, alignment, files, demoMode = false }: Props) {
  const [selected, setSelected] = useState<{ fileName: string; location: SourceLocation | null } | null>(null);
  const [openFlag, setOpenFlag] = useState<string | null>(null);

  const topFields = schemaType === 'offer_letter' ? OFFER_LETTER_FIELDS : VENDOR_TOP_FIELDS;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full">
      {/* Audit Table Section */}
      <div className="lg:col-span-7 xl:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden flex flex-col">
        {demoMode && (
          <div className="border-b border-amber-500/40 bg-slate-50/80 dark:bg-slate-950/60 p-3">
            <DemoModeBanner variant="badge" />
            <p className="mt-1.5 text-[11px] text-amber-700/90 dark:text-amber-400/90 max-w-prose">
              Live extraction is rate-limited right now, so these rows show the pre-verified sample document —
              this is not live data from your upload.
            </p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            {/* Sticky Header Row */}
            <thead className="sticky top-0 z-10 bg-slate-100/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300 w-44 shrink-0 bg-slate-100/90 dark:bg-slate-900/90">
                  Audit Metric
                </th>
                {results.map((r) => {
                  const hasDiscrepancies = r.mathDiscrepancies && r.mathDiscrepancies.length > 0;
                  return (
                    <th key={r.fileName} className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200 min-w-[200px]">
                      <div className="flex flex-col gap-1">
                        <span className="font-mono text-xs truncate max-w-[180px]" title={r.fileName}>
                          {r.fileName}
                        </span>
                        {!r.trusted && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-700 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full">
                            ⚠ Needs Review
                          </span>
                        )}
                        {schemaType === 'vendor_quote' && r.mathDiscrepancies && (
                          <div>
                            {hasDiscrepancies ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-700 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full">
                                ⚠ {r.mathDiscrepancies.length} Math {r.mathDiscrepancies.length > 1 ? 'Mismatches' : 'Mismatch'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                                ✓ Math Verified
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-900 dark:text-slate-100">
              {/* Top-Level Fields */}
              {topFields.map((field) => (
                <tr key={field} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/50 transition-colors">
                  <td className="py-3 px-4 font-medium text-slate-600 dark:text-slate-400 bg-slate-50/30 dark:bg-slate-900/30">
                    {formatFieldLabel(field)}
                  </td>
                  {results.map((r) => {
                    const location = r.locations[field] ?? null;
                    const val = fieldValue(r.extractions as Record<string, unknown>, field);
                    const isSelected = selected?.fileName === r.fileName && selected?.location === location && location !== null;
                    const numeric = isNumericValue(val);
                    const flag = r.flaggedFields.find((f) => canonicalizeFieldPath(f.fieldPath) === field);

                    return (
                      <td key={r.fileName} className="py-3 px-4 align-top">
                        <div className="flex flex-col gap-1 items-start">
                          {location ? (
                            <button
                              type="button"
                              onClick={() => setSelected({ fileName: r.fileName, location })}
                              className={`group relative text-left inline-flex items-center gap-1.5 rounded transition-colors cursor-pointer ${
                                isSelected
                                  ? 'text-amber-900 dark:text-amber-200 font-medium'
                                  : 'text-slate-900 dark:text-slate-100'
                              }`}
                              title={
                                flag
                                  ? `${flag.reason}: ${flag.message}`
                                  : 'Click cell target to inspect PDF citation source'
                              }
                            >
                              <span
                                className={`inline-block leading-none rounded-[3px] px-1 border-b-2 transition-colors ${
                                  isSelected
                                    ? 'bg-amber-500/20 border-amber-500'
                                    : 'border-amber-500/60 border-dashed hover:bg-amber-500/10'
                                }`}
                              >
                                <span className={numeric ? 'font-mono tabular-nums' : ''}>
                                  {formatValue(val)}
                                </span>
                              </span>
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 opacity-70 group-hover:opacity-100 shrink-0" />
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-slate-400 dark:text-slate-500 px-1 leading-none">
                              <span className={numeric ? 'font-mono tabular-nums' : ''}>
                                {formatValue(val)}
                              </span>
                              <span className="text-amber-500/70 text-[11px]" title="Source not verified in document">
                                ⚠
                              </span>
                            </span>
                          )}
                          {flag && (
                            <FlagBadge
                              flag={flag}
                              dataField={field}
                              panelId={flagPanelId(`${r.fileName}::${field}`)}
                              open={openFlag === `${r.fileName}::${field}`}
                              onToggle={() =>
                                setOpenFlag((prev) => (prev === `${r.fileName}::${field}` ? null : `${r.fileName}::${field}`))
                              }
                            />
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Vendor Quote Line Items */}
              {schemaType === 'vendor_quote' && alignment && (
                <>
                  <tr className="bg-slate-100/80 dark:bg-slate-950/80">
                    <td colSpan={results.length + 1} className="py-2 px-4 font-semibold text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider border-y border-slate-200 dark:border-slate-800">
                      Line Items Audit Breakdown
                    </td>
                  </tr>

                  {!alignment.trusted && (
                    <tr>
                      <td colSpan={results.length + 1} className="p-3 bg-amber-500/10 border-b border-amber-500/20">
                        <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                          <svg className="w-4 h-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <span>⚠ Automatic matching could not be verified with high confidence — displaying raw document items unaligned for manual inspection.</span>
                        </div>
                      </td>
                    </tr>
                  )}

                  {alignment.trusted ? (
                    alignment.groups.map((group, gIdx) => (
                      <tr key={gIdx} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/50 transition-colors">
                        <td className="py-3 px-4 font-medium text-slate-600 dark:text-slate-400 bg-slate-50/30 dark:bg-slate-900/30">
                          {group.canonicalDescription}
                        </td>
                        {results.map((r, quoteIndex) => {
                          const member = group.members.find((m) => m.quoteIndex === quoteIndex);
                          if (!member) {
                            return (
                              <td key={r.fileName} className="py-3 px-4 text-slate-400 dark:text-slate-600">
                                —
                              </td>
                            );
                          }
                          const item = (r.extractions as VendorQuoteExtraction).lineItems[member.lineItemIndex];
                          const location = r.locations[`lineItems.${member.lineItemIndex}.total`] ?? null;
                          const itemPath = `lineItems[${member.lineItemIndex}].total`;
                          const discrepancy = r.mathDiscrepancies?.find((d) => d.field === itemPath);
                          const flag = r.flaggedFields.find((f) => canonicalizeFieldPath(f.fieldPath) === canonicalizeFieldPath(itemPath));
                          const isSelected = selected?.fileName === r.fileName && selected?.location === location && location !== null;

                          return (
                            <td key={r.fileName} className="py-3 px-4 align-top">
                              <div className="flex flex-col gap-1 items-start">
                                <button
                                  type="button"
                                  onClick={() => setSelected({ fileName: r.fileName, location })}
                                  className={`group inline-flex items-center gap-1.5 rounded transition-colors cursor-pointer font-mono tabular-nums text-xs ${
                                    discrepancy
                                      ? 'text-rose-700 dark:text-rose-400'
                                      : location
                                      ? isSelected
                                        ? 'text-amber-900 dark:text-amber-200 font-medium'
                                        : 'text-slate-900 dark:text-slate-100'
                                      : 'text-slate-500'
                                  }`}
                                  title={
                                    flag?.message ??
                                    discrepancy?.message ??
                                    (location ? 'Click cell target to inspect PDF citation source' : 'Source not verified')
                                  }
                                >
                                  <span
                                    className={`inline-block leading-none rounded-[3px] px-1 border-b-2 transition-colors ${
                                      discrepancy
                                        ? 'bg-rose-500/10 border-rose-500/40'
                                        : location
                                        ? isSelected
                                          ? 'bg-amber-500/20 border-amber-500'
                                          : 'border-amber-500/60 border-dashed hover:bg-amber-500/10'
                                        : 'border-transparent'
                                    }`}
                                  >
                                    {formatValue(item.qty.value)} × {formatValue(item.unitPrice.value)} = {formatValue(item.total.value)}
                                  </span>
                                  {location && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />}
                                </button>
                                {flag && (
                                  <FlagBadge
                                    flag={flag}
                                    dataField={itemPath}
                                    panelId={flagPanelId(`${r.fileName}::${itemPath}`)}
                                    open={openFlag === `${r.fileName}::${itemPath}`}
                                    onToggle={() =>
                                      setOpenFlag((prev) => (prev === `${r.fileName}::${itemPath}` ? null : `${r.fileName}::${itemPath}`))
                                    }
                                  />
                                )}
                                {discrepancy && (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-rose-700 dark:text-rose-400 font-medium bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                                    ⚠ Math Mismatch
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  ) : (
                    results.map((r) => (
                      <tr key={r.fileName} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/50 transition-colors">
                        <td className="py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-400 bg-slate-50/30 dark:bg-slate-900/30">
                          {r.fileName} (unaligned)
                        </td>
                        <td colSpan={results.length} className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 dark:text-slate-300">
                          {(r.extractions as VendorQuoteExtraction).lineItems
                            .map(
                              (item) =>
                                `${item.description.value ?? 'Item'} (${formatValue(item.qty.value)} × ${formatValue(item.unitPrice.value)} = ${formatValue(item.total.value)})`
                            )
                            .join(', ')}
                        </td>
                      </tr>
                    ))
                  )}

                  {alignment.unmatched.length > 0 && (
                    <tr className="bg-slate-50/50 dark:bg-slate-900/50">
                      <td className="py-3 px-4 font-medium text-slate-600 dark:text-slate-400">Unmatched Items</td>
                      <td colSpan={results.length} className="py-3 px-4 text-xs font-mono text-slate-600 dark:text-slate-400">
                        {alignment.unmatched.map(({ quoteIndex, lineItemIndex }, i) => {
                          const doc = results[quoteIndex];
                          const item = (doc.extractions as VendorQuoteExtraction).lineItems[lineItemIndex];
                          return (
                            <span key={i} className="inline-block bg-slate-200/60 dark:bg-slate-800 px-2 py-0.5 rounded mr-1.5 mb-1">
                              {doc.fileName}: {item.description.value ?? 'Unlabeled'}
                            </span>
                          );
                        })}
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Source Citation Inspector Panel */}
      <div className="lg:col-span-5 xl:col-span-4 sticky top-6">
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Audit Citation Inspector
          </h3>
          {selected && (
            <button
              onClick={() => setSelected(null)}
              className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              Clear Selection
            </button>
          )}
        </div>

        {selected ? (
          <PdfSourceViewer file={files[selected.fileName] ?? null} location={selected.location} />
        ) : (
          <div className="flex flex-col items-center justify-center p-8 bg-slate-900 border border-slate-800 rounded-xl text-center min-h-[480px]">
            <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 mb-3 border border-slate-700">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
              </svg>
            </div>
            <h4 className="text-sm font-semibold text-slate-200 mb-1">No Cell Citation Selected</h4>
            <p className="text-xs text-slate-400 max-w-xs">
              Click any verified field cell in the audit comparison table to highlight its exact location in the original document.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

