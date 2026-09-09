/**
 * Pending note text belongs to a vault AND a path. Revisions stay monotonic
 * after a successful write, so a late confirmation cannot clear a newer draft.
 * Background attempts report errors and retry; explicit flushes reject until
 * their selected documents have actually finished writing.
 */
export interface SaveCoordinatorOptions<C> {
  contextKey: (ctx: C) => string;
  onSchedule?: (ctx: C, path: string, text: string, revision: number) => void;
  debounceMs?: number;
  retryBaseMs?: number;
  maxRetryDelayMs?: number;
  onSaved?: (path: string, ctx: C, revision: number) => void;
  onError?: (path: string, error: unknown, attempt: number, ctx: C, revision: number) => void;
  /** The failed revision was preserved separately, for example in a conflict
   * copy. A newer revision still needs its OWN confirmed save or recovery. */
  isTerminal?: (error: unknown) => boolean;
  write: (ctx: C, path: string, text: string, revision: number) => Promise<void>;
}

interface Entry<C> {
  ctx: C;
  path: string;
  text: string;
  revision: number;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
}

export interface SaveCoordinator<C> {
  schedule(ctx: C, path: string, text: string): number;
  /** Omitted context selects all vaults; shell file operations pass theirs. */
  flush(path?: string, ctx?: C): Promise<void>;
  flushAll(ctx?: C): Promise<void>;
  hasPending(path?: string, ctx?: C): boolean;
  getRevision(path: string, ctx: C): number;
  withWriteLock(path: string, ctx: C, work: () => Promise<void>): Promise<void>;
  /** Discards only the selected vault and no input newer than the captured revision. */
  discard(path: string, ctx: C, upToRevision?: number): boolean;
}

export function createSaveCoordinator<C>(opts: SaveCoordinatorOptions<C>): SaveCoordinator<C> {
  const debounceMs = opts.debounceMs ?? 800;
  const retryBaseMs = opts.retryBaseMs ?? 1000;
  const maxRetryDelayMs = opts.maxRetryDelayMs ?? 30_000;
  const entries = new Map<string, Entry<C>>();
  const revisions = new Map<string, number>();
  const writes = new Map<string, Promise<void>>();
  const running = new Map<Promise<void>, Pick<Entry<C>, "ctx" | "path">>();
  const keyFor = (ctx: C, path: string) => JSON.stringify([opts.contextKey(ctx), path]);

  const clearTimers = (entry: Entry<C>) => {
    if (entry.timer !== null) { clearTimeout(entry.timer); entry.timer = null; }
    if (entry.retryTimer !== null) { clearTimeout(entry.retryTimer); entry.retryTimer = null; }
  };

  const background = (key: string) => { void run(key).catch(() => {}); };
  const run = (key: string): Promise<void> => {
    const entry = entries.get(key);
    if (!entry) return Promise.resolve();
    if (entry.inFlight) return entry.inFlight;
    clearTimers(entry);
    let { revision, text, ctx, path } = entry;
    const attempt = entry.attempts + 1;
    // Start on a microtask, after inFlight is assigned. A synchronous adapter
    // failure then follows exactly the same path as a rejected native write.
    const previousWrite = writes.get(key);
    const writing = Promise.resolve(previousWrite).catch(() => {}).then(async () => {
      if (entries.get(key) !== entry) return;
      ({ revision, text, ctx, path } = entry);
      await opts.write(ctx, path, text, revision);
    });
    writes.set(key, writing);
    void writing.then(() => {
      if (writes.get(key) === writing) writes.delete(key);
    }, () => {
      if (writes.get(key) === writing) writes.delete(key);
    });
    const pending = writing.then(
      () => {
        entry.inFlight = null;
        entry.attempts = 0;
        if (entries.get(key) !== entry) return;
        opts.onSaved?.(path, ctx, revision);
        if (entries.get(key) !== entry) return;
        if (entry.revision === revision) { entries.delete(key); return; }
        return run(key);
      },
      (error: unknown) => {
        entry.inFlight = null;
        // A discarded generation must not delete a replacement entry, create
        // a new retry timer or report a conflict against its replacement.
        if (entries.get(key) !== entry) return;
        entry.attempts = attempt;
        opts.onError?.(path, error, attempt, ctx, revision);
        if (entries.get(key) !== entry) return;
        if (entry.revision !== revision) {
          // Only the captured text failed. Preserve the newer snapshot through
          // its own write/conflict path, once, without dropping it with this one.
          entry.attempts = 0;
          return run(key);
        }
        if (opts.isTerminal?.(error)) {
          clearTimers(entry);
          entries.delete(key);
        } else {
          const delay = Math.min(maxRetryDelayMs, retryBaseMs * 2 ** (attempt - 1));
          entry.retryTimer = setTimeout(() => {
            entry.retryTimer = null;
            if (entries.get(key) === entry) background(key);
          }, delay);
        }
        throw error;
      },
    );
    entry.inFlight = pending;
    running.set(pending, entry);
    void pending.then(() => running.delete(pending), () => running.delete(pending));
    return pending;
  };

  const matches = (entry: Pick<Entry<C>, "ctx" | "path">, path?: string, ctx?: C) =>
    (path === undefined || entry.path === path) &&
    (ctx === undefined || opts.contextKey(entry.ctx) === opts.contextKey(ctx));

  const flush = async (path?: string, ctx?: C): Promise<void> => {
    for (;;) {
      const selected = [...entries].filter(([, entry]) => matches(entry, path, ctx));
      // Discard cannot recall a native write that already started. Wait for
      // those older generations too before a caller closes their adapter.
      const active = [...running].filter(([, entry]) => matches(entry, path, ctx)).map(([promise]) => promise);
      if (selected.length === 0 && active.length === 0) return;
      const settled = await Promise.allSettled([...active, ...selected.map(([key]) => run(key))]);
      const failed = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) throw failed.reason;
    }
  };

  return {
    schedule(ctx, path, text) {
      const key = keyFor(ctx, path);
      let entry = entries.get(key);
      const revision = (revisions.get(key) ?? 0) + 1;
      revisions.set(key, revision);
      if (!entry) {
        entry = { ctx, path, text, revision, attempts: 0, timer: null, retryTimer: null, inFlight: null };
        entries.set(key, entry);
      }
      entry.ctx = ctx;
      entry.text = text;
      entry.revision = revision;
      opts.onSchedule?.(ctx, path, text, revision);
      clearTimers(entry);
      const scheduled = entry;
      entry.timer = setTimeout(() => {
        if (entries.get(key) !== scheduled) return;
        scheduled.timer = null;
        background(key);
      }, debounceMs);
      return revision;
    },
    withWriteLock(path, ctx, work) {
      const key = keyFor(ctx, path);
      const run = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
      writes.set(key, run);
      running.set(run, { ctx, path });
      const finish = () => {
        if (writes.get(key) === run) writes.delete(key);
        running.delete(run);
      };
      void run.then(finish, finish);
      return run;
    },
    flush,
    flushAll: (ctx) => flush(undefined, ctx),
    hasPending: (path, ctx) => [...entries.values()].some((entry) => matches(entry, path, ctx)),
    getRevision: (path, ctx) => revisions.get(keyFor(ctx, path)) ?? 0,
    discard(path, ctx, upToRevision = Infinity) {
      const key = keyFor(ctx, path);
      const entry = entries.get(key);
      if (!entry || entry.revision > upToRevision) return false;
      clearTimers(entry);
      entries.delete(key);
      return true;
    },
  };
}
