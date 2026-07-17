import type { PimCacheRepository, PimAccountRow } from "./PimCacheRepository.js";
import type { IPimTarget } from "./types.js";

/**
 * Periodic PIM pull loop (stage 2, read-only): refreshes calendars, the
 * rolling event window and task lists/tasks of every enabled account into the
 * cache. Deliberately simpler than the file SyncWorker — windowed full
 * refreshes have no reconcile state to corrupt — but keeps its safety
 * furniture: a generation guard against overlapping cycles, per-account error
 * isolation (one failing account never blocks the others) and error surfacing
 * through the scope state + status callback.
 */

export type PimStatus = "idle" | "syncing" | "error";

export interface PimWorkerOptions {
  cache: PimCacheRepository;
  /** Builds a ready-to-use target for the account (credentials live in the
   * shell's keychain — the worker never sees them). null = skip account. */
  buildTarget: (account: PimAccountRow) => Promise<IPimTarget | null>;
  onStatusChange?: (status: PimStatus, message?: string) => void;
  /** Fired after a cycle wrote fresh data — the UI re-queries the cache. */
  onDataChanged?: () => void;
  intervalMs?: number;
  /** Rolling event window around "now". */
  windowPastDays?: number;
  windowFutureDays?: number;
  now?: () => number;
}

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class PimWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private running = false;
  /** Only an explicit stop() parks the worker — a manual triggerImmediate()
   * must work without (before) start(), e.g. on opening the calendar tab. */
  private stopped = false;

  constructor(private opts: PimWorkerOptions) {}

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.runCycle(), this.opts.intervalMs ?? DEFAULT_INTERVAL_MS);
    void this.runCycle();
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Manual refresh ("Jetzt aktualisieren" / opening the calendar tab). */
  async triggerImmediate(): Promise<void> {
    await this.runCycle();
  }

  get windowRange(): { startTs: number; endTs: number } {
    const now = this.opts.now ? this.opts.now() : Date.now();
    const startTs = now - (this.opts.windowPastDays ?? 60) * DAY_MS;
    const endTs = now + (this.opts.windowFutureDays ?? 400) * DAY_MS;
    return { startTs, endTs };
  }

  private async runCycle(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    const gen = ++this.generation;
    const { cache, buildTarget } = this.opts;
    let hadError = false;
    let firstError: string | undefined;
    let wroteData = false;
    this.opts.onStatusChange?.("syncing");
    try {
      const accounts = (await cache.listAccounts()).filter((a) => a.enabled);
      for (const account of accounts) {
        if (gen !== this.generation) return; // stopped/superseded mid-cycle
        try {
          const target = await buildTarget(account);
          if (!target) continue;
          wroteData = (await this.refreshAccount(account, target, gen)) || wroteData;
        } catch (e) {
          hadError = true;
          const msg = e instanceof Error ? e.message : String(e);
          firstError = firstError ?? `${account.label}: ${msg}`;
          await cache.setScopeState(account.id, "account", { lastError: msg }).catch(() => {});
        }
      }
    } finally {
      this.running = false;
    }
    if (gen !== this.generation) return;
    if (wroteData) this.opts.onDataChanged?.();
    this.opts.onStatusChange?.(hadError ? "error" : "idle", firstError);
  }

  private async refreshAccount(account: PimAccountRow, target: IPimTarget, gen: number): Promise<boolean> {
    const { cache } = this.opts;
    const { startTs, endTs } = this.windowRange;
    let wrote = false;

    const calendars = await target.listCalendars();
    if (gen !== this.generation) return wrote;
    await cache.replaceCalendars(account.id, calendars);
    wrote = true;

    let calendarError: string | undefined;
    for (const cal of await cache.listCalendars(account.id)) {
      if (gen !== this.generation) return wrote;
      if (!cal.selected) continue;
      try {
        const { events } = await target.pullEvents(cal.id, startTs, endTs);
        if (gen !== this.generation) return wrote;
        await cache.replaceEventWindow(account.id, cal.id, startTs, endTs, events);
        await cache.setScopeState(account.id, `events:${cal.id}`, { lastError: null });
      } catch (e) {
        // One calendar failing (permissions, transient 5xx) must not lose the
        // account's other calendars — record, continue, surface at the end.
        const msg = e instanceof Error ? e.message : String(e);
        calendarError = calendarError ?? msg;
        await cache.setScopeState(account.id, `events:${cal.id}`, { lastError: msg }).catch(() => {});
      }
    }

    const lists = await target.listTaskLists().catch(() => null);
    if (gen !== this.generation) return wrote;
    if (lists) {
      await cache.replaceTaskLists(account.id, lists);
      for (const list of await cache.listTaskLists(account.id)) {
        if (gen !== this.generation) return wrote;
        if (!list.selected) continue;
        const { tasks } = await target.pullTasks(list.id);
        if (gen !== this.generation) return wrote;
        await cache.replaceTasks(account.id, list.id, tasks);
        await cache.setScopeState(account.id, `tasks:${list.id}`, { lastError: null });
      }
    }
    await cache.setScopeState(account.id, "account", { lastError: calendarError ?? null });
    if (calendarError) throw new Error(calendarError);
    return wrote;
  }
}
