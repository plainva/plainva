import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { PimWorker } from "../src/pim/PimWorker.ts";
import { PimCacheRepository } from "../src/pim/PimCacheRepository.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import type { IPimTarget, PimEvent } from "../src/pim/types.ts";

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
    const rows = this.db.prepare(sql).all(...(params as never[])) as T[];
    return rows[0] ?? null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

const NOW = Date.parse("2026-08-01T12:00:00Z");

/** Write side is irrelevant for the pull-worker tests — hard-fail stubs. */
const unusedWrites = {
  createEvent: async () => {
    throw new Error("not under test");
  },
  updateEvent: async () => {
    throw new Error("not under test");
  },
  deleteEvent: async () => {
    throw new Error("not under test");
  },
  createTask: async () => {
    throw new Error("not under test");
  },
  updateTask: async () => {
    throw new Error("not under test");
  },
};

function fakeTarget(events: PimEvent[], opts: { failCalendar?: string } = {}): IPimTarget {
  return {
    ...unusedWrites,
    provider: "caldav",
    listCalendars: vi.fn(async () => [
      { id: "cal1", name: "Privat" },
      { id: "cal2", name: "Arbeit" },
    ]),
    pullEvents: vi.fn(async (calendarId: string) => {
      if (calendarId === opts.failCalendar) throw new Error("boom");
      return { events: events.filter((e) => e.calendarId === calendarId) };
    }),
    listTaskLists: vi.fn(async () => [{ id: "l1", name: "Aufgaben" }]),
    pullTasks: vi.fn(async () => ({ tasks: [{ uid: "t1", listId: "l1", title: "T", completed: false }] })),
  };
}

function ev(uid: string, calendarId: string, startIso: string): PimEvent {
  const ts = Date.parse(startIso);
  return { uid, calendarId, title: uid, start: { ts }, end: { ts: ts + 3600_000 }, allDay: false };
}

