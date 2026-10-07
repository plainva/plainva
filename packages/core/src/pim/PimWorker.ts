import type { PimCacheRepository, PimAccountRow } from "./PimCacheRepository.js";
import { classifySyncError, isSignInFailure, type SyncErrorKind } from "../sync/errorKind.js";
import type { IPimTarget, PimEvent, PimProviderId, PimTaskList } from "./types.js";
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
 *
 * **Who is asked, and when** (decision E7, plan Befunde 2026-10-06):
 *  - Only a failed SIGN-IN parks an account. It stays parked until the
 *    sign-in changes or the person refreshes by hand — asking a revoked
 *    authorisation again answers the same way every time.
 *  - Every other account failure is asked again by the timer on its own,
 *    with a growing pause (`pimRetryDelayMs`): a server that is down for the
 *    night is not knocked on every two minutes, and nobody has to press a
 *    button in the morning.
 *  - A failure on ONE calendar is that calendar's: the account's other
 *    calendars sync, the failing one keeps what the cache holds and is
 *    retried with the same growing pause.
 *  - A failed write to the local cache is temporary by definition — it says
 *    nothing about the provider or the sign-in.
 */

export type PimStatus = "idle" | "syncing" | "error";

export interface PimWorkerOptions {
  cache: PimCacheRepository;
  /** Builds a ready-to-use target for the account (credentials live in the
   * shell's keychain — the worker never sees them). null = skip account. */
  buildTarget: (account: PimAccountRow) => Promise<IPimTarget | null>;
  /** Opaque sign-in revision, never a token or password. Refreshes retain it. */
  accountAuthRevision?: (account: PimAccountRow) => Promise<string | undefined>;
  onStatusChange?: (status: PimStatus, message?: string) => void;
  /**
   * What the status says when every account is parked on a dead sign-in
   * (N1/S2). The shell passes a translated sentence; the fallback exists so the
   * worker is usable without one.
   */
  parkedMessage?: string;
  /** Fired after a cycle wrote fresh data — the UI re-queries the cache. */
  onDataChanged?: () => void;
  /**
   * One line per finished cycle, for the diagnostics log (finding 2026-09-20:
   * two provider pulls 14 s apart, and nothing on record said what had asked
   * for the second one). Never carries data — only why it ran and how long.
   */
  onCycle?: (info: PimCycleInfo) => void;
  intervalMs?: number;
  /** Rolling event window around "now". */
  windowPastDays?: number;
  windowFutureDays?: number;
  now?: () => number;
}

/** Why a cycle ran: the worker starting, its timer, a manual refresh, or a
 *  manual refresh that arrived mid-cycle and was run afterwards. */
export type PimCycleCause = "start" | "timer" | "manual" | "queued";

export interface PimCycleInfo {
  cause: PimCycleCause;
  ms: number;
  wroteData: boolean;
  hadError: boolean;
  /** Manual triggers the cycle answered without a second run (see TRIGGER_COALESCE_MS). */
  coalesced: number;
  /**
   * One entry per enabled account, in account order (K1): the cycle line used
   * to end in "with errors" and nothing on record said which account or why.
   * Deliberately without the account's label, calendar names or titles — the
   * provider and the position are enough to tell two accounts apart in a log.
   */
  accounts: PimCycleAccount[];
}

export interface PimCycleAccount {
  provider: PimProviderId;
  /** Events the providers handed over in this cycle (full pulls and deltas). */
  events: number;
  /** The account-level failure, in the provider's own words. */
  error?: string;
  /** How many of its calendars failed or are waiting for their retry. */
  calendarErrors?: number;
  /** Not asked this cycle: parked on its sign-in, or waiting for its retry. */
  skipped?: "parked" | "waiting";
}

/** A write to the local cache failed. Never the provider's fault and never
 * the sign-in's — the worker treats it as temporary whatever the text says. */
