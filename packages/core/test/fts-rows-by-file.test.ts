import { describe, expect, it } from "vitest";
import { realSqlite, beforeEveryWrite } from "./helpers/realSqlite.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { initializeSchema } from "../src/db/Schema.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { GraphService } from "../src/vault/GraphService.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";

/**
 * Index format 9 (Gesamtplan Leistung L1, db/fullTextRows.ts): a note's
 * full-text row carries the negated number of its file's row, and every write
 * reaches it through that number. Proven on real SQLite FTS5: the rows keep
 * to the rule through every write, a format-8 index is converted without a
 * note being read, every reader answers exactly as before, an interrupted
 * conversion finishes on the next start, and rows an older app writes after a
 * downgrade are numbered on the next start.
 */

const NOTES: Record<string, string> = {
  "Projects/Alpha.md": "---\ntitle: Alpha project\ntags: [work]\n---\n# Alpha\n\nThe kickoff for Alpha. See [[Beta]] and [[Gamma notes]].\n\n- [ ] Draft the plan 📅 2026-12-01\n- [x] Book the room\n",
  "Projects/Beta.md": "# Beta\n\nBeta follows Alpha. Müller reviews the kickoff notes.\n\n- [ ] Review #work\n",
  "Projects/Gamma notes.md": "Gamma mentions Alpha and Beta without links. kickoff kickoff.\n",
  "Journal/2026-11-10.md": "- 09:00 kickoff call\n- 10:30 wrote about Alpha\n\n- [ ] Send minutes\n",
  "Notes/議事録.md": "# 議事録\n\n今日は会議の議事録を書いた。来週の打ち合わせも。\n",
  "Notes/会议记录.md": "我们在会议上讨论了全文搜索的问题。\n",
  "Notes/Plain.md": "A plain note about search and the plan. #topic\n",
  "Notes/Template.md": "---\ntemplateFor: daily\n---\n- [ ] tasks for the day\n",
  "Archive/Old.md": "An old note that mentions Beta once. Müller too.\n",
};

const SEARCHES = ["kickoff", "Alpha", "Beta -Gamma", "Müller", "muller", "plan", "議事録", "打ち合わせ", "全文搜索", "path:projects kickoff", "tag:work", "kick", "nothing-here"];

async function vaultWith(notes: Record<string, string>) {
  const files = new MemoryVaultAdapter(1_000);
  for (const [path, text] of Object.entries(notes)) await files.writeTextFile(path, text);
  return files;
}

