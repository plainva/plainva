import { describe, expect, it, vi } from "vitest";
import { realSqlite } from "./helpers/realSqlite.ts";
import { initializeSchema } from "../src/db/Schema.js";
import {
  EncryptedWorkspaceWorker,
  initializePersonalWorkspaceMigration,
  MemoryWorkspaceStateStore,
  SqlWorkspaceStateStore,
  WorkspaceQueueingVaultAdapter,
  type WorkspaceStateStore,
} from "../src/workspace/index.js";
import { chainPermissions, live, ownerSecondDevice, queued, synced, workspaceMember } from "./helpers/workspaceReconcile.ts";

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

/**
 * Another device's mass deletion (review of release 0.9.0 A4). The guard
 * above stops one before it leaves the device; a device without it — an
 * older version, a broken one — sent it out signed, and every other device
 * carried it out without a question. The plain sync holds such a pull; the
 * workspace does now, with the plain sync's question.
 */
describe("A4 after review: another device's mass deletion is held here until answered", () => {
  const names = Array.from({ length: 60 }, (_, index) => `n${String(index).padStart(2, "0")}.md`);
  /** The owner's desktop deletes fifty files as a device without the guard would: let through. */
  async function deletedElsewhere() {
    const owner = await synced(names);
    const phone = await ownerSecondDevice(owner);
    for (const name of names.slice(0, 50)) {
      await owner.vault.deleteItem(name);
      await owner.state.enqueue("delete", name, null, { confirmed: true });
    }
    // And what that device wrote after them.
    await owner.vault.writeTextFile("after.md", "# after\n");
    await owner.state.enqueue("write", "after.md");
    await owner.worker.runCycle();
    expect(await live(owner.state, names[0])).toBe(false);
    const asked: Array<{ missing: number; confirmed: number }> = [];
    phone.worker.onDeletionMirroringSuspended = (info) => asked.push({ missing: info.missing, confirmed: info.confirmed });
    return { owner, phone, asked };
  }

  it("held and asked once; nothing is deleted here, and what that device did to other files arrives", { timeout: 30_000 }, async () => {
    const { phone, asked } = await deletedElsewhere();
    await phone.worker.runCycle();
    await phone.worker.runCycle();
    expect(asked).toEqual([{ missing: 50, confirmed: 60 }]);
    expect(names.every((name) => phone.vault.files.has(name))).toBe(true);
    // Held is what depends on the held deletions, not the device's whole chain (review of release 0.9.0).
    expect(phone.vault.files.has("after.md")).toBe(true);
    expect(await phone.state.listQuarantine("pending")).toEqual([]);
  });

  it("held: a later change of that device to a held file waits with the deletion, one to another file arrives", { timeout: 30_000 }, async () => {
    const { owner, phone } = await deletedElsewhere();
    await phone.worker.runCycle();
    await owner.vault.writeTextFile(names[3], "# made again after the deletion\n");
    await owner.state.enqueue("write", names[3]);
    await owner.vault.writeTextFile(names[55], "# n55 edited after\n");
    await owner.state.enqueue("write", names[55]);
    await owner.worker.runCycle();
    await phone.worker.runCycle();
    expect(await phone.vault.readTextFile(names[3])).toBe(`# ${names[3]}\n`);
    expect(await phone.vault.readTextFile(names[55])).toBe("# n55 edited after\n");
    phone.worker.approveSuspendedDeletions();
    await phone.worker.runCycle();
    expect(await phone.vault.readTextFile(names[3])).toBe("# made again after the deletion\n");
    expect(phone.vault.files.has(names[4])).toBe(false);
  });

  it("this device's own deletions held by its question: another device's changes to other files still arrive", { timeout: 30_000 }, async () => {
    const files = Array.from({ length: 30 }, (_, index) => `m${index}.md`);
    const owner = await synced([...files, "z.md"]);
    const phone = await ownerSecondDevice(owner);
    let asked = 0;
    owner.worker.onMassDeletionPending = () => { asked += 1; };
    for (const name of files.slice(0, 20)) {
      await owner.vault.deleteItem(name);
      await owner.state.enqueue("delete", name);
    }
    await owner.worker.runCycle();
    await phone.vault.writeTextFile("m3.md", "# m3 edited on the phone\n");
    await phone.state.enqueue("write", "m3.md");
    await phone.vault.writeTextFile("z.md", "# z edited on the phone\n");
    await phone.state.enqueue("write", "z.md");
    await phone.vault.writeTextFile("new.md", "# new on the phone\n");
    await phone.state.enqueue("write", "new.md");
    await phone.worker.runCycle();
    await owner.worker.runCycle();
    await owner.worker.runCycle();
    expect(asked).toBe(1);
    expect(await owner.vault.readTextFile("z.md")).toBe("# z edited on the phone\n");
    expect(await owner.vault.readTextFile("new.md")).toBe("# new on the phone\n");
  });

  it("let go: the files go here too, and what came after arrives", { timeout: 30_000 }, async () => {
    const { phone } = await deletedElsewhere();
    await phone.worker.runCycle();
    phone.worker.approveSuspendedDeletions();
    await phone.worker.runCycle();
    expect(names.slice(0, 50).some((name) => phone.vault.files.has(name))).toBe(false);
    expect(names.slice(50).every((name) => phone.vault.files.has(name))).toBe(true);
    expect(phone.vault.files.has("after.md")).toBe(true);
  });

  it("kept: the files stay here and go up again, for the other device too", { timeout: 30_000 }, async () => {
    const { owner, phone } = await deletedElsewhere();
    await phone.worker.runCycle();
    expect(await phone.worker.keepSuspendedDeletionsLocal()).toBe(50);
    await phone.worker.runCycle();
    expect(names.every((name) => phone.vault.files.has(name))).toBe(true);
    expect(phone.vault.files.has("after.md")).toBe(true);
    expect(await queued(phone.state)).toEqual([]);
    expect(await live(phone.state, names[0])).toBe(true);
    await owner.worker.runCycle();
    expect(names.every((name) => owner.vault.files.has(name))).toBe(true);
  });

  it("a few deletions from elsewhere are carried out without a question", { timeout: 30_000 }, async () => {
    const owner = await synced(names);
    const phone = await ownerSecondDevice(owner);
    for (const name of names.slice(0, 3)) {
      await owner.vault.deleteItem(name);
      await owner.state.enqueue("delete", name);
    }
    await owner.worker.runCycle();
    let asked = 0;
    phone.worker.onDeletionMirroringSuspended = () => { asked += 1; };
    await phone.worker.runCycle();
    expect(asked).toBe(0);
    expect(names.slice(0, 3).some((name) => phone.vault.files.has(name))).toBe(false);
  });
});

