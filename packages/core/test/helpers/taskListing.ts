import { expect } from "vitest";
import type { IDatabaseAdapter } from "../../src/db/IDatabaseAdapter.js";
import { FULL_TEXT_ROW_IS_FILED } from "../../src/db/fullTextRows.js";
import { initializeSchema } from "../../src/db/Schema.js";
import { VaultIndexer } from "../../src/vault/VaultIndexer.js";
import { VaultQueryService, type TaskRecord } from "../../src/vault/VaultQueryService.js";
import { scanTasks } from "../../src/vault/taskScan.js";
import { readFrontmatterPath } from "../../src/frontmatter-surgical.js";
import { isHiddenPath } from "../../src/vault/internalPath.js";
import { splitJournalStamp } from "../../src/journal.js";
import { TASK_READING } from "../../src/db/noteTasks.js";
import { VaultIndexer as VaultIndexerV090 } from "../fixtures/v090/VaultIndexer.js";
import type { MemoryVaultAdapter } from "./memoryVault.js";

/**
 * What the list of every task must answer whatever the task table holds
 * (db/noteTasks.ts): the reading of before the table, kept here word for
 * word, and the states of the table a device can be in — none, half filled
 * in, whole, rows of another reading, rows an older build left — for the
 * core and both shells' database adapters alike.
 */

/** `VaultQueryService.listTasks` as it was before the task table, statement for statement. */
export async function listTasksByScan(db: IDatabaseAdapter, dayOfPath: ((path: string) => string | null) | null = null): Promise<TaskRecord[]> {
  const rows = await db.query<{ path: string; title: string | null; content: string | null }>(
    `SELECT path, title, content FROM fts_notes WHERE ${FULL_TEXT_ROW_IS_FILED} ORDER BY rowid DESC`,
    [],
  );
  const out: TaskRecord[] = [];
  for (const r of rows) {
    if (!r.path || isHiddenPath(r.path)) continue;
    const content = r.content ?? "";
    const scanned = scanTasks(content);
    if (scanned.length === 0) continue;
    const title = r.title || r.path.split("/").pop()!.replace(/\.md$/i, "");
    const excluded = readFrontmatterPath(content, ["plainva", "tasks"]) === false;
    const daily = dayOfPath?.(r.path) != null;
    for (const task of scanned) {
      const stamp = daily ? splitJournalStamp(task.text) : null;
      out.push({ path: r.path, title, excluded, ...task, ...(stamp ? { journalTime: stamp.time } : {}) });
    }
  }
  return out;
}

export const dayOfPath = (path: string) => /^Journal\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path)?.[1] ?? null;

/** Both readings, compared as data and as bytes: same tasks, same order, same fields. */
export async function expectSameAsScan(db: IDatabaseAdapter, label = "") {
  const query = new VaultQueryService(db);
  query.setDayOfPath(dayOfPath);
  const table = await query.listTasks();
  const scan = await listTasksByScan(db, dayOfPath);
  expect(JSON.stringify(table), label).toBe(JSON.stringify(scan));
  expect(table, label).toEqual(scan);
  return table;
}

export const counted = async (db: IDatabaseAdapter, sql: string) => Number((await db.queryOne<{ n: number }>(sql))!.n);

/** Notes the index read without a row in the task table that counts for them. */
export const notesWithoutRow = (db: IDatabaseAdapter) =>
  counted(db, `SELECT count(*) AS n FROM files f WHERE f.path LIKE '%.md' AND NOT EXISTS (SELECT 1 FROM note_tasks t WHERE t.file_rowid = f.rowid AND t.sha256 IS f.sha256 AND t.reading = ${TASK_READING})`);

/** mulberry32, as the fixture generator: the same notes on every run. */
export function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)];
  return { next, int, pick };
}

