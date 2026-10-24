import type { IDatabaseAdapter } from "./IDatabaseAdapter.js";

/**
 * Version 1: files an older version synced as text although their bytes are
 * not UTF-8 are looked at once more.
 *
 * The sync used to decide by a file's name alone whether it is text (finding
 * 2026-10-09). A `.csv` in Windows-1252 or a `.txt` in UTF-16 was decoded as
 * UTF-8, every byte that is not UTF-8 became the replacement character, and
 * that TEXT was what a pull wrote to disk and what push and pull kept as the
 * merge base. Two kinds of rows are left from that time:
 *
 * - On a device that PULLED such a file, the file itself lies there damaged —
 *   the lossy decode, written back — while the server still holds the original.
 *   The row says "in sync". The first edit on that device would send the
 *   damaged version to everyone.
 * - On a device that HELD the original, the file is whole, but the row may
 *   carry the hash of the lossy text as its base (written when the server
 *   handed out a new marker for the same bytes), and its local marker the same
 *   hash (written when the file was opened in the app). By the rule that holds
 *   now, the next change from elsewhere would be "changed on both sides" and
 *   leave a conflict copy.
 *
 * Both carry the replacement character in their base text, and nothing else in
 * a row tells them from a healthy one — a note that quotes the character looks
 * the same. So nothing is decided here: the row is marked (`sync_state.recheck`).
 * The next full listing reconciles a marked file whatever its ETag says, by
 * the rule that holds now (`mergeableText`): a damaged copy nobody touched
 * since is replaced by the server's bytes, a copy that was edited meanwhile is
 * kept as a `.CONFLICT` file next to them, a whole file gets its hashes put
 * right, and a note that merely quotes the character comes out as it went in.
 * The reconcile takes the mark off, so each file is looked at once. Until it
 * has, the push leaves a marked file alone (`SyncEngine`): what lies here may
 * be the damaged copy. A file the remote no longer holds has nothing left to
 * be compared with — its mark goes with its row when the deletion is mirrored,
 * and comes off when the file is kept (`mirrorRemoteDeletionLocked`).
 *
 * The mark is a column of its own rather than a turn of the remote marker: a
 * rename keeps it (the row moves as a whole), and a push — which rewrites the
 * remote marker — cannot wipe it.
 *
 * Only rows the remote has confirmed are marked: a file that never went up
 * has nothing to be compared with, and its first push records what it is.
 */
export const LOSSY_TEXT_BASE_VERSION = 1;

const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

async function readVersion(db: IDatabaseAdapter): Promise<number> {
  try {
    const row = await db.queryOne<{ value?: string; VALUE?: string }>(`SELECT value FROM meta WHERE key = 'lossy_text_base_version'`);
    const raw = row ? (row.value ?? row.VALUE) : undefined;
    return raw != null ? parseInt(String(raw), 10) || 0 : 0;
  } catch {
    return 0;
  }
}

/**
 * Marks the rows described above, once per database. Returns how many, or
 * null when this database has been through it before. The marks first, the
 * version last: an interrupted run is run again, and a run over rows that are
 * marked already changes nothing. (`transaction` rolls back where the adapter
 * has real transactions; nothing here depends on it.)
 */
export async function flagLossyTextBases(db: IDatabaseAdapter): Promise<number | null> {
  if ((await readVersion(db)) >= LOSSY_TEXT_BASE_VERSION) return null;
  let flagged = 0;
  await db.transaction(async () => {
    const where = `remote_etag IS NOT NULL AND base_text IS NOT NULL AND instr(base_text, ?) > 0`;
    const count = await db.queryOne<{ n?: number; N?: number }>(`SELECT COUNT(*) AS n FROM sync_state WHERE ${where}`, [REPLACEMENT_CHARACTER]);
    flagged = Number(count?.n ?? count?.N ?? 0);
    if (flagged > 0) await db.execute(`UPDATE sync_state SET recheck = 1 WHERE ${where}`, [REPLACEMENT_CHARACTER]);
    await db.execute(`INSERT OR REPLACE INTO meta (key, value) VALUES ('lossy_text_base_version', ?)`, [String(LOSSY_TEXT_BASE_VERSION)]);
  });
  return flagged;
}
