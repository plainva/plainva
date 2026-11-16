import { describe, expect, it, vi } from "vitest";
import { realSqlite } from "./helpers/realSqlite.ts";
import { initializeSchema } from "../src/db/Schema.js";
import {
  EncryptedWorkspaceWorker,
  MemoryWorkspaceStateStore,
  SqlWorkspaceStateStore,
  WorkspaceQueueingVaultAdapter,
  type WorkspaceStateStore,
} from "../src/index.js";
import { live, queued, synced } from "./helpers/workspaceReconcile.ts";

/**
 * The encrypted workspace's mass-deletion guard (release 0.9.0 A4). The
 * workspace had none: an emptied or unmounted vault folder went out as one
 * signed deletion per object, to every device — found by the start-up
 * reconcile or by the index while the app runs. The plain sync's guard and
 * question hold here now: deletions nobody confirmed, more than ten and more
 * than a fifth of what is synced, wait for an answer.
 */

describe("A4: the workspace holds a mass deletion until the person answers", () => {
  const names = Array.from({ length: 20 }, (_, index) => `n${String(index).padStart(2, "0")}.md`);
  const gone = names.slice(0, 15);

  it("fifteen of twenty gone while closed: held, asked once, nothing deleted", async () => {
    const { state, vault, worker, reconcile } = await synced(names);
    for (const name of gone) await vault.deleteItem(name);
    await reconcile();
    expect((await queued(state)).filter((entry) => entry.startsWith("delete"))).toHaveLength(15);

    const asked = vi.fn();
    worker.onMassDeletionPending = asked;
    await worker.runCycle();
    await worker.runCycle();
    expect(asked).toHaveBeenCalledTimes(1);
    expect(asked).toHaveBeenCalledWith({ pendingDeletes: 15, syncedTotal: 20 });
    for (const name of gone) expect(await live(state, name)).toBe(true);
    expect(await state.listQueue()).toHaveLength(15);
  });

  it("restore: the deletions go and the files come back from the workspace, byte for byte", async () => {
    const { state, vault, worker, reconcile } = await synced(names);
    for (const name of gone) await vault.deleteItem(name);
    await reconcile();
    const changed = vi.fn();
    worker.onFilesChanged = changed;
    worker.onMassDeletionPending = () => undefined;
    await worker.runCycle();

    expect(await worker.discardMassDeletion()).toBe(15);
    expect(await state.listQueue()).toEqual([]);
    for (const name of gone) expect(await vault.readTextFile(name)).toBe(`# ${name}\n`);
    expect(changed).toHaveBeenCalledWith(expect.arrayContaining(gone));
    await worker.runCycle();
    for (const name of names) expect(await live(state, name)).toBe(true);

    // The next start finds nothing missing: the workspace holds every file.
    await reconcile();
    expect(await state.listQueue()).toEqual([]);
  });

  it("delete: the next cycle carries the held deletions out", async () => {
    const { state, vault, worker, reconcile } = await synced(names);
    for (const name of gone) await vault.deleteItem(name);
    await reconcile();
    worker.onMassDeletionPending = () => undefined;
    await worker.runCycle();
    worker.approveMassDeletion();
    await worker.runCycle();
    expect(await state.listQueue()).toEqual([]);
    for (const name of gone) expect(await live(state, name)).toBe(false);
    for (const name of names.slice(15)) expect(await live(state, name)).toBe(true);
  });

  it("what follows a held deletion of the same path waits with it", async () => {
    const { state, vault, worker, reconcile } = await synced(names);
    for (const name of gone) await vault.deleteItem(name);
    await reconcile();
    worker.onMassDeletionPending = () => undefined;
    const before = (await state.getObjectByPath("n00.md"))!.currentRevisionId;
    await vault.writeTextFile("n00.md", "# back, new text\n");
    await state.enqueue("write", "n00.md");
    // An unrelated change goes on meanwhile.
    await vault.writeTextFile("n19.md", "# edited\n");
    await state.enqueue("write", "n19.md");
    await worker.runCycle();
    expect((await state.getObjectByPath("n00.md"))!.currentRevisionId).toBe(before);
    expect(await queued(state)).toContain("write n00.md");
    expect(await queued(state)).not.toContain("write n19.md");
  });

  it("deletions the person confirmed in the app are no question", async () => {
    const { state, vault, worker } = await synced(names);
    const app = new WorkspaceQueueingVaultAdapter(vault, state);
    for (const name of gone) await app.deleteItem(name, false, { confirmed: true });
    const asked = vi.fn();
    worker.onMassDeletionPending = asked;
    await worker.runCycle();
    expect(asked).not.toHaveBeenCalled();
    for (const name of gone) expect(await live(state, name)).toBe(false);
  });

  it("a few deletions from outside are carried out without asking", async () => {
    const { state, vault, worker, reconcile } = await synced(names);
    for (const name of names.slice(0, 3)) await vault.deleteItem(name);
    await reconcile();
    const asked = vi.fn();
    worker.onMassDeletionPending = asked;
    await worker.runCycle();
    expect(asked).not.toHaveBeenCalled();
    for (const name of names.slice(0, 3)) expect(await live(state, name)).toBe(false);
  });
});

