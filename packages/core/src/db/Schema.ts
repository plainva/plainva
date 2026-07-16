import { IDatabaseAdapter } from "./IDatabaseAdapter.js";

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
      requires_manual_intervention INTEGER DEFAULT 0
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

    // FTS5 Virtual Table for full-text search
    `CREATE VIRTUAL TABLE IF NOT EXISTS fts_notes USING fts5(
      content,
      title,
      path UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 1'
    );`,

    // Indices
    `CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_path);`,
    `CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);`,
    `CREATE INDEX IF NOT EXISTS idx_props_kv ON properties(key, value);`,
    // P2.1: every per-file re-index starts with DELETE FROM files WHERE id=?,
    // whose ON DELETE CASCADE otherwise full-scans links + properties on EVERY
    // save; wiki-link resolution matches files.title with COLLATE NOCASE, so
    // the index must carry the same collation to be usable.
    `CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);`,
    `CREATE INDEX IF NOT EXISTS idx_props_file ON properties(file_id);`,
    `CREATE INDEX IF NOT EXISTS idx_files_title ON files(title COLLATE NOCASE);`
  ];

  for (const query of schemaQueries) {
    await db.execute(query);
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
    await db.execute(`ALTER TABLE offline_queue ADD COLUMN requires_manual_intervention INTEGER DEFAULT 0;`);
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

  // Must run after the ALTER above: on pre-existing databases the links table
  // is created without property_key, so this index cannot live in schemaQueries.
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_links_property ON links(property_key, target_path);`);

  await migrateIndexFormat(db);
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
const INDEX_FORMAT_VERSION = 3;

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

  // Backfill BEFORE the mtime reset below — ctime derives from mtime_local.
  await db.execute(`UPDATE files SET ctime = mtime_local WHERE ctime IS NULL`);
  await db.execute(`UPDATE files SET mtime_local = 0 WHERE path LIKE '%.md'`);
  await db.execute(
    `INSERT OR REPLACE INTO meta (key, value) VALUES ('index_format_version', ?)`,
    [String(INDEX_FORMAT_VERSION)]
  );
}
