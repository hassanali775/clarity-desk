// lib/alignment/lineItems.ts
//
// Provider-agnostic line-item alignment dispatcher. Mirrors
// lib/extraction/extract.ts: the SAME EXTRACTION_PROVIDER env flag that selects
// the extraction provider also selects the alignment provider, so one env var
// keeps both layers on the same vendor.
//
//   EXTRACTION_PROVIDER=anthropic  -> Claude (claude-sonnet-4-6) aligns line items
//   EXTRACTION_PROVIDER=gemini     -> Gemini (GEMINI_MODEL, default gemini-3.5-flash)
//
// Quota failures degrade the same way extraction degrades: a throttled call
// returns an honest, UNTRUSTED empty outcome instead of throwing, so a quota
// hit never takes down the whole comparison response.
import { selectExtractionProvider } from '@/lib/extraction/extract';
import { isProviderQuotaError } from '@/lib/extraction/providers/errors';
import { alignWithAnthropic } from '@/lib/alignment/providers/anthropic';
import { alignWithGemini } from '@/lib/alignment/providers/gemini';
import {
  AlignmentResultSchema,
  type AlignmentResult,
  type AlignedGroup,
  type AlignmentOutcome,
  type QuoteForAlignment,
} from '@/lib/alignment/schema';

export { AlignmentResultSchema };
export type { AlignmentResult, AlignedGroup, AlignmentOutcome, QuoteForAlignment };

/**
 * Deterministically validates the model's alignment output against the real
 * input data: every referenced index must exist, and every real item must be
 * accounted for exactly once. This is the actual trust boundary — the LLM
 * proposes groupings, this function is the only thing that decides whether
 * they're believed.
 */
export function validate(result: AlignmentResult, quotes: QuoteForAlignment[]): AlignmentOutcome {
  const realItemCount = quotes.map((q) => q.lineItems.length);
  const seen = new Set<string>();
  let allRefsValid = true;

  const isValidRef = (ref: { quoteIndex: number; lineItemIndex: number }) => {
    const count = realItemCount[ref.quoteIndex];
    return count !== undefined && ref.lineItemIndex >= 0 && ref.lineItemIndex < count;
  };

  const markSeen = (ref: { quoteIndex: number; lineItemIndex: number }) => {
    const key = `${ref.quoteIndex}:${ref.lineItemIndex}`;
    if (!isValidRef(ref)) {
      allRefsValid = false;
      return;
    }
    if (seen.has(key)) {
      allRefsValid = false; // duplicate reference — violates the "exactly once" invariant
      return;
    }
    seen.add(key);
  };

  result.groups.forEach((g) => g.members.forEach(markSeen));
  result.unmatched.forEach(markSeen);

  const totalRealItems = realItemCount.reduce((sum, n) => sum + n, 0);
  const allItemsAccountedFor = seen.size === totalRealItems;
  const trusted = allRefsValid && allItemsAccountedFor;

  return { groups: result.groups, unmatched: result.unmatched, trusted };
}

function allItemsUnmatched(quotes: QuoteForAlignment[]): AlignmentOutcome['unmatched'] {
  return quotes.flatMap((q, quoteIndex) =>
    q.lineItems.map((_, lineItemIndex) => ({ quoteIndex, lineItemIndex })),
  );
}

export async function alignLineItems(quotes: QuoteForAlignment[]): Promise<AlignmentOutcome> {
  // Nothing to align with fewer than two quotes — skip the API call entirely.
  if (quotes.length < 2) {
    return { groups: [], unmatched: allItemsUnmatched(quotes), trusted: true };
  }

  try {
    const result =
      selectExtractionProvider() === 'anthropic'
        ? await alignWithAnthropic(quotes)
        : await alignWithGemini(quotes);
    return validate(result, quotes);
  } catch (err) {
    // Same graceful-degradation philosophy as the extraction route: a quota /
    // rate-limit / billing hit must not take the whole comparison down.
    // Alignment is not load-bearing for displaying per-document results, so
    // degrade to an honest UNTRUSTED empty outcome — the UI renders its
    // "could not be verified" banner and shows items unaligned. Any other
    // error still propagates, and the route records it as an `(alignment)` error.
    if (isProviderQuotaError(err)) {
      return { groups: [], unmatched: allItemsUnmatched(quotes), trusted: false };
    }
    throw err;
  }
}
