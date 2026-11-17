// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  GooglePimTarget,
  PimCacheRepository,
  PimWorker,
  initializeSchema,
  type IDatabaseAdapter,
  type PimAccountRow,
} from "@plainva/core";
import { describeSyncProblems, needsTaskDatabase, reportTaskListsBlocked, taskListProblemsOf } from "@plainva/ui";
import { runTaskSync, type TaskSyncAdapter, type TaskSyncOptions } from "./taskSync";
import { buildTaskDbFile } from "../taskDatabase";

/**
 * Issue 172: task lists switched on at a provider, and nothing in Plainva.
 * Provider tasks become notes of the standard task database, and the way there
 * stopped without a word in four places: no task database set, one that cannot
 * be read, one that names no folder for new notes, and new tasks held back
 * while the first sync of the vault has not finished. Each now leaves a line
 * on the list (the `tasknotes:` row the task views and the account card read),
 * and the line goes once the reconcile gets through. The provider, worker and
 * cache are the real ones; the Tasks API is stubbed.
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
    return ((await this.query<T>(sql, params))[0] ?? null) as T | null;
  }
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

const LABELS = {
  viewTable: "Tabelle",
  viewBoard: "Board",
  viewTimeline: "Zeitleiste",
  doneKey: "erledigt",
  dueKey: "frist",
  statusOptions: ["Offen", "In Arbeit", "Erledigt"] as [string, string, string],
};


/** A database whose views name no folder: a new note would have nowhere to go. */
const DB_WITHOUT_FOLDER = `properties:
  note.frist:
    plainva:
      input: date
views:
  - type: table
    name: Tabelle
`;


function fakeVault(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const adapter: TaskSyncAdapter = {
    readTextFile: async (p) => {
      const c = files.get(p);
      if (c === undefined) throw new Error("not found: " + p);
      return c;
    },
    writeTextFile: async (p, c) => {
      files.set(p, c);
    },
    exists: async (p) => files.has(p),
    createDir: async () => {},
  };
  return { adapter, files };
}

/** The Google Tasks API as the adapter sees it: one list, one task, its state settable. */
function googleApi() {
  const task: Record<string, string> = { id: "g1", title: "Steuern einreichen", status: "needsAction", etag: '"1"', due: "2026-11-02T00:00:00.000Z" };
  const writes: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (init?.method && init.method !== "GET") {
      writes.push(`${init.method} ${String(init.body ?? "")}`);
      return json({ ...task, etag: '"w"' });
    }
    if (url.includes("/calendar/v3/users/me/calendarList")) return json({ items: [] });
    if (url.includes("/users/@me/lists")) return json({ items: [{ id: "l1", title: "Meine Aufgaben" }] });
    if (url.includes("/lists/l1/tasks")) return json({ items: [{ ...task }] });
    return new Response("{}", { status: 404 });
  };
  return {
    fetchFn,
    writes,
    tick: () => {
      task.status = "completed";
      task.etag = '"2"';
    },
  };
}


const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

