import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import { byteExactDav, type ByteExactDav, type ByteExactDavOptions } from "../helpers/byteExactDav.js";
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

/**
 * Between this device's pull and its push (Sammelplan § 3.103, § 3.102 no. 5).
 *
 * A cycle pulls first and pushes after: it downloads what changed on the
 * server, merges it with what changed here, and uploads the result. That order
 * is no comparison at the moment of writing. Another device that uploads in
 * between — while this one merges, or while its queue works through a large
 * first sync — had its version overwritten by this device's upload: the other
 * device then found a new version on the server, saw its own file unchanged
 * since its upload, and took the new one over. Its change was gone on the
 * server and on both devices, without a conflict copy. A file this device
 * uploads for the first time (or again, after the cloud deleted it,
 * § 3.115 no. 2) had no protection at all.
 *
 * Now every upload names the version it expects on the server — the one of
 * its merge base, or "no file" — and the server writes only if it still holds
 * that; otherwise the upload waits for the next reconcile.
 *
 * And a note whose conflict is open (§ 3.102 no. 5): the text of the note
 * itself, not uploaded yet, was lost when another device contradicted the same
 * line — the worker kept no copy because a conflict copy already existed.
 *
 * The real core throughout: adapter chain, indexer, queue, engine, worker and
 * the WebDAV target, real SQLite and real folders, against a byte-exact
 * in-memory server that evaluates preconditions as a real one does. The
 * assertions read the files on both disks and on the server.
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

async function device(dav: ByteExactDav) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-upload-window-"));
  const db = await realSqlite();
  closers.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
  let queued: Promise<unknown> = Promise.resolve();
  const later = (work: () => Promise<unknown>) => { queued = queued.then(work); };
  const indexer = new VaultIndexer(raw, db, {
    isOwnWrite: (p, sha256) => app.wasWrittenByUs(p, sha256),
    onExternalModification: (p) => later(() => queue.queueWrite(p)),
    onNewLocalFile: (p) => later(() => queue.queueWrite(p)),
    onLocalFileDeleted: (p) => later(() => queue.queueDelete(p)),
  });
  // This device's line to the server: something can happen at the very moment its next upload goes out.
  // Or at the moment it asks for one file's metadata (a PROPFIND of depth 0).
  const uplink: { beforeUpload: null | (() => Promise<void>); beforeAsking: null | (() => Promise<void>) } = { beforeUpload: null, beforeAsking: null };
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const depth = new Headers(init?.headers as HeadersInit | undefined).get("Depth");
    const slot = method === "PUT" ? "beforeUpload" : method === "PROPFIND" && depth === "0" ? "beforeAsking" : null;
    if (slot) {
      const hook = uplink[slot];
      uplink[slot] = null;
      if (hook) await hook();
    }
    return dav.fetch(input, init);
  });
  target.allowRootCreation = false;
  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000);
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  const pulled: string[] = [];
  worker.onFilesChanged = (paths) => void pulled.push(...paths);
  const file = (p: string) => path.join(root, p);
  return {
    app, repo, queue, uplink, db,
    async cycle() {
      await indexer.indexVaultFull();
      await queued;
      await worker.runCycle();
      for (const p of pulled.splice(0)) await indexer.indexPath(p);
      await queued;
    },
    /** Another program writes the file: exactly these bytes, past the app. */
    async put(p: string, text: string) {
      await fs.mkdir(path.dirname(file(p)), { recursive: true });
      await fs.writeFile(file(p), text, "utf8");
    },
    async text(p: string) { return fs.readFile(file(p), "utf8"); },
    async files() { return (await fs.readdir(root)).filter((name) => !name.startsWith(".")).sort(); },
    async copies() { return (await fs.readdir(root)).filter((name) => name.includes(".CONFLICT")).sort(); },
    /** Every visible file (not under .plainva) whose text contains `needle`. */
    async holding(needle: string) {
      const hits: string[] = [];
      for (const full of await walk(root)) {
        const rel = path.relative(root, full).replace(/\\/g, "/");
        if (rel.startsWith(".")) continue;
        if ((await fs.readFile(full, "utf8")).includes(needle)) hits.push(rel);
      }
      return hits.sort();
    },
  };
}

function world(options?: ByteExactDavOptions) {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const dav = byteExactDav(undefined, options);
  const remote = (p: string) => new TextDecoder().decode(dav.files.get(p)!.bytes);
  return { dav, remote };
}

