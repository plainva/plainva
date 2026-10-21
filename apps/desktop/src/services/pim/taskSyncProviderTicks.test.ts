// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  GooglePimTarget,
  PimCacheRepository,
  PimWorker,
  initializeSchema,
  readFrontmatterPath,
  type IDatabaseAdapter,
  type PimAccountRow,
} from "@plainva/core";
import { describeSyncProblems } from "@plainva/ui";
import { runTaskSync, type TaskSyncAdapter, type TaskSyncOptions } from "./taskSync";
import { buildTaskDbFile } from "../taskDatabase";

/**
 * Finding B2 (maintainer, 19.10.): a task ticked off in Google Tasks was not
 * ticked off in Plainva; the other way round it was. Nothing covered the way
 * from the provider's answer to the note, so this file walks it whole: the
 * Google adapter reads a stubbed Tasks API, the worker fills the cache, the
 * reconciler writes the note — and where the note cannot take the tick, it is
 * neither lost nor quietly recorded as done.
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

/** A database with only a status column: nothing in it can hold a due date. */
const DB_WITHOUT_DUE = `properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Offen
        - value: Erledigt
views:
  - type: table
    name: Tabelle
filters:
  and:
    - file.folder == "Aufgaben"
`;

/** A database with only a date column: nothing in it can say "done". */
const DB_WITHOUT_DONE = `properties:
  note.frist:
    plainva:
      input: date
views:
  - type: table
    name: Tabelle
filters:
  and:
    - file.folder == "Aufgaben"
`;

