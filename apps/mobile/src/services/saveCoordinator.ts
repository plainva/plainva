/**
 * Save coordinator (hardening P2 mobile, finding M1): the EditorHost used to
 * fire-and-forget its debounced save — the pending text was dropped BEFORE
 * the write confirmed, failures were silent, two overlapping saves could
 * finish out of order, and unmount didn't await its flush.
 *
 * This coordinator owns the pending text OUTSIDE any component lifecycle:
 * - exactly ONE write per document in flight (single-flight),
 * - monotonic revisions, latest-write-wins (a newer snapshot immediately
 *   re-queues after the in-flight write settles),
 * - the text survives until a write CONFIRMED covering its revision,
 * - failures retry with capped exponential backoff and surface via onError,
 * - flush()/flushAll() run pending work now (app background, vault switch,
 *   editor unmount) and resolve when the queue settled (never reject).
 *
 * The write context (the vault instance) is captured per schedule() call, so
 * a late write after a vault switch still targets the vault it was typed in.
 * Pure TypeScript — no Capacitor imports — so it unit-tests in node.
 */

export interface SaveCoordinatorOptions<C> {
  /** Fires on every schedule() BEFORE debouncing — the draft journal hooks here. */
  onSchedule?: (ctx: C, path: string, text: string) => void;
  debounceMs?: number;
  retryBaseMs?: number;
  maxRetryDelayMs?: number;
  onSaved?: (path: string, ctx: C) => void;
  onError?: (path: string, error: unknown, attempt: number) => void;
  write: (ctx: C, path: string, text: string) => Promise<void>;
}

interface Entry<C> {
  ctx: C;
  text: string;
  revision: number;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
}

export interface SaveCoordinator<C> {
  schedule(ctx: C, path: string, text: string): void;
  flush(path?: string): Promise<void>;
  flushAll(): Promise<void>;
  hasPending(path?: string): boolean;
  /**
   * Drops the pending snapshot for a path WITHOUT writing it (2026-07-16).
   * Used by the external-update conflict path: the draft was preserved as a
   * .CONFLICT copy and the on-disk version adopted — the queued save must not
   * overwrite it right back. An already in-flight write cannot be recalled,
   * but dropping the entry prevents any further write (incl. latest-wins
   * re-queues) of the discarded snapshot.
   */
  discard(path: string): void;
}

export function createSaveCoordinator<C>(opts: SaveCoordinatorOptions<C>): SaveCoordinator<C> {
  const debounceMs = opts.debounceMs ?? 800;
  const retryBaseMs = opts.retryBaseMs ?? 1000;
  const maxRetryDelayMs = opts.maxRetryDelayMs ?? 30_000;
  const entries = new Map<string, Entry<C>>();

  const clearTimers = (e: Entry<C>) => {
    if (e.timer) { clearTimeout(e.timer); e.timer = null; }
    if (e.retryTimer) { clearTimeout(e.retryTimer); e.retryTimer = null; }
  };

  const run = (path: string): Promise<void> => {
    const entry = entries.get(path);
    if (!entry) return Promise.resolve();
    if (entry.inFlight) return entry.inFlight;
    clearTimers(entry);

    const rev = entry.revision;
    const text = entry.text;
    const ctx = entry.ctx;
    const attempt = entry.attempts + 1;

    const p = opts
      .write(ctx, path, text)
      .then(() => {
        entry.inFlight = null;
        entry.attempts = 0;
        opts.onSaved?.(path, ctx);
        const current = entries.get(path);
        if (current === entry && entry.revision === rev) {
          // Nothing newer arrived while writing — done, drop the entry.
          entries.delete(path);
          return;
        }
        // A newer snapshot exists (latest wins): write it right away.
        return run(path);
      })
      .catch((err) => {
        entry.inFlight = null;
        entry.attempts = attempt;
        opts.onError?.(path, err, attempt);
        // The text stays pending — retry with capped exponential backoff;
        // any new keystroke or an explicit flush retries sooner.
        const delay = Math.min(maxRetryDelayMs, retryBaseMs * 2 ** (attempt - 1));
        entry.retryTimer = setTimeout(() => {
          entry.retryTimer = null;
          void run(path);
        }, delay);
      });
    entry.inFlight = p;
    return p;
  };

  return {
    schedule(ctx: C, path: string, text: string): void {
      let entry = entries.get(path);
      if (!entry) {
        entry = { ctx, text, revision: 0, attempts: 0, timer: null, retryTimer: null, inFlight: null };
        entries.set(path, entry);
      }
      entry.ctx = ctx;
      entry.text = text;
      entry.revision++;
      opts.onSchedule?.(ctx, path, text);
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.retryTimer) { clearTimeout(entry.retryTimer); entry.retryTimer = null; }
      entry.timer = setTimeout(() => {
        const e = entries.get(path);
        if (e) e.timer = null;
        void run(path);
      }, debounceMs);
    },

    async flush(path?: string): Promise<void> {
      if (path === undefined) return this.flushAll();
      // Run until the entry is gone or a write attempt failed (the failure
      // stays pending for the backoff/next flush — flush must not hang).
      for (let guard = 0; guard < 5 && entries.has(path); guard++) {
        const before = entries.get(path)!.revision;
        await run(path);
        const after = entries.get(path);
        if (after && after.revision === before && after.attempts > 0) break;
      }
    },

    async flushAll(): Promise<void> {
      await Promise.all(Array.from(entries.keys()).map((p) => this.flush(p)));
    },

    hasPending(path?: string): boolean {
      return path === undefined ? entries.size > 0 : entries.has(path);
    },

    discard(path: string): void {
      const entry = entries.get(path);
      if (!entry) return;
      clearTimers(entry);
      // run()'s completion handlers re-check entries.get(path) === entry, so a
      // deleted entry can neither re-run (latest-wins) nor re-arm a retry.
      entries.delete(path);
    },
  };
}
