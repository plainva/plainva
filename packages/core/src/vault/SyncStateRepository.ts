import { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";

export interface SyncState {
  path: string;
  local_sha256: string | null;
  remote_etag: string | null;
  base_sha256: string | null;
  base_etag: string | null;
  remote_id: string | null;
  last_sync_ts: number | null;
  base_text: string | null;
}

export class SyncStateRepository {
  constructor(private readonly db: IDatabaseAdapter) {}

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
      `SELECT path, local_sha256, remote_etag, base_sha256, base_etag, remote_id, last_sync_ts FROM sync_state`
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

  // `writer` lets the bulk indexer record this pure-write upsert into its atomic
  // batch (defaults to the live adapter, so every other caller is unchanged).
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
   * Post-sync variant of updateLocalHashAndBaseText: base_text always advances
   * (the pushed/reconciled content IS the new common ancestor), but local_sha256
   * is only adopted when it still equals `expectedLocalSha` — the value read when
   * the network round-trip started — or is unset. An editor save that lands while
   * the upload is in flight updates local_sha256 first; unconditionally
   * overwriting it with the older pushed hash made the NEXT save look like an
   * external modification and produced spurious .CONFLICT files from nothing but
   * fast consecutive local edits (single-device autosave race).
   */
  async updateLocalHashAndBaseTextGuarded(
    path: string,
    localSha256: string,
    baseText: string,
    expectedLocalSha: string | null
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO sync_state (path, local_sha256, base_text)
       VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         base_text = excluded.base_text,
         local_sha256 = CASE
           WHEN sync_state.local_sha256 IS NULL OR sync_state.local_sha256 = ? THEN excluded.local_sha256
           ELSE sync_state.local_sha256
         END`,
      [path, localSha256, baseText, expectedLocalSha]
    );
  }

  /** See updateLocalHashAndBaseTextGuarded — variant without base_text (binary files). */
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

  async deleteSyncState(path: string): Promise<void> {
    await this.db.execute(`DELETE FROM sync_state WHERE path = ?`, [path]);
  }
}
