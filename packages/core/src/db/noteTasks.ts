/**
 * The task table of the index: every note's task checkboxes as the indexer
 * read them, so that listing every task of the vault reads one small row per
 * note that has tasks instead of scanning the text of every note again.
 *
 * One row per note this build read, also for a note without a task (an
 * empty `tasks`): its absence is how a reader tells "not read by a build that
 * knows the table" from "no tasks".
 *
 * THE RULE, in one sentence: a row describes the text whose hash it carries,
 * read the way {@link TASK_READING} names, and counts for a `files` row only
 * where its row number, its `sha256` and its reading all match. Tasks are a
 * function of the note's text alone (`scanTasks` and the `plainva.tasks` key
 * of its properties block), so a row that matches is right whatever wrote
 * the `files` row; one that does not match is never shown, and the reader
 * scans that note's text as it always did.
 *
 * Why the hash and not the number of the full-text row: SQLite hands a
 * `files` row number out again (the largest one, once its row is deleted),
 * and a note's full-text row is numbered after it (`-files.rowid`,
 * fullTextRows.ts), so neither number alone ties a row to one text.
 *
 * - The indexer writes the row in the same statements as the `files` row and
 *   the full-text row, from the very text it puts into `fts_notes`.
 * - A deleted `files` row takes its row with it (the trigger
 *   `files_tasks_go`, Schema.ts) — for this build and for any older one,
 *   since the trigger lives in the database.
 * - A build that does not know the table writes `files` rows without one:
 *   those notes are scanned at the read until the next full pass of this
 *   build fills them in from the index's own text ({@link fillNoteTasks}),
 *   without reading a file again. A `REPLACE` by such a build (no delete
 *   trigger fires) leaves a row behind under a number; the hash keeps it
 *   from ever counting for another text.
 *
 * What depends on more than the text stays in the reader: the title (from
 * the full-text row), whether the path is hidden, and whether the note is a
 * daily note (the journal's stamp, `dayOfPath`).
 */
import type { BatchStatement, SqlStatements } from "./IDatabaseAdapter.js";
import { scanTasks, type ScannedTask } from "../vault/taskScan.js";
import { readFrontmatterPath } from "../frontmatter-surgical.js";
import { fullTextRowOf } from "./fullTextRows.js";

/**
 * The way this build reads a note's tasks. Raise it with every change to what
 * a row would hold for the same text: the output of `scanTasks` (its fields,
 * its rules), the reading of `plainva.tasks`, or the text the indexer hands
 * over (`fts_notes.content`). Rows of another reading no longer count; the
 * next full pass reads them anew from the index's own text. A test holds the
 * output for a fixed corpus against this number (`note-tasks-reading.test.ts`).
 */
export const TASK_READING = 1;

export const NOTE_TASKS_TABLE = `CREATE TABLE IF NOT EXISTS note_tasks (
      file_rowid INTEGER PRIMARY KEY,
      sha256     TEXT,
      reading    INTEGER NOT NULL DEFAULT 0,
      excluded   INTEGER NOT NULL DEFAULT 0,
      tasks      TEXT NOT NULL DEFAULT ''
    )`;

export const NOTE_TASKS_GO_WITH_THEIR_FILE = `CREATE TRIGGER IF NOT EXISTS files_tasks_go AFTER DELETE ON files BEGIN
       DELETE FROM note_tasks WHERE file_rowid = OLD.rowid;
     END`;

/** What the table holds for one note's text. */
export interface NoteTasksRow {
  excluded: boolean;
  /** The JSON of `scanTasks`, '' when the note has none. */
  tasks: string;
}

/** The row for a note's text, as the indexer and the fill write it. */
export function noteTasksOf(content: string): NoteTasksRow {
  const scanned = scanTasks(content);
  if (scanned.length === 0) return { excluded: false, tasks: "" };
  // Truth stays in the file: a note opts out of task aggregation by carrying
  // `plainva.tasks: false` in its frontmatter. Only read for a note with tasks,
  // as the list always did.
  const excluded = readFrontmatterPath(content, ["plainva", "tasks"]) === false;
  return { excluded, tasks: JSON.stringify(scanned) };
}

