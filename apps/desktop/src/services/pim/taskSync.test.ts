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
    deleteTask: vi.fn(async () => {}),
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
    // An EMPTY anchor index is the honest form of "we looked and found
    // nothing" — the note is really gone. A missing index means the opposite
    // and must never reach a tombstone (see the test below).
    const looked = { anchorsByUid: new Map<string, never[]>() };
    await runTaskSync({ ...baseOpts(vault, target), ...looked });
    expect((await cache.getTaskStates("a1", "l1"))[0].notePath).toBeNull();
    expect(target.updateTask).not.toHaveBeenCalled();
    // Third run: still no re-import.
    const res = await runTaskSync({ ...baseOpts(vault, target), ...looked });
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
    // The index knows the new path — a rename re-indexes both ends before the
    // next cycle. That index IS the lookup now; the old scan opened every note
    // in the vault, once per task.
    const anchorsByUid = new Map([
      ["u1", [{ path: "Projekte/Umbenannt.md", uid: "u1", list: "l1", ctime: 1 }]],
    ]);
    const res = await runTaskSync({ ...baseOpts(vault, null), anchorsByUid });
    expect(res.changedNotes).toEqual(["Projekte/Umbenannt.md"]);
    expect(vault.files.get("Projekte/Umbenannt.md")).toContain("# T2");
    expect((await cache.getTaskStates("a1", "l1"))[0].notePath).toBe("Projekte/Umbenannt.md");
  });

  it("never tombstones a note just because no anchor index was supplied", async () => {
    // A tombstone means "never import this task again". Reaching that from
    // "we did not look" would silently end the reconciliation of a task whose
    // note is alive and well.
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(baseOpts(vault, null));
    vault.files.delete("Aufgaben/T.md");

    await runTaskSync(baseOpts(vault, null)); // no anchorsByUid

    expect((await cache.getTaskStates("a1", "l1"))[0].notePath).toBe("Aufgaben/T.md");
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

describe("a checkbox task database (one-click scaffold)", () => {
  let db: NodeSqliteAdapter;
  let cache: PimCacheRepository;
  beforeEach(async () => {
    db = new NodeSqliteAdapter();
    await initializeSchema(db);
    cache = new PimCacheRepository(db);
    await cache.upsertAccount({ id: "a1", provider: "google", label: "G", config: {}, enabled: true });
    await cache.replaceTaskLists("a1", [{ id: "l1", name: "Aufgaben" }]);
    await cache.setTaskListSelected("a1", "l1", true);
  });

  it("imports completed as the done checkbox (+coupled status) and a local un-check pushes", async () => {
    const { buildTaskDbFile } = await import("../taskDatabase");
    const { path, content } = buildTaskDbFile("Aufgaben", {
      viewTable: "Tabelle",
      viewBoard: "Board",
      doneKey: "erledigt",
      dueKey: "frist",
      statusOptions: ["Offen", "In Arbeit", "Erledigt"],
    });
    const vault = fakeVault({ [path]: content });
    const target = fakeTarget({ etag: '"pushed"' });
    const opts: TaskSyncOptions = {
      adapter: vault.adapter,
      cache,
      buildTarget: async () => target,
      taskDbPath: path,
      noteType: "Task",
      allNotePaths: [],
    };

    // Import: the completed task lands with erledigt: true AND status Erledigt.
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "Fertig", completed: true, etag: '"e1"' })]);
    const r1 = await runTaskSync(opts);
    const notePath = r1.createdNotes[0];
    let note = vault.files.get(notePath)!;
    expect(readFrontmatterPath(note, ["erledigt"])).toBe(true);
    expect(readFrontmatterPath(note, ["status"])).toBe("Erledigt");
    expect(target.updateTask).not.toHaveBeenCalled();

    // Local un-check of the CHECKBOX property pushes completed=false — the
    // checkbox is the completion truth even while the status still reads done
    // (the UI write paths keep both coupled; a hand edit of just the checkbox
    // still wins).
    vault.files.set(notePath, note.replace("erledigt: true", "erledigt: false"));
    await runTaskSync({ ...opts, allNotePaths: [notePath] });
    expect(target.updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "u1" }),
      expect.objectContaining({ completed: false })
    );
  });
});

