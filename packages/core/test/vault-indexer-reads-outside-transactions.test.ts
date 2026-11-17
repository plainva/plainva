import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import { withinAsync } from "./helpers/timeBudget.js";
import type { IDatabaseAdapter, SqlStatements } from "../src/db/IDatabaseAdapter.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";

/**
 * No file is read inside a transaction (stability plan R1, review M1): on
 * the single-path routes — a save's pass (`indexFile`), the watcher's look at
 * one path (`indexPath`), a folder re-read (`reconcileFolder`) — and in the
 * full scan (`indexVaultFull`), which read each file inside its transaction
 * until 16.11.
 *
 * The read used to happen inside the transaction. A file that takes long to
 * read — on a share, behind a provider that fetches it first, a film of
 * gigabytes — held every other writer for as long: a save's queue entry, the
 * sync marking an upload done; they gave up after a minute, and on the
 * desktop a transaction that sent nothing for two minutes was rolled back
 * under its body. And a save that lands between the read and the write must
 * still end up indexed with the newer text.
 *
 * Real files and a real SQLite: a write sent to the adapter itself while a
 * transaction is open waits for it, and fails after two seconds under the
 * tests (realSqlite.ts) — so a write that goes through while a read is held
 * proves that no transaction is open.
 */

let root: string;
let raw: LocalVaultAdapter;
let db: IDatabaseAdapter;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-reads-outside-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  db = await realSqlite();
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

/**
 * The vault, with the next read of `held` waiting until `release()`. With
 * `after`, the read is made first and its answer held: what the pass gets is
 * the file as it was when its read began (review of R1: holding before the
 * read let the slow pass read the newer text, and no test needed `claimWrite`).
 */
function holdingReads(held: string, after = false) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reached!: () => void;
  const reading = new Promise<void>((resolve) => { reached = resolve; });
  let armed = true;
  const vault = new Proxy(raw, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (key !== "readBinaryFile" && key !== "readTextFile") return value.bind(target);
      return async (p: string, ...rest: unknown[]) => {
        const read = () => (value as (...a: unknown[]) => Promise<unknown>).call(target, p, ...rest);
        if (armed && p === held) {
          armed = false;
          const answer = after ? await read() : undefined;
          reached();
          await gate;
          if (after) return answer;
        }
        return read();
      };
    },
  });
  return { vault, release, reading };
}

const later = (ms: number) => new Date(Date.now() + ms);

const ROUTES = ["indexFile", "indexPath", "reconcileFolder", "indexVaultFull"] as const;

/** One pass of `route` over `file` (in `Folder`). */
async function passOver(indexer: VaultIndexer, route: (typeof ROUTES)[number], file: string): Promise<unknown> {
  if (route === "indexFile") return indexer.indexFile(await raw.getFileInfo(file));
  if (route === "indexPath") return indexer.indexPath(file);
  if (route === "reconcileFolder") return indexer.reconcileFolder("Folder");
  return indexer.indexVaultFull();
}

describe("a file is read before its transaction", () => {
  it.each(ROUTES)("while %s waits for a slow read, other writers go on", async (route) => {
    await raw.writeTextFile("Folder/Big.md", "# Big\n\nzeppelin\n");
    const { vault, release, reading } = holdingReads("Folder/Big.md");
    const indexer = new VaultIndexer(vault, db);
    const pass = passOver(indexer, route, "Folder/Big.md");
    await reading;
    // A write of another flow — it would wait for an open transaction and fail after two seconds.
    await db.execute("INSERT INTO meta (key, value) VALUES ('another writer', '1')");
    release();
    await pass;
    expect(await db.queryOne("SELECT value FROM meta WHERE key = 'another writer'")).toEqual({ value: "1" });
    expect((await new VaultQueryService(db).searchFullText("zeppelin")).map((hit) => hit.path)).toEqual(["Folder/Big.md"]);
  });

  it.each(ROUTES)("a save that lands between the read and the write is indexed with its newer text (%s)", async (route) => {
    await raw.writeTextFile("Folder/Note.md", "# Note\n\nfirst balloon\n");
    await fs.utimes(path.join(root, "Folder/Note.md"), new Date(), later(-60_000));
    // The slow pass has READ the first text when the save comes; only the order of the reads keeps it from writing it.
    const { vault, release, reading } = holdingReads("Folder/Note.md", true);
    const slow = new VaultIndexer(vault, db);
    const pass = passOver(slow, route, "Folder/Note.md");
    await reading;
    // While the first pass reads, the note is saved and the save's own pass goes through.
    await fs.writeFile(path.join(root, "Folder/Note.md"), "# Note\n\nsecond zeppelin\n", "utf8");
    // Another program may set an OLDER timestamp: the order of the reads decides, not the file's clock.
    await fs.utimes(path.join(root, "Folder/Note.md"), new Date(), later(-3_600_000));
    // The save's pass is the same indexer's, as in the app; its read begins after the first one's.
    await slow.indexFile(await raw.getFileInfo("Folder/Note.md"));
    release();
    await pass;
    const search = new VaultQueryService(db);
    expect((await search.searchFullText("zeppelin")).map((hit) => hit.path)).toEqual(["Folder/Note.md"]);
    expect(await search.searchFullText("balloon")).toEqual([]);
  });
});

