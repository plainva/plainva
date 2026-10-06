import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PimCacheRepository } from "../src/pim/PimCacheRepository.ts";
import type { BatchStatement, IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import type { PimEvent } from "../src/pim/types.ts";

/**
 * A replace is ONE step (plan Befunde 2026-10-06, K1).
 *
 * Real SQLite, a database FILE and two connections — the shape of the desktop,
 * where the worker writes through the native batch on its own connection while
 * the calendar reads through the pool. A recording mock cannot show what a
 * second connection sees in the middle of a write; this can.
 *
 * The writer's adapter calls `probe` after every statement it runs, committed
 * on its own or inside a batch. Against the code before this plan — a DELETE
 * and its INSERTs as separate auto-committed statements — the probe after the
 * DELETE found the window empty.
 */

const { DatabaseSync } = (await import("node:sqlite")) as any;

class FileSqliteAdapter implements IDatabaseAdapter {
  probe: (() => void) | null = null;
  failOn: ((sql: string) => boolean) | null = null;
  batches = 0;
  constructor(private db: any, private readonly batching = true) {
    if (!batching) (this as { runBatch?: unknown }).runBatch = undefined;
  }
  private run(sql: string, params: unknown[]): void {
    if (this.failOn?.(sql)) throw new Error("database is locked");
    this.db.prepare(sql).run(...(params as never[]));
    this.probe?.();
  }
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.run(sql, params);
  }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    return ((this.db.prepare(sql).all(...(params as never[])) as T[])[0] ?? null) as T | null;
  }
  /** What the desktop adapter's `transaction()` is: a queue, no BEGIN. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
  /** What `db_batch` is: BEGIN, every statement, COMMIT — ROLLBACK on error. */
  async runBatch(statements: BatchStatement[]): Promise<void> {
    this.batches += 1;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const s of statements) this.run(s.sql, s.params ?? []);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.probe?.();
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

const T0 = Date.parse("2026-10-05T00:00:00Z");
const DAY = 86400_000;

function ev(uid: string, dayOffset: number): PimEvent {
  const ts = T0 + dayOffset * DAY + 10 * 3600_000;
  return { uid, calendarId: "cal1", title: uid, start: { ts }, end: { ts: ts + 3600_000 }, allDay: false };
}

