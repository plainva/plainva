import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { MANUAL_REFRESH_TRIGGER, VaultIndexer } from "../src/vault/VaultIndexer.js";
import type { VaultFileInfo } from "../src/vault/IVaultAdapter.js";
import { noteIndexChange } from "../src/db/indexChanges.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";

/**
 * The indexer's own coming back (`comesBackByItself`): the rows a pass wrote
 * before their timestamp could be vouched for are read once more when the
 * tick is surely over, and a file owed a reading — it changed during every
 * reading — is read again after a pause that grows.
 *
 * What it may cost and where it must not fail: each row not confirmed yet is
 * read once, by one run at a time; a timer that fires early is set again; a
 * file that keeps changing costs a bounded, growing amount of work; a file
 * owed a reading that the app moves stays owed under its new path, and one
 * that is neither on the disk nor in the index is owed nothing. A file system
 * that gives no timestamp is never vouched for.
 */

let root: string;
let raw: LocalVaultAdapter;
let db: IDatabaseAdapter;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-coming-back-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The vault, counting the readings of each file and running `onRead` after each. */
function counted(onRead: (p: string, n: number) => Promise<void> = async () => {}, slow = 0) {
  const reads = new Map<string, number>();
  const vault = new Proxy(raw, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (key !== "readBinaryFile" && key !== "readTextFile") return value.bind(target);
      return async (p: string, ...rest: unknown[]) => {
        if (slow) await sleep(slow);
        const answer = await (value as (...a: unknown[]) => Promise<unknown>).call(target, p, ...rest);
        const n = (reads.get(p) ?? 0) + 1;
        reads.set(p, n);
        await onRead(p, n);
        return answer;
      };
    },
  });
  const total = () => [...reads.values()].reduce((a, b) => a + b, 0);
  return { vault, reads, total };
}

const owedList = async () => {
  const row = await db.queryOne<{ value?: string }>(`SELECT value FROM meta WHERE key = 'index_owed_paths'`);
  return row?.value ? (JSON.parse(row.value) as string[]) : [];
};
const unconfirmedRows = async () => Number((await db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM files WHERE stamp_vouched = 0`))?.n ?? 0);

/** Waits until nothing has been read for `quietMs`. */
async function untilQuiet(total: () => number, quietMs = 600, limitMs = 20_000) {
  const start = Date.now();
  let last = total();
  let since = Date.now();
  while (Date.now() - since < quietMs && Date.now() - start < limitMs) {
    await sleep(25);
    if (total() !== last) {
      last = total();
      since = Date.now();
    }
  }
}

describe("each row not confirmed yet is read once more, by one run at a time", () => {
  it("a scan of many fresh notes, its rows' ticks running out while it reads: as many readings after it as rows it left unconfirmed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let i = 0; i < 300; i++) await raw.writeTextFile(`I/n${i}.md`, `# n${i}\n\n${"lorem ".repeat(20)}\n`);
    // A slow disk: the scan takes far longer than the 100 ms tick bound of a fine timestamp, so timers fire during it.
    const { vault, total } = counted(async () => {}, 1);
    const indexer = new VaultIndexer(vault, db, { comesBackByItself: true });
    await indexer.indexVaultFull("open");
    const left = await unconfirmedRows();
    const afterScan = total();
    expect(left).toBeGreaterThan(0);
    await untilQuiet(total);
    expect(total() - afterScan, "one reading for each row left unconfirmed").toBe(left);
    expect(await unconfirmedRows()).toBe(0);
  });

  it("a timer that fires before its time is set again for the rest", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let steady = 1_000_000;
    await raw.writeTextFile("N.md", "# N\n");
    const indexer = new VaultIndexer(raw, db, { comesBackByItself: true, monotonicNow: () => steady });
    await indexer.indexPath("N.md");
    expect(await unconfirmedRows()).toBe(1);
    // The timer fires a millisecond before its time by the steady clock (it is set for 100 ms).
    steady += 99;
    await sleep(250);
    expect(await unconfirmedRows(), "not yet: early").toBe(1);
    // Its time comes, with no other pass passing by.
    steady += 1_000;
    await vi.waitFor(async () => expect(await unconfirmedRows()).toBe(0), { timeout: 2_000 });
  });
});

describe("a file that changes during every reading costs a bounded, growing amount of work", () => {
  it("each time it is owed again, the pause before the next reading doubles; no other way reads it sooner", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let steady = 1_000_000;
    await raw.writeTextFile("L.md", "# log\n");
    const { vault } = counted(async (p) => {
      if (p === "L.md") await noteIndexChange(["L.md"], db);
    });
    const indexer = new VaultIndexer(vault, db, { monotonicNow: () => steady });
    const pause = () => {
      const retry = (indexer as unknown as { owedRetry: Map<string, { at: number; tries: number }> }).owedRetry.get("L.md");
      return retry ? retry.at - steady : null;
    };
    const unconfirmed = () => (indexer as unknown as { unconfirmed: Map<string, unknown> }).unconfirmed.has("L.md");
    const pauses: Array<number | null> = [];
    for (let round = 0; round < 4; round++) {
      await indexer.indexPath("L.md");
      pauses.push(pause());
      expect(unconfirmed(), "its own pause decides, not a row's tick").toBe(false);
      steady += 10;
    }
    expect(pauses).toEqual([3_000, 6_000, 12_000, 24_000]);
    expect(await owedList()).toEqual(["L.md"]);
  });
});

