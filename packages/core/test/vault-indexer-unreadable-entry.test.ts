import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { VaultError, VaultFileNotFoundError, type VaultFileInfo } from "../src/vault/IVaultAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer, formatFullScanFailure, type FullScanFailure } from "../src/vault/VaultIndexer.js";

/**
 * One entry that cannot be read does not stop a pass over many (issue #125).
 *
 * The full scan and the folder re-read used to end at the first file whose
 * read failed — and with them everything the pass had found. On an iPhone a
 * single link in an iCloud vault, pointing at a folder that exists only on the
 * user's Mac, did that to every scan: the folder plugin listed the link as a
 * file, its read failed, and the first scan of the vault never completed —
 * the phone then ran the vault without an index at all: no search, no tags,
 * no databases, no calendar (finding of the reporter, read in our sources).
 *
 * A pass over many files now leaves such a file out and names it in its
 * report (`skipped`, reason "unreadable"), the way the walk names a folder it
 * could not list; the rest of the vault is indexed. A file whose read fails
 * because it is gone — removed between the listing and the read — is left
 * out without a word: the next pass sees it missing and says so then. A
 * single path is still one question with one answer: there a read that
 * fails fails the pass, and its caller comes again.
 */

let root: string;
let vault: LocalVaultAdapter;
let db: IDatabaseAdapter;
let indexer: VaultIndexer;
let fresh: string[];
let gone: string[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-unreadable-entry-"));
  vault = new LocalVaultAdapter(root);
  await vault.initialize();
  db = await realSqlite();
  fresh = [];
  gone = [];
  indexer = new VaultIndexer(vault, db, {
    onNewLocalFile: (p) => void fresh.push(p),
    onLocalFileDeleted: (p) => void gone.push(p),
  });
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

const indexed = async () => (await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path);

/**
 * What the iPhone's folder plugin made of a link whose target is not on this
 * device: listed as a file (the link's own size and time), there when asked,
 * and not found when read.
 */
function aDanglingLinkAt(link: string): void {
  const entry = (): VaultFileInfo => ({ path: link, name: link.split("/").pop()!, isDirectory: false, size: 52, mtime: 1_700_000_000_000 });
  const listDir = vault.listDir.bind(vault);
  vault.listDir = async (dir = "", recursive = false) => {
    const listed = await listDir(dir, recursive);
    const parent = link.includes("/") ? link.slice(0, link.lastIndexOf("/")) : "";
    const inside = dir === "" ? recursive || parent === "" : parent === dir || (recursive && parent.startsWith(`${dir}/`));
    return inside ? [...listed, entry()] : listed;
  };
  const exists = vault.exists.bind(vault);
  vault.exists = async (p) => p === link || (await exists(p));
  const getFileInfo = vault.getFileInfo.bind(vault);
  vault.getFileInfo = async (p) => (p === link ? entry() : getFileInfo(p));
  const readTextFile = vault.readTextFile.bind(vault);
  vault.readTextFile = async (p) => {
    if (p === link) throw new VaultFileNotFoundError(p);
    return readTextFile(p);
  };
  const readBinaryFile = vault.readBinaryFile.bind(vault);
  vault.readBinaryFile = async (p) => {
    if (p === link) throw new VaultFileNotFoundError(p);
    return readBinaryFile(p);
  };
}

/** A file that is there and cannot be read (permission, a provider that refuses it). */
function cannotBeRead(file: string): void {
  const refuse = () => { throw new VaultError(`Permission denied: ${file}`, "PERMISSION_DENIED"); };
  const readTextFile = vault.readTextFile.bind(vault);
  vault.readTextFile = async (p) => (p === file ? refuse() : readTextFile(p));
  const readBinaryFile = vault.readBinaryFile.bind(vault);
  vault.readBinaryFile = async (p) => (p === file ? refuse() : readBinaryFile(p));
}

/** A file that goes between the listing and its read. */
function vanishesBeforeItsRead(file: string): void {
  const readTextFile = vault.readTextFile.bind(vault);
  vault.readTextFile = async (p) => {
    if (p === file) await fs.rm(path.join(root, p), { force: true });
    return readTextFile(p);
  };
}

async function aVault(): Promise<void> {
  await vault.writeTextFile("Inbox.md", "# Inbox\n\nsee [[Plan]]\n");
  await vault.writeTextFile("Projects/Plan.md", "# Plan\n");
  await vault.writeTextFile("Projects/Zenn/draft.md", "# Draft\n");
  await vault.writeTextFile("Projects/Zenn/data.csv", "id;name\n");
}

describe("the full scan (issue #125)", () => {
  it("indexes the vault around a link whose target is not on this device, and names the link", async () => {
    await aVault();
    aDanglingLinkAt("Projects/Zenn/articles");

    // The first scan of a vault: on the phone a scan that fails here leaves it without an index.
    const report = await indexer.indexVaultFull("open, empty index");

    expect(await indexed()).toEqual(["Inbox.md", "Projects/Plan.md", "Projects/Zenn/data.csv", "Projects/Zenn/draft.md"]);
    expect(report.skipped).toEqual([{ path: "Projects/Zenn/articles", reason: "unreadable" }]);
    expect([...fresh].sort()).toEqual(["Inbox.md", "Projects/Plan.md", "Projects/Zenn/data.csv", "Projects/Zenn/draft.md"]);
    expect(report.added).toBe(4);
  });

  it("…and a note that is there and cannot be read", async () => {
    await aVault();
    cannotBeRead("Projects/Plan.md");

    const report = await indexer.indexVaultFull("open, empty index");

    expect(await indexed()).toEqual(["Inbox.md", "Projects/Zenn/data.csv", "Projects/Zenn/draft.md"]);
    expect(report.skipped).toEqual([{ path: "Projects/Plan.md", reason: "unreadable" }]);
  });

  it("a file the index knew, unreadable now, keeps its row and is not reported gone — the next scan tries it again", async () => {
    await aVault();
    await indexer.indexVaultFull("open, empty index");
    fresh.length = 0;
    await fs.writeFile(path.join(root, "Projects/Plan.md"), "# Plan\n\nchanged\n", "utf8");
    await fs.utimes(path.join(root, "Projects/Plan.md"), new Date(), new Date(Date.now() + 5000));
    cannotBeRead("Projects/Plan.md");

    const report = await indexer.indexVaultFull("return to the app");
    expect(report.skipped).toEqual([{ path: "Projects/Plan.md", reason: "unreadable" }]);
    expect(await indexed()).toContain("Projects/Plan.md");
    expect(gone).toEqual([]);
    expect(report.changed).toBe(0);
  });

  it("a file that vanished after the listing is left out without a word, and the next scan reports it", async () => {
    await aVault();
    await indexer.indexVaultFull("open, empty index");
    await fs.writeFile(path.join(root, "Projects/Plan.md"), "# Plan\n\nchanged\n", "utf8");
    await fs.utimes(path.join(root, "Projects/Plan.md"), new Date(), new Date(Date.now() + 5000));
    vanishesBeforeItsRead("Projects/Plan.md");

    const report = await indexer.indexVaultFull("return to the app");
    expect(report.skipped).toEqual([]);
    expect(gone).toEqual([]);

    await indexer.indexVaultFull("return to the app");
    expect(gone).toEqual(["Projects/Plan.md"]);
    expect(await indexed()).not.toContain("Projects/Plan.md");
  });
});

describe("a folder re-read (issue #125)", () => {
  it("indexes the folder around the link and names it", async () => {
    await aVault();
    aDanglingLinkAt("Projects/Zenn/articles");

    const report = await indexer.reconcileFolder("Projects");

    expect(report.skipped).toEqual([{ path: "Projects/Zenn/articles", reason: "unreadable" }]);
    expect([...report.indexed].sort()).toEqual(["Projects/Plan.md", "Projects/Zenn/data.csv", "Projects/Zenn/draft.md"]);
    expect([...fresh].sort()).toEqual(["Projects/Plan.md", "Projects/Zenn/data.csv", "Projects/Zenn/draft.md"]);
  });

  it("…flat, as the watcher's parent check does it", async () => {
    await aVault();
    aDanglingLinkAt("Projects/Zenn/articles");

    const report = await indexer.reconcileFolder("Projects/Zenn", { recursive: false });

    expect(report.skipped).toEqual([{ path: "Projects/Zenn/articles", reason: "unreadable" }]);
    expect([...report.indexed].sort()).toEqual(["Projects/Zenn/data.csv", "Projects/Zenn/draft.md"]);
  });
});

describe("a single path is one question (unchanged)", () => {
  it("a read that fails fails the pass, and nothing is written for the path", async () => {
    await aVault();
    aDanglingLinkAt("Projects/Zenn/articles");
    await expect(indexer.indexFile(await vault.getFileInfo("Projects/Zenn/articles"))).rejects.toBeInstanceOf(VaultFileNotFoundError);
    expect(await indexed()).toEqual([]);
  });
});

describe("a full scan that fails says so, once (issue #125)", () => {
  it("tells the host what set it off and what stopped it, and the index keeps what it had", async () => {
    await aVault();
    const failures: FullScanFailure[] = [];
    const scans: string[] = [];
    indexer = new VaultIndexer(vault, db, {
      onFullScan: (info) => void scans.push(info.trigger),
      onFullScanFailed: (info) => void failures.push(info),
    });
    await indexer.indexVaultFull("open, empty index");
    // The root cannot be listed any more: a provider gone offline, a folder taken away.
    const refuse = async (): Promise<never> => { throw new VaultError("The folder cannot be read", "UNKNOWN"); };
    vault.listDir = refuse;
    const reporting = vault as { listDirReport?: unknown };
    if (reporting.listDirReport) reporting.listDirReport = refuse;

    await expect(indexer.indexVaultFull("return to the app")).rejects.toThrow("The folder cannot be read");
    expect(failures).toHaveLength(1);
    expect(failures[0].trigger).toBe("return to the app");
    // The diagnostics line names the kind of error, never its message (it may name a file).
    expect(formatFullScanFailure(failures[0])).toBe("full scan (return to the app) failed: UNKNOWN");
    expect(scans).toEqual(["open, empty index"]);
    expect(await indexed()).toEqual(["Inbox.md", "Projects/Plan.md", "Projects/Zenn/data.csv", "Projects/Zenn/draft.md"]);
  });

  it("a scan called off because the vault closes says nothing", async () => {
    await aVault();
    const closing = new AbortController();
    const failures: FullScanFailure[] = [];
    indexer = new VaultIndexer(vault, db, { scanSignal: closing.signal, onFullScanFailed: (info) => void failures.push(info) });
    closing.abort();
    await expect(indexer.indexVaultFull("open")).rejects.toBeDefined();
    expect(failures).toEqual([]);
  });

  it("…nor does one that gets through after the vault began to close", async () => {
    await aVault();
    const closing = new AbortController();
    const scans: string[] = [];
    indexer = new VaultIndexer(vault, db, { scanSignal: closing.signal, onFullScan: (info) => void scans.push(info.trigger) });
    // Past its last look at the signal: the vault closes while the scan writes.
    const execute = db.execute.bind(db);
    db.execute = async (sql, params) => { closing.abort(); return execute(sql, params); };
    const report = await indexer.indexVaultFull("open, empty index");
    db.execute = execute;
    expect(report.added).toBeGreaterThan(0);
    expect(scans).toEqual([]);
  });
});
