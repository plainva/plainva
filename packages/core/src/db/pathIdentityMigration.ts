import type { IDatabaseAdapter } from "./IDatabaseAdapter.js";

/**
 * Path identity version 1 (ADR 0016): every path Plainva keeps in its database
 * is the NFC form of the path. Before, a path was its byte sequence, so the
 * same note read from a disk that stores decomposed accents (macOS, iOS) and
 * from a server that stores them composed was two different paths — the root
 * of issue #112.
 */
export const PATH_IDENTITY_VERSION = 1;

/** What one run of the migration did (kept in `meta` for the diagnostics). */
export interface PathIdentityReport {
  /** Rows whose path became its NFC form. */
  rekeyed: number;
  /**
   * Sync rows kept under their old spelling because the NFC form already had
   * a row: never merged. The sync reports such a pair while the second
   * spelling exists anywhere and forgets its row once it does not.
   */
  twinsKept: string[];
  /**
   * Queued remote DELETEs of a path the index knew under another spelling of
   * the same name: the misreading that sent #112's deletions. Dropped.
   */
  droppedDeletes: string[];
  /** Derived index rows (files, search) of a spelling whose NFC form was indexed too. */
  droppedIndexRows: number;
}

const isTwin = (p: string | null | undefined): boolean => !!p && p !== p.normalize("NFC");
const nfc = (p: string) => p.normalize("NFC");

async function readVersion(db: IDatabaseAdapter): Promise<number> {
  try {
    const row = await db.queryOne<{ value?: string; VALUE?: string }>(`SELECT value FROM meta WHERE key = 'path_identity_version'`);
    const raw = row ? (row.value ?? row.VALUE) : undefined;
    return raw != null ? parseInt(String(raw), 10) || 0 : 0;
  } catch {
    return 0;
  }
}

/**
 * Re-keys the index, the sync state, the offline queue and the other
 * path-keyed local tables to NFC, once per database.
 *
 * - Nothing is merged. Two sync rows that fall onto one NFC key stay two
 *   rows: the NFC one keeps its key, the other keeps its old spelling and is
 *   reported by the sync as a twin (see `PathIdentityReport.twinsKept`).
 * - Derived index rows (files, full-text search) of such a pair are dropped
 *   for the non-NFC spelling; the next scan reads the disk again.
 * - A queued DELETE of a spelling while the index knew the same name under
 *   another spelling is dropped: that is the misreading behind issue #112,
 *   and pushing it removed the remote copy of a file that still exists.
 * - One transaction, and every step skips what is already NFC: an interrupted
 *   run leaves the database as it was, a repeated run changes nothing.
 * - The encrypted workspace's own object table already requires NFC by
 *   protocol (`normalizeVaultPath`) and is not touched.
 */
