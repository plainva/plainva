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
 * Issue 113: a synced note moved or renamed IN the app vanished with the
 * first sync cycle — with WebDAV and S3 every time, with Drive, Dropbox and
 * OneDrive whenever a full listing fell between the move and its push.
 *
 * `queueRename` carries the note's sync row — remote ETag and merge base —
 * to the destination (on purpose, #59). The cycle's listing still shows the
 * note at its OLD place, so step 2b ("mirror remote deletions") read the
 * destination row as "was up there, is gone now"; a probe honestly answered
 * "absent" because the MOVE had not been pushed yet, and since the content
 * matched the base the note was deleted locally — one step before the same
 * cycle pushed the MOVE. 0.8.3 then queued a remote DELETE as well.
 *
 * Everything here is the real core: worker, engine, queue, the adapter chain
 * the desktop builds (backups under the worker, conflict awareness and the
 * queue on the app side), the indexer with the shell's two sync hooks, real
 * SQLite and a real folder on disk. Only the remote is in memory.
 */

const BODY = "# Note\n\nhello\n";

interface RemoteFile {
  text: string;
  etag: string;
}

type Kind = "webdav" | "drive";

interface WorldOptions {
  kind: Kind;
  /** Whether the target can be asked about one file (main's WebDAV/S3 can, 0.8.3's could not). */
  probe: boolean;
  /** Whether the MOVE response carries an ETag (many WebDAV servers send none). */
  moveEtag?: boolean;
  files: Record<string, string>;
}

const worlds: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (worlds.length > 0) await worlds.pop()!();
});

async function sha(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function walk(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(root, full)));
    else out.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return out;
}

async function world(opts: WorldOptions) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-move-cycle-"));
  const db: IDatabaseAdapter = await realSqlite();
  worlds.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  // Every local removal, whoever asks for it: the worker's deletions go
  // through here (after the backup snapshot), and so would a trash move.
  const localDeletes: string[] = [];
  const rawDelete = raw.deleteItem.bind(raw);
  raw.deleteItem = (async (p: string, ...rest: unknown[]) => {
    localDeletes.push(p);
    return (rawDelete as (...a: unknown[]) => Promise<void>)(p, ...rest);
  }) as typeof raw.deleteItem;

  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
  const ownDeletions = new OwnDeletionRegister();

  // --- the remote ---------------------------------------------------------
  const remote = new Map<string, RemoteFile>();
  const pushes: string[] = [];
  const probes: string[] = [];
  let etagSeq = 1;
  /** Drive-like change log: version -> paths changed / deleted at it. */
  let version = 0;
  const changes: Array<{ at: number; path: string; deleted: boolean }> = [];
  const touch = (p: string, deleted: boolean) => changes.push({ at: ++version, path: p, deleted });

  const target: any = {
    async pull(cursor?: string) {
      if (opts.kind === "drive" && cursor !== undefined) {
        const since = Number(cursor);
        const etagMap = new Map<string, string>();
        const deleted: string[] = [];
        for (const c of changes) {
          if (c.at <= since) continue;
          if (c.deleted) deleted.push(c.path);
          else if (remote.has(c.path)) etagMap.set(c.path, remote.get(c.path)!.etag);
        }
        return { etagMap, deleted, nextCursor: String(version) };
      }
      return {
        etagMap: new Map([...remote].map(([p, f]) => [p, f.etag])),
        ...(opts.kind === "drive" ? { nextCursor: String(version) } : {}),
      };
    },
    async download(p: string) {
      const f = remote.get(p);
      return f ? new TextEncoder().encode(f.text) : null;
    },
    async push(op: any) {
      pushes.push(`${op.operation} ${op.file_path}${op.new_path ? ` -> ${op.new_path}` : ""}`);
      if (op.operation === "write") {
        const etag = `"w${++etagSeq}"`;
        remote.set(op.file_path, { text: new TextDecoder().decode(op.content), etag });
        touch(op.file_path, false);
        return { etag };
      }
      if (op.operation === "delete") {
        for (const k of [...remote.keys()]) {
          if (k === op.file_path || k.startsWith(op.file_path + "/")) {
            remote.delete(k);
            touch(k, true);
          }
        }
        return undefined;
      }
      if (op.operation === "rename") {
        const hit = [...remote.keys()].filter((k) => k === op.file_path || k.startsWith(op.file_path + "/"));
        if (hit.length === 0) return { renameSourceMissing: true };
        let etag: string | undefined;
        for (const k of hit) {
          const f = remote.get(k)!;
          const dest = op.new_path + k.slice(op.file_path.length);
          remote.delete(k);
          remote.set(dest, f);
          touch(k, true);
          touch(dest, false);
          etag = f.etag;
        }
        // Same resource, same ETag — when the server sends one at all.
        return opts.moveEtag && hit.length === 1 ? { etag } : undefined;
      }
      return undefined;
    },
  };
  if (opts.kind === "drive") target.getStartCursor = async () => String(version);
  if (opts.probe) {
    target.probeExists = async ({ path: p }: RemoteProbe) => {
      probes.push(p);
      return remote.has(p) ? "present" : "absent";
    };
  }

  // --- the shell's index hooks (VaultContext.onLocalFileDeleted / onNewLocalFile) ---
  let live = false;
  const indexer = new VaultIndexer(raw, db, {
    onNewLocalFile: (p) => {
      if (live) void queue.queueWrite(p);
    },
    onLocalFileDeleted: (p) => {
      if (!live || p.includes(".plainva")) return;
      if (ownDeletions.consume(p)) return;
      void queue.queueDelete(p);
    },
  });

  // --- a synced vault: identical here and up there, with a merge base ------
  for (const [p, text] of Object.entries(opts.files)) {
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
  const questions: number[] = [];
  worker.onDeletionMirroringSuspended = (info) => void questions.push(info.missing);

  return {
    raw,
    app,
    db,
    worker,
    /** Every "N files are missing, delete them?" the worker would have asked. */
    questions,
    /** A Drive-like change set that reports this path as deleted. */
    tombstone: (p: string) => touch(p, true),
    remote,
    pushes,
    probes,
    localDeletes,
    indexer,
    /** One sync cycle, then the watcher's pass over what the cycle changed. */
    async cycle(forceFullListing = false) {
      if (forceFullListing) (worker as any).cyclesSinceFull = 1_000;
      await worker.runCycle();
      // The index hooks queue asynchronously (void); let them land.
      await new Promise((r) => setTimeout(r, 0));
      await indexer.indexVaultFull();
      await new Promise((r) => setTimeout(r, 0));
    },
    /** What the desktop and the phone do for an in-app move or rename. */
    async moveInApp(from: string, to: string, folder: boolean) {
      await app.renameItem(from, to);
      await indexer.relocatePathInIndex(from, to);
      if (folder) await indexer.indexVaultFull();
      else await indexer.indexPath(to);
      await new Promise((r) => setTimeout(r, 0));
    },
    async localText(p: string): Promise<string | null> {
      return (await raw.exists(p)) ? raw.readTextFile(p) : null;
    },
    async backups(): Promise<string[]> {
      return (await walk(root)).filter((p) => p.startsWith(".plainva/backups/"));
    },
    async queued(): Promise<string[]> {
      const rows = await db.query<{ operation: string; file_path: string; new_path: string | null }>(
        `SELECT operation, file_path, new_path FROM offline_queue ORDER BY id`,
      );
      return rows.map((r) => `${r.operation} ${r.file_path}${r.new_path ? ` -> ${r.new_path}` : ""}`);
    },
  };
}

