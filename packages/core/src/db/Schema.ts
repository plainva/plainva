import { IDatabaseAdapter } from "./IDatabaseAdapter.js";
import { migratePathIdentity } from "./pathIdentityMigration.js";
import { flagLossyTextBases } from "./lossyTextBaseMigration.js";
import { mergeWorkspaceQueueCopies } from "./workspaceQueueCopies.js";
import { markNotesForWikiLinkReading } from "./wikiLinkReadingMigration.js";
import { runStatementsAtomic } from "./batch.js";
import { FIRST_ROWID_BEFORE, FULL_TEXT_SENTINEL, fullTextRowOf, UNNUMBERED_FLAG } from "./fullTextRows.js";
import { segmentedIndexText, SPACELESS_GLOB } from "../vault/spacelessText.js";

/**
 * The full-text table. `content` doubles as the note text for other readers
 * (tasks overview, graph); `seg_content`/`seg_title` hold the character-pair
 * form of text written without spaces (vault/spacelessText.ts, format 5).
 * `content`, `title` and `path` stay in front — inserts that name only those
 * keep working, and so does an older app on a newer index. Since format 9 the
 * `files` row names its full-text row (`files.fts_rowid`, db/fullTextRows.ts).
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
      pending_push_sha TEXT,
      recheck INTEGER,
      pulled_sha256 TEXT,
      pulled_mtime INTEGER,
      not_text_sha256 TEXT
    );`,

    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );`,

    // Files the index found gone and reported, until their remote deletion is
    // queued (stability plan R22, sync/owedToRemote.ts). An older build neither
    // writes nor reads it.
    `CREATE TABLE IF NOT EXISTS index_removed (
      path       TEXT PRIMARY KEY,
      removed_at INTEGER NOT NULL
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
      recurring  INTEGER,
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
    // "Look at this file again" (2026-10-11): set once for the rows an older
    // version left for a file it synced as decoded text although its bytes are
    // not UTF-8 (lossyTextBaseMigration.ts), cleared by the reconcile that has
    // compared the file with the server's copy. A column of its own, because it
    // has to outlive a rename and a push, which both rewrite the remote marker.
    await db.execute(`ALTER TABLE sync_state ADD COLUMN recheck INTEGER;`);
  } catch {
    // Column might already exist
  }

  // The version the sync last DOWNLOADED and wrote here, and when it last
  // changed on the remote (Sammelplan § 3.164). "Edited at" of a file whose
  // current content is that version is the remote's time, not the moment of
  // the download — a fresh connection listed every pulled note as edited
  // today. Additive and nullable: a row without them keeps the local time.
  for (const statement of [
    `ALTER TABLE sync_state ADD COLUMN pulled_sha256 TEXT;`,
    `ALTER TABLE sync_state ADD COLUMN pulled_mtime INTEGER;`,
  ]) {
    try {
      await db.execute(statement);
    } catch {
      // Column might already exist
    }
  }

  try {
    // "The version this row names is no text" (2026-11-03, Sammelplan § 3.86
    // no. 2): the hash of the bytes the sync, the index or an open found to be
    // no UTF-8 (`SyncState.not_text_sha256`). Additive and nullable: a row
    // without it is judged as before, so nothing is guessed about a row an
    // older version wrote.
    await db.execute(`ALTER TABLE sync_state ADD COLUMN not_text_sha256 TEXT;`);
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

  try {
    // Whether the provider says a task repeats (finding 2026-10-24: the
    // phone's reminders). Cache-only and fully rebuildable; the next pull
    // fills it.
    await db.execute(`ALTER TABLE pim_tasks ADD COLUMN recurring INTEGER;`);
  } catch {
    // Column might already exist
  }

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

  // Index format 9 (db/fullTextRows.ts): the `files` row names its full-text
  // row, a deleted file takes its row with it, and an insert by a build that
  // does not know the column raises the flag the next start answers.
  try {
    await db.execute(`ALTER TABLE files ADD COLUMN fts_rowid INTEGER`);
  } catch {
    // Column already exists
  }
  await migrateIndexFormat(db);
  // After the migration: the copy of version 5 renames the table, which a
  // trigger naming it would refuse while it is gone.
  // The first form of the delete trigger took the row at the number alone; a
  // number an older build had reused for another note went with it.
  await db.execute(`DROP TRIGGER IF EXISTS files_takes_its_full_text_row`);
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS files_full_text_row_goes AFTER DELETE ON files BEGIN
       DELETE FROM fts_notes WHERE rowid = (CASE OLD.fts_rowid WHEN 0 THEN -OLD.rowid ELSE OLD.fts_rowid END)
         AND (path = OLD.path OR NOT EXISTS (SELECT 1 FROM files WHERE files.path = fts_notes.path));
     END`
  );
  await db.execute(
    `CREATE TRIGGER IF NOT EXISTS files_written_by_older_index AFTER INSERT ON files WHEN NEW.fts_rowid IS NULL BEGIN
       INSERT OR REPLACE INTO meta (key, value) VALUES ('${UNNUMBERED_FLAG}', '1');
     END`
  );

  // Paths are NFC identities since ADR 0016; re-keys what older versions stored.
  await migratePathIdentity(db);
  // Files an older version synced as text although their bytes are not UTF-8
  // are reconciled once more by the next full listing.
  await flagLossyTextBases(db);
  // Entries of the encrypted workspace's queue an older version queued twice
  // are one again (Datensicherheit D2).
  await mergeWorkspaceQueueCopies(db);
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
//
// Version 6 reads a wiki link where the tokenizer reads a code span, as the
// name it is written as (finding 2026-10-11). Only the notes whose links the
// two readings may list differently are read again by the next full scan
// (`wikiLinkReadingMigration.ts`).
//
// Version 7 reads the target of a Markdown link anew (finding 2026-10-11): a
// link without an anchor of its own was cut at the first `#` or `^` of its
// DECODED target, so `Draft%20%231.md` stood in the link table as a link to
// `Draft` with the anchor `#1.md`. A stored row cannot tell such a link from
// one with a real anchor — both carry one —, so every note that holds a
// Markdown link with an anchor is re-parsed, and no other.
//
// Version 8 reads a note's properties field by field (ADR 0009, addendum
// 2026-10-22): one value outside its field's form — an empty `tags:`, a
// `timestamp` that is a date — made the reader refuse the whole block, and the
// index held no property, no tag from the block and no title of that note. A
// row cannot tell such a note from one whose block holds nothing, so every
// note that begins with a block and that the index holds no property for is
// re-parsed, and no other.
//
// Version 9 lets the `files` row name its full-text row (Gesamtplan Leistung
// L1, db/fullTextRows.ts), so a note's row is deleted and replaced by its
// number instead of by a search over the whole table. Nothing is re-parsed
// and no text is tokenized again: `numberFullTextRows` records the number
// every row already has. It runs again at a start after an older build wrote
// to the index (the flag its inserts raise).
const INDEX_FORMAT_VERSION = 9;

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
  if (stored >= INDEX_FORMAT_VERSION) {
    // Only what an older build may have left on this index since (version 9).
    const flagged = await db.queryOne(`SELECT value FROM meta WHERE key = ?`, [UNNUMBERED_FLAG]);
    if (flagged) await numberFullTextRowsOrRebuild(db, { adoptUnnamed: false });
    return;
  }

  if (stored < 5) await upgradeFullTextTable(db);
  if (stored >= 4) {
    if (stored < 5) await fillSegmentedColumns(db);
    if (stored < 6) await markNotesForWikiLinkReading(db);
    // Version 7: the notes whose Markdown links may stand under a cut target.
    // The same reset as below, for those notes alone — the next full pass
    // re-parses them, and a file that has not changed fires no sync callback.
    if (stored < 7) {
      await db.execute(
        `UPDATE files SET mtime_local = 0
         WHERE id IN (SELECT source_id FROM links WHERE link_type = 'markdown-link' AND anchor IS NOT NULL)`
      );
    }
    // Version 8: the notes that begin with a block (`---`, after a byte order
    // mark too) and that the index holds no property for — those whose block
    // the reader refused, among the ones whose block holds nothing. Their text
    // is in `fts_notes`, read once for all of them.
    if (stored < 8) {
      await db.execute(
        `UPDATE files SET mtime_local = 0
         WHERE path LIKE '%.md'
           AND NOT EXISTS (SELECT 1 FROM properties WHERE properties.file_id = files.id)
           AND path IN (SELECT path FROM fts_notes WHERE substr(content, 1, 3) = '---' OR substr(content, 1, 4) = char(65279) || '---')`
      );
    }
  } else {
    // Below 4 every note is re-parsed, which fills the new columns as well.
    // Backfill BEFORE the mtime reset — ctime derives from mtime_local.
    await db.execute(`UPDATE files SET ctime = mtime_local WHERE ctime IS NULL`);
    await db.execute(`UPDATE files SET mtime_local = 0 WHERE path LIKE '%.md'`);
  }
  // Version 9: every `files` row names its full-text row. Last, so the steps
  // above read the table as they always did.
  await numberFullTextRowsOrRebuild(db, { adoptUnnamed: true });
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
  // An index this old has no triggers of format 9; should one be there, it
  // would refuse the rename below (initializeSchema creates them afterwards).
  await db.execute(`DROP TRIGGER IF EXISTS files_takes_its_full_text_row`);
  await db.execute(`DROP TRIGGER IF EXISTS files_full_text_row_goes`);
  await db.execute(`DROP TRIGGER IF EXISTS files_written_by_older_index`);
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
  // From the smallest number there is: rows numbered by format 9 are negative.
  let after = FIRST_ROWID_BEFORE;
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

/**
 * Where a failed numbering of the full-text rows is recorded in `meta`: a
 * count and a date, nothing of the vault. Both shells put it into the
 * diagnostics export at the vault's open (`readIndexDiagnostics`, then
 * `logIndexDiagnostics` in packages/ui).
 */
