import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { SyncWorker } from "../../src/sync/SyncWorker.js";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import type { SyncOperation, ISyncTarget } from "../../src/sync/ISyncTarget.js";

describe("durable rename replay with real SQLite and vault files", () => {
  let db: Awaited<ReturnType<typeof realSqlite>>;
  let root: string;
  let raw: LocalVaultAdapter;
  let vault: QueueingVaultAdapter;
  let queue: SyncQueue;
  let engine: SyncEngine;
  let remote: Map<string, string>;
  let target: ISyncTarget;
  let calls: string[];
  beforeEach(async () => {
    db = await realSqlite();
    root = await mkdtemp(join(tmpdir(), "plainva-rename-replay-"));
    raw = new LocalVaultAdapter(root);
    await raw.initialize();
    queue = new SyncQueue(db);
    vault = new QueueingVaultAdapter(raw, queue);
    remote = new Map();
    calls = [];
    target = {
      async push(op) {
        calls.push(`${op.operation} ${op.file_path}${op.new_path ? ` -> ${op.new_path}` : ""}`);
        if (op.operation === "write") remote.set(op.file_path, new TextDecoder().decode(op.content));
        if (op.operation === "delete") {
          for (const p of remote.keys()) if (p === op.file_path || p.startsWith(op.file_path + "/")) remote.delete(p);
        }
        if (op.operation === "rename") {
          const entries = [...remote].filter(([p]) => p === op.file_path || p.startsWith(op.file_path + "/"));
          if (!entries.length) return { renameSourceMissing: true };
          for (const [p, content] of entries) {
            remote.delete(p);
            remote.set(op.new_path! + p.slice(op.file_path.length), content);
          }
        }
      },
      async createFolder(path) { remote.set(path, "<directory>"); },
      async pull() { return { etagMap: new Map() }; },
      async download(path) { return new TextEncoder().encode(remote.get(path)); },
    };
    engine = new SyncEngine(queue, target, raw);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
    await rm(root, { recursive: true, force: true });
  });
  async function drain() {
    for (let i = 0; i < 20; i++) {
      if (!(await queue.getPendingOperations()).length) break;
      await engine.processQueue();
    }
    expect(await db.query("SELECT * FROM offline_queue")).toEqual([]);
  }
  async function seed(path = "a.md") {
    remote.set(path, "old remote");
    await raw.writeTextFile(path, "old remote");
  }

  it("moves the old remote content before uploading the offline edit", async () => {
    await seed();
    await vault.writeTextFile("a.md", "newest edit");
    await vault.renameItem("a.md", "b.md");
    await drain();
    expect([...remote]).toEqual([["b.md", "newest edit"]]);
    expect(calls).toEqual(["rename a.md -> b.md", "write b.md"]);
  });

  it.each([["b.md", "c.md"], ["b.md", "a.md"], ["b.md", "c.md", "a.md"]])("preserves a rename chain ending in %j", async (...paths) => {
    await seed();
    await vault.writeTextFile("a.md", "newest edit");
    let current = "a.md";
    for (const path of paths) {
      await vault.renameItem(current, path);
      current = path;
    }
    await drain();
    expect([...remote]).toEqual([[current, "newest edit"]]);
    expect(calls.slice(0, -1).every((c) => c.startsWith("rename "))).toBe(true);
  });

  it("keeps a recreated old name separate from the renamed document", async () => {
    await seed();
    await vault.writeTextFile("a.md", "moved edit");
    await vault.renameItem("a.md", "b.md");
    await vault.writeTextFile("a.md", "new document");
    await drain();
    expect(remote.get("b.md")).toBe("moved edit");
    expect(remote.get("a.md")).toBe("new document");
  });

  it("does not deadlock a write/delete at the old target before another document moves there", async () => {
    await seed();
    await seed("b.md");
    await vault.writeTextFile("b.md", "obsolete target edit");
    await vault.deleteItem("b.md");
    await vault.renameItem("a.md", "b.md");
    await drain();
    expect([...remote]).toEqual([["b.md", "old remote"]]);
  });

  it("replays child deletion and creation at their original locations before a folder MOVE", async () => {
    await seed("Old/a.md");
    await seed("Old/deleted.md");
    await vault.deleteItem("Old/deleted.md");
    await vault.createDir("Old/empty");
    await vault.writeTextFile("Old/a.md", "new edit");
    await vault.renameItem("Old", "New");
    await drain();
    expect(remote.get("New/a.md")).toBe("new edit");
    expect(remote.get("New/empty")).toBe("<directory>");
    expect([...remote.keys()].some((p) => p.startsWith("Old/") || p.endsWith("deleted.md"))).toBe(false);
  });

  it.each(["backoff", "manual"])("blocks descendants of a %s MOVE while unrelated uploads proceed", async (mode) => {
    await seed("Old/a.md");
    await vault.writeTextFile("Old/a.md", "new edit");
    await vault.renameItem("Old", "New");
    await vault.writeTextFile("other.md", "independent");
    const rename = await db.queryOne<SyncOperation>("SELECT * FROM offline_queue WHERE operation = 'rename'");
    if (mode === "manual") await queue.markRequiresManualIntervention(rename!.id, "permission");
    else await queue.incrementRetry(rename!.id, Date.now() + 60000, "offline");
    await engine.processQueue();
    expect(calls).toEqual(["write other.md"]);
    expect(remote.has("New/a.md")).toBe(false);
    await queue.resetStuckOperations();
    await drain();
    expect(remote.get("New/a.md")).toBe("new edit");
  });

  it("recovers writes retargeted in place by an earlier app version", async () => {
    await seed();
    await raw.renameItem("a.md", "b.md");
    await raw.writeTextFile("b.md", "legacy pending edit");
    await queue.queueWrite("b.md");
    await db.execute("INSERT INTO offline_queue (file_path, operation, new_path, queued_at) VALUES ('a.md', 'rename', 'b.md', 0)");
    await drain();
    expect([...remote]).toEqual([["b.md", "legacy pending edit"]]);
  });

  it("does not let completion of an in-flight old write retire its replacement", async () => {
    await seed();
    await vault.writeTextFile("a.md", "upload already started");
    const push = target.push.bind(target);
    let moved = false;
    vi.spyOn(target, "push").mockImplementation(async (op) => {
      if (!moved) {
        moved = true;
        await vault.renameItem("a.md", "b.md");
        await vault.writeTextFile("b.md", "typed during upload");
      }
      return push(op);
    });
    await engine.processQueue();
    expect(await db.query("SELECT * FROM offline_queue WHERE operation = 'write'")).toHaveLength(1);
    await drain();
    expect([...remote]).toEqual([["b.md", "typed during upload"]]);
  });

  it("preserves force and unresolved errors when replacing a write ID", async () => {
    await seed();
    await queue.queueWrite("a.md", { force: true });
    const [old] = await queue.getPendingOperations();
    await queue.markRequiresManualIntervention(old.id, "needs repair");
    await vault.renameItem("a.md", "b.md");
    await queue.markSynced(old.id, "a.md");
    const row = await db.queryOne<Record<string, unknown>>("SELECT * FROM offline_queue WHERE operation = 'write'");
    expect(row).toMatchObject({ file_path: "b.md", force: 1, last_error: "needs repair", requires_manual_intervention: 1 });
    expect(row!.id).not.toBe(old.id);
  });

  it.each(["Projects", "50%_done", "📚Projects"])("moves only the literal case-sensitive %s prefix and its merge bases", async (source) => {
    const paths = [`${source}/a.md`, `${source.toLowerCase()}/b.md`, `${source}more/c.md`, `${source.replace(/[%_]/g, "x")}-other/d.md`];
    for (const path of paths) {
      await db.execute("INSERT INTO files (id, path) VALUES (?, ?)", [path, path]);
      await db.execute("INSERT INTO sync_state (path, base_text) VALUES (?, ?)", [path, path]);
    }
    await queue.queueRename(source, "Moved");
    const expected = paths.map((p) => p.startsWith(source + "/") ? "Moved" + p.slice(source.length) : p).sort();
    expect((await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path).sort()).toEqual(expected);
    expect((await db.query<{ path: string }>("SELECT path FROM sync_state ORDER BY path")).map((r) => r.path).sort()).toEqual(expected);
  });

  it("does not recreate an old remote folder or prefetch its children during a pending MOVE", async () => {
    await seed("Old/a.md");
    await vault.renameItem("Old", "New");
    target.pull = async () => ({ folders: ["Old", "Old/empty"], etagMap: new Map([["Old/a.md", "remote"]]) });
    const download = vi.spyOn(target, "download");
    const worker = new SyncWorker(engine, target, new SyncStateRepository(db), raw, queue);
    worker["isRunning"] = true;
    await worker.runCycle();
    expect(await raw.exists("Old")).toBe(false);
    expect(download).not.toHaveBeenCalled();
    expect(await queue.hasPendingStructuralOp("Old2/a.md")).toBe(false);
  });

  it("treats WebDAV MOVE 404 as an upload, and keeps a failed upload queued", async () => {
    await seed();
    await vault.renameItem("a.md", "b.md");
    let fail = true;
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "MOVE") return new Response(null, { status: 404 });
      if (init?.method === "PUT") return new Response(null, { status: fail ? 503 : 201 });
      throw new Error("unexpected request");
    });
    const dav = new WebDavSyncTarget({ url: "https://example.test/dav", user: "u", pass: "p" }, fetch);
    engine = new SyncEngine(queue, dav, raw);
    await engine.processQueue();
    expect(await db.query("SELECT * FROM offline_queue")).toHaveLength(1);
    fail = false;
    await queue.resetStuckOperations();
    await drain();
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["MOVE", "PUT", "MOVE", "PUT"]);
  });

  it("recovers a missing remote folder with durable child uploads, including unchanged content", async () => {
    await raw.writeTextFile("Old/a.md", "unchanged");
    await raw.createDir("Old/empty");
    await vault.renameItem("Old", "New");
    const sha = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("unchanged"))).toString("hex");
    await db.execute("INSERT INTO sync_state (path, base_sha256, remote_etag) VALUES ('New/a.md', ?, 'old-etag')", [sha]);
    engine = new SyncEngine(queue, target, raw, new SyncStateRepository(db));
    await engine.processQueue();
    expect(await db.query("SELECT * FROM offline_queue WHERE operation = 'write'")).toHaveLength(1);
    // A new engine instance represents resuming after the fallback was queued.
    engine = new SyncEngine(queue, target, raw, new SyncStateRepository(db));
    await drain();
    expect(remote.get("New/a.md")).toBe("unchanged");
    expect(remote.get("New/empty")).toBe("<directory>");
  });

  it("retains a missing folder MOVE if its local recovery listing is incomplete", async () => {
    await raw.writeTextFile("Old/a.md", "keep");
    await vault.renameItem("Old", "New");
    Object.assign(raw, { listDirReport: vi.fn().mockResolvedValue({ files: [], skipped: [{ path: "New/a.md", reason: "unreadable" }] }) });
    await engine.processQueue();
    expect(await db.query("SELECT * FROM offline_queue")).toHaveLength(1);
    expect(remote.size).toBe(0);
  });
});
