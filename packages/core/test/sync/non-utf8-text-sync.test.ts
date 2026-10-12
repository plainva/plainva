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
import { OwnDeletionRegister } from "../../src/sync/ownDeletions.js";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import { flagLossyTextBases } from "../../src/db/lossyTextBaseMigration.js";
import { initializeSchema } from "../../src/db/Schema.js";

/**
 * A text file whose content is not UTF-8, on its way between two devices.
 *
 * A `.csv` that Excel saved in Windows-1252, a `.txt` a Windows tool wrote in
 * UTF-16, a note from an old program: text by its name, and by its bytes
 * something a UTF-8 decoder can only replace. The sync used to decode such a
 * file all the same and write the decoded TEXT on the device that pulled it —
 * `Grün`, `47 72 FC 6E`, arrived as `47 72 EF BF BD 6E` (finding 2026-10-09).
 *
 * The rule now: a file is text when its name says so AND its bytes are UTF-8
 * (`mergeableText`). Anything else travels byte for byte, like an image — no
 * merge, and a conflict copy where both sides changed it.
 *
 * Everything here is the real core — the adapter chain the shells build, the
 * indexer with the shells' sync hooks, queue, engine, worker, the real WebDAV
 * target, real SQLite and real folders on disk — against a byte-exact
 * in-memory WebDAV server. The assertions read BYTES, on both disks and on the
 * server.
 *
 * Every case runs with the two kinds of text reader the platforms have: one
 * that replaces what is not UTF-8 (Node, Android, the phone's folder adapter)
 * and one that refuses the file (Rust on the desktop, iOS). The core must not
 * depend on which one it is given.
 */

type Reader = "replaces" | "refuses";

/** The desktop's reader: Rust's `read_to_string` gives no text for bytes that are not UTF-8. */
class RefusingVaultAdapter extends LocalVaultAdapter {
  override async readTextFile(vaultPath: string): Promise<string> {
    const bytes = await this.readBinaryFile(vaultPath);
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error("cannot read text file: stream did not contain valid UTF-8");
    }
  }
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

const localOnly = (p: string) => p.includes(".plainva") || p.includes(".CONFLICT");

async function device(dav: ByteExactDav, reader: Reader) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-non-utf8-"));
  const db = await realSqlite();
  closers.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const raw = reader === "refuses" ? new RefusingVaultAdapter(root) : new LocalVaultAdapter(root);
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
  const ownDeletions = new OwnDeletionRegister();
  const events: string[] = [];
  // Both shells index through the app's adapter chain and keep device-local
  // files (conflict copies, `.plainva`) out of the queue.
  const indexer = new VaultIndexer(app, db, {
    isOwnWrite: (p, sha) => app.wasWrittenByUs(p, sha),
    onExternalModification: (p) => { events.push(`changed ${p}`); if (!localOnly(p)) later(() => queue.queueWrite(p)); },
    onNewLocalFile: (p) => { events.push(`new ${p}`); if (!localOnly(p)) later(() => queue.queueWrite(p)); },
    onLocalFileDeleted: (p) => { if (!ownDeletions.consume(p) && !localOnly(p)) later(() => queue.queueDelete(p)); },
  });
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch);
  target.allowRootCreation = false;
  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000, { ownDeletions });
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  const status: string[] = [];
  worker.onStatusChange = (state, message) => { if (state !== "syncing" && state !== "idle") status.push(`${state}: ${message ?? ""}`); };
  // Both shells index what a cycle wrote before anything else looks at it.
  const pulled: string[] = [];
  worker.onFilesChanged = (paths) => void pulled.push(...paths);
  // What a cycle says about files the remote no longer lists: how many it
  // removed here, and which it kept. A file that MOVED is in neither.
  const removals: Array<{ mirrored: number; kept: string[] }> = [];
  worker.onDeletionReport = (report) => void removals.push({ mirrored: report.mirrored, kept: [...report.keptLocalEdits] });
  const file = (p: string) => path.join(root, p);
  return {
    root, app, repo, db, indexer, queue, events,
    /** The adapter the sync itself writes through (below the app's chain). */
    syncFiles: backup,
    /** Deletions mirrored and files kept since the last look. */
    removals: () => removals.splice(0),
    /** Sync errors raised since the last look: none, in everything below. */
    problems: () => status.splice(0),
    /** When the file was last written: a file the sync left alone keeps its time. */
    async written(p: string) { return (await fs.stat(file(p))).mtimeMs; },
    /** The watcher's pass alone, with everything it queued. */
    async index() {
      await indexer.indexVaultFull();
      await queued;
    },
    /** What the shell does: the watcher's pass, then a sync cycle. */
    async cycle() {
      await indexer.indexVaultFull();
      await queued;
      await worker.runCycle();
      for (const p of pulled.splice(0)) await indexer.indexPath(p);
      await queued;
    },
    /** Another program writes the file: exactly these bytes, past the app. */
    async put(p: string, bytes: number[]) {
      await fs.mkdir(path.dirname(file(p)), { recursive: true });
      await fs.writeFile(file(p), new Uint8Array(bytes));
    },
    async bytes(p: string) { return [...await fs.readFile(file(p))]; },
    async files() { return (await fs.readdir(root)).filter((name) => !name.startsWith(".")).sort(); },
    /** The versions of a file in the root of the vault that the history holds, oldest first. */
    async snapshots(p: string) {
      const names = (await fs.readdir(path.join(root, ".plainva", "backups")).catch(() => [] as string[]))
        .filter((name) => name.startsWith(`${p}.`) && name.endsWith(".bak")).sort();
      return Promise.all(names.map(async (name) => [...await fs.readFile(path.join(root, ".plainva", "backups", name))]));
    },
    async row(p: string) {
      return db.queryOne<{ local_sha256: string | null; base_sha256: string | null; base_text: string | null; remote_etag: string | null; recheck: number | null }>(
        "SELECT local_sha256, base_sha256, base_text, remote_etag, recheck FROM sync_state WHERE path = ?", [p]);
    },
    /** A push that was put off waits a few seconds; the test does not. */
    async retryNow() { await db.execute("UPDATE offline_queue SET next_retry_at = 0"); },
    async waiting() {
      return (await db.query<{ file_path: string; operation: string }>("SELECT file_path, operation FROM offline_queue ORDER BY id"))
        .map((op) => `${op.operation} ${op.file_path}`);
    },
    async indexed(p: string) {
      return db.queryOne<{ sha256: string; mode: string }>("SELECT sha256, mode FROM files WHERE path = ?", [p]);
    },
  };
}

