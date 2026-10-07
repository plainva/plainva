import { beforeEach, describe, expect, it, vi } from "vitest";
import { PIM_RETRY_CAP_MS, PimWorker, pimRetryDelayMs, type PimCycleInfo } from "../src/pim/PimWorker.ts";
import { PimCacheRepository } from "../src/pim/PimCacheRepository.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import type { IPimTarget, PimEvent } from "../src/pim/types.ts";
import { classifySyncError, isLocalStoreBusy, isSignInFailure } from "../src/sync/errorKind.ts";

/**
 * Who is asked again, and when (decision E7, plan Befunde 2026-10-06, K1).
 *
 * Before: everything `classifySyncError` did not recognise as temporary parked
 * the account until someone pressed "refresh" — a locked local database, a 403
 * on ONE calendar, a 404. Now only a failed sign-in parks; the rest is retried
 * by the timer with a growing pause, and a calendar's failure is that
 * calendar's.
 */

const { DatabaseSync } = (await import("node:sqlite")) as any;

class NodeSqliteAdapter implements IDatabaseAdapter {
  constructor(private db: any) {}
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    return ((this.db.prepare(sql).all(...(params as never[])) as T[])[0] ?? null) as T | null;
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

const T0 = Date.parse("2026-10-06T08:00:00Z");
const MIN = 60_000;
const INTERVAL = 2 * MIN;

const notUnderTest = async () => {
  throw new Error("not under test");
};

function ev(uid: string, calendarId: string): PimEvent {
  const ts = T0 + 3600_000;
  return { uid, calendarId, title: uid, start: { ts }, end: { ts: ts + 3600_000 }, allDay: false };
}

interface Knobs {
  listError?: Error | null;
  /** Per calendar id: the error its pull throws, while set. */
  pullError: Record<string, Error | undefined>;
  events: PimEvent[];
}

function target(knobs: Knobs) {
  const listCalendars = vi.fn(async () => {
    if (knobs.listError) throw knobs.listError;
    return [
      { id: "cal1", name: "Team" },
      { id: "cal2", name: "Private" },
    ];
  });
  const pullEvents = vi.fn(async (calendarId: string) => {
    const error = knobs.pullError[calendarId];
    if (error) throw error;
    return { events: knobs.events.filter((e) => e.calendarId === calendarId) };
  });
  const t: IPimTarget = {
    provider: "caldav",
    listCalendars,
    pullEvents,
    listTaskLists: async () => [],
    pullTasks: async () => ({ tasks: [] }),
    createEvent: notUnderTest,
    updateEvent: notUnderTest,
    deleteEvent: notUnderTest,
    createTask: notUnderTest,
    updateTask: notUnderTest,
    deleteTask: notUnderTest,
  };
  return { t, listCalendars, pullEvents };
}

const pullsOf = (fn: ReturnType<typeof vi.fn>, calId: string) => fn.mock.calls.filter((c) => c[0] === calId).length;

describe("PimWorker: who is asked again (E7)", () => {
  let cache: PimCacheRepository;
  let clock: number;
  let cycles: PimCycleInfo[];
  let statuses: Array<[string, string | undefined]>;
  let knobs: Knobs;

  beforeEach(async () => {
    const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);
    cache = new PimCacheRepository(db);
    await cache.upsertAccount({ id: "a1", provider: "caldav", label: "Work", config: {}, enabled: true });
    clock = T0;
    cycles = [];
    statuses = [];
    knobs = { pullError: {}, events: [ev("e1", "cal1"), ev("e2", "cal2")] };
  });

  function workerFor(t: IPimTarget): PimWorker {
    return new PimWorker({
      cache,
      buildTarget: async () => t,
      now: () => clock,
      intervalMs: INTERVAL,
      onCycle: (info) => cycles.push(info),
      onStatusChange: (s, m) => statuses.push([s, m]),
    });
  }
  /** What the interval timer does, one interval later. */
  async function tick(worker: PimWorker): Promise<void> {
    clock += INTERVAL;
    await (worker as unknown as { runCycle(cause: string): Promise<void> }).runCycle("timer");
  }
  const shown = async () => (await cache.listEvents(0, T0 + 365 * 86400_000)).map((e) => e.uid).sort();

  it("a locked database while writing does not park the account, and nothing is lost", async () => {
    const { t, listCalendars } = target(knobs);
    const worker = workerFor(t);
    await worker.triggerImmediate();
    expect(await shown()).toEqual(["e1", "e2"]);

    const replace = vi.spyOn(cache, "replaceEventWindow").mockRejectedValueOnce(new Error("database is locked"));
    await tick(worker);

    const st = await cache.getScopeState("a1", "account");
    expect(st?.lastError).toContain("database is locked");
    expect(st?.lastErrorKind).toBe("transient");
    // The old events are still there — the replace that failed changed nothing.
    expect(await shown()).toEqual(["e1", "e2"]);
    expect(cycles.at(-1)).toMatchObject({ hadError: true, accounts: [{ provider: "caldav", error: expect.stringContaining("database is locked") }] });

    // The very next tick asks again, on its own, and gets through.
    replace.mockRestore();
    const before = listCalendars.mock.calls.length;
    await tick(worker);
    expect(listCalendars.mock.calls.length).toBe(before + 1);
    expect((await cache.getScopeState("a1", "account"))?.lastError).toBeNull();
    expect(statuses.at(-1)).toEqual(["idle", undefined]);
  });

  it("a lock error does not park even when its text looks like an answer", async () => {
    const { t, listCalendars } = target(knobs);
    const worker = workerFor(t);
    // A store error whose wording would classify as fatal anywhere else.
    vi.spyOn(cache, "replaceCalendars").mockRejectedValueOnce(new Error("constraint failed (code 401)"));
    await worker.triggerImmediate();
    expect((await cache.getScopeState("a1", "account"))?.lastErrorKind).toBe("transient");
    await tick(worker);
    expect(listCalendars).toHaveBeenCalledTimes(2);
  });

  it("a 403 on one calendar costs that calendar only: the others sync, its events stay, the account is not parked", async () => {
    const { t, listCalendars, pullEvents } = target(knobs);
    const worker = workerFor(t);
    await worker.triggerImmediate();
    const firstSync = (await cache.getScopeState("a1", "events:cal1"))?.lastSyncTs;

    knobs.pullError.cal1 = Object.assign(new Error("google api 403 forbidden for https://www.googleapis.com/calendar/v3/calendars/cal1/events"), { status: 403 });
    knobs.events = [ev("e1", "cal1"), ev("e2-new", "cal2")];
    await tick(worker);

    // cal2 moved on, cal1 kept what the cache held.
    expect(await shown()).toEqual(["e1", "e2-new"]);
    // The account itself got through: no verdict, so nothing parks it.
    const account = await cache.getScopeState("a1", "account");
    expect(account?.lastErrorKind).toBeNull();
    expect(account?.lastError).toContain("403");
    // The calendar says why, and since when it has been showing old data.
    expect(await cache.listSyncProblems()).toEqual([
      expect.objectContaining({ accountId: "a1", calendarId: "cal1", calendarName: "Team", since: firstSync, signIn: false, error: expect.stringContaining("403") }),
    ]);
    expect(statuses.at(-1)?.[0]).toBe("error");
    expect(cycles.at(-1)).toMatchObject({ accounts: [{ provider: "caldav", events: 1, calendarErrors: 1 }] });

    // Tick after tick the account is asked and cal2 is pulled…
    const lists = listCalendars.mock.calls.length;
    const cal2 = pullsOf(pullEvents, "cal2");
    await tick(worker);
    await tick(worker);
    expect(listCalendars.mock.calls.length).toBe(lists + 2);
    expect(pullsOf(pullEvents, "cal2")).toBe(cal2 + 2);

    // …and once the calendar answers again, its line is gone.
    knobs.pullError.cal1 = undefined;
    await worker.triggerImmediate();
    expect(await cache.listSyncProblems()).toEqual([]);
    expect((await cache.getScopeState("a1", "account"))?.lastError).toBeNull();
  });

  it("a failing calendar is retried with a growing pause, the calendars beside it every cycle", async () => {
    const { t, pullEvents } = target(knobs);
    const worker = workerFor(t);
    knobs.pullError.cal1 = new Error("caldav report 404");
    await worker.triggerImmediate(); // failure 1
    const asked: number[] = [];
    for (let n = 1; n <= 7; n++) {
      const before = pullsOf(pullEvents, "cal1");
      await tick(worker);
      if (pullsOf(pullEvents, "cal1") > before) asked.push(n);
    }
    // One interval, then two, then four.
    expect(asked).toEqual([1, 3, 7]);
    expect(pullsOf(pullEvents, "cal2")).toBe(8);
    // While it waits, the cycle keeps saying that something is wrong.
    expect(cycles.every((c) => c.hadError)).toBe(true);
  });

  it("an account that failed is retried on its own, with a growing pause", async () => {
    const { t, listCalendars } = target(knobs);
    const worker = workerFor(t);
    knobs.listError = new Error("caldav propfind 500");
    await worker.triggerImmediate(); // failure 1
    expect((await cache.getScopeState("a1", "account"))?.lastErrorKind).toBe("transient");

    const asked: number[] = [];
    for (let n = 1; n <= 7; n++) {
      const before = listCalendars.mock.calls.length;
      await tick(worker);
      if (listCalendars.mock.calls.length > before) asked.push(n);
    }
    expect(asked).toEqual([1, 3, 7]);
    // A cycle that leaves the account alone still says what is wrong with it.
    expect(statuses.at(-1)).toEqual(["error", "Work: caldav propfind 500"]);
    expect(cycles.at(-2)).toMatchObject({ hadError: true, accounts: [{ skipped: "waiting", error: "caldav propfind 500" }] });

    // The person asking is always asked for.
    const before = listCalendars.mock.calls.length;
    await worker.triggerImmediate();
    expect(listCalendars.mock.calls.length).toBe(before + 1);

    // And once it answers, the count starts over: the next tick asks again.
    knobs.listError = null;
    await worker.triggerImmediate();
    expect(statuses.at(-1)).toEqual(["idle", undefined]);
    knobs.listError = new Error("caldav propfind 500");
    await tick(worker); // failure 1 of a new run
    const afterReset = listCalendars.mock.calls.length;
    await tick(worker);
    expect(listCalendars.mock.calls.length).toBe(afterReset + 1);
  });

  it("an answer that is not about the sign-in does not park either (404 on the listing)", async () => {
    const { t, listCalendars } = target(knobs);
    const worker = workerFor(t);
    knobs.listError = Object.assign(new Error("graph list calendars: 404 Not Found"), { status: 404 });
    await worker.triggerImmediate();
    expect((await cache.getScopeState("a1", "account"))?.lastErrorKind).toBe("fatal");
    await tick(worker);
    expect(listCalendars).toHaveBeenCalledTimes(2);
  });

  it("a failed sign-in still parks, and stays parked until someone asks", async () => {
    const { t, listCalendars } = target(knobs);
    const worker = workerFor(t);
    knobs.listError = new Error("invalid_grant");
    await worker.triggerImmediate();
    for (let n = 0; n < 20; n++) await tick(worker);
    expect(listCalendars).toHaveBeenCalledTimes(1);
    expect(cycles.at(-1)).toMatchObject({ hadError: true, accounts: [{ skipped: "parked" }] });
    expect(await cache.listSyncProblems()).toEqual([expect.objectContaining({ accountId: "a1", signIn: true })]);
    await worker.triggerImmediate();
    expect(listCalendars).toHaveBeenCalledTimes(2);
  });

  it("an account an older build parked on something else is asked again at once", async () => {
    await cache.setScopeState("a1", "account", { lastError: "google api 403 forbidden for https://example.invalid/x", lastErrorKind: "fatal", authRevision: null });
    const { t, listCalendars } = target(knobs);
    const worker = workerFor(t);
    await tick(worker);
    expect(listCalendars).toHaveBeenCalledTimes(1);
    expect((await cache.getScopeState("a1", "account"))?.lastError).toBeNull();
  });

  it("a parked account beside a working one is named instead of passing for fresh", async () => {
    await cache.upsertAccount({ id: "a2", provider: "google", label: "Home", config: {}, enabled: true });
    await cache.setScopeState("a2", "account", { lastError: "invalid_grant", lastErrorKind: "fatal", authRevision: null });
    const { t } = target(knobs);
    const worker = new PimWorker({
      cache,
      buildTarget: async () => t,
      now: () => clock,
      intervalMs: INTERVAL,
      parkedMessage: "sign-in required",
      onCycle: (info) => cycles.push(info),
      onStatusChange: (s, m) => statuses.push([s, m]),
    });
    await tick(worker);
    expect(statuses.at(-1)).toEqual(["error", "Home: sign-in required"]);
    // Accounts in label order: Home (parked), Work (asked, two events read).
    expect(cycles.at(-1)?.accounts).toEqual([
      { provider: "google", events: 0, skipped: "parked" },
      { provider: "caldav", events: 2 },
    ]);
  });
});