/** The tasks a row holds. */
export function tasksOfRow(tasks: string): ScannedTask[] {
  return tasks ? (JSON.parse(tasks) as ScannedTask[]) : [];
}

/**
 * Writes the row of the note whose `files` row sits at the path — run after
 * that row is inserted, in the same statements (its number is looked up when
 * the statement runs). Parameters: sha256, excluded, tasks, path.
 */
export const INSERT_NOTE_TASKS =
  `INSERT OR REPLACE INTO note_tasks (file_rowid, sha256, reading, excluded, tasks)
   SELECT rowid, ?, ${TASK_READING}, ?, ? FROM files WHERE path = ?`;

/** The statement that writes a note's row, for the text it was read with. */
export function noteTasksStatement(path: string, sha256: string | null, content: string): BatchStatement {
  const row = noteTasksOf(content);
  return { sql: INSERT_NOTE_TASKS, params: [sha256, row.excluded ? 1 : 0, row.tasks, path] };
}

/** A `files` row (alias) whose row in the task table counts, as SQL (alias of that table: `t`). */
export const noteTasksRowCounts = (file: string, tasks: string): string =>
  `${tasks}.file_rowid = ${file}.rowid AND ${tasks}.sha256 IS ${file}.sha256 AND ${tasks}.reading = ${TASK_READING}`;

/**
 * Fills in the rows a note lacks — written by a build that does not know the
 * table, by none yet (an index from before it), or read another way (an
 * older {@link TASK_READING}) — from the index's own
 * text of that note: no file is read, nothing is parsed but the task lines.
 * In slices of `slice` notes, each its own short write; a slice is written
 * only for the text it read (the hash in the statement), so a note saved
 * meanwhile keeps the row its save wrote. Returns how many notes it filled.
 */
export async function fillNoteTasks(
  db: SqlStatements,
  options: { slice?: number; signal?: AbortSignal; write?: (statements: BatchStatement[]) => Promise<void> } = {},
): Promise<number> {
  const slice = options.slice ?? 200;
  const write = options.write ?? (async (statements: BatchStatement[]) => {
    if (db.runBatch) await db.runBatch(statements);
    else for (const s of statements) await db.execute(s.sql, (s.params ?? []) as unknown[]);
  });
  let filled = 0;
  // Every note lacking a row, by its number in `files`; the text comes with
  // each slice, so one read never holds more than a slice of notes' text.
  const missing = await db.query<{ id: number }>(
    `SELECT f.rowid AS id FROM files f
     WHERE f.mode IS NOT 'attachment' AND f.path LIKE '%.md'
       AND NOT EXISTS (SELECT 1 FROM note_tasks t WHERE ${noteTasksRowCounts("f", "t")})
     ORDER BY f.rowid`,
  );
  for (let i = 0; i < missing.length; i += slice) {
    options.signal?.throwIfAborted();
    const ids = missing.slice(i, i + slice).map((row) => Number(row?.id)).filter(Number.isInteger);
    if (ids.length === 0) continue;
    const marks = ids.map(() => "?").join(",");
    const rows = await db.query<{ id: number; sha256: string | null; content: string | null }>(
      `SELECT f.rowid AS id, f.sha256 AS sha256, n.content AS content
       FROM files f JOIN fts_notes n ON n.rowid = ${fullTextRowOf("f")} AND n.path = f.path
       WHERE f.rowid IN (${marks})`,
      ids,
    );
    options.signal?.throwIfAborted();
    const statements: BatchStatement[] = [];
    for (const row of rows) {
      if (!Number.isInteger(Number(row?.id))) continue;
      const tasks = noteTasksOf(String(row.content ?? ""));
      statements.push({
        sql: `INSERT OR REPLACE INTO note_tasks (file_rowid, sha256, reading, excluded, tasks)
              SELECT rowid, sha256, ${TASK_READING}, ?, ? FROM files WHERE rowid = ? AND sha256 IS ?`,
        params: [tasks.excluded ? 1 : 0, tasks.tasks, row.id, row.sha256],
      });
    }
    if (statements.length) await write(statements);
    filled += statements.length;
  }
  return filled;
}