/** Open … Done … Cancelled: the done option is not the last one. */
const DB_WITH_CANCELLED = `properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Offen
        - value: In Arbeit
        - value: Erledigt
        - value: Abgebrochen
views:
  - type: table
    name: Tabelle
filters:
  and:
    - file.folder == "Aufgaben"
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

describe("a task ticked at the provider reaches its note (B2)", () => {
  let cache: PimCacheRepository;
  let account: PimAccountRow;

  beforeEach(async () => {
    const db = new NodeSqliteAdapter();
    await initializeSchema(db);
    cache = new PimCacheRepository(db);
    account = { id: "a1", provider: "google", label: "Google", config: {}, enabled: true };
    await cache.upsertAccount(account);
  });

  function setup(dbSource: string) {
    const api = googleApi();
    const target = new GooglePimTarget({ getAccessToken: async () => "token" }, api.fetchFn);
    const worker = new PimWorker({ cache, buildTarget: async () => target });
    const vault = fakeVault({ "Aufgaben.base": dbSource });
    const opts = (): TaskSyncOptions => ({
      adapter: vault.adapter,
      cache,
      buildTarget: async () => target,
      taskDbPath: "Aufgaben.base",
      noteType: "Task",
      allNotePaths: [...vault.files.keys()].filter((p) => p.endsWith(".md")),
    });
    // One worker cycle, then the reconcile the shells run at its end.
    const cycle = async () => {
      await worker.triggerImmediate();
      return runTaskSync(opts());
    };
    return { api, vault, cycle };
  }

  it("ticks the open note off when Google says the task is done", async () => {
    const { api, vault, cycle } = setup(buildTaskDbFile("Aufgaben", LABELS).content);
    await cycle();
    const path = "Aufgaben/Steuern einreichen.md";
    expect(readFrontmatterPath(vault.files.get(path)!, ["erledigt"])).toBe(false);

    api.tick();
    const res = await cycle();
    const note = vault.files.get(path)!;
    expect(readFrontmatterPath(note, ["erledigt"])).toBe(true);
    expect(readFrontmatterPath(note, ["status"])).toBe("Erledigt");
    expect(res.changedNotes).toEqual([path]);
    expect(res.notApplied).toBe(0);
    expect((await cache.getTaskStates("a1", "l1"))[0]!.baseFields?.completed).toBe(true);
  });

  it("does not record a tick the note cannot hold as done, says why, and delivers it once the database can", async () => {
    const { api, vault, cycle } = setup(DB_WITHOUT_DONE);
    await cycle();
    const path = "Aufgaben/Steuern einreichen.md";
    expect(vault.files.has(path)).toBe(true);

    api.tick();
    const res = await cycle();
    expect(res.notApplied).toBe(1);
    // Not agreed: the next cycle tries again.
    expect((await cache.getTaskStates("a1", "l1"))[0]!.baseFields?.completed).toBe(false);
    // The line above the task views names the list and the reason.
    const problems = await cache.listSyncProblems();
    expect(problems.map((p) => [p.taskListId, p.taskListName])).toEqual([["l1", "Meine Aufgaben"]]);
    const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
    expect(describeSyncProblems(problems, t, "de")?.lines[0]?.text).toContain("pim.problemTaskNoDoneColumn");

    // The person gives the database a done column: the tick that waited arrives.
    vault.files.set("Aufgaben.base", buildTaskDbFile("Aufgaben", LABELS).content);
    const healed = await cycle();
    expect(readFrontmatterPath(vault.files.get(path)!, ["erledigt"])).toBe(true);
    expect(healed.notApplied).toBe(0);
    expect(await cache.listSyncProblems()).toEqual([]);
  });

  it("never pushes a due date away because the database has no column for it", async () => {
    const { api, vault, cycle } = setup(DB_WITHOUT_DUE);
    await cycle();
    expect(vault.files.has("Aufgaben/Steuern einreichen.md")).toBe(true);
    // Nothing changed anywhere: nothing goes to Google.
    await cycle();
    expect(api.writes).toEqual([]);
  });

  it("gives the notes their due date when a date column is added later, and pushes nothing", async () => {
    const { api, vault, cycle } = setup(DB_WITHOUT_DUE);
    await cycle();
    const path = "Aufgaben/Steuern einreichen.md";
    expect(readFrontmatterPath(vault.files.get(path)!, ["frist"]) ?? null).toBeNull();
    // The person follows the hint and gives the database a date column.
    vault.files.set("Aufgaben.base", buildTaskDbFile("Aufgaben", LABELS).content);
    await cycle();
    // The note holds the provider's date; nothing was read as "cleared".
    expect(String(readFrontmatterPath(vault.files.get(path)!, ["frist"]))).toBe("2026-11-02");
    expect(api.writes).toEqual([]);
    await cycle();
    expect(api.writes).toEqual([]);
  });

  it("keeps a due time the provider gives, and never sends it back without it", async () => {
    // The phone's reminders hand over a time with the day.
    await cache.replaceTaskLists("a1", [{ id: "l1", name: "Erinnerungen" }]);
    await cache.setTaskListSelected("a1", "l1", true);
    const updates: unknown[] = [];
    const target = {
      provider: "device",
      updateTask: async (_ref: unknown, draft: unknown) => {
        updates.push(draft);
        return { etag: "v9" };
      },
    } as never;
    const vault = fakeVault({ "Aufgaben.base": buildTaskDbFile("Aufgaben", LABELS).content });
    const opts = (): TaskSyncOptions => ({
      adapter: vault.adapter,
      cache,
      buildTarget: async () => target,
      taskDbPath: "Aufgaben.base",
      noteType: "Task",
      allNotePaths: [...vault.files.keys()].filter((p) => p.endsWith(".md")),
    });
    await cache.replaceTasks("a1", "l1", [{ uid: "r1", listId: "l1", title: "Anruf", due: "2026-11-02T10:00", completed: false, etag: "v1" }]);
    await runTaskSync(opts());
    const path = "Aufgaben/Anruf.md";
    expect(String(readFrontmatterPath(vault.files.get(path)!, ["frist"]))).toContain("2026-11-02T10:00");
    await runTaskSync(opts());
    expect(updates).toEqual([]);

    // The time moves at the provider: the note follows, nothing goes back.
    await cache.replaceTasks("a1", "l1", [{ uid: "r1", listId: "l1", title: "Anruf", due: "2026-11-02T11:30", completed: false, etag: "v2" }]);
    await runTaskSync(opts());
    expect(String(readFrontmatterPath(vault.files.get(path)!, ["frist"]))).toContain("2026-11-02T11:30");
    await runTaskSync(opts());
    expect(updates).toEqual([]);
  });

  it("writes the done option, not a cancelled one standing after it, and never reopens a cancelled task", async () => {
    const { api, vault, cycle } = setup(DB_WITH_CANCELLED);
    await cycle();
    const path = "Aufgaben/Steuern einreichen.md";
    expect(readFrontmatterPath(vault.files.get(path)!, ["status"])).toBe("Offen");

    api.tick();
    await cycle();
    expect(readFrontmatterPath(vault.files.get(path)!, ["status"])).toBe("Erledigt");

    // Cancelled here: closed, like done - nothing to un-complete at Google.
    vault.files.set(path, vault.files.get(path)!.replace("status: Erledigt", "status: Abgebrochen"));
    const res = await cycle();
    expect(res.pushed).toBe(0);
  });
});
