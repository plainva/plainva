import { describe, expect, it } from "vitest";
import { realSqlite, beforeEveryWrite } from "./helpers/realSqlite.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { initializeSchema, FULL_TEXT_NUMBERING_DIAGNOSTIC, planFullTextNumbering, readIndexDiagnostics } from "../src/db/Schema.js";
import { FULL_TEXT_SENTINEL, UNNUMBERED_FLAG } from "../src/db/fullTextRows.js";
import type { BatchStatement, IDatabaseAdapter, SqlStatements } from "../src/db/IDatabaseAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { GraphService } from "../src/vault/GraphService.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import { replaceAllInText } from "../src/vault/findReplace.js";

/**
 * Index format 9 (Gesamtplan Leistung L1, db/fullTextRows.ts): the `files`
 * row names its full-text row, every write reaches the row by that number, a
 * deleted file takes its row with it, and an insert by an older build raises
 * a flag the next start answers. Proven on real SQLite FTS5: the rule through
 * every write, a format-8 index numbered without tokenizing a note again, a
 * downgrade to v0.8.7 and back — with realistic row numbers, the older build's
 * statements word for word — a numbering that fails, and readers that never
 * show a row twice or for a note that is gone.
 */

const NOTES: Record<string, string> = {
  "Projects/Alpha.md": "---\ntitle: Alpha project\ntags: [work]\n---\n# Alpha\n\nThe kickoff for Alpha plan. See [[Beta]] and [[Gamma notes]].\n\n- [ ] Draft the plan 📅 2026-12-01\n- [x] Book the room\n",
  "Projects/Beta.md": "# Beta\n\nBeta follows Alpha. Müller reviews the kickoff notes.\n\n- [ ] Review #work\n",
  "Projects/Gamma notes.md": "Gamma mentions Alpha and Beta without links. kickoff kickoff.\n",
  "Journal/2026-11-10.md": "- 09:00 kickoff call\n- 10:30 wrote about Alpha\n\n- [ ] Send minutes\n",
  "Notes/議事録.md": "# 議事録\n\n今日は会議の議事録を書いた。来週の打ち合わせも。\n",
  "Notes/会议记录.md": "我们在会议上讨论了全文搜索的问题。\n",
  "Notes/Plain.md": "A plain note about search and the plan. #topic\n",
  "Notes/Template.md": "---\ntemplateFor: daily\n---\n- [ ] tasks for the day\n",
  "Archive/Old.md": "An old note that mentions Beta once. Müller too.\n",
};
const SEARCHES = ["kickoff", "Alpha", "Beta -Gamma", "Müller", "muller", "plan", "議事録", "打ち合わせ", "全文搜索", "path:projects kickoff", "tag:work", "kick", "nothing-here", "zeppelin", "balloon"];

async function vaultWith(notes: Record<string, string>) {
  const files = new MemoryVaultAdapter(1_000);
  for (const [path, text] of Object.entries(notes)) await files.writeTextFile(path, text);
  return files;
}

/** Every reader of `fts_notes`, as plain data, in an order that does not depend on row numbers. */
async function answers(db: IDatabaseAdapter) {
  const query = new VaultQueryService(db);
  const sorted = <T,>(rows: T[]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const out: Record<string, unknown> = {};
  for (const text of SEARCHES) {
    out[`search ${text}`] = await query.searchFullText(text, 50);
    out[`source ${text}`] = await query.searchFullText(text, 50, 0, true);
    out[`occurrences ${text}`] = await query.searchOccurrencesPage(text);
  }
  out.operators = await query.searchFullText("path:notes", 50, 0, true);
  out.candidates = await query.searchCandidates(["kickoff", "議事録", "plan"]);
  out.tasks = sorted(await query.listTasks());
  out.templates = sorted(await query.listTemplateKeyNotes());
  out.find = sorted(await query.findInVault("Alpha"));
  out.tagged = sorted(await query.findNotesWithTag("work"));
  out.cards = await query.getCardData(Object.keys(NOTES).concat("Notes/New.md"));
  out.cardSearch = sorted(await query.searchCardContent(Object.keys(NOTES).concat("Notes/New.md"), "müller"));
  out.containing = await query.notesContaining(["Beta"]);
  out.mentions = sorted(await new GraphService(db).findUnlinkedMentions());
  out.mentionsOf = sorted(await new GraphService(db).findUnlinkedMentions({ forPath: "Projects/Gamma notes.md" }));
  return out;
}

/** Rows no file names under their path, and paths with more than one row. */
async function strays(db: IDatabaseAdapter) {
  const unfiled = await db.query<{ rowid: number; path: string }>(
    `SELECT n.rowid AS rowid, n.path AS path FROM fts_notes n
     WHERE NOT (n.rowid = 0 AND n.path = '') AND NOT EXISTS (SELECT 1 FROM files f WHERE f.path = n.path AND (CASE f.fts_rowid WHEN 0 THEN -f.rowid ELSE f.fts_rowid END) = n.rowid)`,
  );
  const twice = await db.query<{ path: string; n: number }>(`SELECT path, count(*) AS n FROM fts_notes GROUP BY path HAVING count(*) > 1`);
  const unnamed = await db.query<{ path: string }>(`SELECT path FROM files WHERE fts_rowid IS NULL`);
  return { unfiled, twice, unnamed };
}
const clean = { unfiled: [], twice: [], unnamed: [] };
/** The sentinel of fullTextRows.ts, and only it, at 0 (an older build's rebuild deletes it; this build's start puts it back). */
const expectSentinel = async (db: IDatabaseAdapter) =>
  expect(await db.query<{ path: string }>(`SELECT path FROM fts_notes WHERE rowid = 0`)).toEqual([{ path: "" }]);
const ftsCount = async (db: IDatabaseAdapter) => Number((await db.queryOne<{ n: number }>(`SELECT count(*) AS n FROM fts_notes WHERE rowid <> 0`))!.n);
const meta = async (db: IDatabaseAdapter, key: string) => (await db.queryOne<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [key]))?.value;
const mtimes = async (db: IDatabaseAdapter) => db.query(`SELECT path, mtime_local FROM files ORDER BY path`);