function world() {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const dav = byteExactDav();
  return {
    dav,
    remoteBytes: (p: string) => [...dav.files.get(p)!.bytes],
    remoteFiles: () => [...dav.files.keys()].sort(),
    /** How often the file was uploaded so far. */
    uploads: (p: string) => dav.log.filter((line) => line === `PUT ${p}`).length,
    /** Another device changed the file: these bytes, a new ETag. */
    serve(p: string, bytes: number[]) { dav.files.set(p, { bytes: new Uint8Array(bytes), etag: `served-${dav.log.length}-${dav.files.size}-${bytes.length}` }); },
  };
}

/** Two devices that both hold the file, in sync. */
async function synced(reader: Reader, p: string, content: number[]) {
  const w = world();
  const a = await device(w.dav, reader), b = await device(w.dav, reader);
  await a.put(p, content);
  await a.cycle();
  await b.cycle();
  return { ...w, a, b };
}

const sha256 = async (bytes: number[]) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};
const utf8 = (text: string) => [...new TextEncoder().encode(text)];
/** Windows-1252, for the characters used here (they sit where Latin-1 has them). */
const windows1252 = (text: string) => [...text].map((char) => char.charCodeAt(0));
/** UTF-16 little endian with its byte order mark — what Windows tools call "Unicode". */
const utf16 = (text: string) => [0xff, 0xfe, ...[...text].flatMap((char) => [char.charCodeAt(0) & 0xff, char.charCodeAt(0) >> 8])];
/** What a UTF-8 decoder makes of bytes that are not UTF-8, written back as a file. */
const lossy = (bytes: number[]) => utf8(new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(bytes)));
const REPLACEMENT_BYTES = [0xef, 0xbf, 0xbd];
const contains = (bytes: number[], part: number[]) => bytes.some((_, at) => part.every((byte, i) => bytes[at + i] === byte));

const FILES = [
  {
    what: "a .csv in Windows-1252",
    path: "Data.csv",
    first: windows1252("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n"),
    onA: windows1252("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n4;Weiß\r\n"),
    onB: windows1252("id;name\r\n0;Käse\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n"),
  },
  {
    what: "a .txt in UTF-16",
    path: "Liste.txt",
    first: utf16("Grün\r\nBlau\r\nRot\r\n"),
    onA: utf16("Grün\r\nBlau\r\nRot\r\nWeiß\r\n"),
    onB: utf16("Käse\r\nGrün\r\nBlau\r\nRot\r\n"),
  },
  {
    what: "a note in Windows-1252",
    path: "Alt.md",
    first: windows1252("# Grüße\r\n\r\neins\r\nzwei\r\ndrei\r\n"),
    onA: windows1252("# Grüße\r\n\r\neins\r\nzwei\r\ndrei\r\nvier für A\r\n"),
    onB: windows1252("# Grüße\r\n\r\nnull für B\r\neins\r\nzwei\r\ndrei\r\n"),
  },
] as const;

