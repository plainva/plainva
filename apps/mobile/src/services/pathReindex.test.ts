import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  BackupVaultAdapter,
  ConflictAwareVaultAdapter,
  OwnDeletionRegister,
  QueueingVaultAdapter,
  SyncEngine,
  SyncQueue,
  SyncStateRepository,
  SyncWorker,
  VaultFileNotFoundError,
  VaultIndexer,
  WebDavSyncTarget,
  type VaultFileInfo,
} from "@plainva/core";
import { serializeBaseConfig } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { byteExactDav, type ByteExactDav } from "../../../../packages/core/test/helpers/byteExactDav";

/**
 * The phone's index follows every file somebody wrote or removed (finding
 * 2026-10-09).
 *
 * The phone has no watcher: between two full scans its index knows what the
 * app tells it. It was told about notes only. A settings file or a database a
 * pull brought for the first time had a sync row and no index entry; the next
 * full scan — every return to the app runs one — took that row for the
 * leftover of a deleted file and wrote the file's current text over its merge
 * base. Changed on the phone in between and on another device as well, the
 * phone's change was gone at the next sync, without a conflict copy.
 *
 * These tests run the phone's own pieces — `createPathReindexer` and the
 * turns the vault service hands its hooks, the database savers of `baseOps` —
 * in the chain `boot()` builds (raw → snapshots → sync queue → conflict-aware,
 * the index with the phone's hooks, a worker wired as `syncService` wires
 * it), over real files, a real SQLite and a byte-exact WebDAV server. Replaced
 * are the native plugins: a folder on disk stands in for the app's container,
 * `node:sqlite` for the SQLite plugin — one connection, and like the plugin it
 * refuses a second transaction while one is open. The wiring itself is pinned
 * at the end, from the sources.
 *
 * What this stand-in leaves out, so that nobody reads more into a green run:
 * the hooks' two switches (`syncEnqueueEnabled`, `deferInitialEnqueue` — both
 * on their "running" side here), the branch of an encrypted workspace, the
 * events the screens listen to, and the storage plugin's own errors (only the
 * contract "FILE_NOT_FOUND means gone" is held, in the door's own tests). And
 * the index is told once a sync cycle is through; the app hands the batches
 * over while the cycle still runs. What a pass does when it meets another
 * writer on the one connection is tested at the door itself, further down.
 */

vi.mock("./vaultService", () => ({ vaultOps: {}, noteSaver: {} }));
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => ({}) }));
vi.mock("./syncService", () => ({ syncSoon: () => {} }));
vi.mock("./vaultRegistry", () => ({ getActiveVaultEntry: async () => ({ name: "Vault" }) }));
vi.mock("./templateInteractive", () => ({ answerTemplateFile: vi.fn(), buildNewNoteFromTemplate: vi.fn() }));

import { createDatabase, saveBaseConfig } from "./baseOps";
import { createAnnouncer, createIndexTurns, createPathReindexer } from "./pathReindex";
import type { MobileVault } from "./vaultService";

// Built at run time: the mark is never typed into this file.
const MARK = String.fromCharCode(0xfeff);
const MARK_BYTES = [0xef, 0xbb, 0xbf];
const utf8 = (text: string) => [...new TextEncoder().encode(text)];

const closers: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  // `createDatabase` announces the new file to the screens.
  vi.stubGlobal("window", new EventTarget());
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  while (closers.length > 0) await closers.pop()!();
});

/** vaultService.ts: what never leaves this device. */
const isInternal = (p: string) => p.startsWith(".plainva") || p.includes(".CONFLICT");

async function folder(prefix: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const db = await realSqlite();
  closers.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  const file = (p: string) => path.join(root, p);
  return {
    root, db, raw,
    /** Another program writes the file: exactly these bytes, past the app. */
    async put(p: string, text: string) {
      await fs.mkdir(path.dirname(file(p)), { recursive: true });
      await fs.writeFile(file(p), text, "utf8");
    },
    async bytes(p: string) { return [...await fs.readFile(file(p))]; },
    async text(p: string) { return fs.readFile(file(p), "utf8"); },
    /** Every file of the vault, the app's own folders left out. */
    async onDisk() {
      const all = await fs.readdir(root, { recursive: true, withFileTypes: true });
      return all
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).replace(/\\/g, "/"))
        .filter((p) => !p.startsWith("."))
        .sort();
    },
  };
}

