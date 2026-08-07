// lib/ratelimit.ts
//
// Minimal in-memory sliding-window rate limiter for per-client request
// throttling. Keyed by an identifier (the caller's IP address) and enforced
// inside the request handler.
//
// NOTE: state lives in process memory, so on horizontally-scaled serverless
// deployments each instance keeps its own window. This is an honest
// first-line defense against casual script abuse, not a global quota — pair
// it with a real distributed limiter (Redis/Upstash) for production-scale
// enforcement.
export class InMemoryRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true when the key is still under the limit, false when throttled. */
  allow(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Clears all tracked windows. Exposed for tests and reset tooling. */
  reset(): void {
    this.hits.clear();
  }
}

/** Shared limiter for /api/extract: 30 requests per IP per minute. */
export const EXTRACT_RATE_LIMIT = 30;
export const EXTRACT_RATE_LIMIT_WINDOW_MS = 60_000;
export const extractRateLimiter = new InMemoryRateLimiter(EXTRACT_RATE_LIMIT, EXTRACT_RATE_LIMIT_WINDOW_MS);