describe("what is owed follows the file, and nothing is owed for a file that is not there", () => {
  it("an owed file the app moves is owed under its new path; read there quietly, nothing is owed and nothing named", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await raw.writeTextFile("keep.md", "# keep\n");
    await raw.writeTextFile("A/N.md", "# N\n");
    let busy = true;
    const { vault } = counted(async (p) => {
      if (busy && p === "A/N.md") await noteIndexChange(["A/N.md"], db);
    });
    const indexer = new VaultIndexer(vault, db);
    await indexer.indexVaultFull("open");
    expect(await owedList()).toEqual(["A/N.md"]);
    busy = false;
    await raw.renameItem("A", "B");
    await indexer.relocatePathInIndex("A", "B");
    expect(await owedList()).toEqual(["B/N.md"]);
    const report = await indexer.indexVaultFull("automatic refresh");
    expect(report.skipped.filter((s) => s.reason === "changing")).toEqual([]);
    expect(await owedList()).toEqual([]);
    expect(await indexer.indexComplete()).toBe(true);
  });

  it("an owed path with neither a file nor a row is owed nothing at the next scan, and after a restart", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await raw.writeTextFile("keep.md", "# keep\n");
    await new VaultIndexer(raw, db).indexVaultFull("open");
    await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('index_owed_paths', ?)`, [JSON.stringify(["Gone.md"])]);
    const indexer = new VaultIndexer(raw, db);
    const report = await indexer.indexVaultFull("open");
    expect(report.skipped.filter((s) => s.reason === "changing"), "no notice names a file that is not there").toEqual([]);
    expect(await owedList()).toEqual([]);
    expect(await indexer.indexComplete()).toBe(true);
  });
});

describe("a file system that gives no timestamp", () => {
  /** The vault as a provider without timestamps reports it: every file's mtime is 0. */
  function stampless() {
    const zero = (info: VaultFileInfo): VaultFileInfo => ({ ...info, mtime: 0 });
    return new Proxy(raw, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        if (key === "getFileInfo") return async (p: string) => zero(await raw.getFileInfo(p));
        if (key === "listDir") return async (...a: unknown[]) => ((await (value as (...b: unknown[]) => Promise<VaultFileInfo[]>).apply(target, a)).map(zero));
        if (key === "listDirReport") {
          return async (...a: unknown[]) => {
            const out = await (value as (...b: unknown[]) => Promise<{ files: VaultFileInfo[] }>).apply(target, a);
            return { ...out, files: out.files.map(zero) };
          };
        }
        return value.bind(target);
      },
    });
  }

  /** The stamp-less vault, counting the readings of each file. */
  function countedStampless() {
    const vault = stampless();
    let reads = 0;
    const counting = new Proxy(vault, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        if (key !== "readBinaryFile" && key !== "readTextFile") return value.bind(target);
        return async (...a: unknown[]) => { reads += 1; return (value as (...b: unknown[]) => Promise<unknown>).apply(target, a); };
      },
    });
    return { vault: counting, reads: () => reads };
  }

  it("is read at the open and at a manual refresh, never by an automatic one: three of them read nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let steady = 1_000_000;
    for (let i = 0; i < 20; i++) await raw.writeTextFile(`N${i}.md`, `# N${i}\n`);
    await new VaultIndexer(stampless(), db, { monotonicNow: () => steady }).indexVaultFull("open, empty index");
    // The next session: its first full scan compares every file without a timestamp once.
    const { vault, reads } = countedStampless();
    const indexer = new VaultIndexer(vault, db, { monotonicNow: () => steady, hearsNoChanges: true });
    await indexer.indexVaultFull("open");
    expect(reads(), "one reading each at the open").toBe(20);
    for (let round = 0; round < 3; round++) {
      steady += 60_000;
      await indexer.indexVaultFull("automatic refresh");
    }
    expect(reads(), "nothing for three automatic refreshes").toBe(20);
    await indexer.indexVaultFull(MANUAL_REFRESH_TRIGGER);
    expect(reads(), "and each once more at a manual refresh").toBe(40);
  });

  it("a change of the same size is found at the next open or a manual refresh, and an unchanged file is not written again", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let steady = 1_000_000;
    await raw.writeTextFile("N.md", "# N\n\nalpha\n");
    const indexer = new VaultIndexer(stampless(), db, { monotonicNow: () => steady });
    await indexer.indexVaultFull("open");
    steady += 60_000;
    // Another program writes the same number of bytes: no timestamp, no size to tell it by.
    await fs.writeFile(path.join(root, "N.md"), "# N\n\nomega\n");
    await indexer.indexVaultFull("automatic refresh");
    const search = () => new VaultQueryService(db).searchFullText("omega").then((hits) => hits.map((hit) => hit.path));
    expect(await search(), "an automatic refresh does not read it").toEqual([]);
    await indexer.indexVaultFull(MANUAL_REFRESH_TRIGGER);
    expect(await search()).toEqual(["N.md"]);
    await fs.writeFile(path.join(root, "N.md"), "# N\n\ndelta\n");
    await new VaultIndexer(stampless(), db, { monotonicNow: () => steady }).indexVaultFull("open");
    expect((await new VaultQueryService(db).searchFullText("delta")).map((hit) => hit.path), "found at the next open").toEqual(["N.md"]);
    expect(Number((await db.queryOne<{ v: number }>(`SELECT stamp_vouched AS v FROM files WHERE path = 'N.md'`))?.v)).toBe(0);
  });
});