export class PimCacheWriteError extends Error {
  constructor(cause: unknown) {
    super(`local calendar cache: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "PimCacheWriteError";
  }
}

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;
/** The longest pause between two automatic attempts on something that keeps failing. */
export const PIM_RETRY_CAP_MS = 30 * 60 * 1000;

/**
 * How long to leave a failing account or calendar alone after its n-th
 * failure in a row: one interval, then two, four, eight — capped, so even a
 * permanently broken one is asked twice an hour and heals without a hand.
 */
export function pimRetryDelayMs(failures: number, intervalMs: number): number {
  const doublings = Math.max(0, Math.min(failures, 16) - 1);
  return Math.min(PIM_RETRY_CAP_MS, intervalMs * 2 ** doublings);
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
/**
 * A manual trigger this soon after a cycle started is ANSWERED by that cycle:
 * nothing has been read from a provider yet that could be older than the
 * request. Queueing it anyway ran every such request twice — `start()` followed
 * by `triggerImmediate()` is a common pair (a login finishing, an account being
 * enabled, a view opening right after the vault), and each pair cost two full
 * pulls of every calendar and task list (finding 2026-09-20). Later triggers
 * still queue: by then the cycle may have passed the list the person changed.
 */
export const TRIGGER_COALESCE_MS = 1500;
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
  /** When the running cycle began, and how many triggers it absorbed. */
  private cycleStartedAt = 0;
  private coalesced = 0;
  /**
   * Accounts (key: account id) and calendars (key: account id + calendar id)
   * whose last attempts failed for a reason that may pass. In memory on
   * purpose: a restart is a reason to ask once, and the count that matters is
   * "in a row, in this run".
   */
  private retries = new Map<string, { failures: number; notBefore: number; message: string }>();

  constructor(private opts: PimWorkerOptions) {}

  private noteFailure(key: string, message: string): void {
    const failures = (this.retries.get(key)?.failures ?? 0) + 1;
    const interval = this.opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    // Half an interval of slack: the timer ticks a moment later than the
    // failure it follows, and "one interval" must mean the very next tick.
    this.retries.set(key, { failures, notBefore: this.clock() + pimRetryDelayMs(failures, interval) - interval / 2, message });
  }

  /** The stored failure while its pause is still running, else null. */
  private waitingOn(key: string, now: number): string | null {
    const retry = this.retries.get(key);
    return retry && retry.notBefore > now ? retry.message : null;
  }

  /** A cache write, marked as one: see `PimCacheWriteError`. */
  private async store<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (e) {
      throw new PimCacheWriteError(e);
    }
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.runCycle("timer"), this.opts.intervalMs ?? DEFAULT_INTERVAL_MS);
    void this.runCycle("start");
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
    if (this.running) {
      // The cycle that just began answers this request (TRIGGER_COALESCE_MS) —
      // provided it also gives parked accounts their go, which is half of what
      // a manual refresh promises. Before the cycle has decided whom to skip,
      // the request simply rides along (`retryParked` is read at that point);
      // afterwards only a cycle that skipped nobody may swallow it.
      const early = this.clock() - this.cycleStartedAt <= TRIGGER_COALESCE_MS;
      if (early && this.parkedSkipped !== true) {
        if (this.parkedSkipped === null) this.retryParked = true;
        this.coalesced++;
        return;
      }
      this.retryParked = true;
      this.pendingTrigger = true;
      return;
    }
    this.retryParked = true;
    await this.runCycle("manual");
  }

  private clock(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  get windowRange(): { startTs: number; endTs: number } {
    const now = this.opts.now ? this.opts.now() : Date.now();
    const startTs = now - (this.opts.windowPastDays ?? 60) * DAY_MS;
    const endTs = now + (this.opts.windowFutureDays ?? 400) * DAY_MS;
    return { startTs, endTs };
  }

  /** Whether the running cycle skipped a parked account: null = not decided yet. */
  private parkedSkipped: boolean | null = null;

  private async runCycle(cause: PimCycleCause): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    this.cycleStartedAt = this.clock();
    this.coalesced = 0;
    this.parkedSkipped = null;
    const gen = ++this.generation;
    const { cache, buildTarget } = this.opts;
    let hadError: boolean;
    let firstError: string | undefined;
    let wroteData = false;
    let report: PimCycleAccount[];
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
      // Capture before constructing targets. A late failure from an old login
      // must never claim the revision of a newly saved login.
      const revisions = new Map(await Promise.all(enabled.map(async (account) => [
        account.id, await this.opts.accountAuthRevision?.(account).catch(() => undefined),
      ] as const)));
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
       * enough to try) and a fresh sign-in revision, even in a closed vault. A row
       * from before this column existed reads as unknown and is retried — an
       * upgrade must never park a working account.
       *
       * "An answer" means the SIGN-IN said no (E7). The stored verdict alone
       * is not enough: `fatal` is also what a 403 on one calendar, a 404 or an
       * unrecognised sentence got, and older builds parked on all of them —
       * and on a request that was never answered (finding 2026-09-24). Reading
       * the text again releases every such account on the first cycle after
       * the update.
       */
      // Read HERE, not at the top of the cycle: a manual trigger that arrives
      // while the accounts are still being listed rides along with this cycle
      // (see triggerImmediate), and its half of the promise is this flag.
      const retryParked = this.retryParked;
      this.retryParked = false;
      const parked = retryParked
        ? new Set<string>()
        : new Set(
            (
              await Promise.all(
                enabled.map(async (a) => {
                  const st = await cache.getScopeState(a.id, "account").catch(() => null);
                  const revision = revisions.get(a.id);
                  if (st?.lastErrorKind !== "fatal" || !isSignInFailure(st.lastError ?? "")) return null;
                  return !revision || revision === st.authRevision ? a.id : null;
                })
              )
            ).filter((id): id is string => id !== null)
          );
      // An account whose last attempts failed for a reason that may pass is
      // left alone until its pause is over — unless the person asked.
      const cycleNow = this.clock();
      const waiting = new Map<string, string>();
      if (!retryParked) {
        for (const a of enabled) {
          const message = parked.has(a.id) ? null : this.waitingOn(a.id, cycleNow);
          if (message !== null) waiting.set(a.id, message);
        }
      }
      const accounts = enabled.filter((a) => !parked.has(a.id) && !waiting.has(a.id));
      // "Skipped" covers both: a manual refresh promises to ask everyone, and
      // a cycle that left an account out for either reason cannot answer it.
      this.parkedSkipped = parked.size > 0 || waiting.size > 0;
      const parkedMessage = this.opts.parkedMessage ?? "sign-in required";
      // What the cycle says about each enabled account, in account order: the
      // ones it does not ask keep saying what is wrong with them. Saying "ok"
      // would read as though their calendars were fresh. NOT an early return
      // when nobody is left to ask: the tail below drains a manual trigger
      // that arrived mid-cycle, and dropping that would make "refresh" a no-op
      // exactly when the user is trying to get out of this state.
      const errors = new Map<string, string>();
      const stats = new Map<string, PimCycleAccount>();
      for (const a of enabled) {
        stats.set(a.id, { provider: a.provider, events: 0 });
        if (parked.has(a.id)) {
          stats.get(a.id)!.skipped = "parked";
          errors.set(a.id, enabled.length === 1 ? parkedMessage : `${a.label}: ${parkedMessage}`);
        } else if (waiting.has(a.id)) {
          stats.get(a.id)!.skipped = "waiting";
          stats.get(a.id)!.error = waiting.get(a.id);
          errors.set(a.id, `${a.label}: ${waiting.get(a.id)}`);
        }
      }
      report = enabled.map((a) => stats.get(a.id)!);
      // Accounts refresh CONCURRENTLY. They share nothing but the cache, and
      // every write inside is scoped to one account, so there is no order to
      // preserve between them — while sequentially a single slow or dead
      // account held up every account behind it. An expired sign-in is the bad
      // case: it spends its timeouts and retries before failing, and the next
      // account's calendars only appear afterwards ("the second calendar takes
      // forever", finding 2026-07-30).
      for (let i = 0; i < accounts.length; i += ACCOUNT_CONCURRENCY) {
        if (gen !== this.generation) return; // stopped/superseded mid-cycle
        const batch = accounts.slice(i, i + ACCOUNT_CONCURRENCY);
        const settled = await Promise.all(
          batch.map(async (account) => {
            const stat = stats.get(account.id)!;
            try {
              const target = await buildTarget(account);
              if (!target) return false;
              const done = await this.refreshAccount(account, target, gen, retryParked);
              stat.events = done.events;
              if (done.calendarErrors.length > 0) {
                stat.calendarErrors = done.calendarErrors.length;
                errors.set(account.id, `${account.label}: ${done.calendarErrors[0]}`);
              }
              if (!done.superseded) this.retries.delete(account.id);
              return done.wrote;
            } catch (e) {
              if (gen !== this.generation) return false;
              const msg = messageOf(e);
              // The sign-in is the one thing that parks (E7). A failed write
              // to the local cache is never it, whatever its text contains.
              const cacheWrite = e instanceof PimCacheWriteError;
              const signIn = !cacheWrite && isSignInFailure(e);
              // A failed sign-in is an answer however its sentence classifies
              // otherwise — a verdict of "transient" would leave it neither
              // parked nor paused, asked every cycle for good.
              const kind: SyncErrorKind = cacheWrite ? "transient" : signIn ? "fatal" : classifySyncError(e);
              await cache
                .recordScopeFailure(account.id, "account", { lastError: msg, lastErrorKind: kind, authRevision: revisions.get(account.id) ?? null })
                .catch(() => {});
              if (signIn) this.retries.delete(account.id);
              else this.noteFailure(account.id, msg);
              stat.error = msg;
              errors.set(account.id, `${account.label}: ${msg}`);
              return false;
            }
          })
        );
        for (const wrote of settled) wroteData = wrote || wroteData;
      }
      // Report the first failure in ACCOUNT order: which one lost the race must
      // not decide what the status bar says.
      firstError = enabled.map((a) => errors.get(a.id)).find(Boolean);
      hadError = firstError !== undefined;
    } finally {
      this.running = false;
    }
    if (gen !== this.generation) return;
    try {
      this.opts.onCycle?.({ cause, ms: this.clock() - this.cycleStartedAt, wroteData, hadError, coalesced: this.coalesced, accounts: report });
    } catch {
      /* diagnostics are best effort */
    }
    if (wroteData) this.opts.onDataChanged?.();
    this.opts.onStatusChange?.(hadError ? "error" : "idle", firstError);
    // Drain a manual trigger that arrived mid-cycle (never a silent no-op).
    if (this.pendingTrigger && !this.stopped) {
      this.pendingTrigger = false;
      void this.runCycle("queued");
    }
  }

  /**
   * One account's cycle. THROWS for a failure of the account itself — the
   * listing, a write to the cache, a sign-in that died mid-cycle; the caller
   * records the verdict. Failures of single calendars come back in
   * `calendarErrors` and cost only those calendars.
   */
  private async refreshAccount(
    account: PimAccountRow,
    target: IPimTarget,
    gen: number,
    askEveryone: boolean
  ): Promise<{ wrote: boolean; events: number; calendarErrors: string[]; superseded: boolean }> {
    const { cache } = this.opts;
    const { startTs, endTs } = this.windowRange;
    let wrote = false;
    let eventCount = 0;
    const calendarErrors: string[] = [];
    const stoppedHere = () => ({ wrote, events: eventCount, calendarErrors, superseded: true });

    // ONE collection listing per cycle. CalDAV reminder lists arrive in the same
    // listing as the calendars and are told apart here — a VTODO-only collection
    // must never reach the calendar picker (issue #34).
    const collections = await target.listCalendars();
    if (gen !== this.generation) return stoppedHere();
    await this.store(() => cache.replaceCalendars(account.id, eventCalendarsOf(collections)));
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
      /** The verdict for `error`, and whether it was the sign-in that failed. */
      kind?: SyncErrorKind;
      signIn?: boolean;
    };
    const calKey = (calId: string) => `${account.id}\n${calId}`;
    // A calendar whose pull keeps failing waits out its own pause (E7): it
    // keeps what the cache holds, keeps saying why, and the calendars beside
    // it are pulled as if it were not there.
    const due = selected.filter((cal) => {
      const waitingOn = askEveryone ? null : this.waitingOn(calKey(cal.id), now);
      if (waitingOn !== null) calendarErrors.push(waitingOn);
      return waitingOn === null;
    });
    const pulled: Pulled[] = [];
    for (let i = 0; i < due.length; i += PULL_CONCURRENCY) {
      if (gen !== this.generation) return stoppedHere();
      const batch = due.slice(i, i + PULL_CONCURRENCY);
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
            return { calId: cal.id, full, cursor: null, error: messageOf(e), kind: classifySyncError(e), signIn: isSignInFailure(e) };
          }
        })
      );
      pulled.push(...settled);
    }
    // The failures first: they are bookkeeping only, and recording them must
    // not depend on a write further down getting through.
    let signInError: string | undefined;
    for (const r of pulled) {
      if (gen !== this.generation) return stoppedHere();
      if (!r.error) continue;
      calendarErrors.push(r.error);
      if (r.signIn) signInError = signInError ?? r.error;
      else this.noteFailure(calKey(r.calId), r.error);
      await cache
        // `cursor` is what the pull decided, never coalesced here: a failed
        // step returns null, and null means "drop it" while `undefined`
        // would mean "keep it". Coalescing would hide that distinction.
        // Through `recordScopeFailure`, so the row keeps saying since when.
        .recordScopeFailure(account.id, `events:${r.calId}`, { cursor: r.cursor, lastError: r.error, lastErrorKind: r.kind ?? null })
        .catch(() => {});
    }
    for (const r of pulled) {
      if (gen !== this.generation) return stoppedHere();
      if (r.error) continue;
      // A write that fails here THROWS and ends the account's cycle as a
      // temporary failure. Each replace is one atomic step, so every calendar
      // not reached keeps exactly what it had; going on would only wait out
      // the same lock once per calendar.
      await this.store(async () => {
        if (r.full) await cache.replaceEventWindow(account.id, r.calId, startTs, endTs, r.events!);
        else await cache.applyEventDelta(account.id, r.calId, r.events!, r.deletedUids ?? [], r.deletedHrefs ?? []);
        await cache.setScopeState(account.id, `events:${r.calId}`, { cursor: r.cursor, lastError: null });
      });
      eventCount += r.events!.length;
      this.retries.delete(calKey(r.calId));
    }
    // A sign-in that died on a calendar pull is the ACCOUNT's failure: every
    // other calendar would answer the same way next time. What did get through
    // is already stored; the caller parks the account.
    if (signInError) throw new Error(signInError);

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
    if (gen !== this.generation) return stoppedHere();
    if (lists) {
      const fresh = lists;
      await this.store(() => cache.replaceTaskLists(account.id, fresh));
      for (const list of await cache.listTaskLists(account.id)) {
        if (gen !== this.generation) return stoppedHere();
        if (!list.selected) continue;
        const { tasks } = await target.pullTasks(list.id);
        if (gen !== this.generation) return stoppedHere();
        await this.store(async () => {
          await cache.replaceTasks(account.id, list.id, tasks);
          await cache.setScopeState(account.id, `tasks:${list.id}`, { lastError: null });
        });
      }
    }
    await this.store(() =>
      cache.setScopeState(account.id, "account", {
        // No verdict on purpose: the account itself got through. A calendar
        // that failed is named here as the account's summary (the settings
        // show this line) and carries its own verdict on its own row; a row
        // WITHOUT a verdict is how `listSyncProblems` tells "one calendar"
        // from "the account". On the clean path the repository default (null)
        // clears the previous verdict, which matters: a cleared error that
        // kept its kind would still read "fatal".
        lastError: calendarErrors[0] ?? null,
      })
    );
    return { wrote, events: eventCount, calendarErrors, superseded: false };
  }
}