/** An index whose rows the indexer read twice: row numbers well above 1, as on any vault used for a while. */
async function used(notes = NOTES) {
  const db = await realSqlite();
  const files = await vaultWith(notes);
  const indexer = new VaultIndexer(files, db);
  await indexer.indexVaultFull();
  await indexer.rebuildIndex();
  await indexer.rebuildIndex();
  expect(Number((await db.queryOne<{ n: number }>(`SELECT min(rowid) AS n FROM files`))!.n)).toBeGreaterThan(10);
  return { db, files, indexer };
}

/**
 * The full-text table as an index of format 8 holds it: the same rows,
 * numbered by SQLite in the order they were written, and files rows that name
 * none.
 */
async function asFormatEight(db: IDatabaseAdapter) {
  // An index of format 8 has neither the column's use nor the triggers.
  await db.execute(`DROP TRIGGER IF EXISTS files_takes_its_full_text_row`);
  await db.execute(`DROP TRIGGER IF EXISTS files_full_text_row_goes`);
  await db.execute(`DROP TRIGGER IF EXISTS files_written_by_older_index`);
  await db.execute(`CREATE VIRTUAL TABLE fts_old USING fts5(content, title, path UNINDEXED, seg_content, seg_title, tokenize = 'unicode61 remove_diacritics 1')`);
  // An index of format 8 has no sentinel either.
  await db.execute(`INSERT INTO fts_old (content, title, path, seg_content, seg_title) SELECT content, title, path, seg_content, seg_title FROM fts_notes WHERE rowid <> 0 ORDER BY rowid DESC`);
  await db.execute(`DROP TABLE fts_notes`);
  await db.execute(`ALTER TABLE fts_old RENAME TO fts_notes`);
  await db.execute(`UPDATE files SET fts_rowid = NULL`);
  await db.execute(`UPDATE meta SET value = '8' WHERE key = 'index_format_version'`);
}

