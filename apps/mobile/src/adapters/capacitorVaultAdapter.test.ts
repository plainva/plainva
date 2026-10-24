import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BackupVaultAdapter, ConflictAwareVaultAdapter, OwnDeletionRegister, QueueingVaultAdapter, SyncEngine, SyncQueue,
  SyncStateRepository, SyncWorker, VaultFileNotFoundError, VaultIndexer, WebDavSyncTarget, NotTextFileError, editInShape,
  readExactText, readLocalText, updateVaultText, type IDatabaseAdapter, type IVaultAdapter,
} from "@plainva/core";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { byteExactDav, type ByteExactDav } from "../../../../packages/core/test/helpers/byteExactDav";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { CapacitorVaultAdapter } from "./CapacitorVaultAdapter";
import { appStorageBytes, capacitorFilesystem, fakeAppStorage } from "./fakeAppStorage";

vi.mock("@capacitor/filesystem", async () => (await import("./fakeAppStorage")).capacitorFilesystem);
vi.mock("@capacitor/core", async () => (await import("./fakeAppStorage")).capacitorCore);

/**
 * The container adapter against a fake of the phone's own storage
 * (`fakeAppStorage.ts`), which answers a read AS TEXT the way each system's
 * library does. The twin for a folder the user picked is
 * `externalVaultAdapter.test.ts`.
 *
 * What is held here: a file's text is its bytes, decoded in one place, with a
 * byte order mark as the first character where the file has one — whatever the
 * system's own decoder would have made of it. On an iPhone it made the text
 * without the mark (finding 2026-10-11).
 */
const MARK_BYTES = [0xef, 0xbb, 0xbf];
const utf8 = (text: string) => [...new TextEncoder().encode(text)];
const marked = (body: string) => new Uint8Array([...MARK_BYTES, ...utf8(body)]);
/** Windows-1252, for the characters used here (they sit where Latin-1 has them). */
const windows1252 = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)));
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
const sha256 = async (bytes: number[]) =>
  Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes))), (byte) => byte.toString(16).padStart(2, "0")).join("");