export const FULL_TEXT_NUMBERING_DIAGNOSTIC = "index-diagnostic:fts-numbering";

/** What the index recorded about itself for the diagnostics: a kind and a count, no path, no text. */
export interface IndexDiagnostic {
  kind: string;
  count: number;
}

/** The count a diagnostic record holds (`{ count, at }`), 0 for anything else. */
function diagnosticCount(value: unknown): number {
  try {
    return Number(JSON.parse(String(value ?? "{}")).count) || 0;
  } catch {
    return 0;
  }
}

/** The index's own diagnostics (`meta` keys `index-diagnostic:*`), for the diagnostics export of both shells. */
export async function readIndexDiagnostics(db: IDatabaseAdapter): Promise<IndexDiagnostic[]> {
  let rows: unknown[];
  try {
    rows = await db.query(`SELECT key, value FROM meta WHERE key LIKE 'index-diagnostic:%'`);
  } catch {
    return [];
  }
  const out: IndexDiagnostic[] = [];
  for (const row of rows ?? []) {
    const key = String(rowValue(row, "key") ?? "");
    if (!key.startsWith("index-diagnostic:")) continue;
    const count = diagnosticCount(rowValue(row, "value"));
    if (count > 0) out.push({ kind: key.slice("index-diagnostic:".length), count });
  }
  return out;
}

