import { describe, expect, it, vi, beforeEach } from "vitest";
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

function fakeTarget(events: PimEvent[], opts: { failCalendar?: string } = {}): IPimTarget {
  return {
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
});