describe("field helpers", () => {
  const db = {
    dueKey: "frist",
    completion: { kind: "status" as const, status: { key: "status", open: "Offen", done: "Erledigt", options: ["Offen", "In Arbeit", "Erledigt"] } },
  };

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

  it("an EMPTY or UNRECOGNIZED status falls back to the base completion (never reads as open)", () => {
    // Data safety: a note with no status, or a status that is not one of the
    // database's options, must not be interpreted as an intentional "open" —
    // otherwise a completed remote task would be un-completed on the next push.
    const noStatus = `---\nfrist: 2026-08-15\n---\n# T\n`;
    expect(readNoteFields(noStatus, db, true).completed).toBe(true); // base was done -> stays done
    expect(readNoteFields(noStatus, db, false).completed).toBe(false);
    const foreign = `---\nstatus: Backlog\n---\n# T\n`; // value from a different DB
    expect(readNoteFields(foreign, db, true).completed).toBe(true);
    // The recognized open value DOES read as open (a genuine local un-complete).
    const open = `---\nstatus: Offen\n---\n# T\n`;
    expect(readNoteFields(open, db, true).completed).toBe(false);
  });
});

describe("a task whose note lost its status is NOT un-completed remotely", () => {
  let db: NodeSqliteAdapter;
  let cache: PimCacheRepository;
  beforeEach(async () => {
    db = new NodeSqliteAdapter();
    await initializeSchema(db);
    cache = new PimCacheRepository(db);
    await cache.upsertAccount({ id: "a1", provider: "google", label: "G", config: {}, enabled: true });
    await cache.replaceTaskLists("a1", [{ id: "l1", name: "Aufgaben" }]);
    await cache.setTaskListSelected("a1", "l1", true);
  });

  it("keeps the remote done and does not call updateTask", async () => {
    // A completed remote task whose note somehow lost its status frontmatter
    // (index quirk, manual edit, foreign value). The base state is "done".
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "Steuer", completed: true, etag: '"e1"' })]);
    const notePath = "Aufgaben/Steuer.md";
    const vault = fakeVault({
      "Aufgaben.base": TASK_DB,
      // note WITHOUT a status line, anchored to the remote task
      [notePath]: `---\nplainva:\n  pim:\n    kind: task\n    uid: u1\n    account: a1\n    list: l1\n---\n# Steuer\n`,
    });
    await cache.upsertTaskState({ accountId: "a1", listId: "l1", uid: "u1", notePath, remoteEtag: '"e1"', baseFields: { title: "Steuer", due: null, completed: true } });

    const target = fakeTarget();
    const res = await runTaskSync({
      adapter: vault.adapter,
      cache,
      buildTarget: async () => target,
      taskDbPath: "Aufgaben.base",
      noteType: "Task",
      allNotePaths: [notePath],
    });
    expect(target.updateTask).not.toHaveBeenCalled();
    expect(res.pushed).toBe(0);
  });
});

/**
 * Adoption: the reconnect, the new device, the rebuilt index.
 *
 * All three arrive with the notes present and the state row gone. Importing
 * then is what produced the copies in the maintainer's vault, so every test
 * here asks the same question: does a SECOND note appear?
 */