/** Every reader of `fts_notes` the app has, answered as plain data. */
async function answers(db: IDatabaseAdapter) {
  const query = new VaultQueryService(db);
  const out: Record<string, unknown> = {};
  for (const text of SEARCHES) {
    out[`search ${text}`] = await query.searchFullText(text, 50);
    out[`source ${text}`] = await query.searchFullText(text, 50, 0, true);
    out[`occurrences ${text}`] = await query.searchOccurrencesPage(text);
  }
  out.candidates = await query.searchCandidates(["kickoff", "議事録", "plan"]);
  // The readers of the whole table answer in the order the rows lie in it;
  // that order is checked on its own (the conversion test), here only what
  // they say.
  const sorted = <T,>(rows: T[]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  out.tasks = sorted(await query.listTasks());
  out.templates = sorted(await query.listTemplateKeyNotes());
  out.find = sorted(await query.findInVault("Alpha"));
  out.tagged = sorted(await query.findNotesWithTag("work"));
  out.cards = await query.getCardData(Object.keys(NOTES));
  out.cardSearch = sorted(await query.searchCardContent(Object.keys(NOTES), "müller"));
  out.containing = await query.notesContaining(["Beta"]);
  out.mentions = sorted(await new GraphService(db).findUnlinkedMentions());
  return out;
}

/** Rows that break the rule: a number no file has, or a file at that number under another path. */
async function strayRows(db: IDatabaseAdapter) {
  return db.query<{ rowid: number; path: string }>(
    `SELECT n.rowid AS rowid, n.path AS path FROM fts_notes n LEFT JOIN files f ON f.rowid = -n.rowid WHERE f.path IS NOT n.path`,
  );
}
const ftsCount = async (db: IDatabaseAdapter) => Number((await db.queryOne<{ n: number }>(`SELECT count(*) AS n FROM fts_notes`))!.n);
const version = async (db: IDatabaseAdapter) => (await db.queryOne<{ value: string }>(`SELECT value FROM meta WHERE key = 'index_format_version'`))?.value;
const mtimes = async (db: IDatabaseAdapter) => db.query(`SELECT path, mtime_local FROM files ORDER BY path`);

/**
 * The full-text table as an index of format 8 holds it: the same rows, but
 * numbered by SQLite in the order they were written — the order of the files.
 */
async function asFormatEight(db: IDatabaseAdapter) {
  await db.execute(`CREATE VIRTUAL TABLE fts_old USING fts5(content, title, path UNINDEXED, seg_content, seg_title, tokenize = 'unicode61 remove_diacritics 1')`);
  await db.execute(`INSERT INTO fts_old (content, title, path, seg_content, seg_title) SELECT content, title, path, seg_content, seg_title FROM fts_notes ORDER BY rowid DESC`);
  await db.execute(`DROP TABLE fts_notes`);
  await db.execute(`ALTER TABLE fts_old RENAME TO fts_notes`);
  await db.execute(`UPDATE meta SET value = '8' WHERE key = 'index_format_version'`);
}

describe("full-text rows numbered after their files (index format 9)", () => {
  it("keeps every row at the negated number of its file through indexing, saving, moving and deleting", async () => {
    const db = await realSqlite();
    const files = await vaultWith(NOTES);
    const indexer = new VaultIndexer(files, db);
    await indexer.indexVaultFull();
    expect(await ftsCount(db)).toBe(Object.keys(NOTES).length);
    expect(await strayRows(db)).toEqual([]);
    expect(Number((await db.queryOne<{ n: number }>(`SELECT max(rowid) AS n FROM fts_notes`))!.n)).toBeLessThan(0);

    // A save: one row for the note, under its new number, with the new text only.
    await files.writeTextFile("Projects/Beta.md", "# Beta\n\nRewritten with a zeppelin.\n");
    await indexer.indexPath("Projects/Beta.md");
    const query = new VaultQueryService(db);
    expect((await query.searchFullText("zeppelin")).map((r) => r.path)).toEqual(["Projects/Beta.md"]);
    expect((await query.searchFullText("Müller")).map((r) => r.path)).toEqual(["Archive/Old.md"]);
    expect(await ftsCount(db)).toBe(Object.keys(NOTES).length);
    expect(await strayRows(db)).toEqual([]);

    // A move in the app: the file's row keeps its number, so does the search row.
    await files.renameItem("Projects", "Done");
    await indexer.relocatePathInIndex("Projects", "Done");
    await indexer.indexVaultFull();
    expect((await query.searchFullText("zeppelin")).map((r) => r.path)).toEqual(["Done/Beta.md"]);
    expect(await strayRows(db)).toEqual([]);

    // A rename the sync queue moved first (it moves `files`, not the search
    // table): the next pass reaches the old search row by its number.
    await files.renameItem("Notes/Plain.md", "Notes/Renamed.md");
    await new SyncQueue(db).queueRename("Notes/Plain.md", "Notes/Renamed.md");
    await indexer.indexVaultFull();
    expect((await db.query<{ path: string }>(`SELECT path FROM fts_notes WHERE path LIKE 'Notes/%' ORDER BY path`)).map((r) => r.path))
      .toEqual(["Notes/Renamed.md", "Notes/Template.md", "Notes/会议记录.md", "Notes/議事録.md"]);
    expect(await strayRows(db)).toEqual([]);

    // A deletion takes the search row with it.
    await files.deleteItem("Archive/Old.md");
    await indexer.removePathFromIndex("Archive/Old.md");
    expect((await query.searchFullText("Müller")).map((r) => r.path)).toEqual([]);
    expect(await ftsCount(db)).toBe(Object.keys(NOTES).length - 1);
    expect(await strayRows(db)).toEqual([]);

    // A rebuild keeps the rule and leaves no row behind.
    await indexer.rebuildIndex();
    expect(await ftsCount(db)).toBe(Object.keys(NOTES).length - 1);
    expect(await strayRows(db)).toEqual([]);
  });

  it("converts a format-8 index without reading a note, and every reader answers as before", async () => {
    const db = await realSqlite();
    await new VaultIndexer(await vaultWith(NOTES), db).indexVaultFull();
    await asFormatEight(db);
    expect(Number((await db.queryOne<{ n: number }>(`SELECT min(rowid) AS n FROM fts_notes`))!.n)).toBeGreaterThan(0);
    const before = await answers(db);
    const stamps = await mtimes(db);
    // How a reader of format 8 listed the whole table: by the rows' numbers.
    const listedBefore = (await db.query<{ path: string }>(`SELECT path FROM fts_notes`)).map((r) => r.path);

    await initializeSchema(db);

    // The listing readers keep that order (`ORDER BY rowid DESC` over `-files.rowid`).
    const listedAfter = [...new Set((await new VaultQueryService(db).listTasks()).map((t) => t.path))];
    expect(listedAfter).toEqual(listedBefore.filter((p) => listedAfter.includes(p)));
    const inOldOrder = (paths: string[]) => listedBefore.filter((p) => paths.includes(p));
    const found = (await new VaultQueryService(db).findInVault("a")).map((r) => r.path);
    expect(found.length).toBeGreaterThan(3);
    expect(found).toEqual(inOldOrder(found));
    const mentioning = (await new GraphService(db).findUnlinkedMentions()).map((m) => m.source);
    expect(mentioning.length).toBeGreaterThan(1);
    expect(mentioning).toEqual(inOldOrder(mentioning));
    const cardHits = await new VaultQueryService(db).searchCardContent(Object.keys(NOTES), "müller");
    expect(cardHits).toEqual(inOldOrder(cardHits));

    expect(await version(db)).toBe("9");
    expect(await strayRows(db)).toEqual([]);
    expect(await ftsCount(db)).toBe(Object.keys(NOTES).length);
    // Nothing is queued for reading again: the conversion is a copy.
    expect(await mtimes(db)).toEqual(stamps);
    expect(await answers(db)).toEqual(before);
    // And a start that finds nothing to do changes nothing.
    const rows = await db.query(`SELECT rowid, * FROM fts_notes ORDER BY rowid`);
    await initializeSchema(db);
    expect(await db.query(`SELECT rowid, * FROM fts_notes ORDER BY rowid`)).toEqual(rows);
  });

  it("leaves rows no file has behind and keeps the latest of two rows of one path", async () => {
    const db = await realSqlite();
    await new VaultIndexer(await vaultWith(NOTES), db).indexVaultFull();
    await asFormatEight(db);
    await db.execute(`INSERT INTO fts_notes (content, title, path, seg_content, seg_title) VALUES ('an orphan', 'Orphan', 'Orphan.md', '', '')`);
    await db.execute(`INSERT INTO fts_notes (content, title, path, seg_content, seg_title) VALUES ('the latest text of plain', 'Plain', 'Notes/Plain.md', '', '')`);
    await initializeSchema(db);
    expect(await strayRows(db)).toEqual([]);
    expect(await ftsCount(db)).toBe(Object.keys(NOTES).length);
    const plain = await db.query<{ content: string }>(`SELECT content FROM fts_notes WHERE path = 'Notes/Plain.md'`);
    expect(plain.map((r) => r.content)).toEqual(["the latest text of plain"]);
  });

  for (const step of ["DROP TABLE fts_notes", "ALTER TABLE fts_notes_next RENAME TO fts_notes"]) {
    it(`finishes on the next start when the conversion stopped at "${step}"`, async () => {
      const db = await realSqlite();
      await new VaultIndexer(await vaultWith(NOTES), db).indexVaultFull();
      await asFormatEight(db);
      const before = await answers(db);
      // The test adapter replays a batch one statement at a time, as an
      // adapter without a native batch does: a crash can fall between two.
      const undo = beforeEveryWrite(db, (sql) => {
        if (sql.trim() === step) throw new Error("stopped");
      });
      await expect(initializeSchema(db)).rejects.toThrow("stopped");
      undo();
      await initializeSchema(db);
      expect(await db.queryOne(`SELECT name FROM sqlite_master WHERE name = 'fts_notes_next'`)).toBeNull();
      expect(await strayRows(db)).toEqual([]);
      expect(await version(db)).toBe("9");
      expect(await answers(db)).toEqual(before);
    });
  }

  it("numbers what an older app wrote after a downgrade, and search answers as a fresh index does", async () => {
    const db = await realSqlite();
    const files = await vaultWith(NOTES);
    await new VaultIndexer(files, db).indexVaultFull();
    expect(await version(db)).toBe("9");

    // An app of format 8 on this index: it sees a newer format, migrates
    // nothing, and writes with its own statements (VaultIndexer of format 8).
    const olderApp = {
      async reindex(path: string, text: string) {
        await files.writeTextFile(path, text);
        const id = `older:${path}`;
        await db.execute(`DELETE FROM files WHERE id = ? OR path = ?`, [id, path]);
        await db.execute(`DELETE FROM fts_notes WHERE path = ?`, [path]);
        await db.execute(
          `INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state) VALUES (?, ?, ?, 'h', 1, 1, 1, 1, 'obsidian', 'synced')`,
          [id, path, path.replace(/^.*\//, "").replace(/\.md$/, "")],
        );
        await db.execute(`INSERT INTO fts_notes (content, title, path, seg_content, seg_title) VALUES (?, ?, ?, '', '')`, [text, path.replace(/^.*\//, "").replace(/\.md$/, ""), path]);
      },
      async move(from: string, to: string) {
        await files.renameItem(from, to);
        await db.execute(`UPDATE files SET path = ?, mtime_local = 0 WHERE path = ?`, [to, from]);
        await db.execute(`DELETE FROM fts_notes WHERE path = ?`, [to]);
        await db.execute(`UPDATE fts_notes SET path = ? WHERE path = ?`, [to, from]);
      },
      async remove(path: string) {
        await files.deleteItem(path);
        await db.execute(`DELETE FROM files WHERE path IN (?)`, [path]);
        await db.execute(`DELETE FROM fts_notes WHERE path IN (?)`, [path]);
      },
    };
    await olderApp.reindex("Projects/Beta.md", "# Beta\n\nThe older app wrote about a zeppelin.\n");
    await olderApp.reindex("Notes/New.md", "A new note from the older app, about a zeppelin too.\n");
    await olderApp.move("Notes/Plain.md", "Notes/Moved.md");
    await olderApp.remove("Archive/Old.md");
    // The older app finds what it wrote.
    expect((await new VaultQueryService(db).searchFullText("zeppelin")).map((r) => r.path).sort()).toEqual(["Notes/New.md", "Projects/Beta.md"]);

    // Back on this version: the next start numbers the older app's rows.
    await initializeSchema(db);
    expect(await strayRows(db)).toEqual([]);
    const indexer = new VaultIndexer(files, db);
    await indexer.indexVaultFull();
    expect(await strayRows(db)).toEqual([]);

    const fresh = await realSqlite();
    await new VaultIndexer(files, fresh).indexVaultFull();
    const query = new VaultQueryService(db);
    const truth = new VaultQueryService(fresh);
    for (const text of [...SEARCHES, "zeppelin"]) {
      expect((await query.searchFullText(text, 50)).map((r) => r.path), text).toEqual((await truth.searchFullText(text, 50)).map((r) => r.path));
    }
    expect(await ftsCount(db)).toBe(await ftsCount(fresh));

    // And saving keeps working on the repaired index, without a second row.
    await files.writeTextFile("Notes/New.md", "Now about a balloon.\n");
    await indexer.indexPath("Notes/New.md");
    expect((await query.searchFullText("zeppelin")).map((r) => r.path)).toEqual(["Projects/Beta.md"]);
    expect((await query.searchFullText("balloon")).map((r) => r.path)).toEqual(["Notes/New.md"]);
    expect(await strayRows(db)).toEqual([]);
  });
});
