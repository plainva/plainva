import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import { byteExactDav, type ByteExactDav } from "../helpers/byteExactDav.js";
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
 * A file's shape — its line ends and its byte order mark — on its way between
 * two devices.
 *
 * A sync moves bytes, and where both devices changed a file it merges their
 * lines. Neither is an edit of the file's shape: a note that lies there with
 * `\r\n` (a vault that came from Windows, kept in Git without `autocrlf`) and
 * an `.ini` or a `.csv` with the mark Excel wants arrive on the other device
 * as they left, and a merge changes the lines that were changed.
 *
 * Everything here is the real core — the adapter chain the shells build, the
 * indexer with the shell's sync hooks, queue, engine, worker, the real WebDAV
 * target, real SQLite and real folders on disk — against a byte-exact
 * in-memory WebDAV server. The assertions read BYTES, on both disks and on
 * the server.
 */

// Built at run time: the mark is never typed into this file.
const MARK = String.fromCharCode(0xfeff);
const MARK_BYTES = [0xef, 0xbb, 0xbf];

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

async function device(dav: ByteExactDav) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-shape-sync-"));
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
  // The shells' hooks queue without waiting; here one after the other, so that
  // two files found in one pass do not open two transactions on the one
  // connection this test database has.
  let queued: Promise<unknown> = Promise.resolve();
  const later = (work: () => Promise<unknown>) => { queued = queued.then(work); };
  const indexer = new VaultIndexer(raw, db, {
    onExternalModification: (p) => later(() => queue.queueWrite(p)),
    onNewLocalFile: (p) => later(() => queue.queueWrite(p)),
    onLocalFileDeleted: (p) => later(() => queue.queueDelete(p)),
  });
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch);
  target.allowRootCreation = false;
  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000);
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  // Both shells index what a cycle wrote before anything else looks at it;
  // an index that never saw a pulled file would take its next change for a
  // new file.
  const pulled: string[] = [];
  worker.onFilesChanged = (paths) => void pulled.push(...paths);
  const file = (p: string) => path.join(root, p);
  return {
    root, app, repo, db, indexer,
    /** When the file was last written: a file the sync left alone keeps its time. */
    async written(p: string) { return (await fs.stat(file(p))).mtimeMs; },
    /** What the shell does: the watcher's pass, then a sync cycle. */
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
    async bytes(p: string) { return [...await fs.readFile(file(p))]; },
    async text(p: string) { return fs.readFile(file(p), "utf8"); },
    async files() { return (await fs.readdir(root)).filter((name) => !name.startsWith(".")).sort(); },
  };
}

function world() {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const dav = byteExactDav();
  const remote = (p: string) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(dav.files.get(p)!.bytes);
  return {
    dav, remote, remoteBytes: (p: string) => [...dav.files.get(p)!.bytes],
    /** How often the file was uploaded so far. */
    uploads: (p: string) => dav.log.filter((line) => line === `PUT ${p}`).length,
    /** Another device changed the file: these bytes, a new ETag. */
    serve(p: string, text: string) { dav.files.set(p, { bytes: new TextEncoder().encode(text), etag: `served-${dav.log.length}-${dav.files.size}-${text.length}` }); },
  };
}

/** Two devices that both hold the file, in sync. */
async function synced(p: string, content: string) {
  const w = world();
  const a = await device(w.dav), b = await device(w.dav);
  await a.put(p, content);
  await a.cycle();
  await b.cycle();
  return { ...w, a, b };
}

const utf8 = (text: string) => [...new TextEncoder().encode(text)];

describe("a file travels between two devices as it is", () => {
  it("a note with \\r\\n and a byte order mark arrives byte for byte", async () => {
    const note = `${MARK}# Title\r\n\r\none\r\ntwo\r\n`;
    const { a, b, remoteBytes, uploads } = await synced("Note.md", note);
    expect(remoteBytes("Note.md").slice(0, 3)).toEqual(MARK_BYTES);
    expect(remoteBytes("Note.md")).toEqual(await a.bytes("Note.md"));
    // The second device holds the same bytes: the mark and every "\r\n".
    expect(await b.bytes("Note.md")).toEqual(await a.bytes("Note.md"));
    expect(await b.bytes("Note.md")).toEqual([...MARK_BYTES, ...utf8("# Title\r\n\r\none\r\ntwo\r\n")]);
    // …and it stays that way: one upload, the first; nothing is pushed back,
    // and neither device writes its file again.
    expect(uploads("Note.md")).toBe(1);
    const writtenA = await a.written("Note.md"), writtenB = await b.written("Note.md");
    await b.cycle(); await a.cycle(); await b.cycle();
    expect(uploads("Note.md")).toBe(1);
    expect(await a.written("Note.md")).toBe(writtenA);
    expect(await b.written("Note.md")).toBe(writtenB);
    expect(await b.bytes("Note.md")).toEqual(await a.bytes("Note.md"));
    expect(remoteBytes("Note.md")).toEqual(await a.bytes("Note.md"));
    expect(await a.files()).toEqual(["Note.md"]);
    expect(await b.files()).toEqual(["Note.md"]);
  });

  it("a foreign text file with a mark arrives byte for byte, and a later change on the first device follows it", async () => {
    const csv = `${MARK}id;name\r\n1;Ada\r\n`;
    const { a, b } = await synced("Data.csv", csv);
    expect(await b.bytes("Data.csv")).toEqual([...MARK_BYTES, ...utf8("id;name\r\n1;Ada\r\n")]);
    await a.put("Data.csv", `${MARK}id;name\r\n1;Ada\r\n2;Grace\r\n`);
    await a.cycle();
    await b.cycle();
    expect(await b.bytes("Data.csv")).toEqual([...MARK_BYTES, ...utf8("id;name\r\n1;Ada\r\n2;Grace\r\n")]);
    expect(await b.files()).toEqual(["Data.csv"]);
  });
});