describe("A4 after review: folders are counted in their files, and an open question survives a restart", () => {
  const names = [...Array.from({ length: 30 }, (_, i) => `Notes/n${i}.md`), ...Array.from({ length: 20 }, (_, i) => `Projects/p${i}.md`)];

  it("two folders emptied while closed: the files they took are counted, held and asked about", async () => {
    const { state, vault, worker, reconcile } = await synced(names);
    await vault.deleteItem("Notes", true);
    await vault.deleteItem("Projects", true);
    await reconcile();
    expect(await queued(state)).toEqual(expect.arrayContaining(["delete Notes", "delete Projects"]));
    const asked = vi.fn();
    worker.onMassDeletionPending = asked;
    await worker.runCycle();
    expect(asked).toHaveBeenCalledWith({ pendingDeletes: 50, syncedTotal: 50 });
    for (const name of names) expect(await live(state, name)).toBe(true);
  });

  it("held while the app runs, unanswered, restarted: asked again, nothing deleted", async () => {
    const { runtime, store, state, vault, worker, reconcile } = await synced(names);
    await vault.deleteItem("Notes", true);
    await vault.deleteItem("Projects", true);
    // The index reports each file gone, as while the app runs.
    for (const name of names) await state.enqueue("delete", name);
    const asked = vi.fn();
    worker.onMassDeletionPending = asked;
    await worker.runCycle();
    expect(asked).toHaveBeenCalledTimes(1);

    // No answer; the app is restarted — the reconcile adds the two folders.
    await reconcile();
    const restarted = new EncryptedWorkspaceWorker(store, state, vault, runtime);
    const askedAgain = vi.fn();
    restarted.onMassDeletionPending = askedAgain;
    await restarted.runCycle();
    expect(askedAgain).toHaveBeenCalledWith({ pendingDeletes: 50, syncedTotal: 50 });
    for (const name of names) expect(await live(state, name)).toBe(true);
  });

  it("an emptied folder of a few files among many is no question", async () => {
    const many = [...Array.from({ length: 3 }, (_, i) => `Small/s${i}.md`), ...Array.from({ length: 40 }, (_, i) => `k${i}.md`)];
    const { state, vault, worker, reconcile } = await synced(many);
    await vault.deleteItem("Small", true);
    await reconcile();
    const asked = vi.fn();
    worker.onMassDeletionPending = asked;
    await worker.runCycle();
    expect(asked).not.toHaveBeenCalled();
    expect(await live(state, "Small/s0.md")).toBe(false);
  });
});

describe.each([
  ["SQLite", async () => new SqlWorkspaceStateStore(await realSqlite())],
  ["memory", async () => new MemoryWorkspaceStateStore()],
] as Array<[string, () => Promise<WorkspaceStateStore>]>)("the queue keeps a confirmation (%s)", (_name, make) => {
  it("unconfirmed by default, confirmed when asked, and the same entry asked again confirmed takes the mark", async () => {
    const state = await make();
    await state.enqueue("delete", "a.md");
    await state.enqueue("delete", "b.md", null, { confirmed: true });
    expect((await state.listQueue()).map((entry) => [entry.path, entry.confirmedAt != null])).toEqual([["a.md", false], ["b.md", true]]);
    await state.enqueue("delete", "a.md", null, { confirmed: true });
    expect((await state.listQueue()).map((entry) => [entry.path, entry.confirmedAt != null])).toEqual([["a.md", true], ["b.md", true]]);
  });
});

describe("an index from before release 0.9.0", () => {
  it("gets the column on open; its rows count as unconfirmed", async () => {
    const db = await realSqlite();
    await db.execute(`ALTER TABLE workspace_queue DROP COLUMN confirmed_at`);
    await db.execute(`INSERT INTO workspace_queue (operation,path,new_path,queued_at) VALUES ('delete','old.md',NULL,1)`);
    await initializeSchema(db);
    const state = new SqlWorkspaceStateStore(db);
    expect((await state.listQueue()).map((entry) => [entry.path, entry.confirmedAt])).toEqual([["old.md", null]]);
  });
});
