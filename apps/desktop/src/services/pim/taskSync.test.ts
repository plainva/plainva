// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  PimCacheRepository,
  initializeSchema,
  readFrontmatterPath,
  type IDatabaseAdapter,
  type IPimTarget,
  type PimTask,
  PimConflictError,
} from "@plainva/core";
import { runTaskSync, readNoteFields, applyFieldsToNote, type TaskSyncAdapter, type TaskSyncOptions } from "./taskSync";

/**
 * Stage-3 reconciler against REAL SQLite (node:sqlite) + a fake vault: create
 * from remote, three-way field merges, tombstones on local deletion, dropped
 * state on remote deletion, anchor-based move survival and the conflict path.
 */

class NodeSqliteAdapter implements IDatabaseAdapter {
  private db: DatabaseSync;
  constructor() {
    this.db = new DatabaseSync(":memory:");
  }
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as any[]));
  }
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as any[])) as T[];
  }
  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
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

const TASK_DB = `properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Offen
        - value: In Arbeit
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

function fakeVault(initial: Record<string, string> = {}) {
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

function fakeTarget(updateResult: { etag?: string } | Error = { etag: '"pushed"' }): IPimTarget {
  const boom = async () => {
    throw new Error("not under test");
  };
  return {
    provider: "caldav",
    listCalendars: boom,
    pullEvents: boom,
    listTaskLists: boom,
    pullTasks: boom,
    createEvent: boom,
    updateEvent: boom,
    deleteEvent: boom,
    createTask: boom,
    updateTask: vi.fn(async () => {
      if (updateResult instanceof Error) throw updateResult;
      return updateResult;
    }),
  };
}

function rt(partial: Partial<PimTask> & { uid: string }): PimTask {
  return { listId: "l1", title: "Task", completed: false, ...partial };
}

describe("runTaskSync", () => {
  let db: NodeSqliteAdapter;
  let cache: PimCacheRepository;

  beforeEach(async () => {
    db = new NodeSqliteAdapter();
    await initializeSchema(db);
    cache = new PimCacheRepository(db);
    await cache.upsertAccount({ id: "a1", provider: "caldav", label: "Test", config: {}, enabled: true });
    await cache.replaceTaskLists("a1", [{ id: "l1", name: "Aufgaben" }]);
    await cache.setTaskListSelected("a1", "l1", true);
  });

  function baseOpts(vault: ReturnType<typeof fakeVault>, target: IPimTarget | null): TaskSyncOptions {
    return {
      adapter: vault.adapter,
      cache,
      buildTarget: async () => target,
      taskDbPath: "Aufgaben.base",
      noteType: "Task",
      allNotePaths: [...vault.files.keys()].filter((p) => p.endsWith(".md")),
    };
  }

  it("creates a note (title/due/status/anchor) for a new remote task", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "Steuern einreichen", due: "2026-08-15", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    const res = await runTaskSync(baseOpts(vault, null));
    expect(res.createdNotes).toEqual(["Aufgaben/Steuern einreichen.md"]);
    const note = vault.files.get("Aufgaben/Steuern einreichen.md")!;
    expect(note).toContain("# Steuern einreichen");
    expect(readFrontmatterPath(note, ["frist"])).toBe("2026-08-15");
    expect(readFrontmatterPath(note, ["status"])).toBe("Offen");
    expect(readFrontmatterPath(note, ["plainva", "pim", "uid"])).toBe("u1");
    expect(readFrontmatterPath(note, ["plainva", "pim", "kind"])).toBe("task");
    const states = await cache.getTaskStates("a1", "l1");
    expect(states).toHaveLength(1);
    expect(states[0].notePath).toBe("Aufgaben/Steuern einreichen.md");
    expect(states[0].baseFields).toEqual({ title: "Steuern einreichen", due: "2026-08-15", completed: false });
  });

  it("a completed remote task prefills the DONE status option", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "Done thing", completed: true, etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(baseOpts(vault, null));
    expect(readFrontmatterPath(vault.files.get("Aufgaben/Done thing.md")!, ["status"])).toBe("Erledigt");
  });

  it("is idempotent: a second run without changes writes and pushes nothing", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(baseOpts(vault, null));
    const target = fakeTarget();
    const res = await runTaskSync(baseOpts(vault, target));
    expect(res.createdNotes).toEqual([]);
    expect(res.changedNotes).toEqual([]);
    expect(res.pushed).toBe(0);
    expect(target.updateTask).not.toHaveBeenCalled();
  });

  it("applies a remote-only change to the note (H1 + due) and advances the state", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "Old title", due: "2026-08-01", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(baseOpts(vault, null));
    // Remote rename + new due (new etag).
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "New title", due: "2026-09-01", etag: '"e2"' })]);
    const target = fakeTarget();
    const res = await runTaskSync(baseOpts(vault, target));
    const note = vault.files.get("Aufgaben/Old title.md")!;
    expect(note).toContain("# New title");
    expect(readFrontmatterPath(note, ["frist"])).toBe("2026-09-01");
    expect(target.updateTask).not.toHaveBeenCalled();
    expect(res.changedNotes).toEqual(["Aufgaben/Old title.md"]);
    expect((await cache.getTaskStates("a1", "l1"))[0].remoteEtag).toBe('"e2"');
  });

  it("pushes a local-only change (status -> done, new due) with the etag guard", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T", due: "2026-08-01", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(baseOpts(vault, null));
    // Local edit: complete + move the due.
    const path = "Aufgaben/T.md";
    let note = vault.files.get(path)!;
    note = note.replace("status: Offen", "status: Erledigt").replace("frist: 2026-08-01", "frist: 2026-08-20");
    vault.files.set(path, note);
    const target = fakeTarget({ etag: '"e2"' });
    const res = await runTaskSync(baseOpts(vault, target));
    expect(res.pushed).toBe(1);
    expect(target.updateTask).toHaveBeenCalledWith(
      { listId: "l1", uid: "u1", etag: '"e1"', href: undefined },
      { title: "T", due: "2026-08-20", completed: true }
    );
    const st = (await cache.getTaskStates("a1", "l1"))[0];
    expect(st.remoteEtag).toBe('"e2"');
    expect(st.baseFields).toEqual({ title: "T", due: "2026-08-20", completed: true });
  });

  it("merges field-wise when both sides changed — local wins its field, remote keeps its own", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "Old", due: "2026-08-01", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(baseOpts(vault, null));
    // Local: complete it. Remote: rename it (new etag).
    const path = "Aufgaben/Old.md";
    vault.files.set(path, vault.files.get(path)!.replace("status: Offen", "status: Erledigt"));
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "Renamed", due: "2026-08-01", etag: '"e2"' })]);
    const target = fakeTarget({ etag: '"e3"' });
    const res = await runTaskSync(baseOpts(vault, target));
    // Note took the remote title, kept the local done status…
    const note = vault.files.get(path)!;
    expect(note).toContain("# Renamed");
    expect(readFrontmatterPath(note, ["status"])).toBe("Erledigt");
    // …and the completion was pushed under the pulled etag.
    expect(target.updateTask).toHaveBeenCalledWith(
      { listId: "l1", uid: "u1", etag: '"e2"', href: undefined },
      { title: "Renamed", due: "2026-08-01", completed: true }
    );
    expect(res.pushed).toBe(1);
  });

  it("keeps the old base on a push conflict so the next cycle re-merges", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(baseOpts(vault, null));
    const path = "Aufgaben/T.md";
    vault.files.set(path, vault.files.get(path)!.replace("status: Offen", "status: Erledigt"));
    const target = fakeTarget(new PimConflictError());
    const res = await runTaskSync(baseOpts(vault, target));
    expect(res.conflicts).toBe(1);
    const st = (await cache.getTaskStates("a1", "l1"))[0];
    expect(st.remoteEtag).toBe('"e1"');
    expect(st.baseFields).toEqual({ title: "T", due: null, completed: false });
  });

  it("a locally deleted note tombstones the state — remote untouched, never re-imported", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(baseOpts(vault, null));
    vault.files.delete("Aufgaben/T.md");
    const target = fakeTarget();
    await runTaskSync(baseOpts(vault, target));
    expect((await cache.getTaskStates("a1", "l1"))[0].notePath).toBeNull();
    expect(target.updateTask).not.toHaveBeenCalled();
    // Third run: still no re-import.
    const res = await runTaskSync(baseOpts(vault, target));
    expect(res.createdNotes).toEqual([]);
    expect(vault.files.has("Aufgaben/T.md")).toBe(false);
  });

  it("a remotely deleted task drops the state and keeps the note", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(baseOpts(vault, null));
    await cache.replaceTasks("a1", "l1", []);
    await runTaskSync(baseOpts(vault, null));
    expect(await cache.getTaskStates("a1", "l1")).toEqual([]);
    expect(vault.files.has("Aufgaben/T.md")).toBe(true);
  });

  it("survives a note rename via the frontmatter anchor and re-targets the state", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(baseOpts(vault, null));
    // Simulate a user rename/move: same content, new path.
    const content = vault.files.get("Aufgaben/T.md")!;
    vault.files.delete("Aufgaben/T.md");
    vault.files.set("Projekte/Umbenannt.md", content);
    // Remote change so the run has to touch the note.
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T2", etag: '"e2"' })]);
    const res = await runTaskSync(baseOpts(vault, null));
    expect(res.changedNotes).toEqual(["Projekte/Umbenannt.md"]);
    expect(vault.files.get("Projekte/Umbenannt.md")).toContain("# T2");
    expect((await cache.getTaskStates("a1", "l1"))[0].notePath).toBe("Projekte/Umbenannt.md");
  });

  it("does nothing without a configured task database", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T" })]);
    const vault = fakeVault({});
    const res = await runTaskSync({ ...baseOpts(vault, null), taskDbPath: null });
    expect(res.createdNotes).toEqual([]);
  });

  it("skips unselected lists and disabled accounts", async () => {
    await cache.setTaskListSelected("a1", "l1", false);
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T" })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    const res = await runTaskSync(baseOpts(vault, null));
    expect(res.createdNotes).toEqual([]);
  });
});

describe("field helpers", () => {
  const db = { dueKey: "frist", status: { key: "status", open: "Offen", done: "Erledigt" } };

  it("reads title from the H1, due from the date column, completed from the done option", () => {
    const content = `---\nstatus: Erledigt\nfrist: 2026-08-15\n---\n\n# Titel der Aufgabe\n\nBody.\n`;
    expect(readNoteFields(content, db)).toEqual({ title: "Titel der Aufgabe", due: "2026-08-15", completed: true });
  });

  it("an intermediate status option counts as not completed and is never clobbered", () => {
    const content = `---\nstatus: In Arbeit\n---\n# T\n`;
    const fields = readNoteFields(content, db);
    expect(fields.completed).toBe(false);
    // completed stays false in the merge -> status must remain untouched.
    const out = applyFieldsToNote(content, { title: "T", due: null, completed: false }, fields, db);
    expect(readFrontmatterPath(out, ["status"])).toBe("In Arbeit");
  });

  it("clears the due when the merge removed it", () => {
    const content = `---\nfrist: 2026-08-15\n---\n# T\n`;
    const fields = readNoteFields(content, db);
    const out = applyFieldsToNote(content, { title: "T", due: null, completed: false }, fields, db);
    expect(readFrontmatterPath(out, ["frist"])).toBeUndefined();
  });
});
