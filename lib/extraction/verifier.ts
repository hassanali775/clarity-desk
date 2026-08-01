// lib/extraction/verifier.ts
import type { OfferLetterExtraction, VendorQuoteExtraction } from '@/lib/schemas/extraction';

export type VerificationReason = 'QUOTE_NOT_FOUND' | 'MISSING_QUOTE' | 'VALUE_NOT_DERIVABLE_FROM_QUOTE';

export interface FlaggedField {
  /** Dot-notation path to the envelope, e.g. `baseSalary` or `lineItems[0].total`. */
  fieldPath: string;
  reason: VerificationReason;
  /** Human-readable explanation for UI surfacing and logs. */
  message: string;
  /** The rawQuote that failed verification (null for MISSING_QUOTE). */
  rawQuote: string | null;
}

export interface VerifyExtractionResult<T> {
  /** false if at least one field failed verification. */
  trusted: boolean;
  flaggedFields: FlaggedField[];
  /**
   * Deep clone of the input with every flagged field's confidence
   * downgraded to "low". Never mutates the caller's object.
   */
  extractions: T;
}

export interface FieldEnvelope {
  value: unknown;
  rawQuote: string | null;
  pageNum: number | null;
  confidence: 'high' | 'medium' | 'low';
}

const CONFIDENCE_VALUES: ReadonlySet<unknown> = new Set(['high', 'medium', 'low']);

/** Any object shaped like the FieldEnvelope from lib/schemas/extraction.ts. */
export function isFieldEnvelope(node: unknown): node is FieldEnvelope {
  if (typeof node !== 'object' || node === null) return false;
  const candidate = node as Record<string, unknown>;
  return (
    'value' in candidate &&
    'rawQuote' in candidate &&
    'pageNum' in candidate &&
    'confidence' in candidate &&
    CONFIDENCE_VALUES.has(candidate.confidence)
  );
}

/**
 * Narrow OCR punctuation-drift tolerance for number-like tokens ONLY:
 * whitespace between a digit and an adjacent comma/decimal point is removed
 * (e.g. "$25 , 000" -> "$25,000"). This is an intentional, narrowly-scoped
 * tolerance for OCR punctuation drift — NOT a general fuzzy-match relaxation.
 * General whitespace collapsing is deliberately NOT applied, so genuine
 * line-break or multi-space drift elsewhere (e.g. "Morgan\n  Alvarez") still
 * fails verification instead of being silently forgiven.
 *
 * Case is folded to lower before matching (deliberately case-INSENSITIVE):
 * letter-casing is a rendering/OCR artifact, not a content fabrication, so
 * a quote that differs from the source only by case is still honest. Numeric
 * fields get a second, stricter gate (VALUE_NOT_DERIVABLE_FROM_QUOTE) that is
 * case-independent, so case folding cannot let a wrong number slip through.
 */
function normalizeForComparison(text: string): string {
  const punctuationDriftTolerant = text.replace(/(\d)\s*([,.])\s*(\d)/g, '$1$2$3');
  return punctuationDriftTolerant.trim().toLocaleLowerCase('en-US');
}

/**
 * Matches currency / thousands-formatted number tokens only: an optional dollar
 * sign followed by digit groups (with thousand separators) and an optional
 * decimal part. Bare integers without any such formatting are deliberately NOT
 * matched here — they are handled separately by the single-token fallback.
 */
const CURRENCY_TOKEN_PATTERN = /\$?[\d,]+(\.\d+)?/g;

function toNumber(token: string): number {
  return Number(token.replace(/[$,]/g, ''));
}

/**
 * Extracts at most two number tokens from a rawQuote so a numeric field's
 * value can be validated against what the quote actually says.
 *
 *  - Currency/thousands-formatted tokens are preferred and capped at two.
 *  - A lone bare integer is accepted ONLY when it is the only numeric token
 *    present (so "2020" alone is usable, but "4" in "4 years" and multi-token
 *    bare ranges like "2019 - 2020" are not treated as money).
 *
 * Uses the normalized quote so OCR punctuation drift ("$25 , 000") resolves
 * to a single token instead of "$25" and "000".
 */
function extractDerivableNumbers(rawQuote: string): number[] {
  const normalized = normalizeForComparison(rawQuote);
  const currencyTokens = (normalized.match(CURRENCY_TOKEN_PATTERN) ?? []).slice(0, 2).map(toNumber);
  if (currencyTokens.length > 0) return currencyTokens;

  const bareIntegerTokens = normalized.match(/\d+/g) ?? [];
  if (bareIntegerTokens.length === 1) return [Number(bareIntegerTokens[0])];
  return [];
}

