// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { PimCacheRepository, initializeSchema, readFrontmatterPath, type IDatabaseAdapter, type IPimTarget, type PimTask } from "@plainva/core";
import { isRecurringAtProviderNamespace, providerReopened } from "@plainva/ui";
import { runTaskSync, type TaskSyncAdapter, type TaskSyncOptions } from "./taskSync";

/**
 * Finding 2026-09-20: "tasks ticked off at Google stay open in Plainva". The raw
 * provider rows (anonymised here) showed the reconciler doing the right thing —
 * a recurring task at Google is ONE task: ticking it completes it, overnight
 * the SAME id comes back open with the next due date. These cases pin that
 * sequence, the mark it leaves on the note, and the quiet cycle when only a
 * neighbour's position (and with it every etag) moved.
 */

class NodeSqliteAdapter implements IDatabaseAdapter {
  private db = new DatabaseSync(":memory:");
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

const TASK_DB = `properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Offen
        - value: Erledigt
  note.frist:
    plainva:
      input: date
views:
  - type: table
    name: Tabelle
    order:
      - file.name
      - note.status
      - note.frist
filters:
  and:
    - file.folder == "Aufgaben"
`;

function fakeVault(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  const adapter: TaskSyncAdapter = {
    readTextFile: async (p) => {
      const c = files.get(p);
      if (c === undefined) throw new Error("not found: " + p);
      return c;
    },
    writeTextFile: async (p, c) => {
      writes.push(p);
      files.set(p, c);
    },
    exists: async (p) => files.has(p),
    createDir: async () => {},
  };
  return { adapter, files, writes };
}

function fakeTarget(): IPimTarget {
  const boom = async () => {
    throw new Error("not under test");
  };
  return {
    provider: "google",
    listCalendars: boom,
    pullEvents: boom,
    listTaskLists: boom,
    pullTasks: boom,
    createEvent: boom,
    updateEvent: boom,
    deleteEvent: boom,
    createTask: boom,
    updateTask: vi.fn(async () => ({ etag: '"pushed"' })),
    deleteTask: vi.fn(async () => {}),
  };
}

const rt = (partial: Partial<PimTask> & { uid: string }): PimTask => ({ listId: "l1", title: "Task", completed: false, ...partial });

describe("a task the provider repeats", () => {
  let cache: PimCacheRepository;

  beforeEach(async () => {
    const db = new NodeSqliteAdapter();
    await initializeSchema(db);
    cache = new PimCacheRepository(db);
    await cache.upsertAccount({ id: "a1", provider: "google", label: "Test", config: {}, enabled: true });
    await cache.replaceTaskLists("a1", [{ id: "l1", name: "Meine Aufgaben" }]);
    await cache.setTaskListSelected("a1", "l1", true);
  });

  const opts = (vault: ReturnType<typeof fakeVault>, target: IPimTarget | null): TaskSyncOptions => ({
    adapter: vault.adapter,
    cache,
    buildTarget: async () => target,
    taskDbPath: "Aufgaben.base",
    noteType: "Task",
    allNotePaths: [...vault.files.keys()].filter((p) => p.endsWith(".md")),
  });

  async function imported(vault: ReturnType<typeof fakeVault>, task: PimTask): Promise<string> {
    await cache.replaceTasks("a1", "l1", [task]);
    const res = await runTaskSync(opts(vault, null));
    expect(res.createdNotes).toHaveLength(1);
    return res.createdNotes[0]!;
  }

  it("ticked at the provider -> done here; back overnight with the next date -> open, dated and marked, nothing pushed", async () => {
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    const path = await imported(vault, rt({ uid: "series-1", title: "Pflanzen gießen", due: "2026-09-19", etag: '"e1"' }));
    const target = fakeTarget();

    // Day 1, evening: ticked in the provider's app.
    await cache.replaceTasks("a1", "l1", [rt({ uid: "series-1", title: "Pflanzen gießen", due: "2026-09-19", completed: true, etag: '"e2"' })]);
    await runTaskSync(opts(vault, target));
    expect(readFrontmatterPath(vault.files.get(path)!, ["status"])).toBe("Erledigt");
    expect(readFrontmatterPath(vault.files.get(path)!, ["plainva", "pim", "recurring"]) ?? null).toBeNull();

    // Day 2, morning: the SAME id is open again, one day later.
    await cache.replaceTasks("a1", "l1", [rt({ uid: "series-1", title: "Pflanzen gießen", due: "2026-09-20", completed: false, etag: '"e3"' })]);
    const res = await runTaskSync(opts(vault, target));
    const note = vault.files.get(path)!;
    expect(res.changedNotes).toEqual([path]);
    expect(readFrontmatterPath(note, ["status"])).toBe("Offen");
    expect(readFrontmatterPath(note, ["frist"])).toBe("2026-09-20");
    expect(readFrontmatterPath(note, ["plainva", "pim", "recurring"])).toBe(true);
    expect(isRecurringAtProviderNamespace({ pim: readFrontmatterPath(note, ["plainva", "pim"]) })).toBe(true);
    // The anchor is intact — the mark is an addition, not a rewrite.
    expect(readFrontmatterPath(note, ["plainva", "pim", "uid"])).toBe("series-1");
    expect(readFrontmatterPath(note, ["plainva", "pim", "list"])).toBe("l1");
    expect(target.updateTask).not.toHaveBeenCalled();
    expect((await cache.getTaskStates("a1", "l1"))[0]!.baseFields).toEqual({ title: "Pflanzen gießen", due: "2026-09-20", completed: false });

    // The next round of the series leaves the mark alone and writes it once.
    await cache.replaceTasks("a1", "l1", [rt({ uid: "series-1", title: "Pflanzen gießen", due: "2026-09-20", completed: true, etag: '"e4"' })]);
    await runTaskSync(opts(vault, target));
    await cache.replaceTasks("a1", "l1", [rt({ uid: "series-1", title: "Pflanzen gießen", due: "2026-09-21", completed: false, etag: '"e5"' })]);
    await runTaskSync(opts(vault, target));
    expect(vault.files.get(path)!.match(/recurring:/g)).toHaveLength(1);
    expect(target.updateTask).not.toHaveBeenCalled();
  });

  it("ticked HERE and pushed -> the provider's next round still reopens and marks the note", async () => {
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    const path = await imported(vault, rt({ uid: "series-2", title: "Müll rausbringen", due: "2026-09-19", etag: '"e1"' }));
    const target = fakeTarget();
    vault.files.set(path, vault.files.get(path)!.replace("status: Offen", "status: Erledigt"));
    const pushed = await runTaskSync(opts(vault, target));
    expect(pushed.pushed).toBe(1);

    await cache.replaceTasks("a1", "l1", [rt({ uid: "series-2", title: "Müll rausbringen", due: "2026-09-26", completed: false, etag: '"e9"' })]);
    await runTaskSync(opts(vault, target));
    const note = vault.files.get(path)!;
    expect(readFrontmatterPath(note, ["status"])).toBe("Offen");
    expect(readFrontmatterPath(note, ["frist"])).toBe("2026-09-26");
    expect(readFrontmatterPath(note, ["plainva", "pim", "recurring"])).toBe(true);
    expect(target.updateTask).toHaveBeenCalledTimes(1); // only the tick itself
  });

  it("somebody un-ticks a task at the provider (same date): reopened, but not a series", async () => {
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    const path = await imported(vault, rt({ uid: "once-1", title: "Steuer abgeben", due: "2026-09-19", completed: true, etag: '"e1"' }));
    await cache.replaceTasks("a1", "l1", [rt({ uid: "once-1", title: "Steuer abgeben", due: "2026-09-19", completed: false, etag: '"e2"' })]);
    await runTaskSync(opts(vault, fakeTarget()));
    const note = vault.files.get(path)!;
    expect(readFrontmatterPath(note, ["status"])).toBe("Offen");
    expect(readFrontmatterPath(note, ["plainva", "pim", "recurring"]) ?? null).toBeNull();
  });

  it("a neighbour moved: every etag changes, no field does -> no note write, no push, the state follows", async () => {
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await cache.replaceTasks("a1", "l1", [
      rt({ uid: "n1", title: "Erste", due: "2026-09-19", etag: '"a1"' }),
      rt({ uid: "n2", title: "Zweite", etag: '"b1"' }),
    ]);
    await runTaskSync(opts(vault, null));
    vault.writes.length = 0;
    const target = fakeTarget();

    // The provider renumbers positions when one task is dragged; that touches
    // `updated` and the etag of tasks whose title, date and state are the same.
    await cache.replaceTasks("a1", "l1", [
      rt({ uid: "n1", title: "Erste", due: "2026-09-19", etag: '"a2"' }),
      rt({ uid: "n2", title: "Zweite", etag: '"b2"' }),
    ]);
    const res = await runTaskSync(opts(vault, target));
    expect(res.changedNotes).toEqual([]);
    expect(res.pushed).toBe(0);
    expect(vault.writes).toEqual([]);
    expect(target.updateTask).not.toHaveBeenCalled();
    const etags = (await cache.getTaskStates("a1", "l1")).map((s) => s.remoteEtag).sort();
    expect(etags).toEqual(['"a2"', '"b2"']);
  });
});

describe("providerReopened", () => {
  const f = (completed: boolean, due: string | null) => ({ title: "T", due, completed });
  it("needs done -> open AND a later date", () => {
    expect(providerReopened(f(true, "2026-09-19"), f(false, "2026-09-20"))).toBe(true);
    expect(providerReopened(f(true, "2026-09-19T00:00:00.000Z"), f(false, "2026-09-26T00:00:00.000Z"))).toBe(true);
    expect(providerReopened(f(true, "2026-09-19"), f(false, "2026-09-19"))).toBe(false); // un-ticked by hand
    expect(providerReopened(f(true, "2026-09-19"), f(false, "2026-09-12"))).toBe(false);
    expect(providerReopened(f(true, null), f(false, "2026-09-20"))).toBe(false);
    expect(providerReopened(f(false, "2026-09-19"), f(false, "2026-09-20"))).toBe(false); // merely rescheduled
    expect(providerReopened(f(true, "2026-09-19"), f(true, "2026-09-20"))).toBe(false);
  });
});

describe("isRecurringAtProviderNamespace", () => {
  it("reads the indexed namespace as object or JSON and needs an anchor", () => {
    expect(isRecurringAtProviderNamespace({ pim: { kind: "task", uid: "u", list: "l", recurring: true } })).toBe(true);
    expect(isRecurringAtProviderNamespace(JSON.stringify({ pim: { uid: "u", recurring: true } }))).toBe(true);
    expect(isRecurringAtProviderNamespace({ pim: { uid: "u" } })).toBe(false);
    expect(isRecurringAtProviderNamespace({ pim: { recurring: true } })).toBe(false);
    expect(isRecurringAtProviderNamespace("not json")).toBe(false);
    expect(isRecurringAtProviderNamespace(null)).toBe(false);
  });
});
