import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import { byteExactDav, type ByteExactDav } from "../helpers/byteExactDav.js";
import { walk } from "../helpers/davDevice.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter } from "../../src/vault/BackupVaultAdapter.js";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import { VaultIndexer } from "../../src/vault/VaultIndexer.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { SyncWorker } from "../../src/sync/SyncWorker.js";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import { OwnDeletionRegister } from "../../src/sync/ownDeletions.js";
import { adoptOwnRemovals } from "../../src/sync/ownRemovalNotes.js";
import { vaultFolderIsThere } from "../../src/vault/IVaultAdapter.js";
import { crashable, removalLooks, type Crashable } from "../helpers/crashedRuntime.js";
import type { IDatabaseAdapter } from "../../src/db/IDatabaseAdapter.js";

/**
 * A runtime of a vault that ends while its sync cycle is at work — a crash,
 * the app killed — and a new one opens the same folder and the same index
 * database. What the old cycle had done halfway is not recorded — four
 * states:
 *
 *  (a) an upload sent, the provider has it, its sync row not written;
 *  (b) a download written into the vault, its sync row not written;
 *  (c) a deletion of the provider's carried out here, its record not written
 *      (and the old runtime's mark in memory gone with it);
 *  (d) a deletion the person confirmed, sent, not recorded.
 *
 * After the next cycle of the new runtime nothing is missing and nothing is
 * there twice: the vault and the provider hold the same files, no conflict
 * copy, no second deletion — and (c) is never taken for the person's
 * deletion: nothing queued, nothing sent.
 */

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
  vi.restoreAllMocks();
});

/** A request of the provider held until released: `entered` resolves when it arrives. */
interface Hold {
  matches: (method: string, url: string) => boolean;
  entered: Promise<void>;
  release: () => void;
}
function hold(method: string, file: string): Hold & { arrived: () => void; released: Promise<void> } {
  let arrived!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((r) => (arrived = r));
  const released = new Promise<void>((r) => (release = r));
  return { matches: (m, url) => m === method && decodeURIComponent(url).endsWith(`/${file}`), entered, release, arrived, released };
}

/** The storage of a vault folder, telling when a write or a removal of a file has landed. */
class TellingVault extends LocalVaultAdapter {
  landed: ((what: "write" | "delete", rel: string) => void) | null = null;
  override async writeTextFile(p: string, content: string, ...rest: unknown[]): Promise<void> {
    await (super.writeTextFile as (...a: unknown[]) => Promise<void>)(p, content, ...rest);
    this.landed?.("write", p);
  }
  override async deleteItem(p: string, ...rest: unknown[]): Promise<void> {
    await (super.deleteItem as (...a: unknown[]) => Promise<void>)(p, ...rest);
    this.landed?.("delete", p);
  }
}

interface World {
  dav: ByteExactDav;
  remote: (p: string) => string | null;
  sent: string[];
  held: (Hold & { arrived: () => void; released: Promise<void> }) | null;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}
function world(): World {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const dav = byteExactDav();
  const w: World = {
    dav,
    remote: (p) => {
      const f = dav.files.get(p);
      return f ? new TextDecoder().decode(f.bytes) : null;
    },
    sent: [],
    held: null,
    fetch: async (input, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = String(input instanceof Request ? input.url : input);
      w.sent.push(`${method} ${decodeURIComponent(url.slice(dav.url.length))}`);
      const h = w.held;
      if (h && h.matches(method, url)) {
        w.held = null;
        h.arrived();
        await h.released;
      }
      return dav.fetch(input, init);
    },
  };
  return w;
}

/**
 * One runtime of a vault, as the shells build it: the real chain, indexer,
 * queue, engine and worker over a folder and an index database. `dies`
 * makes it a runtime that can crash.
 */