const CHUNK = 400;
const chunks = <T,>(items: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
};

/**
 * What `numberFullTextRows` writes for an index: which number each file names,
 * which rows go, which move. Pure, so a test can read it from rows.
 *
 * - Per path the one row to keep is the one the file names. Nothing is
 *   guessed: a path whose file names no row it has keeps none, and the
 *   closing sweep hands the note to the next full pass, which writes its
 *   current text. "The highest number is the latest text" is false: this
 *   build's rows are negative (newer is more negative), an older build's are
 *   positive, and the delete trigger leaves a row on purpose when its path
 *   now belongs to another file (a renamed note whose search row still
 *   carries the old path) — such an orphan under a path can be another
 *   note's text, at any number.
 * - One exception, `adoptUnnamed` (the first start of format 9 only): an
 *   index of format 8 names no row anywhere, and it kept one row per path
 *   (every write deleted the path's rows before it inserted). A path with
 *   exactly one row adopts it. Where that row is not the note's own text, a
 *   queued rename moved the files row and set its `mtime_local` to 0, so the
 *   next pass re-reads the note and replaces the row by its number. A path
 *   with more than one row adopts none. On a start flagged by an older build
 *   (`adoptUnnamed` false) a file it wrote names nothing, and its rows go:
 *   its parse-error REPLACE of the files row leaves the search rows of the
 *   path as they were, an orphan among them.
 * - A kept row at 0 or above keeps its number and the file records it (a row
 *   of an index from before format 9; this build never writes there). A kept
 *   row below 0 that is not at `-files.rowid` moves there: an older build
 *   numbered it on top of the table after this build's rows. No other row can
 *   sit at that number — it would belong to the same file.
 * - Rows of a path no file has, and the rows not kept, go.
 */
