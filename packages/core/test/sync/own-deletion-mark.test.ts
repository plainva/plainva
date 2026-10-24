import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter } from "../../src/vault/BackupVaultAdapter.js";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import { VaultIndexer } from "../../src/vault/VaultIndexer.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { SyncWorker } from "../../src/sync/SyncWorker.js";
import { OwnDeletionRegister } from "../../src/sync/ownDeletions.js";
import type { RemoteProbe } from "../../src/sync/ISyncTarget.js";

/**
 * "That deletion was mine" answers for the file it was said about (finding
 * 2026-10-12).
 *
 * The worker mirrors a remote deletion by removing the local file, and marks
 * the path first: the index will report the file vanished, and the shell must
 * not queue a remote deletion for it (`OwnDeletionRegister`). The mark was a
 * path and a clock. It was taken back by the question it answered — and where
 * nobody asked, it stood for an hour: the index held no row for the file (one
 * a pull had written a moment before, any file while the index is rebuilt),
 * or the file was back before a pass had looked. A file created under the
 * same name within that hour and deleted outside the app was then answered
 * by the old mark: its deletion never reached the remote, where the file
 * stayed, on every other device too.
 *
 * Everything here is the real core — worker, engine, queue, the adapter chain,
 * the indexer with the shell's two hooks, real SQLite, real files. Only the
 * remote is in memory.
 */

const worlds: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (worlds.length > 0) await worlds.pop()!();
});

