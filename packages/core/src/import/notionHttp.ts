/**
 * Paced, retrying HTTP for the Notion API.
 *
 * Notion allows roughly three requests per second and answers 429 with a
 * `Retry-After` header once you exceed it. The importer used to fire requests
 * as fast as the loop produced them and read any non-2xx as "no more data", so
 * a rate-limited workspace lost rows *silently* — the one failure mode a report
 * cannot describe, because the adapter never learned about it.
 *
 * Two jobs, deliberately separate:
 *
 * - `json()` talks to `api.notion.com`: paced, authenticated, retried.
 * - `bytes()` fetches an attachment from the signed storage URL Notion hands
 *   out. That is a different host, it must NOT carry the integration token, and
 *   it does not count against Notion's rate limit.
 */

/** Notion documents ~3 requests per second; stay just under it. */
const MIN_INTERVAL_MS = 340;
/** One initial try plus three retries — beyond that a wait is not a hiccup. */
const MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_MS = 1000;
/** A server may ask for minutes; an import must not silently hang that long. */
const MAX_RETRY_MS = 30_000;
/** Downloads are capped so one huge file cannot exhaust memory. */
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export interface NotionHttpConfig {
  fetchFn: typeof fetch;
  token: string;
  signal?: AbortSignal;
  /** Injected so tests do not spend real seconds inside a backoff. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so pacing is not at the mercy of the wall clock in tests. */
  now?: () => number;
}

export type NotionJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

/** Seconds from a `Retry-After` header, clamped to something an import survives. */
function retryDelayMs(header: string | null, attempt: number): number {
  const seconds = header ? Number.parseFloat(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), MAX_RETRY_MS);
  }
  // No usable header: back off exponentially rather than hammering.
  return Math.min(DEFAULT_RETRY_MS * 2 ** (attempt - 1), MAX_RETRY_MS);
}

/** Transient on Notion's side — worth another attempt. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export class NotionHttp {
  private lastRequestAt = 0;
  private requests = 0;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly cfg: NotionHttpConfig) {
    this.sleep =
      cfg.sleep ??
      ((ms: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms);
        }));
    this.now = cfg.now ?? (() => Date.now());
  }

  /** How many calls reached `api.notion.com`, retries included. */
  get requestCount(): number {
    return this.requests;
  }

  private aborted(): boolean {
    return this.cfg.signal?.aborted === true;
  }

  /** Holds the ~3 req/s line without the caller having to think about it. */
  private async pace(): Promise<void> {
    const elapsed = this.now() - this.lastRequestAt;
    if (this.lastRequestAt > 0 && elapsed < MIN_INTERVAL_MS) {
      await this.sleep(MIN_INTERVAL_MS - elapsed);
    }
    this.lastRequestAt = this.now();
  }

  /**
   * One authenticated Notion call, paced and retried.
   *
   * Returns a discriminated result rather than throwing: every caller has to
   * decide what a failure means for the report, and an exception would let one
   * of them forget.
   */
  async json<T = any>(url: string, init: RequestInit = {}): Promise<NotionJsonResult<T>> {
    let lastError = 'Notion API did not answer.';
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (this.aborted()) return { ok: false, error: 'aborted' };
      await this.pace();
      this.requests += 1;

      let res: Response;
      try {
        res = await this.cfg.fetchFn(url, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.cfg.token.trim()}`,
            'Notion-Version': '2022-06-28',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init.headers as Record<string, string> | undefined),
          },
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt === MAX_ATTEMPTS) break;
        await this.sleep(retryDelayMs(null, attempt));
        continue;
      }

      if (res.ok) {
        try {
          return { ok: true, data: (await res.json()) as T };
        } catch (error) {
          return {
            ok: false,
            error: `Notion API sent a response that could not be read: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
      }

      lastStatus = res.status;
      const body = await res.text().catch(() => '');
      lastError = `Notion API HTTP ${res.status}: ${res.statusText}`;
      try {
        const parsed = JSON.parse(body);
        if (parsed?.message) lastError = `Notion API: ${parsed.message}`;
      } catch {
        // Body was not JSON; the status line already says enough.
      }

      if (!isRetryableStatus(res.status) || attempt === MAX_ATTEMPTS) break;
      await this.sleep(retryDelayMs(res.headers?.get?.('Retry-After') ?? null, attempt));
    }

    return { ok: false, error: lastError, status: lastStatus };
  }

  /**
   * Downloads an attachment from the URL Notion signed for it.
   *
   * No Authorization header on purpose: the URL already carries its own
   * signature, and sending the integration token to a storage host would hand
   * a credential to a party that has no business holding it.
   */
  async bytes(url: string): Promise<Uint8Array | null> {
    if (this.aborted()) return null;
    try {
      const res = await this.cfg.fetchFn(url, { method: 'GET' });
      if (!res.ok) return null;
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > MAX_ATTACHMENT_BYTES) return null;
      return new Uint8Array(buffer);
    } catch {
      // An expired signature or a dead connection: the caller reports it.
      return null;
    }
  }
}
