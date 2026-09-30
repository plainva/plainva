import { beforeAll, describe, expect, it } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { initializeSchema } from "../src/db/Schema.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { GraphService } from "../src/vault/GraphService.js";
import { SNIPPET_MARK_START } from "../src/vault/ftsQuery.js";
import { questionTerms } from "../src/ai/context/terms.js";

/**
 * Scripts written without spaces on real SQLite FTS5 (node:sqlite, as the CI's
 * Node 22 ships it): the indexer writes the pair columns, the query finds a
 * word in the middle of a sentence, the occurrence list points at it, the
 * mention scan sees a title inside a run — and a version-4 index gains the
 * columns without losing a row or re-reading a note (Gesamtplan Volltextsuche
 * CJK, 2026-09-30).
 */
const NOTES: Record<string, string> = {
  "Notes/議事録.md": "# 議事録\n\n今日は会議の議事録を書いた。来週の打ち合わせも。\n",
  "Notes/予定.md": "2026年9月の会議でPlainvaを使った。コーヒーを飲みながら検索機能を試す。\n",
  "Notes/会议记录.md": "我们在会议上讨论了全文搜索的问题。\n",
  "Notes/ไทย.md": "ภาษาไทยไม่มีช่องว่างระหว่างคำ\n",
  "Notes/Split.md": "東京 大学 and Tokyo University\n",
  "Notes/English.md": "Plain English note about search and the plan.\n",
};

async function indexed() {
  const db = await realSqlite();
  const files = new MemoryVaultAdapter(1_000);
  for (const [path, text] of Object.entries(NOTES)) await files.writeTextFile(path, text);
  await new VaultIndexer(files, db).indexVaultFull();
  return { db, files, query: new VaultQueryService(db) };
}

const paths = async (query: VaultQueryService, text: string) => (await query.searchFullText(text, 50)).map((row) => row.path).sort();

describe("full-text search in scripts without spaces", () => {
  let query: VaultQueryService;
  let db: IDatabaseAdapter;
  beforeAll(async () => ({ db, query } = await indexed()));

  it("finds a word in the middle of a Japanese sentence", async () => {
    expect(await paths(query, "議事録")).toEqual(["Notes/議事録.md"]);
    expect(await paths(query, "打ち合わせ")).toEqual(["Notes/議事録.md"]);
    expect(await paths(query, "コーヒー")).toEqual(["Notes/予定.md"]);
  });

  it("finds Chinese and Thai the same way", async () => {
    expect(await paths(query, "全文搜索")).toEqual(["Notes/会议记录.md"]);
    expect(await paths(query, "ช่องว่าง")).toEqual(["Notes/ไทย.md"]);
  });

  it("finds a single character while typing, and mixed terms with digits", async () => {
    expect(await paths(query, "議")).toEqual(["Notes/予定.md", "Notes/議事録.md"]);
    expect(await paths(query, "9月")).toEqual(["Notes/予定.md"]);
    expect(await paths(query, "2026年")).toEqual(["Notes/予定.md"]);
  });

  it("finds Latin words inside Japanese text, and English as before", async () => {
    expect(await paths(query, "Plainva")).toEqual(["Notes/予定.md"]);
    expect(await paths(query, "plai")).toEqual(["Notes/English.md", "Notes/予定.md"]);
    expect(await paths(query, "search")).toEqual(["Notes/English.md"]);
  });

  it("never matches across a space, and excludes with a minus", async () => {
    expect(await paths(query, "京大")).toEqual([]);
    expect(await paths(query, "東京")).toEqual(["Notes/Split.md"]);
    expect(await paths(query, "会議 -議事録")).toEqual(["Notes/予定.md"]);
  });

  it("points the occurrence list at the word and marks a title found through the pairs", async () => {
    const page = await query.searchOccurrencesPage("議事録");
    const body = page.hits.find((hit) => hit.occurrence);
    expect(body?.occurrence?.quote).toBe("議事録");
    expect(body?.occurrence?.line).toBe(1);
    const titleOnly = (await query.searchFullText("事録", 10)).find((row) => row.path === "Notes/議事録.md");
    expect(titleOnly?.titleHighlighted).toContain(`${SNIPPET_MARK_START}事録`);
  });

  it("keeps the pair columns empty for text in spaced scripts", async () => {
    const rows = await db.query<{ path: string; seg_content: string }>(`SELECT path, seg_content FROM fts_notes WHERE path = 'Notes/English.md'`);
    expect(rows[0].seg_content).toBe("");
  });
});

describe("AI context candidates for a question in a script without spaces", () => {
  // The context package asks FTS5 with the terms of the question; a Japanese
  // question is one run of characters, so its pairs do the asking.
  it("finds the note a Japanese question is about, and English as before", async () => {
    const { query } = await indexed();
    const ja = await query.searchCandidates(questionTerms("会議の議事録はどこに書いた？"), 5);
    expect(ja[0]?.path).toBe("Notes/議事録.md");
    const zh = await query.searchCandidates(questionTerms("全文搜索的问题在哪里讨论过？"), 5);
    expect(zh[0]?.path).toBe("Notes/会议记录.md");
    const en = await query.searchCandidates(questionTerms("Where is the note about search?"), 5);
    expect(en.map((hit) => hit.path)).toContain("Notes/English.md");
  });
});