describe("PimWorker", () => {
  let cache: PimCacheRepository;

  beforeEach(async () => {
    const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);
    cache = new PimCacheRepository(db);
    await cache.upsertAccount({ id: "a1", provider: "caldav", label: "NC", config: {}, enabled: true });
  });

  it("refreshes calendars, the event window and selected task lists of enabled accounts", async () => {
    const target = fakeTarget([ev("e1", "cal1", "2026-08-02T10:00:00Z")]);
    const dataChanged = vi.fn();
    const statuses: string[] = [];
    const worker = new PimWorker({
      cache,
      buildTarget: async () => target,
      onDataChanged: dataChanged,
      onStatusChange: (s) => statuses.push(s),
      now: () => NOW,
    });
    await worker.triggerImmediate();

    const cals = await cache.listCalendars("a1");
    expect(cals.map((c) => c.id).sort()).toEqual(["cal1", "cal2"]);
    const events = await cache.listEvents(NOW - 86400_000, NOW + 30 * 86400_000);
    expect(events.map((e) => e.uid)).toEqual(["e1"]);
    // Task LISTS are cached; tasks only for SELECTED lists (default off).
    expect((await cache.listTaskLists("a1")).map((l) => l.id)).toEqual(["l1"]);
    expect(await cache.listTasks("a1", "l1")).toEqual([]);
    expect(dataChanged).toHaveBeenCalled();
    expect(statuses).toEqual(["syncing", "idle"]);

    await cache.setTaskListSelected("a1", "l1", true);
    await worker.triggerImmediate();
    expect((await cache.listTasks("a1", "l1")).map((t) => t.uid)).toEqual(["t1"]);
  });

  // S8: the choke point every provider's rows pass through. A series occurrence
  // arrives without a title of its own — which means "same as the series", not
  // "an event with no name" — and must reach the cache carrying the series'.
  it("gives an untitled series occurrence the title of its series before caching it", async () => {
    const ts = Date.parse("2026-08-03T09:00:00Z");
    const master: PimEvent = { uid: "sm1", calendarId: "cal1", title: "Jour fixe Produkt", start: { ts }, end: { ts: ts + 3600_000 }, allDay: false, recurrence: "RRULE:FREQ=WEEKLY" };
    const occurrence: PimEvent = { uid: "sm1#1", calendarId: "cal1", title: "", seriesMaster: "sm1", start: { ts }, end: { ts: ts + 3600_000 }, allDay: false };
    const worker = new PimWorker({ cache, buildTarget: async () => fakeTarget([master, occurrence]), now: () => NOW });
    await worker.triggerImmediate();

    // The master itself is deliberately absent from the grid (`recurrence IS
    // NULL`), so what the calendar shows is the occurrence — and it is named.
    const events = await cache.listEvents(NOW - 86400_000, NOW + 30 * 86400_000);
    expect(events.map((e) => [e.uid, e.title])).toEqual([["sm1#1", "Jour fixe Produkt"]]);
  });

  // Issue #34: a CalDAV reminder list must not reach the calendar picker, and
  // the listing is fetched ONCE — `listTaskLists` gets the collections handed in.
  it("keeps VTODO-only collections out of the calendars and reuses the one listing", async () => {
    const collections = [
      { id: "cal1", name: "Home", supportsEvents: true, supportsTasks: false },
      { id: "rem1", name: "Reminders", supportsEvents: false, supportsTasks: true },
    ];
    const listTaskLists = vi.fn(async (given?: typeof collections) =>
      (given ?? []).filter((c) => c.supportsTasks).map((c) => ({ id: c.id, name: c.name }))
    );
    const target: IPimTarget = {
      ...unusedWrites,
      provider: "caldav",
      listCalendars: vi.fn(async () => collections),
      pullEvents: vi.fn(async () => ({ events: [] })),
      listTaskLists: listTaskLists as unknown as IPimTarget["listTaskLists"],
      pullTasks: async () => ({ tasks: [] }),
    };
    const worker = new PimWorker({ cache, buildTarget: async () => target, now: () => NOW });
    await worker.triggerImmediate();

    expect((await cache.listCalendars("a1")).map((c) => c.id)).toEqual(["cal1"]);
    expect((await cache.listTaskLists("a1")).map((l) => l.id)).toEqual(["rem1"]);
    expect(target.listCalendars).toHaveBeenCalledTimes(1);
    expect(listTaskLists).toHaveBeenCalledWith(collections);
  });

  // The failure used to be swallowed (`.catch(() => null)`) and read as "this
  // account has no task lists" — silently and for good.
  it("keeps the known task lists and records the reason when discovery fails", async () => {
    let failLists = false;
    const target: IPimTarget = {
      ...unusedWrites,
      provider: "caldav",
      listCalendars: async () => [{ id: "cal1", name: "Home", supportsEvents: true }],
      pullEvents: async () => ({ events: [] }),
      listTaskLists: async () => {
        if (failLists) throw new Error("caldav PROPFIND 503");
        return [{ id: "l1", name: "Reminders" }];
      },
      pullTasks: async () => ({ tasks: [] }),
    };
    const worker = new PimWorker({ cache, buildTarget: async () => target, now: () => NOW });
    await worker.triggerImmediate();
    expect((await cache.listTaskLists("a1")).map((l) => l.id)).toEqual(["l1"]);
    await cache.setTaskListSelected("a1", "l1", true);

    failLists = true;
    await worker.triggerImmediate();
    // Selection survives; the reason is readable for the settings UI.
    expect((await cache.listTaskLists("a1")).map((l) => [l.id, l.selected])).toEqual([["l1", true]]);
    expect((await cache.getScopeState("a1", "tasklists"))?.lastError).toContain("503");

    failLists = false;
    await worker.triggerImmediate();
    expect((await cache.getScopeState("a1", "tasklists"))?.lastError).toBeNull();
  });

  it("skips deselected calendars and disabled accounts", async () => {
    const target = fakeTarget([ev("e1", "cal1", "2026-08-02T10:00:00Z"), ev("e2", "cal2", "2026-08-03T10:00:00Z")]);
    const worker = new PimWorker({ cache, buildTarget: async () => target, now: () => NOW });
    await worker.triggerImmediate();
    await cache.setCalendarSelected("a1", "cal1", false);
    await worker.triggerImmediate();
    // cal1 was pulled in cycle 1 only — cycle 2 skips the deselected calendar.
    expect((target.pullEvents as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "cal1").length).toBe(1);
    const events = await cache.listEvents(0, NOW + 365 * 86400_000);
    expect(events.map((e) => e.uid)).toEqual(["e2"]);

    await cache.upsertAccount({ id: "a1", provider: "caldav", label: "NC", config: {}, enabled: false });
    const before = (target.listCalendars as ReturnType<typeof vi.fn>).mock.calls.length;
    await worker.triggerImmediate();
    expect((target.listCalendars as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before); // untouched
  });

  it("isolates a failing calendar: the others still refresh and the error surfaces", async () => {
    const target = fakeTarget([ev("ok1", "cal2", "2026-08-02T10:00:00Z")], { failCalendar: "cal1" });
    const statuses: Array<{ s: string; m?: string }> = [];
    const worker = new PimWorker({
      cache,
      buildTarget: async () => target,
      onStatusChange: (s, m) => statuses.push({ s, m }),
      now: () => NOW,
    });
    await worker.triggerImmediate();
    // cal2 refreshed despite cal1 failing…
    const events = await cache.listEvents(0, NOW + 365 * 86400_000);
    expect(events.map((e) => e.uid)).toEqual(["ok1"]);
    // …and the error is recorded per scope + account and surfaced.
    expect((await cache.getScopeState("a1", "events:cal1"))?.lastError).toBe("boom");
    expect((await cache.getScopeState("a1", "account"))?.lastError).toBe("boom");
    expect(statuses[statuses.length - 1]).toMatchObject({ s: "error" });
    expect(statuses[statuses.length - 1].m).toContain("boom");
  });

  it("a superseding stop aborts the running cycle before it writes stale data", async () => {
    let resolvePull: ((v: { events: PimEvent[] }) => void) | null = null;
    const target: IPimTarget = {
      ...unusedWrites,
      provider: "caldav",
      listCalendars: async () => [{ id: "cal1", name: "P" }],
      pullEvents: () => new Promise((res) => (resolvePull = res)),
      listTaskLists: async () => [],
      pullTasks: async () => ({ tasks: [] }),
    };
    const worker = new PimWorker({ cache, buildTarget: async () => target, now: () => NOW });
    const cycle = worker.triggerImmediate();
    // Wait until the pull is in flight, then stop the worker.
    await vi.waitFor(() => {
      if (!resolvePull) throw new Error("not yet");
    });
    worker.stop();
    resolvePull!({ events: [ev("late", "cal1", "2026-08-02T10:00:00Z")] });
    await cycle;
    expect(await cache.listEvents(0, NOW + 365 * 86400_000)).toEqual([]);
  });

  // Error isolation was there from the start; TIME isolation was not. An expired
  // sign-in spends its timeouts before it fails, and every account behind it
  // waited — "the second calendar takes forever" (finding 2026-07-30).
  it("refreshes accounts side by side, so one hanging account does not hold up the rest", async () => {
    await cache.upsertAccount({ id: "a2", provider: "caldav", label: "Zweitkonto", config: {}, enabled: true });
    let release: () => void = () => {};
    const hangs = new Promise<void>((resolve) => (release = resolve));
    const stuck: IPimTarget = {
      ...unusedWrites,
      provider: "caldav",
      listCalendars: async () => {
        await hangs;
        return [{ id: "late-cal", name: "Spaet" }];
      },
      pullEvents: async () => ({ events: [] }),
      listTaskLists: async () => [],
      pullTasks: async () => ({ tasks: [] }),
    };
    const worker = new PimWorker({
      cache,
      buildTarget: async (account) => (account.id === "a1" ? stuck : fakeTarget([])),
      now: () => NOW,
    });

    const cycle = worker.triggerImmediate();
    // The second account's calendars must be there while the first still hangs.
    await vi.waitFor(async () => {
      expect((await cache.listCalendars("a2")).map((c) => c.id).sort()).toEqual(["cal1", "cal2"]);
    });
    expect(await cache.listCalendars("a1")).toEqual([]);

    release();
    await cycle;
    expect((await cache.listCalendars("a1")).map((c) => c.id)).toEqual(["late-cal"]);
  });

  /**
   * A dead sign-in is an ANSWER, and asking it again every cycle costs a
   * connection, its timeouts and its retries — forever, on a phone that is
   * paying for those rounds (N1/S2). The account keeps saying what is wrong;
   * only the pointless trip is gone.
   */
  describe("an account whose sign-in is gone", () => {
    /**
     * An automatic cycle — `triggerImmediate` deliberately un-parks, so the
     * skip can only be observed on a cycle the worker ran by itself. The worker
     * stays started afterwards: `stop()` would make the manual refresh below a
     * no-op, which is correct behaviour for a stopped worker and the wrong
     * setup for this question.
     */
    const started: PimWorker[] = [];
    async function autoCycle(worker: PimWorker): Promise<void> {
      worker.start();
      started.push(worker);
      await new Promise((r) => setTimeout(r, 0));
    }
    afterEach(() => {
      for (const w of started.splice(0)) w.stop();
    });

    function workerFor(target: IPimTarget, extra: Record<string, unknown> = {}): PimWorker {
      return new PimWorker({ cache, buildTarget: async () => target, now: () => NOW, ...extra });
    }

    it("is skipped once its last failure was an answer, and keeps saying so", async () => {
      const target = fakeTarget([]);
      const failing = { ...target, listCalendars: vi.fn(async () => { throw new Error("invalid_grant"); }) };
      const worker = workerFor(failing as IPimTarget);
      await worker.triggerImmediate();
      expect(failing.listCalendars).toHaveBeenCalledTimes(1);
      const after = await cache.getScopeState("a1", "account");
      expect(after?.lastErrorKind).toBe("fatal");

      // The next automatic cycle must not spend a round on it…
      await autoCycle(worker);
      expect(failing.listCalendars).toHaveBeenCalledTimes(1);
      // …and the state stays exactly as it was, so the UI still explains why.
      expect((await cache.getScopeState("a1", "account"))?.lastError).toContain("invalid_grant");
    });

    it("says the standing state rather than reporting a clean cycle", async () => {
      const failing = { ...fakeTarget([]), listCalendars: vi.fn(async () => { throw new Error("invalid_grant"); }) };
      const statuses: Array<[string, string | undefined]> = [];
      const worker = workerFor(failing as IPimTarget, {
        onStatusChange: (s: string, m?: string) => statuses.push([s, m]),
        parkedMessage: "sign-in required",
      });
      await worker.triggerImmediate();
      statuses.length = 0;
      await autoCycle(worker);
      expect(statuses.at(-1)).toEqual(["error", "sign-in required"]);
    });

    /** The user asking is exactly the moment to stop assuming it is still dead. */
    it("is asked again when the user refreshes by hand", async () => {
      const failing = { ...fakeTarget([]), listCalendars: vi.fn(async () => { throw new Error("invalid_grant"); }) };
      const worker = workerFor(failing as IPimTarget);
      await worker.triggerImmediate();
      await autoCycle(worker);
      expect(failing.listCalendars).toHaveBeenCalledTimes(1);
      await worker.triggerImmediate();
      expect(failing.listCalendars).toHaveBeenCalledTimes(2);
    });

    /** A dropped request is not an answer — parking it would hide a network blip. */
    it("keeps asking after a temporary failure", async () => {
      const flaky = { ...fakeTarget([]), listCalendars: vi.fn(async () => { throw new Error("network timeout"); }) };
      const worker = workerFor(flaky as IPimTarget);
      await worker.triggerImmediate();
      expect((await cache.getScopeState("a1", "account"))?.lastErrorKind).toBe("transient");
      await autoCycle(worker);
      expect(flaky.listCalendars).toHaveBeenCalledTimes(2);
    });

    /** A row written before the column existed reads as unknown, never as parked. */
    it("retries a state that carries no verdict", async () => {
      await cache.setScopeState("a1", "account", { lastError: "something from an older build" });
      const target = fakeTarget([]);
      const worker = workerFor(target);
      await autoCycle(worker);
      expect(target.listCalendars).toHaveBeenCalledTimes(1);
    });

    /**
     * A cycle can COMPLETE and still report a failing calendar. That failure
     * needs its verdict too — otherwise a revoked sign-in that surfaces per
     * calendar rather than per account would never park, and the account would
     * keep spending its rounds exactly as before.
     */
    it("records the verdict for a failure the cycle survived", async () => {
      const target = {
        ...fakeTarget([]),
        pullEvents: vi.fn(async () => {
          throw new Error("invalid_grant");
        }),
      };
      const worker = workerFor(target as IPimTarget);
      await worker.triggerImmediate();
      const st = await cache.getScopeState("a1", "account");
      expect(st?.lastError).toContain("invalid_grant");
      expect(st?.lastErrorKind).toBe("fatal");
    });

    /** A cycle that gets through clears the verdict too — otherwise the row would
     *  still read "fatal" and park the account on the next failure of ANY kind. */
    it("clears the verdict when a cycle gets through", async () => {
      await cache.setScopeState("a1", "account", { lastError: "invalid_grant", lastErrorKind: "fatal" });
      const worker = workerFor(fakeTarget([]));
      await worker.triggerImmediate();
      const st = await cache.getScopeState("a1", "account");
      expect(st?.lastError).toBeNull();
      expect(st?.lastErrorKind).toBeNull();
    });
  });

});