export function planFullTextNumbering(
  rows: readonly { rowid: number; path: string }[],
  files: readonly { rowid: number; path: string; fts_rowid: number | null }[],
  { adoptUnnamed }: { adoptUnnamed: boolean },
): { explicit: { path: string; num: number }[]; drop: number[]; move: number[] } {
  const fileByPath = new Map(files.map((f) => [f.path, f]));
  const byPath = new Map<string, number[]>();
  const drop: number[] = [];
  for (const row of rows) {
    if (row.rowid === 0 && row.path === "") continue; // the sentinel (fullTextRows.ts)
    if (!fileByPath.has(row.path)) drop.push(row.rowid);
    else byPath.set(row.path, [...(byPath.get(row.path) ?? []), row.rowid]);
  }
  const explicit: { path: string; num: number }[] = [];
  const move: number[] = [];
  for (const [path, numbers] of byPath) {
    const file = fileByPath.get(path)!;
    const named = file.fts_rowid === null ? null : file.fts_rowid === 0 ? -file.rowid : file.fts_rowid;
    const keep = named !== null ? (numbers.includes(named) ? named : null) : adoptUnnamed && numbers.length === 1 ? numbers[0] : null;
    for (const n of numbers) if (n !== keep) drop.push(n);
    // No row kept: the closing sweep of numberFullTextRows sets the note's
    // mtime_local to 0, and the next full pass writes its current text.
    if (keep === null) continue;
    if (keep === -file.rowid) continue;
    // Only above 0: 0 itself reads as "-rowid" in `fts_rowid`, and the
    // sentinel lives there; below 0 is this build's range.
    if (keep > 0) explicit.push({ path, num: keep });
    else move.push(keep);
  }
  return { explicit, drop, move };
}

/**
 * Index format 9 (db/fullTextRows.ts): every `files` row names its full-text
 * row. Reads the number and path of every row once and writes, in one batch:
 * the numbers the files name (`fts_rowid`), the rows that go, the few rows an
 * older build numbered among this build's that move to `-files.rowid` (only
 * those are tokenized again), the sentinel, the notes left without a row
 * handed to the next full pass, the version, and the flag cleared. An
 * interrupted batch leaves the index as it was, and the next start does it
 * again.
 *
 * Reading the paths is not free: `path` is stored after `content` in each
 * row's record, so SQLite walks every row's text to reach it — the whole
 * table once (about 30 MB of text at 10 000 notes; 108–140 ms on a laptop,
 * measured with scripts/perf/numbering-cost.ts). It runs only on the first
 * start of format 9 and after an older build wrote to the index.
 */