describe("the pause between two attempts", () => {
  it("doubles from one interval and stops at the cap", () => {
    expect([1, 2, 3, 4, 5].map((n) => pimRetryDelayMs(n, INTERVAL))).toEqual([2, 4, 8, 16, 30].map((m) => m * MIN));
    expect(pimRetryDelayMs(40, INTERVAL)).toBe(PIM_RETRY_CAP_MS);
    expect(pimRetryDelayMs(0, INTERVAL)).toBe(INTERVAL);
    // An interval longer than the cap never waits longer than itself would.
    expect(pimRetryDelayMs(1, 60 * MIN)).toBe(PIM_RETRY_CAP_MS);
  });
});

describe("what kind of failure it was", () => {
  it("a busy local database is temporary, never an answer", () => {
    for (const text of ["database is locked", "error returned from database: (code: 5) database is locked", "SQLITE_BUSY: database is locked", "database table is locked"]) {
      expect(isLocalStoreBusy(new Error(text))).toBe(true);
      expect(classifySyncError(new Error(text))).toBe("transient");
      expect(isSignInFailure(new Error(text))).toBe(false);
    }
    expect(isLocalStoreBusy(new Error("google api 403"))).toBe(false);
  });

  it("only the sign-in is a sign-in failure", () => {
    const yes = [
      "invalid_grant",
      "caldav propfind 401",
      "google api 401 (UNAUTHENTICATED) for https://www.googleapis.com/calendar/v3/users/me/calendarList",
      "no_stored_sign_in: this account has no stored sign-in",
      "AADSTS700082: The refresh token has expired due to inactivity.",
      "The access token has expired",
      "unauthorized_client",
    ];
    for (const text of yes) expect(isSignInFailure(new Error(text)), text).toBe(true);
    expect(isSignInFailure(Object.assign(new Error("request failed"), { status: 401 }))).toBe(true);

    const no = [
      "google api 403 forbidden for https://www.googleapis.com/calendar/v3/calendars/x/events",
      "graph list calendars: 404 Not Found",
      "caldav report 503",
      "network timeout",
      // A number in the address of a request that never got an answer.
      "error sending request for url (https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=401)",
      "google api 500 for https://www.googleapis.com/calendar/v3/calendars/401/events",
      "something nobody has seen before",
    ];
    for (const text of no) expect(isSignInFailure(new Error(text)), text).toBe(false);
  });

  it("the verdict of real provider errors is what it was", () => {
    expect(classifySyncError(new Error("invalid_grant"))).toBe("fatal");
    expect(classifySyncError(new Error("google api 403 forbidden"))).toBe("fatal");
    expect(classifySyncError(new Error("caldav report 503"))).toBe("transient");
    expect(classifySyncError(new Error("something nobody has seen before"))).toBe("fatal");
  });
});
