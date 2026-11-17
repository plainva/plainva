import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { initializeSchema } from "../src/db/Schema.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer, type VaultIndexerOptions } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { OwnDeletionRegister } from "../src/sync/ownDeletions.js";
import { indexedRowStamp, type IndexedRowStamp } from "../src/vault/indexedRowStamp.js";

/**
 * A row the index skips a file for is one its timestamp vouches for
 * (`VaultIndexer`, "confirmed timestamps").
 *
 * Every pass skips a file whose timestamp and size are what the index holds.
 * Another program that writes a note twice within one tick of the file
 * system's clock — FAT counts in 2 s, HFS+ and many shares in 1 s, exFAT in
 * 10 ms, NTFS by the system's 15.6 ms — leaves the second text under the
 * timestamp of the first; a read between the two writes indexed the first,
 * and no pass read the file again until its next change.
 *
 * Whether a read came within the tick is never told from this device's clock
 * against the file's timestamp: a share's clock runs ahead or behind. What
 * tells it is the time that passed on this device's own steady clock since
 * the file was seen under that timestamp. A row written sooner than a tick
 * after that is confirmed by one more reading once the tick is surely over;
 * the row carries the file's own timestamp all along, which the sync's
 * deletion check, the change time sent to a provider and `file.mtime` read.
 *
 * The file system here keeps fine timestamps, so the tests set the other
 * clocks' by hand (`utimes`), as such a file system would, and drive the
 * indexer's steady clock themselves (`monotonicNow`).
 */

let root: string;
let raw: LocalVaultAdapter;
let db: IDatabaseAdapter;
/** The indexer's steady clock, as the tests move it. */
let steady: number;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-racy-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
  steady = 1_000_000;
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

const indexerOver = (vault: LocalVaultAdapter = raw, options: VaultIndexerOptions = {}) =>
  new VaultIndexer(vault, db, { monotonicNow: () => steady, ...options });

/** Writes `text` and gives the file `mtime`, as a file system that keeps only that tick would. */
async function writeAt(file: string, text: string, mtime: number): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), text, "utf8");
  await fs.utimes(path.join(root, file), new Date(mtime), new Date(mtime));
}

/** The tick a clock that counts in `grain` milliseconds shows at `at`. */
const tickOf = (at: number, grain: number) => Math.floor(Math.floor(at / grain) * grain);

/** The vault, counting the reads of file contents. */
function counting(vault: LocalVaultAdapter) {
  const reads: string[] = [];
  const proxy = new Proxy(vault, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (key === "readBinaryFile" || key === "readTextFile") {
        return (...args: unknown[]) => { reads.push(String(args[0])); return (value as (...a: unknown[]) => unknown).apply(target, args); };
      }
      return value.bind(target);
    },
  });
  return { vault: proxy, reads };
}

const ROUTES = ["indexPath", "reconcileFolder", "indexVaultFull"] as const;

async function passOver(indexer: VaultIndexer, route: (typeof ROUTES)[number], file: string): Promise<unknown> {
  if (route === "indexPath") return indexer.indexPath(file);
  if (route === "reconcileFolder") return indexer.reconcileFolder("Folder");
  return indexer.indexVaultFull();
}

const found = async (word: string) => (await new VaultQueryService(db).searchFullText(word)).map((hit) => hit.path);
const rowOf = (file: string) => db.queryOne<{ mtime_local: number; size_bytes: number }>("SELECT mtime_local, size_bytes FROM files WHERE path = ?", [file]);

/**
 * The note is read under `stamp`, another program writes it again under the
 * same stamp and size, and once the tick is surely over on this device's
 * steady clock the next pass over `route` has the second text.
 */