const START = "# Plan\n\none\ntwo\nthree\nfour\nfive\nsix\nseven\n";

describe("another device uploads between this device's pull and its push", () => {
  async function overwriteWindow(options?: ByteExactDavOptions) {
    const { dav, remote } = world(options);
    const a = await device(dav), b = await device(dav);
    await a.put("Note.md", START);
    await a.cycle();
    await b.cycle();

    // B changes line 1, A line 5 and uploads; B pulls, merges — and at the very
    // moment B uploads its merge, A uploads a change of line 3.
    const here = START.replace("one", "one here");
    const there = START.replace("five", "five there");
    const thereAgain = there.replace("three", "three there");
    await b.app.writeTextFile("Note.md", here);
    await a.put("Note.md", there);
    await a.cycle();
    b.uplink.beforeUpload = async () => { await a.put("Note.md", thereAgain); await a.cycle(); };
    await b.cycle();
    await a.cycle();
    await b.cycle();
    await a.cycle();
    return { a, b, remote, all: thereAgain.replace("one", "one here") };
  }

  it("keeps all three changes on both devices and on the server, without a conflict copy", async () => {
    const { a, b, remote, all } = await overwriteWindow();
    expect(remote("Note.md")).toBe(all);
    expect(await a.text("Note.md")).toBe(all);
    expect(await b.text("Note.md")).toBe(all);
    expect(await a.copies()).toEqual([]);
    expect(await b.copies()).toEqual([]);
  });

  it("uploads as before to a server that evaluates no precondition", async () => {
    // Such a server never refuses, so nothing protects the window there (as
    // before this change); what has to hold is that every upload still goes through.
    const { dav, remote } = world({ conditions: "ignore" });
    const a = await device(dav), b = await device(dav);
    await a.put("Note.md", START);
    await a.cycle();
    await b.cycle();
    await b.app.writeTextFile("Note.md", START.replace("one", "one here"));
    await b.cycle();
    await a.cycle();
    expect(remote("Note.md")).toBe(START.replace("one", "one here"));
    expect(await a.text("Note.md")).toBe(START.replace("one", "one here"));
    expect(await b.queue.getPendingOperations()).toEqual([]);
  });

  it("asks right before the upload where the entity tags are weak, which an If-Match never matches", async () => {
    const { dav, remote } = world({ weakEtags: true });
    const a = await device(dav), b = await device(dav);
    await a.put("Note.md", START);
    await a.cycle();
    await b.cycle();
    const here = START.replace("one", "one here");
    const there = START.replace("five", "five there");
    const thereAgain = there.replace("three", "three there");
    await b.app.writeTextFile("Note.md", here);
    await a.put("Note.md", there);
    await a.cycle();
    // A uploads after B's pull, before B's question: the question sees it.
    b.uplink.beforeAsking = async () => { await a.put("Note.md", thereAgain); await a.cycle(); };
    await b.cycle();
    await b.cycle();
    await a.cycle();
    const all = thereAgain.replace("one", "one here");
    expect(remote("Note.md")).toBe(all);
    expect(await a.text("Note.md")).toBe(all);
    expect(await b.text("Note.md")).toBe(all);
    expect(await b.queue.getPendingOperations()).toEqual([]);
  });
  it("reconciles a refused file in the next cycle even where the listing shows the marker its row already has", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await a.put("Note.md", START);
    await a.cycle();
    await b.cycle();
    await a.put("Note.md", START.replace("five", "five there"));
    await a.cycle();
    // B's row already names the listing's marker (a listing that lagged, a
    // service whose answers disagree): its pull alone would not look again.
    const listed = dav.files.get("Note.md")!.etag;
    await b.repo.updateRemoteState("Note.md", listed, null, Date.now());
    await b.app.writeTextFile("Note.md", START.replace("one", "one here"));
    await b.cycle(); // the upload is refused: B's base is the older version
    await b.cycle(); // reconciled although the marker did not move, then uploaded
    await a.cycle();
    const all = START.replace("one", "one here").replace("five", "five there");
    expect(remote("Note.md")).toBe(all);
    expect(await a.text("Note.md")).toBe(all);
    expect(await b.text("Note.md")).toBe(all);
  });

  it("hands an upload that keeps being refused to a person after five cycles, and keeps the text", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await a.put("Note.md", START);
    await a.cycle();
    await b.cycle();
    // A server that refuses every conditional upload of B's and, asked, finds no file:
    // to B the remote always moved, and no reconcile settles it.
    const refusing = dav.fetch;
    dav.fetch = async (input, init) => {
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT" && headers.has("If-Match")) return new Response("", { status: 412 });
      if (method === "PROPFIND" && headers.get("Depth") === "0") return new Response("", { status: 404 });
      return refusing(input, init);
    };
    const manual = async () => (await b.db.query<{ requires_manual_intervention: number | null }>(
      "SELECT requires_manual_intervention FROM offline_queue WHERE file_path = ?", ["Note.md"])).map((r) => r.requires_manual_intervention ?? 0);
    await b.app.writeTextFile("Note.md", START.replace("one", "one here"));
    for (let i = 0; i < 4; i++) await b.cycle();
    expect(await manual()).toEqual([0]);
    await b.cycle();
    expect(await manual()).toEqual([1]);
    // And it stays there: the sync's own reconcile does not lift it again.
    await b.cycle();
    await b.cycle();
    expect(await manual()).toEqual([1]);
    expect(remote("Note.md")).toBe(START);
    expect(await b.text("Note.md")).toBe(START.replace("one", "one here"));

    // The server answers as it should again, and the next write of the file
    // supersedes the one that needed a person: it goes up.
    dav.fetch = refusing;
    await b.app.writeTextFile("Note.md", START.replace("one", "one here").replace("two", "two here"));
    await b.cycle();
    expect(remote("Note.md")).toBe(START.replace("one", "one here").replace("two", "two here"));
    expect(await manual()).toEqual([]);
  });
});

