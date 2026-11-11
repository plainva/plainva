//! Real transactions for the index database on the desktop (stability plan R1).
//!
//! The SQL plugin sits on a connection pool: every call may get another
//! connection, so a `BEGIN` sent through it cannot hold across calls. The
//! desktop's `transaction()` used to be a turn instead of a transaction — each
//! statement committed as it ran, and a body that failed half-way left half of
//! what it meant to write. A kill between a note's `files` row and its
//! full-text row left the note unsearchable until it was edited.
//!
//! These commands hold ONE connection for the length of one transaction:
//! `db_tx_begin` opens a connection of its own to the database file and sends
//! `BEGIN IMMEDIATE` (the write lock is taken up front, so a body that reads
//! and then writes can never meet a snapshot another connection made stale),
//! every statement of the body goes to that connection by the transaction's
//! number, and `db_tx_commit` / `db_tx_rollback` end it and close the
//! connection. The JavaScript side (`TauriDatabaseAdapter`) lets one
//! transaction run at a time and makes a write sent to the adapter itself wait
//! for it, as the phone's adapter does.
//!
//! ONE connection per database is kept between transactions and used for the
//! next (`idle`): opening one costs milliseconds (a worker thread, the file,
//! the WAL index), three statements committed one by one well under one
//! (measured in `a_held_connection_costs_little_per_transaction`). A second
//! transaction while one is open (another adapter on the same file) opens a
//! connection of its own and waits for the write lock in its BEGIN. The kept
//! one is closed when the adapter closes the database (`db_tx_close`), when
//! its webview loads a page or its window goes (`release_owner`), and with
//! the process.
//!
//! What ends a transaction that nobody ends (the reviewer's question: the
//! Rust side must never hold the write lock for ever):
//!  - its webview loads a page — a reload, a crash and its restart, a
//!    navigation: the JavaScript that knew the transaction is gone
//!    (`release_owner`, wired to `on_page_load` in lib.rs);
//!  - its window is destroyed (`release_owner`, wired to `on_window_event`);
//!  - it sent nothing for `IDLE_LIMIT` (`reap`, run by a timer and before every
//!    begin): a body that waits that long between two statements holds every
//!    other writer of the database behind it. It is rolled back, and its next
//!    statement or its commit is told so — the body fails, nothing of it stays,
//!    the same answer as any failed transaction. A statement that is running
//!    is never cut off (`try_lock`);
//!  - the process ends: SQLite rolls back what was not committed.

use crate::db_batch::{bind_params, BatchStatement};
use serde::ser::{Serialize, SerializeMap, Serializer};
use serde_json::Value as JsonValue;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection, SqliteSynchronous, SqliteValueRef};
use sqlx::{Column, ConnectOptions, Connection, Row, TypeInfo, Value, ValueRef};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// A transaction that sent nothing for this long is taken for abandoned.
pub const IDLE_LIMIT: Duration = Duration::from_secs(120);
/// How often the timer looks for abandoned transactions.
pub const REAP_EVERY: Duration = Duration::from_secs(30);
/// How long `BEGIN IMMEDIATE` waits for a writer on another connection.
const BUSY_TIMEOUT: Duration = Duration::from_secs(10);
/// How many reasons for ended transactions are kept for the error a late statement gets.
const ENDED_KEPT: usize = 64;

struct Held {
    /// None once the transaction ended (committed, rolled back, reaped).
    conn: Option<SqliteConnection>,
    last: Instant,
    /// The database, for the connection to go back to `idle`.
    path: String,
}

struct Entry {
    owner: String,
    held: Arc<Mutex<Held>>,
}

/// The transactions that are open, by number.
#[derive(Default)]
pub struct DbTransactions {
    next: AtomicU64,
    open: StdMutex<HashMap<u64, Entry>>,
    /// Why a transaction that is gone ended, for the statement that comes too late.
    ended: StdMutex<Vec<(u64, &'static str)>>,
    /// The connection kept for the next transaction, by database: (owner, connection).
    idle: StdMutex<HashMap<String, (String, SqliteConnection)>>,
}

/// One row as the SQL plugin hands it to JavaScript: columns in their order.
pub struct OrderedRow(Vec<(String, JsonValue)>);

impl Serialize for OrderedRow {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            map.serialize_entry(k, v)?;
        }
        map.end()
    }
}