describe("PIM cache: a replace is one step", () => {
  let dir: string;
  let writerDb: any;
  let readerDb: any;
  let writer: FileSqliteAdapter;
  let repo: PimCacheRepository;
  let reader: PimCacheRepository;
  /** What a second connection saw, one entry per statement the writer ran. */
  let seen: string[][];
  let readerRows: () => string[];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "pim-atomic-"));
    const file = join(dir, "index.db");
    writerDb = new DatabaseSync(file);
    writerDb.exec("PRAGMA journal_mode = WAL");
    writer = new FileSqliteAdapter(writerDb);
    await initializeSchema(writer);
    repo = new PimCacheRepository(writer);
    await repo.upsertAccount({ id: "acc1", provider: "caldav", label: "Work", config: {}, enabled: true });
    await repo.replaceCalendars("acc1", [{ id: "cal1", name: "Team" }, { id: "cal2", name: "Private" }]);
    await repo.replaceEventWindow("acc1", "cal1", T0, T0 + 30 * DAY, [ev("old-1", 1), ev("old-2", 2)]);

    readerDb = new DatabaseSync(file);
    reader = new PimCacheRepository(new FileSqliteAdapter(readerDb));
    seen = [];
    // Synchronous on purpose: it runs between two statements of the writer.
    const select = readerDb.prepare(
      `SELECT e.uid FROM pim_events e
       JOIN pim_calendars c ON c.account_id = e.account_id AND c.cal_id = e.cal_id
       WHERE c.selected = 1 ORDER BY e.uid`
    );
    readerRows = () => (select.all() as Array<{ uid: string }>).map((r) => r.uid);
    writer.probe = () => seen.push(readerRows());
  });

  afterEach(() => {
    writer.probe = null;
    readerDb.close();
    writerDb.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a reader during the window replace sees the old events or the new ones, never none", async () => {
    await repo.replaceEventWindow("acc1", "cal1", T0, T0 + 30 * DAY, [ev("new-1", 3)]);

    expect(writer.batches).toBeGreaterThan(0);
    // The delete and the insert were both observed — and neither showed a gap.
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const rows of seen) expect([["old-1", "old-2"], ["new-1"]]).toContainEqual(rows);
    expect(seen[0]).toEqual(["old-1", "old-2"]);
    expect(seen.at(-1)).toEqual(["new-1"]);
    expect((await reader.listEvents(T0, T0 + 30 * DAY)).map((e) => e.uid)).toEqual(["new-1"]);
  });

  it("a reader during the calendar-list replace never sees an account without calendars", async () => {
    const lists: number[] = [];
    const count = readerDb.prepare(`SELECT count(*) AS n FROM pim_calendars WHERE account_id = 'acc1'`);
    writer.probe = () => {
      seen.push(readerRows());
      lists.push(Number((count.get() as { n: number }).n));
    };
    await repo.replaceCalendars("acc1", [{ id: "cal1", name: "Team" }, { id: "cal2", name: "Private" }, { id: "cal3", name: "New" }]);

    expect(lists.length).toBeGreaterThanOrEqual(3);
    for (const n of lists) expect([2, 3]).toContain(n);
    // The events hang on the calendar list through the JOIN: they stayed too.
    for (const rows of seen) expect(rows).toEqual(["old-1", "old-2"]);
    expect((await reader.listCalendars("acc1")).map((c) => c.id).sort()).toEqual(["cal1", "cal2", "cal3"]);
  });

  it("an insert that fails leaves the previous window exactly as it was", async () => {
    writer.failOn = (sql) => sql.startsWith("INSERT OR REPLACE INTO pim_events");
    await expect(repo.replaceEventWindow("acc1", "cal1", T0, T0 + 30 * DAY, [ev("new-1", 3)])).rejects.toThrow("database is locked");
    writer.failOn = null;

    expect(readerRows()).toEqual(["old-1", "old-2"]);
    for (const rows of seen) expect(rows).toEqual(["old-1", "old-2"]);
  });

  it("a calendar-list insert that fails keeps the list and the selection", async () => {
    await repo.setCalendarSelected("acc1", "cal2", false);
    writer.failOn = (sql) => sql.startsWith("INSERT INTO pim_calendars");
    await expect(repo.replaceCalendars("acc1", [{ id: "cal1", name: "Team" }])).rejects.toThrow();
    writer.failOn = null;

    expect((await reader.listCalendars("acc1")).map((c) => [c.id, c.selected])).toEqual([["cal2", false], ["cal1", true]]);
  });

  it("a delta is applied whole or not at all", async () => {
    writer.failOn = (sql) => sql.startsWith("DELETE FROM pim_events") && sql.includes("uid IN");
    await expect(repo.applyEventDelta("acc1", "cal1", [ev("new-1", 3)], ["old-1"])).rejects.toThrow();
    writer.failOn = null;
    expect(readerRows()).toEqual(["old-1", "old-2"]);

    await repo.applyEventDelta("acc1", "cal1", [ev("new-1", 3)], ["old-1"]);
    expect(readerRows()).toEqual(["new-1", "old-2"]);
    for (const rows of seen) expect([["old-1", "old-2"], ["new-1", "old-2"]]).toContainEqual(rows);
  });

  it("task lists and tasks are replaced the same way", async () => {
    await repo.replaceTaskLists("acc1", [{ id: "l1", name: "Tasks" }]);
    await repo.replaceTasks("acc1", "l1", [{ uid: "t1", listId: "l1", title: "T1", completed: false }]);
    const tasks = readerDb.prepare(`SELECT count(*) AS n FROM pim_tasks`);
    const lists = readerDb.prepare(`SELECT count(*) AS n FROM pim_tasklists`);
    const counts: Array<[number, number]> = [];
    writer.probe = () => counts.push([Number((lists.get() as { n: number }).n), Number((tasks.get() as { n: number }).n)]);

    await repo.replaceTaskLists("acc1", [{ id: "l1", name: "Tasks" }]);
    await repo.replaceTasks("acc1", "l1", [{ uid: "t2", listId: "l1", title: "T2", completed: false }]);

    expect(counts.length).toBeGreaterThanOrEqual(4);
    for (const pair of counts) expect(pair).toEqual([1, 1]);
  });

  it("an adapter without a native batch gets the statements inside its transaction", async () => {
    const plainDb = new DatabaseSync(":memory:");
    const calls: string[] = [];
    const plain = new FileSqliteAdapter(plainDb, false);
    await initializeSchema(plain);
    const original = plain.transaction.bind(plain);
    plain.transaction = async (fn) => {
      calls.push("begin");
      const out = await original(fn);
      calls.push("end");
      return out;
    };
    const plainRepo = new PimCacheRepository(plain);
    await plainRepo.upsertAccount({ id: "acc1", provider: "caldav", label: "Work", config: {}, enabled: true });
    await plainRepo.replaceCalendars("acc1", [{ id: "cal1", name: "Team" }]);
    await plainRepo.replaceEventWindow("acc1", "cal1", T0, T0 + 30 * DAY, [ev("e1", 1)]);

    expect(calls).toEqual(["begin", "end", "begin", "end"]);
    expect((await plainRepo.listEvents(T0, T0 + 30 * DAY)).map((e) => e.uid)).toEqual(["e1"]);
    plainDb.close();
  });
});

