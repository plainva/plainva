import { beforeEach, describe, expect, it } from "vitest";
import { PimWorker } from "../src/pim/PimWorker.ts";
import { PimCacheRepository } from "../src/pim/PimCacheRepository.ts";
import type { IDatabaseAdapter, SqlStatements } from "../src/db/IDatabaseAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import type { IPimTarget, PimEvent, PimTask } from "../src/pim/types.ts";

/**
 * A quiet cycle says nothing; every real change still does (finding F21).
 *
 * Every cycle rewrites the cache, and the worker reported each one as "data
 * changed": on the phone that cleared and rescheduled every reminder and
 * reloaded the views every two minutes, with nothing new at all. A first fix
 * compared the cache before and after each write and lost three real changes
 * on the way — a calendar switched on or off, the recovery after a failure,
 * an appointment that began before the window — while reading the whole event
 * cache twice per cycle. These cases hold both halves.
 */

const { DatabaseSync } = (await import("node:sqlite")) as any;

let rowsRead = 0;
class NodeSqliteAdapter implements IDatabaseAdapter {
  constructor(private db: any) {}
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = this.db.prepare(sql).all(...(params as never[])) as T[];
    rowsRead += rows.length;
    return rows;
  }
  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    return ((await this.query<T>(sql, params))[0] ?? null) as T | null;
  }
  async transaction<T>(fn: (tx: SqlStatements) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-16T08:00:00Z");
const notUnderTest = async () => {
  throw new Error("not under test");
};
const ev = (uid: string, title: string, startOff: number, len = 3600_000): PimEvent => ({
  uid, calendarId: "cal1", title, start: { ts: T0 + startOff }, end: { ts: T0 + startOff + len }, allDay: false,
});

describe("PimWorker: a quiet cycle reports no data change, a real change does (F21)", () => {
  let cache: PimCacheRepository;
  let events: Record<string, PimEvent[]>;
  let tasks: PimTask[];
  let fail: boolean;
  let delta: { events: PimEvent[]; deleted: string[] } | null;
  let clock: number;
  let changed: number;

  function worker(opts: { withDelta?: boolean } = {}): PimWorker {
    const target: IPimTarget = {
      provider: opts.withDelta ? "google" : "caldav",
      listCalendars: async () => {
        if (fail) throw new Error("503 Service Unavailable");
        return [{ id: "cal1", name: "Team" }, { id: "cal2", name: "Private" }];
      },
      pullEvents: async (calId) => ({ events: events[calId].map((e) => ({ ...e, calendarId: calId })) }),
      listTaskLists: async () => [{ id: "l1", name: "Errands" }],
      pullTasks: async () => ({ tasks }),
      createEvent: notUnderTest,
      updateEvent: notUnderTest,
      deleteEvent: notUnderTest,
      createTask: notUnderTest,
      updateTask: notUnderTest,
      deleteTask: notUnderTest,
    };
    let token = 0;
    if (opts.withDelta) {
      target.pullEventsDelta = async () => {
        const d = delta ?? { events: [], deleted: [] };
        delta = null;
        return { events: d.events, deletedUids: d.deleted, nextCursor: `tok${++token}` };
      };
    }
    return new PimWorker({ cache, buildTarget: async () => target, now: () => clock, onDataChanged: () => changed++ });
  }

  beforeEach(async () => {
    const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);
    cache = new PimCacheRepository(db);
    await cache.upsertAccount({ id: "a1", provider: "caldav", label: "Work", config: {}, enabled: true });
    events = {
      cal1: [ev("e1", "Standup", 3600_000), ev("long", "Parental leave", -70 * DAY, 80 * DAY)],
      cal2: [ev("p1", "Dentist", 2 * DAY)],
    };
    tasks = [{ uid: "t1", listId: "l1", title: "Taxes", completed: false }];
    fail = false;
    delta = null;
    clock = T0;
    changed = 0;
  });

  const cycle = (w: PimWorker) => (w as unknown as { runCycle(cause: string): Promise<void> }).runCycle("timer");

  it("the first cycle reports its data, the next ones with the same data report nothing", async () => {
    const w = worker();
    await cycle(w);
    expect(changed).toBe(1);
    await cycle(w);
    await cycle(w);
    expect(changed).toBe(1);
  });

  it("the same data in another order is no change", async () => {
    const w = worker();
    await cycle(w);
    events.cal1 = [...events.cal1].reverse();
    await cycle(w);
    expect(changed).toBe(1);
  });

  it("an idle cycle of a provider with a change feed reports nothing", async () => {
    const w = worker({ withDelta: true });
    await cycle(w);
    await cycle(w);
    await cycle(w);
    expect(changed).toBe(1);
    delta = { events: [{ ...events.cal1[0], title: "Standup (moved)" }], deleted: [] };
    await cycle(w);
    expect(changed).toBe(2);
  });

  it("a changed task or event is reported", async () => {
    const w = worker();
    await cycle(w);
    tasks = [{ ...tasks[0], completed: true }];
    await cycle(w);
    expect(changed).toBe(2);
    events.cal1 = [{ ...events.cal1[0], title: "Standup (moved)" }, events.cal1[1]];
    await cycle(w);
    expect(changed).toBe(3);
  });

  it("a calendar switched off, and on again, is reported", async () => {
    const w = worker();
    await cycle(w);
    await cache.setCalendarSelected("a1", "cal2", false);
    await cycle(w);
    expect(changed).toBe(2);
    await cache.setCalendarSelected("a1", "cal2", true);
    await cycle(w);
    expect(changed).toBe(3);
  });

  it("a failure and the recovery after it are reported", async () => {
    const w = worker();
    await cycle(w);
    fail = true;
    await cycle(w);
    expect(changed).toBe(2);
    fail = false;
    clock += 10 * 60_000; // past the pause
    await cycle(w);
    expect(changed).toBe(3);
    expect((await cache.getScopeState("a1", "account"))?.lastError ?? null).toBeNull();
  });

  it("a change to an appointment that began before the window is reported", async () => {
    const w = worker();
    await cycle(w);
    events.cal1 = events.cal1.map((e) => (e.uid === "long" ? { ...e, title: "Parental leave (extended)" } : e));
    await cycle(w);
    expect(changed).toBe(2);
  });

  it("an idle cycle does not read the event cache", async () => {
    events.cal1 = Array.from({ length: 500 }, (_, i) => ev(`m${i}`, `Meeting ${i}`, i * 3600_000));
    const w = worker();
    await cycle(w);
    rowsRead = 0;
    await cycle(w);
    expect(rowsRead).toBeLessThan(50);
  });
});
