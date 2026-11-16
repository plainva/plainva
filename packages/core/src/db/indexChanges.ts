import type { SqlStatements } from "./IDatabaseAdapter.js";

/**
 * The index's change journal: every change to what a path holds, or to where
 * a file of it went, that any writer makes in the database — a row moved or
 * removed from the index, a sync row, an entry of either sync queue, an
 * object of the encrypted workspace, a conflict — leaves the path behind, in
 * the order it was made.
 *
 * The index reads a file before the transaction that writes its row. Between
 * the two the file may be saved, moved or removed, by the app or by the sync,
 * and a reading begun before that must not be written over it: a reading of
 * `A/n.md` written after the app moved `A` to `B` is a row for a file that is
 * not there (the next scan reports it deleted, and the sync deletes it on the
 * server); a reading of the text before a save, written after the save
 * recorded the new text's hash, reports the app's own save as a foreign
 * change. Rules tied to one writer each — the sync queue's own entries, a row
 * that left its path, a place among the indexer's reads for its own moves —
 * left gaps where another writer did the same: the encrypted workspace's
 * queue, a move the sync had already sent, a file that had no row yet.
 *
 * So the journal is filled by triggers, by whoever writes, from whichever
 * connection; and where the index changes a path without a row to change —
 * the removal or the move of a file it had not indexed yet — it writes the
 * path itself (`noteIndexChange`). A reading takes the journal's mark
 * (`indexChangeMark`) before it begins; in the transaction that writes it,
 * a change since that mark to its path or to a folder it lies in
 * (`indexChangedSince`) sets it aside, and the pass reads the file again.
 *
 * `indexChangeJournal.test.ts` holds every table with a path column to this
 * list or to a reason why its changes are none of the index's concern: a new
 * table that writes paths cannot stay out of the journal by being forgotten.
 */

export const INDEX_CHANGES_TABLE = "index_changes";

/**
 * The tables whose changes the journal follows, by the triggers below. What a
 * change of each means for a reading of the file at its path:
 *  - `files`: a row moved or removed — the app moved or removed the file, or
 *    another pass found it gone. Also the folder a moved row left: a move of
 *    a folder in the app moves the rows of the files the index holds, and
 *    the files it does not hold yet went with them.
 *  - `sync_state`: the sync, or a save, recorded what the file holds now.
 *  - `offline_queue`, `workspace_queue`: a change the app queued for the
 *    remote, a move above all; the entry is gone again once it went up, the
 *    journal's row stays.
 *  - `workspace_object`: the encrypted workspace placed, moved or removed a file.
 *  - `conflicts`: a conflict was recorded for the file.
 */
export const JOURNALED_TABLES = ["files", "sync_state", "offline_queue", "workspace_queue", "workspace_object", "conflicts"] as const;

const journal = (path: string) => `INSERT INTO ${INDEX_CHANGES_TABLE} (path) SELECT ${path} WHERE ${path} IS NOT NULL;`;

/** The folder of a path, without its slash; NULL at the vault's top level (a reading is never set aside for a change of the vault itself). */
const folderOf = (path: string) => `NULLIF(rtrim(rtrim(${path}, replace(${path}, '/', '')), '/'), '')`;