/** The phone, as `boot()` and `startWorker()` put it together. */
async function phone(dav: ByteExactDav) {
  const disk = await folder("plainva-phone-index-");
  const { db, raw } = disk;
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const syncRepo = new SyncStateRepository(db, raw, "phone");
  const files = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), syncRepo, undefined, syncRepo, "cloud");
  let ownDeletions = new OwnDeletionRegister();
  const turns = createIndexTurns();
  let leftBehind = 0;
  let followedLate = 0;
  let dropped = 0;
  /** Every path the index reported as gone, in the order it said so. */
  const gone: string[] = [];
  /** What the hooks set off without waiting, so that a test can wait for it. */
  const setOff: Promise<void>[] = [];
  // vaultService.ts: the hooks queue through the announcer, which takes the door's turns for each attempt.
  const announce = createAnnouncer(turns, { whenIdle: () => indexer.whenIdle(), retryDelayMs: 0, onDropped: () => { dropped += 1; } });
  const stillGone = (p: string) => () => raw.exists(p).then((there) => !there);
  const enqueueLocal = (p: string) => {
    if (!isInternal(p)) setOff.push(announce(() => queue.queueWrite(p)));
  };
  const indexer: VaultIndexer = new VaultIndexer(files, db, {
    isOwnWrite: (p, sha256) => files.wasWrittenByUs(p, sha256),
    onExternalModification: (p) => enqueueLocal(p),
    onNewLocalFile: (p) => enqueueLocal(p),
    onLocalFileDeleted: (p, row) => {
      gone.push(p);
      if (ownDeletions.consume(p, row)) return;
      if (!isInternal(p)) setOff.push(announce(() => queue.queueDelete(p), stillGone(p)));
    },
  });
  const reindexPaths = createPathReindexer(indexer, raw, {
    turns,
    retryDelayMs: 0,
    onLeftBehind: (count) => { leftBehind += count; },
    onFollowedLate: () => { followedLate += 1; },
  });
  const vault = { vaultId: "phone", adapter: raw, files, backup, db, indexer, queryService: null, syncQueue: queue, syncRepo, reindexPaths } as unknown as MobileVault;

  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch);
  target.allowRootCreation = false;
  const engine = new SyncEngine(queue, target, files, syncRepo);
  const worker = new SyncWorker(engine, target, syncRepo, backup, queue, 60_000, {
    downloadConcurrency: 2,
    downloadBufferBytes: 8 * 1024 * 1024,
    ownDeletions,
  });
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  const failures: string[] = [];
  worker.onStatusChange = (status, message) => { if (status === "error" || status === "retrying") failures.push(`${status}: ${message ?? ""}`); };
  /** What the worker handed over, batch by batch. */
  const handed: string[][] = [];
  worker.onFilesChanged = (paths) => void handed.push([...paths]);
  /** Everything the hooks set off so far is queued or given up. */
  const settle = async () => { while (setOff.length > 0) await Promise.all(setOff.splice(0)); };
  const failed = () => { if (failures.length > 0) throw new Error(`the sync cycle failed: ${failures.join("; ")}`); };
  return {
    ...disk, vault, files, queue, syncRepo, indexer, reindexPaths, gone, failures,
    get leftBehind() { return leftBehind; },
    /** How often the door told the screens of a path it followed at its second attempt only. */
    get followedLate() { return followedLate; },
    /** Queue entries the index announced that could not be made at either attempt. */
    get dropped() { return dropped; },
    /** A sync cycle, and the index told what it wrote (`w.onFilesChanged` in syncService). */
    async cycle() {
      await worker.runCycle();
      for (const batch of handed.splice(0)) await reindexPaths(batch);
      await settle();
      failed();
    },
    /** A sync cycle whose batches are handed back instead of to the index: the caller says when the index hears of them. */
    async pull(): Promise<string[]> {
      await worker.runCycle();
      await settle();
      failed();
      return handed.splice(0).flat();
    },
    /** Resolves once the index's next single-path call has come back, either way. */
    attempted(method: "indexFile" | "indexPath"): Promise<void> {
      return new Promise<void>((resolve) => {
        const calls = indexer as unknown as Record<string, (argument: unknown) => Promise<unknown>>;
        const real = calls[method].bind(indexer);
        calls[method] = (argument) => {
          calls[method] = real;
          return real(argument).finally(resolve);
        };
      });
    },
    /** A return to the app: the vault is read again (`rereadVaultOnResume`). */
    async resume() {
      await indexer.indexVaultFull("return to the app");
      await settle();
    },
    /**
     * A return to the app with something else going on beside the re-read
     * (`onAppForeground` starts the sync in the same moment): `meanwhile` runs
     * once the scan has read the index and before it lists the vault.
     */
    async resumeWhile(meanwhile: () => Promise<void>) {
      const list = files.listDirReport.bind(files);
      files.listDirReport = async (...args) => {
        files.listDirReport = list;
        await meanwhile();
        return list(...args);
      };
      await indexer.indexVaultFull("return to the app");
      await settle();
    },
    /** `work` runs once inside the next index pass: before the file it reads as its `nth` is read. */
    whenTheIndexReadsItsNth(nth: number, work: () => Promise<void>) {
      const read = files.readTextFile.bind(files);
      let count = 0;
      files.readTextFile = async (p) => {
        if (++count === nth) await work();
        return read(p);
      };
    },
    /** The app was closed and opened: what lived in memory is gone, and the vault is read again. */
    async restart() {
      ownDeletions = new OwnDeletionRegister();
      await indexer.indexVaultFull("open");
      await settle();
    },
    settle,
    async row(p: string) { return db.queryOne<{ path: string; mode: string }>("SELECT path, mode FROM files WHERE path = ?", [p]); },
    async queued() { return db.query<{ operation: string; file_path: string }>("SELECT operation, file_path FROM offline_queue ORDER BY id"); },
  };
}

/** Another device: the core as a desktop wires it — the watcher's pass, the cycle, the index told path by path. */
async function otherDevice(dav: ByteExactDav) {
  const disk = await folder("plainva-other-device-");
  const { db, raw } = disk;
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
  let queued: Promise<unknown> = Promise.resolve();
  const later = (work: () => Promise<unknown>) => { queued = queued.then(work); };
  const indexer = new VaultIndexer(raw, db, {
    onExternalModification: (p) => later(() => queue.queueWrite(p)),
    onNewLocalFile: (p) => later(() => queue.queueWrite(p)),
    onLocalFileDeleted: (p) => later(() => queue.queueDelete(p)),
  });
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch);
  target.allowRootCreation = false;
  const worker = new SyncWorker(new SyncEngine(queue, target, app, repo), target, repo, backup, queue, 60_000);
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  const pulled: string[] = [];
  worker.onFilesChanged = (paths) => void pulled.push(...paths);
  return {
    ...disk,
    async cycle() {
      await indexer.indexVaultFull();
      await queued;
      await worker.runCycle();
      for (const p of pulled.splice(0)) await indexer.indexPath(p);
      await queued;
    },
  };
}

