import { afterEach, describe, expect, it, vi } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { MemoryVault, ownerSecondDevice, queued, synced } from "./helpers/workspaceReconcile.js";
import {
  OwnDeletionRegister,
  adoptOwnRemovals,
  type IDatabaseAdapter,
  type IVaultAdapter,
} from "../src/index.js";
import {
  EncryptedWorkspaceWorker,
  FakeWorkspaceObjectStore,
  SqlWorkspaceStateStore,
} from "../src/workspace/index.js";
import { crashable, removalLooks, type Crashable } from "./helpers/crashedRuntime.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";

/**
 * The four states of a cycle cut off by a crash (see
 * test/sync/half-states.test.ts) in an encrypted workspace: the second
 * device of the owner dies while its workspace worker is at work; a new
 * runtime opens the same vault folder and the same index database. After the
 * next cycle nothing is missing and nothing is there twice on either device,
 * no conflict copy is made, and a deletion that came from the other device
 * is never taken for this one's.
 */

const dbs: IDatabaseAdapter[] = [];
afterEach(async () => {
  while (dbs.length > 0) await dbs.pop()!.close();
  vi.restoreAllMocks();
});

/** A vault that tells when a write or a removal of a file has landed. */
function telling(vault: MemoryVault, landed: (what: "write" | "delete", path: string) => void): IVaultAdapter {
  return new Proxy(vault, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (key === "writeBinaryFile" || key === "writeTextFile") return async (p: string, ...rest: unknown[]) => { await value.apply(target, [p, ...rest]); landed("write", p); };
      if (key === "deleteItem") return async (p: string, ...rest: unknown[]) => { await value.apply(target, [p, ...rest]); landed("delete", p); };
      return value.bind(target);
    },
  }) as IVaultAdapter;
}

/** The pointer swap that lands an upload or a deletion, held until released. */
function holdSwap(store: FakeWorkspaceObjectStore) {
  let arrived!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((r) => (arrived = r));
  const released = new Promise<void>((r) => (release = r));
  const swap = store.compareAndSwapPointer.bind(store);
  let once = true;
  vi.spyOn(store, "compareAndSwapPointer").mockImplementation(async (...args: Parameters<typeof swap>) => {
    if (once) {
      once = false;
      arrived();
      await released;
    }
    return swap(...args);
  });
  return { entered, release };
}

/** The owner's two devices; the second keeps its workspace state in a real index database. */
async function devices(names: string[]) {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const owner = await synced(names);
  const db = await realSqlite();
  dbs.push(db);
  const second = await ownerSecondDevice(owner, () => new SqlWorkspaceStateStore(db));
  return { owner, second, db };
}

type Second = Awaited<ReturnType<typeof devices>>["second"];

/** A runtime of the second device: its worker over the vault and the database, one that can crash where `dies` is given. */
async function runtimeOf(second: Second, db: IDatabaseAdapter, dies?: Crashable, vault: IVaultAdapter = second.vault) {
  const ownDeletions = new OwnDeletionRegister();
  const base = dies ? dies.wrap(db) : db;
  const storage = dies ? dies.wrap(vault) : vault;
  await adoptOwnRemovals(base, ownDeletions, removalLooks(async () => true, (p) => storage.exists(p)));
  const state = new SqlWorkspaceStateStore(base);
  const worker = new EncryptedWorkspaceWorker(second.store, state, storage, second.runtime, { ownDeletions });
  /** What the index reports of a file that vanished, as both shells handle it: the sync's removal, or the person's deletion. */
  const reportVanished = async (path: string, mtime: number) => {
    if (ownDeletions.consume(path, { mtime })) return;
    await state.enqueue("delete", path);
  };
  // The index as both shells run it over the vault: what it finds changed or new is queued at once, a
  // vanished file is the sync's removal or the person's deletion.
  let queuedByIndex: Promise<unknown> = Promise.resolve();
  const later = (work: () => Promise<unknown>) => { queuedByIndex = queuedByIndex.then(work).catch(() => undefined); };
  const indexer = new VaultIndexer(storage, base, {
    onExternalModification: (p) => later(() => state.enqueue("write", p)),
    onNewLocalFile: (p) => later(() => state.enqueue("write", p)),
    onLocalFileDeleted: (p, row) => {
      if (ownDeletions.consume(p, row)) return;
      later(() => state.enqueue("delete", p));
    },
  });
  /** The start's look of the index at the vault, and what it queued. */
  const index = async () => {
    await indexer.indexVaultFull();
    await queuedByIndex;
  };
  return { worker, state, reportVanished, index, indexer };
}