/** Counts the transactions open on `target` right now. */
function countingTransactions(target: IDatabaseAdapter): { db: IDatabaseAdapter; open: () => number } {
  let open = 0;
  const counted: IDatabaseAdapter = new Proxy(target, {
    get(inner, key, receiver) {
      const value = Reflect.get(inner, key, receiver);
      if (key !== "transaction" || typeof value !== "function") return typeof value === "function" ? value.bind(inner) : value;
      return async <T,>(fn: (tx: SqlStatements) => Promise<T>) => (value as IDatabaseAdapter["transaction"]).call(inner, async (tx: SqlStatements) => {
        open++;
        try {
          return await fn(tx);
        } finally {
          open--;
        }
      }) as Promise<T>;
    },
  });
  return { db: counted, open: () => open };
}

describe("the full scan reads every file before the transaction that writes it (M1)", () => {
  it("no read of a full scan happens while a transaction is open, over many files and many transactions", async () => {
    for (let i = 0; i < 40; i++) await raw.writeTextFile(`Notes/n${i}.md`, `# n${i}\n\nword${i}\n`);
    await raw.writeTextFile("Notes/picture.png", "not really a picture");
    const { db: counted, open } = countingTransactions(db);
    const insideATransaction: string[] = [];
    const vault = new Proxy(raw, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        if (key !== "readBinaryFile" && key !== "readTextFile") return value.bind(target);
        return async (p: string, ...rest: unknown[]) => {
          if (open() > 0) insideATransaction.push(p);
          return (value as (...a: unknown[]) => Promise<unknown>).call(target, p, ...rest);
        };
      },
    });
    // No time for a transaction: each one writes what was read for it and ends.
    const indexer = new VaultIndexer(vault, counted, { scanTransactionMs: 0 });
    const report = await indexer.indexVaultFull();
    expect(report.added).toBe(41);
    expect(insideATransaction).toEqual([]);
  });

  it("a read that hangs holds no transaction: the write lock is free for as long as it hangs, and the scan goes on once it answers", async () => {
    await raw.writeTextFile("Folder/A.md", "# A\n\nalpha\n");
    await raw.writeTextFile("Folder/Hung.md", "# Hung\n\nhanging\n");
    const { vault, release, reading } = holdingReads("Folder/Hung.md");
    const { db: counted, open } = countingTransactions(db);
    const indexer = new VaultIndexer(vault, counted, { scanTransactionMs: 0 });
    const scan = indexer.indexVaultFull();
    await reading;
    // Longer than a statement may wait for an open transaction under the tests (two seconds).
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(open(), "no transaction is open while the read hangs").toBe(0);
    await db.execute("INSERT INTO meta (key, value) VALUES ('another writer', '1')");
    release();
    await scan;
    const search = new VaultQueryService(db);
    expect((await search.searchFullText("hanging")).map((hit) => hit.path)).toEqual(["Folder/Hung.md"]);
    expect((await search.searchFullText("alpha")).map((hit) => hit.path)).toEqual(["Folder/A.md"]);
  });

  it("another writer does not wait for the scan's reads (183 to 3 201 ms on the main of 15.11.)", async () => {
    for (const name of ["s1", "s2", "s3"]) await raw.writeTextFile(`Slow/${name}.md`, `# ${name}\n`);
    // Each read takes 600 ms, as a share or a provider that fetches the file first may.
    const measured: Promise<void>[] = [];
    let n = 0;
    const vault = new Proxy(raw, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (typeof value !== "function") return value;
        if (key !== "readBinaryFile" && key !== "readTextFile") return value.bind(target);
        return async (p: string, ...rest: unknown[]) => {
          // While this read is under way, a save's entry in the sync queue is written.
          const entry = `writer ${++n}`;
          measured.push(withinAsync(20, () => db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, '1')", [entry])));
          await new Promise((resolve) => setTimeout(resolve, 600));
          return (value as (...a: unknown[]) => Promise<unknown>).call(target, p, ...rest);
        };
      },
    });
    await new VaultIndexer(vault, db).indexVaultFull();
    expect(measured).toHaveLength(3);
    await Promise.all(measured);
  });
});

