import type { PimCacheRepository, PimAccountRow } from "./PimCacheRepository.js";
import { classifySyncError } from "../sync/errorKind.js";
import type { IPimTarget, PimEvent, PimTaskList } from "./types.js";
import { eventCalendarsOf } from "./types.js";
import { inheritSeriesTitles } from "./seriesTitle.js";
import { decodeEventCursor, encodeEventCursor, needsFullRefresh } from "./eventCursor.js";

/**
 * Periodic PIM pull loop (stage 2, read-only): refreshes calendars, the
 * rolling event window and task lists/tasks of every enabled account into the
 * cache. Deliberately simpler than the file SyncWorker — windowed full
 * refreshes have no reconcile state to corrupt — but keeps its safety
 * furniture: a generation guard against overlapping cycles, per-account
 * isolation — in errors AND in time, one failing or hanging account never
 * blocks the others — and error surfacing through the scope state + status
 * callback.
 */

export type PimStatus = "idle" | "syncing" | "error";

export interface PimWorkerOptions {
  cache: PimCacheRepository;
  /** Builds a ready-to-use target for the account (credentials live in the
   * shell's keychain — the worker never sees them). null = skip account. */
  buildTarget: (account: PimAccountRow) => Promise<IPimTarget | null>;
  onStatusChange?: (status: PimStatus, message?: string) => void;
  /**
   * What the status says when every account is parked on a dead sign-in
   * (N1/S2). The shell passes a translated sentence; the fallback exists so the
   * worker is usable without one.
   */
  parkedMessage?: string;
  /** Fired after a cycle wrote fresh data — the UI re-queries the cache. */
  onDataChanged?: () => void;
  intervalMs?: number;
  /** Rolling event window around "now". */
  windowPastDays?: number;
  windowFutureDays?: number;
  now?: () => number;
}

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Accounts refreshed at once; each of them pulls its calendars in batches too. */
const ACCOUNT_CONCURRENCY = 3;

