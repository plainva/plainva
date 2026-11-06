import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter } from "../../src/vault/BackupVaultAdapter.js";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.js";
import { OwedQueueEntries } from "../../src/vault/owedQueueEntries.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { SyncWorker } from "../../src/sync/SyncWorker.js";

/**
 * A deletion or rename that waits in the chain is seen by the sync
 * (Datensicherheit D4).
 *
 * `QueueingVaultAdapter` changes the disk first and queues the change second;
 * an entry that fails is made up for while the write waits, up to 30 seconds
 * after the change. All that time the deletion is in no table: the sync queue
 * answered "nothing pending" for the path, and a pull that met a newer
 * version of the file in the cloud wrote it back — the person deleted a note
 * and it returned. The queue now asks what is owed to it.
 *
 * The real core: worker, engine, queue, chain, real SQLite and a real folder.
 * The remote is in memory.
 */

const worlds: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (worlds.length > 0) await worlds.pop()!();
});

async function sha(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A real SQLite whose next transactions are refused, as a locked or closing database refuses them. */
function refusing(inner: IDatabaseAdapter) {
  let refusals = 0;
  let given = 0;
  const database: IDatabaseAdapter = {
    ...inner,
    transaction(fn) {
      if (refusals > 0) {
        refusals -= 1;
        given += 1;
        return Promise.reject(new Error("database is locked"));
      }
      return inner.transaction(fn);
    },
  };
  return { database, refuse: (times: number) => { refusals = times; }, refused: () => given };
}

async function world(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-owed-structure-"));
  const { database: db, refuse, refused } = refusing(await realSqlite());
  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  // The next attempt of a failed entry is a minute away: the cycle below runs in the wait.
  const app = new QueueingVaultAdapter(backup, queue, { retryAtMs: [60_000] });
  worlds.push(async () => {
    await app.flush();
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  const remote = new Map<string, { text: string; etag: string }>();
  const downloads: string[] = [];
  const pushes: string[] = [];
  const target: any = {
    async pull() {
      return { etagMap: new Map([...remote].map(([p, f]) => [p, f.etag])) };
    },
    async download(p: string) {
      downloads.push(p);
      const f = remote.get(p);
      return f ? new TextEncoder().encode(f.text) : null;
    },
    async push(op: any) {
      pushes.push(`${op.operation} ${op.file_path}${op.new_path ? ` -> ${op.new_path}` : ""}`);
      if (op.operation === "delete") remote.delete(op.file_path);
      if (op.operation === "rename") {
        const f = remote.get(op.file_path);
        if (!f) return { renameSourceMissing: true };
        remote.delete(op.file_path);
        remote.set(op.new_path, f);
      }
      return undefined;
    },
    async probeExists({ path: p }: { path: string }) {
      return remote.has(p) ? "present" : "absent";
    },
  };

  for (const [p, text] of Object.entries(files)) {
    await raw.writeTextFile(p, text);
    remote.set(p, { text, etag: '"e1"' });
    const h = await sha(text);
    await db.execute(
      `INSERT INTO sync_state (path, local_sha256, remote_etag, base_sha256, base_etag, last_sync_ts, base_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [p, h, '"e1"', h, '"e1"', Date.now(), text],
    );
  }

  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000);
  (worker as any).isRunning = true;
  return {
    raw, app, queue, remote, downloads, pushes, refuse, refused,
    async cycle() {
      (worker as any).cyclesSinceFull = 1_000;
      await worker.runCycle();
    },
    async queued(): Promise<string[]> {
      const rows = await db.query<{ operation: string; file_path: string; new_path: string | null }>(
        `SELECT operation, file_path, new_path FROM offline_queue ORDER BY id`,
      );
      return rows.map((r) => `${r.operation} ${r.file_path}${r.new_path ? ` -> ${r.new_path}` : ""}`);
    },
  };
}

/** Waits until `done` holds — never a fixed time: a loaded machine is slow. */
const until = async (done: () => boolean | Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > end) throw new Error(`waited in vain for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("a deletion whose entry waits in the chain", () => {
  it("is seen by the sync: a newer version in the cloud does not bring the deleted note back", async () => {
    const w = await world({ "Note.md": "# Note\n" });
    w.refuse(1);
    const deleting = w.app.deleteItem("Note.md", false, { confirmed: true });
    await until(() => w.refused() === 1, "the entry's first attempt");
    // On disk it is gone; in the queue it is not yet — its next attempt is a minute away.
    expect(await w.raw.exists("Note.md")).toBe(false);
    expect(await w.queued()).toEqual([]);

    // Changed on another device meanwhile.
    w.remote.set("Note.md", { text: "# Note\n\nchanged elsewhere\n", etag: '"e2"' });
    await w.cycle();
    // It used to be downloaded and written back here: the deletion undone.
    expect(w.downloads).not.toContain("Note.md");
    expect(await w.raw.exists("Note.md")).toBe(false);
    // The queue says the path waits for its structure, though no row says so yet.
    expect(await w.queued()).toEqual([]);
    expect(await w.queue.hasPendingStructuralOp("Note.md")).toBe(true);
    expect(await w.queue.getPendingStructuralPaths()).toEqual(["Note.md"]);

    // The entry gets in; from then on the queue holds it, and the deletion goes up.
    await w.app.flush();
    await deleting;
    expect(await w.queued()).toEqual(["delete Note.md"]);
    expect(await w.queue.hasPendingStructuralOp("Note.md")).toBe(true);
  });

  it("a folder's deletion covers the files below it, a rename both of its ends", async () => {
    const w = await world({ "Folder/a.md": "a", "Old.md": "old" });
    // The deletion's entry fails; the rename's waits behind it, in the order of the changes.
    w.refuse(1);
    const deleting = w.app.deleteItem("Folder", true, { confirmed: true });
    const renaming = w.app.renameItem("Old.md", "New.md");
    await until(async () => w.refused() === 1 && !(await w.raw.exists("Old.md")), "both changes on disk");
    expect(await w.queue.hasPendingStructuralOp("Folder/a.md")).toBe(true);
    expect(await w.queue.hasPendingStructuralOp("Old.md")).toBe(true);
    expect(await w.queue.hasPendingStructuralOp("New.md")).toBe(true);
    expect(await w.queue.hasPendingStructuralOp("Folder2/a.md")).toBe(false);
    expect([...(await w.queue.getPendingStructuralPaths())].sort()).toEqual(["Folder", "Folder/a.md", "New.md", "Old.md"]);
    await w.app.flush();
    await deleting;
    await renaming;
  });

  it("a write that waits is no structural change: the sync still merges what came from elsewhere", async () => {
    const owed = new OwedQueueEntries({ retryAtMs: [60_000] });
    const queue = new SyncQueue(await realSqlite());
    queue.consultOwedEntries(owed);
    let attempts = 0;
    const waiting = owed.enqueue({ kind: "write", paths: ["Note.md"] }, async () => { attempts += 1; throw new Error("database is locked"); });
    waiting.catch(() => {});
    await until(() => attempts === 1, "the entry's first attempt");
    expect(await queue.hasPendingStructuralOp("Note.md")).toBe(false);
    expect(await queue.getPendingStructuralPaths()).toEqual([]);
    await owed.flush();
  });
});