for (const reader of ["replaces", "refuses"] as const) {
  describe(`a text file that is not UTF-8 — a text reader that ${reader} such bytes`, () => {
    for (const file of FILES) {
      const first = [...file.first], onA = [...file.onA], onB = [...file.onB];

      it(`${file.what} arrives byte for byte, and nothing is uploaded or written again`, async () => {
        // The premise: a decoder cannot give these bytes back.
        expect(lossy(first)).not.toEqual(first);
        const { a, b, dav, remoteBytes, uploads } = await synced(reader, file.path, first);
        expect(remoteBytes(file.path)).toEqual(first);
        expect(await a.bytes(file.path)).toEqual(first);
        // The second device did nothing but pull — and holds the file, not its decoded text.
        expect(await b.bytes(file.path)).toEqual(first);
        expect(contains(await b.bytes(file.path), REPLACEMENT_BYTES)).toBe(false);
        expect(uploads(file.path)).toBe(1);

        // What the devices keep about it: the hash of its bytes, and no text to merge against.
        for (const d of [a, b]) {
          const row = (await d.row(file.path))!;
          expect(row.base_sha256).toBe(await sha256(first));
          expect(row.local_sha256).toBe(await sha256(first));
          expect(row.base_text).toBeNull();
          expect((await d.indexed(file.path))!.sha256).toBe(await sha256(first));
        }

        // It stays that way: no upload, and neither device writes its file again.
        const writtenA = await a.written(file.path), writtenB = await b.written(file.path);
        await b.cycle(); await a.cycle(); await b.cycle(); await a.cycle();
        expect(uploads(file.path)).toBe(1);
        expect(await a.written(file.path)).toBe(writtenA);
        expect(await b.written(file.path)).toBe(writtenB);

        // Nor when the server only hands out a new ETag for the same bytes.
        dav.files.set(file.path, { bytes: dav.files.get(file.path)!.bytes, etag: "restamped" });
        await a.cycle(); await b.cycle(); await a.cycle(); await b.cycle();
        expect(uploads(file.path)).toBe(1);
        expect(await a.written(file.path)).toBe(writtenA);
        expect(await b.written(file.path)).toBe(writtenB);
        expect(await a.bytes(file.path)).toEqual(first);
        expect(await b.bytes(file.path)).toEqual(first);
        expect(remoteBytes(file.path)).toEqual(first);
        expect(await a.files()).toEqual([file.path]);
        expect(await b.files()).toEqual([file.path]);

        // A third device that already holds the same bytes joins: it has
        // nothing to take and nothing to give.
        const c = await device(dav, reader);
        await c.put(file.path, first);
        const writtenC = await c.written(file.path);
        await c.cycle(); await c.cycle();
        expect(uploads(file.path)).toBe(1);
        expect(await c.written(file.path)).toBe(writtenC);
        expect(await c.files()).toEqual([file.path]);
        expect((await c.row(file.path))!.base_sha256).toBe(await sha256(first));
        expect([...a.problems(), ...b.problems(), ...c.problems()]).toEqual([]);
      });

      it(`${file.what}: a change on one device follows; a change on both leaves a conflict copy, not a merge`, async () => {
        const { a, b, remoteBytes, remoteFiles, uploads } = await synced(reader, file.path, first);

        // One side changed it: the other one has exactly that, after one upload.
        await a.put(file.path, onA);
        await a.cycle();
        await b.cycle();
        expect(remoteBytes(file.path)).toEqual(onA);
        expect(await b.bytes(file.path)).toEqual(onA);
        expect(uploads(file.path)).toBe(2);
        expect(await b.files()).toEqual([file.path]);
        // What the pull replaced is in the version history, byte for byte.
        expect(await b.snapshots(file.path)).toEqual([first]);

        // Back to a common state, then both sides change it — different lines,
        // which two UTF-8 files would have merged without a word.
        await a.put(file.path, first);
        await a.cycle();
        await b.cycle();
        expect(await b.bytes(file.path)).toEqual(first);
        await a.put(file.path, onA);
        await b.put(file.path, onB);
        await a.cycle();
        await b.cycle();
        await a.cycle();

        // The server's version is the file on both devices, byte for byte…
        expect(remoteBytes(file.path)).toEqual(onA);
        expect(await a.bytes(file.path)).toEqual(onA);
        expect(await b.bytes(file.path)).toEqual(onA);
        // …and the second device's own version lies next to it, byte for byte.
        const copies = (await b.files()).filter((name) => name.includes(".CONFLICT-"));
        expect(copies).toHaveLength(1);
        expect(await b.bytes(copies[0]!)).toEqual(onB);
        expect((await b.files()).filter((name) => name !== copies[0])).toEqual([file.path]);
        // The copy stays on its device; the first device has nothing to sort out.
        expect(await a.files()).toEqual([file.path]);
        expect(remoteFiles()).toEqual([file.path]);
        await b.cycle(); await a.cycle();
        // Four uploads, all from the first device: the file, its change, back, its change again.
        expect(uploads(file.path)).toBe(4);
        expect(remoteBytes(file.path)).toEqual(onA);
        expect(remoteFiles()).toEqual([file.path]);
        expect([...a.problems(), ...b.problems()]).toEqual([]);
      });

      it(`${file.what}: renamed and deleted on one device, it follows on the other with its bytes`, async () => {
        const extension = file.path.slice(file.path.lastIndexOf("."));
        const inApp = `Renamed in the app${extension}`, outside = `Renamed outside${extension}`;
        // A second file, so that the vault is never empty: a listing without
        // any file is a question to the user, not a deletion to mirror.
        const keep = "Keep.md";
        const w = world();
        const { dav, remoteBytes, remoteFiles, uploads } = w;
        const a = await device(dav, reader), b = await device(dav, reader);
        await a.put(keep, utf8("keep\n"));
        await a.put(file.path, first);
        await a.cycle();
        await b.cycle();
        expect(await b.bytes(file.path)).toEqual(first);

        // Renamed in the app: one MOVE, no second upload.
        await a.app.renameItem(file.path, inApp);
        await a.cycle(); await b.cycle(); await a.cycle(); await b.cycle();
        expect(remoteFiles()).toEqual([keep, inApp].sort());
        expect(remoteBytes(inApp)).toEqual(first);
        expect(await a.files()).toEqual([keep, inApp].sort());
        expect(await b.files()).toEqual([keep, inApp].sort());
        expect(await b.bytes(inApp)).toEqual(first);
        expect(dav.log.filter((line) => line.startsWith("PUT ")).sort()).toEqual([`PUT ${keep}`, `PUT ${file.path}`].sort());
        expect(dav.log.filter((line) => line.startsWith("MOVE "))).toEqual([`MOVE ${file.path}`]);
        // The second device took it for what it was — a move: the file under
        // the new name holds exactly the bytes the old name held at the last
        // agreement. A deletion it would have counted.
        expect(b.removals()).toEqual([]);

        // Renamed by another program: the second device recognises the file by
        // its bytes under the new name and lets the old name go.
        await fs.rename(path.join(a.root, inApp), path.join(a.root, outside));
        await a.cycle(); await b.cycle(); await a.cycle(); await b.cycle();
        expect(remoteFiles()).toEqual([keep, outside].sort());
        expect(remoteBytes(outside)).toEqual(first);
        expect(await a.files()).toEqual([keep, outside].sort());
        expect(await b.files()).toEqual([keep, outside].sort());
        expect(await b.bytes(outside)).toEqual(first);
        expect(uploads(outside)).toBe(1);
        expect(b.removals()).toEqual([]);

        // Deleted in the app: gone on the server, and on the second device —
        // which held it unchanged, by the hash of its bytes.
        await a.app.deleteItem(outside);
        await a.cycle(); await b.cycle(); await a.cycle(); await b.cycle();
        expect(remoteFiles()).toEqual([keep]);
        expect(await a.files()).toEqual([keep]);
        expect(await b.files()).toEqual([keep]);
        expect(b.removals()).toEqual([{ mirrored: 1, kept: [] }]);
        expect([...a.problems(), ...b.problems()]).toEqual([]);
      });
    }

    it("stands next to a note that syncs as text: the note still merges, the file still travels as bytes", async () => {
      const csv = [...FILES[0].first];
      const w = world();
      const a = await device(w.dav, reader), b = await device(w.dav, reader);
      await a.put("Data.csv", csv);
      await a.put("Note.md", utf8("one\ntwo\nthree\nfour\nfive\n"));
      await a.cycle();
      await b.cycle();
      expect(await b.bytes("Data.csv")).toEqual(csv);
      await a.put("Note.md", utf8("one here\ntwo\nthree\nfour\nfive\n"));
      await b.put("Note.md", utf8("one\ntwo\nthree\nfour\nfive there\n"));
      await a.cycle(); await b.cycle(); await a.cycle();
      const merged = utf8("one here\ntwo\nthree\nfour\nfive there\n");
      expect(await a.bytes("Note.md")).toEqual(merged);
      expect(await b.bytes("Note.md")).toEqual(merged);
      expect(w.remoteBytes("Note.md")).toEqual(merged);
      expect(await b.files()).toEqual(["Data.csv", "Note.md"]);
      expect(w.uploads("Data.csv")).toBe(1);
      expect((await b.row("Note.md"))!.base_text).toBe("one here\ntwo\nthree\nfour\nfive there\n");
      expect([...a.problems(), ...b.problems()]).toEqual([]);
    });

    it("a file converted to UTF-8 on one device arrives as that, and is text from then on", async () => {
      const before = windows1252("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n");
      const after = utf8("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n");
      const { a, b, remoteBytes } = await synced(reader, "Data.csv", before);
      await a.put("Data.csv", after);
      await a.cycle();
      await b.cycle();
      // The second device held the old bytes unchanged: it takes the new ones, without a copy.
      expect(await b.bytes("Data.csv")).toEqual(after);
      expect(await b.files()).toEqual(["Data.csv"]);
      await a.cycle();
      // Both sides change different lines of what is now UTF-8: a merge, like for any text file.
      await a.put("Data.csv", utf8("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n4;Weiß\r\n"));
      await b.put("Data.csv", utf8("id;name\r\n0;Käse\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n"));
      await a.cycle(); await b.cycle(); await a.cycle();
      const merged = utf8("id;name\r\n0;Käse\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n4;Weiß\r\n");
      expect(await b.bytes("Data.csv")).toEqual(merged);
      expect(await a.bytes("Data.csv")).toEqual(merged);
      expect(remoteBytes("Data.csv")).toEqual(merged);
      expect(await a.files()).toEqual(["Data.csv"]);
      expect(await b.files()).toEqual(["Data.csv"]);
      expect([...a.problems(), ...b.problems()]).toEqual([]);
    });

    it("a version with replacement characters arrives from a device that still decodes such files: it is taken, and the file in the other encoding stays next to it", async () => {
      const first = windows1252("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n");
      const { a, b, serve, uploads, remoteFiles } = await synced(reader, "Data.csv", first);
      // What an older version on a third device made of the file and sent back:
      // the decoded text, with a row added there.
      const decodedThere = utf8(`${new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(first))}4;new\r\n`);
      expect(contains(decodedThere, REPLACEMENT_BYTES)).toBe(true);
      serve("Data.csv", decodedThere);
      await a.cycle(); await b.cycle(); await a.cycle(); await b.cycle();
      for (const d of [a, b]) {
        // Neither device had changed the file, so the incoming version is the file…
        expect(await d.bytes("Data.csv")).toEqual(decodedThere);
        // …and what cannot be rebuilt from it is still there, byte for byte, once.
        const copies = (await d.files()).filter((name) => name.includes(".CONFLICT-"));
        expect(copies).toHaveLength(1);
        expect(await d.bytes(copies[0]!)).toEqual(first);
      }
      expect(uploads("Data.csv")).toBe(1);
      expect(remoteFiles()).toEqual(["Data.csv"]);
      expect([...a.problems(), ...b.problems()]).toEqual([]);
    });

    it("a UTF-8 file that another program saved in Windows-1252 loses its merge base: the next change on both sides is a copy, not a merge against the old text", async () => {
      const asText = utf8("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n");
      const converted = windows1252("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n");
      const { a, b, remoteBytes, uploads } = await synced(reader, "Data.csv", asText);
      expect((await b.row("Data.csv"))!.base_text).not.toBeNull();
      await a.put("Data.csv", converted);
      await a.cycle();
      await b.cycle();
      expect(await b.bytes("Data.csv")).toEqual(converted);
      // The text both devices kept as the common ancestor described the UTF-8 file.
      expect((await a.row("Data.csv"))!.base_text).toBeNull();
      expect((await b.row("Data.csv"))!.base_text).toBeNull();
      expect((await b.row("Data.csv"))!.base_sha256).toBe(await sha256(converted));

      // Both devices save it as UTF-8 again and change different lines. Against
      // the text they once shared the two would merge without a word — but
      // that text is not what they last agreed on, and nothing else is kept
      // for a file that travelled as bytes.
      const backOnA = utf8("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n4;Weiß\r\n");
      const backOnB = utf8("id;name\r\n0;Käse\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n");
      await a.put("Data.csv", backOnA);
      await b.put("Data.csv", backOnB);
      await a.cycle(); await b.cycle(); await a.cycle();
      expect(remoteBytes("Data.csv")).toEqual(backOnA);
      expect(await a.bytes("Data.csv")).toEqual(backOnA);
      expect(await b.bytes("Data.csv")).toEqual(backOnA);
      const copies = (await b.files()).filter((name) => name.includes(".CONFLICT-"));
      expect(copies).toHaveLength(1);
      expect(await b.bytes(copies[0]!)).toEqual(backOnB);
      // Three uploads, all from the first device: the file, in Windows-1252, in UTF-8 again.
      expect(uploads("Data.csv")).toBe(3);
      // What both hold now IS text, and the common ancestor of the next change.
      expect((await b.row("Data.csv"))!.base_text).toBe("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n4;Weiß\r\n");
      expect([...a.problems(), ...b.problems()]).toEqual([]);
    });

    it("the note beside it is found by the index, and so is the note in another encoding", async () => {
      const w = world();
      const a = await device(w.dav, reader);
      await a.put("Alt.md", windows1252("# Grüße\r\n\r\nSiehe [[Ziel]] #alt\r\n"));
      await a.put("Unicode.md", utf16("# Titel\r\n\r\nSiehe [[Ziel]]\r\n"));
      await a.put("Ziel.md", utf8("# Ziel\n"));
      await a.cycle();
      expect(a.problems()).toEqual([]);
      // All three are in the index, each under the hash of its bytes…
      expect((await a.indexed("Alt.md"))!.sha256).toBe(await sha256(windows1252("# Grüße\r\n\r\nSiehe [[Ziel]] #alt\r\n")));
      expect((await a.indexed("Unicode.md"))!.sha256).toBe(await sha256(utf16("# Titel\r\n\r\nSiehe [[Ziel]]\r\n")));
      expect(await a.indexed("Ziel.md")).not.toBeNull();
      // …and what could be read of the two is there to be found: their links and tags.
      const links = await a.db.query<{ path: string; target_raw: string }>(
        "SELECT f.path AS path, l.target_raw AS target_raw FROM links l JOIN files f ON f.id = l.source_id ORDER BY f.path");
      expect(links).toEqual([{ path: "Alt.md", target_raw: "Ziel" }, { path: "Unicode.md", target_raw: "Ziel" }]);
      const tags = await a.db.query<{ tag: string }>("SELECT tag FROM tags");
      expect(tags.map((row) => row.tag)).toEqual(["alt"]);
      // Neither has a merge base text: the reading is not the note.
      expect((await a.row("Alt.md"))!.base_text).toBeNull();
      expect((await a.row("Unicode.md"))!.base_text).toBeNull();
      expect(w.remoteBytes("Alt.md")).toEqual(windows1252("# Grüße\r\n\r\nSiehe [[Ziel]] #alt\r\n"));
      expect(w.remoteBytes("Unicode.md")).toEqual(utf16("# Titel\r\n\r\nSiehe [[Ziel]]\r\n"));
    });

    it("opening it in the app records the hash of its bytes, and the next look at it finds no change", async () => {
      const csv = [...FILES[0].first];
      const { a, uploads } = await synced(reader, "Data.csv", csv);
      await a.db.execute("UPDATE sync_state SET local_sha256 = 'something older' WHERE path = 'Data.csv'");
      await a.app.acknowledgeExternalUpdate("Data.csv");
      expect((await a.row("Data.csv"))!.local_sha256).toBe(await sha256(csv));
      // A touch (another program rewrote the same bytes) makes the indexer look again.
      a.events.length = 0;
      await a.put("Data.csv", csv);
      await a.cycle(); await a.cycle();
      expect(a.events).toEqual([]);
      expect(uploads("Data.csv")).toBe(1);
      expect(a.problems()).toEqual([]);
    });
  });
}