export const INDEX_CHANGES_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ${INDEX_CHANGES_TABLE} (
     seq  INTEGER PRIMARY KEY AUTOINCREMENT,
     path TEXT NOT NULL
   );`,
  `CREATE TRIGGER IF NOT EXISTS index_changes_files_moved AFTER UPDATE OF path ON files WHEN OLD.path IS NOT NEW.path BEGIN
     ${journal("OLD.path")} ${journal("NEW.path")} ${journal(folderOf("OLD.path"))}
   END`,
  `CREATE TRIGGER IF NOT EXISTS index_changes_files_gone AFTER DELETE ON files BEGIN
     ${journal("OLD.path")}
   END`,
  `CREATE TRIGGER IF NOT EXISTS index_changes_sync_added AFTER INSERT ON sync_state BEGIN
     ${journal("NEW.path")}
   END`,
  `CREATE TRIGGER IF NOT EXISTS index_changes_sync_changed AFTER UPDATE ON sync_state
     WHEN OLD.path IS NOT NEW.path OR OLD.local_sha256 IS NOT NEW.local_sha256 OR OLD.base_sha256 IS NOT NEW.base_sha256 BEGIN
     ${journal("OLD.path")} ${journal("NULLIF(NEW.path, OLD.path)")}
   END`,
  `CREATE TRIGGER IF NOT EXISTS index_changes_sync_gone AFTER DELETE ON sync_state BEGIN
     ${journal("OLD.path")}
   END`,
  `CREATE TRIGGER IF NOT EXISTS index_changes_queued AFTER INSERT ON offline_queue BEGIN
     ${journal("NEW.file_path")} ${journal("NEW.new_path")}
   END`,
  `CREATE TRIGGER IF NOT EXISTS index_changes_workspace_queued AFTER INSERT ON workspace_queue BEGIN
     ${journal("NEW.path")} ${journal("NEW.new_path")}
   END`,
  `CREATE TRIGGER IF NOT EXISTS index_changes_workspace_placed AFTER INSERT ON workspace_object BEGIN
     ${journal("NEW.path")}
   END`,
  `CREATE TRIGGER IF NOT EXISTS index_changes_workspace_changed AFTER UPDATE ON workspace_object
     WHEN OLD.path IS NOT NEW.path OR OLD.plaintext_sha256 IS NOT NEW.plaintext_sha256 OR OLD.deleted IS NOT NEW.deleted BEGIN
     ${journal("OLD.path")} ${journal("NULLIF(NEW.path, OLD.path)")} ${journal(folderOf("OLD.path"))}
   END`,
  `CREATE TRIGGER IF NOT EXISTS index_changes_workspace_gone AFTER DELETE ON workspace_object BEGIN
     ${journal("OLD.path")}
   END`,
  `CREATE TRIGGER IF NOT EXISTS index_changes_conflict AFTER INSERT ON conflicts BEGIN
     ${journal("NEW.file_path")}
   END`,
];

/** The journal as it stands: a reading that begins now counts its changes from here. */
export async function indexChangeMark(sql: Pick<SqlStatements, "queryOne">): Promise<number> {
  const row = await sql.queryOne<{ seq: number | null }>(`SELECT MAX(seq) AS seq FROM ${INDEX_CHANGES_TABLE}`);
  return Number(row?.seq ?? 0);
}

/** Notes a change of the index's own that has no row to change (`INDEX_CHANGES_TABLE`). */
export async function noteIndexChange(paths: Iterable<string>, sql: Pick<SqlStatements, "execute">): Promise<void> {
  const unique = [...new Set(paths)].filter((path) => path !== "");
  for (let i = 0; i < unique.length; i += 200) {
    const slice = unique.slice(i, i + 200);
    await sql.execute(`INSERT INTO ${INDEX_CHANGES_TABLE} (path) VALUES ${slice.map(() => "(?)").join(", ")}`, slice);
  }
}

/**
 * Whether a reading of a path that began at a mark is set aside: a change to
 * the path, or to a folder it lies in, was journaled after the mark. Asked in
 * the transaction that would write the readings, for the oldest mark among them.
 */
export async function indexChangedSince(sql: Pick<SqlStatements, "query">, oldestMark: number): Promise<(path: string, mark: number) => boolean> {
  const rows = await sql.query<{ seq: number; path: string }>(
    `SELECT seq, path FROM ${INDEX_CHANGES_TABLE} WHERE seq > ?`, [oldestMark]);
  if (rows.length === 0) return () => false;
  // The newest change of each path.
  const newest = new Map<string, number>();
  for (const row of rows) {
    const seq = Number(row.seq);
    if ((newest.get(row.path) ?? -1) < seq) newest.set(row.path, seq);
  }
  return (path, mark) => {
    for (let at = path; at !== ""; at = at.includes("/") ? at.slice(0, at.lastIndexOf("/")) : "") {
      if ((newest.get(at) ?? -1) > mark) return true;
    }
    return false;
  };
}

/** Forgets the changes no reading can be older than: up to `floor`, or all of them where no reading is under way (null). */
export async function trimIndexChanges(sql: Pick<SqlStatements, "execute">, floor: number | null): Promise<void> {
  if (floor === null) await sql.execute(`DELETE FROM ${INDEX_CHANGES_TABLE}`);
  else await sql.execute(`DELETE FROM ${INDEX_CHANGES_TABLE} WHERE seq <= ?`, [floor]);
}