/** v0.8.7's VaultIndexer, statement for statement (`git show v0.8.7:packages/core/src/vault/VaultIndexer.ts`). */
function olderBuild(db: IDatabaseAdapter, files: MemoryVaultAdapter) {
  const insertFile = `INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`;
  const title = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");
  return {
    async reindex(path: string, text: string) {
      await files.writeTextFile(path, text);
      const id = `older:${path}`;
      await db.execute(`DELETE FROM files WHERE id = ? OR path = ?`, [id, path]);
      await db.execute(`DELETE FROM fts_notes WHERE path = ?`, [path]);
      await db.execute(insertFile, [id, path, title(path), "h", 1, 1, 1, "obsidian", "synced"]);
      await db.execute(`INSERT INTO fts_notes (content, title, path, seg_content, seg_title) VALUES (?, ?, ?, ?, ?)`, [text, title(path), path, "", ""]);
    },
    /** The parse-error path: a REPLACE of the files row, the search row left alone. */
    async replaceAfterParseError(path: string) {
      await db.execute(
        `INSERT OR REPLACE INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'obsidian', ?)`,
        [`older:${path}`, path, title(path), "h", 1, 1, 1, "synced"],
      );
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
    async rebuild() {
      await db.execute(`UPDATE files SET mtime_local = 0`);
      await db.execute(`DELETE FROM fts_notes WHERE path NOT IN (SELECT path FROM files)`);
    },
  };
}

/** A fresh index of the same vault: what every reader must answer. */
async function truthOf(files: MemoryVaultAdapter) {
  const fresh = await realSqlite();
  await new VaultIndexer(files, fresh).indexVaultFull();
  return fresh;
}
const searchPaths = async (db: IDatabaseAdapter, text: string) => (await new VaultQueryService(db).searchFullText(text, 50)).map((r) => r.path);

describe("full-text rows named by their files (index format 9)", () => {
  it("keeps the rule through indexing, saving, moving, a queued rename, deleting and rebuilding", async () => {
    const { db, files, indexer } = await used();
    expect(await strays(db)).toEqual(clean);
    expect(await ftsCount(db)).toBe(Object.keys(NOTES).length);

    await files.writeTextFile("Projects/Beta.md", "# Beta\n\nRewritten with a zeppelin.\n");
    await indexer.indexPath("Projects/Beta.md");
    expect(await searchPaths(db, "zeppelin")).toEqual(["Projects/Beta.md"]);
    expect(await searchPaths(db, "Müller")).toEqual(["Archive/Old.md"]);
    expect(await strays(db)).toEqual(clean);

    await files.renameItem("Projects", "Done");
    await indexer.relocatePathInIndex("Projects", "Done");
    await indexer.indexVaultFull();
    expect(await searchPaths(db, "zeppelin")).toEqual(["Done/Beta.md"]);
    expect(await strays(db)).toEqual(clean);

    await files.renameItem("Notes/Plain.md", "Notes/Renamed.md");
    await new SyncQueue(db).queueRename("Notes/Plain.md", "Notes/Renamed.md");
    await indexer.indexVaultFull();
    expect(await searchPaths(db, "plain")).toEqual(["Notes/Renamed.md"]);
    expect(await strays(db)).toEqual(clean);

    await files.deleteItem("Archive/Old.md");
    await indexer.removePathFromIndex("Archive/Old.md");
    expect(await searchPaths(db, "Müller")).toEqual([]);
    expect(await strays(db)).toEqual(clean);

    await indexer.rebuildIndex();
    expect(await ftsCount(db)).toBe(Object.keys(NOTES).length - 1);
    expect(await strays(db)).toEqual(clean);
    expect(await meta(db, UNNUMBERED_FLAG)).toBeUndefined();
  });

  it("numbers a format-8 index without reading a note or tokenizing its text again", async () => {
    const { db } = await used();
    const before = await answers(db);
    await asFormatEight(db);
    const numbers = (await db.query<{ rowid: number }>(`SELECT rowid FROM fts_notes ORDER BY rowid`)).map((r) => r.rowid);
    const stamps = await mtimes(db);
    const writes: string[] = [];
    const undo = beforeEveryWrite(db, (sql) => void writes.push(sql));
    await initializeSchema(db);
    undo();
    expect(await meta(db, "index_format_version")).toBe("9");
    // The rows keep their numbers; the files record them. No row is written into the search table.
    expect((await db.query<{ rowid: number }>(`SELECT rowid FROM fts_notes WHERE rowid <> 0 ORDER BY rowid`)).map((r) => r.rowid)).toEqual(numbers);
    // Only the sentinel is written into the search table.
    expect(writes.filter((sql) => /INSERT[^;]*INTO fts_notes|UPDATE fts_notes/.test(sql))).toEqual([FULL_TEXT_SENTINEL]);
    expect(await strays(db)).toEqual(clean);
    expect(await mtimes(db)).toEqual(stamps);
    expect(await answers(db)).toEqual(before);
    // A start that finds nothing to do writes nothing to the search table and the files.
    writes.length = 0;
    const again = beforeEveryWrite(db, (sql) => void writes.push(sql));
    await initializeSchema(db);
    again();
    expect(writes.filter((sql) => /fts_notes|UPDATE files/.test(sql) && !/CREATE (VIRTUAL TABLE|TRIGGER) IF NOT EXISTS/.test(sql))).toEqual([]);
  });

  it("keeps the latest of two rows of one path and drops a row no file has", async () => {
    const { db } = await used();
    await asFormatEight(db);
    await db.execute(`INSERT INTO fts_notes (content, title, path, seg_content, seg_title) VALUES ('an orphan', 'Orphan', 'Orphan.md', '', '')`);
    await db.execute(`INSERT INTO fts_notes (content, title, path, seg_content, seg_title) VALUES ('the latest text of plain', 'Plain', 'Notes/Plain.md', '', '')`);
    await initializeSchema(db);
    expect(await strays(db)).toEqual(clean);
    expect(await ftsCount(db)).toBe(Object.keys(NOTES).length);
    expect((await db.query<{ content: string }>(`SELECT content FROM fts_notes WHERE path = 'Notes/Plain.md'`)).map((r) => r.content)).toEqual(["the latest text of plain"]);
  });

  it("answers what v0.8.7 left after a downgrade: flagged, numbered at the next start, the newest text kept", async () => {
    const { db, files } = await used();
    const older = olderBuild(db, files);
    // Each statement the older build runs against `files` and `fts_notes` in a write.
    await older.reindex("Projects/Beta.md", "# Beta\n\nThe older build wrote about a zeppelin.\n");
    await older.reindex("Notes/New.md", "A new note from the older build, about a zeppelin too. plan\n\n- [ ] older task\n");
    await older.replaceAfterParseError("Projects/Alpha.md");
    await older.move("Notes/Plain.md", "Notes/Moved.md");
    await older.remove("Archive/Old.md");
    // The sentinel at 0 holds SQLite's own numbering above 0: the older build's rows never land among this build's.
    expect((await db.query<{ rowid: number }>(`SELECT rowid FROM fts_notes WHERE path IN ('Projects/Beta.md', 'Notes/New.md') ORDER BY rowid`)).map((r) => r.rowid)).toEqual([1, 2]);
    expect(await meta(db, UNNUMBERED_FLAG)).toBe("1");
    // The older build still finds what it wrote (it reads by path).
    expect((await db.query<{ path: string }>(`SELECT path FROM fts_notes WHERE fts_notes MATCH 'zeppelin' ORDER BY path`)).map((r) => r.path)).toEqual(["Notes/New.md", "Projects/Beta.md"]);
    // Before this build's next start, its readers show nothing twice and nothing gone.
    const query = new VaultQueryService(db);
    expect((await query.findInVault("zeppelin")).map((r) => r.path)).toEqual([]);

    await initializeSchema(db);
    expect(await meta(db, UNNUMBERED_FLAG)).toBeUndefined();
    expect(await strays(db)).toEqual(clean);
    await expectSentinel(db);
    // The newest text of each note, before any note is read again.
    expect((await query.searchFullText("zeppelin")).map((r) => r.path).sort()).toEqual(["Notes/New.md", "Projects/Beta.md"]);
    expect((await query.searchFullText("kickoff")).map((r) => r.path)).toContain("Projects/Alpha.md");

    const indexer = new VaultIndexer(files, db);
    await indexer.indexVaultFull();
    expect(await strays(db)).toEqual(clean);
    const truth = await truthOf(files);
    for (const text of SEARCHES) expect(await searchPaths(db, text), text).toEqual(await searchPaths(truth, text));
    expect(await ftsCount(db)).toBe(await ftsCount(truth));

    // A save on the numbered index: one row for the note, and find & replace writes it once.
    await files.writeTextFile("Notes/New.md", "Now about a balloon and a plan.\n");
    await indexer.indexPath("Notes/New.md");
    expect(await searchPaths(db, "zeppelin")).toEqual(["Projects/Beta.md"]);
    expect(await strays(db)).toEqual(clean);
    const found = await query.findInVault("plan");
    expect(found.filter((r) => r.path === "Notes/New.md")).toHaveLength(1);
    expect((await query.listTasks()).filter((t) => t.text === "older task")).toEqual([]);
  });

  it("is flagged by every write of an older build that can leave a row misnumbered, and by no write of this one", async () => {
    const { db, files, indexer } = await used();
    const older = olderBuild(db, files);
    const flagged = async (act: () => Promise<void>) => {
      await db.execute(`DELETE FROM meta WHERE key = ?`, [UNNUMBERED_FLAG]);
      await act();
      return (await meta(db, UNNUMBERED_FLAG)) === "1";
    };
    // This build's writes: indexing, saving, attachments, moves, deletes, the rebuild.
    expect(await flagged(async () => {
      await files.writeTextFile("Notes/Plain.md", "changed by this build\n");
      await indexer.indexPath("Notes/Plain.md");
      await files.writeBinaryFile("Attachments/pic.png", new Uint8Array([1, 2, 3]));
      await indexer.indexVaultFull();
      await files.renameItem("Notes/Plain.md", "Notes/Plain2.md");
      await indexer.relocatePathInIndex("Notes/Plain.md", "Notes/Plain2.md");
      await indexer.removePathFromIndex("Attachments/pic.png");
      await indexer.rebuildIndex();
    })).toBe(false);
    // The older build: every insert into `files` (a note, a REPLACE) raises it.
    expect(await flagged(() => older.reindex("Projects/Beta.md", "older\n"))).toBe(true);
    expect(await flagged(() => older.replaceAfterParseError("Projects/Alpha.md"))).toBe(true);
    // Its moves, deletes and the start of its rebuild keep every number: no flag, and no stray row.
    await initializeSchema(db);
    expect(await flagged(async () => {
      await older.move("Projects/Gamma notes.md", "Projects/Gamma.md");
      await older.remove("Archive/Old.md");
      await older.rebuild();
    })).toBe(false);
    expect(await strays(db)).toEqual(clean);
  });

  it("shows each note once and its current text, whatever rows an older build left before the next start", async () => {
    const { db } = await used();
    // Two stale rows: one under a note's path with another number, one of a file that is gone.
    await db.execute(`INSERT INTO fts_notes (rowid, content, title, path, seg_content, seg_title) VALUES (77777, 'stale Alpha plan text zeppelin - [ ] stale task', 'Alpha', 'Projects/Alpha.md', '', '')`);
    await db.execute(`INSERT INTO fts_notes (rowid, content, title, path, seg_content, seg_title) VALUES (88888, 'ghost zeppelin - [ ] ghost task #work', 'Ghost', 'Gone.md', '', '')`);
    const query = new VaultQueryService(db);
    expect(await query.searchFullText("zeppelin")).toEqual([]);
    expect((await query.findInVault("plan")).filter((r) => r.path === "Projects/Alpha.md")).toHaveLength(1);
    expect((await query.listTasks()).filter((t) => /stale|ghost/.test(t.text))).toEqual([]);
    expect(await query.findNotesWithTag("work")).not.toContain("Gone.md");
    expect(await query.searchCardContent(["Projects/Alpha.md", "Gone.md"], "zeppelin")).toEqual([]);
    expect((await query.notesContaining(["zeppelin"])).paths).toEqual([]);
    expect((await new GraphService(db).findUnlinkedMentions()).map((m) => m.source)).not.toContain("Gone.md");
    expect((await query.getCardData(["Projects/Alpha.md"]))["Projects/Alpha.md"].content).toContain("The kickoff for Alpha plan.");
    expect((await query.searchFullText("kickoff", 50, 0, true)).find((r) => r.path === "Projects/Alpha.md")?.sourceContent).toContain("The kickoff for Alpha plan.");
    // And a replace across the vault plans the note once, from its current text.
    const plan = await query.findInVault("plan");
    const alpha = plan.filter((r) => r.path === "Projects/Alpha.md");
    expect(alpha).toHaveLength(1);
    expect(replaceAllInText(NOTES["Projects/Alpha.md"], "plan", "plans").content).toContain("Alpha plans.");
  });

  it("reads each note once, from its current text, after a save, a move and a parse error on a converted index", async () => {
    const { db, files, indexer } = await used();
    await asFormatEight(db);
    await initializeSchema(db);
    const query = new VaultQueryService(db);
    const onceEach = async () => {
      const listed = (await query.findInVault("e")).map((r) => r.path);
      expect(new Set(listed).size).toBe(listed.length);
      const tasks = await query.listTasks();
      const keys = tasks.map((t) => `${t.path}#${t.ordinal}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(await strays(db)).toEqual(clean);
      return listed;
    };
    await files.writeTextFile("Projects/Beta.md", "# Beta\n\nSaved again, with an e.\n- [ ] new task\n");
    await indexer.indexPath("Projects/Beta.md");
    expect((await query.listTasks()).filter((t) => t.path === "Projects/Beta.md").map((t) => t.text)).toEqual(["new task"]);
    await onceEach();
    await files.renameItem("Projects/Beta.md", "Done/Beta.md");
    await indexer.relocatePathInIndex("Projects/Beta.md", "Done/Beta.md");
    await indexer.indexPath("Done/Beta.md");
    expect(await onceEach()).toContain("Done/Beta.md");
    // A note whose reading fails half way (the indexer's catch): its row is the
    // current text, under the file row the catch writes anew.
    await files.writeTextFile("Notes/Plain.md", "A plain note about a zeppelin [[Beta]].\n");
    let failed = false;
    const undo = beforeEveryWrite(db, (sql) => {
      if (!failed && /^INSERT INTO links/.test(sql.trim())) {
        failed = true;
        throw new Error("reading failed");
      }
    });
    await indexer.indexPath("Notes/Plain.md");
    undo();
    expect(failed).toBe(true);
    expect(await searchPaths(db, "zeppelin")).toEqual(["Notes/Plain.md"]);
    await onceEach();
  });

  it("never keeps a vault from opening: a numbering that fails at any step builds the full-text index anew", async () => {
    // Each statement the numbering runs; the state below makes it run all of
    // them (a row to drop, a row to move, a number to record).
    const steps = [
      "DROP TABLE IF EXISTS fts_number_map",
      "CREATE TABLE fts_number_map",
      "INSERT INTO fts_number_map",
      "UPDATE files SET fts_rowid = coalesce",
      "DROP TABLE fts_number_map",
      "DELETE FROM fts_notes WHERE rowid IN",
      "CREATE TABLE fts_moving",
      "INSERT INTO fts_moving",
      "INSERT OR REPLACE INTO fts_notes (rowid",
      "DROP TABLE fts_moving",
      "DELETE FROM meta WHERE key",
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('index_format_version'",
    ];
    for (const step of steps) {
      const { db, files } = await used();
      // A row to move: with the sentinel gone (its rebuild), the older build numbers its insert among this build's (below 0).
      await olderBuild(db, files).rebuild();
      await olderBuild(db, files).reindex("Projects/Beta.md", "# Beta\n\nThe older build wrote about a zeppelin.\n");
      // A number to record: a row of a format-8 index (0 and up) whose file names none.
      await files.writeTextFile("Notes/Extra.md", "An extra note about a balloon.\n");
      await db.execute(`INSERT INTO files (id, path, title, mtime_local) VALUES ('extra', 'Notes/Extra.md', 'Extra', 1)`);
      await db.execute(`INSERT INTO fts_notes (rowid, content, title, path, seg_content, seg_title) VALUES (5000, 'An extra note about a balloon.', 'Extra', 'Notes/Extra.md', '', '')`);
      // A row to drop: no file has its path.
      await db.execute(`INSERT INTO fts_notes (content, title, path, seg_content, seg_title) VALUES ('orphan', 'O', 'Orphan.md', '', '')`);
      const ran: string[] = [];
      let thrown = false;
      const undo = beforeEveryWrite(db, (sql) => {
        const text = sql.trim();
        if (text.startsWith(step)) ran.push(step);
        if (!thrown && text.startsWith(step)) {
          thrown = true;
          throw new Error(`stopped at ${step}`);
        }
      });
      await expect(initializeSchema(db), step).resolves.toBeUndefined();
      undo();
      expect(ran.length, `${step} ran`).toBeGreaterThan(0);
      // A count for the diagnostics, nothing of the vault.
      const record = JSON.parse((await meta(db, FULL_TEXT_NUMBERING_DIAGNOSTIC)) ?? "{}");
      expect(Object.keys(record).sort(), step).toEqual(["at", "count"]);
      expect(record.count, step).toBe(1);
      expect(await readIndexDiagnostics(db), step).toEqual([{ kind: "fts-numbering", count: 1 }]);
      expect(await strays(db), step).toEqual(clean);
      expect(await meta(db, UNNUMBERED_FLAG), step).toBeUndefined();
      await new VaultIndexer(files, db).indexVaultFull();
      const truth = await truthOf(files);
      for (const text of SEARCHES) expect(await searchPaths(db, text), `${step}: ${text}`).toEqual(await searchPaths(truth, text));
    }
  });

  it("plans the numbering: the named row or the newest stays, a stray row moves, the rest goes", () => {
    const files = [
      { rowid: 20, path: "a.md", fts_rowid: 0 },
      { rowid: 21, path: "b.md", fts_rowid: null },
      { rowid: 22, path: "c.md", fts_rowid: null },
      { rowid: 23, path: "d.md", fts_rowid: 5 },
    ];
    const rows = [
      { rowid: -20, path: "a.md" },
      { rowid: -9, path: "a.md" },
      { rowid: -10, path: "b.md" },
      { rowid: 3, path: "c.md" },
      { rowid: 5, path: "d.md" },
      { rowid: -8, path: "gone.md" },
    ];
    expect(planFullTextNumbering(rows, files)).toEqual({
      explicit: [{ path: "c.md", num: 3 }, { path: "d.md", num: 5 }],
      drop: [-8, -9],
      move: [-10],
    });
  });

  it("plans the boundary: an older build's rows at -1, 0 and 1 — only above 0 is recorded, 0 and -1 move, the sentinel stays", () => {
    const files = [
      { rowid: 11, path: "one.md", fts_rowid: null },
      { rowid: 12, path: "two.md", fts_rowid: null },
      { rowid: 13, path: "three.md", fts_rowid: null },
    ];
    const rows = [
      { rowid: -1, path: "one.md" },
      { rowid: 0, path: "two.md" },
      { rowid: 1, path: "three.md" },
      { rowid: 0, path: "" },
    ];
    expect(planFullTextNumbering(rows, files)).toEqual({ explicit: [{ path: "three.md", num: 1 }], drop: [], move: [-1, 0] });
    // The sentinel alone is no row to plan.
    expect(planFullTextNumbering([{ rowid: 0, path: "" }], files)).toEqual({ explicit: [], drop: [], move: [] });
  });
});

describe("what an older build can leave while it runs (second review of format 9)", () => {
  const searchable = async (db: IDatabaseAdapter, files: MemoryVaultAdapter, path: string) => {
    const text = await files.readTextFile(path);
    const rows = await new VaultQueryService(db).getCardData([path]);
    expect(rows[path]?.content, path).toBe(text);
  };
  async function everyNoteSearchable(db: IDatabaseAdapter, files: MemoryVaultAdapter) {
    expect(await strays(db)).toEqual(clean);
    await expectSentinel(db);
    for (const f of await files.listDir("", true)) if (!f.isDirectory && f.path.endsWith(".md")) await searchable(db, files, f.path);
  }

  it("a note an older build numbers 0 (the sentinel gone with its rebuild) is moved, never recorded as 0", async () => {
    // A fresh index: every files row is a note, the largest search number is -1.
    const db = await realSqlite();
    const files = await vaultWith(NOTES);
    const indexer = new VaultIndexer(files, db);
    await indexer.indexVaultFull();
    expect(Number((await db.queryOne<{ n: number }>(`SELECT max(rowid) AS n FROM fts_notes WHERE rowid <> 0`))!.n)).toBe(-1);
    const older = olderBuild(db, files);
    // The start of v0.8.7's rebuild deletes every row whose path no file has: the sentinel too.
    await older.rebuild();
    // A note that is not the files row 1, so the largest number left is -1.
    const target = (await db.queryOne<{ path: string }>(`SELECT path FROM files WHERE rowid <> 1 ORDER BY rowid LIMIT 1`))!.path;
    await older.reindex(target, "A note the older build wrote, with a zeppelin.\n");
    expect((await db.queryOne<{ rowid: number }>(`SELECT rowid FROM fts_notes WHERE path = ?`, [target]))!.rowid).toBe(0);

    await initializeSchema(db);
    expect(await meta(db, UNNUMBERED_FLAG)).toBeUndefined();
    const file = (await db.queryOne<{ rowid: number; fts_rowid: number }>(`SELECT rowid, fts_rowid FROM files WHERE path = ?`, [target]))!;
    expect(file.fts_rowid).toBe(0);
    expect((await db.queryOne<{ rowid: number }>(`SELECT rowid FROM fts_notes WHERE path = ?`, [target]))!.rowid).toBe(-file.rowid);
    expect(await searchPaths(db, "zeppelin")).toEqual([target]);
    await everyNoteSearchable(db, files);
  });

  it("an attachment's deletion in an older build leaves another note's text alone, and the next start numbers it", async () => {
    // An attachment is the files row 1: its number -1 has no search row.
    const db = await realSqlite();
    const files = new MemoryVaultAdapter(1_000);
    await files.writeBinaryFile("Attachments/a.png", new Uint8Array([1, 2, 3]));
    const indexer = new VaultIndexer(files, db);
    await indexer.indexVaultFull();
    for (const [path, text] of Object.entries(NOTES)) await files.writeTextFile(path, text);
    await indexer.indexVaultFull();
    expect((await db.queryOne<{ rowid: number }>(`SELECT rowid FROM files WHERE path = 'Attachments/a.png'`))!.rowid).toBe(1);
    const older = olderBuild(db, files);
    await older.rebuild();
    // v0.8.7 reads a note again (not the files row 2, whose number is the largest left): SQLite numbers it -1, the attachment's number.
    const target = (await db.queryOne<{ path: string }>(`SELECT path FROM files WHERE rowid > 2 ORDER BY rowid LIMIT 1`))!.path;
    await older.reindex(target, "# A note\n\nThe older build wrote about a zeppelin.\n");
    expect((await db.queryOne<{ rowid: number }>(`SELECT rowid FROM fts_notes WHERE path = ?`, [target]))!.rowid).toBe(-1);
    // It reads the attachment again (its delete and insert), then removes it: Beta's text stays.
    await db.execute(`DELETE FROM files WHERE id = ? OR path = ?`, ["older:Attachments/a.png", "Attachments/a.png"]);
    await db.execute(
      `INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ["older:Attachments/a.png", "Attachments/a.png", "a.png", "h", 1, 1, 3, "attachment", "synced"],
    );
    expect((await db.queryOne<{ content: string }>(`SELECT content FROM fts_notes WHERE rowid = -1`))?.content).toContain("zeppelin");
    await files.deleteItem("Attachments/a.png");
    await older.remove("Attachments/a.png");
    expect((await db.queryOne<{ content: string }>(`SELECT content FROM fts_notes WHERE path = ?`, [target]))?.content).toContain("zeppelin");

    await initializeSchema(db);
    expect(await searchPaths(db, "zeppelin")).toEqual([target]);
    await everyNoteSearchable(db, files);
  });

  it("hands every note an older build left without a row to the next full pass", async () => {
    const { db, files, indexer } = await used();
    const older = olderBuild(db, files);
    // Its parse-error REPLACE: Alpha's files row anew, its search row left at the old number…
    await older.replaceAfterParseError("Projects/Alpha.md");
    // …and that row gone (an older build's delete by path, a rebuild, anything).
    await db.execute(`DELETE FROM fts_notes WHERE path = ?`, ["Projects/Alpha.md"]);
    await initializeSchema(db);
    expect((await db.queryOne<{ mtime_local: number }>(`SELECT mtime_local FROM files WHERE path = 'Projects/Alpha.md'`))!.mtime_local).toBe(0);
    // The others keep their timestamps: nothing else is read again.
    expect((await db.query(`SELECT path FROM files WHERE mtime_local = 0`)).length).toBe(1);
    await indexer.indexVaultFull();
    expect(await searchPaths(db, "kickoff")).toContain("Projects/Alpha.md");
    await everyNoteSearchable(db, files);
  });
});

describe("the write order the scan's transactions must keep (merge note for the batched scan)", () => {
  /** An adapter that records each batch and each transaction as one unit. */
  async function recording() {
    const db = await realSqlite();
    const units: { kind: "batch" | "tx" | "single"; sql: string[]; params: unknown[][] }[] = [];
    const { transaction, execute } = db;
    db.runBatch = async (statements: BatchStatement[]) => {
      units.push({ kind: "batch", sql: statements.map((s) => s.sql), params: statements.map((s) => (s.params ?? []) as unknown[]) });
      for (const s of statements) await execute.call(db, s.sql, (s.params ?? []) as unknown[]);
    };
    db.transaction = <T,>(fn: (tx: SqlStatements) => Promise<T>) => transaction.call(db, async (tx: SqlStatements) => {
      const unit = { kind: "tx" as const, sql: [] as string[], params: [] as unknown[][] };
      units.push(unit);
      const runBatch = async (statements: BatchStatement[]) => {
        for (const s of statements) { unit.sql.push(s.sql); unit.params.push((s.params ?? []) as unknown[]); await tx.execute(s.sql, (s.params ?? []) as unknown[]); }
      };
      return fn({ ...tx, execute: async (sql, p) => { unit.sql.push(sql); unit.params.push((p ?? []) as unknown[]); await tx.execute(sql, p); }, runBatch });
    }) as Promise<T>;
    return { db, units };
  }
  /** Per note path, the positions of its file delete, file insert and search insert inside the unit that holds them. */
  const orderOf = (unit: { sql: string[]; params: unknown[][] }, path: string) => {
    const at = (re: RegExp) => unit.sql.findIndex((sql, i) => re.test(sql) && (unit.params[i] ?? []).includes(path));
    return { deleteFile: at(/^DELETE FROM files WHERE id = \? OR path = \?/), insertFile: at(/^\s*INSERT INTO files /), insertRow: at(/INSERT OR REPLACE INTO fts_notes/) };
  };

  // One file per transaction (scanTransactionMs 0): the most breaks the scan of
  // feature/w1-app can make, each of them between two notes.
  it("writes each note's file row and search row in one unit: delete, insert, then the search row; a break only between notes", async () => {
    const { db, units } = await recording();
    const files = await vaultWith(NOTES);
    const indexer = new VaultIndexer(files, db, { scanTransactionMs: 0 });
    await indexer.indexVaultFull();
    await indexer.rebuildIndex();
    units.length = 0;
    for (const path of Object.keys(NOTES)) await files.writeTextFile(path, `${NOTES[path]}\nchanged\n`);
    await indexer.indexVaultFull();
    for (const path of Object.keys(NOTES)) {
      const holding = units.filter((u) => u.sql.some((sql, i) => /^\s*INSERT INTO files /.test(sql) && (u.params[i] ?? []).includes(path)));
      expect(holding, path).toHaveLength(1);
      const o = orderOf(holding[0], path);
      expect(o.deleteFile, path).toBeGreaterThanOrEqual(0);
      expect(o.deleteFile, path).toBeLessThan(o.insertFile);
      expect(o.insertFile, path).toBeLessThan(o.insertRow);
    }
    // No write anywhere names a search row by its path any more.
    expect(units.flatMap((u) => u.sql).filter((sql) => /fts_notes WHERE path/.test(sql))).toEqual([]);
  });

  it("deletes a gone file's row and its search row by number, in the last unit of the pass", async () => {
    const { db, units } = await recording();
    const files = await vaultWith(NOTES);
    const indexer = new VaultIndexer(files, db, { scanTransactionMs: 0 });
    await indexer.indexVaultFull();
    units.length = 0;
    await files.deleteItem("Archive/Old.md");
    await indexer.indexVaultFull();
    const deleting = units.filter((u) => u.sql.some((sql, i) => /^DELETE FROM files WHERE path IN/.test(sql) && (u.params[i] ?? []).includes("Archive/Old.md")));
    expect(deleting).toHaveLength(1);
    expect(units.indexOf(deleting[0])).toBe(units.length - 1);
    expect(await strays(db)).toEqual(clean);
    expect(await ftsCount(db)).toBe(Object.keys(NOTES).length - 1);
  });

  it("keeps every search row with its file when a scan of short transactions re-reads the newest row (its number comes back)", async () => {
    const { db } = await recording();
    const files = await vaultWith(NOTES);
    const indexer = new VaultIndexer(files, db, { scanTransactionMs: 0 });
    await indexer.indexVaultFull();
    // The note with the highest row number: read again, its row is deleted and
    // inserted, and SQLite hands the same number out again.
    const top = (await db.queryOne<{ rowid: number; path: string }>(`SELECT rowid, path FROM files ORDER BY rowid DESC LIMIT 1`))!;
    await files.writeTextFile(top.path, `${NOTES[top.path]}
zeppelin
`);
    await files.writeTextFile("Notes/Plain.md", `${NOTES["Notes/Plain.md"]}
balloon
`);
    const report = await indexer.indexVaultFull();
    expect(report.removed).toBe(0);
    expect(await strays(db)).toEqual(clean);
    expect(await searchPaths(db, "zeppelin")).toEqual([top.path]);
    expect(await searchPaths(db, "balloon")).toEqual(["Notes/Plain.md"]);
  });
});
