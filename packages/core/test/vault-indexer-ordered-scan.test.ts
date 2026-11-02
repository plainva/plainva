import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";

/**
 * Two questions about which full scan a caller gets.
 *
 * 3.118: a caller that changes something and then asks for a full scan wants
 * one that sees the change. A scan already under way was handed to every
 * further caller, and that scan may have listed the disk and read the index
 * before the change - the moved folder kept its reset timestamps, the removed
 * folder stayed in the search, until some later scan.
 *
 * 3.120: a scan whose vault is being left (the scan signal is aborted) stopped
 * looking at the signal once it began to write, and wrote every changed file
 * of a vault nobody had open any more; the desktop's open went on behind it.
 */

let root: string;
let vault: LocalVaultAdapter;
let db: IDatabaseAdapter;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-ordered-scan-"));
  vault = new LocalVaultAdapter(root);
  await vault.initialize();
  db = await realSqlite();
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

const row = (p: string) => db.queryOne<{ path: string }>("SELECT path FROM files WHERE path = ?", [p]);

/** Holds the next scan right after it listed the disk, until `release` is called. */
function holdAfterListing(): { listed: Promise<void>; release: () => void; listings: () => number } {
  let count = 0;
  let release!: () => void;
  let listed!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const seen = new Promise<void>((resolve) => { listed = resolve; });
  const list = vault.listDir.bind(vault);
  let first = true;
  vault.listDir = async (...args) => {
    count += 1;
    const listing = await list(...args);
    if (first) {
      first = false;
      listed();
      await gate;
    }
    return listing;
  };
  return { listed: seen, release, listings: () => count };
}

describe("a full scan asked for after a change (3.118)", () => {
  it("is one that began after the change, not the one under way", async () => {
    await fs.writeFile(path.join(root, "a.md"), "# A\n");
    const indexer = new VaultIndexer(vault, db);
    const hold = holdAfterListing();
    const first = indexer.indexVaultFull("open");
    await hold.listed;

    // The change, after the running scan listed the disk.
    await fs.writeFile(path.join(root, "b.md"), "# B\n");
    const mine = indexer.indexVaultFull("folder moved in the app");
    hold.release();
    await first;
    await mine;

    expect(await row("a.md")).toBeTruthy();
    expect(await row("b.md")).toBeTruthy();
  });

  it("callers that arrive during one scan share one scan after it", async () => {
    const indexer = new VaultIndexer(vault, db);
    const hold = holdAfterListing();
    const first = indexer.indexVaultFull("open");
    await hold.listed;
    const second = indexer.indexVaultFull("watcher");
    const third = indexer.indexVaultFull("manual refresh");
    expect(third).toBe(second);
    expect(second).not.toBe(first);
    hold.release();
    await Promise.all([first, second, third]);
    expect(hold.listings()).toBe(2);
  });

  it("whenIdle waits for the scan that follows as well", async () => {
    const indexer = new VaultIndexer(vault, db);
    const hold = holdAfterListing();
    void indexer.indexVaultFull("open");
    await hold.listed;
    await fs.writeFile(path.join(root, "late.md"), "# Late\n");
    void indexer.indexVaultFull("daily note");
    hold.release();
    await indexer.whenIdle();
    expect(await row("late.md")).toBeTruthy();
  });
});

describe("a full scan of a vault that is being left (3.120)", () => {
  it("stops writing once the signal is aborted", async () => {
    for (let i = 0; i < 40; i++) await fs.writeFile(path.join(root, `n${i}.md`), `# Note ${i}\n`);
    const leaving = new AbortController();
    const indexer = new VaultIndexer(vault, db, { scanSignal: leaving.signal });
    let reads = 0;
    const read = vault.readTextFile.bind(vault);
    vault.readTextFile = async (...args) => {
      reads += 1;
      if (reads === 3) leaving.abort();
      return read(...args);
    };
    await expect(indexer.indexVaultFull("open")).rejects.toMatchObject({ name: "AbortError" });
    expect(reads).toBeLessThan(40);
  });
});