async function numberFullTextRows(db: IDatabaseAdapter, adoptUnnamed: boolean): Promise<void> {
  // Only an adapter without a batch can leave this behind, half way through
  // a move: its rows are no longer in the table.
  if (await db.queryOne(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fts_moving'`)) {
    throw new Error("an earlier numbering of the full-text rows stopped half way");
  }
  const rows = (await db.query(`SELECT rowid, path FROM fts_notes`)).map((r) => ({ rowid: Number(rowValue(r, "rowid")), path: String(rowValue(r, "path") ?? "") }));
  const files = (await db.query(`SELECT rowid, path, fts_rowid FROM files`)).map((r) => {
    const named = rowValue(r, "fts_rowid");
    return { rowid: Number(rowValue(r, "rowid")), path: String(rowValue(r, "path") ?? ""), fts_rowid: named === null || named === undefined ? null : Number(named) };
  });
  const plan = planFullTextNumbering(rows, files, { adoptUnnamed });
  const statements: { sql: string; params?: unknown[] }[] = [
    { sql: `DROP TABLE IF EXISTS fts_number_map` },
    { sql: `CREATE TABLE fts_number_map (path TEXT PRIMARY KEY, num INTEGER NOT NULL)` },
    ...chunks(plan.explicit).map((part) => ({
      sql: `INSERT INTO fts_number_map (path, num) VALUES ${part.map(() => "(?, ?)").join(", ")}`,
      params: part.flatMap((e) => [e.path, e.num]),
    })),
    { sql: `UPDATE files SET fts_rowid = coalesce((SELECT num FROM fts_number_map m WHERE m.path = files.path), 0)` },
    { sql: `DROP TABLE fts_number_map` },
    ...chunks(plan.drop).map((part) => ({ sql: `DELETE FROM fts_notes WHERE rowid IN (${part.map(() => "?").join(", ")})`, params: part })),
  ];
  if (plan.move.length > 0) {
    statements.push({ sql: `CREATE TABLE fts_moving (path TEXT, content TEXT, title TEXT, seg_content TEXT, seg_title TEXT)` });
    for (const part of chunks(plan.move)) {
      const marks = part.map(() => "?").join(", ");
      statements.push(
        { sql: `INSERT INTO fts_moving SELECT path, content, title, seg_content, seg_title FROM fts_notes WHERE rowid IN (${marks})`, params: part },
        { sql: `DELETE FROM fts_notes WHERE rowid IN (${marks})`, params: part },
      );
    }
    statements.push(
      {
        sql: `INSERT OR REPLACE INTO fts_notes (rowid, content, title, path, seg_content, seg_title)
          SELECT -f.rowid, m.content, m.title, m.path, m.seg_content, m.seg_title FROM fts_moving m JOIN files f ON f.path = m.path`,
      },
      { sql: `DROP TABLE fts_moving` },
    );
  }
  statements.push(
    // The sentinel back in its place (after the moves: a note's row an older
    // build had put at 0 has gone to its own number by now).
    { sql: FULL_TEXT_SENTINEL },
    // Every note that ends without a row is read again by the next full pass:
    // no sequence of an older build leaves a note unsearchable until it is
    // edited (a row it deleted, its REPLACE of a files row).
    {
      sql: `UPDATE files SET mtime_local = 0
        WHERE path LIKE '%.md' AND (mode IS NULL OR mode <> 'attachment')
          AND NOT EXISTS (SELECT 1 FROM fts_notes n WHERE n.rowid = ${fullTextRowOf("files")} AND n.path = files.path)`,
    },
    { sql: `DELETE FROM meta WHERE key = ?`, params: [UNNUMBERED_FLAG] },
    { sql: `INSERT OR REPLACE INTO meta (key, value) VALUES ('index_format_version', ?)`, params: [String(INDEX_FORMAT_VERSION)] },
  );
  await runStatementsAtomic(db, statements);
}

/**
 * A numbering that fails never keeps a vault from opening: the full-text
 * table is then dropped and made anew, every note is handed to the next full
 * pass, and the failure is recorded under {@link FULL_TEXT_NUMBERING_DIAGNOSTIC}.
 * Search is empty until that pass has read the notes again — the price of an
 * index that could not be trusted. Should even that fail, the open goes on.
 */
async function numberFullTextRowsOrRebuild(db: IDatabaseAdapter, { adoptUnnamed }: { adoptUnnamed: boolean }): Promise<void> {
  try {
    await numberFullTextRows(db, adoptUnnamed);
    return;
  } catch (error) {
    console.error("[index] numbering the full-text rows failed; the full-text index is built anew", error);
    // A kind and a count, nothing of the vault: it goes into the diagnostics export (readIndexDiagnostics).
    const count = diagnosticCount(rowValue(await db.queryOne(`SELECT value FROM meta WHERE key = ?`, [FULL_TEXT_NUMBERING_DIAGNOSTIC]).catch(() => null), "value"));
    const record = JSON.stringify({ count: count + 1, at: new Date().toISOString() });
    try {
      await runStatementsAtomic(db, [
        { sql: `DROP TABLE IF EXISTS fts_number_map` },
        { sql: `DROP TABLE IF EXISTS fts_moving` },
        { sql: `DROP TABLE IF EXISTS fts_notes` },
        { sql: `CREATE VIRTUAL TABLE fts_notes USING fts5(${FTS_NOTES_COLUMNS})` },
        { sql: FULL_TEXT_SENTINEL },
        { sql: `UPDATE files SET fts_rowid = 0` },
        { sql: `UPDATE files SET mtime_local = 0 WHERE path LIKE '%.md'` },
        { sql: `DELETE FROM meta WHERE key = ?`, params: [UNNUMBERED_FLAG] },
        { sql: `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, params: [FULL_TEXT_NUMBERING_DIAGNOSTIC, record] },
        { sql: `INSERT OR REPLACE INTO meta (key, value) VALUES ('index_format_version', ?)`, params: [String(INDEX_FORMAT_VERSION)] },
      ]);
    } catch (fallback) {
      console.error("[index] building the full-text index anew failed too; the vault opens without it", fallback);
    }
  }
}