type World = Awaited<ReturnType<typeof world>>;

async function expectArrived(w: World, moves: Array<{ from: string; to: string; text: string }>) {
  for (const { from, to, text } of moves) {
    expect(await w.localText(to), `${to} is here`).toBe(text);
    expect(await w.raw.exists(from), `${from} is gone here`).toBe(false);
    expect(w.remote.get(to)?.text, `${to} is up there`).toBe(text);
    expect(w.remote.has(from), `${from} is gone up there`).toBe(false);
  }
  expect(w.pushes.filter((p) => p.startsWith("delete")), "no DELETE was pushed").toEqual([]);
  expect(w.localDeletes, "nothing was removed locally").toEqual([]);
  expect(await w.backups(), "no deletion snapshot was taken").toEqual([]);
  expect(await w.queued(), "the queue drained").toEqual([]);
  expect(w.questions, "nobody was asked whether to delete anything").toEqual([]);
}

const combos: Array<{ label: string; kind: Kind; probe: boolean; moveEtag: boolean }> = [
  { label: "WebDAV-like target that can be asked about one file", kind: "webdav", probe: true, moveEtag: false },
  { label: "WebDAV-like target that cannot be asked (0.8.3)", kind: "webdav", probe: false, moveEtag: false },
  { label: "WebDAV-like target whose MOVE answers with an ETag", kind: "webdav", probe: true, moveEtag: true },
  { label: "Drive-like target on a forced full listing", kind: "drive", probe: true, moveEtag: false },
];

