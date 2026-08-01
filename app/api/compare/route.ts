// app/api/compare/route.ts
//
// DEVELOPMENT-ONLY MOCK EXTRACTOR
// -------------------------------
// Returns a hardcoded vendor-quote comparison so you can verify the audit
// table's highlighting (math mismatch rows, unverified source markers) and
// the untrusted-alignment fallback WITHOUT spending Anthropic credits.
//
// The response intentionally mirrors the real /api/extract contract:
//   { results, errors, alignment }
// and each results[].fileName matches the bundled sample PDFs
// (public/samples/offer_a.pdf / offer_b.pdf) so the citation viewer can
// render the file the user just loaded.
//
// The endpoint refuses to serve mock data outside `development`, and the UI
// toggle that points at it is hidden in production builds too.

import { NextResponse } from 'next/server';
import { VendorQuoteExtractionSchema } from '@/lib/schemas/extraction';
import { checkVendorQuoteMath } from '@/lib/validation/mathCheck';
import type { SourceLocation } from '@/lib/parsers/types';
import type { AlignmentOutcome } from '@/lib/alignment/lineItems';

export const runtime = 'nodejs';

function envelope<T>(value: T, rawQuote: string, pageNum: number, confidence: 'high' | 'medium' | 'low') {
  return { value, rawQuote, pageNum, confidence };
}

function bbox(x: number, y: number, width: number, height: number): SourceLocation {
  return { kind: 'pdf', pageNum: 1, bbox: { x, y, width, height } };
}

/**
 * Quote A carries one deliberate math mismatch: line item 2 states a total of
 * 8,800.00 but qty × unit price = 6 × 1,450.00 = 8,700.00. Subtotals/taxes are
 * balanced against the STATED line totals so the math checker flags exactly
 * that one row and nothing else.
 */
const QUOTE_A = VendorQuoteExtractionSchema.parse({
  vendorName: envelope('Northwind Procurement', 'Northwind Procurement', 1, 'high'),
  quoteReference: envelope('QW-2026-0147', 'Quote Reference: QW-2026-0147', 1, 'high'),
  quoteExpiration: envelope('2026-12-31', 'Quote valid until 2026-12-31', 1, 'medium'),
  lineItems: [
    {
      description: envelope('Industrial Shelving Unit U-SHLV-4B', 'Industrial Shelving Unit U-SHLV-4B', 1, 'high'),
      qty: envelope(40, 'Qty: 40', 1, 'high'),
      unitPrice: envelope(125.0, 'Unit Price $125.00', 1, 'medium'),
      total: envelope(5000.0, 'Total $5,000.00', 1, 'high'),
    },
    {
      description: envelope('Pallet Jack 2.5T', 'Pallet Jack 2.5T', 1, 'high'),
      qty: envelope(6, 'Qty: 6', 1, 'high'),
      unitPrice: envelope(1450.0, 'Unit Price $1,450.00', 1, 'medium'),
      total: envelope(8800.0, 'Total $8,800.00', 1, 'high'),
    },
    {
      description: envelope('Thermal Label Printer', 'Thermal Label Printer', 1, 'high'),
      qty: envelope(8, 'Qty: 8', 1, 'high'),
      unitPrice: envelope(320.0, 'Unit Price $320.00', 1, 'medium'),
      total: envelope(2560.0, 'Total $2,560.00', 1, 'high'),
    },
    {
      description: envelope('Pallet Wrap (25 rolls)', 'Pallet Wrap (25 rolls)', 1, 'low'),
      qty: envelope(25, 'Qty: 25', 1, 'low'),
      unitPrice: envelope(18.5, 'Unit Price $18.50', 1, 'low'),
      total: envelope(462.5, 'Total $462.50', 1, 'low'),
    },
  ],
  subtotal: envelope(16822.5, 'Subtotal 16,822.50', 1, 'high'),
  taxAmount: envelope(1345.8, 'Tax 1,345.80', 1, 'medium'),
  grandTotal: envelope(18168.3, 'Grand Total 18,168.30', 1, 'high'),
  paymentTerms: envelope('Net 30', 'Payment Terms: Net 30', 1, 'medium'),
  deliverySla: envelope('4-6 business days', 'Delivery: 4-6 business days', 1, 'medium'),
  warrantyPeriod: envelope('24 months', 'Warranty: 24 months', 1, 'low'),
});