describe("a merge during a sync changes the lines that were changed", () => {
  for (const [name, mark] of [["Note.md", ""], ["Marked.md", MARK], ["Settings.ini", MARK]] as const) {
    it(`${name}: both devices changed it — it comes back with its line ends${mark ? " and its mark" : ""} on both`, async () => {
      const { a, b, remote } = await synced(name, `${mark}one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n`);
      await a.put(name, `${mark}one here\r\ntwo\r\nthree\r\nfour\r\nfive\r\n`);
      await b.put(name, `${mark}one\r\ntwo\r\nthree\r\nfour\r\nfive there\r\n`);
      await a.cycle();
      await b.cycle();
      const merged = `${mark}one here\r\ntwo\r\nthree\r\nfour\r\nfive there\r\n`;
      expect(await b.text(name)).toBe(merged);
      expect(remote(name)).toBe(merged);
      await a.cycle();
      expect(await a.text(name)).toBe(merged);
      // No conflict copy on either side.
      expect(await a.files()).toEqual([name]);
      expect(await b.files()).toEqual([name]);
    });
  }

  for (const [what, changed] of [
    ["a file whose line ends are uniform", "one\r\ntwo changed\r\nthree\r\n"],
    // What another program left behind: a line of the other kind among the rest.
    ["a file with a stray line end", "one\r\ntwo changed\r\nthree\r\nfour\nfive\r\n"],
  ] as const) {
    it(`a local change is uploaded as it lies there, not rewritten, when the server only hands out a new ETag — ${what}`, async () => {
      const { a, b, dav, remote } = await synced("Note.md", "one\r\ntwo\r\nthree\r\n");
      await b.put("Note.md", changed);
      const written = await b.written("Note.md");
      // The server re-stamps the unchanged file (a re-upload of the same bytes, a server-side touch).
      const current = dav.files.get("Note.md")!;
      dav.files.set("Note.md", { bytes: current.bytes, etag: "restamped" });
      await b.cycle();
      // The merge has nothing to take from the server: this device's file is
      // the result, and it is not written again — it used to come back with
      // "\n" throughout, and a stray line end would still have been turned.
      expect(await b.text("Note.md")).toBe(changed);
      expect(await b.written("Note.md")).toBe(written);
      expect(remote("Note.md")).toBe(changed);
      await a.cycle();
      expect(await a.text("Note.md")).toBe(changed);
    });
  }

  it("a device that turned the line ends keeps them turned when the other device's change merges in", async () => {
    const { a, b, remote } = await synced("Note.md", "one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n");
    // This device converted the note to "\n" (a tool, an editor setting) and changed nothing else.
    await b.put("Note.md", "one\ntwo\nthree\nfour\nfive\n");
    await a.put("Note.md", "one here\r\ntwo\r\nthree\r\nfour\r\nfive\r\n");
    await a.cycle();
    await b.cycle();
    expect(await b.text("Note.md")).toBe("one here\ntwo\nthree\nfour\nfive\n");
    expect(remote("Note.md")).toBe("one here\ntwo\nthree\nfour\nfive\n");
    await a.cycle();
    expect(await a.text("Note.md")).toBe("one here\ntwo\nthree\nfour\nfive\n");
  });

  it("line ends turned on the OTHER device arrive with its change, and a local change merges into them", async () => {
    const { a, b, remote } = await synced("Note.md", "one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n");
    // The other device converted the note to "\n" and changed the first line.
    await a.put("Note.md", "one here\ntwo\nthree\nfour\nfive\n");
    await b.put("Note.md", "one\r\ntwo\r\nthree\r\nfour\r\nfive there\r\n");
    await a.cycle();
    await b.cycle();
    // Undoing the conversion here would send it back to the device that made it.
    expect(await b.text("Note.md")).toBe("one here\ntwo\nthree\nfour\nfive there\n");
    expect(remote("Note.md")).toBe("one here\ntwo\nthree\nfour\nfive there\n");
    await a.cycle();
    expect(await a.text("Note.md")).toBe("one here\ntwo\nthree\nfour\nfive there\n");
  });
});