async function runtime(w: World, root: string, db: IDatabaseAdapter, dies?: Crashable) {
  const storage = new TellingVault(root);
  await storage.initialize();
  const raw = dies ? dies.wrap(storage) : storage;
  const base = dies ? dies.wrap(db) : db;
  const target = new WebDavSyncTarget({ url: w.dav.url, user: "u", pass: "p" }, w.fetch);
  target.allowRootCreation = false;
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(base);
  const repo = new SyncStateRepository(base);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
  const ownDeletions = new OwnDeletionRegister();
  // Before the index looks: what the sync removed here and did not record stays the sync's.
  await adoptOwnRemovals(base, ownDeletions, removalLooks(async () => (await vaultFolderIsThere(raw)) === true, (p) => raw.exists(p)));
  let queued: Promise<unknown> = Promise.resolve();
  const later = (work: () => Promise<unknown>) => { queued = queued.then(work).catch(() => undefined); };
  const indexer = new VaultIndexer(raw, base, {
    isOwnWrite: (p, sha256) => app.wasWrittenByUs(p, sha256),
    onExternalModification: (p) => later(() => queue.queueWrite(p)),
    onNewLocalFile: (p) => later(() => queue.queueWrite(p)),
    // As both shells: a removal the worker made is not the person's.
    onLocalFileDeleted: (p, row) => {
      if (ownDeletions.consume(p, row)) return;
      later(() => queue.queueDelete(p));
    },
  });
  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000, { ownDeletions });
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  const pulled: string[] = [];
  worker.onFilesChanged = (paths) => void pulled.push(...paths);
  return {
    storage, app, queue, db: base, indexer, worker,
    async cycle() {
      await indexer.indexVaultFull();
      await queued;
      await worker.runCycle();
      for (const p of pulled.splice(0)) await indexer.indexPath(p);
      await queued;
    },
  };
}

async function vault(_w: World) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-half-state-"));
  const db = await realSqlite();
  cleanups.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, db, file: (p: string) => path.join(root, p) };
}

const conflictCopies = (files: string[]) => files.filter((f) => /\.CONFLICT-/.test(f));
const settle = (p: Promise<unknown>) => p.then(() => undefined, () => undefined);