async function secondWriteInTheTick(route: (typeof ROUTES)[number], stamp: number): Promise<void> {
  // Same length on purpose: the size cannot tell the two apart either.
  await writeAt("Folder/Note.md", "# Note\n\nalpha\n", stamp);
  const indexer = indexerOver();
  await passOver(indexer, route, "Folder/Note.md");
  expect(await found("alpha")).toEqual(["Folder/Note.md"]);
  await writeAt("Folder/Note.md", "# Note\n\nomega\n", stamp);
  steady += 10_000;
  await passOver(indexer, route, "Folder/Note.md");
  expect(await found("omega")).toEqual(["Folder/Note.md"]);
  expect(await found("alpha")).toEqual([]);
}

describe("a second write within one tick of the file's clock is found, whatever that clock says", () => {
  const CLOCKS: Array<[string, () => number]> = [
    ["a clock in seconds, on time", () => tickOf(Date.now(), 1000)],
    ["a clock in two seconds (FAT)", () => tickOf(Date.now(), 2000)],
    ["a share's clock in seconds, 2.5 s behind", () => tickOf(Date.now() - 2500, 1000)],
    ["a share's clock in seconds, 5 s behind", () => tickOf(Date.now() - 5000, 1000)],
    ["a share's clock in seconds, 4 s ahead", () => tickOf(Date.now() + 4000, 1000)],
    ["a clock in 10 ms (exFAT), read 5 ms after", () => tickOf(Date.now() - 5, 10)],
    ["the system's 15.6 ms tick (NTFS), read 5 ms after", () => tickOf(Date.now() - 5, 15.625)],
  ];
  for (const route of ROUTES) {
    it.each(CLOCKS)(`%s (${route})`, async (_name, stamp) => {
      await secondWriteInTheTick(route, stamp());
    });
  }

  it.each(ROUTES)("a file written again under its old timestamp with another size is read (%s)", async (route) => {
    const anHourAgo = Date.now() - 3_600_000;
    await writeAt("Folder/Note.md", "# Note\n\nalpha\n", anHourAgo);
    const indexer = indexerOver();
    await passOver(indexer, route, "Folder/Note.md");
    // A restore, a sync client or a tool that keeps the timestamp it found.
    await writeAt("Folder/Note.md", "# Note\n\nomega and more\n", anHourAgo);
    await passOver(indexer, route, "Folder/Note.md");
    expect(await found("omega")).toEqual(["Folder/Note.md"]);
  });

  it("is found without any further pass: the indexer reads the note once more by itself", async () => {
    const stamp = tickOf(Date.now() - 5, 10);
    await writeAt("Folder/Note.md", "# Note\n\nalpha\n", stamp);
    const indexer = indexerOver(raw, { comesBackByItself: true });
    await indexer.indexVaultFull();
    await writeAt("Folder/Note.md", "# Note\n\nomega\n", stamp);
    steady += 10_000;
    await vi.waitFor(async () => expect(await found("omega")).toEqual(["Folder/Note.md"]));
  });
});

describe("the row carries the file's own timestamp", () => {
  it.each(ROUTES)("also for a read within the tick of a clock in seconds (%s)", async (route) => {
    const stamp = tickOf(Date.now(), 1000);
    await writeAt("Folder/Note.md", "# Note\n\nalpha\n", stamp);
    await passOver(indexerOver(), route, "Folder/Note.md");
    expect(await rowOf("Folder/Note.md")).toEqual({ mtime_local: stamp, size_bytes: 14 });
  });

  it("the sync's own removal of a file a scan had read within the tick is taken for its own", async () => {
    const stamp = tickOf(Date.now(), 1000);
    await writeAt("Pulled.md", "# Pulled\n", stamp);
    // The scan has read the file the sync just pulled; its row is written after the sync's question.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reached!: () => void;
    const reading = new Promise<void>((resolve) => { reached = resolve; });
    let held = true;
    const vault = new Proxy(raw, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        if (key !== "readTextFile") return value.bind(target);
        return async (p: string, ...rest: unknown[]) => {
          const answer = await (value as (...a: unknown[]) => Promise<unknown>).call(target, p, ...rest);
          if (held && p === "Pulled.md") { held = false; reached(); await gate; }
          return answer;
        };
      },
    });
    const register = new OwnDeletionRegister();
    const reported: Array<{ path: string; own: boolean }> = [];
    const indexer = indexerOver(vault, {
      onLocalFileDeleted: (p: string, row?: IndexedRowStamp) => reported.push({ path: p, own: register.consume(p, row) }),
    });
    const scan = indexer.indexVaultFull();
    await reading;
    // The worker mirrors a remote deletion: no row yet, so the file's own time is the stamp its removal is reported with (SyncWorker.ownRemovalStamps).
    register.mark("Pulled.md", [indexedRowStamp((await raw.getFileInfo("Pulled.md")).mtime)]);
    release();
    await scan;
    await fs.rm(path.join(root, "Pulled.md"));
    await indexer.indexVaultFull();
    expect(reported).toEqual([{ path: "Pulled.md", own: true }]);
  });
});