describe("PIM cache: since when a scope has not synced", () => {
  let db: any;
  let repo: PimCacheRepository;

  beforeEach(async () => {
    db = new DatabaseSync(":memory:");
    const adapter = new FileSqliteAdapter(db);
    await initializeSchema(adapter);
    repo = new PimCacheRepository(adapter);
    await repo.upsertAccount({ id: "acc1", provider: "caldav", label: "Work", config: {}, enabled: true });
    await repo.upsertAccount({ id: "acc2", provider: "google", label: "Home", config: {}, enabled: true });
    await repo.replaceCalendars("acc1", [{ id: "cal1", name: "Team" }, { id: "cal2", name: "Private" }]);
    await repo.replaceCalendars("acc2", [{ id: "g1", name: "Family" }]);
  });

  afterEach(() => db.close());

  it("a recorded failure keeps the time of the last sync that got through", async () => {
    await repo.setScopeState("acc1", "account", { lastSyncTs: 1000, lastError: null });
    await repo.recordScopeFailure("acc1", "account", { lastError: "503 unavailable", lastErrorKind: "transient" });
    await repo.recordScopeFailure("acc1", "account", { lastError: "503 unavailable", lastErrorKind: "transient" });
    expect(await repo.getScopeState("acc1", "account")).toMatchObject({ lastSyncTs: 1000, lastError: "503 unavailable", lastErrorKind: "transient" });

    // Never synced: the row says so instead of claiming the time of the failure.
    await repo.recordScopeFailure("acc2", "account", { lastError: "invalid_grant", lastErrorKind: "fatal" });
    expect((await repo.getScopeState("acc2", "account"))?.lastSyncTs).toBeNull();
  });

  it("a recorded failure keeps the cursor unless it is told to drop it", async () => {
    await repo.setScopeState("acc1", "events:cal1", { cursor: "tok", lastSyncTs: 5, lastError: null });
    await repo.recordScopeFailure("acc1", "events:cal1", { lastError: "boom" });
    expect((await repo.getScopeState("acc1", "events:cal1"))?.cursor).toBe("tok");
    await repo.recordScopeFailure("acc1", "events:cal1", { lastError: "boom", cursor: null });
    expect((await repo.getScopeState("acc1", "events:cal1"))?.cursor).toBeNull();
  });

  it("lists the accounts and calendars that are not fresh, and nothing else", async () => {
    expect(await repo.listSyncProblems()).toEqual([]);

    // acc2: the sign-in is gone. acc1: one calendar fails, the account syncs.
    await repo.recordScopeFailure("acc2", "account", { lastError: "invalid_grant", lastErrorKind: "fatal" });
    await repo.setScopeState("acc1", "events:cal1", { lastSyncTs: 2000, lastError: null });
    await repo.recordScopeFailure("acc1", "events:cal1", { lastError: "google api 403 forbidden", lastErrorKind: "fatal" });
    await repo.setScopeState("acc1", "account", { lastSyncTs: 3000, lastError: "google api 403 forbidden" });
    // A task-list failure is not the calendar's business.
    await repo.setScopeState("acc1", "tasklists", { lastError: "503" });

    expect(await repo.listSyncProblems()).toEqual([
      { accountId: "acc2", accountLabel: "Home", provider: "google", since: null, error: "invalid_grant", signIn: true },
      { accountId: "acc1", accountLabel: "Work", provider: "caldav", calendarId: "cal1", calendarName: "Team", since: 2000, error: "google api 403 forbidden", signIn: false },
    ]);

    // A calendar that is switched off is not on screen to be stale…
    await repo.setCalendarSelected("acc1", "cal1", false);
    expect((await repo.listSyncProblems()).map((p) => p.accountId)).toEqual(["acc2"]);
    // …a disabled account is not either…
    await repo.upsertAccount({ id: "acc2", provider: "google", label: "Home", config: {}, enabled: false });
    expect(await repo.listSyncProblems()).toEqual([]);
    // …and an account that fails as a whole is named once, not per calendar.
    await repo.setCalendarSelected("acc1", "cal1", true);
    await repo.recordScopeFailure("acc1", "account", { lastError: "503 unavailable", lastErrorKind: "transient" });
    expect(await repo.listSyncProblems()).toEqual([
      { accountId: "acc1", accountLabel: "Work", provider: "caldav", since: 3000, error: "503 unavailable", signIn: false },
    ]);
  });
});