export async function migratePathIdentity(db: IDatabaseAdapter): Promise<PathIdentityReport | null> {
  if ((await readVersion(db)) >= PATH_IDENTITY_VERSION) return null;
  const report: PathIdentityReport = { rekeyed: 0, twinsKept: [], droppedDeletes: [], droppedIndexRows: 0 };

  await db.transaction(async () => {
    // --- the index ---------------------------------------------------------
    const files = (await db.query<{ path: string }>(`SELECT path FROM files`)).map((r) => r.path);
    const spellingsByIdentity = new Map<string, Set<string>>();
    for (const path of files) {
      const id = nfc(path);
      const set = spellingsByIdentity.get(id) ?? new Set<string>();
      set.add(path);
      spellingsByIdentity.set(id, set);
    }
    const taken = new Set(files.filter((p) => !isTwin(p)));
    for (const path of files) {
      if (!isTwin(path)) continue;
      const id = nfc(path);
      if (taken.has(id)) {
        await db.execute(`DELETE FROM files WHERE path = ?`, [path]);
        report.droppedIndexRows++;
        continue;
      }
      await db.execute(`UPDATE files SET path = ? WHERE path = ?`, [id, path]);
      taken.add(id);
      report.rekeyed++;
    }
    const fts = (await db.query<{ path: string }>(`SELECT DISTINCT path FROM fts_notes`)).map((r) => r.path);
    const ftsTaken = new Set(fts.filter((p) => !isTwin(p)));
    for (const path of fts) {
      if (!isTwin(path)) continue;
      const id = nfc(path);
      if (ftsTaken.has(id)) {
        await db.execute(`DELETE FROM fts_notes WHERE path = ?`, [path]);
        report.droppedIndexRows++;
        continue;
      }
      await db.execute(`UPDATE fts_notes SET path = ? WHERE path = ?`, [id, path]);
      ftsTaken.add(id);
    }

    // --- sync state: re-keyed, never merged ---------------------------------
    const states = (await db.query<{ path: string }>(`SELECT path FROM sync_state`)).map((r) => r.path);
    const stateTaken = new Set(states.filter((p) => !isTwin(p)));
    for (const path of [...states].sort()) {
      if (!isTwin(path)) continue;
      const id = nfc(path);
      if (stateTaken.has(id)) {
        report.twinsKept.push(path);
        continue;
      }
      await db.execute(`UPDATE sync_state SET path = ? WHERE path = ?`, [id, path]);
      stateTaken.add(id);
      report.rekeyed++;
    }

    // --- the offline queue --------------------------------------------------
    const ops = await db.query<{ id: number; operation: string; file_path: string; new_path: string | null }>(
      `SELECT id, operation, file_path, new_path FROM offline_queue ORDER BY id`
    );
    for (const op of ops) {
      if (op.operation === "delete") {
        const spellings = spellingsByIdentity.get(nfc(op.file_path));
        if (spellings && [...spellings].some((s) => s !== op.file_path)) {
          await db.execute(`DELETE FROM offline_queue WHERE id = ?`, [op.id]);
          report.droppedDeletes.push(op.file_path);
          continue;
        }
      }
      if (!isTwin(op.file_path) && !isTwin(op.new_path)) continue;
      await db.execute(`UPDATE offline_queue SET file_path = ?, new_path = ? WHERE id = ?`, [
        nfc(op.file_path),
        op.new_path == null ? null : nfc(op.new_path),
        op.id,
      ]);
      report.rekeyed++;
    }

    // --- other local tables keyed by a vault path --------------------------
    for (const { table, column } of [
      { table: "conflicts", column: "file_path" },
      { table: "pim_task_state", column: "note_path" },
      { table: "workspace_comment_outbox", column: "path" },
      { table: "workspace_queue", column: "path" },
      { table: "workspace_queue", column: "new_path" },
      { table: "workspace_local_fork", column: "original_path" },
      { table: "workspace_local_fork", column: "fork_path" },
    ]) {
      const rows = await db.query<{ value: string | null }>(`SELECT DISTINCT ${column} AS value FROM ${table}`);
      for (const { value } of rows) {
        if (!isTwin(value)) continue;
        await db.execute(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, [nfc(value!), value]);
        report.rekeyed++;
      }
    }
    // A cache of local hashes: a row under an old spelling is simply re-read.
    const probes = await db.query<{ path: string }>(`SELECT path FROM workspace_local_probe`);
    for (const { path } of probes) {
      if (isTwin(path)) await db.execute(`DELETE FROM workspace_local_probe WHERE path = ?`, [path]);
    }

    await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('path_identity_version', ?)`, [String(PATH_IDENTITY_VERSION)]);
    await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('path_identity_report', ?)`, [JSON.stringify(report)]);
  });

  if (report.rekeyed > 0 || report.twinsKept.length > 0 || report.droppedDeletes.length > 0) {
    console.warn(
      `[Schema] path identity is NFC now: ${report.rekeyed} row(s) re-keyed, ${report.twinsKept.length} twin sync row(s) kept, ` +
      `${report.droppedDeletes.length} misread deletion(s) dropped, ${report.droppedIndexRows} index row(s) left to the next scan`
    );
  }
  return report;
}