describe("what confirming a timestamp costs", () => {
  it("the echo of a save reads nothing: the watcher's look and the folder's re-read after a save", async () => {
    const stamp = tickOf(Date.now(), 1000);
    await writeAt("Folder/Note.md", "# Note\n\nalpha\n", stamp);
    const { vault, reads } = counting(raw);
    const indexer = indexerOver(vault);
    // The save's own pass reads the file moments after writing it.
    await indexer.indexFile(await raw.getFileInfo("Folder/Note.md"));
    reads.length = 0;
    // The watcher hears of the save, and on Windows of its folder; the views must not reload for it (issue 122).
    expect(await indexer.indexPath("Folder/Note.md")).toBe("unchanged");
    expect((await indexer.reconcileFolder("Folder")).indexed).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("a note read within the tick is read once more after it, as no change, and then not again", async () => {
    // Read right after the listing saw them: whether written a moment or an hour before, this device cannot tell.
    await writeAt("Fresh/a.md", "# a\n\nwords\n", tickOf(Date.now() - 5, 10));
    await writeAt("Old/b.md", "# b\n\nwords\n", Date.now() - 3_600_000);
    const { vault, reads } = counting(raw);
    const indexer = indexerOver(vault);
    await indexer.indexVaultFull();
    reads.length = 0;
    steady += 10_000;
    const second = await indexer.indexVaultFull();
    expect(reads.sort(), "one reading each confirms it").toEqual(["Fresh/a.md", "Old/b.md"]);
    expect(second.changed, "and it is no change").toBe(0);
    reads.length = 0;
    expect((await indexer.indexVaultFull()).changed).toBe(0);
    expect(reads).toEqual([]);
  });

  it("a file the scan reads a tick after its listing saw it is not read again", async () => {
    // A clock in milliseconds, an hour ago.
    const anHourAgo = tickOf(Date.now() - 3_600_000, 1000) + 7;
    for (let i = 0; i < 30; i++) await writeAt(`Old/n${i}.md`, `# n${i}\n\nword${i}\n`, anHourAgo);
    await writeAt("Old/picture.png", "not really a picture", anHourAgo);
    const { vault, reads } = counting(raw);
    // Each read comes a while after the listing, as in a vault of any size.
    const indexer = indexerOver(vault, { onProgress: () => { steady += 200; } });
    expect((await indexer.indexVaultFull()).added).toBe(31);
    reads.length = 0;
    steady += 10_000;
    const again = await indexer.indexVaultFull();
    expect(again.changed).toBe(0);
    expect(reads).toEqual([]);
  });

  it("rows written before this version count as confirmed: nothing of the vault is read again", async () => {
    await writeAt("Old/a.md", "# a\n\nwords\n", tickOf(Date.now(), 1000));
    await indexerOver().indexVaultFull();
    // The table as an older version left it: no column for the confirmation.
    await db.execute("ALTER TABLE files DROP COLUMN stamp_vouched");
    await initializeSchema(db);
    const { vault, reads } = counting(raw);
    await indexerOver(vault).indexVaultFull();
    steady += 10_000;
    await indexerOver(vault).indexVaultFull();
    expect(reads).toEqual([]);
  });
});
