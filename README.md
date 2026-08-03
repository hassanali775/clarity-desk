This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Extraction Providers

Extraction is provider-agnostic behind `lib/extraction/extract.ts`. The system prompt and Zod schemas are the contract; only the client differs.

- **Default: Gemini** (`gemini-3.5-flash`, a free-tier model). Driven by the official `@google/genai` SDK, with structured output via `responseJsonSchema` + `responseMimeType: 'application/json'` (`lib/extraction/providers/gemini.ts`). Configure with the `GEMINI_API_KEY` env var; override the model with `GEMINI_MODEL` (e.g. `gemini-3.5-flash-lite`).
- **Fallback option: Anthropic** (`claude-sonnet-4-6`, the previous default) via `EXTRACTION_PROVIDER=anthropic` (`lib/extraction/providers/anthropic.ts`). The API route also accepts a per-request `provider` field.
- Set `EXTRACTION_PROVIDER=gemini` (or omit it) to use Gemini, `EXTRACTION_PROVIDER=anthropic` to use Claude.

Live verification harness (requires `GEMINI_API_KEY`):

```bash
npm run test:gemini
```

It extracts the bundled sample PDFs and the canonical verifier-fixture letter through the real Gemini API, then re-checks every rawQuote with `verifyExtractions` — the same gate the API route applies.

## Verification Layer

`lib/extraction/verifier.ts` exports `verifyExtractions(extractions, sourceText)`, which re-checks every extracted field against the original document text before the payload is trusted for comparison. It runs after schema extraction in `app/api/extract/route.ts`, which rebuilds the page-marked source text server-side via `buildPageMarkedText` and passes it in.

It checks three things:

- **Quote presence.** Every non-null field's `rawQuote` must appear as a substring of the normalized source text. Catches hallucinated quotes — text the extractor produced that is not in the document.
- **Missing-quote detection.** A field with a value but an empty or absent `rawQuote` is flagged. Catches values that carry no source at all and therefore cannot be re-traced.
- **Numeric value derivability.** A numeric value must be consistent with the number(s) its quote states: equal to a single quoted number, or within an inclusive quoted range. Catches values that pass schema types but disagree with what the quote actually says.

Flagged fields do not get their values removed. The verifier returns a deep clone with each flagged field's confidence downgraded to `low` and `trusted` set to `false`; the original value stays in the payload. This is deliberate: the workflow is human review, not silent correction. A reviewer must see the disputed value next to the quote that failed verification to decide whether the extraction or the source is wrong, so the data is never hidden.

Example — the `salary-range-value-outside-range` fixture in `tests/fixtures/adversarial-offer-letters.json`:

- Document quotes `$185,000 - $195,000` for base salary.
- The extractor writes `baseSalary: 210000` with that quote.
- A schema-only extraction accepts this: `210000` is a number, the quote is a string, and both are present. The comparison table would silently compare a wrong number.
- `verifyExtractions` flags it with `VALUE_NOT_DERIVABLE_FROM_QUOTE` because `210000` is outside the quoted range `[185000, 195000]`. The value stays visible, the field is marked for review, and the document is reported as not trusted.

## Security & Dependencies

`npm audit` is run as part of pre-release hygiene. Status after `npm audit fix` (the safe, non-breaking pass) on `package-lock.json`:

**Re-audited after adding `@google/genai` (the Gemini provider dependency): the same 4 high-severity findings remain and no new ones were introduced.** `@google/genai` contributes no advisories of its own; everything below is pre-existing (`postcss`/`sharp` vendored by Next.js, plus the direct `xlsx` dependency).

- **Resolved:** `brace-expansion` DoS (GHSA-mh99-v99m-4gvg) — a transitive dev-tooling dependency patched in place. 1 of 5 high-severity findings fixed.
- **Deferred:** the remaining 4 high-severity findings require dependency upgrades that are not safe or not available, so they are documented here rather than fixed blindly.

Remaining findings and why they are deferred:

- **postcss (vendored by `next@16.2.12`, resolves to `postcss@8.4.31`)** — XSS and source-map file-disclosure CVEs (GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849). Next.js bundles its own postcss, so the fix is a Next.js upgrade. `next@latest` is `16.2.12`; the patched version exists only in the `16.3.0-preview.*` channel, which is not a stable release. Deferred until a stable Next.js ships patched postcss. The alternative `npm audit fix --force` path proposes downgrading Next.js to `9.3.3`, which is a breaking change and was not applied.
- **sharp (vendored by `next@16.2.12`, resolves to `sharp@0.34.5`)** — libvips CVEs (GHSA-f88m-g3jw-g9cj), patched in sharp `>=0.35.0`. Same deferral as postcss: it is pinned inside Next.js's dependency tree, used for image optimization, and only resolvable through the same pending Next.js upgrade.
- **xlsx (`^0.18.5`, direct dependency)** — SheetJS prototype pollution and ReDoS advisories (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) with **no fix available on npm**. The npm package is stale because upstream SheetJS maintenance moved to its own CDN distribution. Deferred; a future workstream should either switch to the maintained SheetJS CDN build or replace the dependency.

No `npm audit fix --force` was run: its proposed resolution (downgrading `next` to `9.3.3`) is a breaking change, and the remaining findings require deliberate upgrade work rather than an automated flag.

## Known Limitations

- **Serverless payload ceiling (4.5MB).** Vercel serverless functions reject request bodies over ~4.5MB, and this applies to user-uploaded documents too — not just the bundled samples — so a real user uploading a large (e.g. image-heavy) PDF will hit the same 413 error the samples used to trigger. Keep uploads well under that size.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