describe("a task list that cannot reach the notes says why (issue 172)", () => {
  let cache: PimCacheRepository;
  let account: PimAccountRow;

  beforeEach(async () => {
    const db = new NodeSqliteAdapter();
    await initializeSchema(db);
    cache = new PimCacheRepository(db);
    account = { id: "a1", provider: "google", label: "Nextcloud", config: {}, enabled: true };
    await cache.upsertAccount(account);
  });

  function setup(files: Record<string, string>, taskDbPath: string | null) {
    const api = googleApi();
    const target = new GooglePimTarget({ getAccessToken: async () => "token" }, api.fetchFn);
    const worker = new PimWorker({ cache, buildTarget: async () => target });
    const vault = fakeVault(files);
    const opts = (over: Partial<TaskSyncOptions> = {}): TaskSyncOptions => ({
      adapter: vault.adapter,
      cache,
      buildTarget: async () => target,
      taskDbPath,
      noteType: "Task",
      allNotePaths: [...vault.files.keys()].filter((p) => p.endsWith(".md")),
      ...over,
    });
    const cycle = async (over: Partial<TaskSyncOptions> = {}) => {
      await worker.triggerImmediate();
      return runTaskSync(opts(over));
    };
    return { vault, cycle };
  }

  async function lineOf(): Promise<string | undefined> {
    const problems = taskListProblemsOf(await cache.listSyncProblems(), "a1");
    return describeSyncProblems(problems, t, "en")?.lines[0]?.text;
  }

  it("no task database: the list says so, and the card offers to create one", async () => {
    const { vault, cycle } = setup({}, null);
    const res = await cycle();
    expect(res.blocked).toBe("no-task-db");
    expect([...vault.files.keys()]).toEqual([]);
    expect(await lineOf()).toContain("pim.problemTaskNoDatabase");
    expect(needsTaskDatabase(await cache.listSyncProblems())).toBe(true);
  });

  it("the shells' own skip without a task database leaves the same line", async () => {
    const { cycle } = setup({}, "Aufgaben.base");
    // Fill the cache once (a reconcile with a database that is not there).
    await cycle();
    await reportTaskListsBlocked(cache, "no-task-db");
    expect(await lineOf()).toContain("pim.problemTaskNoDatabase");
  });

  it("a task database that cannot be read says so", async () => {
    const { cycle } = setup({}, "Gone.base");
    const res = await cycle();
    expect(res.blocked).toBe("task-db-unreadable");
    expect(await lineOf()).toContain("pim.problemTaskDatabaseUnreadable");
    expect(needsTaskDatabase(await cache.listSyncProblems())).toBe(false);
  });

  it("a task database without a folder for new notes says so", async () => {
    const { cycle } = setup({ "Aufgaben.base": DB_WITHOUT_FOLDER }, "Aufgaben.base");
    const res = await cycle();
    expect(res.blocked).toBe("task-db-no-folder");
    expect(await lineOf()).toContain("pim.problemTaskDatabaseNoFolder");
  });

  it("during a first sync nothing is said: new tasks wait quietly and arrive after it", async () => {
    const { vault, cycle } = setup({ "Aufgaben.base": buildTaskDbFile("Aufgaben", LABELS).content }, "Aufgaben.base");
    const held = await cycle({ mayCreateNotes: false });
    expect(held.deferredCreates).toBe(1);
    expect(vault.files.has("Aufgaben/Steuern einreichen.md")).toBe(false);
    expect(await cache.listSyncProblems()).toEqual([]);

    const done = await cycle();
    expect(done.createdNotes).toEqual(["Aufgaben/Steuern einreichen.md"]);
    expect(await cache.listSyncProblems()).toEqual([]);
  });

  it("during a first sync a database not there yet, or no setting yet, is no line either", async () => {
    const missingFile = setup({}, "Aufgaben.base");
    expect((await missingFile.cycle({ mayCreateNotes: false })).blocked).toBe("task-db-unreadable");
    expect(await cache.listSyncProblems()).toEqual([]);
    expect((await missingFile.cycle({ mayCreateNotes: false, taskDbPath: null })).blocked).toBe("no-task-db");
    expect(await cache.listSyncProblems()).toEqual([]);
    // Once the vault has filled up and the state stays, it is said.
    await missingFile.cycle();
    expect(await lineOf()).toContain("pim.problemTaskDatabaseUnreadable");
  });

  it("the line goes once the database is set, and the tasks arrive", async () => {
    const files = { "Aufgaben.base": buildTaskDbFile("Aufgaben", LABELS).content };
    const first = setup(files, null);
    await first.cycle();
    expect(await lineOf()).toContain("pim.problemTaskNoDatabase");
    const res = await first.cycle({ taskDbPath: "Aufgaben.base" });
    expect(res.blocked).toBeUndefined();
    expect(res.createdNotes).toEqual(["Aufgaben/Steuern einreichen.md"]);
    expect(await cache.listSyncProblems()).toEqual([]);
  });

  it("a note the vault refuses to write says so, and the line goes once the write works", async () => {
    const { vault, cycle } = setup({ "Aufgaben.base": buildTaskDbFile("Aufgaben", LABELS).content }, "Aufgaben.base");
    const write = vault.adapter.writeTextFile;
    vault.adapter.writeTextFile = async () => {
      throw new Error("EACCES: read-only vault");
    };
    const refused = await cycle();
    expect(refused.createdNotes).toEqual([]);
    expect(refused.errors).toHaveLength(1);
    expect(await lineOf()).toContain("pim.problemTaskNotCreated");

    vault.adapter.writeTextFile = write;
    const done = await cycle();
    expect(done.createdNotes).toEqual(["Aufgaben/Steuern einreichen.md"]);
    expect(await cache.listSyncProblems()).toEqual([]);
  });

  it("a database set while its file has not arrived yet ends the 'no database' line at once (review)", async () => {
    const { cycle } = setup({}, null);
    await cycle();
    expect(needsTaskDatabase(await cache.listSyncProblems())).toBe(true);
    // The setting arrived, the file not yet; the vault still fills up.
    await cycle({ taskDbPath: "Aufgaben.base", mayCreateNotes: false });
    expect(needsTaskDatabase(await cache.listSyncProblems())).toBe(false);
    expect(await cache.listSyncProblems()).toEqual([]);
  });

  it("the same line again writes nothing: a calendar-only account costs no write per cycle (review)", async () => {
    const { cycle } = setup({}, null);
    await cycle();
    const writes = { n: 0 };
    const record = cache.recordScopeFailure.bind(cache);
    cache.recordScopeFailure = async (...args: Parameters<typeof record>) => {
      writes.n++;
      return record(...args);
    };
    await cycle();
    await cycle();
    expect(writes.n).toBe(0);
    expect(needsTaskDatabase(await cache.listSyncProblems())).toBe(true);
  });

  it("a note written whose state row then fails is no 'could not be created', and is not made twice (review)", async () => {
    const { vault, cycle } = setup({ "Aufgaben.base": buildTaskDbFile("Aufgaben", LABELS).content }, "Aufgaben.base");
    const upsert = cache.upsertTaskState.bind(cache);
    let fail = true;
    cache.upsertTaskState = async (...args: Parameters<typeof upsert>) => {
      if (fail) {
        fail = false;
        throw new Error("database is locked");
      }
      return upsert(...args);
    };
    const first = await cycle();
    expect(first.createdNotes).toEqual(["Aufgaben/Steuern einreichen.md"]);
    expect(first.errors).toHaveLength(1);
    expect(await lineOf()).toBeUndefined();
    await cycle();
    expect([...vault.files.keys()].filter((p) => p.startsWith("Aufgaben/"))).toEqual(["Aufgaben/Steuern einreichen.md"]);
  });

  it("a list that is switched off carries no line", async () => {
    const { cycle } = setup({}, null);
    await cycle();
    for (const list of await cache.listTaskLists("a1")) await cache.setTaskListSelected("a1", list.id, false);
    expect(await lineOf()).toBeUndefined();
  });
});