function world() {
  const dav = byteExactDav();
  return {
    dav,
    remote: (p: string) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(dav.files.get(p)!.bytes),
    remoteBytes: (p: string) => [...dav.files.get(p)!.bytes],
  };
}

describe("a file a pull brings for the first time is known to the index right away", () => {
  it("whatever kind of file it is: a settings file, a database, a table, an image, a note", async () => {
    const w = world();
    const other = await otherDevice(w.dav), here = await phone(w.dav);
    await other.put("Start.md", "# Start\n");
    await other.cycle();
    await here.cycle();

    await other.put("Settings.ini", `${MARK}[view]\r\nzoom=1\r\n`);
    await other.put("Projects/Plan.base", serializeBaseConfig({ views: [{ type: "table", name: "All" }] }));
    await other.put("Projects/Data.csv", "id;name\n1;Ada\n");
    await other.raw.writeBinaryFile("Projects/shot.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
    await other.put("Projects/Brief.md", "# Brief\n");
    await other.cycle();
    const uploads = () => w.dav.log.filter((line) => line.startsWith("PUT ")).length;
    const uploadedByTheOther = uploads();
    await here.cycle();

    // Only the note used to be here; the rest waited for the next full scan.
    expect.soft((await here.row("Settings.ini"))?.mode).toBe("attachment");
    expect.soft((await here.row("Projects/Plan.base"))?.mode).toBe("attachment");
    expect.soft((await here.row("Projects/Data.csv"))?.mode).toBe("attachment");
    expect.soft((await here.row("Projects/shot.png"))?.mode).toBe("attachment");
    expect.soft((await here.row("Projects/Brief.md"))?.mode).toBe("obsidian");
    expect.soft(here.leftBehind).toBe(0);
    // The file arrived as it left: the mark and the line ends of the settings file.
    expect(await here.bytes("Settings.ini")).toEqual([...MARK_BYTES, ...utf8("[view]\r\nzoom=1\r\n")]);
    // What a pull brought is in sync; announcing it to the index uploads nothing.
    await here.cycle();
    expect(await here.queued()).toEqual([]);
    expect(uploads()).toBe(uploadedByTheOther);
  });
});

describe("changed on the phone and on another device before the phone could upload", () => {
  const start = `${MARK}[view]\r\nzoom=1\r\ntheme=light\r\nfont=serif\r\nwrap=on\r\nlines=off\r\n`;
  const onPhone = `${MARK}[view]\r\nzoom=2\r\ntheme=light\r\nfont=serif\r\nwrap=on\r\nlines=off\r\n`;
  const elsewhere = `${MARK}[view]\r\nzoom=1\r\ntheme=light\r\nfont=serif\r\nwrap=on\r\nlines=on\r\n`;
  const both = `${MARK}[view]\r\nzoom=2\r\ntheme=light\r\nfont=serif\r\nwrap=on\r\nlines=on\r\n`;

  it("a settings file pulled for the first time keeps both changes, on both devices and on the server", async () => {
    const w = world();
    const other = await otherDevice(w.dav), here = await phone(w.dav);
    await other.put("Settings.ini", start);
    await other.cycle();
    // The phone pulls the file for the first time.
    await here.cycle();
    expect.soft((await here.row("Settings.ini"))?.mode).toBe("attachment");

    // The other device changes the last line and uploads.
    await other.put("Settings.ini", elsewhere);
    await other.cycle();
    // On the phone the editor saves a change to the second line (what `noteSaver` does:
    // the write with the editor's ancestry, then the index is told) — not uploaded yet.
    await here.files.writeEditorText("Settings.ini", onPhone, start);
    await here.reindexPaths(["Settings.ini"]);
    // The phone goes to the background and comes back: the vault is read again.
    // This pass took the file for new and made the changed text its merge base.
    await here.resume();
    expect.soft((await here.syncRepo.getSyncState("Settings.ini"))?.base_text).toBe(start);

    await here.cycle();
    // It used to end with the other device's version alone — the phone's change
    // gone, and no conflict copy to show for it.
    const merged = [...MARK_BYTES, ...utf8(both.slice(1))];
    expect(await here.bytes("Settings.ini")).toEqual(merged);
    expect(w.remoteBytes("Settings.ini")).toEqual(merged);
    await other.cycle();
    expect(await other.bytes("Settings.ini")).toEqual(merged);
    expect(await here.onDisk()).toEqual(["Settings.ini"]);
    expect(await other.onDisk()).toEqual(["Settings.ini"]);
    expect(here.leftBehind).toBe(0);
  });

  it("a database pulled for the first time keeps a view renamed on the phone and one renamed elsewhere", async () => {
    const views = (first: string, last: string) => ({
      views: [
        { type: "table", name: first, order: ["file.name", "status", "due", "owner"] },
        { type: "table", name: "Open", order: ["file.name", "status"] },
        { type: "table", name: last, order: ["file.name", "due"] },
      ],
    });
    const w = world();
    const other = await otherDevice(w.dav), here = await phone(w.dav);
    await other.put("Projects/Plan.base", serializeBaseConfig(views("All", "Done")));
    await other.cycle();
    await here.cycle();
    expect.soft((await here.row("Projects/Plan.base"))?.mode).toBe("attachment");

    await other.put("Projects/Plan.base", serializeBaseConfig(views("All", "Finished")));
    await other.cycle();
    // The phone's own saver of a database (baseOps.saveBaseConfig).
    await saveBaseConfig(here.vault, "Projects/Plan.base", views("Everything", "Done"));
    await here.resume();
    await here.cycle();

    const merged = serializeBaseConfig(views("Everything", "Finished"));
    expect(await here.text("Projects/Plan.base")).toBe(merged);
    expect(w.remote("Projects/Plan.base")).toBe(merged);
    await other.cycle();
    expect(await other.text("Projects/Plan.base")).toBe(merged);
    expect(await here.onDisk()).toEqual(["Projects/Plan.base"]);
    expect(await other.onDisk()).toEqual(["Projects/Plan.base"]);
  });

  it("a file the index never heard of — the app was closed right after the pull — keeps both changes as well", async () => {
    const w = world();
    const other = await otherDevice(w.dav), here = await phone(w.dav);
    await other.put("Settings.ini", start);
    await other.cycle();
    // Pulled for the first time, and the app is closed before the batch reaches
    // the index: the file has its sync row and no index entry. Nothing the phone
    // does about telling the index can help here — the row has to be read right.
    await here.pull();
    expect.soft(await here.row("Settings.ini")).toBeNull();

    await other.put("Settings.ini", elsewhere);
    await other.cycle();
    // Opened again. A warm start reads the vault in the background, and the file
    // is changed on the phone before that pass is through: whichever pass sees the
    // file first — the save's or the scan's — finds a row without an entry.
    await here.files.writeEditorText("Settings.ini", onPhone, start);
    await here.reindexPaths(["Settings.ini"]);
    await here.restart();
    expect.soft((await here.syncRepo.getSyncState("Settings.ini"))?.base_text).toBe(start);

    await here.cycle();
    const merged = [...MARK_BYTES, ...utf8(both.slice(1))];
    expect(await here.bytes("Settings.ini")).toEqual(merged);
    expect(w.remoteBytes("Settings.ini")).toEqual(merged);
    await other.cycle();
    expect(await other.bytes("Settings.ini")).toEqual(merged);
    expect(await here.onDisk()).toEqual(["Settings.ini"]);
  });
});

describe("what the phone writes itself reaches the index, whatever kind of file it is", () => {
  it("a database created on the phone is known at once, and its later saves keep the merge base of the last upload", async () => {
    const w = world();
    const here = await phone(w.dav);
    await here.cycle();
    const created = await createDatabase(here.vault, "Projects", "Tasks", "Table");
    expect(created).toBe("Projects/Tasks.base");
    // The call that stood in `createDatabase` took notes only: the database was
    // on disk and in the upload queue, and the index had never heard of it.
    expect.soft((await here.row("Projects/Tasks.base"))?.mode).toBe("attachment");
    await here.settle();
    await here.cycle();
    const uploaded = w.remote("Projects/Tasks.base");
    expect(uploaded).toBe(await here.text("Projects/Tasks.base"));

    // A view is added on the phone and not uploaded yet; then the phone comes back from the background.
    await saveBaseConfig(here.vault, "Projects/Tasks.base", { views: [{ type: "table", name: "Table", order: ["file.name"] }, { type: "table", name: "Second" }] });
    await here.resume();
    expect((await here.syncRepo.getSyncState("Projects/Tasks.base"))?.base_text).toBe(uploaded);
  });

  it("a file the editor saves for the first time on this device gets its row with the save", async () => {
    const w = world();
    const here = await phone(w.dav);
    // In the vault since before this build, never seen by an index pass.
    await here.put("notes.txt", "one\ntwo\n");
    await here.files.writeEditorText("notes.txt", "one\ntwo!\n", "one\ntwo\n");
    await here.reindexPaths(["notes.txt"]);
    expect((await here.row("notes.txt"))?.mode).toBe("attachment");
  });
});

describe("a file a pull removed leaves the index with the pull", () => {
  it("is gone from the index at once, whatever kind of file it was, and reported once", async () => {
    const w = world();
    const other = await otherDevice(w.dav), here = await phone(w.dav);
    for (const name of ["Keep.md", "Old.md", "Old.ini", "Other.csv"]) await other.put(name, `${name}\n`);
    await other.cycle();
    await here.cycle();
    expect.soft(await here.row("Old.ini")).not.toBeNull();
    expect.soft(await here.row("Old.md")).not.toBeNull();

    // Deleted on another device.
    w.dav.files.delete("Old.md");
    w.dav.files.delete("Old.ini");
    await here.cycle();
    expect(await here.onDisk()).toEqual(["Keep.md", "Other.csv"]);
    // The rows used to stay — in search and in every list drawn from the index —
    // because a file that is gone could not be read.
    expect.soft(await here.row("Old.md")).toBeNull();
    expect.soft(await here.row("Old.ini")).toBeNull();
    expect.soft([...here.gone].sort()).toEqual(["Old.ini", "Old.md"]);
    // The worker removed them, and says so when the index asks: nothing is queued.
    expect(await here.queued()).toEqual([]);
    // The next return to the app has nothing left to report.
    await here.resume();
    expect([...here.gone].sort()).toEqual(["Old.ini", "Old.md"]);
    expect(await here.queued()).toEqual([]);
  });

  it("is reported once when the pull removes it while the vault is being read again", async () => {
    const w = world();
    const other = await otherDevice(w.dav), here = await phone(w.dav);
    for (const name of ["Keep.md", "Old.md", "Old.ini"]) await other.put(name, `${name}\n`);
    await other.cycle();
    await here.cycle();
    await here.cycle();
    expect(await here.queued()).toEqual([]);

    w.dav.files.delete("Old.md");
    w.dav.files.delete("Old.ini");
    // A return to the app starts both in the same moment: the vault is read again
    // and the sync runs (`onAppForeground`). The scan has read the index — both
    // files in it — when the pull removes them and tells the index.
    await here.resumeWhile(() => here.cycle());
    expect(await here.onDisk()).toEqual(["Keep.md"]);
    expect.soft([...here.gone].sort()).toEqual(["Old.ini", "Old.md"]);
    // The scan found them vanished too. Said a second time, the worker's "that
    // deletion was mine" was used up, and a remote deletion was queued for files
    // another device had deleted.
    expect(await here.queued()).toEqual([]);
  });

  it("is not reported from inside a full scan that fails afterwards: the removal waits for that scan", async () => {
    const w = world();
    const other = await otherDevice(w.dav), here = await phone(w.dav);
    for (const name of ["Keep.md", "Old.md"]) await other.put(name, `${name}\n`);
    await other.cycle();
    await here.cycle();
    await here.cycle();
    expect(await here.queued()).toEqual([]);

    // Deleted on another device, and pulled: the worker has removed the file and left its mark.
    w.dav.files.delete("Old.md");
    const pulled = await here.pull();
    expect(pulled).toContain("Old.md");
    // Two notes appear past the app, so the re-read that starts now has something to write…
    await here.put("n1.md", "n1\n");
    await here.put("n2.md", "n2\n");
    const told: { index?: Promise<void> } = {};
    // …and is inside its transaction when the index is told of the pull.
    here.whenTheIndexReadsItsNth(1, async () => {
      const refused = here.attempted("indexPath");
      told.index = here.reindexPaths(pulled);
      await refused;
    });
    // The second note's row cannot be written (a full disk): the scan fails and
    // is rolled back. (A note the scan cannot READ no longer fails it — it is
    // left out and named, issue #125.)
    const execute = here.db.execute.bind(here.db);
    here.db.execute = async (sql, params) => {
      if (Array.isArray(params) && params.includes("n2.md")) throw new Error("disk full");
      return execute(sql, params);
    };
    await expect(here.resume()).rejects.toThrow("disk full");
    here.db.execute = execute;
    await told.index;
    await here.settle();

    // The removal used to ride in the scan's transaction: reported there, the
    // worker's mark spent — and back in the index with the rollback.
    expect.soft(here.gone).toEqual(["Old.md"]);
    expect.soft(await here.row("Old.md")).toBeNull();
    expect.soft(here.leftBehind).toBe(0);
    // The screens were told of the pull long before; they are told once more.
    expect.soft(here.followedLate).toBe(1);
    // The next re-read then found the row without its file, asked a register
    // that had answered already, and queued a remote deletion.
    await here.resume();
    expect(here.gone).toEqual(["Old.md"]);
    expect((await here.queued()).filter((op) => op.operation === "delete")).toEqual([]);
  });

  it("and no remote deletion is queued for it after a restart", async () => {
    const w = world();
    const other = await otherDevice(w.dav), here = await phone(w.dav);
    for (const name of ["Keep.md", "Old.md", "Other.md"]) await other.put(name, `${name}\n`);
    await other.cycle();
    await here.cycle();
    // Let the uploads the first index pass announced go through (nothing is uploaded: all in sync).
    await here.cycle();
    expect(await here.queued()).toEqual([]);

    w.dav.files.delete("Old.md");
    await here.cycle();
    expect(await here.onDisk()).toEqual(["Keep.md", "Other.md"]);

    // The worker's "that deletion was mine" lives in memory. With the row still
    // in the index, the full scan of the next start reported the note vanished
    // to a register that knew nothing any more — and a remote deletion was
    // queued for a note another device had deleted already.
    await here.restart();
    expect(await here.queued()).toEqual([]);
  });
});

describe("one path at a time on the phone's one connection", () => {
  it("two batches handed over without waiting for one another both arrive", async () => {
    const w = world();
    const here = await phone(w.dav);
    const first = ["a.md", "b.ini", "c.md"], second = ["d.csv", "e.md", "f.base"];
    for (const name of [...first, ...second]) await here.put(name, `${name}\n`);
    const passes = vi.spyOn(here.indexer, "indexFile");
    // As the worker hands them over during a long pull: `void v.reindexPaths(paths)`, twice.
    const running = [here.reindexPaths(first), here.reindexPaths(second)];
    await Promise.all(running);
    await here.settle();
    for (const name of [...first, ...second]) expect.soft(await here.row(name), name).not.toBeNull();
    expect(here.leftBehind).toBe(0);
    // Each path at its first attempt: nobody was refused and had to come again.
    expect(passes).toHaveBeenCalledTimes(first.length + second.length);
  });

  it("every file one pass announces is queued, not only the first", async () => {
    const w = world();
    const here = await phone(w.dav);
    await here.cycle();
    // Three files appear in the vault past the app (the Files app, another program).
    for (const name of ["one.md", "two.ini", "three.md"]) await here.put(name, `${name}\n`);
    await here.resume();
    // Each hook opened a transaction of its own without waiting; the second ran into the first.
    expect((await here.queued()).map((op) => `${op.operation} ${op.file_path}`).sort()).toEqual(["write one.md", "write three.md", "write two.ini"]);
  });

  it("what a full scan found is announced even when a single path meets the scan", async () => {
    const w = world();
    const here = await phone(w.dav);
    await here.cycle();
    const names = ["n1.md", "n2.md", "n3.md", "n4.md", "n5.md", "n6.md", "n7.md", "n8.md"];
    // Notes that appear in the vault past the app (the Files app, another program).
    for (const name of names) await here.put(name, `${name}\n`);
    // Three notes into the re-read of the next return, the index is told of one of
    // them. That pass is refused at both attempts — the scan's transaction is open —
    // and does not wait for the scan.
    here.whenTheIndexReadsItsNth(4, () => here.reindexPaths(["n1.md"]));
    await here.resume();
    expect.soft(here.leftBehind).toBe(1);
    // The refused pass used to empty the scan's list on its way in: what the scan
    // had found until then was not announced, so not queued for upload.
    expect((await here.queued()).map((op) => `${op.operation} ${op.file_path}`).sort()).toEqual(names.map((name) => `write ${name}`));
  });

  it("an upload the index announces is tried again when its queue entry is refused", async () => {
    const w = world();
    const here = await phone(w.dav);
    await here.cycle();
    for (const name of ["one.md", "two.md"]) await here.put(name, `${name}\n`);
    // Somebody outside the turns has a transaction open when the first entry comes.
    const queueWrite = vi.spyOn(here.queue, "queueWrite").mockRejectedValueOnce(new Error("Already in transaction"));
    await here.resume();
    // It used to be let go at that, without a word: the file stayed on this device.
    expect((await here.queued()).map((op) => `${op.operation} ${op.file_path}`).sort()).toEqual(["write one.md", "write two.md"]);
    expect(queueWrite).toHaveBeenCalledTimes(3);
    expect(here.dropped).toBe(0);
  });

  it("…and counted when it cannot be queued at the second attempt either", async () => {
    const w = world();
    const here = await phone(w.dav);
    await here.cycle();
    for (const name of ["one.md", "two.md"]) await here.put(name, `${name}\n`);
    vi.spyOn(here.queue, "queueWrite")
      .mockRejectedValueOnce(new Error("Already in transaction"))
      .mockRejectedValueOnce(new Error("Already in transaction"));
    await here.resume();
    expect(await here.queued()).toHaveLength(1);
    expect(here.dropped).toBe(1);
  });
});

/** A database as the phone has it: every call crosses a bridge, and a second transaction is refused while one is open. */
function oneConnection() {
  let open = false;
  const trip = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    trip,
    async transaction<T>(work: () => Promise<T>): Promise<T> {
      await trip();
      if (open) throw new Error("Already in transaction");
      open = true;
      try {
        const result = await work();
        await trip();
        return result;
      } finally {
        open = false;
      }
    },
  };
}

