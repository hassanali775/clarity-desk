// lib/extraction/providers/errors.ts
//
// Narrow detection of provider quota / rate-limit / billing failures.
//
// This is deliberately NOT a blanket catch-all: the only errors that classify
// as "throttled" are ones whose HTTP status or message clearly signals a
// rate limit, quota exhaustion, or billing problem (429, 402, RESOURCE_EXHAUSTED,
// "quota", "rate limit"). Anything else — model 404s, schema-conformance 500s,
// network timeouts — propagates as a real error and is surfaced honestly to the
// user. Only throttled errors are eligible for the static-fallback path, and
// only for known sample documents.
const QUOTA_MESSAGE_PATTERN =
  /(rate\s*limit|rate_limit|quota|RESOURCE_EXHAUSTED|billing|insufficient\s*(?:quota|credit|funds)|payment|too\s*many\s*requests|request\s*tracked|over\s*quota|429|402)/i;

export function isProviderQuotaError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const candidate = err as { status?: unknown; statusCode?: unknown; message?: unknown };

  const status =
    typeof candidate.status === 'number'
      ? candidate.status
      : typeof candidate.statusCode === 'number'
        ? candidate.statusCode
        : undefined;
  if (status === 429 || status === 402) return true;

  const message = typeof candidate.message === 'string' ? candidate.message : String(candidate.message ?? '');
  return QUOTA_MESSAGE_PATTERN.test(message);
}
