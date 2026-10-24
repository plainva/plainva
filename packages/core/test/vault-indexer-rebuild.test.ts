import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";

/**
 * "Rebuild the index" rebuilds it — the same way in both shells (finding
 * 2026-10-12).
 *
 * The phone ran the ordinary scan, which reads only what changed by its
 * timestamp: a note whose content had changed under an unchanged timestamp,
 * or whose index entry was simply wrong, stayed as it was — the very thing
 * the button is for. The desktop dropped every row first and then scanned:
 * every file came back as a NEW one — announced to the sync for an upload
 * nobody needed (one queue entry per file), its stored creation time gone
 * (the pinboard orders cards nobody arranged by it) and the mark that its
 * upload waits gone with it. A row whose file had gone was forgotten without
 * a word, instead of being reported like every other deletion.
 *
 * `VaultIndexer.rebuildIndex` reads every file again and keeps what cannot be
 * read again: creation time, sync label, the merge base. What belongs to no
 * file — search entries, links, tags and properties of rows that are gone — goes.
 */

const sha = async (text: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

let root: string;
let vault: LocalVaultAdapter;
let db: IDatabaseAdapter;
let repo: SyncStateRepository;
let indexer: VaultIndexer;
let fresh: string[];
let foreign: string[];
let gone: string[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-rebuild-"));
  vault = new LocalVaultAdapter(root);
  await vault.initialize();
  db = await realSqlite();
  repo = new SyncStateRepository(db);
  fresh = [];
  foreign = [];
  gone = [];
  indexer = new VaultIndexer(vault, db, {
    onNewLocalFile: (p) => void fresh.push(p),
    onExternalModification: (p) => void foreign.push(p),
    onLocalFileDeleted: (p) => void gone.push(p),
  });
});

afterEach(async () => {
  await db.close();
  await fs.rm(root, { recursive: true, force: true });
});

const found = async (term: string) =>
  (await db.query<{ path: string }>("SELECT path FROM fts_notes WHERE fts_notes MATCH ? ORDER BY path", [term])).map((r) => r.path);
const row = (p: string) => db.queryOne<{ ctime: number; sync_state: string; title: string }>("SELECT ctime, sync_state, title FROM files WHERE path = ?", [p]);

/** A synced vault whose index is out of step with two files — and holds a row of a third that is gone. */
async function aStaleIndex(): Promise<void> {
  await vault.writeTextFile("Plan.md", "# Plan\n\nsee [[Ideas]]\n");
  await vault.writeTextFile("Ideas.md", "# Ideas\n");
  await vault.writeTextFile("Data.csv", "id;name\n");
  await vault.writeTextFile("Gone.md", "# Gone\n");
  await indexer.indexVaultFull("open, empty index");
  for (const [p, text] of [["Plan.md", "# Plan\n\nsee [[Ideas]]\n"], ["Ideas.md", "# Ideas\n"], ["Data.csv", "id;name\n"], ["Gone.md", "# Gone\n"]]) {
    await repo.updateLocalHashAndBaseText(p, await sha(text), text);
    await repo.updateBaseState(p, await sha(text), "etag-1");
    await repo.updateRemoteState(p, "etag-1", null, 1);
  }
  await db.execute("UPDATE files SET ctime = 111, sync_state = 'local_ahead' WHERE path = 'Ideas.md'");
  // A note whose index entry is out of step with it under a timestamp that
  // matches — another program changed it within the timestamp's resolution,
  // or an older version indexed it wrongly: an ordinary scan does not look.
  await fs.writeFile(path.join(root, "Plan.md"), "# Plan\n\nsee [[Ideas]] and the zeppelin\n", "utf8");
  await db.execute("UPDATE files SET mtime_local = ? WHERE path = 'Plan.md'", [(await vault.getFileInfo("Plan.md")).mtime]);
  // A file goes while nobody looks, and a search entry stays behind without a file.
  await fs.rm(path.join(root, "Gone.md"));
  await db.execute("INSERT INTO fts_notes (content, title, path, seg_content, seg_title) VALUES ('an orphan', 'Orphan', 'Orphan.md', '', '')");
  fresh.length = 0;
  foreign.length = 0;
  gone.length = 0;
}

describe("rebuilding the index", () => {
  it("reads every file again — a note changed under an unchanged timestamp is found by its new words", async () => {
    await aStaleIndex();
    await indexer.rebuildIndex();
    expect(await found("zeppelin")).toEqual(["Plan.md"]);
    // The change was made by another program; the sync hears of it like of any other.
    expect(foreign).toEqual(["Plan.md"]);
  });

  it("keeps what it cannot read again: the creation time, the waiting upload, the merge base", async () => {
    await aStaleIndex();
    await indexer.rebuildIndex();
    expect(await row("Ideas.md")).toMatchObject({ ctime: 111, sync_state: "local_ahead" });
    expect(await repo.getSyncState("Ideas.md")).toMatchObject({ base_text: "# Ideas\n", base_sha256: await sha("# Ideas\n") });
  });

  it("announces no file the sync knows as new", async () => {
    await aStaleIndex();
    await indexer.rebuildIndex();
    expect(fresh).toEqual([]);
  });

  it("reports a file that went like every scan does, and drops what belongs to no file", async () => {
    await aStaleIndex();
    const report = await indexer.rebuildIndex();
    expect(gone).toEqual(["Gone.md"]);
    expect(report.removed).toBe(1);
    expect(await found("orphan")).toEqual([]);
    expect((await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path)).toEqual(["Data.csv", "Ideas.md", "Plan.md"]);
  });

  it("…and a rebuild asked for while a scan is under way waits for it and then reads everything", async () => {
    await aStaleIndex();
    const list = vault.listDir.bind(vault);
    let scanUnderWay: Promise<unknown> | null = null;
    vault.listDir = async (...args) => {
      vault.listDir = list;
      // The rebuild is asked for after the running scan has read the index.
      if (!scanUnderWay) scanUnderWay = indexer.rebuildIndex();
      return list(...args);
    };
    await indexer.indexVaultFull("return to the app");
    await scanUnderWay;
    expect(await found("zeppelin")).toEqual(["Plan.md"]);
  });

  it("…and a scan that begins between the rebuild's wait and its reset is not taken for the rebuild", async () => {
    await aStaleIndex();
    // The scan reads the index's timestamps before the reset and goes on after it.
    const query = db.query.bind(db);
    let armed = false;
    let readTheIndex: () => void = () => undefined;
    const scanHasRead = new Promise<void>((resolve) => { readTheIndex = resolve; });
    let letItGoOn: () => void = () => undefined;
    const afterTheReset = new Promise<void>((resolve) => { letItGoOn = resolve; });
    db.query = (async (sql: string, params?: unknown[]) => {
      const rows = await query(sql, params);
      if (armed && sql.startsWith("SELECT rowid, path, mtime_local FROM files")) {
        armed = false;
        readTheIndex();
        await afterTheReset;
      }
      return rows;
    }) as typeof db.query;
    const transaction = db.transaction.bind(db);
    let theReset = true;
    db.transaction = (async (fn: () => Promise<unknown>) => {
      if (!theReset) return transaction(fn);
      theReset = false;
      armed = true;
      void indexer.indexVaultFull("watcher: rescan requested");
      await scanHasRead;
      const done = await transaction(fn);
      letItGoOn();
      return done;
    }) as typeof db.transaction;

    await indexer.rebuildIndex();
    expect(await found("zeppelin")).toEqual(["Plan.md"]);
  });
});