const conflictCopies = (vault: MemoryVault) => [...vault.files.keys()].filter((p) => /conflict/i.test(p));
const text = (vault: MemoryVault, path: string) => (vault.files.has(path) ? new TextDecoder().decode(vault.files.get(path)!) : null);
const settle = (p: Promise<unknown>) => p.then(() => undefined, () => undefined);

describe("an encrypted workspace's runtime that crashed mid-step, and the next runtime's cycle", () => {
  it("(a) an upload sent and not recorded: one object on both devices, no conflict copy", async () => {
    const { owner, second, db } = await devices(["A.md"]);
    await second.vault.writeTextFile("New.md", "written on the phone\n");
    const dies = crashable();
    const old = await runtimeOf(second, db, dies);
    await old.state.enqueue("write", "New.md");
    const held = holdSwap(second.store);
    const cycle = old.worker.runCycle();
    await held.entered;
    dies.crash();
    held.release();
    await settle(cycle);

    const next = await runtimeOf(second, db);
    await next.worker.runCycle();
    await owner.worker.runCycle();
    expect(text(owner.vault, "New.md"), "on the other device").toBe("written on the phone\n");
    expect(text(second.vault, "New.md")).toBe("written on the phone\n");
    expect((await owner.state.listObjects(false)).filter((o) => o.path === "New.md" && !o.deleted), "one object, not two").toHaveLength(1);
    expect(await queued(next.state)).toEqual([]);
    expect([...conflictCopies(owner.vault), ...conflictCopies(second.vault)]).toEqual([]);
  });

  it("(b) a download written and not recorded: no conflict copy, nothing sent back up", async () => {
    const { owner, second, db } = await devices(["A.md"]);
    await owner.vault.writeTextFile("A.md", "# A.md\nchanged on the desktop\n");
    await owner.state.enqueue("write", "A.md");
    await owner.worker.runCycle();

    const dies = crashable();
    const vault = telling(second.vault, (what, p) => { if (what === "write" && p === "A.md") dies.crash(); });
    const old = await runtimeOf(second, db, dies, vault);
    await settle(old.worker.runCycle());
    expect(text(second.vault, "A.md"), "the download is in the vault").toBe("# A.md\nchanged on the desktop\n");

    const next = await runtimeOf(second, db);
    await next.worker.runCycle();
    expect(await queued(next.state), "nothing to send back up").toEqual([]);
    expect(text(second.vault, "A.md")).toBe("# A.md\nchanged on the desktop\n");
    await owner.worker.runCycle();
    expect(text(owner.vault, "A.md")).toBe("# A.md\nchanged on the desktop\n");
    expect([...conflictCopies(owner.vault), ...conflictCopies(second.vault)]).toEqual([]);
  });

  it("(c) a deletion from the other device carried out here and not recorded: never taken for this device's deletion", async () => {
    const { owner, second, db } = await devices(["A.md", "Gone.md"]);
    await owner.vault.deleteItem("Gone.md");
    await owner.state.enqueue("delete", "Gone.md");
    await owner.worker.runCycle();

    const dies = crashable();
    const before = (await second.vault.getFileInfo("Gone.md")).mtime;
    const vault = telling(second.vault, (what, p) => { if (what === "delete" && p === "Gone.md") dies.crash(); });
    const old = await runtimeOf(second, db, dies, vault);
    await settle(old.worker.runCycle());
    expect(second.vault.files.has("Gone.md"), "carried out here").toBe(false);

    const next = await runtimeOf(second, db);
    // The index reports the file it no longer finds.
    await next.reportVanished("Gone.md", before);
    expect(await queued(next.state), "not queued as this device's deletion").toEqual([]);
    await next.worker.runCycle();
    expect(await queued(next.state)).toEqual([]);
    expect(second.vault.files.has("Gone.md")).toBe(false);
    expect(text(second.vault, "A.md")).toBe("# A.md\n");
    await owner.worker.runCycle();
    expect(owner.vault.files.has("Gone.md")).toBe(false);
    expect([...conflictCopies(owner.vault), ...conflictCopies(second.vault)]).toEqual([]);
  });

  it("(d) a deletion confirmed here, sent and not recorded: done once, and nothing comes back", async () => {
    const { owner, second, db } = await devices(["A.md", "Old.md"]);
    await second.vault.deleteItem("Old.md");
    const dies = crashable();
    const old = await runtimeOf(second, db, dies);
    await old.state.enqueue("delete", "Old.md");
    const held = holdSwap(second.store);
    const cycle = old.worker.runCycle();
    await held.entered;
    dies.crash();
    held.release();
    await settle(cycle);

    const next = await runtimeOf(second, db);
    await next.worker.runCycle();
    await owner.worker.runCycle();
    expect(owner.vault.files.has("Old.md"), "gone on the other device").toBe(false);
    expect(second.vault.files.has("Old.md"), "nothing comes back").toBe(false);
    expect(await queued(next.state)).toEqual([]);
    expect([...conflictCopies(owner.vault), ...conflictCopies(second.vault)]).toEqual([]);
  });
});

