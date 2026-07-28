// lib/validation/mathCheck.ts
import type { VendorQuoteExtraction } from '@/lib/schemas/extraction';

export interface MathDiscrepancy {
  field: string;
  expected: number;
  actual: number;
  delta: number;
  message: string;
}

// Rounding/currency-display tolerance — real invoices round per line item,
// so a few cents of drift across a multi-line quote is normal, not a bug.
const TOLERANCE = 0.01;
const PER_LINE_TOLERANCE = 0.01;

function nearlyEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Deterministically checks the arithmetic the LLM extracted — never trusts
 * the model's math, only its transcription. Every check here is plain
 * multiplication/addition on numbers the extraction step already pulled out;
 * if a document's own numbers don't add up, we flag it instead of silently
 * trusting whichever total the model happened to copy.
 */
export function checkVendorQuoteMath(extraction: VendorQuoteExtraction): MathDiscrepancy[] {
  const discrepancies: MathDiscrepancy[] = [];

  extraction.lineItems.forEach((item, idx) => {
    const qty = item.qty.value;
    const unitPrice = item.unitPrice.value;
    const total = item.total.value;
    if (qty === null || unitPrice === null || total === null) return; // nothing to check if a field wasn't extracted

    const expected = qty * unitPrice;
    if (!nearlyEqual(expected, total, PER_LINE_TOLERANCE)) {
      discrepancies.push({
        field: `lineItems[${idx}].total`,
        expected,
        actual: total,
        delta: total - expected,
        message: `Line ${idx + 1} ("${item.description.value ?? 'unnamed'}"): qty × unit price = ${expected.toFixed(2)}, but total states ${total.toFixed(2)}.`,
      });
    }
  });

  const subtotal = extraction.subtotal.value;
  const taxAmount = extraction.taxAmount.value;
  const grandTotal = extraction.grandTotal.value;

  const lineItemTotals = extraction.lineItems.map((i) => i.total.value).filter((v): v is number => v !== null);
  if (subtotal !== null && lineItemTotals.length === extraction.lineItems.length && lineItemTotals.length > 0) {
    const expectedSubtotal = lineItemTotals.reduce((sum, v) => sum + v, 0);
    if (!nearlyEqual(expectedSubtotal, subtotal, TOLERANCE * extraction.lineItems.length)) {
      discrepancies.push({
        field: 'subtotal',
        expected: expectedSubtotal,
        actual: subtotal,
        delta: subtotal - expectedSubtotal,
        message: `Sum of line item totals = ${expectedSubtotal.toFixed(2)}, but stated subtotal is ${subtotal.toFixed(2)}.`,
      });
    }
  }

  if (subtotal !== null && taxAmount !== null && grandTotal !== null) {
    const expectedGrandTotal = subtotal + taxAmount;
    if (!nearlyEqual(expectedGrandTotal, grandTotal, TOLERANCE)) {
      discrepancies.push({
        field: 'grandTotal',
        expected: expectedGrandTotal,
        actual: grandTotal,
        delta: grandTotal - expectedGrandTotal,
        message: `Subtotal + tax = ${expectedGrandTotal.toFixed(2)}, but stated grand total is ${grandTotal.toFixed(2)}.`,
      });
    }
  }

  return discrepancies;
}