describe("a change that lands between the full scan's read and its write stands (M1)", () => {
  /** An index that knows `Folder/Note.md`, and the note changed past it, so the next scan reads it. */
  async function anIndexedNoteChangedElsewhere(): Promise<void> {
    await raw.writeTextFile("Folder/Note.md", "# Note\n\nfirst balloon\n");
    await new VaultIndexer(raw, db).indexVaultFull();
    await fs.writeFile(path.join(root, "Folder/Note.md"), "# Note\n\nsecond zeppelin\n", "utf8");
    await fs.utimes(path.join(root, "Folder/Note.md"), new Date(), later(60_000));
  }

  const rows = async () => (await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path);

  it.each(["an indexed note", "a new note"] as const)("%s the watcher finds gone is not brought back by the scan's older reading", async (kind) => {
    if (kind === "an indexed note") await anIndexedNoteChangedElsewhere();
    else await raw.writeTextFile("Folder/Note.md", "# Note\n\nsecond zeppelin\n");
    // The scan has READ the note when it goes.
    const { vault, release, reading } = holdingReads("Folder/Note.md", true);
    const gone: string[] = [];
    const indexer = new VaultIndexer(vault, db, { onLocalFileDeleted: (p) => gone.push(p) });
    const scan = indexer.indexVaultFull();
    await reading;
    await fs.rm(path.join(root, "Folder/Note.md"));
    await indexer.indexPath("Folder/Note.md");
    release();
    await scan;
    expect(await rows()).toEqual([]);
    expect(await new VaultQueryService(db).searchFullText("zeppelin")).toEqual([]);
    expect(gone).toEqual(kind === "an indexed note" ? ["Folder/Note.md"] : []);
  });

  it("a note the app deletes is not brought back by the scan's older reading", async () => {
    await anIndexedNoteChangedElsewhere();
    const { vault, release, reading } = holdingReads("Folder/Note.md", true);
    const indexer = new VaultIndexer(vault, db);
    const scan = indexer.indexVaultFull();
    await reading;
    await fs.rm(path.join(root, "Folder/Note.md"));
    await indexer.removePathFromIndex("Folder/Note.md");
    release();
    await scan;
    expect(await rows()).toEqual([]);
  });

  it.each(["an indexed note", "a new note"] as const)("%s the app renames (queue, then index) is not written back under its old name — no ghost", async (kind) => {
    if (kind === "an indexed note") await anIndexedNoteChangedElsewhere();
    else await raw.writeTextFile("Folder/Note.md", "# Note\n\nsecond zeppelin\n");
    const { vault, release, reading } = holdingReads("Folder/Note.md", true);
    const indexer = new VaultIndexer(vault, db);
    const scan = indexer.indexVaultFull();
    await reading;
    // The app's rename: the file moves, the queue moves its row (SyncQueue.queueRename).
    await fs.rename(path.join(root, "Folder/Note.md"), path.join(root, "Folder/Renamed.md"));
    await new SyncQueue(db).queueRename("Folder/Note.md", "Folder/Renamed.md");
    release();
    await scan;
    expect(await rows(), "no row under the old name").not.toContain("Folder/Note.md");
    // The shell follows up as it does after every rename (relocate, then read the destination).
    await indexer.relocatePathInIndex("Folder/Note.md", "Folder/Renamed.md");
    await indexer.indexPath("Folder/Renamed.md");
    expect(await rows()).toEqual(["Folder/Renamed.md"]);
    expect((await new VaultQueryService(db).searchFullText("zeppelin")).map((hit) => hit.path)).toEqual(["Folder/Renamed.md"]);
  });

  it("an indexed note the app renames is not written back under its old name, also where the sync sent the move before the scan writes", async () => {
    await anIndexedNoteChangedElsewhere();
    const { vault, release, reading } = holdingReads("Folder/Note.md", true);
    const indexer = new VaultIndexer(vault, db);
    const scan = indexer.indexVaultFull();
    await reading;
    await fs.rename(path.join(root, "Folder/Note.md"), path.join(root, "Folder/Renamed.md"));
    await new SyncQueue(db).queueRename("Folder/Note.md", "Folder/Renamed.md");
    // The sync worker sent the move and took it off the queue: only the row, now elsewhere, says it moved.
    await db.execute("DELETE FROM offline_queue WHERE operation = 'rename'");
    release();
    await scan;
    expect(await rows()).toEqual(["Folder/Renamed.md"]);
  });

  it("a move the index follows (relocatePathInIndex) before the scan writes keeps the scan's older reading off both ends", async () => {
    await raw.writeTextFile("Folder/Note.md", "# Note\n\nsecond zeppelin\n");
    const { vault, release, reading } = holdingReads("Folder/Note.md", true);
    const indexer = new VaultIndexer(vault, db);
    const scan = indexer.indexVaultFull();
    await reading;
    // A move the queue does not know (no sync): only the index is told.
    await fs.rename(path.join(root, "Folder/Note.md"), path.join(root, "Folder/Moved.md"));
    await indexer.relocatePathInIndex("Folder/Note.md", "Folder/Moved.md");
    release();
    await scan;
    expect(await rows()).not.toContain("Folder/Note.md");
  });
});