describe("another device creates the same file between this device's pull and its first upload", () => {
  it("keeps both versions — the other device's in the file, this one's as a conflict copy", async () => {
    const { dav, remote } = world();
    const a = await device(dav), b = await device(dav);
    await a.cycle();
    await b.cycle();
    // A file only B has, never uploaded (and so without a merge base): a new
    // note, or one kept although the cloud deleted it (§ 3.115 no. 2).
    await b.put("New.md", "# New\n\nwritten on B\n");
    b.uplink.beforeUpload = async () => { await a.put("New.md", "# New\n\nwritten on A\n"); await a.cycle(); };
    await b.cycle();
    await b.cycle();
    await a.cycle();

    expect(remote("New.md")).toBe("# New\n\nwritten on A\n");
    expect(await a.text("New.md")).toBe("# New\n\nwritten on A\n");
    expect(await b.holding("written on A")).toContain("New.md");
    const keptOnB = await b.holding("written on B");
    expect(keptOnB.length).toBe(1);
    expect(keptOnB[0]).toMatch(/^New\.CONFLICT-.*\.md$/);
  });
});

describe("a note whose conflict is open, and another device that contradicts its own text (§ 3.102 no. 5)", () => {
  it("keeps the note's text that was not uploaded yet in a file beside it", async () => {
    const { dav } = world();
    const a = await device(dav), b = await device(dav);
    await a.put("Note.md", START);
    await a.cycle();
    await b.cycle();

    // Another program, then the app outside an editor: merged by the write chain.
    const outside = START.replace("one", "one outside");
    await b.put("Note.md", outside);
    await b.app.writeTextFile("Note.md", outside.replace("four", "four here"));
    const merged = await b.text("Note.md");
    // The other program again; then a writer that still holds the merged text:
    // a conflict opens, the note keeps what the other program wrote.
    await b.put("Note.md", merged.replace("six", "six OUTSIDE-TWICE"));
    await b.app.writeTextFile("Note.md", merged.replace("two", "two here")).catch(() => undefined);
    expect(await b.copies()).toHaveLength(1);
    expect(await b.holding("OUTSIDE-TWICE")).toEqual(["Note.md"]);

    // Before B has uploaded: the other device changes the same line and uploads.
    await a.put("Note.md", START.replace("six", "six there"));
    await a.cycle();
    await b.cycle();

    expect(await b.text("Note.md")).toContain("six there");
    const kept = await b.holding("OUTSIDE-TWICE");
    expect(kept.length).toBe(1);
    expect(kept[0]).toMatch(/^Note\.CONFLICT-.*\.md$/);
  });
});