/** A cold index reports every file as new; both shells hold that back (`coldIndexOwed`) — nothing of it is a change here. */
async function settleColdIndex(state: SqlWorkspaceStateStore) {
  for (const entry of await state.listQueue()) await state.discardQueue(entry.id);
}

describe("the next start in the order of the app (review of part 1)", () => {
  it("(b) a download written and not recorded, which the index queues as changed before the first pull: done, no conflict copy", async () => {
    const { owner, second, db } = await devices(["A.md"]);
    // The phone's index has read the note as it was, and what it found new was settled.
    const first = await runtimeOf(second, db);
    await first.index();
    await settleColdIndex(first.state);
    await owner.vault.writeTextFile("A.md", "# A.md\nchanged on the desktop\n");
    await owner.state.enqueue("write", "A.md");
    await owner.worker.runCycle();

    const dies = crashable();
    const vault = telling(second.vault, (what, p) => { if (what === "write" && p === "A.md") dies.crash(); });
    const old = await runtimeOf(second, db, dies, vault);
    await settle(old.worker.runCycle());
    expect(text(second.vault, "A.md"), "the download is in the vault").toBe("# A.md\nchanged on the desktop\n");

    const next = await runtimeOf(second, db);
    // The start: the index finds the file other than its row and queues it at once, before any pull.
    await next.index();
    expect((await next.state.listQueue()).map((e) => `${e.operation} ${e.path}`), "queued by the index").toEqual(["write A.md"]);
    const operations = async () => (await second.store.list(".pvws/operations/")).items.length;
    const sentBefore = await operations();
    await next.worker.runCycle();
    expect(await queued(next.state), "the queued write was done by the download: it goes").toEqual([]);
    expect(await operations(), "nothing is sent").toBe(sentBefore);
    expect((await next.state.getObjectByPath("A.md"))?.currentRevisionId, "recorded as the other device's version").toBe((await owner.state.getObjectByPath("A.md"))?.currentRevisionId);
    expect([...conflictCopies(second.vault)], "no conflict copy here").toEqual([]);
    await owner.worker.runCycle();
    expect([...conflictCopies(owner.vault)], "and none on the other device").toEqual([]);
    expect(text(owner.vault, "A.md")).toBe("# A.md\nchanged on the desktop\n");
    expect(text(second.vault, "A.md")).toBe("# A.md\nchanged on the desktop\n");
  });

  it("(c) the incoming deletion is marked with the index's row as well as the file's time, in the running runtime and after the take-over", async () => {
    for (const crashes of [false, true]) {
      const { owner, second, db } = await devices(["A.md", "Gone.md"]);
      const first = await runtimeOf(second, db);
      await first.index();
      await settleColdIndex(first.state);
      // The index read the note at another time than the file carries now (it has not read it since the worker last wrote it).
      await db.execute(`UPDATE files SET mtime_local = 7 WHERE path = 'Gone.md'`);
      const row = (await db.queryOne<{ mtime_local: number }>(`SELECT mtime_local FROM files WHERE path = 'Gone.md'`))!.mtime_local;
      expect(row).toBe(7);
      expect((await second.vault.getFileInfo("Gone.md")).mtime).not.toBe(row);
      await owner.vault.deleteItem("Gone.md");
      await owner.state.enqueue("delete", "Gone.md");
      await owner.worker.runCycle();

      if (!crashes) {
        await first.worker.runCycle();
        expect(second.vault.files.has("Gone.md")).toBe(false);
        // The index reports the row it removed: the sync's, not the person's.
        await first.reportVanished("Gone.md", row);
        expect(await queued(first.state), "running: not queued as this device's deletion").toEqual([]);
        continue;
      }
      const dies = crashable();
      const vault = telling(second.vault, (what, p) => { if (what === "delete" && p === "Gone.md") dies.crash(); });
      const old = await runtimeOf(second, db, dies, vault);
      await settle(old.worker.runCycle());
      expect(second.vault.files.has("Gone.md")).toBe(false);
      const next = await runtimeOf(second, db);
      await next.reportVanished("Gone.md", row);
      expect(await queued(next.state), "after the take-over: not queued as this device's deletion").toEqual([]);
    }
  });
});
