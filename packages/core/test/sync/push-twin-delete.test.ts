import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { SyncWorker } from "../../src/sync/SyncWorker.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import type { NameCollision } from "../../src/sync/pathIdentity.js";
import type { ISyncTarget, SyncOperation } from "../../src/sync/ISyncTarget.js";

/**
 * Issue #112, O2: the twin lock on the PUSH side. A queued remote DELETE whose
 * path has a twin on this device's disk — the same name in the other Unicode
 * form, or in other letter case — is one file for Drive, OneDrive, Dropbox,
 * Windows and macOS, and on WebDAV possibly the only copy the server still
 * holds. The pull side has refused to mirror such a deletion since 2026-08-21;
 * the push side sent it. Now it is held and reported like the pull side's.
 *
 * Real files on a byte-exact file system (the CI's ext4), so both spellings can
 * sit side by side exactly as the index sees them on APFS.
 */

// Built by normalizing, so a tool that rewrites this file cannot silently turn
// the two spellings into one (the test would then pass for nothing).
const NFC = "Neutralität".normalize("NFC");
const NFD = NFC.normalize("NFD");

describe("a remote DELETE with a local twin is not pushed (issue #112)", () => {
  let db: Awaited<ReturnType<typeof realSqlite>>;
  let root: string;
  let vault: LocalVaultAdapter;
  let queue: SyncQueue;
  let pushed: string[];
  let target: ISyncTarget;

  beforeEach(async () => {
    expect(NFC).not.toBe(NFD);
    db = await realSqlite();
    root = await mkdtemp(join(tmpdir(), "plainva-twin-delete-"));
    vault = new LocalVaultAdapter(root);
    await vault.initialize();
    queue = new SyncQueue(db);
    pushed = [];
    target = {
      async push(op: SyncOperation) { pushed.push(`${op.operation} ${op.file_path}`); },
      async pull() { return { etagMap: new Map() }; },
      async download() { return null; },
    };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
    await rm(root, { recursive: true, force: true });
  });

  const pending = async () =>
    (await db.query<{ file_path: string; operation: string; retry_count: number }>(
      "SELECT file_path, operation, retry_count FROM offline_queue ORDER BY id"
    )).map((r) => `${r.operation} ${r.file_path} #${r.retry_count}`);

  it("drops a DELETE whose folder exists here in the other accent spelling: it is the same file (ADR 0016)", async () => {
    // The #112 chain: the disk holds the folder decomposed (macOS, iOS), the
    // sync row composed. Before the identity was NFC the index saw the
    // decomposed file as new and the composed one as gone and queued a DELETE
    // of the one the server holds; O2 held it. Since ADR 0016 the adapter
    // lists the folder under its composed identity: the file is right here,
    // so such a DELETE is stale and never goes out.
    await mkdir(join(root, NFD));
    await writeFile(join(root, NFD, "Notiz.md"), "body");
    await queue.queueDelete(`${NFC}/Notiz.md`);

    const collisions: NameCollision[] = [];
    await new SyncEngine(queue, target, vault).processQueue(undefined, undefined, { collisions });

    expect(pushed).toEqual([]);
    expect(collisions).toEqual([]);
    expect(await pending()).toEqual([]);
  });

  it("holds a DELETE whose file name exists here in other letter case", async () => {
    await mkdir(join(root, "Notes"));
    await writeFile(join(root, "Notes", "Idea.md"), "body");
    await queue.queueDelete("Notes/idea.md");

    const collisions: NameCollision[] = [];
    await new SyncEngine(queue, target, vault).processQueue(undefined, undefined, { collisions });

    expect(pushed).toEqual([]);
    expect(collisions).toEqual([{ path: "Notes/idea.md", twin: "Notes/Idea.md" }]);
  });

  it("pushes an ordinary DELETE, and the held one once the twin is renamed away", async () => {
    await mkdir(join(root, "Notes"));
    await writeFile(join(root, "Notes", "Idea.md"), "body");
    await queue.queueDelete("Notes/gone.md");
    await queue.queueDelete("Notes/idea.md");
    const engine = new SyncEngine(queue, target, vault);

    await engine.processQueue();
    expect(pushed).toEqual(["delete Notes/gone.md"]);
    expect(await pending()).toEqual(["delete Notes/idea.md #0"]);

    // "Rename one of the two and it is one name again" — the card's advice.
    await rename(join(root, "Notes", "Idea.md"), join(root, "Notes", "Idea (kept).md"));
    const collisions: NameCollision[] = [];
    await engine.processQueue(undefined, undefined, { collisions });
    expect(collisions).toEqual([]);
    expect(pushed).toEqual(["delete Notes/gone.md", "delete Notes/idea.md"]);
    expect(await pending()).toEqual([]);
  });

  it("pushes a DELETE whose folder is gone here altogether", async () => {
    await queue.queueDelete("Removed/deep/note.md");
    await new SyncEngine(queue, target, vault).processQueue();
    expect(pushed).toEqual(["delete Removed/deep/note.md"]);
  });

  it("fails closed when the local listing cannot be read", async () => {
    // "Could not look" must not be read as "no twin" in front of a DELETE.
    await queue.queueDelete("Notes/idea.md");
    const broken = Object.assign(Object.create(vault), {
      listDir: async () => { throw Object.assign(new Error("EACCES"), { name: "VaultPermissionError" }); },
    });
    await new SyncEngine(queue, target, broken).processQueue();
    expect(pushed).toEqual([]);
    expect(await pending()).toEqual(["delete Notes/idea.md #1"]);
  });

  it("reaches the collision card through the worker, next to the pull side's", async () => {
    await mkdir(join(root, "Notes"));
    await writeFile(join(root, "Notes", "Idea.md"), "body");
    await queue.queueDelete("Notes/idea.md");
    const engine = new SyncEngine(queue, target, vault);
    const stateRepo = {
      getAllStates: vi.fn().mockResolvedValue(new Map()),
      getSyncState: vi.fn().mockResolvedValue(null),
      deleteSyncState: vi.fn().mockResolvedValue(undefined),
    };
    const worker = new SyncWorker(engine, target, stateRepo as any, vault, queue, 60_000);
    worker["isRunning"] = true;
    const reported: (readonly NameCollision[])[] = [];
    worker.onNameCollisions = (c) => { reported.push(c); };

    await worker.runCycle();

    expect(pushed).toEqual([]);
    expect(reported.at(-1)).toEqual([{ path: "Notes/idea.md", twin: "Notes/Idea.md" }]);
    worker.stop();
  });

  describe("a folder the remote already holds in the other spelling is not created again", () => {
    // The #112 reporter's evidence: HiDrive over WebDAV, a folder made in
    // Finder (decomposed bytes), the server's copy composed. Every MKCOL of the
    // decomposed name became a second folder, which the HiDrive desktop app
    // syncing the same folder renamed to "Neutralität(1)", "(2)", …
    let created: string[];
    let repo: SyncStateRepository;
    beforeEach(async () => {
      created = [];
      target.createVaultFolder = async (p: string) => { created.push(p); };
      repo = new SyncStateRepository(db);
      await repo.updateRemoteState(`${NFC}/Notiz.md`, "etag-1", null, 1);
      await repo.updateRemoteState("Notes/Idea.md", "etag-2", null, 1);
    });

    it("creates a folder queued in the decomposed spelling under the composed identity (ADR 0016)", async () => {
      // O2 held this MKCOL. Since the identity is NFC it is the same folder:
      // it goes out under the identity, and the target writes into whatever
      // spelling the remote holds (spelling-resolution tests).
      await queue.queueMkdir(`${NFD}/Neu`);
      const collisions: NameCollision[] = [];
      await new SyncEngine(queue, target, vault, repo).processQueue(undefined, undefined, { collisions });

      expect(created).toEqual([`${NFC}/Neu`]);
      expect(collisions).toEqual([]);
      expect(await pending()).toEqual([]);
    });

    it("holds a folder that differs only in letter case", async () => {
      await queue.queueMkdir("notes");
      const collisions: NameCollision[] = [];
      await new SyncEngine(queue, target, vault, repo).processQueue(undefined, undefined, { collisions });
      expect(created).toEqual([]);
      expect(collisions).toEqual([{ path: "notes", twin: "Notes" }]);
    });

    it("creates a folder inside the known spelling, and a genuinely new one", async () => {
      await queue.queueMkdir(`${NFC}/Neu`);
      await queue.queueMkdir("Elsewhere/Deep");
      await new SyncEngine(queue, target, vault, repo).processQueue();
      expect(created).toEqual([`${NFC}/Neu`, "Elsewhere/Deep"]);
      expect(await pending()).toEqual([]);
    });

    it("ignores rows the remote never confirmed", async () => {
      // A local-only row (no remote etag) says nothing about the server.
      await repo.deleteSyncState("Notes/Idea.md");
      await repo.updateLocalHash("Notes/Idea.md", "sha");
      await queue.queueMkdir("notes");
      await new SyncEngine(queue, target, vault, repo).processQueue();
      expect(created).toEqual(["notes"]);
    });
  });
});