#[cfg(test)]
impl OrderedRow {
    pub fn get(&self, name: &str) -> Option<&JsonValue> {
        self.0.iter().find(|(k, _)| k == name).map(|(_, v)| v)
    }
}

/// A value as `tauri-plugin-sql` 2.5 decodes it (`decode/sqlite.rs`): the
/// value's storage class decides, a blob becomes an array of bytes.
fn to_json(v: SqliteValueRef) -> JsonValue {
    if v.is_null() {
        return JsonValue::Null;
    }
    let owned = v.to_owned();
    match v.type_info().name() {
        "TEXT" => owned.try_decode::<String>().map(JsonValue::String).unwrap_or(JsonValue::Null),
        "REAL" => owned.try_decode::<f64>().map(JsonValue::from).unwrap_or(JsonValue::Null),
        "INTEGER" | "NUMERIC" => owned.try_decode::<i64>().map(|n| JsonValue::Number(n.into())).unwrap_or(JsonValue::Null),
        "BOOLEAN" => owned.try_decode::<bool>().map(JsonValue::Bool).unwrap_or(JsonValue::Null),
        "BLOB" => owned
            .try_decode::<Vec<u8>>()
            .map(|b| JsonValue::Array(b.into_iter().map(|n| JsonValue::Number(n.into())).collect()))
            .unwrap_or(JsonValue::Null),
        _ => JsonValue::Null,
    }
}

impl DbTransactions {
    fn held(&self, id: u64) -> Result<Arc<Mutex<Held>>, String> {
        if let Some(entry) = self.open.lock().unwrap().get(&id) {
            return Ok(entry.held.clone());
        }
        Err(self.gone(id))
    }

    fn gone(&self, id: u64) -> String {
        let why = self
            .ended
            .lock()
            .unwrap()
            .iter()
            .rev()
            .find(|(n, _)| *n == id)
            .map(|(_, why)| *why)
            .unwrap_or("it is not open");
        format!("This transaction is over ({why}); nothing of it was kept")
    }

    fn note_ended(&self, id: u64, why: &'static str) {
        let mut ended = self.ended.lock().unwrap();
        ended.push((id, why));
        let len = ended.len();
        if len > ENDED_KEPT {
            ended.drain(0..len - ENDED_KEPT);
        }
    }

    /// Opens a connection to `db_path` (the plugin's `sqlite:` URL) and begins.
    pub async fn begin(&self, db_path: &str, owner: &str) -> Result<u64, String> {
        self.reap(Instant::now()).await;
        let kept = self.idle.lock().unwrap().remove(db_path).map(|(_, conn)| conn);
        let mut conn = match kept {
            Some(conn) => conn,
            None => SqliteConnectOptions::from_str(db_path)
                .map_err(|e| e.to_string())?
                .create_if_missing(false)
                .foreign_keys(true)
                // As the adapter sets it on the plugin's pool: in WAL mode a commit
                // survives the app ending; only a power loss may take back the last ones.
                .synchronous(SqliteSynchronous::Normal)
                .busy_timeout(BUSY_TIMEOUT)
                .connect()
                .await
                .map_err(|e| e.to_string())?,
        };
        if let Err(e) = sqlx::query("BEGIN IMMEDIATE").execute(&mut conn).await {
            // A connection whose BEGIN failed is not trusted with the next one.
            let _ = conn.close().await;
            return Err(e.to_string());
        }
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        self.open.lock().unwrap().insert(
            id,
            Entry {
                owner: owner.to_string(),
                held: Arc::new(Mutex::new(Held { conn: Some(conn), last: Instant::now(), path: db_path.to_string() })),
            },
        );
        Ok(id)
    }