const QUOTE_B = VendorQuoteExtractionSchema.parse({
  vendorName: envelope('Apex Logistics', 'Apex Logistics', 1, 'high'),
  quoteReference: envelope('AL-2026-0331', 'Quote Reference: AL-2026-0331', 1, 'high'),
  quoteExpiration: envelope('2026-12-15', 'Quote valid until 2026-12-15', 1, 'medium'),
  lineItems: [
    {
      description: envelope('Industrial Shelving Unit U-SHLV-4B', 'Industrial Shelving Unit U-SHLV-4B', 1, 'high'),
      qty: envelope(40, 'Qty: 40', 1, 'high'),
      unitPrice: envelope(125.0, 'Unit Price $125.00', 1, 'medium'),
      total: envelope(5000.0, 'Total $5,000.00', 1, 'high'),
    },
    {
      description: envelope('Pallet Jack 2.5T Heavy Duty', 'Pallet Jack 2.5T Heavy Duty', 1, 'high'),
      qty: envelope(6, 'Qty: 6', 1, 'high'),
      unitPrice: envelope(1400.0, 'Unit Price $1,400.00', 1, 'medium'),
      total: envelope(8400.0, 'Total $8,400.00', 1, 'high'),
    },
    {
      description: envelope('Thermal Label Printer', 'Thermal Label Printer', 1, 'high'),
      qty: envelope(8, 'Qty: 8', 1, 'high'),
      unitPrice: envelope(310.0, 'Unit Price $310.00', 1, 'medium'),
      total: envelope(2480.0, 'Total $2,480.00', 1, 'high'),
    },
  ],
  subtotal: envelope(15880.0, 'Subtotal 15,880.00', 1, 'high'),
  taxAmount: envelope(1270.4, 'Tax 1,270.40', 1, 'medium'),
  grandTotal: envelope(17150.4, 'Grand Total 17,150.40', 1, 'high'),
  paymentTerms: envelope('Net 45', 'Payment Terms: Net 45', 1, 'medium'),
  deliverySla: envelope('5-7 business days', 'Delivery: 5-7 business days', 1, 'medium'),
  warrantyPeriod: envelope('12 months', 'Warranty: 12 months', 1, 'low'),
});

function lineItemLocations(index: number, baseY: number, descriptionW = 280): Record<string, SourceLocation> {
  const locs = {
    description: bbox(72, baseY, descriptionW, 14),
    qty: bbox(360, baseY, 30, 14),
    unitPrice: bbox(400, baseY, 60, 14),
    total: bbox(470, baseY, 70, 14),
  };
  return Object.fromEntries(
    Object.entries(locs).map(([key, value]) => [`lineItems.${index}.${key}`, value]),
  );
}

const LOCATIONS_A: Record<string, SourceLocation> = {
  vendorName: bbox(72, 96, 220, 14),
  quoteReference: bbox(72, 118, 190, 14),
  quoteExpiration: bbox(72, 140, 200, 14),
  ...lineItemLocations(0, 200),
  ...lineItemLocations(1, 222),
  ...lineItemLocations(2, 244),
  ...lineItemLocations(3, 266),
  subtotal: bbox(400, 310, 140, 14),
  taxAmount: bbox(400, 332, 140, 14),
  grandTotal: bbox(400, 354, 160, 14),
  paymentTerms: bbox(72, 392, 120, 14),
  deliverySla: bbox(72, 414, 180, 14),
  warrantyPeriod: bbox(72, 436, 140, 14),
};

const LOCATIONS_B: Record<string, SourceLocation> = {
  vendorName: bbox(72, 96, 160, 14),
  quoteReference: bbox(72, 118, 190, 14),
  quoteExpiration: bbox(72, 140, 200, 14),
  ...lineItemLocations(0, 200),
  ...lineItemLocations(1, 222),
  ...lineItemLocations(2, 244),
  subtotal: bbox(400, 300, 140, 14),
  taxAmount: bbox(400, 322, 140, 14),
  grandTotal: bbox(400, 344, 160, 14),
  paymentTerms: bbox(72, 382, 120, 14),
  deliverySla: bbox(72, 404, 180, 14),
  warrantyPeriod: bbox(72, 426, 140, 14),
};

/**
 * Deliberately untrusted alignment ("trusted: false"): the Pallet Jack group
 * lists quote 0's line item 1 TWICE (a duplicate reference), which violates
 * the exactly-once invariant the real validator enforces. The UI therefore
 * shows the "could not be verified" banner and falls back to raw unaligned
 * rows — the exact mismatch case you want to eyeball in development.
 */
const MOCK_ALIGNMENT: AlignmentOutcome = {
  groups: [
    {
      canonicalDescription: 'Industrial Shelving Unit U-SHLV-4B',
      members: [
        { quoteIndex: 0, lineItemIndex: 0 },
        { quoteIndex: 1, lineItemIndex: 0 },
      ],
    },
    {
      canonicalDescription: 'Pallet Jack 2.5T',
      members: [
        { quoteIndex: 0, lineItemIndex: 1 },
        { quoteIndex: 1, lineItemIndex: 1 },
        { quoteIndex: 0, lineItemIndex: 1 },
      ],
    },
    {
      canonicalDescription: 'Thermal Label Printer',
      members: [
        { quoteIndex: 0, lineItemIndex: 2 },
        { quoteIndex: 1, lineItemIndex: 2 },
      ],
    },
  ],
  unmatched: [{ quoteIndex: 0, lineItemIndex: 3 }],
  trusted: false,
};

export async function POST() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json(
      { error: 'The mock compare endpoint is only available in development.' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    results: [
      {
        fileName: 'offer_a.pdf',
        trusted: true,
        flaggedFields: [],
        extractions: QUOTE_A,
        locations: LOCATIONS_A,
        mathDiscrepancies: checkVendorQuoteMath(QUOTE_A),
      },
      {
        fileName: 'offer_b.pdf',
        trusted: true,
        flaggedFields: [],
        extractions: QUOTE_B,
        locations: LOCATIONS_B,
        mathDiscrepancies: checkVendorQuoteMath(QUOTE_B),
      },
    ],
    errors: [],
    alignment: MOCK_ALIGNMENT,
  });
}