const info = (p: string): VaultFileInfo => ({ path: p, name: p.slice(p.lastIndexOf("/") + 1), isDirectory: false, size: 1, mtime: 1 });

describe("the door itself", () => {
  it("a pass and the upload it announces do not meet: every path of a batch is indexed and queued", async () => {
    // The hook queues after the pass committed and without waiting (flushCallbacks);
    // the next path's pass used to start a round trip later, into the hook's open transaction.
    const connection = oneConnection();
    const turns = createIndexTurns();
    const indexed: string[] = [], queued: string[] = [];
    let leftBehind = 0;
    const announce = (p: string) => {
      void turns.take(() => connection.transaction(async () => { await connection.trip(); await connection.trip(); queued.push(p); })).catch(() => {});
    };
    const reindex = createPathReindexer({
      async indexFile(file) {
        await connection.transaction(async () => { await connection.trip(); await connection.trip(); indexed.push(file.path); });
        announce(file.path);
        return true;
      },
      async indexPath() { return "unchanged"; },
    }, { getFileInfo: async (p) => { await connection.trip(); return info(p); } }, { turns, retryDelayMs: 0, onLeftBehind: (count) => { leftBehind += count; } });

    await reindex(["a.ini", "b.ini", "c.ini", "d.ini"]);
    await turns.take(async () => {});
    expect(indexed).toEqual(["a.ini", "b.ini", "c.ini", "d.ini"]);
    expect(queued).toEqual(["a.ini", "b.ini", "c.ini", "d.ini"]);
    expect(leftBehind).toBe(0);
  });

  it("tries a path that could not be indexed once more, and counts what fails twice", async () => {
    const calls: string[] = [];
    const counts: number[] = [];
    let busy = true;
    const reindex = createPathReindexer({
      async indexFile(file) {
        calls.push(file.path);
        if (file.path === "busy.ini" && busy) { busy = false; throw new Error("Already in transaction"); }
        if (file.path === "broken.ini") throw new Error("unreadable");
        return true;
      },
      async indexPath() { return "unchanged"; },
    }, { getFileInfo: async (p) => info(p) }, { retryDelayMs: 0, onLeftBehind: (count) => counts.push(count) });

    await reindex(["a.md", "busy.ini", "broken.ini", "z.md"]);
    expect(calls).toEqual(["a.md", "busy.ini", "broken.ini", "z.md", "busy.ini", "broken.ini"]);
    expect(counts).toEqual([1]);
  });

  it("takes only 'it is not there' for gone: a read that failed concludes no deletion", async () => {
    const forgotten: string[] = [], indexed: string[] = [], counts: number[] = [];
    const reindex = createPathReindexer({
      async indexFile(file) { indexed.push(file.path); return true; },
      async indexPath(p) { forgotten.push(p); return "removed"; },
    }, {
      getFileInfo: async (p) => {
        if (p === "gone.ini") throw new VaultFileNotFoundError(p);
        if (p === "locked.ini") throw new Error("the storage did not answer");
        return info(p);
      },
    }, { retryDelayMs: 0, onLeftBehind: (count) => counts.push(count) });

    await reindex(["there.ini", "gone.ini", "locked.ini"]);
    expect(indexed).toEqual(["there.ini"]);
    expect(forgotten).toEqual(["gone.ini"]);
    expect(counts).toEqual([1]);
  });

  it("does nothing without an index, and never rejects", async () => {
    await expect(createPathReindexer(null, { getFileInfo: async () => { throw new Error("no storage"); } })(["a.md"])).resolves.toBeUndefined();
  });

  it("a removal that was refused waits for the full scan under way before it comes again", async () => {
    const order: string[] = [];
    const scan: { ends: () => void } = { ends: () => undefined };
    const through = new Promise<void>((resolve) => { scan.ends = resolve; });
    const refusals = { left: 1 };
    const reindex = createPathReindexer({
      async indexFile(file) { order.push(`indexed ${file.path}`); return true; },
      async indexPath(p) {
        if (refusals.left > 0) {
          refusals.left -= 1;
          order.push(`refused ${p}`);
          throw new Error("Already in transaction");
        }
        order.push(`removed ${p}`);
        return "removed";
      },
      async whenIdle() {
        order.push("waits for the scan");
        await through;
        order.push("the scan is through");
      },
    }, { getFileInfo: async (p) => { if (p === "gone.ini") throw new VaultFileNotFoundError(p); return info(p); } }, { retryDelayMs: 0 });

    const done = reindex(["gone.ini"]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["refused gone.ini", "waits for the scan"]);
    scan.ends();
    await done;
    expect(order).toEqual(["refused gone.ini", "waits for the scan", "the scan is through", "removed gone.ini"]);
  });

  it("a file that could not be indexed does not wait for a scan: a save must not hang on one", async () => {
    const seen = { asked: 0, busy: true };
    const reindex = createPathReindexer({
      async indexFile() {
        if (seen.busy) { seen.busy = false; throw new Error("Already in transaction"); }
        return true;
      },
      async indexPath() { return "unchanged"; },
      async whenIdle() { seen.asked += 1; },
    }, { getFileInfo: async (p) => info(p) }, { retryDelayMs: 0 });

    await reindex(["a.ini"]);
    expect(seen).toEqual({ asked: 0, busy: false });
  });

  it("says once when the second attempt changed the index, and not when it found nothing to do", async () => {
    const seen = { late: 0, left: 0, busy: true, refuse: true };
    const reindex = createPathReindexer({
      async indexFile(file) {
        if (file.path === "busy.ini" && seen.busy) { seen.busy = false; throw new Error("Already in transaction"); }
        if (file.path === "broken.ini") throw new Error("unreadable");
        return true;
      },
      // A path the index never held: refused while a transaction is open, and nothing to do once it is asked.
      async indexPath() {
        if (seen.refuse) { seen.refuse = false; throw new Error("Already in transaction"); }
        return "unchanged";
      },
    }, {
      getFileInfo: async (p) => { if (p === "never-indexed.tmp") throw new VaultFileNotFoundError(p); return info(p); },
    }, { retryDelayMs: 0, onFollowedLate: () => { seen.late += 1; }, onLeftBehind: (count) => { seen.left += count; } });

    await reindex(["a.md"]);
    expect(seen).toMatchObject({ late: 0, left: 0 });
    await reindex(["never-indexed.tmp"]);
    expect(seen).toMatchObject({ late: 0, left: 0, refuse: false });
    await reindex(["busy.ini", "broken.ini"]);
    expect(seen).toMatchObject({ late: 1, left: 1 });
  });

  it("says once that a call changed the index — for whoever plans on it — and not for a call that changed nothing", async () => {
    let followed = 0;
    const reindex = createPathReindexer({
      async indexFile() {
        return true;
      },
      async indexPath() {
        return "unchanged";
      },
    }, {
      getFileInfo: async (p) => { if (p === "never-indexed.tmp") throw new VaultFileNotFoundError(p); return info(p); },
    }, { retryDelayMs: 0, onFollowed: () => { followed += 1; } });

    // A saved note and the table beside it: one call, one word.
    await reindex(["a.md", "b.csv"]);
    expect(followed).toBe(1);
    // A path the index never held and still does not: nothing changed, nothing to plan on.
    await reindex(["never-indexed.tmp"]);
    expect(followed).toBe(1);
  });
});