describe("a runtime that crashed mid-step, and the next runtime's cycle", () => {
  it("(a) an upload sent and not recorded: taken over as the same bytes — no second upload, no conflict copy", async () => {
    const w = world();
    const v = await vault(w);
    const dies = crashable();
    const old = await runtime(w, v.root, v.db, dies);
    await old.app.writeTextFile("Note.md", "written here\n");
    w.held = hold("PUT", "Note.md");
    const entered = w.held.entered;
    const release = w.held.release;
    const cycle = old.cycle();
    await entered;
    // The app dies while the upload is on its way; the provider still takes it.
    dies.crash();
    release();
    await settle(cycle);
    expect(w.remote("Note.md"), "the provider has it").toBe("written here\n");

    const next = await runtime(w, v.root, v.db);
    const before = w.sent.length;
    await next.cycle();
    expect(w.sent.slice(before).filter((r) => r.startsWith("PUT")), "no second upload").toEqual([]);
    expect(w.remote("Note.md")).toBe("written here\n");
    expect(await fs.readFile(v.file("Note.md"), "utf8")).toBe("written here\n");
    expect(conflictCopies(await walk(v.root))).toEqual([]);
    expect(await next.queue.listAllPending(10)).toMatchObject({ total: 0 });
  });

  it("(b) a download written and not recorded: no conflict copy, nothing sent back up", async () => {
    const w = world();
    const v = await vault(w);
    const first = await runtime(w, v.root, v.db);
    await first.app.writeTextFile("Note.md", "one\n");
    await first.cycle();
    // Another device changes the note.
    w.dav.files.set("Note.md", { bytes: new TextEncoder().encode("one\ntwo from elsewhere\n"), etag: '"e2"' });

    const dies = crashable();
    const old = await runtime(w, v.root, v.db, dies);
    // The app dies the moment the pulled text has landed in the vault, before its record.
    old.storage.landed = (what, rel) => { if (what === "write" && rel === "Note.md") dies.crash(); };
    await settle(old.cycle());
    expect(await fs.readFile(v.file("Note.md"), "utf8"), "the download is in the vault").toBe("one\ntwo from elsewhere\n");

    const next = await runtime(w, v.root, v.db);
    const before = w.sent.length;
    await next.cycle();
    expect(w.sent.slice(before).filter((r) => r.startsWith("PUT")), "nothing sent back up").toEqual([]);
    expect(await fs.readFile(v.file("Note.md"), "utf8")).toBe("one\ntwo from elsewhere\n");
    expect(w.remote("Note.md")).toBe("one\ntwo from elsewhere\n");
    expect(conflictCopies(await walk(v.root))).toEqual([]);
  });

  it("(c) a deletion of the provider's carried out here and not recorded: never taken for the person's deletion", async () => {
    const w = world();
    const v = await vault(w);
    const first = await runtime(w, v.root, v.db);
    await first.app.writeTextFile("Keep.md", "keep\n");
    await first.app.writeTextFile("Gone.md", "gone elsewhere\n");
    await first.cycle();
    // Another device deletes it.
    w.dav.files.delete("Gone.md");

    const dies = crashable();
    const old = await runtime(w, v.root, v.db, dies);
    // The app dies the moment the file is gone from the vault, before its record.
    old.storage.landed = (what, rel) => { if (what === "delete" && rel === "Gone.md") dies.crash(); };
    await settle(old.cycle());
    expect(await fs.stat(v.file("Gone.md")).then(() => true, () => false), "carried out here").toBe(false);

    const next = await runtime(w, v.root, v.db);
    const before = w.sent.length;
    await next.cycle();
    expect(w.sent.slice(before).filter((r) => r.startsWith("DELETE")), "nothing sent as a deletion").toEqual([]);
    expect(await next.queue.listAllPending(10), "nothing queued as the person's deletion").toMatchObject({ total: 0 });
    expect(await v.db.query(`SELECT path FROM sync_state WHERE path = 'Gone.md'`), "recorded as the worker would have").toEqual([]);
    expect(await walk(v.root)).not.toContain("Gone.md");
    expect(w.remote("Keep.md")).toBe("keep\n");
    expect(conflictCopies(await walk(v.root))).toEqual([]);
  });

  it("(d) a deletion the person confirmed, sent and not recorded: done, and nothing comes back", async () => {
    const w = world();
    const v = await vault(w);
    const first = await runtime(w, v.root, v.db);
    await first.app.writeTextFile("Old.md", "old\n");
    await first.cycle();

    const dies = crashable();
    const old = await runtime(w, v.root, v.db, dies);
    await old.app.deleteItem("Old.md", false, { confirmed: true } as never);
    w.held = hold("DELETE", "Old.md");
    const entered = w.held.entered;
    const release = w.held.release;
    const cycle = old.cycle();
    await entered;
    dies.crash();
    release();
    await settle(cycle);
    expect(w.remote("Old.md"), "the provider deleted it").toBeNull();

    const next = await runtime(w, v.root, v.db);
    await next.cycle();
    expect(w.remote("Old.md")).toBeNull();
    expect(await walk(v.root), "nothing comes back").not.toContain("Old.md");
    expect(await next.queue.listAllPending(10)).toMatchObject({ total: 0 });
    expect(conflictCopies(await walk(v.root))).toEqual([]);
  });

  for (const elsewhere of [false, true]) {
    it(`a note left over where the removal's record failed never takes away the row of a file made and deleted later at that path${elsewhere ? " — so a newer version from another device is not deleted unseen" : ""}`, async () => {
      const w = world();
      const v = await vault(w);
      const first = await runtime(w, v.root, v.db);
      await first.app.writeTextFile("Keep.md", "keep\n");
      await first.app.writeTextFile("Gone.md", "one\n");
      await first.cycle();
      w.dav.files.delete("Gone.md");

      // The removal is carried out here, its record fails: the note and the row stay.
      const r = await runtime(w, v.root, v.db);
      const record = vi.spyOn(SyncStateRepository.prototype, "deleteSyncState").mockRejectedValueOnce(new Error("disk I/O error"));
      await settle(r.cycle());
      record.mockRestore();
      expect(await fs.stat(v.file("Gone.md")).then(() => true, () => false)).toBe(false);
      // Later cycles clear the row another way.
      await r.cycle();
      await r.cycle();

      // The person makes a note of that name, it is synced, and they delete it; the app ends before the deletion goes up.
      await r.app.writeTextFile("Gone.md", "two, made later\n");
      await r.cycle();
      expect(w.remote("Gone.md"), "uploaded").toBe("two, made later\n");
      await r.app.deleteItem("Gone.md", false, { confirmed: true } as never);
      expect((await r.queue.listAllPending(10)).total, "the deletion is queued").toBeGreaterThan(0);
      // Meanwhile another device writes a newer version of it.
      if (elsewhere) w.dav.files.set("Gone.md", { bytes: new TextEncoder().encode("three, from elsewhere\n"), etag: '"e9"' });

      const next = await runtime(w, v.root, v.db);
      expect(await v.db.query(`SELECT path FROM sync_state WHERE path = 'Gone.md'`), "the start leaves the row of the queued deletion").toHaveLength(1);
      await next.cycle();
      await next.cycle();
      if (!elsewhere) {
        expect(w.remote("Gone.md"), "the person's deletion went up").toBeNull();
        expect(await walk(v.root), "and nothing comes back").not.toContain("Gone.md");
      } else {
        // THE DEFECT: without its row the deletion went up unconditionally and took the other device's version with it.
        expect(w.remote("Gone.md"), "the other device's version stays").toBe("three, from elsewhere\n");
        expect(await fs.readFile(v.file("Gone.md"), "utf8"), "and comes here").toBe("three, from elsewhere\n");
        // The pulled version, read by the index, goes up as what it is: settled after one more cycle.
        await next.cycle();
        expect(w.remote("Gone.md")).toBe("three, from elsewhere\n");
      }
      expect(await next.queue.listAllPending(10)).toMatchObject({ total: 0 });
    });
  }
});
