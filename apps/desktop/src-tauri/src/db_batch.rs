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
}
