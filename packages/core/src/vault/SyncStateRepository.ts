import { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import { conflictSessionKey, decodeConflictSession, type ConflictDiagnostic, type ConflictEditSession } from "./conflictSession.js";
import { ConflictFileStore } from "./ConflictFileStore.js";
import type { IVaultAdapter } from "./IVaultAdapter.js";
import { clearHeldBackStarters, holdBackStarters, listHeldBackStarters, releaseHeldBackStarter } from "../sync/heldBackStarters.js";
import { clearAllUnsyncablePaths, clearUnsyncablePath, listUnsyncablePaths, markUnsyncablePath, type UnsyncableEntry } from "../sync/unsyncablePaths.js";

export interface SyncState {
  path: string;
  local_sha256: string | null;
  remote_etag: string | null;
  base_sha256: string | null;
  base_etag: string | null;
  remote_id: string | null;
  last_sync_ts: number | null;
  base_text: string | null;
  /**
   * Push journal (2026-07-16): the content hash of the last upload we STARTED
   * for this path, persisted before the network call and cleared once the
   * base advanced after a confirmed push. Survives a killed app / lost
   * response, so the next reconcile can recognise the remote content as our
   * own upload ("echo") instead of merging it against a stale base — which
   * used to produce .CONFLICT files out of nothing but typing with pauses.
   */
  pending_push_sha: string | null;
  /**
   * Set for a row an older version left for a file it synced as decoded text
   * although its bytes are not UTF-8 (see lossyTextBaseMigration.ts): the file
   * on this device may be that decoded text, written back. The next full
   * listing reconciles the file whatever its ETag says, and nothing of it is
   * pushed before — the reconcile that compared it with the server's copy
   * clears the mark. Absent on a row no version ever marked.
   */
  recheck?: number | null;
  /**
   * The hash of the version this device last DOWNLOADED and wrote, and when
   * that version last changed on the remote (epoch ms, null when the remote
   * did not say). See `recordPulledVersion`.
   */
  pulled_sha256?: string | null;
  pulled_mtime?: number | null;
  /**
   * The hash of a version of this file whose bytes are no UTF-8 although its
   * name says text (a `.csv` in Windows-1252, a note in UTF-16), as the sync,
   * the index or an open of the file found it (Sammelplan § 3.86 no. 2).
   *
   * Where it is the hash the local marker names, no writer can hold a reading
   * of that version — the app hands out none (`readExactText`) — and the
   * chain knows a text written over a file converted back to UTF-8 since did
   * not start from it (`ConflictAwareVaultAdapter`). A row without a base
   * text says nothing of the kind: an upload streamed from disk, a row an
   * older version wrote. A hash rather than a flag: it stops speaking for the
   * row once the marker names another version, whoever moved it; the sync
   * takes it off when it records a version that is text.
   */
  not_text_sha256?: string | null;
}

export class SyncStateRepository {
  private readonly conflictFiles: ConflictFileStore | null;
  /**
   * Drops every per-file sync record - when the vault's file sync starts against
   * another folder than the one they describe: a connection to another folder
   * starts from the files, not from them. The same folder keeps them (third
   * review of plan "Verbinden", finding 1).
   */
  async clearAll(): Promise<void> {
    await this.db.execute("DELETE FROM sync_state");
    // What the other folder refused is no fact about this one.
    await clearAllUnsyncablePaths(this.db);
    // Which starter files stay here is decided again for the other folder.
    await clearHeldBackStarters(this.db);
  }

  /** Starter files kept on this device, by path, with the hash held back (see heldBackStarters.ts). */
  async listHeldBackStarters(): Promise<Map<string, string>> {
    return listHeldBackStarters(this.db);
  }

  async holdBackStarters(files: ReadonlyMap<string, string>): Promise<void> {
    await holdBackStarters(this.db, files);
  }

  async releaseHeldBackStarter(path: string): Promise<void> {
    await releaseHeldBackStarter(this.db, path);
  }

  /** Files the provider never hands out here (see unsyncablePaths.ts). */
  async listUnsyncable(): Promise<UnsyncableEntry[]> {
    return listUnsyncablePaths(this.db);
  }

  async markUnsyncable(path: string, reason: string, etag: string, now: number = Date.now()): Promise<UnsyncableEntry> {
    return markUnsyncablePath(this.db, path, reason, etag, now);
  }

  async clearUnsyncable(path: string): Promise<void> {
    await clearUnsyncablePath(this.db, path);
  }

  constructor(private readonly db: IDatabaseAdapter, files?: IVaultAdapter, deviceId?: string) {
    this.conflictFiles = files ? new ConflictFileStore(files, deviceId ?? "") : null;
  }

  async getConflictSession(path: string): Promise<ConflictEditSession | null> {
    if (this.conflictFiles) return this.conflictFiles.getConflictSession(path);
    const row = await this.db.queryOne<{ value: string }>("SELECT value FROM meta WHERE key = ?", ["conflict-session:v1:" + conflictSessionKey(path)]);
    const session = row ? decodeConflictSession(row.value) : null;
    if (session && conflictSessionKey(session.originalPath) !== conflictSessionKey(path)) throw new Error("Conflict session path does not match its key");
    return session;
  }

  async listConflictSessions(): Promise<ConflictEditSession[]> {
    if (this.conflictFiles) return this.conflictFiles.listConflictSessions();
    const rows = await this.db.query<{ value: string }>("SELECT value FROM meta WHERE key LIKE 'conflict-session:v1:%'");
    return rows.map(row => decodeConflictSession(row.value));
  }

  async saveConflictSession(session: ConflictEditSession): Promise<void> {
    if (this.conflictFiles) return this.conflictFiles.saveConflictSession(session);
    await this.db.execute("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["conflict-session:v1:" + conflictSessionKey(session.originalPath), JSON.stringify(session)]);
  }

  async removeConflictSession(path: string): Promise<void> {
    if (this.conflictFiles) return this.conflictFiles.removeConflictSession(path);
    await this.db.execute("DELETE FROM meta WHERE key = ?", ["conflict-session:v1:" + conflictSessionKey(path)]);
  }

  async recordConflictDiagnostic(diagnostic: ConflictDiagnostic): Promise<void> {
    if (this.conflictFiles) return this.conflictFiles.recordConflictDiagnostic(diagnostic);
    await this.db.execute("INSERT INTO meta (key, value) VALUES (?, ?)", ["conflict-diagnostic:v1:" + diagnostic.at + ":" + crypto.randomUUID(), JSON.stringify(diagnostic)]);
    await this.db.execute("DELETE FROM meta WHERE key LIKE 'conflict-diagnostic:v1:%' AND key NOT IN (SELECT key FROM meta WHERE key LIKE 'conflict-diagnostic:v1:%' ORDER BY key DESC LIMIT 100)");
  }

  async listConflictDiagnostics(): Promise<ConflictDiagnostic[]> {
    if (this.conflictFiles) return this.conflictFiles.listConflictDiagnostics();
    const rows = await this.db.query<{ value: string }>("SELECT value FROM meta WHERE key LIKE 'conflict-diagnostic:v1:%' ORDER BY key DESC LIMIT 100");
    return rows.map(row => JSON.parse(row.value) as ConflictDiagnostic);
  }

  async getSyncState(path: string): Promise<SyncState | null> {
    const rows = await this.db.query<SyncState>(
      `SELECT * FROM sync_state WHERE path = ?`,
      [path]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  async getBaseText(path: string): Promise<string | null> {
    const rows = await this.db.query<{base_text: string}>(
      `SELECT base_text FROM sync_state WHERE path = ?`,
      [path]
    );
    return rows.length > 0 ? rows[0].base_text : null;
  }

  /**
   * Returns every path that currently has a persisted sync state. Used by the
   * sync worker to detect remote deletions (paths we synced before but that no
   * longer appear in the remote listing).
   */
  async getAllPaths(): Promise<string[]> {
    const rows = await this.db.query<{ path: string }>(
      `SELECT path FROM sync_state`
    );
    return rows.map((r) => r.path);
  }

  /**
   * One-query snapshot of every sync state, keyed by path — the worker's
   * per-cycle read model (P2.2). Querying state per remote file was one IPC
   * round-trip PER FILE on every 15-second tick (10k files = 10k SELECTs per
   * no-op cycle). base_text is deliberately NOT loaded: it holds whole file
   * contents; conflict handling fetches it per file via getBaseText.
   */
  async getAllStates(): Promise<Map<string, SyncState>> {
    const rows = await this.db.query<SyncState>(
      `SELECT path, local_sha256, remote_etag, base_sha256, base_etag, remote_id, last_sync_ts, pending_push_sha, recheck FROM sync_state`
    );
    const map = new Map<string, SyncState>();
    for (const row of rows) {
      map.set(row.path, { ...row, base_text: null });
    }
    return map;
  }

  /**
   * Returns the remote provider id (e.g. Google Drive file id) recorded for a path,
   * or null if none. Used by the cursor/id-based pull path to map a known path to
   * its remote object before downloading.
   */
  async getRemoteId(path: string): Promise<string | null> {
    const rows = await this.db.query<{ remote_id: string | null }>(
      `SELECT remote_id FROM sync_state WHERE path = ?`,
      [path]
    );
    return rows.length > 0 ? rows[0].remote_id : null;
  }

  /**
   * Reverse lookup for id-based providers (Drive `changes.list` reports file ids,
   * not paths): resolve the local path for a given remote id, or null if unknown.
   */
  async getPathByRemoteId(remoteId: string): Promise<string | null> {
    const rows = await this.db.query<{ path: string }>(
      `SELECT path FROM sync_state WHERE remote_id = ?`,
      [remoteId]
    );
    return rows.length > 0 ? rows[0].path : null;
  }

  /**
   * The local marker and the base text, whatever the row held. Nothing in the
   * sync or the index writes this way any more: a base the sync recorded is
   * the sync's (`recordSyncedBase`), and the index records a text only for a
   * file no sync has seen (`updateLocalHashAndUnsyncedBaseText`). Left for
   * setting up a row as an earlier version left it.
   */
  async updateLocalHashAndBaseText(
    path: string,
    localSha256: string,
    baseText: string,
    writer: { execute(query: string, params?: unknown[]): Promise<void> } = this.db
  ): Promise<void> {
    await writer.execute(
      `INSERT INTO sync_state (path, local_sha256, base_text)
       VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET local_sha256 = excluded.local_sha256, base_text = excluded.base_text`,
      [path, localSha256, baseText]
    );
  }

  /**
   * Updates only the local content marker, NOT the merge base. A local save must
   * never advance base_text/base_sha256 — those represent the last *synced* common
   * ancestor used for 3-way merges. Overwriting the base with the just-saved local
   * content would make the next pull see "local == base, only remote changed" and
   * silently drop the user's unsynced edits. The base advances only on real sync
   * (push/pull) or initial indexing of a brand-new file.
   */
  async updateLocalHash(
    path: string,
    localSha256: string,
    writer: { execute(query: string, params?: unknown[]): Promise<void> } = this.db
  ): Promise<void> {
    await writer.execute(
      `INSERT INTO sync_state (path, local_sha256)
       VALUES (?, ?)
       ON CONFLICT(path) DO UPDATE SET local_sha256 = excluded.local_sha256`,
      [path, localSha256]
    );
  }

  /**
   * What the write chain records after a write of its own that leaves the row
   * without a text for its marker — a merge with a change from outside, a
   * marker put right: the local marker, and the text as the base ONLY for a
   * file no sync has seen.
   *
   * `base_sha256`, `base_etag` and the base text of a row that carries a
   * `base_sha256` are the sync's: the version this device and the remote last
   * agreed on. A text put there from outside a sync makes the row name one
   * version and hold another, and the next change from another device is
   * merged against a text that is not the common ancestor. Where that text is
   * this device's own, nothing has changed here as far as the merge can tell —
   * the other device's version comes out, every change made here is gone, and
   * no conflict copy is written (finding 2026-10-11).
   *
   * The condition stands in the statement itself, not in a look at the row
   * beforehand: a first upload that finishes in between must not find its base
   * text replaced a moment later.
   */
  async updateLocalHashAndUnsyncedBaseText(
    path: string,
    localSha256: string,
    text: string,
    writer: { execute(query: string, params?: unknown[]): Promise<void> } = this.db
  ): Promise<void> {
    await writer.execute(
      `INSERT INTO sync_state (path, local_sha256, base_text)
       VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         local_sha256 = excluded.local_sha256,
         base_text = CASE WHEN sync_state.base_sha256 IS NULL THEN excluded.base_text ELSE sync_state.base_text END`,
      [path, localSha256, text]
    );
  }

  /**
   * Records the version this device and the remote now agree on — the merge
   * base: its hash, its ETag and its text, in ONE statement, after an upload
   * went through or a pull settled the file (Sammelplan § 3.102 no. 7).
   *
   * They used to be two statements, and the order differed by caller: the
   * worker wrote the text first, the engine the hash. An app that ended in
   * between — on the phone also a foreign transaction rolled back with the
   * statements in it (§ 3.89) — left the row naming one version and holding
   * the text of another. That is no common ancestor; since § 3.93 a merge
   * does not take it for one, and the file ends as a conflict copy instead.
   *
   * `text` is the version's text where it is one, and null where it is none:
   * a file that is not UTF-8 or no text at all, and a version whose bytes were
   * never in hand (an upload streamed from disk). The row then holds no text
   * rather than the text of an earlier version under the new hash (§ 3.102
   * no. 2).
   *
   * `local` adopts the local marker in the same statement. With `expected`,
   * only while the row still holds that marker (or none): the value read when
   * the round trip started. A save that landed meanwhile keeps its newer hash —
   * overwriting it with the older one made the NEXT save look like a change
   * from outside and produced conflict copies out of nothing but quick edits
   * (single-device autosave race, P1).
   */
  async recordSyncedBase(
    path: string,
    base: { sha256: string; etag: string | null; text: string | null; notText?: boolean },
    local?: { sha256: string; expected?: string | null }
  ): Promise<void> {
    // `notText` says the version's bytes were in hand and are no UTF-8 under
    // a name that says text (`SyncState.not_text_sha256`); a version that is
    // text takes the mark off, and one whose bytes were never in hand says
    // nothing either way.
    const notText = base.notText ? base.sha256 : null;
    const columns = ["path", "base_sha256", "base_etag", "base_text", "not_text_sha256"];
    const params: unknown[] = [path, base.sha256, base.etag, base.text, notText];
    const updates = ["base_sha256 = excluded.base_sha256", "base_etag = excluded.base_etag", "base_text = excluded.base_text", "not_text_sha256 = excluded.not_text_sha256"];
    if (local) {
      columns.push("local_sha256");
      params.push(local.sha256);
      if (local.expected === undefined) {
        updates.push("local_sha256 = excluded.local_sha256");
      } else {
        updates.push(`local_sha256 = CASE
           WHEN sync_state.local_sha256 IS NULL OR sync_state.local_sha256 = ? THEN excluded.local_sha256
           ELSE sync_state.local_sha256
         END`);
        params.push(local.expected);
      }
    }
    await this.db.execute(
      `INSERT INTO sync_state (${columns.join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})
       ON CONFLICT(path) DO UPDATE SET
         ${updates.join(",\n         ")}`,
      params
    );
  }

  /**
   * Adopts the local marker of a file the sync compared with the remote only
   * while no concurrent app save changed it since (see `recordSyncedBase`).
   */
  async updateLocalHashGuarded(path: string, localSha256: string, expectedLocalSha: string | null): Promise<void> {
    await this.db.execute(
      `INSERT INTO sync_state (path, local_sha256)
       VALUES (?, ?)
       ON CONFLICT(path) DO UPDATE SET
         local_sha256 = CASE
           WHEN sync_state.local_sha256 IS NULL OR sync_state.local_sha256 = ? THEN excluded.local_sha256
           ELSE sync_state.local_sha256
         END`,
      [path, localSha256, expectedLocalSha]
    );
  }

  async updateRemoteState(path: string, remoteEtag: string | null, remoteId: string | null, syncTs: number): Promise<void> {
    // Upsert: a push may be the very first time we record state for a file (e.g.
    // files queued by enqueueAllLocalFiles have no row yet). A plain UPDATE would
    // silently no-op and leave remote_etag NULL, which makes the next pull
    // re-download the file we just pushed in an endless churn.
    await this.db.execute(
      `INSERT INTO sync_state (path, remote_etag, remote_id, last_sync_ts)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         remote_etag = excluded.remote_etag,
         remote_id = excluded.remote_id,
         last_sync_ts = excluded.last_sync_ts`,
      [path, remoteEtag, remoteId, syncTs]
    );
  }

  /**
   * Has this vault ever confirmed a file with a remote? The shells ask before
   * they build a sync target (finding 2026-09-20): a vault that has synced
   * before must never get a freshly created, empty remote folder — every known
   * file would count as missing against it.
   */
  async hasConfirmedRemoteFiles(): Promise<boolean> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sync_state WHERE remote_etag IS NOT NULL AND path NOT LIKE '.plainva%'`
    );
    return Number(rows[0]?.n ?? 0) > 0;
  }

  /**
   * Records the provider object id of an EXISTING row and touches nothing else
   * (finding 2026-09-20). Only pushes used to store an id, so a vault that was
   * mostly pulled had none — and without an id an id-based provider cannot be
   * asked whether one particular file still exists. A listing knows every id;
   * the worker hands them over here. Never inserts: a path without a row has
   * not been reconciled yet, and its row will carry the id when it is.
   */
  async updateRemoteId(path: string, remoteId: string): Promise<void> {
    await this.db.execute(
      `UPDATE sync_state SET remote_id = ? WHERE path = ? AND (remote_id IS NULL OR remote_id != ?)`,
      [remoteId, path, remoteId]
    );
  }

  /**
   * The hash and ETag of the merge base alone, leaving its text as it is. The
   * sync itself records a base through `recordSyncedBase`, which writes all
   * three at once; this one sets up a row whose text another call wrote.
   */
  async updateBaseState(path: string, baseSha256: string | null, baseEtag: string | null): Promise<void> {
    await this.db.execute(
      `INSERT INTO sync_state (path, base_sha256, base_etag)
       VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         base_sha256 = excluded.base_sha256,
         base_etag = excluded.base_etag`,
      [path, baseSha256, baseEtag]
    );
  }

  /**
   * Records the content hash of an upload we are ABOUT to start (see
   * SyncState.pending_push_sha). Persisted before the network call so a lost
   * response / killed app leaves the journal entry behind for the reconcile.
   */
  async setPendingPushSha(path: string, sha256: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO sync_state (path, pending_push_sha)
       VALUES (?, ?)
       ON CONFLICT(path) DO UPDATE SET pending_push_sha = excluded.pending_push_sha`,
      [path, sha256]
    );
  }

  /** Clears the push journal entry once the pushed base is fully recorded (or adopted as an echo). */
  async clearPendingPushSha(path: string): Promise<void> {
    await this.db.execute(`UPDATE sync_state SET pending_push_sha = NULL WHERE path = ?`, [path]);
  }

  /**
   * Drops the merge base text of a file that is text by its name and not by
   * its bytes (`mergeableText` said no) — after a sync that carried it byte for
   * byte, or when the indexer finds it. A text kept from the time the file WAS
   * text, from an earlier file under the same name, or from a version that
   * kept the lossy decode of such a file describes another content than
   * `base_sha256` does; a later merge against it would take that stranger for
   * the common ancestor. `writer` as in `updateLocalHashAndBaseText`.
   */
  async clearBaseText(
    path: string,
    writer: { execute(query: string, params?: unknown[]): Promise<void> } = this.db
  ): Promise<void> {
    await writer.execute(`UPDATE sync_state SET base_text = NULL WHERE path = ? AND base_text IS NOT NULL`, [path]);
  }

  /**
   * Records that the version of `path` with the hash `sha256` is no text by
   * its bytes (`SyncState.not_text_sha256`) — or, with null, takes that off.
   * `writer` as in `updateLocalHashAndBaseText`: the index writes it in its
   * batch, beside the marker it records.
   */
  async markNotText(
    path: string,
    sha256: string | null,
    writer: { execute(query: string, params?: unknown[]): Promise<void> } = this.db
  ): Promise<void> {
    // Only a row that is there: the mark speaks of the marker beside it, and
    // a path without a row has none to speak of.
    await writer.execute(`UPDATE sync_state SET not_text_sha256 = ? WHERE path = ?`, [sha256, path]);
  }

  /**
   * Takes the "look at this file again" mark off a row (`SyncState.recheck`):
   * the reconcile has compared the file with the server's copy, or the server
   * no longer holds one to compare it with.
   */
  async clearRecheck(path: string): Promise<void> {
    await this.db.execute(`UPDATE sync_state SET recheck = NULL WHERE path = ? AND recheck IS NOT NULL`, [path]);
  }

  /**
   * Records that the file at `path` now holds a version the sync downloaded
   * and wrote: `sha256` is the hash of what it wrote (the hash the index
   * records for the file's bytes), `remoteModifiedAt` when that version last
   * changed on the remote.
   *
   * The file's own modification time is the moment of the download, and that
   * is what "edited at" used to show: the phone's Today list counted every
   * note a fresh connection pulled as edited today (Sammelplan § 3.164). While
   * the index still holds this hash for the file, the remote's time stands for
   * when it was edited (`EDITED_AT_SQL`); a change made here changes the hash,
   * and the local time counts again. A version that only LOOKS like the
   * remote one — the file here already held it, nothing was written — is not
   * recorded: its local time is the one of a real edit.
   */
  async recordPulledVersion(path: string, sha256: string, remoteModifiedAt: number | null): Promise<void> {
    await this.db.execute(
      `INSERT INTO sync_state (path, pulled_sha256, pulled_mtime)
       VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         pulled_sha256 = excluded.pulled_sha256,
         pulled_mtime = excluded.pulled_mtime`,
      [path, sha256, remoteModifiedAt]
    );
  }

  async deleteSyncState(path: string): Promise<void> {
    await this.db.execute(`DELETE FROM sync_state WHERE path = ?`, [path]);
  }
}
