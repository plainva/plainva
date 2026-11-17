import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";

/**
 * A file the index skips is one whose row stands for it: same timestamp and
 * same size — and a row written from a read that came within a tick of the
 * file's clock does not stand for it (`indexedMtime` in VaultIndexer.ts).
 *
 * Every pass skipped a file by its timestamp alone. Another program that
 * writes a note twice within one tick of the file system's clock — FAT counts
 * in 2 s, HFS+ and many network mounts in 1 s — left the second text under
 * the timestamp of the first; a read between the two writes indexed the
 * first, and no pass read the file again until its next change: old text in
 * the search, and no upload of the change.
 *
 * The file system here keeps fine timestamps, so the tests set the coarse
 * clock's by hand (`utimes`), as such a file system would. A fine clock's tick
 * is the millisecond: a file read a moment after it was written is read once.
 */

let root: string;
let raw: LocalVaultAdapter;
let db: IDatabaseAdapter;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-racy-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

/** Writes `text` and gives the file `mtime`, as a file system that keeps only that tick would. */
async function writeAt(file: string, text: string, mtime: number): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), text, "utf8");
  await fs.utimes(path.join(root, file), new Date(mtime), new Date(mtime));
}

/** The current tick of a clock that counts in two seconds, as FAT's does. */
const fatTick = () => Math.floor(Date.now() / 2000) * 2000;

const ROUTES = ["indexPath", "reconcileFolder", "indexVaultFull"] as const;

async function passOver(indexer: VaultIndexer, route: (typeof ROUTES)[number], file: string): Promise<unknown> {
  if (route === "indexPath") return indexer.indexPath(file);
  if (route === "reconcileFolder") return indexer.reconcileFolder("Folder");
  return indexer.indexVaultFull();
}

const found = async (word: string) => (await new VaultQueryService(db).searchFullText(word)).map((hit) => hit.path);

describe("a file the index skips is one its row stands for", () => {
  it.each(ROUTES)("a second write within the same tick of the file's clock is read (%s)", async (route) => {
    const tick = fatTick();
    // Same length on purpose: the size cannot tell the two apart either.
    await writeAt("Folder/Note.md", "# Note\n\nalpha\n", tick);
    const indexer = new VaultIndexer(raw, db);
    await passOver(indexer, route, "Folder/Note.md");
    expect(await found("alpha")).toEqual(["Folder/Note.md"]);
    // Another program writes again, within the same tick.
    await writeAt("Folder/Note.md", "# Note\n\nomega\n", tick);
    await passOver(indexer, route, "Folder/Note.md");
    expect(await found("omega")).toEqual(["Folder/Note.md"]);
    expect(await found("alpha")).toEqual([]);
  });

  it.each(ROUTES)("a file written again under its old timestamp with another size is read (%s)", async (route) => {
    const anHourAgo = Date.now() - 3_600_000;
    await writeAt("Folder/Note.md", "# Note\n\nalpha\n", anHourAgo);
    const indexer = new VaultIndexer(raw, db);
    await passOver(indexer, route, "Folder/Note.md");
    expect(await found("alpha")).toEqual(["Folder/Note.md"]);
    // A restore, a sync client or a tool that keeps the timestamp it found.
    await writeAt("Folder/Note.md", "# Note\n\nomega and more\n", anHourAgo);
    await passOver(indexer, route, "Folder/Note.md");
    expect(await found("omega")).toEqual(["Folder/Note.md"]);
  });

  it("the row of a racy read keeps the timestamp the file was read at, give or take a millisecond", async () => {
    const tick = fatTick();
    await writeAt("Folder/Note.md", "# Note\n\nalpha\n", tick);
    await new VaultIndexer(raw, db).indexVaultFull();
    const row = await db.queryOne<{ mtime_local: number; size_bytes: number }>("SELECT mtime_local, size_bytes FROM files WHERE path = 'Folder/Note.md'");
    expect(row).toEqual({ mtime_local: tick - 1, size_bytes: 14 });
  });

  it("the echo of a save is still no change: the watcher's look after a save reports nothing new", async () => {
    await raw.writeTextFile("Folder/Note.md", "# Note\n\nalpha\n");
    const indexer = new VaultIndexer(raw, db);
    // The save's own pass reads the file moments after writing it.
    await indexer.indexFile(await raw.getFileInfo("Folder/Note.md"));
    // The watcher hears of the save; the views must not reload for it (issue 122).
    expect(await indexer.indexPath("Folder/Note.md")).toBe("unchanged");
  });

  /** A scan over `files`, then the reads of the scan after it. */
  async function readsOfTheNextScan(files: Record<string, number>): Promise<number> {
    for (const [file, mtime] of Object.entries(files)) await writeAt(file, `# ${file}\n\nwords\n`, mtime);
    let reads = 0;
    const counting = new Proxy(raw, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        if (key === "readBinaryFile" || key === "readTextFile") return (...args: unknown[]) => { reads++; return (value as (...a: unknown[]) => unknown).apply(target, args); };
        return value.bind(target);
      },
    });
    const indexer = new VaultIndexer(counting, db);
    await indexer.indexVaultFull();
    reads = 0;
    expect((await indexer.indexVaultFull()).changed).toBe(0);
    return reads;
  }

  /** A timestamp of a clock that counts in milliseconds: never on a whole second. */
  const fine = (at: number) => (at % 1000 === 0 ? at + 1 : at);

  it("a file a fine clock stamped a moment before the read is not read again — a save, a pull, an import", async () => {
    expect(await readsOfTheNextScan({ "Fresh/a.md": fine(Date.now() - 400), "Fresh/b.md": fine(Date.now() - 50) })).toBe(0);
  });

  it("a coarse timestamp a moment ahead of the read is read again: a share whose clock runs a little ahead", async () => {
    expect(await readsOfTheNextScan({ "Ahead/a.md": fatTick() + 2000, "Old/b.md": fine(Date.now() - 3_600_000) })).toBe(1);
  });

  it("a timestamp far from this device's clock does not make every scan read the file again", async () => {
    expect(await readsOfTheNextScan({
      "Ahead/fine.md": fine(Date.now() + 3_600_000),
      "Ahead/coarse.md": fatTick() + 3_600_000,
      "Behind/coarse.md": fatTick() - 3_600_000,
    })).toBe(0);
  });

  it("a coarse clock's timestamp a moment before the read is read again", async () => {
    expect(await readsOfTheNextScan({ "Fat/a.md": fatTick(), "Old/b.md": fine(Date.now() - 3_600_000) })).toBe(1);
  });

  it("a scan reads nothing again in a vault whose files were written long before it read them", async () => {
    const anHourAgo = Date.now() - 3_600_000;
    for (let i = 0; i < 30; i++) await writeAt(`Old/n${i}.md`, `# n${i}\n\nword${i}\n`, anHourAgo);
    await writeAt("Old/picture.png", "not really a picture", anHourAgo);
    let reads = 0;
    const counting = new Proxy(raw, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        if (key === "readBinaryFile" || key === "readTextFile") return (...args: unknown[]) => { reads++; return (value as (...a: unknown[]) => unknown).apply(target, args); };
        return value.bind(target);
      },
    });
    const indexer = new VaultIndexer(counting, db);
    expect((await indexer.indexVaultFull()).added).toBe(31);
    reads = 0;
    const again = await indexer.indexVaultFull();
    expect(again.changed).toBe(0);
    expect(reads).toBe(0);
  });
});
