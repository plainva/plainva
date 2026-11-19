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
import { createVaultCallOff, type VaultCallOff } from "../../src/sync/callOff.js";
import type { IDatabaseAdapter } from "../../src/db/IDatabaseAdapter.js";

/**
 * A vault closed while its sync cycle is at work, after the deadline: the
 * runtime is called off (`createVaultCallOff`) mid-step, and a new one opens
 * the same folder and the same index database. What the old cycle had done
 * halfway is not recorded — four states:
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
 * deletion: nothing queued, nothing sent. And the old runtime writes nothing
 * after it was called off, also once its held request is answered late.
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
function world(conditions: "honor" | "ignore" = "honor"): World {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const dav = byteExactDav(undefined, { conditions });
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
 * queue, engine and worker over a folder and an index database. `fence`
 * fences the database and the storage, as a shell hands them out.
 */
async function runtime(w: World, root: string, db: IDatabaseAdapter, fence?: VaultCallOff) {
  const storage = new TellingVault(root);
  await storage.initialize();
  const raw = fence ? fence.storage(storage) : storage;
  const base = fence ? fence.database(db) : db;
  const target = new WebDavSyncTarget({ url: w.dav.url, user: "u", pass: "p" }, w.fetch);
  target.allowRootCreation = false;
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(base);
  const repo = new SyncStateRepository(base);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
  const ownDeletions = new OwnDeletionRegister();
  // Before the index looks: what the sync removed here and did not record stays the sync's.
  await adoptOwnRemovals(base, ownDeletions, (p) => raw.exists(p));
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-call-off-"));
  const db = await realSqlite();
  cleanups.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, db, file: (p: string) => path.join(root, p) };
}

const conflictCopies = (files: string[]) => files.filter((f) => /\.CONFLICT-/.test(f));
const settle = (p: Promise<unknown>) => p.then(() => undefined, () => undefined);

/** Everything the database and the folder hold, to tell that a called-off runtime wrote nothing more. */
async function snapshot(db: IDatabaseAdapter, root: string) {
  return JSON.stringify([
    await db.query(`SELECT path, base_sha256, remote_etag FROM sync_state ORDER BY path`),
    await db.query(`SELECT * FROM offline_queue ORDER BY id`),
    await walk(root),
  ]);
}

describe("a sync cycle called off mid-step, and the next runtime's cycle", () => {
  it("(a) an upload sent and not recorded: taken over as the same bytes — no second upload, no conflict copy", async () => {
    const w = world();
    const v = await vault(w);
    const fence = createVaultCallOff();
    const old = await runtime(w, v.root, v.db, fence);
    await old.app.writeTextFile("Note.md", "written here\n");
    w.held = hold("PUT", "Note.md");
    const entered = w.held.entered;
    const release = w.held.release;
    const cycle = old.cycle();
    await entered;
    // The deadline: called off while the upload is on its way; then the provider answers.
    fence.callOff();
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

    const fence = createVaultCallOff();
    const old = await runtime(w, v.root, v.db, fence);
    // Called off the moment the pulled text has landed in the vault, before its record.
    old.storage.landed = (what, rel) => { if (what === "write" && rel === "Note.md") fence.callOff(); };
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

    const fence = createVaultCallOff();
    const old = await runtime(w, v.root, v.db, fence);
    // Called off the moment the file is gone from the vault, before its record.
    old.storage.landed = (what, rel) => { if (what === "delete" && rel === "Gone.md") fence.callOff(); };
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

    const fence = createVaultCallOff();
    const old = await runtime(w, v.root, v.db, fence);
    await old.app.deleteItem("Old.md", false, { confirmed: true } as never);
    w.held = hold("DELETE", "Old.md");
    const entered = w.held.entered;
    const release = w.held.release;
    const cycle = old.cycle();
    await entered;
    fence.callOff();
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

  it("the next runtime starts only once the called-off one has ended — a late upload never lands over its own, even where the provider checks no condition", async () => {
    const w = world("ignore");
    const v = await vault(w);
    const fence = createVaultCallOff();
    const old = await runtime(w, v.root, v.db, fence);
    await old.app.writeTextFile("Note.md", "v1\n");
    w.held = hold("PUT", "Note.md");
    const entered = w.held.entered;
    const release = w.held.release;
    const cycle = old.cycle();
    await entered;
    fence.callOff();

    // As both shells do: the same vault opens again only once the old runtime has ended — its cycle through
    // (the provider answers its upload) and none of its calls open.
    let started = false;
    const nextOpens = (async () => {
      await settle(cycle);
      await fence.ended();
      started = true;
    })();
    await new Promise((r) => setTimeout(r, 20));
    expect(started, "waits while the old upload is open").toBe(false);
    release();
    await nextOpens;

    const next = await runtime(w, v.root, v.db);
    await next.app.writeTextFile("Note.md", "v2\n");
    await next.cycle();
    const after = await snapshot(v.db, v.root);
    await new Promise((r) => setTimeout(r, 20));
    expect(w.remote("Note.md"), "v2 stays").toBe("v2\n");
    expect(await fs.readFile(v.file("Note.md"), "utf8")).toBe("v2\n");
    expect(await snapshot(v.db, v.root), "the old runtime wrote nothing more").toBe(after);
    await expect(old.db.query(`SELECT 1`)).rejects.toThrow(/called off/);
  });
});