    async fn on_conn<T, F>(&self, id: u64, work: F) -> Result<T, String>
    where
        F: for<'c> FnOnce(&'c mut SqliteConnection) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<T, sqlx::Error>> + Send + 'c>>,
    {
        let held = self.held(id)?;
        let mut held = held.lock().await;
        held.last = Instant::now();
        let Some(conn) = held.conn.as_mut() else { return Err(self.gone(id)) };
        let out = work(conn).await.map_err(|e| e.to_string());
        held.last = Instant::now();
        out
    }

    /// Runs one write in the transaction; the number of rows it changed.
    pub async fn execute(&self, id: u64, sql: String, params: Vec<JsonValue>) -> Result<u64, String> {
        self.on_conn(id, move |conn| {
            Box::pin(async move { Ok(bind_params(sqlx::query(&sql), &params).execute(&mut *conn).await?.rows_affected()) })
        })
        .await
    }

    /// Runs one read in the transaction: it sees what the transaction wrote so far.
    pub async fn select(&self, id: u64, sql: String, params: Vec<JsonValue>) -> Result<Vec<OrderedRow>, String> {
        self.on_conn(id, move |conn| {
            Box::pin(async move {
                let rows = bind_params(sqlx::query(&sql), &params).fetch_all(&mut *conn).await?;
                let mut out = Vec::with_capacity(rows.len());
                for row in rows {
                    let mut cols = Vec::with_capacity(row.columns().len());
                    for (i, column) in row.columns().iter().enumerate() {
                        cols.push((column.name().to_string(), to_json(row.try_get_raw(i)?)));
                    }
                    out.push(OrderedRow(cols));
                }
                Ok(out)
            })
        })
        .await
    }

    /// Runs an ordered list of writes in the transaction, in one call.
    pub async fn batch(&self, id: u64, statements: Vec<BatchStatement>) -> Result<u64, String> {
        self.on_conn(id, move |conn| {
            Box::pin(async move {
                let mut affected = 0;
                for stmt in &statements {
                    affected += bind_params(sqlx::query(&stmt.sql), &stmt.params).execute(&mut *conn).await?.rows_affected();
                }
                Ok(affected)
            })
        })
        .await
    }

    fn take(&self, id: u64) -> Option<(String, Arc<Mutex<Held>>)> {
        self.open.lock().unwrap().remove(&id).map(|entry| (entry.owner, entry.held))
    }

    /// Keeps a connection whose transaction ended cleanly for the next one;
    /// one is kept per database, another is closed.
    async fn keep(&self, path: String, owner: String, conn: SqliteConnection) {
        let spare = match self.idle.lock().unwrap().entry(path) {
            std::collections::hash_map::Entry::Occupied(_) => Some(conn),
            std::collections::hash_map::Entry::Vacant(slot) => {
                slot.insert((owner, conn));
                None
            }
        };
        if let Some(conn) = spare {
            let _ = conn.close().await;
        }
    }

    /// Closes the connection kept for `db_path` (the adapter closed the database).
    pub async fn close_idle(&self, db_path: &str) {
        let kept = self.idle.lock().unwrap().remove(db_path);
        if let Some((_, conn)) = kept {
            let _ = conn.close().await;
        }
    }

    /// Commits and closes. A COMMIT that fails is rolled back: nothing of the
    /// transaction stays, and nothing of it rides into another one.
    pub async fn commit(&self, id: u64) -> Result<(), String> {
        let Some((owner, held)) = self.take(id) else { return Err(self.gone(id)) };
        let mut held = held.lock().await;
        let Some(mut conn) = held.conn.take() else { return Err(self.gone(id)) };
        let result = sqlx::query("COMMIT").execute(&mut conn).await.map(|_| ()).map_err(|e| e.to_string());
        if result.is_ok() {
            self.keep(held.path.clone(), owner, conn).await;
        } else {
            let _ = sqlx::query("ROLLBACK").execute(&mut conn).await;
            let _ = conn.close().await;
        }
        self.note_ended(id, if result.is_ok() { "it was committed" } else { "its commit failed" });
        result
    }

    /// Rolls back. A transaction that is gone already is fine.
    pub async fn rollback(&self, id: u64) -> Result<(), String> {
        self.end(id, "it was rolled back", true).await;
        Ok(())
    }

    /// Rolls back; the connection is kept for the next transaction when
    /// `keep` says so and its ROLLBACK went through, and closed otherwise.
    async fn end(&self, id: u64, why: &'static str, keep: bool) {
        let Some((owner, held)) = self.take(id) else { return };
        let mut held = held.lock().await;
        if let Some(mut conn) = held.conn.take() {
            let rolled_back = sqlx::query("ROLLBACK").execute(&mut conn).await.is_ok();
            if keep && rolled_back {
                self.keep(held.path.clone(), owner, conn).await;
            } else {
                let _ = conn.close().await;
            }
        }
        self.note_ended(id, why);
    }

    /// Rolls back every transaction a webview opened and closes the
    /// connections it kept: its page is gone.
    pub async fn release_owner(&self, owner: &str, why: &'static str) -> usize {
        let ids: Vec<u64> = self.open.lock().unwrap().iter().filter(|(_, e)| e.owner == owner).map(|(id, _)| *id).collect();
        for id in &ids {
            self.end(*id, why, false).await;
        }
        let kept: Vec<SqliteConnection> = {
            let mut idle = self.idle.lock().unwrap();
            let paths: Vec<String> = idle.iter().filter(|(_, (o, _))| o == owner).map(|(p, _)| p.clone()).collect();
            paths.into_iter().filter_map(|p| idle.remove(&p).map(|(_, conn)| conn)).collect()
        };
        for conn in kept {
            let _ = conn.close().await;
        }
        ids.len()
    }

    /// Rolls back every transaction that sent nothing for `IDLE_LIMIT`; one
    /// whose statement is running is left alone.
    pub async fn reap(&self, now: Instant) -> usize {
        let candidates: Vec<(u64, Arc<Mutex<Held>>)> =
            self.open.lock().unwrap().iter().map(|(id, e)| (*id, e.held.clone())).collect();
        let mut stale = Vec::new();
        for (id, held) in candidates {
            if let Ok(h) = held.try_lock() {
                if now.saturating_duration_since(h.last) >= IDLE_LIMIT {
                    stale.push(id);
                }
            }
        }
        for id in &stale {
            self.end(*id, "it sent nothing for two minutes and was rolled back", false).await;
        }
        stale.len()
    }

    #[cfg(test)]
    pub fn open_count(&self) -> usize {
        self.open.lock().unwrap().len()
    }

    #[cfg(test)]
    pub fn idle_count(&self) -> usize {
        self.idle.lock().unwrap().len()
    }

    #[cfg(test)]
    pub async fn age(&self, id: u64, by: Duration) {
        if let Ok(held) = self.held(id) {
            let mut h = held.lock().await;
            h.last = h.last.checked_sub(by).unwrap_or(h.last);
        }
    }
}

