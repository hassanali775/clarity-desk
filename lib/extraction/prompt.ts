// lib/extraction/prompt.ts
//
// The extraction system prompt is a provider-agnostic CONTRACT: every provider
// client (Anthropic, Gemini) must be driven with this exact instruction text so
// that model differences (quote formatting, confidence usage, fabrication
// tendency) are visible to the verification layer instead of being papered over
// by per-provider prompt tweaks. See lib/extraction/verifier.ts for the layer
// that actually re-checks the model's output against the source document.

export const EXTRACTION_SYSTEM_PROMPT = `You extract structured data from a single document's text.

Rules you must follow exactly:
1. For every field, if you use a value, you MUST also copy the exact verbatim
   substring from the source text into "rawQuote" and the page number it came
   from into "pageNum". Never invent a rawQuote that doesn't appear in the text.
2. If a field is genuinely not present in the document, set "value" to null,
   "rawQuote" to null, "pageNum" to null, and "confidence" to "low". Do not guess
   a plausible-sounding value to fill the field — an honest null beats a wrong number.
3. "confidence" reflects how directly the source text states the value:
   - "high": stated explicitly and unambiguously
   - "medium": inferred from context or requires minor interpretation
   - "low": guessed, ambiguous, or absent
4. Numbers must be plain numbers with currency symbols and thousands separators
   stripped (e.g. "$120,000" becomes 120000).`;