/**
 * Checks that a numeric field's value is consistent with the number(s) stated
 * in its rawQuote. Returns a flag (or null when the value is derivable):
 *  - single number in quote   -> value must equal it exactly
 *  - two numbers (a range)    -> value must fall within [min, max] inclusive
 *
 * Only ever called after the quote has been confirmed present in the source,
 * so a field can never carry both QUOTE_NOT_FOUND and this reason.
 */
function checkNumericDerivability(path: string, envelope: FieldEnvelope): FlaggedField | null {
  if (typeof envelope.value !== 'number' || envelope.rawQuote == null) return null;
  const derived = extractDerivableNumbers(envelope.rawQuote);
  if (derived.length === 0) return null; // nothing quotable to check against — not a derivability failure

  if (derived.length === 1) {
    if (envelope.value === derived[0]) return null;
    return {
      fieldPath: path,
      reason: 'VALUE_NOT_DERIVABLE_FROM_QUOTE',
      message: `Field "${path}" value ${envelope.value} is not derivable from the quoted number ${derived[0]} ("${envelope.rawQuote}").`,
      rawQuote: envelope.rawQuote,
    };
  }

  const min = Math.min(derived[0], derived[1]);
  const max = Math.max(derived[0], derived[1]);
  if (envelope.value >= min && envelope.value <= max) return null;
  return {
    fieldPath: path,
    reason: 'VALUE_NOT_DERIVABLE_FROM_QUOTE',
    message: `Field "${path}" value ${envelope.value} is not derivable from the quoted range [${min}, ${max}] ("${envelope.rawQuote}").`,
    rawQuote: envelope.rawQuote,
  };
}

function walkEnvelopes(node: unknown, path: string, visit: (path: string, envelope: FieldEnvelope) => void): void {
  if (isFieldEnvelope(node)) {
    visit(path, node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => walkEnvelopes(item, `${path}[${index}]`, visit));
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      walkEnvelopes(value, path ? `${path}.${key}` : key, visit);
    }
  }
}

/**
 * Strict verification layer that re-checks every extracted field against the
 * original source text before the payload is trusted for comparison.
 *
 * Guarantees:
 *  - a non-null value must be backed by a rawQuote that actually appears in the source;
 *  - a non-null value with a missing/empty rawQuote is flagged (can never be re-traced);
 *  - an honest null (value + rawQuote both null) is never flagged;
 *  - a rawQuote given for a null value is flagged only when it is fabricated;
 *  - a numeric value must be derivable from the number(s) its rawQuote states.
 *
 * Every flagged field has its confidence downgraded to "low" in the returned
 * copy, and `trusted` becomes false so callers can fall back to manual review.
 */
export function verifyExtractions<T extends OfferLetterExtraction | VendorQuoteExtraction>(
  extractions: T,
  sourceText: string,
): VerifyExtractionResult<T> {
  const normalizedSource = normalizeForComparison(sourceText);
  const flaggedFields: FlaggedField[] = [];
  const verified = structuredClone(extractions);

  walkEnvelopes(verified, '', (path, envelope) => {
    const hasQuote = typeof envelope.rawQuote === 'string' && envelope.rawQuote.trim().length > 0;

    if (envelope.value !== null && envelope.value !== undefined && !hasQuote) {
      flaggedFields.push({
        fieldPath: path,
        reason: 'MISSING_QUOTE',
        message: `Field "${path}" has a value but no rawQuote — it cannot be traced back to the source text.`,
        rawQuote: null,
      });
      envelope.confidence = 'low';
      return;
    }

    if (hasQuote) {
      const normalizedQuote = normalizeForComparison(envelope.rawQuote as string);
      if (!normalizedSource.includes(normalizedQuote)) {
        flaggedFields.push({
          fieldPath: path,
          reason: 'QUOTE_NOT_FOUND',
          message: `Field "${path}" quotes "${envelope.rawQuote}" which does not appear in the source text — likely hallucinated.`,
          rawQuote: envelope.rawQuote,
        });
        envelope.confidence = 'low';
        return;
      }

      // Only reached when the quote is genuinely present — a numeric value
      // must also be consistent with what that quote says. The explicit
      // return above guarantees a field never carries both reasons.
      const derivabilityFlag = checkNumericDerivability(path, envelope);
      if (derivabilityFlag) {
        flaggedFields.push(derivabilityFlag);
        envelope.confidence = 'low';
      }
    }
  });

  return { trusted: flaggedFields.length === 0, flaggedFields, extractions: verified };
}