describe("A2 after review: another device's mass deletion is counted against what this device holds", () => {
  const names = Array.from({ length: 60 }, (_, index) => `n${String(index).padStart(2, "0")}.md`);

  it("edited first and then deleted, both arriving in one pull: held and asked, nothing goes", { timeout: 30_000 }, async () => {
    const owner = await synced(names);
    const phone = await ownerSecondDevice(owner);
    for (const name of names.slice(0, 50)) {
      await owner.vault.writeTextFile(name, `# ${name} edited\n`);
      await owner.state.enqueue("write", name);
    }
    await owner.worker.runCycle();
    for (const name of names.slice(0, 50)) {
      await owner.vault.deleteItem(name);
      await owner.state.enqueue("delete", name, null, { confirmed: true });
    }
    await owner.worker.runCycle();
    const asked: number[] = [];
    phone.worker.onDeletionMirroringSuspended = (info) => asked.push(info.missing);
    await phone.worker.runCycle();
    expect(asked).toEqual([50]);
    expect(names.every((name) => phone.vault.files.has(name))).toBe(true);
    expect(await phone.state.listQuarantine("pending")).toEqual([]);
  });

  it("asks as the workspace's question: another device deleted them, not a cloud that lost them", { timeout: 30_000 }, async () => {
    const owner = await synced(names);
    const phone = await ownerSecondDevice(owner);
    for (const name of names.slice(0, 50)) {
      await owner.vault.deleteItem(name);
      await owner.state.enqueue("delete", name, null, { confirmed: true });
    }
    await owner.worker.runCycle();
    const asked: unknown[] = [];
    phone.worker.onDeletionMirroringSuspended = (info) => asked.push(info);
    await phone.worker.runCycle();
    expect(asked).toEqual([{ missing: 50, confirmed: 60, probed: 50, absent: 50, fromWorkspaceDevice: true, staysLocal: 0 }]);
  });

  it("a folder deleted elsewhere, on a device that may not upload: counted in its files, kept here only, no refusal", { timeout: 30_000 }, async () => {
    const team = Array.from({ length: 50 }, (_, index) => `Team/n${String(index).padStart(2, "0")}.md`);
    const member = await workspaceMember([], "Reader");
    await member.owner.vault.createDir("Team");
    await member.owner.state.enqueue("mkdir", "Team");
    for (const name of [...team, ...names.slice(0, 10)]) {
      await member.owner.vault.writeTextFile(name, `# ${name}\n`);
      await member.owner.state.enqueue("write", name);
    }
    await member.owner.worker.runCycle();
    await member.worker.runCycle();
    expect(team.every((name) => member.vault.files.has(name))).toBe(true);
    await member.owner.vault.deleteItem("Team", true);
    await member.owner.state.enqueue("delete", "Team", null, { confirmed: true });
    await member.owner.worker.runCycle();
    const asked: Array<{ missing: number; staysLocal?: number }> = [];
    member.worker.onDeletionMirroringSuspended = (info) => asked.push(info);
    const refused: string[][] = [];
    member.worker.onChangesRefused = (paths) => refused.push(paths);
    await member.worker.runCycle();
    expect(asked.map((info) => [info.missing, info.staysLocal])).toEqual([[50, 50]]);
    await member.worker.keepSuspendedDeletionsLocal();
    await member.worker.runCycle();
    await member.worker.runCycle();
    expect(team.every((name) => member.vault.files.has(name))).toBe(true);
    expect(refused).toEqual([]);
    expect(await queued(member.state)).toEqual([]);
  });

  it("on a device that may not upload, keeping means: here only, as its own version — and no list of refusals after it", { timeout: 30_000 }, async () => {
    const member = await workspaceMember(names, "Reader");
    for (const name of names.slice(0, 50)) {
      await member.owner.vault.deleteItem(name);
      await member.owner.state.enqueue("delete", name, null, { confirmed: true });
    }
    await member.owner.worker.runCycle();
    const asked: Array<{ staysLocal?: number }> = [];
    member.worker.onDeletionMirroringSuspended = (info) => asked.push(info);
    const refused: string[][] = [];
    member.worker.onChangesRefused = (paths) => refused.push(paths);
    await member.worker.runCycle();
    expect(asked.map((info) => info.staysLocal)).toEqual([50]);
    expect(await member.worker.keepSuspendedDeletionsLocal()).toBe(50);
    await member.worker.runCycle();
    await member.worker.runCycle();
    expect(names.every((name) => member.vault.files.has(name))).toBe(true);
    expect(await queued(member.state)).toEqual([]);
    expect(refused).toEqual([]);
    const forks = await member.state.listLocalForks();
    expect(forks.filter((fork) => fork.reason === "kept-local").length).toBe(50);
    expect(forks.filter((fork) => fork.reason === "permission-denied")).toEqual([]);
    // A start after it records no refusal either: the kept files are this device's own.
    await initializePersonalWorkspaceMigration({ store: member.store, state: member.state, vault: member.vault, runtime: member.runtime, recoveryConfirmedAt: "2026-11-16T09:01:00.000Z", permissions: chainPermissions(member.vault, member.state, member.runtime) });
    await member.worker.runCycle();
    expect(refused).toEqual([]);
    expect(await queued(member.state)).toEqual([]);
    await member.owner.worker.runCycle();
    expect(names.slice(0, 50).some((name) => member.owner.vault.files.has(name))).toBe(false);
  });
});
