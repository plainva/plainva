import { beforeEach, describe, expect, it } from "vitest";
import { PimWorker } from "../src/pim/PimWorker.ts";
import { PimCacheRepository } from "../src/pim/PimCacheRepository.ts";
import type { IDatabaseAdapter, SqlStatements } from "../src/db/IDatabaseAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import type { IPimTarget, PimEvent, PimTask } from "../src/pim/types.ts";

/**
 * A quiet cycle says nothing (finding F21). Every cycle rewrites the cache,
 * and the worker reported each one as "data changed": on the phone that
 * cleared and rescheduled every reminder and reloaded the views of both
 * shells every two minutes in the foreground, with nothing new at all.
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
  async transaction<T>(fn: (tx: SqlStatements) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

const T0 = Date.parse("2026-11-16T08:00:00Z");
const notUnderTest = async () => {
  throw new Error("not under test");
};

describe("PimWorker: a quiet cycle reports no data change (F21)", () => {
  let cache: PimCacheRepository;
  let events: PimEvent[];
  let tasks: PimTask[];
  let changed: number;
  let worker: PimWorker;

  beforeEach(async () => {
    const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);
    cache = new PimCacheRepository(db);
    await cache.upsertAccount({ id: "a1", provider: "caldav", label: "Work", config: {}, enabled: true });
    const ts = T0 + 3600_000;
    events = [{ uid: "e1", calendarId: "cal1", title: "Standup", start: { ts }, end: { ts: ts + 1800_000 }, allDay: false }];
    tasks = [{ uid: "t1", listId: "l1", title: "Taxes", completed: false }];
    changed = 0;
    const target: IPimTarget = {
      provider: "caldav",
      listCalendars: async () => [{ id: "cal1", name: "Team" }],
      pullEvents: async () => ({ events }),
      listTaskLists: async () => [{ id: "l1", name: "Errands" }],
      pullTasks: async () => ({ tasks }),
      createEvent: notUnderTest,
      updateEvent: notUnderTest,
      deleteEvent: notUnderTest,
      createTask: notUnderTest,
      updateTask: notUnderTest,
      deleteTask: notUnderTest,
    };
    worker = new PimWorker({ cache, buildTarget: async () => target, now: () => T0, onDataChanged: () => changed++ });
  });

  const cycle = () => (worker as unknown as { runCycle(cause: string): Promise<void> }).runCycle("timer");

  it("the first cycle reports its data, the next ones with the same data report nothing", async () => {
    await cycle();
    expect(changed).toBe(1);
    await cycle();
    await cycle();
    expect(changed).toBe(1);
  });

  it("a changed task or event is reported again", async () => {
    await cycle();
    tasks = [{ ...tasks[0], completed: true }];
    await cycle();
    expect(changed).toBe(2);
    events = [{ ...events[0], title: "Standup (moved)" }];
    await cycle();
    expect(changed).toBe(3);
    await cycle();
    expect(changed).toBe(3);
  });

  it("each replace says whether it changed its rows", async () => {
    expect(await cache.replaceTasks("a1", "l1", tasks)).toBe(true);
    expect(await cache.replaceTasks("a1", "l1", tasks)).toBe(false);
    expect(await cache.replaceTaskLists("a1", [{ id: "l1", name: "Errands" }])).toBe(true);
    expect(await cache.replaceTaskLists("a1", [{ id: "l1", name: "Errands" }])).toBe(false);
    expect(await cache.applyEventDelta("a1", "cal1", [], [], [])).toBe(false);
  });
});