for (const system of ["ios", "android"] as const) {
  describe(`the app's own storage on ${system === "ios" ? "an iPhone" : "an Android phone"}`, () => {
    it("hands out a file's text with its byte order mark, and writes it back byte for byte", async () => {
      // What a sync or an import laid down: a note and a table that start with
      // a mark (Excel wants one), with the line ends of the machine they came from.
      const { files } = fakeAppStorage(system);
      files.set("vault/Note.md", marked("# Title\r\n\r\none\r\n"));
      files.set("vault/Data.csv", marked("id;name\r\n1;Ada\r\n"));
      files.set("vault/Plain.md", new Uint8Array(utf8("no mark\n")));
      const adapter = new CapacitorVaultAdapter("vault");
      for (const path of ["Note.md", "Data.csv", "Plain.md"]) {
        const before = appStorageBytes(`vault/${path}`);
        const read = await adapter.readTextFile(path);
        // The mark is the text's first character, as on the desktop and in a
        // picked folder. Foundation's reader skips it: the editor saw a file
        // without a mark, and its first save wrote one without.
        expect(read.charCodeAt(0) === 0xfeff, path).toBe(before[0] === 0xef);
        await adapter.writeTextFile(path, read);
        expect(appStorageBytes(`vault/${path}`), path).toEqual(before);
      }
    });

    it("asks the system for the file's bytes, once, and for no text of its own making", async () => {
      const { files, reads } = fakeAppStorage(system);
      files.set("vault/Note.md", marked("one\r\n"));
      await new CapacitorVaultAdapter("vault").readTextFile("Note.md");
      expect(reads).toEqual([{ path: "vault/Note.md", as: "bytes" }]);
    });

    it("gives the index and the sync the hash of the file's bytes", async () => {
      const { files } = fakeAppStorage(system);
      files.set("vault/Note.md", marked("one\r\ntwo\r\n"));
      const read = await readLocalText(new CapacitorVaultAdapter("vault"), "Note.md");
      // The text of a UTF-8 file is taken for the file there. Read without its
      // mark it is not: the hash was the one of three bytes fewer, and a file a
      // pull had just written counted as changed by someone else.
      expect(read.exact).toBe(true);
      expect(read.sha256).toBe(await sha256(appStorageBytes("vault/Note.md")));
    });

    it("reads a file that is not UTF-8 like the folder adapter does, and the chain above refuses it", async () => {
      // A reading with replacement characters, on both systems. iOS' own reader
      // refused such a file instead; above the adapter that makes no difference,
      // because what such a file is, its bytes decide (`readExactText`).
      const { files } = fakeAppStorage(system);
      const bytes = windows1252("id;name\r\n1;Grün\r\n");
      files.set("vault/Data.csv", bytes);
      const adapter = new CapacitorVaultAdapter("vault");
      expect(await adapter.readTextFile("Data.csv")).toBe(`id;name\r\n1;Gr${REPLACEMENT_CHARACTER}n\r\n`);
      expect([...await adapter.readBinaryFile("Data.csv")]).toEqual([...bytes]);
      const read = await readLocalText(adapter, "Data.csv");
      expect(read.exact).toBe(false);
      expect(read.sha256).toBe(await sha256([...bytes]));
      await expect(readExactText(adapter, "Data.csv")).rejects.toBeInstanceOf(NotTextFileError);
    });

    it("answers for a file that is not there with the shared error", async () => {
      fakeAppStorage(system);
      const adapter = new CapacitorVaultAdapter("vault");
      await expect(adapter.readTextFile("gone.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
      await expect(adapter.readBinaryFile("gone.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
    });
  });
}

describe("the app's own storage in the browser build", () => {
  // The dev server and the production bundle under test. Its store holds a
  // file as what it was given and hands that back whatever is asked for, so
  // there is no reading bytes of a text file there: the text IS the file.
  const MARK = String.fromCharCode(0xfeff);

  it("hands a text file out as the text it was given, mark and all, and never takes it for base64", async () => {
    fakeAppStorage("web");
    const adapter = new CapacitorVaultAdapter("vault");
    for (const [path, text] of [["Note.md", `${MARK}one\r\ntwo\r\n`], ["Word.md", "text"], ["Empty.md", ""]]) {
      await adapter.writeTextFile(path, text);
      // "text" is valid base64: decoded as bytes it would come back as two other characters.
      expect(await adapter.readTextFile(path), path).toBe(text);
    }
  });

  it("decodes a file a fixture laid down as bytes the way a phone does", async () => {
    const { files } = fakeAppStorage("web");
    files.set("vault/Note.md", new Blob([marked("one\r\n")]));
    const adapter = new CapacitorVaultAdapter("vault");
    expect(await adapter.readTextFile("Note.md")).toBe(`${MARK}one\r\n`);
    expect([...await adapter.readBinaryFile("Note.md")]).toEqual([...MARK_BYTES, ...utf8("one\r\n")]);
  });
});

/**
 * The same file on its way between a phone and another device.
 *
 * The real core on both sides — the adapter chain a shell builds, the index
 * with the shells' hooks, queue, engine, worker, the WebDAV target, SQLite —
 * against a byte-exact in-memory WebDAV server. The other device keeps its
 * vault in a folder on disk; the phone keeps its in the fake container, behind
 * THIS adapter. The assertions read bytes: in the container, on the server and
 * on the other device's disk.
 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

const deviceLocal = (path: string) => path.startsWith(".plainva") || path.includes(".CONFLICT");

/** One device's side of a sync, as both shells put it together. */
function device(raw: IVaultAdapter, db: IDatabaseAdapter, dav: ByteExactDav, name: string) {
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db, raw, name);
  const files = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo, undefined, repo, "cloud");
  // The shells' hooks queue without waiting; here one after the other, on the one connection this database has.
  let queued: Promise<unknown> = Promise.resolve();
  const later = (work: () => Promise<unknown>) => { queued = queued.then(work); };
  const ownDeletions = new OwnDeletionRegister();
  /** Every file the index took for changed by someone else. */
  const foreign: string[] = [];
  const indexer = new VaultIndexer(files, db, {
    isOwnWrite: (path, sha) => files.wasWrittenByUs(path, sha),
    onExternalModification: (path) => { foreign.push(path); if (!deviceLocal(path)) later(() => queue.queueWrite(path)); },
    onNewLocalFile: (path) => { if (!deviceLocal(path)) later(() => queue.queueWrite(path)); },
    onLocalFileDeleted: (path) => { if (!ownDeletions.consume(path) && !deviceLocal(path)) later(() => queue.queueDelete(path)); },
  });
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch);
  target.allowRootCreation = false;
  const worker = new SyncWorker(new SyncEngine(queue, target, files, repo), target, repo, backup, queue, 60_000, { ownDeletions });
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  const problems: string[] = [];
  worker.onStatusChange = (state, message) => { if (state !== "syncing" && state !== "idle") problems.push(`${state}: ${message ?? ""}`); };
  const pulled: string[] = [];
  worker.onFilesChanged = (paths) => void pulled.push(...paths);
  return {
    files, foreign, problems,
    /** A pass that reads this one file again whatever its time says, as a rebuilt index does. */
    async reread(path: string) { await indexer.indexFile(await raw.getFileInfo(path)); await queued; },
    /** What a shell does: the index's pass, a sync cycle, the index told what the cycle wrote. */
    async cycle() {
      await indexer.indexVaultFull();
      await queued;
      await worker.runCycle();
      for (const path of pulled.splice(0)) await indexer.indexPath(path);
      await queued;
    },
    row: (path: string) => db.queryOne<{ local_sha256: string | null; base_sha256: string | null }>("SELECT local_sha256, base_sha256 FROM sync_state WHERE path = ?", [path]),
  };
}

/** The other device: a vault in a folder on disk. */
async function otherDevice(dav: ByteExactDav) {
  const root = await mkdtemp(join(tmpdir(), "plainva-mark-other-"));
  const db = await realSqlite();
  closers.push(async () => { await db.close(); await rm(root, { recursive: true, force: true }); });
  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  return {
    ...device(raw, db, dav, "other"),
    /** Another program writes the file: exactly these bytes. */
    put: (file: string, bytes: number[]) => writeFile(join(root, file), new Uint8Array(bytes)),
    bytes: async (file: string) => [...await readFile(join(root, file))],
  };
}

/** The phone over its container, with the adapter a build ships. */
async function phoneOver(Adapter: new (root: string) => CapacitorVaultAdapter, db: IDatabaseAdapter, dav: ByteExactDav) {
  const raw = new Adapter("vault");
  await raw.initialize();
  return device(raw, db, dav, "phone");
}

/** A checkbox ticked from a list: a change of a place in a file, through the chain's one entry for that. */
const tick = (files: ConflictAwareVaultAdapter, file: string) =>
  updateVaultText(files, file, (text) => editInShape(text, (lines) => lines.replace("- [ ] first", "- [x] first")));

function world() {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const dav = byteExactDav();
  return {
    dav,
    remoteBytes: (file: string) => [...dav.files.get(file)!.bytes],
    uploads: (file: string) => dav.log.filter((line) => line === `PUT ${file}`).length,
  };
}

const NOTE = [...MARK_BYTES, ...utf8("- [ ] first\r\n- [ ] second\r\n")];
const TICKED = [...MARK_BYTES, ...utf8("- [x] first\r\n- [ ] second\r\n")];
const PLAN = [...MARK_BYTES, ...utf8("# Plan\r\n")];
const PUT_BACK = [...MARK_BYTES, ...utf8("# Plan, put back\r\n")];

for (const system of ["ios", "android"] as const) {
  describe(`a note with a byte order mark between ${system === "ios" ? "an iPhone" : "an Android phone"} and another device`, () => {
    it("is changed on the phone and keeps its mark: there, on the server and on the other device", async () => {
      const { dav, remoteBytes, uploads } = world();
      const other = await otherDevice(dav);
      await other.put("Tasks.md", NOTE);
      await other.put("Keep.md", utf8("keep\n"));
      await other.cycle();

      fakeAppStorage(system);
      const db = await realSqlite();
      closers.push(() => db.close());
      const phone = await phoneOver(CapacitorVaultAdapter, db, dav);
      await phone.cycle();
      await phone.cycle();
      // The pull laid the file down with its mark, and what the phone keeps of
      // it names that file: the marker is the hash of its bytes, like the base
      // the sync recorded. Read through the system's text on an iPhone, the
      // marker was the hash of three bytes fewer.
      expect(appStorageBytes("vault/Tasks.md")).toEqual(NOTE);
      expect(await phone.row("Tasks.md")).toEqual({ local_sha256: await sha256(NOTE), base_sha256: await sha256(NOTE) });

      await tick(phone.files, "Tasks.md");
      await phone.cycle();
      await other.cycle();
      await phone.cycle();
      // On an iPhone the write went out without the mark, and so did the
      // upload: the mark was gone on the server and on the other device too.
      expect(appStorageBytes("vault/Tasks.md")).toEqual(TICKED);
      expect(remoteBytes("Tasks.md")).toEqual(TICKED);
      expect(await other.bytes("Tasks.md")).toEqual(TICKED);
      // Two uploads: the note from the other device, its change from the phone.
      expect(uploads("Tasks.md")).toBe(2);
      expect(await phone.files.listConflictSessions()).toEqual([]);
      expect([...phone.problems, ...other.problems]).toEqual([]);
    });
  });
}

describe("an iPhone that pulled a note with a byte order mark with an older build", () => {
  /** The adapter as it read until 2026-10-20: the text the system made of the file. */
  class SystemText extends CapacitorVaultAdapter {
    override async readTextFile(file: string): Promise<string> {
      return (await capacitorFilesystem.Filesystem.readFile({ path: `vault/${file}`, encoding: "utf8" })).data as string;
    }
  }

  it("writes it beside an editor without a conflict copy, takes nothing for changed elsewhere, and keeps the mark everywhere", async () => {
    const { dav, remoteBytes, uploads } = world();
    const other = await otherDevice(dav);
    await other.put("Tasks.md", NOTE);
    await other.put("Plan.md", PLAN);
    await other.put("Note.md", [...MARK_BYTES, ...utf8("# Note\r\n")]);
    await other.cycle();

    fakeAppStorage("ios");
    const db = await realSqlite();
    closers.push(() => db.close());
    const before = await phoneOver(SystemText, db, dav);
    await before.cycle();
    await before.cycle();
    // What that build left behind: the file with its mark, the base the sync
    // recorded for it — and a marker that is the hash of its text WITHOUT the
    // mark, because that is the text the index was handed.
    expect(appStorageBytes("vault/Tasks.md")).toEqual(NOTE);
    expect(await before.row("Tasks.md")).toEqual({ local_sha256: await sha256(NOTE.slice(3)), base_sha256: await sha256(NOTE) });

    // This build, over the same container and the same database.
    const phone = await phoneOver(CapacitorVaultAdapter, db, dav);
    await phone.cycle();

    // A checkbox ticked from a list starts from the file as it lies there and
    // asks no marker (`updateVaultText`).
    await tick(phone.files, "Tasks.md");
    expect(appStorageBytes("vault/Tasks.md")).toEqual(TICKED);

    // A whole text written over a file — a version put back from the history,
    // a view that holds the text it loaded — is compared with the marker on
    // record. That one does not match what is read now, and the base on
    // record carries the mark, so it does not hash to the marker either: taken
    // for a change from elsewhere, the write found nothing to merge against
    // and ended as a conflict copy, the file left as it was.
    await phone.files.writeTextFile("Plan.md", (await phone.files.readTextFile("Plan.md")).replace("# Plan", "# Plan, put back"));
    expect(appStorageBytes("vault/Plan.md")).toEqual(PUT_BACK);
    expect(await phone.files.listConflictSessions()).toEqual([]);

    // Nor does a pass that reads a file again whatever its time says, as a
    // rebuilt index does, announce a note as changed elsewhere.
    await phone.reread("Note.md");
    expect(phone.foreign).toEqual([]);

    await phone.cycle();
    await other.cycle();
    await phone.cycle();
    expect(remoteBytes("Tasks.md")).toEqual(TICKED);
    expect(await other.bytes("Tasks.md")).toEqual(TICKED);
    expect(remoteBytes("Plan.md")).toEqual(PUT_BACK);
    expect(await other.bytes("Plan.md")).toEqual(PUT_BACK);
    expect(uploads("Tasks.md")).toBe(2);
    expect(uploads("Plan.md")).toBe(2);
    // The writes put the markers right: they name the files again.
    expect(await phone.row("Tasks.md")).toEqual({ local_sha256: await sha256(TICKED), base_sha256: await sha256(TICKED) });
    expect(await phone.row("Plan.md")).toEqual({ local_sha256: await sha256(PUT_BACK), base_sha256: await sha256(PUT_BACK) });
    expect([...phone.problems, ...other.problems]).toEqual([]);
  });
});