describe("unlinked mentions in scripts without spaces", () => {
  it("sees a two-character title inside a run and keeps Latin word boundaries", async () => {
    const db = await realSqlite();
    const files = new MemoryVaultAdapter(1_000);
    await files.writeTextFile("会議.md", "# 会議\n");
    await files.writeTextFile("Plan.md", "# Plan\n");
    await files.writeTextFile("Diary.md", "今日は会議の議事録を書いた。The Planet is not a Plan.\n");
    await files.writeTextFile("Other.md", "Planet only.\n");
    await new VaultIndexer(files, db).indexVaultFull();
    const mentions = await new GraphService(db).findUnlinkedMentions({});
    const pairs = mentions.map((m) => `${m.source} -> ${m.target}`).sort();
    expect(pairs).toEqual(["Diary.md -> Plan.md", "Diary.md -> 会議.md"]);
    const focused = await new GraphService(db).findUnlinkedMentions({ forPath: "Diary.md" });
    expect(focused.map((m) => m.target).sort()).toEqual(["Plan.md", "会議.md"]);
  });
});

describe("index format 5 on an existing index", () => {
  /** The table as every index before version 5 has it, with rows and a stored version. */
  async function versionFour(db: IDatabaseAdapter, rows: [string, string, string][]) {
    await db.execute(`DROP TABLE fts_notes`);
    await db.execute(`CREATE VIRTUAL TABLE fts_notes USING fts5(content, title, path UNINDEXED, tokenize = 'unicode61 remove_diacritics 1')`);
    for (const row of rows) await db.execute(`INSERT INTO fts_notes (content, title, path) VALUES (?, ?, ?)`, row);
    await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('index_format_version', '4')`);
    await db.execute(`INSERT INTO files (id, path, title, mtime_local) VALUES ('a', 'ja.md', 'ja', 111), ('b', 'en.md', 'en', 222)`);
  }
  const ROWS: [string, string, string][] = [
    ["今日は会議の議事録を書いた。", "議事録", "ja.md"],
    ["An English note.", "English", "en.md"],
  ];
  const columns = async (db: IDatabaseAdapter) => (await db.query<{ name: string }>(`PRAGMA table_info(fts_notes)`)).map((row) => row.name);
  const version = async (db: IDatabaseAdapter) => (await db.queryOne<{ value: string }>(`SELECT value FROM meta WHERE key = 'index_format_version'`))?.value;

  it("copies the table into its new shape and fills only the notes that need it — nothing is re-read", async () => {
    const db = await realSqlite();
    await versionFour(db, ROWS);
    await initializeSchema(db);
    expect(await columns(db)).toEqual(["content", "title", "path", "seg_content", "seg_title"]);
    expect(await version(db)).toBe("5");
    const rows = await db.query<{ path: string; content: string; seg_content: string | null; seg_title: string | null }>(`SELECT path, content, seg_content, seg_title FROM fts_notes ORDER BY path`);
    expect(rows.map((row) => [row.path, row.content])).toEqual([["en.md", "An English note."], ["ja.md", "今日は会議の議事録を書いた。"]]);
    expect(rows[0].seg_content ?? "").toBe("");
    expect(rows[1].seg_content).toContain("議事 事録");
    expect(rows[1].seg_title).toBe("議事 事録 録");
    // No note is queued for re-reading.
    expect((await db.query<{ mtime_local: number }>(`SELECT mtime_local FROM files ORDER BY path`)).map((row) => row.mtime_local)).toEqual([222, 111]);
    expect((await new VaultQueryService(db).searchFullText("議事録", 10)).map((row) => row.path)).toEqual(["ja.md"]);
  });

  it("finishes a run interrupted between dropping the old table and renaming the copy", async () => {
    const db = await realSqlite();
    await versionFour(db, ROWS);
    // The state such a crash leaves: the copy holds the notes, the old table is gone.
    await db.execute(`CREATE VIRTUAL TABLE fts_notes_next USING fts5(content, title, path UNINDEXED, seg_content, seg_title, tokenize = 'unicode61 remove_diacritics 1')`);
    await db.execute(`INSERT INTO fts_notes_next (content, title, path) SELECT content, title, path FROM fts_notes`);
    await db.execute(`DROP TABLE fts_notes`);
    await initializeSchema(db);
    expect(await columns(db)).toContain("seg_content");
    expect((await db.query<{ path: string }>(`SELECT path FROM fts_notes ORDER BY path`)).map((row) => row.path)).toEqual(["en.md", "ja.md"]);
    expect(await db.queryOne(`SELECT name FROM sqlite_master WHERE name = 'fts_notes_next'`)).toBeNull();
    expect(await version(db)).toBe("5");
  });

  it("does nothing on the next start", async () => {
    const db = await realSqlite();
    await versionFour(db, ROWS);
    await initializeSchema(db);
    const before = await db.query(`SELECT rowid, * FROM fts_notes ORDER BY rowid`);
    await initializeSchema(db);
    expect(await db.query(`SELECT rowid, * FROM fts_notes ORDER BY rowid`)).toEqual(before);
  });
});