describe("runTaskSync adoption", () => {
  let db: NodeSqliteAdapter;
  let cache: PimCacheRepository;

  beforeEach(async () => {
    db = new NodeSqliteAdapter();
    await initializeSchema(db);
    cache = new PimCacheRepository(db);
    await cache.upsertAccount({ id: "fresh-id", provider: "caldav", label: "Test", config: {}, enabled: true });
    await cache.replaceTaskLists("fresh-id", [{ id: "l1", name: "Aufgaben" }]);
    await cache.setTaskListSelected("fresh-id", "l1", true);
  });

  const anchoredNote = (uid: string, account: string, list = "l1") =>
    `---\nstatus: Offen\nplainva:\n  pim:\n    kind: task\n    uid: ${uid}\n    account: ${account}\n    list: ${list}\n---\n\n# Steuern einreichen\n\nDie eigentliche Arbeit steht hier.\n`;

  const anchors = (entries: Array<{ path: string; uid: string; list?: string; ctime?: number; provider?: string }>) => {
    const map = new Map<string, any[]>();
    for (const e of entries) {
      const rec = {
        path: e.path,
        uid: e.uid,
        list: e.list ?? "l1",
        ctime: e.ctime ?? 1000,
        ...(e.provider ? { provider: e.provider } : {}),
      };
      map.set(e.uid, [...(map.get(e.uid) ?? []), rec]);
    }
    return map;
  };

  function opts(vault: ReturnType<typeof fakeVault>, extra: Partial<TaskSyncOptions> = {}): TaskSyncOptions {
    return {
      adapter: vault.adapter,
      cache,
      buildTarget: async () => null,
      taskDbPath: "Aufgaben.base",
      noteType: "Task",
      allNotePaths: [...vault.files.keys()].filter((p) => p.endsWith(".md")),
      ...extra,
    };
  }

  it("adopts the anchored note instead of importing the task again", async () => {
    // The reconnect: same task, same note, brand-new account id.
    await cache.replaceTasks("fresh-id", "l1", [rt({ uid: "u1", title: "Steuern einreichen", etag: '"e1"' })]);
    const notePath = "Aufgaben/Steuern einreichen.md";
    const vault = fakeVault({ "Aufgaben.base": TASK_DB, [notePath]: anchoredNote("u1", "old-random-id") });

    const res = await runTaskSync(opts(vault, { anchorsByUid: anchors([{ path: notePath, uid: "u1" }]) }));

    expect(res.createdNotes).toEqual([]);
    expect(res.adoptedNotes).toEqual([notePath]);
    expect([...vault.files.keys()].filter((p) => p.endsWith(".md"))).toEqual([notePath]);
    // The state row is rebuilt against the remote, so the first cycle after
    // adoption pushes nothing nobody changed.
    const states = await cache.getTaskStates("fresh-id", "l1");
    expect(states).toHaveLength(1);
    expect(states[0].notePath).toBe(notePath);
    expect(states[0].baseFields).toEqual({ title: "Steuern einreichen", due: null, completed: false });
  });

  it("takes the original note, not the copy that sorts before it", async () => {
    // "Steuern einreichen 2.md" sorts BEFORE "Steuern einreichen.md" — a path
    // sort would adopt the empty copy and leave the work behind.
    await cache.replaceTasks("fresh-id", "l1", [rt({ uid: "dupe", title: "Steuern einreichen", etag: '"e1"' })]);
    const original = "Aufgaben/Steuern einreichen.md";
    const copy = "Aufgaben/Steuern einreichen 2.md";
    const vault = fakeVault({
      "Aufgaben.base": TASK_DB,
      [original]: anchoredNote("dupe", "connect-1"),
      [copy]: anchoredNote("dupe", "connect-2"),
    });

    const res = await runTaskSync(
      opts(vault, {
        // The copy is even the OLDER row here, so ctime cannot save us either.
        anchorsByUid: anchors([
          { path: copy, uid: "dupe", ctime: 10 },
          { path: original, uid: "dupe", ctime: 99 },
        ]),
      })
    );

    expect(res.adoptedNotes).toEqual([original]);
    expect(res.duplicateAnchors).toBe(1);
    expect(res.createdNotes).toEqual([]);
    // The runner-up is left exactly as it was — tidying up is the maintainer's.
    expect(vault.files.get(copy)).toBe(anchoredNote("dupe", "connect-2"));
  });

  it("does not import anything while the vault is still filling up", async () => {
    // E7: the note may be seconds away. Importing now is the duplicate.
    await cache.replaceTasks("fresh-id", "l1", [rt({ uid: "u1", title: "Noch nicht da", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });

    const res = await runTaskSync(opts(vault, { mayCreateNotes: false }));

    expect(res.createdNotes).toEqual([]);
    expect(res.deferredCreates).toBe(1);
    expect(await cache.getTaskStates("fresh-id", "l1")).toHaveLength(0);
  });

  it("refuses a note anchored to a different list", async () => {
    await cache.replaceTasks("fresh-id", "l1", [rt({ uid: "u1", title: "Steuern einreichen", etag: '"e1"' })]);
    const other = "Aufgaben/Fremd.md";
    const vault = fakeVault({ "Aufgaben.base": TASK_DB, [other]: anchoredNote("u1", "x", "other-list") });

    const res = await runTaskSync(
      opts(vault, { anchorsByUid: anchors([{ path: other, uid: "u1", list: "other-list" }]) })
    );

    expect(res.adoptedNotes).toEqual([]);
    expect(res.createdNotes).toEqual(["Aufgaben/Steuern einreichen.md"]);
  });

  it("refuses a note anchored to another provider", async () => {
    await cache.replaceTasks("fresh-id", "l1", [rt({ uid: "u1", title: "Steuern einreichen", etag: '"e1"' })]);
    const foreign = "Aufgaben/Google.md";
    const vault = fakeVault({ "Aufgaben.base": TASK_DB, [foreign]: anchoredNote("u1", "x") });

    const res = await runTaskSync(
      opts(vault, { anchorsByUid: anchors([{ path: foreign, uid: "u1", provider: "google" }]) })
    );

    expect(res.adoptedNotes).toEqual([]);
    expect(res.createdNotes).toEqual(["Aufgaben/Steuern einreichen.md"]);
  });

  it("brings an old anchor up to date inside an edit it was making anyway", async () => {
    // E3: no vault-wide rewrite. The upgrade rides along with a write the
    // reconciler was performing regardless.
    await cache.replaceTasks("fresh-id", "l1", [rt({ uid: "u1", title: "Neuer Titel", etag: '"e2"' })]);
    const notePath = "Aufgaben/Steuern einreichen.md";
    const vault = fakeVault({ "Aufgaben.base": TASK_DB, [notePath]: anchoredNote("u1", "old-random-id") });
    await cache.upsertTaskState({
      accountId: "fresh-id",
      listId: "l1",
      uid: "u1",
      notePath,
      remoteEtag: '"e1"',
      baseFields: { title: "Steuern einreichen", due: null, completed: false },
    });

    await runTaskSync(opts(vault, { anchorsByUid: anchors([{ path: notePath, uid: "u1" }]) }));

    const written = vault.files.get(notePath)!;
    expect(written).toContain("# Neuer Titel");
    expect(readFrontmatterPath(written, ["plainva", "pim", "provider"])).toBe("caldav");
    // And the legacy id stays readable for an older shell (E6).
    expect(readFrontmatterPath(written, ["plainva", "pim", "account"])).toBe("fresh-id");
  });

  it("leaves an untouched note's old anchor alone", async () => {
    // The other half of E3: nothing to write means nothing is rewritten, so a
    // fix does not turn into a sync event across hundreds of files.
    await cache.replaceTasks("fresh-id", "l1", [rt({ uid: "u1", title: "Steuern einreichen", etag: '"e1"' })]);
    const notePath = "Aufgaben/Steuern einreichen.md";
    const before = anchoredNote("u1", "old-random-id");
    const vault = fakeVault({ "Aufgaben.base": TASK_DB, [notePath]: before });

    await runTaskSync(opts(vault, { anchorsByUid: anchors([{ path: notePath, uid: "u1" }]) }));

    expect(vault.files.get(notePath)).toBe(before);
  });
});

describe("runTaskSync confirmed deletions (E4b)", () => {
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

  function opts(vault: ReturnType<typeof fakeVault>, target: IPimTarget | null): TaskSyncOptions {
    return {
      adapter: vault.adapter,
      cache,
      buildTarget: async () => target,
      taskDbPath: "Aufgaben.base",
      noteType: "Task",
      allNotePaths: [...vault.files.keys()].filter((p) => p.endsWith(".md")),
      anchorsByUid: new Map(),
    };
  }

  it("a confirmed deletion reaches the provider and drops the state row", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T", etag: '"e1"', href: "/t/u1.ics" })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(opts(vault, null));
    vault.files.delete("Aufgaben/T.md");

    const target = fakeTarget();
    const resolved: Array<[string, string]> = [];
    const res = await runTaskSync({
      ...opts(vault, target),
      pendingDeletions: [{ uid: "u1", list: "l1" }],
      onDeletionResolved: (i, o) => resolved.push([i.uid, o]),
    });

    expect(target.deleteTask).toHaveBeenCalledWith({ listId: "l1", uid: "u1", etag: '"e1"', href: "/t/u1.ics" });
    expect(res.deletedRemote).toBe(1);
    // No state row left at all — not a tombstone. The task is gone on both
    // sides, so there is nothing left to remember.
    expect(await cache.getTaskStates("a1", "l1")).toHaveLength(0);
    expect(resolved).toEqual([["u1", "done"]]);
  });

  it("a merely missing file does NOT reach the provider", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(opts(vault, null));
    vault.files.delete("Aufgaben/T.md");

    const target = fakeTarget();
    await runTaskSync(opts(vault, target));

    expect(target.deleteTask).not.toHaveBeenCalled();
    expect((await cache.getTaskStates("a1", "l1"))[0].notePath).toBeNull();
  });

  it("offline keeps the order for the next cycle", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(opts(vault, null));
    vault.files.delete("Aufgaben/T.md");

    const resolved: string[] = [];
    await runTaskSync({
      ...opts(vault, null),
      pendingDeletions: [{ uid: "u1", list: "l1" }],
      onDeletionResolved: (_i, o) => resolved.push(o),
    });
    // Never resolved => the module keeps it; and it must not have been
    // tombstoned either, or the retry would have nothing to delete.
    expect(resolved).toEqual([]);
    expect((await cache.getTaskStates("a1", "l1"))[0].uid).toBe("u1");
  });

  it("a remote change during the window stops the deletion and reports it", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T", etag: '"e1"', href: "/t/u1.ics" })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(opts(vault, null));
    vault.files.delete("Aufgaben/T.md");

    const target = fakeTarget();
    (target.deleteTask as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new PimConflictError());
    const resolved: string[] = [];
    const res = await runTaskSync({
      ...opts(vault, target),
      pendingDeletions: [{ uid: "u1", list: "l1" }],
      onDeletionResolved: (_i, o) => resolved.push(o),
    });

    expect(resolved).toEqual(["conflict"]);
    expect(res.errors.join(" ")).toContain("remote changed");
    expect(res.deletedRemote).toBe(0);
  });

  it("a cycle INSIDE the undo window neither imports nor tombstones", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(opts(vault, null));
    vault.files.delete("Aufgaben/T.md");

    const target = fakeTarget();
    const res = await runTaskSync({
      ...opts(vault, target),
      // Still counting down — not an order yet.
      deletionsInFlight: [{ uid: "u1", list: "l1" }],
    });

    expect(target.deleteTask).not.toHaveBeenCalled();
    expect(res.createdNotes).toEqual([]);
    // The row keeps pointing at the note. A tombstone would survive the undo
    // and leave the restored note unreconciled forever.
    expect((await cache.getTaskStates("a1", "l1"))[0].notePath).toBe("Aufgaben/T.md");
  });

  it("an order for a different list is not carried out here", async () => {
    await cache.replaceTasks("a1", "l1", [rt({ uid: "u1", title: "T", etag: '"e1"' })]);
    const vault = fakeVault({ "Aufgaben.base": TASK_DB });
    await runTaskSync(opts(vault, null));
    vault.files.delete("Aufgaben/T.md");

    const target = fakeTarget();
    // A uid is unique at ONE provider list, not across two.
    await runTaskSync({ ...opts(vault, target), pendingDeletions: [{ uid: "u1", list: "other" }] });
    expect(target.deleteTask).not.toHaveBeenCalled();
  });
});