export class PimWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  /** The orphan sweep is a per-run housekeeping job, not a per-cycle one. */
  private pruned = false;
  private running = false;
  /** Only an explicit stop() parks the worker — a manual triggerImmediate()
   * must work without (before) start(), e.g. on opening the calendar tab. */
  private stopped = false;
  /** A manual trigger that arrived while a cycle was running: re-runs at the end
   * so "Jetzt aktualisieren" during a cycle is never a silent no-op. */
  private pendingTrigger = false;
  /** Next cycle asks parked accounts again — set by a manual refresh (N1/S2). */
  private retryParked = false;

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

  /** Manual refresh ("Jetzt aktualisieren" / opening the calendar tab). A trigger
   * during a running cycle is queued and drained when that cycle ends.
   *
   * A manual trigger also gives every parked account one more go (N1/S2): the
   * user asking is exactly the moment to stop assuming the sign-in is still
   * dead — they may have just repaired it elsewhere. */
  async triggerImmediate(): Promise<void> {
    this.retryParked = true;
    if (this.running) {
      this.pendingTrigger = true;
      return;
    }
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
    const retryParked = this.retryParked;
    this.retryParked = false;
    const gen = ++this.generation;
    const { cache, buildTarget } = this.opts;
    let hadError = false;
    let firstError: string | undefined;
    let wroteData = false;
    this.opts.onStatusChange?.("syncing");
    try {
      // Once per run, before anything reads the cache: rows of accounts that no
      // longer exist are dead weight today and would surface as ghost entries
      // the day a query stops filtering by account (finding 2026-07-30). A
      // failure here is never worth losing a cycle over.
      if (!this.pruned) {
        this.pruned = true;
        await cache.pruneOrphanedRows().catch(() => {});
      }
      const enabled = (await cache.listAccounts()).filter((a) => a.enabled);
      /**
       * An account whose last failure was an ANSWER is skipped (N1/S2).
       *
       * A revoked or expired sign-in does not heal by being asked again: it
       * spends a connection, its timeouts and its retries, and fails the same
       * way every cycle — forever, on a phone that is paying for those rounds.
       * Its state stays exactly as it is, so the account keeps saying what is
       * wrong; only the pointless network trip is gone.
       *
       * Two things bring it back: a manual refresh (the user asking is reason
       * enough to try) and a re-authorisation, which clears the state. A row
       * from before this column existed reads as unknown and is retried — an
       * upgrade must never park a working account.
       */
      const parked = retryParked
        ? new Set<string>()
        : new Set(
            (
              await Promise.all(
                enabled.map(async (a) => {
                  const st = await cache.getScopeState(a.id, "account").catch(() => null);
                  return st?.lastErrorKind === "fatal" ? a.id : null;
                })
              )
            ).filter((id): id is string => id !== null)
          );
      const accounts = enabled.filter((a) => !parked.has(a.id));
      if (parked.size > 0 && accounts.length === 0) {
        // Nothing left to ask. Say the standing state rather than "ok", which
        // would read as though the calendars were fresh. NOT an early return:
        // the tail below drains a manual trigger that arrived mid-cycle, and
        // dropping that would make "refresh" a no-op exactly when the user is
        // trying to get out of this state.
        hadError = true;
        firstError = this.opts.parkedMessage ?? "sign-in required";
      }
      // Accounts refresh CONCURRENTLY. They share nothing but the cache, and
      // every write inside is scoped to one account, so there is no order to
      // preserve between them — while sequentially a single slow or dead
      // account held up every account behind it. An expired sign-in is the bad
      // case: it spends its timeouts and retries before failing, and the next
      // account's calendars only appear afterwards ("the second calendar takes
      // forever", finding 2026-07-30).
      const errors: Array<string | undefined> = new Array(accounts.length);
      for (let i = 0; i < accounts.length; i += ACCOUNT_CONCURRENCY) {
        if (gen !== this.generation) return; // stopped/superseded mid-cycle
        const batch = accounts.slice(i, i + ACCOUNT_CONCURRENCY);
        const settled = await Promise.all(
          batch.map(async (account, n) => {
            try {
              const target = await buildTarget(account);
              if (!target) return { at: i + n, wrote: false };
              return { at: i + n, wrote: await this.refreshAccount(account, target, gen) };
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              await cache
                .setScopeState(account.id, "account", { lastError: msg, lastErrorKind: classifySyncError(e) })
                .catch(() => {});
              return { at: i + n, wrote: false, error: `${account.label}: ${msg}` };
            }
          })
        );
        for (const done of settled) {
          wroteData = done.wrote || wroteData;
          if (done.error) {
            hadError = true;
            errors[done.at] = done.error;
          }
        }
      }
      // Report the first failure in ACCOUNT order: which one lost the race must
      // not decide what the status bar says. A parked-only cycle already set
      // its own sentence and has no errors to find.
      firstError = errors.find(Boolean) ?? firstError;
    } finally {
      this.running = false;
    }
    if (gen !== this.generation) return;
    if (wroteData) this.opts.onDataChanged?.();
    this.opts.onStatusChange?.(hadError ? "error" : "idle", firstError);
    // Drain a manual trigger that arrived mid-cycle (never a silent no-op).
    if (this.pendingTrigger && !this.stopped) {
      this.pendingTrigger = false;
      void this.runCycle();
    }
  }

  private async refreshAccount(account: PimAccountRow, target: IPimTarget, gen: number): Promise<boolean> {
    const { cache } = this.opts;
    const { startTs, endTs } = this.windowRange;
    let wrote = false;

    // ONE collection listing per cycle. CalDAV reminder lists arrive in the same
    // listing as the calendars and are told apart here — a VTODO-only collection
    // must never reach the calendar picker (issue #34).
    const collections = await target.listCalendars();
    if (gen !== this.generation) return wrote;
    await cache.replaceCalendars(account.id, eventCalendarsOf(collections));
    wrote = true;

    // Pull the selected calendars CONCURRENTLY (network-bound), in small batches,
    // then apply the writes serially (SQLite is a single writer). A windowed full
    // refresh has no reconcile state to corrupt, so parallel pulls are safe; this
    // is the main per-cycle cost, so it drives the "faster sync" win.
    const selected = (await cache.listCalendars(account.id)).filter((c) => c.selected);
    const PULL_CONCURRENCY = 4;
    const supportsDelta = typeof target.pullEventsDelta === "function";
    // The worker's OWN clock, not the wall clock: the window range already
    // uses it, and two time sources in one cycle would age the cursor against
    // a different "now" than the events it guards.
    const now = this.opts.now ? this.opts.now() : Date.now();
    type Pulled = {
      calId: string;
      /** Full refresh: replace the window. Delta: upsert + the named deletions. */
      full: boolean;
      events?: PimEvent[];
      deletedUids?: string[];
      deletedHrefs?: string[];
      /** What to store; `null` drops the cursor so the next cycle re-anchors.
       * Required, not optional: every path must say so out loud, because
       * leaving it out at the write site would mean "keep the old one". */
      cursor: string | null;
      error?: string;
    };
    const pulled: Pulled[] = [];
    for (let i = 0; i < selected.length; i += PULL_CONCURRENCY) {
      if (gen !== this.generation) return wrote;
      const batch = selected.slice(i, i + PULL_CONCURRENCY);
      const settled = await Promise.all(
        batch.map(async (cal): Promise<Pulled> => {
          const scope = `events:${cal.id}`;
          const stored = decodeEventCursor((await cache.getScopeState(account.id, scope).catch(() => null))?.cursor);
          const full = needsFullRefresh(stored, now, supportsDelta);
          try {
            if (full) {
              // Seed the cursor BEFORE the listing, so a change landing during
              // it is caught next cycle rather than dropped in the gap — the
              // file sync's rule, and the reason a delta may not start "after"
              // a refresh. Seeding must never cost the refresh itself.
              let token: string | null = null;
              if (target.pullEventsDelta) {
                token = await target
                  .pullEventsDelta(cal.id, null, startTs, endTs)
                  .then((r) => r.nextCursor)
                  .catch(() => null);
              }
              const { events } = await target.pullEvents(cal.id, startTs, endTs);
              // A series occurrence without its own title borrows the series'
              // (S8). Applied here rather than in each adapter: this is where
              // every provider's rows converge, so a future adapter cannot forget
              // it, and both shells run this worker.
              return {
                calId: cal.id,
                full: true,
                events: inheritSeriesTitles(events),
                cursor: token ? encodeEventCursor({ token, fullAt: now }) : null,
              };
            }
            const res = await target.pullEventsDelta!(cal.id, stored!.token, startTs, endTs);
            return {
              calId: cal.id,
              full: false,
              events: inheritSeriesTitles(res.events),
              deletedUids: res.deletedUids,
              deletedHrefs: res.deletedHrefs,
              cursor: encodeEventCursor({ token: res.nextCursor, fullAt: stored!.fullAt }),
            };
          } catch (e) {
            // One calendar failing (permissions, transient 5xx) must not lose the
            // account's other calendars — record, continue, surface at the end.
            // The cursor goes with it: a rejected or expired token must not park
            // the calendar on a feed it can no longer follow, so the next cycle
            // is a full refresh and heals itself.
            return { calId: cal.id, full, cursor: null, error: e instanceof Error ? e.message : String(e) };
          }
        })
      );
      pulled.push(...settled);
    }
    let calendarError: string | undefined;
    for (const r of pulled) {
      if (gen !== this.generation) return wrote;
      if (r.error) {
        calendarError = calendarError ?? r.error;
        await cache
          // `cursor` is what the pull decided, never coalesced here: a failed
          // step returns null, and null means "drop it" while `undefined`
          // would mean "keep it". Coalescing would hide that distinction.
          .setScopeState(account.id, `events:${r.calId}`, { cursor: r.cursor, lastError: r.error })
          .catch(() => {});
      } else {
        if (r.full) await cache.replaceEventWindow(account.id, r.calId, startTs, endTs, r.events!);
        else await cache.applyEventDelta(account.id, r.calId, r.events!, r.deletedUids ?? [], r.deletedHrefs ?? []);
        await cache.setScopeState(account.id, `events:${r.calId}`, { cursor: r.cursor, lastError: null });
      }
    }

    // Task lists: a failure here used to be swallowed (`.catch(() => null)`),
    // which silently meant "this account has no task lists" — for good, and
    // without a word to the user (issue #34). Now the previously known lists
    // stay put and the reason is recorded for the settings UI to show.
    let lists: PimTaskList[] | null = null;
    try {
      lists = await target.listTaskLists(collections);
      await cache.setScopeState(account.id, "tasklists", { lastError: null });
    } catch (e) {
      await cache
        .setScopeState(account.id, "tasklists", { lastError: e instanceof Error ? e.message : String(e) })
        .catch(() => {});
    }
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
    await cache.setScopeState(account.id, "account", {
      // No explicit kind on purpose. A calendar failure is re-thrown two lines
      // below, and the account-level catch is what records the verdict — one
      // owner, not two that could disagree. On the success path the repository
      // default (null) clears the previous verdict, which matters: a cleared
      // error that kept its kind would park the account on the NEXT failure of
      // any kind, because the row would still read "fatal".
      lastError: calendarError ?? null,
    });
    if (calendarError) throw new Error(calendarError);
    return wrote;
  }
}