describe("what a pass sets off", () => {
  /** A scan that is under way until the test says so. */
  function scanUnderWay() {
    const scan: { ends: () => void } = { ends: () => undefined };
    const through = new Promise<void>((resolve) => { scan.ends = resolve; });
    return { whenIdle: () => through, ends: () => scan.ends() };
  }
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  it("waits for the full scan under way before its second attempt, and nothing announced later overtakes it", async () => {
    const turns = createIndexTurns();
    const scan = scanUnderWay();
    const steps: string[] = [];
    const seen = { refuse: true, dropped: 0 };
    const announce = createAnnouncer(turns, { retryDelayMs: 0, whenIdle: scan.whenIdle, onDropped: () => { seen.dropped += 1; } });
    const first = announce(async () => {
      if (seen.refuse) { seen.refuse = false; steps.push("delete a.md refused"); throw new Error("Already in transaction"); }
      steps.push("delete a.md");
    });
    const second = announce(async () => { steps.push("write a.md"); });
    await tick();
    expect(steps).toEqual(["delete a.md refused"]);
    scan.ends();
    await Promise.all([first, second]);
    expect(steps).toEqual(["delete a.md refused", "delete a.md", "write a.md"]);
    expect(seen.dropped).toBe(0);
  });

  it("does not hold up the door while it waits: a path told to the index meanwhile is followed", async () => {
    const turns = createIndexTurns();
    const scan = scanUnderWay();
    const announce = createAnnouncer(turns, { retryDelayMs: 0, whenIdle: scan.whenIdle });
    const seen = { refuse: true };
    const waiting = announce(async () => {
      if (seen.refuse) { seen.refuse = false; throw new Error("Already in transaction"); }
    });
    await tick();
    const indexed: string[] = [];
    const reindex = createPathReindexer({
      async indexFile(file) { indexed.push(file.path); return true; },
      async indexPath() { return "unchanged"; },
    }, { getFileInfo: async (p) => info(p) }, { turns, retryDelayMs: 0 });
    // The entry stood in the door's own row while it waited: this call came back only when the scan was through.
    await reindex(["saved.md"]);
    expect(indexed).toEqual(["saved.md"]);
    scan.ends();
    await waiting;
  });

  it("counts what cannot be queued at the second attempt either", async () => {
    const turns = createIndexTurns();
    const seen = { attempts: 0, dropped: 0 };
    const announce = createAnnouncer(turns, { retryDelayMs: 0, onDropped: () => { seen.dropped += 1; } });
    await announce(async () => { seen.attempts += 1; throw new Error("Already in transaction"); });
    expect(seen).toEqual({ attempts: 2, dropped: 1 });
  });

  it("asks before each attempt whether the entry is still due: a file that is back is not queued for deletion", async () => {
    const turns = createIndexTurns();
    const seen = { attempts: 0, dropped: 0 };
    const announce = createAnnouncer(turns, { retryDelayMs: 0, onDropped: () => { seen.dropped += 1; } });
    // Due at first, refused, and no longer due when its second attempt comes: not a failure.
    const answers = [true, false];
    await announce(async () => { seen.attempts += 1; throw new Error("Already in transaction"); }, async () => answers.shift() ?? false);
    expect(seen).toEqual({ attempts: 1, dropped: 0 });
    // No longer due when its first attempt comes (it stood behind an entry that waited): not attempted.
    await announce(async () => { seen.attempts += 1; }, async () => false);
    expect(seen).toEqual({ attempts: 1, dropped: 0 });
    // What cannot be asked is still said.
    await announce(async () => { seen.attempts += 1; }, async () => { throw new Error("no storage"); });
    expect(seen).toEqual({ attempts: 2, dropped: 0 });
  });

  it("goes on with the next entry when the diagnostics themselves fail", async () => {
    const turns = createIndexTurns();
    const queued: string[] = [];
    const announce = createAnnouncer(turns, { retryDelayMs: 0, onDropped: () => { throw new Error("no log"); } });
    await expect(announce(async () => { throw new Error("Already in transaction"); })).resolves.toBeUndefined();
    await announce(async () => { queued.push("write a.md"); });
    expect(queued).toEqual(["write a.md"]);
  });
});

