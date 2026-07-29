// components/ComparisonTable.tsx
'use client';

import { useState } from 'react';
import type { SourceLocation } from '@/lib/parsers/types';
import type { OfferLetterExtraction, VendorQuoteExtraction, DocumentSchemaType } from '@/lib/schemas/extraction';
import type { MathDiscrepancy } from '@/lib/validation/mathCheck';
import dynamic from 'next/dynamic';

const PdfSourceViewer = dynamic(() => import('./PdfSourceViewer'), { ssr: false });

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

interface Props {
  schemaType: DocumentSchemaType;
  results: DocResult[];
  alignment: AlignmentOutcome | null;
  /** Original uploaded files, keyed by fileName, so the source viewer can
   *  re-render the exact PDF the location refers to. */
  files: Record<string, File>;
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

function fieldValue(extraction: Record<string, unknown>, field: string): unknown {
  const envelope = extraction[field] as { value: unknown } | undefined;
  return envelope?.value ?? null;
}

export function ComparisonTable({ schemaType, results, alignment, files }: Props) {
  const [selected, setSelected] = useState<{ fileName: string; location: SourceLocation | null } | null>(null);

  const topFields = schemaType === 'offer_letter' ? OFFER_LETTER_FIELDS : VENDOR_TOP_FIELDS;

  return (
    <div className="comparison-layout" style={{ display: 'flex', gap: '1.5rem' }}>
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Field</th>
            {results.map((r) => (
              <th key={r.fileName}>{r.fileName}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topFields.map((field) => (
            <tr key={field}>
              <td className="field-label">{field}</td>
              {results.map((r) => {
                const location = r.locations[field] ?? null;
                const value = fieldValue(r.extraction as Record<string, unknown>, field);
                return (
                  <td
                    key={r.fileName}
                    onClick={() => setSelected({ fileName: r.fileName, location })}
                    className={location ? 'cell--verified' : 'cell--unverified'}
                    title={location ? 'Click to view source' : 'Source not verified'}
                  >
                    {value === null || value === '' ? <span className="cell--empty">—</span> : String(value)}
                    {!location && <span className="cell--unverified-badge"> ⚠</span>}
                  </td>
                );
              })}
            </tr>
          ))}

          {schemaType === 'vendor_quote' && alignment && (
            <>
              <tr>
                <td colSpan={results.length + 1} className="section-header">
                  Line Items{' '}
                  {!alignment.trusted && (
                    <span className="alignment-warning">
                      ⚠ automatic matching could not be verified — showing items unaligned
                    </span>
                  )}
                </td>
              </tr>

              {alignment.trusted ? (
                alignment.groups.map((group, gIdx) => (
                  <tr key={gIdx}>
                    <td className="field-label">{group.canonicalDescription}</td>
                    {results.map((r, quoteIndex) => {
                      const member = group.members.find((m) => m.quoteIndex === quoteIndex);
                      if (!member) return <td key={r.fileName} className="cell--empty">—</td>;
                      const item = (r.extraction as VendorQuoteExtraction).lineItems[member.lineItemIndex];
                      const location = r.locations[`lineItems.${member.lineItemIndex}.total`] ?? null;
                      const discrepancy = r.mathDiscrepancies?.find((d) => d.field === `lineItems[${member.lineItemIndex}].total`);
                      return (
                        <td
                          key={r.fileName}
                          onClick={() => setSelected({ fileName: r.fileName, location })}
                          className={discrepancy ? 'cell--discrepancy' : location ? 'cell--verified' : 'cell--unverified'}
                          title={discrepancy?.message ?? (location ? 'Click to view source' : 'Source not verified')}
                        >
                          {item.qty.value} × {item.unitPrice.value} = {item.total.value}
                          {discrepancy && <span className="discrepancy-badge"> ⚠ math mismatch</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))
              ) : (
                // Untrusted alignment: show every document's items in its own
                // original order rather than a guessed grouping — this is the
                // fallback path the `trusted` flag exists to trigger.
                results.map((r) => (
                  <tr key={r.fileName}>
                    <td className="field-label">{r.fileName} (unaligned)</td>
                    <td colSpan={results.length}>
                      {(r.extraction as VendorQuoteExtraction).lineItems
                        .map((item) => `${item.description.value} (${item.qty.value} × ${item.unitPrice.value})`)
                        .join(', ')}
                    </td>
                  </tr>
                ))
              )}

              {alignment.unmatched.length > 0 && (
                <tr>
                  <td className="field-label">Unmatched items</td>
                  <td colSpan={results.length} className="unmatched-cell">
                    {alignment.unmatched.map(({ quoteIndex, lineItemIndex }, i) => {
                      const doc = results[quoteIndex];
                      const item = (doc.extraction as VendorQuoteExtraction).lineItems[lineItemIndex];
                      return (
                        <span key={i}>
                          {doc.fileName}: {item.description.value}
                          {i < alignment.unmatched.length - 1 ? ', ' : ''}
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

      <div className="source-panel" style={{ minWidth: '320px' }}>
        <h3>Source</h3>
        {selected ? (
          <PdfSourceViewer file={files[selected.fileName] ?? null} location={selected.location} />
        ) : (
          <p>Click any cell to view its source.</p>
        )}
      </div>
    </div>
  );
}