export const TASK_LINES = [
  "- [ ] plain task",
  "- [x] done task ✅ 2026-10-02",
  "- [/] in progress #work",
  "- [-] cancelled ❌ 2026-09-30",
  "* [ ] star marker 📅 2026-12-01 14:30",
  "1. [ ] numbered ⏫ 🔁 every week",
  "  - [ ] indented subtask",
  "    - detail of the subtask",
  "> - [ ] in a quote",
  "- [ ] 10:15 call Anna",
  "- [ ] with id 🆔 abc ⛔ def",
  "- [X] capital x",
  "- [ ]no space after box",
  "- [] not a task",
  "plain paragraph line",
  "# Heading one",
  "## Heading two",
  "",
  "```",
  "- [ ] inside a fence",
  "```",
  "~~~md",
  "- [ ] inside a tilde fence",
  "~~~",
  "\t- [ ] tab indented",
  "- [ ] task\r",
  "- [ ] 中文任务 #标签",
  "| a | b |",
  "- [ ] dated ➕ 2026-01-02 ⏳ 2026-02-03 🛫 2026-02-01",
  "- [ ] highest 🔺",
  "- [ ] lowest ⏬ 🔽",
  "- [ ] repeats 🔁 every 2 days when done",
  "- [ ] twin 🆔 same 🔁 every week",
];
export const FRONTMATTERS = ["", "---\ntitle: T\n---\n", "---\nplainva:\n  tasks: false\n---\n", "---\nplainva:\n  tasks: true\n---\n", "---\ntags: [a]\n# comment\n---\n", "---\n", "---\nplainva:\n  repeat: weekly\n---\n", "---\nplainva:\n  pim:\n    uid: abc\n---\n"];
const FOLDERS = ["", "Projects/", "Journal/", "Notes/deep/", ".obsidian/", "Templates/"];

export function randomNote(r: ReturnType<typeof random>): string {
  const lines: string[] = [];
  for (let i = r.int(0, 25); i > 0; i--) lines.push(r.pick(TASK_LINES));
  return r.pick(FRONTMATTERS) + lines.join(r.next() < 0.1 ? "\r\n" : "\n");
}
export function randomPath(r: ReturnType<typeof random>, i: number): string {
  const folder = r.pick(FOLDERS);
  if (folder === "Journal/") return `Journal/2026-11-${String((i % 28) + 1).padStart(2, "0")}.md`;
  return `${folder}Note ${i}.md`;
}

/**
 * A clock that is well past every timestamp's tick at each reading: no row
 * waits to be read once more for its timestamp (`readingVouches`), so what a
 * pass reads depends on the vault alone, not on how fast the machine is.
 */
export function steppingClock() {
  let now = 0;
  return () => (now += 60_000);
}

/**
 * Walks the index through every state of the task table a device can be in,
 * and holds `listTasks` to the reading of before at each: whole; none at all
 * (an index from before the table); half filled in; rows of another reading;
 * notes an older build (0.9.0, frozen) wrote in between; and whole again after
 * the next full pass.
 */
export async function expectEveryMixAnswersAsTheScan(db: IDatabaseAdapter, files: MemoryVaultAdapter, indexer: VaultIndexer): Promise<void> {
  await indexer.indexVaultFull();
  expect(await notesWithoutRow(db)).toBe(0);
  await expectSameAsScan(db, "whole");

  await db.execute(`DELETE FROM note_tasks`);
  await expectSameAsScan(db, "none");

  await indexer.indexVaultFull();
  await db.execute(`DELETE FROM note_tasks WHERE file_rowid % 2 = 0`);
  expect(await notesWithoutRow(db)).toBeGreaterThan(0);
  await expectSameAsScan(db, "half filled in");

  await indexer.indexVaultFull();
  await db.execute(`UPDATE note_tasks SET reading = reading + 1, tasks = '[]' WHERE file_rowid % 3 = 0`);
  await expectSameAsScan(db, "rows of another reading");

  await indexer.indexVaultFull();
  const older = new VaultIndexerV090(files, db, { monotonicNow: steppingClock() });
  const paths = (await db.query<{ path: string }>(`SELECT path FROM files WHERE path LIKE '%.md' ORDER BY path`)).map((row) => row.path);
  for (const [i, path] of paths.entries()) {
    if (i % 4 !== 0) continue;
    await files.writeTextFile(path, `- [ ] written while 0.9.0 ran ${i}\n- [x] and ticked\n`);
    await older.indexPath(path);
  }
  await older.indexVaultFull();
  await expectSameAsScan(db, "notes an older build wrote");

  await initializeSchema(db);
  await indexer.indexVaultFull();
  expect(await notesWithoutRow(db)).toBe(0);
  await expectSameAsScan(db, "whole again");
}

/** A vault of random notes, for the shells' own tests. */
export async function writeRandomNotes(files: MemoryVaultAdapter, seed: number, count: number): Promise<void> {
  const r = random(seed);
  const written = new Set<string>();
  for (let i = 0; i < count; i++) {
    const path = randomPath(r, i);
    if (written.has(path)) continue;
    written.add(path);
    await files.writeTextFile(path, randomNote(r));
  }
}