describe("the wiring: one door, and everything goes through it", () => {
  const SRC = path.resolve("src");
  const sources = (readdirSync(SRC, { recursive: true }) as string[])
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))
    .map((p) => [p, readFileSync(path.join(SRC, p), "utf8")] as const);
  const calling = (pattern: RegExp) => sources.filter(([p, text]) => p !== "services/pathReindex.ts" && pattern.test(text)).map(([p]) => p);
  const service = sources.find(([p]) => p === "services/vaultService.ts")![1];
  const sync = sources.find(([p]) => p === "services/syncService.ts")![1];

  it("the vault hands out the door, with the turns its hooks take", () => {
    expect(service).toContain("reindexPaths: createPathReindexer(indexer, adapter, {");
    expect(service).toContain("turns: indexTurns,");
    expect(service).toContain("const announce = createAnnouncer(indexTurns, {");
    expect(service).toContain("whenIdle: async () => { await indexer?.whenIdle(); },");
    expect(service).toContain("void announce(() => plain.queueWrite(path))");
    // A deletion that waited is asked whether the file is still gone.
    expect(service).toContain("void announce(() => plain.queueDelete(path), stillGone(path))");
    expect(service).toContain("const stillGone = (path: string) => () => adapter.exists(path).then((there) => !there);");
    // Nothing the index announces is queued past the announcer.
    expect(service).not.toMatch(/indexTurns\.take\(/);
    // What the door followed late is told to the screens once more.
    expect(service).toContain("onFollowedLate: () => window.dispatchEvent(new CustomEvent(\"m-vault-changed\")),");
    // A saved file sends no m-vault-changed: the search by meaning, the gists and Siri's list hear of it by this.
    expect(service).toContain("onFollowed: () => window.dispatchEvent(new CustomEvent(NOTE_INDEXED_EVENT)),");
  });

  it("both sync workers hand their changed paths to it", () => {
    expect(sync.match(/v\.reindexPaths\(paths\)/g)).toHaveLength(2);
  });

  it("the editor's saver tells it after every write", () => {
    const saver = service.slice(service.indexOf("export const noteSaver"));
    expect(saver).toContain("await vault.reindexPaths([result.session?.workingCopyPath ?? path])");
    expect(saver).toContain("await vaultOps.save(vault, path, applyTextShape(candidate, shape))");
  });

  it("no screen and no service follows a single path past it", () => {
    // `indexFile` took notes only for as long as the phone called it directly,
    // from twelve places — three of them only ever with a database.
    expect(calling(/\bindexFile\s*\(/)).toEqual([]);
    // The one look that is not a write: a note opened in an external folder
    // has its timestamp checked against the index (vaultOps.noteOpened).
    expect(calling(/\bindexPath\s*\(/)).toEqual(["services/vaultService.ts"]);
    expect(service.match(/\bindexPath\s*\(/g)).toHaveLength(1);
    // Beside the door stay the folder re-read, which looks at the disk itself,
    // and the app's own move and deletion, which change rows without reading a
    // file. Their callers are known by name, so that a new one is a decision.
    // (A full scan may be asked for from anywhere; it is not listed.)
    expect(calling(/\b(?:inspectPath|reconcileFolder|removePathFromIndex|relocatePathInIndex)\s*\(/).sort())
      .toEqual(["components/TaskNamesNotice.tsx", "services/vaultService.ts"]);
  });
});