describe("what an older version left behind for a file that is not UTF-8", () => {
  // The states below are the ones the code before this rule left, read off a
  // run of it: bytes on disk and the row in `sync_state`, for the same file.
  const original = windows1252("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n");
  const damaged = lossy(original);
  const decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(original));

  /** The app starts again after its update: the database goes through `initializeSchema`. */
  const update = async (d: Awaited<ReturnType<typeof device>>) => {
    await d.db.execute("DELETE FROM meta WHERE key = 'lossy_text_base_version'");
    await initializeSchema(d.db);
  };

  /**
   * A device that pulled the file with the old version: the decoded text as the
   * file, and "in sync". `through` stands between that device and the server.
   */
  async function pulledByAnOlderVersion(reader: Reader, through: (dav: ByteExactDav) => ByteExactDav = (dav) => dav) {
    const w = world();
    const a = await device(w.dav, reader);
    await a.put("Keep.md", utf8("keep\n"));
    await a.put("Data.csv", original);
    await a.cycle();
    const b = await device(through(w.dav), reader);
    await b.cycle();
    await b.put("Data.csv", damaged);
    await b.db.execute("UPDATE sync_state SET local_sha256 = ?, base_sha256 = ?, base_text = ? WHERE path = ?", [await sha256(damaged), await sha256(damaged), decoded, "Data.csv"]);
    await b.index();
    await b.db.execute("DELETE FROM offline_queue");
    return { ...w, a, b };
  }

  for (const reader of ["replaces", "refuses"] as const) {
    it(`on a device that pulled it — the decoded text lies there as the file: it gets the server's bytes back, and nothing goes up (a reader that ${reader})`, async () => {
      const { a, b, remoteBytes, uploads } = await pulledByAnOlderVersion(reader);
      expect(contains(await b.bytes("Data.csv"), REPLACEMENT_BYTES)).toBe(true);
      const writtenA = await a.written("Data.csv");
      const etag = (await b.row("Data.csv"))!.remote_etag;
      await update(b);
      // Marked to be looked at again; what the server said about the file is left as it was.
      expect((await b.row("Data.csv"))!.recheck).toBe(1);
      expect((await b.row("Data.csv"))!.remote_etag).toBe(etag);
      expect((await b.row("Keep.md"))!.recheck).toBeNull();

      await b.cycle();
      // Nobody had touched the damaged copy: it is the original again.
      expect(await b.bytes("Data.csv")).toEqual(original);
      expect(await b.files()).toEqual(["Data.csv", "Keep.md"]);
      const row = (await b.row("Data.csv"))!;
      expect(row.recheck).toBeNull();
      expect(row.base_sha256).toBe(await sha256(original));
      expect(row.local_sha256).toBe(await sha256(original));
      expect(row.base_text).toBeNull();
      // The server's copy was never in question, and it is not uploaded over.
      expect(remoteBytes("Data.csv")).toEqual(original);
      expect(uploads("Data.csv")).toBe(1);
      await b.cycle(); await a.cycle(); await b.cycle();
      expect(uploads("Data.csv")).toBe(1);
      expect(await a.written("Data.csv")).toBe(writtenA);
      expect(await a.bytes("Data.csv")).toEqual(original);
      expect([...a.problems(), ...b.problems()]).toEqual([]);
    });

    it(`on that device, after somebody changed the damaged copy: the change is kept as a copy, the original stays the file, and the damaged version does not go up (a reader that ${reader})`, async () => {
      const { a, b, remoteBytes, remoteFiles, uploads } = await pulledByAnOlderVersion(reader);
      const edited = utf8(`${decoded}4;new line\r\n`);
      await b.put("Data.csv", edited);
      await update(b);
      await b.cycle();
      expect(await b.bytes("Data.csv")).toEqual(original);
      const copies = (await b.files()).filter((name) => name.includes(".CONFLICT-"));
      expect(copies).toHaveLength(1);
      expect(await b.bytes(copies[0]!)).toEqual(edited);
      // What went to the server is nothing: the file with replacement characters stays on this device.
      expect(remoteBytes("Data.csv")).toEqual(original);
      expect(remoteFiles()).toEqual(["Data.csv", "Keep.md"]);
      expect(uploads("Data.csv")).toBe(1);
      await b.cycle(); await a.cycle();
      expect(uploads("Data.csv")).toBe(1);
      expect(await b.waiting()).toEqual([]);
      expect((await b.row("Data.csv"))!.recheck).toBeNull();
      expect(await a.bytes("Data.csv")).toEqual(original);
      expect(await a.files()).toEqual(["Data.csv", "Keep.md"]);
      expect([...a.problems(), ...b.problems()]).toEqual([]);
    });

    it(`on that device, when the server does not hand the file out for once: the changed damaged copy waits and does not go up; the next cycle keeps it as a copy (a reader that ${reader})`, async () => {
      // The pull of one file can fail while the push of the same cycle runs.
      // Without the mark holding the push back, the version with replacement
      // characters went up over the original in exactly that cycle.
      const server = { locked: false };
      const { a, b, remoteBytes, remoteFiles, uploads } = await pulledByAnOlderVersion(reader, (dav) => ({
        ...dav,
        fetch: async (input, init) =>
          server.locked && (init?.method ?? "GET").toUpperCase() === "GET" && String(input).endsWith("/Data.csv")
            ? new Response("", { status: 423 })
            : dav.fetch(input, init),
      }));
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const edited = utf8(`${decoded}4;new line\r\n`);
      await b.put("Data.csv", edited);
      await update(b);

      server.locked = true;
      await b.cycle();
      // Nothing was compared: the file is as it was left, still marked, and its push waits.
      expect(await b.bytes("Data.csv")).toEqual(edited);
      expect((await b.row("Data.csv"))!.recheck).toBe(1);
      expect(await b.waiting()).toEqual(["write Data.csv"]);
      expect(remoteBytes("Data.csv")).toEqual(original);
      expect(uploads("Data.csv")).toBe(1);
      // The failed download is said, not swallowed.
      expect(b.problems().join("\n")).toContain("could not be pulled");
      // It keeps waiting for as long as the comparison has not happened.
      await b.retryNow();
      await b.cycle();
      expect(await b.waiting()).toEqual(["write Data.csv"]);
      expect(remoteBytes("Data.csv")).toEqual(original);
      expect(uploads("Data.csv")).toBe(1);
      b.problems();

      server.locked = false;
      await b.retryNow();
      await b.cycle();
      expect(await b.bytes("Data.csv")).toEqual(original);
      const copies = (await b.files()).filter((name) => name.includes(".CONFLICT-"));
      expect(copies).toHaveLength(1);
      expect(await b.bytes(copies[0]!)).toEqual(edited);
      expect((await b.row("Data.csv"))!.recheck).toBeNull();
      // The push that waited found nothing left to carry: the file is the server's again.
      await b.retryNow();
      await b.cycle();
      expect(await b.waiting()).toEqual([]);
      expect(remoteBytes("Data.csv")).toEqual(original);
      expect(remoteFiles()).toEqual(["Data.csv", "Keep.md"]);
      expect(uploads("Data.csv")).toBe(1);
      await a.cycle();
      expect(await a.bytes("Data.csv")).toEqual(original);
      expect(await a.files()).toEqual(["Data.csv", "Keep.md"]);
      expect([...a.problems(), ...b.problems()]).toEqual([]);
    });

    it(`on that device, renamed in the app before it was looked at: the mark moves with the file, and it is made whole under its new name (a reader that ${reader})`, async () => {
      const { a, b, dav, remoteBytes, remoteFiles } = await pulledByAnOlderVersion(reader);
      await update(b);
      await b.app.renameItem("Data.csv", "Renamed.csv");
      expect(await b.row("Data.csv")).toBeNull();
      expect((await b.row("Renamed.csv"))!.recheck).toBe(1);

      // The first cycle carries the rename up, the next one meets the file under its new name.
      await b.cycle();
      expect(remoteFiles()).toEqual(["Keep.md", "Renamed.csv"]);
      await b.cycle();
      expect(await b.bytes("Renamed.csv")).toEqual(original);
      expect(await b.files()).toEqual(["Keep.md", "Renamed.csv"]);
      const row = (await b.row("Renamed.csv"))!;
      expect(row.recheck).toBeNull();
      expect(row.base_sha256).toBe(await sha256(original));
      expect(row.local_sha256).toBe(await sha256(original));
      expect(row.base_text).toBeNull();
      // One MOVE, and no upload beyond the very first one: the damaged copy went nowhere.
      expect(remoteBytes("Renamed.csv")).toEqual(original);
      expect(dav.log.filter((line) => line.startsWith("MOVE "))).toEqual(["MOVE Data.csv"]);
      expect(dav.log.filter((line) => line.startsWith("PUT ") && line.endsWith(".csv"))).toEqual(["PUT Data.csv"]);
      await a.cycle(); await b.cycle(); await a.cycle();
      expect(await a.files()).toEqual(["Keep.md", "Renamed.csv"]);
      expect(await a.bytes("Renamed.csv")).toEqual(original);
      expect(dav.log.filter((line) => line.startsWith("PUT ") && line.endsWith(".csv"))).toEqual(["PUT Data.csv"]);
      expect([...a.problems(), ...b.problems()]).toEqual([]);
    });

    it(`on that device, moved by another program before it was looked at: the server's original is not deleted and comes back under its name (a reader that ${reader})`, async () => {
      const { a, b, dav, remoteBytes, remoteFiles } = await pulledByAnOlderVersion(reader);
      // While the app was closed. To the index this is one file gone and one new.
      await fs.rename(path.join(b.root, "Data.csv"), path.join(b.root, "Moved.csv"));
      await update(b);
      await b.cycle(); await b.cycle();
      // No DELETE went up: what vanished here was never compared with what lies there.
      expect(dav.log.filter((line) => line.startsWith("DELETE "))).toEqual([]);
      expect(remoteBytes("Data.csv")).toEqual(original);
      // The original is back under its name; the moved copy went up as the new file it is.
      expect(await b.bytes("Data.csv")).toEqual(original);
      expect(await b.bytes("Moved.csv")).toEqual(damaged);
      expect(remoteFiles()).toEqual(["Data.csv", "Keep.md", "Moved.csv"]);
      await a.cycle(); await b.cycle(); await a.cycle();
      expect(await a.bytes("Data.csv")).toEqual(original);
      expect(await a.files()).toEqual(["Data.csv", "Keep.md", "Moved.csv"]);
      expect(await b.files()).toEqual(["Data.csv", "Keep.md", "Moved.csv"]);
      expect(await b.waiting()).toEqual([]);
      expect(dav.log.filter((line) => line.startsWith("DELETE "))).toEqual([]);
      // One upload of the original, ever, and one of the moved copy.
      expect(dav.log.filter((line) => line.startsWith("PUT ") && line.endsWith(".csv"))).toEqual(["PUT Data.csv", "PUT Moved.csv"]);
      expect([...a.problems(), ...b.problems()]).toEqual([]);
    });

    it(`on that device, changed and then deleted in the app before it was looked at: the deletion goes through and nothing is left waiting (a reader that ${reader})`, async () => {
      // The phone saves an open file and deletes it back to back: a write and
      // a DELETE of the same path in the queue, and no file. A held write that
      // was not retired kept the DELETE behind it for good.
      const { a, b, dav, remoteFiles } = await pulledByAnOlderVersion(reader);
      await b.put("Data.csv", utf8(`${decoded}4;new line\r\n`));
      await b.index();
      await update(b);
      expect(await b.waiting()).toEqual(["write Data.csv"]);
      await b.app.deleteItem("Data.csv", false, { confirmed: true });
      expect(await b.waiting()).toEqual(["write Data.csv", "delete Data.csv"]);

      await b.cycle(); await b.cycle(); await b.cycle();
      expect(await b.waiting()).toEqual([]);
      // The person deleted the file in the app: that deletion is theirs, and it went up.
      expect(dav.log.filter((line) => line.startsWith("DELETE "))).toEqual(["DELETE Data.csv"]);
      expect(remoteFiles()).toEqual(["Keep.md"]);
      expect(await b.files()).toEqual(["Keep.md"]);
      expect(await b.row("Data.csv")).toBeNull();
      // Nothing of the copy with replacement characters went anywhere.
      expect(dav.log.filter((line) => line.startsWith("PUT ") && line.endsWith(".csv"))).toEqual(["PUT Data.csv"]);
      await a.cycle(); await a.cycle();
      expect(await a.files()).toEqual(["Keep.md"]);
      expect([...a.problems(), ...b.problems()]).toEqual([]);
    });

    it(`on that device, while another program holds the changed copy open: one conflict copy, however many cycles it takes (a reader that ${reader})`, async () => {
      // A file open elsewhere can be read and not replaced. Each cycle arrives
      // at the same place — and used to leave one more copy of the same bytes.
      const { b, remoteBytes, uploads } = await pulledByAnOlderVersion(reader);
      const edited = utf8(`${decoded}4;new line\r\n`);
      await b.put("Data.csv", edited);
      await update(b);
      const program = { holdsTheFile: true };
      const write = b.syncFiles.writeBinaryFile.bind(b.syncFiles);
      vi.spyOn(b.syncFiles, "writeBinaryFile").mockImplementation(async (p, bytes) => {
        if (program.holdsTheFile && p === "Data.csv") throw new Error("The process cannot access the file because it is being used by another process.");
        return write(p, bytes);
      });
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      await b.cycle(); await b.cycle(); await b.cycle();
      const copies = async () => (await b.files()).filter((name) => name.includes(".CONFLICT-"));
      expect(await copies()).toHaveLength(1);
      expect(await b.bytes((await copies())[0]!)).toEqual(edited);
      expect(await b.bytes("Data.csv")).toEqual(edited);
      expect((await b.row("Data.csv"))!.recheck).toBe(1);
      expect(b.problems().join("\n")).toContain("could not be pulled");
      expect(remoteBytes("Data.csv")).toEqual(original);
      expect(uploads("Data.csv")).toBe(1);

      program.holdsTheFile = false;
      await b.cycle(); await b.cycle();
      expect(await b.bytes("Data.csv")).toEqual(original);
      expect(await copies()).toHaveLength(1);
      expect((await b.row("Data.csv"))!.recheck).toBeNull();
      expect(await b.waiting()).toEqual([]);
      expect(remoteBytes("Data.csv")).toEqual(original);
      expect(uploads("Data.csv")).toBe(1);
      expect(b.problems()).toEqual([]);
    });
  }

  /**
   * A device that held the original with the old version, whose text reader
   * replaced: the file is whole, and every hash kept about it is the one of
   * its decoded text — the index's, the local marker's (written when the file
   * was opened) and the base's (written when the server handed out a new
   * marker for the same bytes).
   */
  async function heldByAnOlderVersion() {
    const w = world();
    const a = await device(w.dav, "replaces");
    await a.put("Keep.md", utf8("keep\n"));
    await a.put("Data.csv", original);
    await a.cycle();
    const decodedHash = await sha256(damaged);
    await a.db.execute("UPDATE sync_state SET local_sha256 = ?, base_sha256 = ?, base_text = ? WHERE path = ?", [decodedHash, decodedHash, decoded, "Data.csv"]);
    await a.db.execute("UPDATE files SET sha256 = ? WHERE path = ?", [decodedHash, "Data.csv"]);
    return { ...w, a };
  }

  it("on the device that held the original — its hashes are those of the decoded text: they are put right, nothing is written or uploaded, and the next change from elsewhere arrives without a copy", async () => {
    const { a, uploads, serve } = await heldByAnOlderVersion();
    const written = await a.written("Data.csv");
    await update(a);
    expect((await a.row("Data.csv"))!.recheck).toBe(1);
    await a.cycle();
    await a.cycle();
    expect(await a.written("Data.csv")).toBe(written);
    expect(uploads("Data.csv")).toBe(1);
    const row = (await a.row("Data.csv"))!;
    expect(row.base_sha256).toBe(await sha256(original));
    // The marker too: left as it was, the app's next look at the file would
    // have read "changed by someone else".
    expect(row.local_sha256).toBe(await sha256(original));
    expect(row.base_text).toBeNull();
    expect(row.recheck).toBeNull();
    expect(await a.waiting()).toEqual([]);

    // Another device adds a row. With the wrong base this was "changed on both sides".
    const next = windows1252("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n4;Weiß\r\n");
    serve("Data.csv", next);
    await a.cycle();
    expect(await a.bytes("Data.csv")).toEqual(next);
    expect(await a.files()).toEqual(["Data.csv", "Keep.md"]);
    expect(uploads("Data.csv")).toBe(1);
    expect(a.problems()).toEqual([]);
  });

  it("on that device, when the file was deleted elsewhere before it was looked at: it is kept, the mark comes off, and its next change goes up", async () => {
    const { a, dav, uploads, remoteBytes, remoteFiles } = await heldByAnOlderVersion();
    await update(a);
    // Another device deleted the file. By the hashes this device kept, its own
    // copy does not read as "unchanged since the last sync" — so it stays.
    dav.files.delete("Data.csv");
    await a.cycle();
    expect(await a.bytes("Data.csv")).toEqual(original);
    expect(a.removals()).toEqual([{ mirrored: 0, kept: ["Data.csv"] }]);
    // Nothing is left to compare it with: the mark is gone, or no change of
    // this file would ever be pushed again.
    expect((await a.row("Data.csv"))!.recheck).toBeNull();
    expect(remoteFiles()).toEqual(["Keep.md"]);

    const next = windows1252("id;name\r\n1;Grün\r\n2;Blau\r\n3;Rot\r\n4;Weiß\r\n");
    await a.put("Data.csv", next);
    await a.cycle(); await a.cycle();
    expect(remoteBytes("Data.csv")).toEqual(next);
    expect(await a.bytes("Data.csv")).toEqual(next);
    expect(uploads("Data.csv")).toBe(2);
    expect(await a.waiting()).toEqual([]);
    a.removals();
    await a.cycle();
    expect(a.removals()).toEqual([]);
    expect(a.problems()).toEqual([]);
  });

  it("a note that merely quotes the replacement character is looked at once and comes out as it went in", async () => {
    const note = utf8(`# Encodings\n\nA decoder writes ${String.fromCharCode(0xfffd)} where it could not read a byte.\n`);
    const w = world();
    const a = await device(w.dav, "replaces");
    await a.put("Encodings.md", note);
    await a.cycle();
    const written = await a.written("Encodings.md");
    const before = (await a.row("Encodings.md"))!;
    await update(a);
    // Nothing in the row tells this note from a damaged file, so it is marked as well.
    expect(await a.row("Encodings.md")).toEqual({ ...before, recheck: 1 });
    const downloads = () => w.dav.log.filter((line) => line === "GET Encodings.md").length;
    const seen = downloads();
    await a.cycle();
    expect(downloads()).toBe(seen + 1);
    expect(await a.row("Encodings.md")).toEqual(before);
    expect(await a.bytes("Encodings.md")).toEqual(note);
    expect(await a.written("Encodings.md")).toBe(written);
    expect(w.uploads("Encodings.md")).toBe(1);
    // Once: the next cycles do not fetch it again.
    await a.cycle(); await a.cycle();
    expect(downloads()).toBe(seen + 1);
    expect(a.problems()).toEqual([]);
  });

  it("marks the rows whose merge base carries the replacement character, once, and touches nothing else of them", async () => {
    const db = await realSqlite();
    closers.push(() => db.close());
    const replaced = `Gr${String.fromCharCode(0xfffd)}n`;
    const insert = "INSERT INTO sync_state (path, local_sha256, remote_etag, base_sha256, base_etag, remote_id, last_sync_ts, base_text, pending_push_sha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    await db.execute(insert, ["Damaged.csv", "l1", "e1", "b1", "e1", "id1", 11, replaced, "p1"]);
    await db.execute(insert, ["Clean.md", "l2", "e2", "b2", "e2", "id2", 12, "Grün", null]);
    await db.execute(insert, ["Never synced.csv", "l3", null, null, null, null, null, replaced, null]);
    await db.execute(insert, ["Image.png", "l4", "e4", "b4", "e4", "id4", 14, null, null]);
    const rows = async () => Object.fromEntries((await db.query<Record<string, unknown> & { path: string }>("SELECT * FROM sync_state ORDER BY path")).map((r) => [r.path, r]));
    const before = await rows();
    // A database that has been through it is left alone…
    expect(await flagLossyTextBases(db)).toBeNull();
    expect(await rows()).toEqual(before);
    // …one from an older version is looked through once: one row gets the mark, and that is all that changes.
    await db.execute("DELETE FROM meta WHERE key = 'lossy_text_base_version'");
    expect(await flagLossyTextBases(db)).toBe(1);
    const marked = { ...before, "Damaged.csv": { ...before["Damaged.csv"], recheck: 1 } };
    expect(before["Damaged.csv"]!.recheck).toBeNull();
    expect(await rows()).toEqual(marked);
    expect(await flagLossyTextBases(db)).toBeNull();
    expect(await rows()).toEqual(marked);

    // The mark is a column of the row: it goes where the row goes, and what a
    // push writes about the remote copy does not wipe it.
    const repo = new SyncStateRepository(db);
    await repo.updateRemoteState("Damaged.csv", "e9", "id-9", 1);
    await repo.updateBaseState("Damaged.csv", "base", "e9");
    await new SyncQueue(db).queueRename("Damaged.csv", "Moved.csv");
    expect((await repo.getSyncState("Moved.csv"))!.recheck).toBe(1);
    expect((await repo.getAllStates()).get("Moved.csv")!.recheck).toBe(1);
    await repo.clearRecheck("Moved.csv");
    expect((await repo.getSyncState("Moved.csv"))!.recheck).toBeNull();
    expect((await repo.getAllStates()).get("Moved.csv")!.recheck).toBeNull();
  });
});