describe.each(combos)("an in-app move survives the sync cycles (issue 113) — $label", ({ kind, probe, moveEtag }) => {
  const cycles = async (w: World) => {
    for (let i = 0; i < 3; i++) await w.cycle(kind === "drive");
  };

  it("moves a synced note into another folder", async () => {
    const w = await world({ kind, probe, moveEtag, files: { "A/note.md": BODY, "B/other.md": "other\n" } });
    if (kind === "drive") await w.cycle(); // a cursor exists: the full listing is forced, not the first
    await w.moveInApp("A/note.md", "B/note.md", false);
    await cycles(w);
    expect(w.pushes).toContain("rename A/note.md -> B/note.md");
    await expectArrived(w, [{ from: "A/note.md", to: "B/note.md", text: BODY }]);
    expect(await w.localText("B/other.md")).toBe("other\n");
  });

  it("renames a synced note in place", async () => {
    const w = await world({ kind, probe, moveEtag, files: { "A/note.md": BODY, "A/other.md": "other\n" } });
    if (kind === "drive") await w.cycle();
    await w.moveInApp("A/note.md", "A/renamed.md", false);
    await cycles(w);
    expect(w.pushes).toContain("rename A/note.md -> A/renamed.md");
    await expectArrived(w, [{ from: "A/note.md", to: "A/renamed.md", text: BODY }]);
  });

  it("moves a synced folder of 3 notes in a vault of 16", async () => {
    // Small enough for the mass-deletion guard to stay silent: before the fix
    // all three were deleted, one by one.
    const files: Record<string, string> = { "Archiv/keep.md": "keep\n" };
    for (let i = 0; i < 12; i++) files[`note-${i}.md`] = `# ${i}\n`;
    const names = ["a.md", "b.md", "c.md"];
    for (const n of names) files[`Projekt/${n}`] = `# ${n}\n`;
    const w = await world({ kind, probe, moveEtag, files });
    if (kind === "drive") await w.cycle();
    await w.moveInApp("Projekt", "Archiv/Projekt", true);
    await cycles(w);
    expect(w.pushes).toContain("rename Projekt -> Archiv/Projekt");
    await expectArrived(w, names.map((n) => ({ from: `Projekt/${n}`, to: `Archiv/Projekt/${n}`, text: `# ${n}\n` })));
  });

  it("moves a synced folder of 16 notes", async () => {
    // In a vault large enough (100 notes) that 16 absences do not trip the
    // mass-deletion guard either: before the fix all 16 were deleted.
    const files: Record<string, string> = { "Archiv/keep.md": "keep\n" };
    for (let i = 0; i < 83; i++) files[`Other/note-${i}.md`] = `# other ${i}\n`;
    const names = Array.from({ length: 16 }, (_, i) => `n${String(i + 1).padStart(2, "0")}.md`);
    for (const n of names) files[`Projekt/${n}`] = `# ${n}\n`;
    const w = await world({ kind, probe, moveEtag, files });
    if (kind === "drive") await w.cycle();
    await w.moveInApp("Projekt", "Archiv/Projekt", true);
    await cycles(w);
    expect(w.pushes).toContain("rename Projekt -> Archiv/Projekt");
    await expectArrived(w, names.map((n) => ({ from: `Projekt/${n}`, to: `Archiv/Projekt/${n}`, text: `# ${n}\n` })));
    expect(await w.localText("Archiv/keep.md")).toBe("keep\n");
  });
});

describe("the rule holds wherever a deletion is concluded (issue 113)", () => {
  it("an incremental pull that names the destination as deleted leaves the moved note alone", async () => {
    // A cursor pull delivers explicit deletions. One for a path whose rename
    // this device still has to push (a tombstone of an earlier file there)
    // is no evidence about the note that now lives at that path.
    const w = await world({ kind: "drive", probe: true, files: { "A/note.md": BODY } });
    await w.cycle();
    await w.moveInApp("A/note.md", "B/note.md", false);
    w.tombstone("B/note.md");
    await w.cycle();
    expect(await w.localText("B/note.md"), "the moved note is still here").toBe(BODY);
    expect(w.localDeletes).toEqual([]);
  });

  it("re-checks the queue under the path lock, past the cycle's snapshot", async () => {
    // The listing and the state snapshot of a cycle can predate the rename;
    // the mirror asks the queue itself right before it would delete.
    const w = await world({ kind: "webdav", probe: true, files: { "A/note.md": BODY } });
    const snapshot = await new SyncStateRepository(w.db).getAllStates();
    await w.moveInApp("A/note.md", "B/note.md", false);
    const moved = await new SyncStateRepository(w.db).getSyncState("B/note.md");
    snapshot.set("B/note.md", moved!);
    const outcome = await (w.worker as any).mirrorRemoteDeletion("B/note.md", snapshot, [], [], true);
    expect(outcome).toBe("awaitingStructure");
    expect(await w.localText("B/note.md")).toBe(BODY);
    expect(w.probes, "nobody was asked: the queue already answers").toEqual([]);
  });
});