#[tauri::command]
pub async fn db_tx_begin(state: tauri::State<'_, DbTransactions>, webview: tauri::Webview, db_path: String) -> Result<u64, String> {
    state.begin(&db_path, webview.label()).await
}

#[tauri::command]
pub async fn db_tx_execute(state: tauri::State<'_, DbTransactions>, id: u64, sql: String, params: Vec<JsonValue>) -> Result<u64, String> {
    state.execute(id, sql, params).await
}

#[tauri::command]
pub async fn db_tx_select(state: tauri::State<'_, DbTransactions>, id: u64, sql: String, params: Vec<JsonValue>) -> Result<Vec<OrderedRow>, String> {
    state.select(id, sql, params).await
}

#[tauri::command]
pub async fn db_tx_batch(state: tauri::State<'_, DbTransactions>, id: u64, statements: Vec<BatchStatement>) -> Result<u64, String> {
    state.batch(id, statements).await
}

#[tauri::command]
pub async fn db_tx_commit(state: tauri::State<'_, DbTransactions>, id: u64) -> Result<(), String> {
    state.commit(id).await
}

#[tauri::command]
pub async fn db_tx_rollback(state: tauri::State<'_, DbTransactions>, id: u64) -> Result<(), String> {
    state.rollback(id).await
}

