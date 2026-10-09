import { IDatabaseAdapter } from "./IDatabaseAdapter.js";
import { migratePathIdentity } from "./pathIdentityMigration.js";
import { runStatementsAtomic } from "./batch.js";
import { segmentedIndexText, SPACELESS_GLOB } from "../vault/spacelessText.js";

/**
 * The full-text table. `content` doubles as the note text for other readers
 * (tasks overview, graph); `seg_content`/`seg_title` hold the character-pair
 * form of text written without spaces (vault/spacelessText.ts, format 5).
 * `content`, `title` and `path` stay in front — inserts that name only those
 * keep working, and so does an older app on a newer index.
 */
const FTS_NOTES_COLUMNS = `content,
      title,
      path UNINDEXED,
      seg_content,
      seg_title,
      tokenize = 'unicode61 remove_diacritics 1'`;

/**
 * Initializes the database schema as defined in Master_Projektplan.md §5.2
 */
export async function initializeSchema(db: IDatabaseAdapter): Promise<void> {
  const schemaQueries = [
    `CREATE TABLE IF NOT EXISTS files (
      id          TEXT PRIMARY KEY,
      path        TEXT NOT NULL UNIQUE,
      title       TEXT,
      sha256      TEXT,
      cloud_etag  TEXT,
      cloud_id    TEXT,
      mtime_local INTEGER,
      mtime_cloud INTEGER,
      size_bytes  INTEGER,
      is_cached   INTEGER DEFAULT 0,
      is_deleted  INTEGER DEFAULT 0,
      mode        TEXT,
      sync_state  TEXT DEFAULT 'synced'
    );`,
    
    `CREATE TABLE IF NOT EXISTS links (
      source_id   TEXT REFERENCES files(id) ON DELETE CASCADE,
      target_path TEXT NOT NULL,
      target_raw  TEXT NOT NULL,
      link_type   TEXT NOT NULL,
      anchor      TEXT,
      line_number INTEGER,
      property_key TEXT
    );`,

    `CREATE TABLE IF NOT EXISTS tags (
      file_id TEXT,
      tag TEXT,
      FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE,
      UNIQUE(file_id, tag)
    );`,

    `CREATE TABLE IF NOT EXISTS properties (
      file_id TEXT REFERENCES files(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT,
      type TEXT
    );`,

    `CREATE TABLE IF NOT EXISTS conflicts (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      local_sha TEXT,
      cloud_sha TEXT,
      base_sha TEXT,
      local_content BLOB,
      cloud_content BLOB,
      detected_at INTEGER,
      resolved INTEGER DEFAULT 0,
      resolution TEXT
    );`,

    `CREATE TABLE IF NOT EXISTS offline_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      operation TEXT NOT NULL,
      content BLOB,
      new_path TEXT,
      queued_at INTEGER,
      retry_count INTEGER DEFAULT 0,
      next_retry_at INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 50,
      last_error TEXT,
      requires_manual_intervention INTEGER DEFAULT 0,
      force INTEGER DEFAULT 0,
      delete_confirmed_at INTEGER,
      delete_journaled INTEGER NOT NULL DEFAULT 0
    );`,

    `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      actor TEXT,
      operation TEXT,
      target TEXT,
      details TEXT
    );`,

    `CREATE TABLE IF NOT EXISTS sync_state (
      path TEXT PRIMARY KEY,
      local_sha256 TEXT,
      remote_etag TEXT,
      base_sha256 TEXT,
      base_etag TEXT,
      remote_id TEXT,
      last_sync_ts INTEGER,
      base_text TEXT,
      pending_push_sha TEXT
    );`,

    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );`,

    // Encrypted Workspace P3. The index DB contains public protocol state,
    // ciphertext staging references and the resumable mutation queue only.
    // Device, recovery and group private keys are never persisted here.
    `CREATE TABLE IF NOT EXISTS workspace_meta (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS workspace_object (
      object_id           TEXT PRIMARY KEY,
      path                TEXT NOT NULL UNIQUE,
      current_revision_id TEXT,
      payload_hash        TEXT,
      plaintext_sha256    TEXT,
      content_kind        TEXT NOT NULL,
      deleted             INTEGER NOT NULL DEFAULT 0,
      author_member_id    TEXT NOT NULL DEFAULT '',
      created_at          TEXT NOT NULL,
      modified_at         TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS workspace_revision (
      revision_id        TEXT PRIMARY KEY,
      object_id          TEXT NOT NULL,
      payload_hash       TEXT,
      parent_revision_ids TEXT NOT NULL,
      operation_hash     TEXT NOT NULL,
      device_id          TEXT NOT NULL,
      sequence           INTEGER NOT NULL,
      materialized_path  TEXT,
      plaintext_sha256   TEXT,
      created_at         TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
    );`,
    `CREATE TABLE IF NOT EXISTS workspace_operation (
      operation_hash TEXT PRIMARY KEY,
      device_id      TEXT NOT NULL,
      sequence       INTEGER NOT NULL,
      document_json  TEXT NOT NULL,
      UNIQUE(device_id, sequence)
    );`,
    `CREATE TABLE IF NOT EXISTS workspace_queue (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      operation     TEXT NOT NULL,
      path          TEXT NOT NULL,
      new_path      TEXT,
      queued_at     INTEGER NOT NULL,
      retry_count   INTEGER NOT NULL DEFAULT 0,
      last_error    TEXT,
      prepared_json TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS workspace_checkpoint (
      checkpoint_hash TEXT PRIMARY KEY,
      document_json   TEXT NOT NULL,
      published       INTEGER NOT NULL DEFAULT 0
    );`,
    `CREATE TABLE IF NOT EXISTS workspace_comment (
      comment_id        TEXT PRIMARY KEY,
      target_object_id  TEXT NOT NULL,
      target_revision_id TEXT NOT NULL,
      parent_comment_id TEXT,
      author_member_id  TEXT NOT NULL,
      author_device_id  TEXT NOT NULL,
      operation_hash    TEXT NOT NULL UNIQUE,
      payload_hash      TEXT NOT NULL,
      body              TEXT NOT NULL,
      anchor            TEXT,
      suggestion        TEXT,
      suggestion_applied_at TEXT,
      suggestion_applied_by TEXT,
      suggestion_declined_at TEXT,
      suggestion_outcome TEXT,
      decision_proof TEXT,
      legacy_origin TEXT,
      decision_format INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL,
      resolved_comment_id TEXT,
      resolved_at       TEXT,
      retracts_comment_id TEXT,
      retracted_at      TEXT,
      suggestion_batch_id TEXT,
      batch_index       INTEGER,
      batch_note        TEXT
    );`,
    // Remarks written on this device that the worker has not published yet
    // (K6): shown at once, uploaded in order by the next cycle. Additive.
    `CREATE TABLE IF NOT EXISTS workspace_comment_outbox (
      outbox_id         TEXT PRIMARY KEY,
      comment_id        TEXT NOT NULL UNIQUE,
      path              TEXT NOT NULL,
      target_object_id  TEXT NOT NULL,
      body              TEXT NOT NULL,
      parent_comment_id TEXT,
      resolved_comment_id TEXT,
      retracts_comment_id TEXT,
      anchor            TEXT,
      suggestion        TEXT,
      suggestion_outcome TEXT,
      decision_proof TEXT,
      legacy_origin TEXT,
      created_at        TEXT NOT NULL,
      attempts          INTEGER NOT NULL DEFAULT 0,
      last_error        TEXT,
      suggestion_batch_id TEXT,
      batch_index       INTEGER,
      batch_note        TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS workspace_quarantine (
      quarantine_id    TEXT PRIMARY KEY,
      artifact_kind    TEXT NOT NULL,
      remote_key       TEXT NOT NULL,
      artifact_base64  TEXT NOT NULL,
      artifact_sha256  TEXT NOT NULL,
      error_code       TEXT NOT NULL,
      reason_code      TEXT,
      reason           TEXT NOT NULL,
      details_json     TEXT,
      first_seen_at    TEXT NOT NULL,
      last_tried_at    TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending',
      resolved_at      TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS workspace_local_fork (
      fork_id       TEXT PRIMARY KEY,
      original_path TEXT NOT NULL,
      fork_path     TEXT NOT NULL,
      reason        TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );`,
    // Sweep-owned probe cache: "the local file at path had this plaintext hash
    // at (mtime, size)". Purely local bookkeeping so the open-time reconcile
    // sweep can skip re-reading unchanged files; never part of the protocol.
    `CREATE TABLE IF NOT EXISTS workspace_local_probe (
      path             TEXT PRIMARY KEY,
      mtime            INTEGER NOT NULL,
      size             INTEGER NOT NULL,
      plaintext_sha256 TEXT NOT NULL
    );`,
    // What the publisher remembers about one published slice (S4b). Carries no
    // key material - the publication's own runtime lives in the OS credential
    // store, one slot per publication, the way the main runtime always has.
    // `slice_id` is a column rather than a JSON field because it is the one
    // thing callers filter by; no index, because a vault has a handful of
    // publications and an index that never pays for itself is noise.
    `CREATE TABLE IF NOT EXISTS workspace_publication (
      publication_id    TEXT PRIMARY KEY,
      slice_id          TEXT NOT NULL,
      config_json       TEXT NOT NULL,
      manifest_json     TEXT NOT NULL,
      last_error        TEXT,
      last_refreshed_at TEXT,
      created_at        TEXT NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_workspace_object_path ON workspace_object(path);`,
    `CREATE INDEX IF NOT EXISTS idx_workspace_revision_object ON workspace_revision(object_id);`,
    `CREATE INDEX IF NOT EXISTS idx_workspace_operation_device ON workspace_operation(device_id, sequence);`,
    `CREATE INDEX IF NOT EXISTS idx_workspace_queue_path ON workspace_queue(path, new_path);`,
    `CREATE INDEX IF NOT EXISTS idx_workspace_comment_target ON workspace_comment(target_object_id, created_at);`,
    `CREATE INDEX IF NOT EXISTS idx_workspace_quarantine_status ON workspace_quarantine(status, first_seen_at);`,

    // FTS5 Virtual Table for full-text search
    `CREATE VIRTUAL TABLE IF NOT EXISTS fts_notes USING fts5(
      ${FTS_NOTES_COLUMNS}
    );`,

    // PIM object cache (Gesamtplan PIM-Ausbau 2026-07-17): calendars/tasks
    // mirrored from external providers live HERE, not as vault files. All
    // tables are additive (no index-format bump — nothing derives from vault
    // content). Credentials never touch these tables (keychain only); `config`
    // carries non-secret JSON (server URL, user, client id).
    `CREATE TABLE IF NOT EXISTS pim_accounts (
      id       TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      label    TEXT,
      config   TEXT,
      enabled  INTEGER DEFAULT 1
    );`,
    `CREATE TABLE IF NOT EXISTS pim_calendars (
      account_id TEXT NOT NULL REFERENCES pim_accounts(id) ON DELETE CASCADE,
      cal_id     TEXT NOT NULL,
      name       TEXT,
      color      TEXT,
      selected   INTEGER DEFAULT 1,
      read_only  INTEGER DEFAULT 0,
      PRIMARY KEY (account_id, cal_id)
    );`,
    `CREATE TABLE IF NOT EXISTS pim_events (
      account_id    TEXT NOT NULL,
      cal_id        TEXT NOT NULL,
      uid           TEXT NOT NULL,
      title         TEXT,
      start_ts      INTEGER,
      end_ts        INTEGER,
      start_date    TEXT,
      end_date      TEXT,
      all_day       INTEGER DEFAULT 0,
      location      TEXT,
      description   TEXT,
      attendees     TEXT,
      status        TEXT,
      etag          TEXT,
      series_master TEXT,
      recurrence    TEXT,
      href          TEXT,
      color         TEXT,
      rsvps         TEXT,
      block_of      TEXT,
      blocks        TEXT,
      reminders     TEXT,
      busy          TEXT,
      meeting_url   TEXT,
      categories    TEXT,
      status_kind   TEXT,
      working_loc   TEXT,
      PRIMARY KEY (account_id, cal_id, uid)
    );`,
    `CREATE TABLE IF NOT EXISTS pim_tasklists (
      account_id TEXT NOT NULL REFERENCES pim_accounts(id) ON DELETE CASCADE,
      list_id    TEXT NOT NULL,
      name       TEXT,
      selected   INTEGER DEFAULT 0,
      PRIMARY KEY (account_id, list_id)
    );`,
    `CREATE TABLE IF NOT EXISTS pim_tasks (
      account_id TEXT NOT NULL,
      list_id    TEXT NOT NULL,
      uid        TEXT NOT NULL,
      title      TEXT,
      notes      TEXT,
      due        TEXT,
      completed  INTEGER DEFAULT 0,
      etag       TEXT,
      updated_ts INTEGER,
      href       TEXT,
      PRIMARY KEY (account_id, list_id, uid)
    );`,
    `CREATE TABLE IF NOT EXISTS pim_state (
      account_id   TEXT NOT NULL,
      scope        TEXT NOT NULL,
      cursor       TEXT,
      last_sync_ts INTEGER,
      last_error   TEXT,
      -- "transient" | "fatal" beside the text (N1/S2). The text alone could not
      -- tell a dropped request from a revoked sign-in, so every dead account
      -- kept spending a network round per cycle, forever.
      last_error_kind TEXT,
      auth_revision TEXT,
      PRIMARY KEY (account_id, scope)
    );`,
    `CREATE TABLE IF NOT EXISTS pim_task_state (
      account_id  TEXT NOT NULL,
      list_id     TEXT NOT NULL,
      uid         TEXT NOT NULL,
      note_path   TEXT,
      remote_etag TEXT,
      base_fields TEXT,
      last_sync_ts INTEGER,
      PRIMARY KEY (account_id, list_id, uid)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_pim_events_time ON pim_events(start_ts, end_ts);`,
    `CREATE INDEX IF NOT EXISTS idx_pim_task_state_note ON pim_task_state(note_path);`,

    // Indices
    `CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_path);`,
    `CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);`,
    `CREATE INDEX IF NOT EXISTS idx_props_kv ON properties(key, value);`,
    // P2.1: every per-file re-index starts with DELETE FROM files WHERE id=?,
    // whose ON DELETE CASCADE otherwise full-scans links + properties on EVERY
    // save. The title index carries COLLATE NOCASE because the statements that
    // read it compare and sort that way (the `[[` completion's prefix match,
    // a search ordered by title). Wiki-link RESOLUTION no longer asks SQL: it
    // reads the corpus once and resolves in JavaScript (LinkResolver.ts).
    `CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);`,
    `CREATE INDEX IF NOT EXISTS idx_props_file ON properties(file_id);`,
    `CREATE INDEX IF NOT EXISTS idx_files_title ON files(title COLLATE NOCASE);`
  ];

  for (const query of schemaQueries) {
    await db.execute(query);
  }

  try {
    await db.execute(`ALTER TABLE workspace_revision ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';`);
  } catch {
    // Column might already exist
  }

  // Import provenance is durable in the outbox and in confirmed comments.
  // Only a genuinely missing column is migrated; database failures remain errors.
  for (const table of ["workspace_comment", "workspace_comment_outbox"]) {
    const columns = await db.query<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!columns.some(column => column.name === "legacy_origin"))
      await db.execute(`ALTER TABLE ${table} ADD COLUMN legacy_origin TEXT`);
  }

  // Deleting a comment is an appended retraction marker (K7, 2026-09-03);
  // both tables predate it on any vault opened before.
  for (const statement of [
    `ALTER TABLE workspace_comment ADD COLUMN retracts_comment_id TEXT;`,
    `ALTER TABLE workspace_comment ADD COLUMN retracted_at TEXT;`,
    `ALTER TABLE workspace_comment_outbox ADD COLUMN retracts_comment_id TEXT;`,
    // The proposal round (Vorschlagsmodus V1, 2026-09-03).
    `ALTER TABLE workspace_comment ADD COLUMN suggestion_batch_id TEXT;`,
    `ALTER TABLE workspace_comment ADD COLUMN batch_index INTEGER;`,
    `ALTER TABLE workspace_comment ADD COLUMN batch_note TEXT;`,
    // Keep a resolution's own outcome, including when its proposal arrives later.
    `ALTER TABLE workspace_comment ADD COLUMN suggestion_outcome TEXT;`,
    `ALTER TABLE workspace_comment ADD COLUMN decision_proof TEXT;`,
    `ALTER TABLE workspace_comment ADD COLUMN decision_format INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE workspace_comment_outbox ADD COLUMN decision_proof TEXT;`,
    `ALTER TABLE workspace_comment_outbox ADD COLUMN suggestion_batch_id TEXT;`,
    `ALTER TABLE workspace_comment_outbox ADD COLUMN batch_index INTEGER;`,
    `ALTER TABLE workspace_comment_outbox ADD COLUMN batch_note TEXT;`,
    // A quarantine entry names its cause, what the check knew, and when it
    // resolved itself (finding 2026-09-03).
    `ALTER TABLE workspace_quarantine ADD COLUMN reason_code TEXT;`,
    `ALTER TABLE workspace_quarantine ADD COLUMN details_json TEXT;`,
    `ALTER TABLE workspace_quarantine ADD COLUMN resolved_at TEXT;`,
  ]) {
    try {
      await db.execute(statement);
    } catch {
      // Column might already exist
    }
  }

  try {
    // Who created this object. The Contributor role grants `content.create` but not
    // `content.write`, so without an author the first autosave of a contributor's own
    // note was denied. Existing rows default to '' — an unknown author stays denied,
    // which is the same answer the code gave before the column existed.
    await db.execute(`ALTER TABLE workspace_object ADD COLUMN author_member_id TEXT NOT NULL DEFAULT '';`);
  } catch {
    // Column might already exist
  }

  try {
    await db.execute(`ALTER TABLE workspace_comment ADD COLUMN resolved_comment_id TEXT;`);
  } catch {
    // Column might already exist
  }

  try {
    // Where a comment sits inside the note, as JSON. NULL means the whole note,
    // which is what every comment written before anchors existed meant.
    await db.execute(`ALTER TABLE workspace_comment ADD COLUMN anchor TEXT;`);
  } catch {
    // Column might already exist
  }

  // The proposed replacement text (NULL = a plain remark, "" = a deletion) and
  // what became of it. Four additive nullable columns: a vault written before
  // suggestions existed reads back unchanged.
  for (const column of ["suggestion TEXT", "suggestion_applied_at TEXT", "suggestion_applied_by TEXT", "suggestion_declined_at TEXT"]) {
    try {
      await db.execute(`ALTER TABLE workspace_comment ADD COLUMN ${column};`);
    } catch {
      // Column might already exist
    }
  }

  try {
    await db.execute(`ALTER TABLE offline_queue ADD COLUMN next_retry_at INTEGER DEFAULT 0;`);
  } catch {
    // Column might already exist
  }

  try {
    await db.execute(`ALTER TABLE sync_state ADD COLUMN base_text TEXT;`);
  } catch {
    // Column might already exist
  }

  try {
    await db.execute(`ALTER TABLE offline_queue ADD COLUMN last_error TEXT;`);
  } catch {
    // Column might already exist
  }

  try {
    // Additive (N1/S2): existing rows read NULL, which the worker treats as
    // "unknown" and therefore retries — an upgrade never silently parks a
    // working account.
    await db.execute(`ALTER TABLE pim_state ADD COLUMN last_error_kind TEXT;`);
  } catch {
    // Column might already exist
  }

  // A saved failure belongs to one sign-in, including across process restarts.
  const pimColumns = await db.query<{ name: string }>(`PRAGMA table_info(pim_state)`);
  if (!pimColumns.some((column) => column.name === "auth_revision")) {
    await db.execute(`ALTER TABLE pim_state ADD COLUMN auth_revision TEXT;`);
  }

  try {
    await db.execute(`ALTER TABLE offline_queue ADD COLUMN requires_manual_intervention INTEGER DEFAULT 0;`);
  } catch {
    // Column might already exist
  }

  try {
    // E2E migration/rotation sweep (settings-sync plan §3.5): a forced re-write
    // that re-encrypts a file under the active key. Additive; it does not
    // invalidate remote_etag or base_sha256 (the plaintext hashes are unchanged).
    await db.execute(`ALTER TABLE offline_queue ADD COLUMN force INTEGER DEFAULT 0;`);
  } catch {
    // Column might already exist
  }

  try {
    await db.execute(`ALTER TABLE links ADD COLUMN property_key TEXT;`);
  } catch {
    // Column might already exist
  }

  try {
    await db.execute(`ALTER TABLE files ADD COLUMN ctime INTEGER;`);
  } catch {
    // Column might already exist
  }

  try {
    // Push journal (2026-07-16): the content hash persisted BEFORE an upload
    // starts, cleared once the base advanced. Lets the reconcile recognise its
    // own upload coming back ("echo") when the push response was lost.
    await db.execute(`ALTER TABLE sync_state ADD COLUMN pending_push_sha TEXT;`);
  } catch {
    // Column might already exist
  }

  try {
    // Per-event colour (2026-07-18): overrides the calendar colour on the grid.
    await db.execute(`ALTER TABLE pim_events ADD COLUMN color TEXT;`);
  } catch {
    // Column might already exist
  }

  try {
    // Attendee RSVP details (2026-07-18): the accept/decline back-channel.
    await db.execute(`ALTER TABLE pim_events ADD COLUMN rsvps TEXT;`);
  } catch {
    // Column might already exist
  }

  try {
    // Calendar blocker linkage (2026-07-21): provider marker pointing back to
    // the original event. Cache-only and fully rebuildable from the provider.
    await db.execute(`ALTER TABLE pim_events ADD COLUMN block_of TEXT;`);
  } catch {
    // Column might already exist
  }

  try {
    // The reverse half of the blocker linkage (2026-10-06, K3): the event's own
    // list of its blockers, as the provider stores it. Cache-only and fully
    // rebuildable; the next pull fills it.
    await db.execute(`ALTER TABLE pim_events ADD COLUMN blocks TEXT;`);
  } catch {
    // Column might already exist
  }
  // Finding the blockers of an event is a lookup by this column (K3).
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_pim_events_block_of ON pim_events(block_of);`);

  // What every provider carries but Plainva threw away (2026-08-09, S9):
  // reminders, busy/free, the online-meeting link and categories. All four are
  // cache-only and fully rebuildable from the provider, so an ALTER with no
  // backfill is enough — the next pull fills them.
  for (const column of ["reminders TEXT", "busy TEXT", "meeting_url TEXT", "categories TEXT", "status_kind TEXT", "working_loc TEXT"]) {
    try {
      await db.execute(`ALTER TABLE pim_events ADD COLUMN ${column};`);
    } catch {
      // Column might already exist
    }
  }

  // Old queued deletions have no operation-specific proof of confirmation.
  // Additive migration: never infer one from a historical path journal.
  const queueColumns = new Set((await db.query<{ name: string }>(`PRAGMA table_info(offline_queue)`)).map((row) => row.name));
  if (!queueColumns.has("delete_confirmed_at")) {
    await db.execute(`ALTER TABLE offline_queue ADD COLUMN delete_confirmed_at INTEGER`);
  }
  if (!queueColumns.has("delete_journaled")) {
    await db.execute(`ALTER TABLE offline_queue ADD COLUMN delete_journaled INTEGER NOT NULL DEFAULT 0`);
  }

  // Must run after the ALTER above: on pre-existing databases the links table
  // is created without property_key, so this index cannot live in schemaQueries.
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_links_property ON links(property_key, target_path);`);

  await migrateIndexFormat(db);
  // Paths are NFC identities since ADR 0016; re-keys what older versions stored.
  await migratePathIdentity(db);
}

/**
 * Index-format version 2 adds frontmatter wiki-links (with property_key) to the
 * links table. The link index is fully derivable from the vault files, so the
 * migration just forces the next indexVaultFull() (which runs right after
 * initializeSchema on vault open) to re-parse every markdown file by resetting
 * mtime_local. sync_state stays untouched: re-indexing an unchanged file is
 * hash-equal and fires no sync callbacks.
 *
 * Version 3 adds files.ctime (creation time, powering the graph's time axis).
 * The migration backfills ctime from mtime_local as the best available lower
 * bound BEFORE resetting mtime_local; the forced re-parse then upgrades rows
 * to the adapter's real birthtime where the platform provides one.
 */
// Version 4 stores YAML null separately from literal strings and rebuilds
// only the derived index. Note bytes and sync ancestry remain untouched.
//
// Version 5 gives the full-text table two columns for scripts written without
// spaces (Gesamtplan Volltextsuche CJK, 2026-09-30). It is the first step that
// re-parses nothing: the table is copied into its new shape, so search never
// stands empty, and only notes holding such text get the new columns filled.
const INDEX_FORMAT_VERSION = 5;

async function migrateIndexFormat(db: IDatabaseAdapter): Promise<void> {
  let stored: number;
  try {
    const row = await db.queryOne<{ value?: string; VALUE?: string }>(
      `SELECT value FROM meta WHERE key = 'index_format_version'`
    );
    const raw = row ? (row.value ?? row.VALUE) : undefined;
    stored = raw != null ? parseInt(String(raw), 10) || 0 : 0;
  } catch {
    stored = 0;
  }
  if (stored >= INDEX_FORMAT_VERSION) return;

  await upgradeFullTextTable(db);
  if (stored >= 4) {
    await fillSegmentedColumns(db);
  } else {
    // Below 4 every note is re-parsed, which fills the new columns as well.
    // Backfill BEFORE the mtime reset — ctime derives from mtime_local.
    await db.execute(`UPDATE files SET ctime = mtime_local WHERE ctime IS NULL`);
    await db.execute(`UPDATE files SET mtime_local = 0 WHERE path LIKE '%.md'`);
  }
  await db.execute(
    `INSERT OR REPLACE INTO meta (key, value) VALUES ('index_format_version', ?)`,
    [String(INDEX_FORMAT_VERSION)]
  );
}

const rowValue = (row: unknown, key: string): unknown =>
  (row as Record<string, unknown> | null)?.[key] ?? (row as Record<string, unknown> | null)?.[key.toUpperCase()];

/**
 * Brings `fts_notes` into its version-5 shape: copy into `fts_notes_next`,
 * drop, rename — search keeps its rows throughout. Every step can run again.
 * A run interrupted between drop and rename leaves the copy behind, and
 * initializeSchema recreates an empty `fts_notes` in the new shape meanwhile;
 * the copy then takes its place.
 */
async function upgradeFullTextTable(db: IDatabaseAdapter): Promise<void> {
  const columns = new Set(
    (await db.query(`PRAGMA table_info(fts_notes)`)).map((row) => String(rowValue(row, "name") ?? ""))
  );
  const copy = await db.queryOne(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fts_notes_next'`);
  if (columns.has("seg_content")) {
    if (!copy) return;
    const count = Number(rowValue(await db.queryOne(`SELECT count(*) AS n FROM fts_notes`), "n") ?? 0);
    await runStatementsAtomic(
      db,
      count === 0
        ? [{ sql: `DROP TABLE fts_notes` }, { sql: `ALTER TABLE fts_notes_next RENAME TO fts_notes` }]
        : [{ sql: `DROP TABLE fts_notes_next` }]
    );
    return;
  }
  await runStatementsAtomic(db, [
    { sql: `DROP TABLE IF EXISTS fts_notes_next` },
    { sql: `CREATE VIRTUAL TABLE fts_notes_next USING fts5(${FTS_NOTES_COLUMNS})` },
    { sql: `INSERT INTO fts_notes_next (content, title, path) SELECT content, title, path FROM fts_notes` },
    { sql: `DROP TABLE fts_notes` },
    { sql: `ALTER TABLE fts_notes_next RENAME TO fts_notes` },
  ]);
}

/**
 * Fills the pair columns from the text already in the index, 200 notes at a
 * time; SQL's GLOB picks the candidates, the segmenter decides. Nothing is
 * read from disk or re-parsed.
 */
async function fillSegmentedColumns(db: IDatabaseAdapter): Promise<void> {
  let after = 0;
  for (;;) {
    const rows = await db.query(
      `SELECT rowid AS id, content, title FROM fts_notes
       WHERE rowid > ? AND (content GLOB ? OR title GLOB ?)
       ORDER BY rowid LIMIT 200`,
      [after, SPACELESS_GLOB, SPACELESS_GLOB]
    );
    if (!rows.length) return;
    const updates: { sql: string; params: unknown[] }[] = [];
    for (const row of rows) {
      const segContent = segmentedIndexText(String(rowValue(row, "content") ?? ""));
      const segTitle = segmentedIndexText(String(rowValue(row, "title") ?? ""));
      if (segContent || segTitle) {
        updates.push({ sql: `UPDATE fts_notes SET seg_content = ?, seg_title = ? WHERE rowid = ?`, params: [segContent, segTitle, rowValue(row, "id")] });
      }
    }
    await runStatementsAtomic(db, updates);
    after = Number(rowValue(rows[rows.length - 1], "id"));
  }
}
