//! Transactional statement batch (hardening plan B3).
//!
//! One Tauri command runs an ORDERED list of SQL statements on a SINGLE SQLite
//! connection inside one transaction: BEGIN, execute each, COMMIT — or ROLLBACK on
//! the first error, so nothing partial is ever left behind. This gives two things
//! the per-statement `tauri-plugin-sql` path cannot:
//!   * atomicity — a crash or error mid-batch leaves the DB unchanged, and
//!   * throughput — the cold vault index issued one `execute()` (one IPC hop, one
//!     pooled-connection checkout, one auto-commit) per row; a whole file's worth
//!     of writes now travels in a single call.
//!
//! It opens its OWN short-lived connection to the same DB file. The database runs
//! in WAL mode, so this connection sees (and is seen by) `tauri-plugin-sql`'s pool
//! once committed. A generous `busy_timeout` waits out any transient write lock;
//! `foreign_keys = ON` keeps the `files`-row `ON DELETE CASCADE` to
//! links/tags/properties intact within the batch.
//!
//! NOTE (maintainer): the native build must be verified. The batch runs on a
//! separate connection from the plugin pool — WAL makes that safe for committed
//! reads, and the JS side serializes batches — but confirm there is no lock
//! contention regression under a real cold index of a large vault before this is
//! relied on for the full indexer hot path. `sqlx` here is the same version
//! `tauri-plugin-sql` already links (no second SQLite is bundled).

use serde::Deserialize;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection};
use std::str::FromStr;
use std::time::Duration;

/// One SQL statement plus its positional bind parameters. Params arrive as JSON
/// values from the frontend and are bound as SQLite scalars.
#[derive(Deserialize)]
pub struct BatchStatement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<serde_json::Value>,
}

/// Runs `statements` in order inside one transaction and returns the total number
/// of rows affected. `db_path` is the same connection string the frontend hands to
/// the SQL plugin (a `sqlite:...` URL). On any error the transaction is rolled back
/// and the error message is returned — the database is left exactly as it was.
#[tauri::command]
pub async fn db_batch(db_path: String, statements: Vec<BatchStatement>) -> Result<u64, String> {
    run_batch(&db_path, &statements)
        .await
        .map_err(|e| e.to_string())
}