#[tauri::command]
pub async fn db_tx_close(state: tauri::State<'_, DbTransactions>, db_path: String) -> Result<(), String> {
    state.close_idle(&db_path).await;
    Ok(())
}

/// What lib.rs runs when a webview loads a page or its window goes.
pub fn release_owner_later<R: tauri::Runtime>(app: &tauri::AppHandle<R>, owner: String, why: &'static str) {
    use tauri::Manager;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<DbTransactions>();
        let n = state.release_owner(&owner, why).await;
        if n > 0 {
            eprintln!("[db_tx] rolled back {n} transaction(s) of {owner}: {why}");
        }
    });
}

/// The timer behind `IDLE_LIMIT`, started once in lib.rs's setup.
pub fn start_reaper<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(REAP_EVERY).await;
            let n = app.state::<DbTransactions>().reap(Instant::now()).await;
            if n > 0 {
                eprintln!("[db_tx] rolled back {n} transaction(s) that sent nothing for {} s", IDLE_LIMIT.as_secs());
            }
        }
    });
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
        let mut c = SqliteConnectOptions::from_str(url).unwrap().create_if_missing(true).connect().await.unwrap();
        for sql in [
            "PRAGMA journal_mode = WAL",
            "CREATE TABLE files (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, n INTEGER, f REAL, b BLOB)",
            "CREATE TABLE tags (file_id TEXT REFERENCES files(id) ON DELETE CASCADE, tag TEXT)",
        ] {
            sqlx::query(sql).execute(&mut c).await.unwrap();
        }
        c.close().await.unwrap();
    }

    /// What another connection sees: the plugin's pool, or the next start.
    async fn count(url: &str, sql: &str) -> i64 {
        let mut c = SqliteConnectOptions::from_str(url).unwrap().connect().await.unwrap();
        let row: (i64,) = sqlx::query_as(sql).fetch_one(&mut c).await.unwrap();
        c.close().await.unwrap();
        row.0
    }

    fn block<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    fn put(path: &str) -> (String, Vec<JsonValue>) {
        ("INSERT INTO files (id, path) VALUES (?, ?)".into(), vec![json!(format!("id:{path}")), json!(path)])
    }

    #[test]
    fn what_a_transaction_wrote_is_seen_by_others_only_once_it_is_committed() {
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            let txs = DbTransactions::default();
            let id = txs.begin(&url, "main").await.unwrap();
            let (sql, params) = put("a.md");
            assert_eq!(txs.execute(id, sql, params).await.unwrap(), 1);
            // Its own reads see it; another connection does not, yet.
            let rows = txs.select(id, "SELECT path FROM files".into(), vec![]).await.unwrap();
            assert_eq!(rows[0].get("path"), Some(&json!("a.md")));
            assert_eq!(count(&url, "SELECT COUNT(*) FROM files").await, 0);
            txs.commit(id).await.unwrap();
            assert_eq!(count(&url, "SELECT COUNT(*) FROM files").await, 1);
            assert_eq!(txs.open_count(), 0);
            // The connection is kept for the next transaction, and goes with the database.
            assert_eq!(txs.idle_count(), 1);
            let next = txs.begin(&url, "main").await.unwrap();
            assert_eq!(txs.idle_count(), 0);
            txs.rollback(next).await.unwrap();
            assert_eq!(txs.idle_count(), 1);
            txs.close_idle(&url).await;
            assert_eq!(txs.idle_count(), 0);
        });
    }

    #[test]
    fn a_rollback_takes_back_statements_and_batches() {
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            let txs = DbTransactions::default();
            let id = txs.begin(&url, "main").await.unwrap();
            let (sql, params) = put("a.md");
            txs.execute(id, sql, params).await.unwrap();
            txs.batch(id, vec![BatchStatement { sql: "INSERT INTO tags (file_id, tag) VALUES (?, ?)".into(), params: vec![json!("id:a.md"), json!("x")] }])
                .await
                .unwrap();
            txs.rollback(id).await.unwrap();
            assert_eq!(count(&url, "SELECT COUNT(*) FROM files").await, 0);
            assert_eq!(count(&url, "SELECT COUNT(*) FROM tags").await, 0);
            // A statement after the end is told, and runs nowhere.
            let (sql, params) = put("late.md");
            let late = txs.execute(id, sql, params).await.unwrap_err();
            assert!(late.contains("This transaction is over (it was rolled back)"), "{late}");
            assert_eq!(count(&url, "SELECT COUNT(*) FROM files").await, 0);
            // Rolling back twice is fine.
            txs.rollback(id).await.unwrap();
        });
    }

    #[test]
    fn a_kill_between_two_statements_leaves_neither() {
        // The process ends with the transaction open: its connection goes
        // without a COMMIT, and the next start finds neither row.
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            let txs = DbTransactions::default();
            let id = txs.begin(&url, "main").await.unwrap();
            let (sql, params) = put("a.md");
            txs.execute(id, sql, params).await.unwrap();
            drop(txs);
            assert_eq!(count(&url, "SELECT COUNT(*) FROM files").await, 0);
        });
    }

    #[test]
    fn a_failed_statement_leaves_the_transaction_to_its_body() {
        // The body decides: it catches the error and goes on, or it fails and
        // the adapter rolls back. The statement itself takes nothing back.
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            let txs = DbTransactions::default();
            let id = txs.begin(&url, "main").await.unwrap();
            let (sql, params) = put("a.md");
            txs.execute(id, sql.clone(), params.clone()).await.unwrap();
            assert!(txs.execute(id, sql, params).await.unwrap_err().contains("UNIQUE"));
            txs.commit(id).await.unwrap();
            assert_eq!(count(&url, "SELECT COUNT(*) FROM files").await, 1);
        });
    }

    #[test]
    fn a_second_writer_waits_for_the_first_and_a_reader_does_not() {
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            let txs = Arc::new(DbTransactions::default());
            let first = txs.begin(&url, "main").await.unwrap();
            let (sql, params) = put("a.md");
            txs.execute(first, sql, params).await.unwrap();
            // A reader on another connection is answered at once (WAL).
            assert_eq!(count(&url, "SELECT COUNT(*) FROM files").await, 0);
            // A second transaction (another adapter on the same file: a vault
            // being reopened) waits in its BEGIN until the first commits.
            let (t2, u2) = (txs.clone(), url.clone());
            let second = tauri::async_runtime::spawn(async move { t2.begin(&u2, "main").await });
            tokio::time::sleep(Duration::from_millis(200)).await;
            assert!(!second.inner().is_finished());
            txs.commit(first).await.unwrap();
            let second = second.await.unwrap().unwrap();
            let (sql, params) = put("b.md");
            txs.execute(second, sql, params).await.unwrap();
            txs.commit(second).await.unwrap();
            assert_eq!(count(&url, "SELECT COUNT(*) FROM files").await, 2);
        });
    }

    #[test]
    fn a_page_load_rolls_back_what_its_webview_had_open_and_nothing_else() {
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            let txs = DbTransactions::default();
            let mine = txs.begin(&url, "main").await.unwrap();
            let (sql, params) = put("a.md");
            txs.execute(mine, sql, params).await.unwrap();
            // The webview reloads: what it had open goes back, the write lock with it.
            assert_eq!(txs.release_owner("aux-1", "its page loaded").await, 0);
            assert_eq!(txs.release_owner("main", "its page loaded").await, 1);
            assert_eq!(txs.idle_count(), 0, "a reloaded page keeps no connection either");
            let after = txs.begin(&url, "main").await.unwrap();
            let (sql, params) = put("b.md");
            txs.execute(after, sql, params).await.unwrap();
            txs.commit(after).await.unwrap();
            assert_eq!(count(&url, "SELECT COUNT(*) FROM files").await, 1);
            let late = txs.commit(mine).await.unwrap_err();
            assert!(late.contains("its page loaded"), "{late}");
        });
    }

    #[test]
    fn an_idle_transaction_is_rolled_back_and_its_body_is_told_but_a_busy_one_is_left() {
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            let txs = DbTransactions::default();
            let idle = txs.begin(&url, "main").await.unwrap();
            let (sql, params) = put("a.md");
            txs.execute(idle, sql, params).await.unwrap();
            assert_eq!(txs.reap(Instant::now()).await, 0);
            // A statement that is running is never cut off.
            {
                let held = txs.held(idle).unwrap();
                let _running = held.lock().await;
                assert_eq!(txs.reap(Instant::now() + IDLE_LIMIT * 2).await, 0);
            }
            txs.age(idle, IDLE_LIMIT).await;
            assert_eq!(txs.reap(Instant::now()).await, 1);
            let late = txs.commit(idle).await.unwrap_err();
            assert!(late.contains("sent nothing for two minutes"), "{late}");
            assert_eq!(count(&url, "SELECT COUNT(*) FROM files").await, 0);
        });
    }

    #[test]
    fn values_come_back_as_the_sql_plugin_hands_them() {
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            let txs = DbTransactions::default();
            let id = txs.begin(&url, "main").await.unwrap();
            txs.execute(
                id,
                "INSERT INTO files (id, path, n, f, b) VALUES (?, ?, ?, ?, X'0102')".into(),
                vec![json!("1"), json!("a.md"), json!(1_700_000_000_123i64), json!(1.5)],
            )
            .await
            .unwrap();
            let rows = txs.select(id, "SELECT path, n, f, b, NULL AS empty, id FROM files".into(), vec![]).await.unwrap();
            let text = serde_json::to_string(&rows[0]).unwrap();
            // Columns in their order, integers exact, blobs as bytes.
            assert_eq!(text, r#"{"path":"a.md","n":1700000000123,"f":1.5,"b":[1,2],"empty":null,"id":"1"}"#);
            txs.rollback(id).await.unwrap();
        });
    }

    #[test]
    fn a_held_connection_costs_little_per_transaction() {
        // A save's queue entry is three statements. Before R1 they committed
        // one by one on the plugin's pool; now they are one transaction on a
        // connection of its own. 200 of each, printed and not asserted (a
        // loaded runner would make a bound flaky); the IPC hops are not in
        // here — the transaction adds two (begin, commit) to the statements'.
        block(async {
            let (_d, url) = tmp_url();
            setup(&url).await;
            let txs = DbTransactions::default();
            let began = Instant::now();
            for i in 0..200 {
                let id = txs.begin(&url, "main").await.unwrap();
                for k in 0..3 {
                    let (sql, params) = put(&format!("tx{i}-{k}.md"));
                    txs.execute(id, sql, params).await.unwrap();
                }
                txs.commit(id).await.unwrap();
            }
            let per_tx = began.elapsed() / 200;
            let mut pool = SqliteConnectOptions::from_str(&url).unwrap().synchronous(SqliteSynchronous::Normal).connect().await.unwrap();
            let began = Instant::now();
            for i in 0..200 {
                for k in 0..3 {
                    let (sql, params) = put(&format!("auto{i}-{k}.md"));
                    bind_params(sqlx::query(&sql), &params).execute(&mut pool).await.unwrap();
                }
            }
            let per_turn = began.elapsed() / 200;
            pool.close().await.unwrap();
            eprintln!("[db_tx] three statements: {per_tx:?} as one transaction on the kept connection; {per_turn:?} committed one by one on a held connection (before R1)");
            assert_eq!(count(&url, "SELECT COUNT(*) FROM files").await, 1200);
        });
    }
}
