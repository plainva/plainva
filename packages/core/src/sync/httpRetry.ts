/**
 * Operation-classified HTTP retry (hardening P3.2). No provider had ANY
 * 429/Retry-After handling — a burst hitting a rate limit cascaded straight
 * into the failure breaker. Rules:
 *
 * - 429: the server did NOT execute the request — retry for EVERY kind,
 *   honoring Retry-After (seconds or HTTP date) when present.
 * - 5xx and network errors (fetch rejection): retry ONLY `read` operations
 *   (listings, downloads, PROPFIND). A write/structural request may have been
 *   executed before the failure surfaced — blind repetition risks duplicate
 *   creates/moves/deletes; those keep flowing through the queue's own
 *   retry-next-cycle semantics instead.
 *
 * Backoff: exponential with full jitter, capped; Retry-After wins when the
 * server sent one.
 */

export type HttpOpKind = "read" | "write";

export interface HttpRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injection point for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injection point for tests (defaults to Math.random). */
  random?: () => number;
}

const RETRYABLE_READ_STATUS = new Set([500, 502, 503, 504]);

/** Parses a Retry-After header (delta-seconds or HTTP date) into ms, or null. */
export function parseRetryAfterMs(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return null;
}

export function retryDelayMs(
  attempt: number,
  retryAfter: string | null,
  opts: HttpRetryOptions = {}
): number {
  const base = opts.baseDelayMs ?? 1000;
  const max = opts.maxDelayMs ?? 30_000;
  const fromHeader = parseRetryAfterMs(retryAfter);
  if (fromHeader !== null) return Math.min(max, fromHeader);
  const random = opts.random ?? Math.random;
  const ceiling = Math.min(max, base * 2 ** (attempt - 1));
  return Math.round(random() * ceiling); // full jitter
}

/**
 * Runs `doFetch` with the retry rules above. `doFetch` must build a FRESH
 * request per call (bodies of consumed requests cannot be replayed).
 */
export async function fetchWithRetry(
  doFetch: () => Promise<Response>,
  kind: HttpOpKind,
  opts: HttpRetryOptions = {}
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    let res: Response;
    try {
      res = await doFetch();
    } catch (err) {
      // Network-level failure: the request may never have left — but for a
      // write we cannot know, so only reads retry.
      if (kind === "read" && attempt < maxAttempts) {
        await sleep(retryDelayMs(attempt, null, opts));
        continue;
      }
      throw err;
    }
    if (res.status === 429 && attempt < maxAttempts) {
      await sleep(retryDelayMs(attempt, res.headers?.get?.("Retry-After") ?? null, opts));
      continue;
    }
    if (kind === "read" && RETRYABLE_READ_STATUS.has(res.status) && attempt < maxAttempts) {
      await sleep(retryDelayMs(attempt, res.headers?.get?.("Retry-After") ?? null, opts));
      continue;
    }
    return res;
  }
}