async fn run_batch(db_path: &str, statements: &[BatchStatement]) -> Result<u64, sqlx::Error> {
    let opts = SqliteConnectOptions::from_str(db_path)?
        .create_if_missing(false)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(10));
    let mut conn = opts.connect().await?;
    let mut tx = conn.begin().await?;
    let mut affected: u64 = 0;
    for stmt in statements {
        let mut q = sqlx::query(&stmt.sql);
        for p in &stmt.params {
            q = match p {
                serde_json::Value::Null => q.bind(None::<String>),
                serde_json::Value::Bool(b) => q.bind(*b as i64),
                serde_json::Value::Number(n) => {
                    if let Some(i) = n.as_i64() {
                        q.bind(i)
                    } else if let Some(f) = n.as_f64() {
                        q.bind(f)
                    } else {
                        q.bind(n.to_string())
                    }
                }
                serde_json::Value::String(s) => q.bind(s.clone()),
                // Arrays/objects are not SQLite scalars; the app never binds these,
                // but store their JSON text rather than panic on an unexpected shape.
                other => q.bind(other.to_string()),
            };
        }
        // The `?` drops `tx`, which rolls the transaction back on any statement error.
        affected += q.execute(&mut *tx).await?.rows_affected();
    }
    tx.commit().await?;
    // Close the short-lived connection so its WAL lock is released promptly.
    let _ = conn.close().await;
    Ok(affected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp_url() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index.db");
        let url = format!("sqlite:{}", path.to_string_lossy().replace('\\', "/"));
        (dir, url)
    }

    async fn setup(url: &str) {
        // A tiny schema that mirrors the real one's `ON DELETE CASCADE` shape.
        let mut c = SqliteConnectOptions::from_str(url)
            .unwrap()
            .create_if_missing(true)
            .foreign_keys(true)
            .connect()
            .await
            .unwrap();
        sqlx::query("CREATE TABLE files (id TEXT PRIMARY KEY, title TEXT, n INTEGER, f REAL, flag INTEGER)")
            .execute(&mut c)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE tags (file_id TEXT REFERENCES files(id) ON DELETE CASCADE, tag TEXT)")
            .execute(&mut c)
            .await
            .unwrap();
        c.close().await.unwrap();
    }

    async fn scalar(url: &str, sql: &str) -> i64 {
        let mut c = SqliteConnectOptions::from_str(url)
            .unwrap()
            .foreign_keys(true)
            .connect()
            .await
            .unwrap();
        let row: (i64,) = sqlx::query_as(sql).fetch_one(&mut c).await.unwrap();
        c.close().await.unwrap();
        row.0
    }

    fn block<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    #[test]
    fn commits_all_statements_in_order() {
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            let stmts = vec![
                BatchStatement {
                    sql: "INSERT INTO files (id, title) VALUES (?, ?)".into(),
                    params: vec![json!("a"), json!("A")],
                },
                BatchStatement {
                    sql: "INSERT INTO tags (file_id, tag) VALUES (?, ?)".into(),
                    params: vec![json!("a"), json!("x")],
                },
            ];
            let n = run_batch(&url, &stmts).await.unwrap();
            assert_eq!(n, 2);
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM files").await, 1);
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM tags").await, 1);
        });
    }

    #[test]
    fn rolls_back_the_whole_batch_on_error() {
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            // The second statement violates the PRIMARY KEY -> the entire batch,
            // including the first (valid) insert, must be rolled back.
            let stmts = vec![
                BatchStatement {
                    sql: "INSERT INTO files (id, title) VALUES (?, ?)".into(),
                    params: vec![json!("a"), json!("A")],
                },
                BatchStatement {
                    sql: "INSERT INTO files (id, title) VALUES (?, ?)".into(),
                    params: vec![json!("a"), json!("dup")],
                },
            ];
            assert!(run_batch(&url, &stmts).await.is_err());
            // Atomic: NOTHING from the batch persisted.
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM files").await, 0);
        });
    }

    #[test]
    fn foreign_key_cascade_fires_inside_the_batch() {
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            run_batch(
                &url,
                &[
                    BatchStatement {
                        sql: "INSERT INTO files (id, title) VALUES (?, ?)".into(),
                        params: vec![json!("a"), json!("A")],
                    },
                    BatchStatement {
                        sql: "INSERT INTO tags (file_id, tag) VALUES (?, ?)".into(),
                        params: vec![json!("a"), json!("x")],
                    },
                ],
            )
            .await
            .unwrap();
            // A DELETE of the parent row must cascade to the child in the same batch.
            run_batch(
                &url,
                &[BatchStatement {
                    sql: "DELETE FROM files WHERE id = ?".into(),
                    params: vec![json!("a")],
                }],
            )
            .await
            .unwrap();
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM tags").await, 0);
        });
    }

    #[test]
    fn binds_null_int_float_bool_and_string() {
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            run_batch(
                &url,
                &[BatchStatement {
                    sql: "INSERT INTO files (id, title, n, f, flag) VALUES (?, ?, ?, ?, ?)".into(),
                    params: vec![json!("a"), json!(null), json!(42), json!(1.5), json!(true)],
                }],
            )
            .await
            .unwrap();
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM files WHERE title IS NULL").await, 1);
            assert_eq!(scalar(&url, "SELECT n FROM files WHERE id='a'").await, 42);
            assert_eq!(scalar(&url, "SELECT flag FROM files WHERE id='a'").await, 1);
            assert_eq!(scalar(&url, "SELECT CAST(f AS INTEGER) FROM files WHERE id='a'").await, 1);
        });
    }

    #[test]
    fn bulk_insert_of_many_rows_is_one_transaction() {
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            let stmts: Vec<BatchStatement> = (0..1000)
                .map(|i| BatchStatement {
                    sql: "INSERT INTO files (id, title) VALUES (?, ?)".into(),
                    params: vec![json!(format!("id{i}")), json!(format!("t{i}"))],
                })
                .collect();
            let n = run_batch(&url, &stmts).await.unwrap();
            assert_eq!(n, 1000);
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM files").await, 1000);
        });
    }

    // Index format 9 (performance plan L1) on the SQLite this app bundles
    // (libsqlite3-sys through sqlx): the app's own DDL for `files`, `meta` and
    // `fts_notes`, its two triggers on `files` that write to the FTS5 table,
    // and the statements of this build and of v0.8.7, each sent through the
    // batch the indexer uses on the desktop. packages/core/src/db/Schema.ts and
    // fullTextRows.ts hold the originals; a change there belongs here too.
    const FILES_DDL: &str = "CREATE TABLE files (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT, sha256 TEXT, cloud_etag TEXT, cloud_id TEXT, mtime_local INTEGER, mtime_cloud INTEGER, size_bytes INTEGER, is_cached INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0, mode TEXT, sync_state TEXT DEFAULT 'synced')";
    const META_DDL: &str = "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)";
    const FTS_DDL: &str = "CREATE VIRTUAL TABLE fts_notes USING fts5(content, title, path UNINDEXED, seg_content, seg_title, tokenize = 'unicode61 remove_diacritics 1')";
    const ADD_CTIME: &str = "ALTER TABLE files ADD COLUMN ctime INTEGER";
    const ADD_COLUMN: &str = "ALTER TABLE files ADD COLUMN fts_rowid INTEGER";
    const DELETE_TRIGGER: &str = "CREATE TRIGGER IF NOT EXISTS files_full_text_row_goes AFTER DELETE ON files BEGIN
       DELETE FROM fts_notes WHERE rowid = (CASE OLD.fts_rowid WHEN 0 THEN -OLD.rowid ELSE OLD.fts_rowid END)
         AND (path = OLD.path OR NOT EXISTS (SELECT 1 FROM files WHERE files.path = fts_notes.path));
     END";
    const SENTINEL: &str = "INSERT OR REPLACE INTO fts_notes (rowid, content, title, path, seg_content, seg_title) VALUES (0, '', '', '', '', '')";
    const INSERT_TRIGGER: &str = "CREATE TRIGGER IF NOT EXISTS files_written_by_older_index AFTER INSERT ON files WHEN NEW.fts_rowid IS NULL BEGIN
       INSERT OR REPLACE INTO meta (key, value) VALUES ('fts_rows_unnumbered', '1');
     END";
    const INSERT_FULL_TEXT_ROW: &str = "INSERT OR REPLACE INTO fts_notes (content, title, path, seg_content, seg_title, rowid)
   VALUES (?, ?, ?, ?, ?, -(SELECT rowid FROM files WHERE path = ?))";

    async fn setup_index(url: &str) {
        let mut c = SqliteConnectOptions::from_str(url)
            .unwrap()
            .create_if_missing(true)
            .foreign_keys(true)
            .connect()
            .await
            .unwrap();
        for sql in [FILES_DDL, META_DDL, FTS_DDL, ADD_CTIME, ADD_COLUMN, DELETE_TRIGGER, INSERT_TRIGGER, SENTINEL] {
            sqlx::query(sql).execute(&mut c).await.unwrap();
        }
        c.close().await.unwrap();
    }

    fn stmt(sql: &str, params: Vec<serde_json::Value>) -> BatchStatement {
        BatchStatement { sql: sql.into(), params }
    }

    /// This build's statements for a note read again (VaultIndexer, index format 9).
    fn save_this_build(path: &str, text: &str) -> Vec<BatchStatement> {
        vec![
            stmt("DELETE FROM files WHERE id = ? OR path = ?", vec![json!(format!("id:{path}")), json!(path)]),
            stmt(
                "INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state, fts_rowid) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)",
                vec![json!(format!("id:{path}")), json!(path), json!("t"), json!("h"), json!(1), json!(1), json!(1), json!("obsidian"), json!("synced")],
            ),
            stmt(INSERT_FULL_TEXT_ROW, vec![json!(text), json!("t"), json!(path), json!(""), json!(""), json!(path)]),
        ]
    }

    /// v0.8.7's statements for the same (`git show v0.8.7:packages/core/src/vault/VaultIndexer.ts`).
    fn save_older_build(path: &str, text: &str) -> Vec<BatchStatement> {
        vec![
            stmt("DELETE FROM files WHERE id = ? OR path = ?", vec![json!(format!("older:{path}")), json!(path)]),
            stmt("DELETE FROM fts_notes WHERE path = ?", vec![json!(path)]),
            stmt(
                "INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
                vec![json!(format!("older:{path}")), json!(path), json!("t"), json!("h"), json!(1), json!(1), json!(1), json!("obsidian"), json!("synced")],
            ),
            stmt("INSERT INTO fts_notes (content, title, path, seg_content, seg_title) VALUES (?, ?, ?, ?, ?)", vec![json!(text), json!("t"), json!(path), json!(""), json!("")]),
        ]
    }

    async fn rows_named_by_their_file(url: &str) -> i64 {
        scalar(url, "SELECT COUNT(*) FROM fts_notes n WHERE EXISTS (SELECT 1 FROM files f WHERE f.path = n.path AND (CASE f.fts_rowid WHEN 0 THEN -f.rowid ELSE f.fts_rowid END) = n.rowid)").await
    }

    #[test]
    fn full_text_rows_follow_their_files_on_the_bundled_sqlite() {
        block(async {
            let (_d, url) = tmp_url();
            setup_index(&url).await;
            // This build: a note saved twice keeps exactly one row, at -files.rowid, with the new text.
            run_batch(&url, &save_this_build("A.md", "first zeppelin")).await.unwrap();
            run_batch(&url, &save_this_build("B.md", "another note")).await.unwrap();
            run_batch(&url, &save_this_build("A.md", "second balloon")).await.unwrap();
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM fts_notes WHERE rowid <> 0").await, 2);
            assert_eq!(rows_named_by_their_file(&url).await, 2);
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM fts_notes WHERE fts_notes MATCH 'zeppelin'").await, 0);
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM fts_notes WHERE fts_notes MATCH 'balloon'").await, 1);
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM meta WHERE key = 'fts_rows_unnumbered'").await, 0);
            // A deleted file takes its row with it: the trigger writes to the FTS5 table.
            run_batch(&url, &[stmt("DELETE FROM files WHERE path IN (?)", vec![json!("B.md")])]).await.unwrap();
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM fts_notes WHERE rowid <> 0").await, 1);
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM fts_notes WHERE fts_notes MATCH 'another'").await, 0);
        });
    }

    #[test]
    fn an_older_build_on_the_index_raises_the_flag_on_the_bundled_sqlite() {
        block(async {
            let (_d, url) = tmp_url();
            setup_index(&url).await;
            run_batch(&url, &save_this_build("A.md", "first")).await.unwrap();
            run_batch(&url, &save_this_build("B.md", "second")).await.unwrap();
            // v0.8.7 saves A: SQLite numbers its insert above the sentinel at 0, apart from this build's rows.
            run_batch(&url, &save_older_build("A.md", "older zeppelin")).await.unwrap();
            assert_eq!(scalar(&url, "SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'fts_rows_unnumbered'").await, 1);
            assert_eq!(scalar(&url, "SELECT rowid FROM fts_notes WHERE path = 'A.md'").await, 1);
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM fts_notes WHERE path = 'A.md'").await, 1);
            // Its row is one no file names yet: readers do not show it until the next start numbers it.
            assert_eq!(rows_named_by_their_file(&url).await, 1);
            // v0.8.7's parse-error path: a REPLACE of the files row raises the flag as well.
            run_batch(&url, &[stmt("DELETE FROM meta WHERE key = 'fts_rows_unnumbered'", vec![])]).await.unwrap();
            run_batch(
                &url,
                &[stmt(
                    "INSERT OR REPLACE INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'obsidian', ?)",
                    vec![json!("older:B.md"), json!("B.md"), json!("t"), json!("h"), json!(1), json!(1), json!(1), json!("synced")],
                )],
            )
            .await
            .unwrap();
            assert_eq!(scalar(&url, "SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'fts_rows_unnumbered'").await, 1);
        });
    }

    #[test]
    fn a_files_rows_deletion_leaves_another_notes_text_on_the_bundled_sqlite() {
        block(async {
            let (_d, url) = tmp_url();
            setup_index(&url).await;
            // An attachment is files row 1 (its number -1 has no row), then a note.
            run_batch(
                &url,
                &[stmt(
                    "INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state, fts_rowid) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0)",
                    vec![json!("id:a.png"), json!("a.png"), json!("a"), json!("h"), json!(1), json!(1), json!(1), json!("attachment"), json!("synced")],
                )],
            )
            .await
            .unwrap();
            run_batch(&url, &save_this_build("B.md", "this build")).await.unwrap();
            // The sentinel gone (an older build's rebuild), the older build writes P's text at -1: the attachment's number.
            run_batch(&url, &[stmt("DELETE FROM fts_notes WHERE path NOT IN (SELECT path FROM files)", vec![])]).await.unwrap();
            run_batch(&url, &save_older_build("P.md", "older zeppelin")).await.unwrap();
            run_batch(&url, &save_this_build("B.md", "this build again")).await.unwrap();
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM fts_notes WHERE rowid = -1 AND path = 'P.md'").await, 1);
            // The attachment goes: the trigger finds a row at its number, but under another note's path, and leaves it.
            run_batch(&url, &[stmt("DELETE FROM files WHERE id = ? OR path = ?", vec![json!("id:a.png"), json!("a.png")])]).await.unwrap();
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM fts_notes WHERE fts_notes MATCH 'zeppelin'").await, 1);
            // A row whose path lags its file (a queued rename) is still that file's and goes with it.
            run_batch(&url, &[stmt("UPDATE files SET path = 'B2.md' WHERE path = 'B.md'", vec![])]).await.unwrap();
            run_batch(&url, &[stmt("DELETE FROM files WHERE path = ?", vec![json!("B2.md")])]).await.unwrap();
            assert_eq!(scalar(&url, "SELECT COUNT(*) FROM fts_notes WHERE path = 'B.md'").await, 0);
        });
    }
}