async function sha(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function world(files: Record<string, string>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-own-deletion-"));
  const db: IDatabaseAdapter = await realSqlite();
  worlds.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
  let clock = 1_000_000;
  const ownDeletions = new OwnDeletionRegister(60 * 60 * 1000, () => clock);

  // --- the remote: a WebDAV-like listing, and a target that can be asked about one file ---
  const remote = new Map<string, { text: string; etag: string }>();
  const pushes: string[] = [];
  let etagSeq = 1;
  const target: any = {
    async pull() {
      return { etagMap: new Map([...remote].map(([p, f]) => [p, f.etag])) };
    },
    async download(p: string) {
      const f = remote.get(p);
      return f ? new TextEncoder().encode(f.text) : null;
    },
    async push(op: any) {
      pushes.push(`${op.operation} ${op.file_path}`);
      if (op.operation === "write") {
        const etag = `"w${++etagSeq}"`;
        remote.set(op.file_path, { text: new TextDecoder().decode(op.content), etag });
        return { etag };
      }
      if (op.operation === "delete") remote.delete(op.file_path);
      return undefined;
    },
    async probeExists({ path: p }: RemoteProbe) {
      return remote.has(p) ? "present" : "absent";
    },
  };

  // --- the shell's index hooks (VaultContext / vaultService: onLocalFileDeleted, onNewLocalFile) ---
  let live = false;
  const indexer = new VaultIndexer(raw, db, {
    isOwnWrite: (p, hash) => app.wasWrittenByUs(p, hash),
    onNewLocalFile: (p) => {
      if (live) void queue.queueWrite(p);
    },
    onExternalModification: (p) => {
      if (live) void queue.queueWrite(p);
    },
    onLocalFileDeleted: (p, indexed) => {
      if (!live || p.includes(".plainva")) return;
      if (ownDeletions.consume(p, indexed)) return;
      void queue.queueDelete(p);
    },
  });

  // --- a synced vault: identical here and up there, with a merge base ---
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
  await indexer.indexVaultFull();
  live = true;

  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000, { ownDeletions });
  (worker as any).isRunning = true;
  // What the shell does with the paths a cycle changed: the index is told, path by path.
  let told: Promise<unknown> = Promise.resolve();
  worker.onFilesChanged = (paths) => {
    told = told.then(async () => {
      for (const p of paths) await indexer.indexPath(p);
    });
  };
  const settle = async () => {
    await told;
    await new Promise((r) => setTimeout(r, 0));
  };

  return {
    root,
    raw,
    app,
    db,
    queue,
    remote,
    pushes,
    indexer,
    ownDeletions,
    /** Minutes pass. */
    later: (minutes: number) => { clock += minutes * 60_000; },
    /** One sync cycle, then the index hearing of what the cycle changed. */
    async cycle() {
      await worker.runCycle();
      await settle();
    },
    /** The scan a return to the app runs, and the hooks it sets off. */
    async scan() {
      await indexer.indexVaultFull();
      await settle();
    },
    async queued(): Promise<string[]> {
      const rows = await db.query<{ operation: string; file_path: string }>(
        `SELECT operation, file_path FROM offline_queue ORDER BY id`,
      );
      return rows.map((r) => `${r.operation} ${r.file_path}`);
    },
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** A file made by another program and found by the index: on disk, indexed, uploaded. */
async function createdOutsideAndSynced(w: World, p: string, text: string): Promise<void> {
  await fs.writeFile(path.join(w.root, p), text, "utf8");
  await w.scan();
  await w.cycle();
  expect(w.remote.get(p)?.text, `${p} went up`).toBe(text);
}

/** Deleted by another program, found by the index, and the cycles that follow. */
async function deletedOutside(w: World, p: string): Promise<void> {
  await fs.rm(path.join(w.root, p));
  await w.scan();
  await w.cycle();
  await w.cycle();
}

describe("the worker's mark for a deletion it mirrored", () => {
  it("the ordinary case: the index reports the file gone, the mark answers, no remote deletion is queued", async () => {
    const w = await world({ "Notes/a.md": "# a\n", "Notes/keep.md": "# keep\n" });
    w.remote.delete("Notes/a.md");
    await w.cycle();

    expect(await w.raw.exists("Notes/a.md")).toBe(false);
    expect(await w.queued()).toEqual([]);
    expect(w.pushes).toEqual([]);
    expect(w.ownDeletions.size, "the mark was spent on the report").toBe(0);
  });

  it("a file the index did not hold is marked for itself only: a later file of that name, deleted outside the app, is deleted on the remote", async () => {
    const w = await world({ "Notes/a.md": "# a\n", "Notes/keep.md": "# keep\n" });
    // The index does not hold the file: pulled a moment ago, or the index is being rebuilt.
    await w.db.execute("DELETE FROM files WHERE path = ?", ["Notes/a.md"]);
    w.remote.delete("Notes/a.md");
    await w.cycle();
    expect(await w.raw.exists("Notes/a.md")).toBe(false);
    expect(await w.queued()).toEqual([]);

    // Twenty minutes later a note of the same name is written by another program, and goes up.
    w.later(20);
    await createdOutsideAndSynced(w, "Notes/a.md", "# a, another\n");
    // Ten minutes on it is deleted in the file manager.
    w.later(10);
    await deletedOutside(w, "Notes/a.md");

    // The old mark answered: nothing was queued, and the note stayed on the remote.
    expect(w.pushes).toContain("delete Notes/a.md");
    expect(w.remote.has("Notes/a.md"), "the note is gone up there").toBe(false);
    expect(await w.raw.exists("Notes/a.md"), "…and did not come back here").toBe(false);
  });

  it("a file that was back before a pass had looked: the mark for the one that went does not answer for it", async () => {
    const w = await world({ "Notes/a.md": "# a\n", "Notes/keep.md": "# keep\n" });
    w.remote.delete("Notes/a.md");
    // The cycle removes the note; before the index hears of it, another program has written one of that name.
    const indexPath = w.indexer.indexPath.bind(w.indexer);
    w.indexer.indexPath = async (p) => {
      w.indexer.indexPath = indexPath;
      await fs.writeFile(path.join(w.root, "Notes/a.md"), "# a, another\n", "utf8");
      return indexPath(p);
    };
    await w.cycle();
    expect(await w.raw.readTextFile("Notes/a.md")).toBe("# a, another\n");
    await w.cycle();
    expect(w.remote.get("Notes/a.md")?.text, "the new note went up").toBe("# a, another\n");

    w.later(10);
    await deletedOutside(w, "Notes/a.md");

    expect(w.pushes).toContain("delete Notes/a.md");
    expect(w.remote.has("Notes/a.md")).toBe(false);
  });

  it("a row a pass writes after the worker asked — the scan read the file before it went — is still answered", async () => {
    const w = await world({ "Notes/a.md": "# a\n", "Notes/keep.md": "# keep\n" });
    // The index does not hold the file when the worker asks; a pass that had
    // read the file a moment before writes its row right after the question.
    await w.db.execute("DELETE FROM files WHERE path = ?", ["Notes/a.md"]);
    w.remote.delete("Notes/a.md");
    const indexedRow = w.queue.indexedRow.bind(w.queue);
    w.queue.indexedRow = async (p) => {
      w.queue.indexedRow = indexedRow;
      const answer = await indexedRow(p);
      await w.indexer.indexFile(await w.raw.getFileInfo(p));
      return answer;
    };
    await w.cycle();

    expect(await w.raw.exists("Notes/a.md")).toBe(false);
    // What that pass found it may announce; the removal it is then reported
    // for is the worker's, and no deletion goes up.
    expect((await w.queued()).filter((op) => op.startsWith("delete"))).toEqual([]);
    expect(w.pushes.filter((op) => op.startsWith("delete"))).toEqual([]);
  });

  it("a row read again between the worker's question and its removal is still answered", async () => {
    const w = await world({ "Notes/a.md": "# a\n", "Notes/keep.md": "# keep\n" });
    // The row waits to be read again (a move in the app leaves 0); a pass reads
    // it right after the worker asked, and the row now carries the file's time.
    await w.db.execute("UPDATE files SET mtime_local = 0 WHERE path = ?", ["Notes/a.md"]);
    w.remote.delete("Notes/a.md");
    const indexedRow = w.queue.indexedRow.bind(w.queue);
    w.queue.indexedRow = async (p) => {
      w.queue.indexedRow = indexedRow;
      const answer = await indexedRow(p);
      await w.indexer.indexFile(await w.raw.getFileInfo(p));
      return answer;
    };
    await w.cycle();

    expect(await w.raw.exists("Notes/a.md")).toBe(false);
    expect(await w.queued()).toEqual([]);
    expect(w.pushes).toEqual([]);
  });

  it("the worker's own removal is still answered when the full scan gets there first", async () => {
    const w = await world({ "Notes/a.md": "# a\n", "Notes/keep.md": "# keep\n" });
    w.remote.delete("Notes/a.md");
    // The single path the shell sends is held back; a scan finds the file gone before it.
    const indexPath = w.indexer.indexPath.bind(w.indexer);
    w.indexer.indexPath = async (p) => {
      w.indexer.indexPath = indexPath;
      await w.indexer.indexVaultFull();
      return indexPath(p);
    };
    await w.cycle();

    expect(await w.queued()).toEqual([]);
    expect(w.pushes).toEqual([]);
  });
});