describe("a device that joins a sync with the same files in another shape", () => {
  it("takes the line ends and the mark the others hold, and uploads nothing", async () => {
    const w = world();
    const first = await device(w.dav);
    await first.put("Note.md", "# Title\n\none\ntwo\n");
    await first.put("Data.csv", `${MARK}id;name\n1;Ada\n`);
    await first.cycle();
    expect(w.uploads("Note.md")).toBe(1);
    expect(w.uploads("Data.csv")).toBe(1);
    const written = await first.written("Note.md");

    // The same vault on a second machine — from a checkout that turned the
    // line ends, and with a table saved without its mark. It connects to the
    // sync for the first time: there is no common ancestor to ask.
    const joiner = await device(w.dav);
    await joiner.put("Note.md", "# Title\r\n\r\none\r\ntwo\r\n");
    await joiner.put("Data.csv", "id;name\r\n1;Ada\r\n");
    await joiner.cycle();
    await joiner.cycle();

    // Nobody changed a line. The joiner takes over what is already out there…
    expect(await joiner.text("Note.md")).toBe("# Title\n\none\ntwo\n");
    expect(await joiner.text("Data.csv")).toBe(`${MARK}id;name\n1;Ada\n`);
    // …and uploads nothing. With "this device decides" it would have pushed
    // its line ends for every file, and the first device — and every other
    // one — would have had all of them rewritten by its next pull.
    expect(w.uploads("Note.md")).toBe(1);
    expect(w.uploads("Data.csv")).toBe(1);
    await first.cycle();
    expect(await first.written("Note.md")).toBe(written);
    expect(await first.text("Note.md")).toBe("# Title\n\none\ntwo\n");
    // No conflict copy on either side: nothing was in conflict.
    expect(await joiner.files()).toEqual(["Data.csv", "Note.md"]);
    expect(await first.files()).toEqual(["Data.csv", "Note.md"]);
  });
});

describe("what an older version left behind for a file with a mark", () => {
  const body = "one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n";
  const sha = async (text: string) => {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };

  it("on the device that uploaded it — a merge base without the mark — nothing moves, and a change from elsewhere merges in", async () => {
    const w = world();
    const a = await device(w.dav);
    await a.put("Note.md", MARK + body);
    await a.cycle();
    // Until 2026-10-09 the base text of an upload was decoded without its mark, the hashes with it.
    await a.db.execute("UPDATE sync_state SET base_text = ? WHERE path = ?", [body, "Note.md"]);
    const written = await a.written("Note.md");
    await a.cycle();
    await a.cycle();
    expect(w.uploads("Note.md")).toBe(1);
    expect(await a.written("Note.md")).toBe(written);

    // Another device changes the last line, this one the first.
    w.serve("Note.md", MARK + body.replace("five", "five there"));
    await a.put("Note.md", MARK + body.replace("one", "one here"));
    await a.cycle();
    const merged = MARK + body.replace("one", "one here").replace("five", "five there");
    expect(await a.text("Note.md")).toBe(merged);
    expect(w.remote("Note.md")).toBe(merged);
    expect(await a.files()).toEqual(["Note.md"]);
  });

  it("on a device that pulled it — the file lies there without its mark — nothing moves, and the next change from elsewhere brings the mark", async () => {
    const w = world();
    const a = await device(w.dav);
    await a.put("Note.md", MARK + body);
    await a.cycle();
    const b = await device(w.dav);
    await b.cycle();
    // Until 2026-10-09 a pull wrote the file without its mark and recorded that text.
    await b.put("Note.md", body);
    await b.db.execute("UPDATE sync_state SET local_sha256 = ?, base_sha256 = ?, base_text = ? WHERE path = ?", [await sha(body), await sha(body), body, "Note.md"]);
    await b.indexer.indexVaultFull();
    await b.db.execute("DELETE FROM offline_queue");
    const written = await b.written("Note.md");
    await b.cycle();
    await b.cycle();
    // The file stays as that version left it, and it is not uploaded over the one with the mark.
    expect(w.uploads("Note.md")).toBe(1);
    expect(await b.written("Note.md")).toBe(written);
    expect(await b.text("Note.md")).toBe(body);

    // The first device changes the note: the change arrives here, mark and all.
    await a.put("Note.md", MARK + body.replace("one", "one here"));
    await a.cycle();
    await b.cycle();
    expect(await b.text("Note.md")).toBe(MARK + body.replace("one", "one here"));
    expect(w.uploads("Note.md")).toBe(2);
    expect(await b.files()).toEqual(["Note.md"]);
  });
});
