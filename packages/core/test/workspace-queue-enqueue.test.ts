import { describe, expect, it } from "vitest";
import { realSqlite } from "./helpers/realSqlite.ts";
import { MemoryWorkspaceStateStore, SqlWorkspaceStateStore, type WorkspaceStateStore } from "../src/workspace/state.ts";
import { mergeWorkspaceQueueCopies } from "../src/db/workspaceQueueCopies.ts";
import type { PreparedWorkspaceMutation, WorkspaceRuntimeMeta } from "../src/workspace/state.ts";

/**
 * The encrypted workspace's queue takes the same mutation twice as one
 * (Datensicherheit D2).
 *
 * An entry written again after a failure — the insert had landed, its answer
 * had not — used to stand in the queue twice, and its id was "the newest row",
 * which could be another flow's. Now `enqueue` queues nothing where the newest
 * entry touching the paths is this very mutation and not prepared yet, and
 * answers with that entry's id. A repeat after something else touched the
 * paths is queued anew: the worker pushes in order, and a queued deletion is
 * pushed even where the file came back.
 */

const stores: Array<[string, () => Promise<WorkspaceStateStore>]> = [
  ["SQLite", async () => new SqlWorkspaceStateStore(await realSqlite())],
  ["memory", async () => new MemoryWorkspaceStateStore()],
];
const queued = async (state: WorkspaceStateStore) =>
  (await state.listQueue()).map((entry) => `${entry.operation} ${entry.path}${entry.newPath ? ` -> ${entry.newPath}` : ""}`);

describe.each(stores)("enqueue on the %s store", (_name, make) => {
  it("the same mutation twice is one entry, with one id", async () => {
    const state = await make();
    const first = await state.enqueue("write", "Note.md");
    const again = await state.enqueue("write", "Note.md");
    expect(again).toBe(first);
    expect(await queued(state)).toEqual(["write Note.md"]);
  });

  it("a rename twice is one, and its id is its own — not the newest row's", async () => {
    const state = await make();
    const rename = await state.enqueue("rename", "Old.md", "New.md");
    await state.enqueue("write", "Other.md");
    expect(await state.enqueue("rename", "Old.md", "New.md")).toBe(rename);
    expect(await queued(state)).toEqual(["rename Old.md -> New.md", "write Other.md"]);
  });

  it("a repeat after something else touched the path is queued again: write, delete, write", async () => {
    const state = await make();
    await state.enqueue("write", "Note.md");
    await state.enqueue("delete", "Note.md");
    await state.enqueue("write", "Note.md");
    expect(await queued(state)).toEqual(["write Note.md", "delete Note.md", "write Note.md"]);
  });

  it("…and a move there and back and there again, and a file below a folder that moved in between", async () => {
    const state = await make();
    await state.enqueue("rename", "a.md", "b.md");
    await state.enqueue("rename", "b.md", "a.md");
    await state.enqueue("rename", "a.md", "b.md");
    await state.enqueue("write", "F/x.md");
    await state.enqueue("rename", "F", "G");
    await state.enqueue("write", "F/x.md");
    expect(await queued(state)).toEqual([
      "rename a.md -> b.md", "rename b.md -> a.md", "rename a.md -> b.md",
      "write F/x.md", "rename F -> G", "write F/x.md",
    ]);
  });

  it("an entry that is being uploaded is not the same any more: the next one is queued", async () => {
    const state = await make();
    const id = await state.enqueue("write", "Note.md");
    await state.reservePrepared(id, { absorbedQueueIds: [] } as unknown as PreparedWorkspaceMutation, {} as WorkspaceRuntimeMeta);
    expect(await state.enqueue("write", "Note.md")).not.toBe(id);
    expect(await queued(state)).toEqual(["write Note.md", "write Note.md"]);
  });

  it("other paths in between do not keep it apart", async () => {
    const state = await make();
    await state.enqueue("delete", "Gone.md");
    await state.enqueue("write", "Gone.md.bak");
    await state.enqueue("write", "Gonex/a.md");
    await state.enqueue("delete", "Gone.md");
    expect(await queued(state)).toEqual(["delete Gone.md", "write Gone.md.bak", "write Gonex/a.md"]);
  });
});

describe("the entry is its own turn (D3)", () => {
  it("queued while another flow's transaction is open and then rolled back, it stays", async () => {
    const db = await realSqlite();
    const state = new SqlWorkspaceStateStore(db);
    let fail!: () => void;
    const other = db.transaction(async (tx) => {
      await tx.execute("INSERT INTO meta (key, value) VALUES ('other', '1')");
      await new Promise<void>((resolve) => { fail = resolve; });
      throw new Error("the scan could not read a file");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const entry = state.enqueue("write", "Note.md");
    await new Promise((resolve) => setTimeout(resolve, 0));
    fail();
    await expect(other).rejects.toThrow("could not read");
    await entry;
    expect(await queued(state)).toEqual(["write Note.md"]);
    expect(await db.queryOne("SELECT value FROM meta WHERE key = 'other'")).toBeNull();
  });
});

describe("copies an older version queued are merged once (D2)", () => {
  const insert = (db: Awaited<ReturnType<typeof realSqlite>>, operation: string, path: string, newPath: string | null = null, prepared: string | null = null) =>
    db.execute(`INSERT INTO workspace_queue (operation, path, new_path, queued_at, prepared_json) VALUES (?, ?, ?, 1, ?)`, [operation, path, newPath, prepared]);

  it("keeps the oldest of each run of copies, and every repeat that something else separates", async () => {
    const db = await realSqlite();
    const state = new SqlWorkspaceStateStore(db);
    await db.execute(`DELETE FROM meta WHERE key = 'workspace_queue_copies_version'`);
    await insert(db, "write", "a.md");
    await insert(db, "write", "a.md");
    await insert(db, "write", "other.md");
    await insert(db, "write", "a.md");
    await insert(db, "rename", "Old.md", "New.md");
    await insert(db, "rename", "Old.md", "New.md");
    await insert(db, "write", "b.md");
    await insert(db, "delete", "b.md");
    await insert(db, "write", "b.md");
    await insert(db, "write", "F/x.md");
    await insert(db, "rename", "F", "G");
    await insert(db, "write", "F/x.md");
    await insert(db, "write", "p.md", null, "{}");
    await insert(db, "write", "p.md");
    expect(await mergeWorkspaceQueueCopies(db)).toBe(3);
    expect(await queued(state)).toEqual([
      "write a.md", "write other.md", "rename Old.md -> New.md",
      "write b.md", "delete b.md", "write b.md",
      "write F/x.md", "rename F -> G", "write F/x.md",
      "write p.md", "write p.md",
    ]);
    // Once per database.
    await insert(db, "write", "p.md");
    expect(await mergeWorkspaceQueueCopies(db)).toBeNull();
  });
});
