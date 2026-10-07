//! The vault walk as ONE command (issue #122).
//!
//! A full reconcile of the index needs the whole listing of the vault: every
//! file with its size and times, every folder. The frontend used to gather it
//! folder by folder — two IPC round-trips per folder (a `stat` for the folder's
//! identity, a `checked_read_dir` for its entries), each resolved on the UI
//! thread, and the results stitched together there. On a vault with thousands
//! of folders that is thousands of promise callbacks competing with the
//! keystrokes of whoever is typing.
//!
//! Here the walk runs on blocking worker threads and returns once, as one
//! compact payload. It follows the rules of the frontend walker
//! (`TauriVaultAdapter._listDirInternal`) exactly, because the two are
//! interchangeable — a host without this command (the browser fixtures) still
//! uses the frontend walker, and the index must not care which one ran:
//!
//!  - Links and junctions ARE followed (a cloud folder mounted into the vault).
//!    A loop is cut by directory identity (dev+ino) where the platform has
//!    one, and by the depth cap everywhere; the cut-off point is reported as a
//!    `cycle`, never silently dropped.
//!  - A folder that cannot be listed, and a single entry that cannot be
//!    inspected, are reported as `unreadable`. The index protects everything
//!    under a reported path from being treated as deleted, so "could not
//!    look" must never be confused with "is empty".
//!  - Internal folders (`.git`, `node_modules`, `.plainva`, …) are not
//!    descended into. WHICH names are internal is not decided here: the rules
//!    arrive with the call, as data, from the one list the frontend keeps
//!    (`packages/core/src/vault/internalPath.ts`). A second list in Rust could
//!    drift, and a folder skipped here but not there would look like a mass
//!    deletion to the index and to sync.
//!  - The start folder is resolved like every other checked read: an opaque
//!    root id plus a relative path that cannot spell `..` or an absolute path.
//!  - No file is ever opened or read. Sizes and times come from the directory
//!    listing itself (on Windows the find data, without touching the file);
//!    only a link, which the listing does not resolve, costs a `stat`. In a
//!    cloud-files folder (OneDrive, iCloud Drive) reading a placeholder's
//!    content would download it — a walk must never do that.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::atomic_write::WriteRoots;
use crate::checked_fs::registered_path;

/// Same cap as the frontend walker (`MAX_WALK_DEPTH`).
const MAX_WALK_DEPTH: u32 = 32;
/// Directory reads in flight at once. The frontend walker ran eight filesystem
/// calls in parallel for the sake of network shares, where each folder costs a
/// round-trip; a local disk does not need them and does not mind.
const WALK_THREADS: usize = 8;

/// The internal-path rules, as the frontend sends them (`INTERNAL_PATH_RULES`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkRules {
    /// Segment equals one of these, case-sensitively.
    #[serde(default)]
    pub exact: Vec<String>,
    /// Segment, lower-cased, equals one of these.
    #[serde(default)]
    pub exact_ignore_case: Vec<String>,
    /// Segment starts with one of these.
    #[serde(default)]
    pub prefix: Vec<String>,
    /// Segment starts with a dot, is longer than one character and ends with one of these.
    #[serde(default)]
    pub dot_suffix: Vec<String>,
}

impl WalkRules {
    pub fn is_internal(&self, name: &str) -> bool {
        if self.exact.iter().any(|n| n == name) {
            return true;
        }
        let lower = name.to_lowercase();
        if self.exact_ignore_case.contains(&lower) {
            return true;
        }
        if self.prefix.iter().any(|p| name.starts_with(p.as_str())) {
            return true;
        }
        name.chars().count() > 1 && name.starts_with('.') && self.dot_suffix.iter().any(|s| name.ends_with(s.as_str()))
    }
}

/// One entry, as a tuple to keep the payload small: a vault with 20 000 files
/// crosses the bridge as one JSON document, parsed on the UI thread.
/// `(path, is_directory, mtime_ms, ctime_ms, size)` — the path is relative to
/// the vault root with `/` separators, in the spelling the disk stores.
/// A directory carries zeros; the frontend never reads its times.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WalkEntry(pub String, pub bool, pub u64, pub Option<u64>, pub u64);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WalkSkip {
    pub path: String,
    /// `cycle` or `unreadable` — the two reasons the frontend walker knows.
    pub reason: &'static str,
}

#[derive(Debug, Default, Serialize)]
pub struct WalkResult {
    pub entries: Vec<WalkEntry>,
    pub skipped: Vec<WalkSkip>,
}

struct Job {
    rel: String,
    abs: PathBuf,
    depth: u32,
}

#[derive(Default)]
struct Shared {
    queue: Vec<Job>,
    /// Jobs taken from the queue and not finished yet.
    active: usize,
    visited_paths: HashSet<PathBuf>,
    visited_ids: HashSet<(u64, u64)>,
    result: WalkResult,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn time_ms(value: std::io::Result<SystemTime>) -> Option<u64> {
    value.ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis().try_into().ok()
}

/// The folder's identity, where the platform has one. `Err` when the folder
/// cannot be inspected at all.
#[cfg(unix)]
fn directory_identity(path: &Path) -> std::io::Result<Option<(u64, u64)>> {
    use std::os::unix::fs::MetadataExt;
    let metadata = fs::metadata(path)?;
    Ok(Some((metadata.dev(), metadata.ino())))
}

/// Windows reports no stable identity through `std`; the depth cap is the
/// guard there, exactly as in the frontend walker (its `dev`/`ino` are null).
/// So the folder is not opened for one either: listing it is the only call
/// made per folder, which matters in a cloud-files folder (OneDrive), where
/// every call may be answered by the sync client.
#[cfg(not(unix))]
fn directory_identity(_path: &Path) -> std::io::Result<Option<(u64, u64)>> {
    Ok(None)
}

fn child_rel(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

/// What one folder contributed; merged into the shared result in one step.
#[derive(Default)]
struct FolderOutcome {
    entries: Vec<WalkEntry>,
    skipped: Vec<WalkSkip>,
    children: Vec<Job>,
}

impl FolderOutcome {
    fn skip(rel: &str, reason: &'static str) -> Self {
        FolderOutcome { skipped: vec![WalkSkip { path: rel.to_string(), reason }], ..Default::default() }
    }
}

/// A file reached through a link, or one whose listing carried no usable
/// time: resolved with a following `stat`, like the frontend's fallback.
/// A missing or zero modification time reads as "now" there, so it does here.
fn resolved_entry(rel: String, abs: &Path) -> Result<(WalkEntry, bool), ()> {
    let metadata = fs::metadata(abs).map_err(|_| ())?;
    if metadata.is_dir() {
        return Ok((WalkEntry(rel, true, 0, None, 0), true));
    }
    let mtime = time_ms(metadata.modified()).filter(|ms| *ms != 0).unwrap_or_else(now_ms);
    let ctime = time_ms(metadata.created()).filter(|ms| *ms != 0);
    Ok((WalkEntry(rel, false, mtime, ctime, metadata.len()), false))
}

fn walk_folder(job: &Job, recursive: bool, inside_internal: bool, rules: &WalkRules, shared: &Mutex<Shared>) -> FolderOutcome {
    {
        let mut state = shared.lock().unwrap_or_else(|e| e.into_inner());
        if !state.visited_paths.insert(job.abs.clone()) {
            return FolderOutcome::skip(&job.rel, "cycle");
        }
    }
    if job.depth > MAX_WALK_DEPTH {
        return FolderOutcome::skip(&job.rel, "cycle");
    }
    match directory_identity(&job.abs) {
        Err(_) => return FolderOutcome::skip(&job.rel, "unreadable"),
        Ok(Some(identity)) => {
            let mut state = shared.lock().unwrap_or_else(|e| e.into_inner());
            if !state.visited_ids.insert(identity) {
                return FolderOutcome::skip(&job.rel, "cycle");
            }
        }
        Ok(None) => {}
    }
    // A missing folder is unreadable too: the caller asked for it by name, and
    // "not there" is for the index to establish (`exists`), not for a walk to assume.
    let reader = match fs::read_dir(&job.abs) {
        Ok(reader) => reader,
        Err(_) => return FolderOutcome::skip(&job.rel, "unreadable"),
    };

    let mut out = FolderOutcome::default();
    for entry in reader {
        // An iterator error carries no name, so nothing narrower than the
        // whole folder can be protected (checked_fs::collect_entries).
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => return FolderOutcome::skip(&job.rel, "unreadable"),
        };
        let (name, valid_name) = match entry.file_name().into_string() {
            Ok(name) => (name, true),
            Err(raw) => (raw.to_string_lossy().into_owned(), false),
        };
        if name.is_empty() {
            continue;
        }
        if !inside_internal && rules.is_internal(&name) {
            continue;
        }
        let rel = child_rel(&job.rel, &name);
        // A backslash is a legal character in a name on macOS and Linux, and
        // the vault's path scheme cannot address it.
        if !valid_name || name.contains('\\') {
            out.skipped.push(WalkSkip { path: rel, reason: "unreadable" });
            continue;
        }
        let kind = match entry.file_type() {
            Ok(kind) => kind,
            Err(_) => {
                out.skipped.push(WalkSkip { path: rel, reason: "unreadable" });
                continue;
            }
        };
        let abs = job.abs.join(&name);
        if kind.is_dir() {
            out.entries.push(WalkEntry(rel.clone(), true, 0, None, 0));
            if recursive {
                out.children.push(Job { rel, abs, depth: job.depth + 1 });
            }
            continue;
        }
        if kind.is_file() {
            match entry.metadata() {
                Ok(metadata) => match time_ms(metadata.modified()) {
                    Some(mtime) => out.entries.push(WalkEntry(rel, false, mtime, time_ms(metadata.created()), metadata.len())),
                    None => match resolved_entry(rel.clone(), &abs) {
                        Ok((entry, _)) => out.entries.push(entry),
                        Err(()) => out.skipped.push(WalkSkip { path: rel, reason: "unreadable" }),
                    },
                },
                Err(_) => out.skipped.push(WalkSkip { path: rel, reason: "unreadable" }),
            }
            continue;
        }
        if kind.is_symlink() {
            // The listing does not follow links; the resolved kind must win,
            // or a linked folder would be read as a file.
            match resolved_entry(rel.clone(), &abs) {
                Ok((entry, is_directory)) => {
                    out.entries.push(entry);
                    if is_directory && recursive {
                        out.children.push(Job { rel, abs, depth: job.depth + 1 });
                    }
                }
                Err(()) => out.skipped.push(WalkSkip { path: rel, reason: "unreadable" }),
            }
            continue;
        }
        // Neither file, folder nor link (a socket, a FIFO).
        out.skipped.push(WalkSkip { path: rel, reason: "unreadable" });
    }
    out
}

/// Walks `start` (already resolved inside its root). `rel` is the start
/// folder's vault-relative path and prefixes every reported path. `Err` only
/// when cancelled.
pub fn walk(
    start: &Path,
    rel: &str,
    recursive: bool,
    inside_internal: bool,
    rules: &WalkRules,
    cancel: &AtomicBool,
) -> Result<WalkResult, String> {
    let shared = Mutex::new(Shared {
        queue: vec![Job { rel: rel.to_string(), abs: start.to_path_buf(), depth: 0 }],
        ..Default::default()
    });
    let wake = Condvar::new();
    let worker = || loop {
        let job = {
            let mut state = shared.lock().unwrap_or_else(|e| e.into_inner());
            loop {
                if cancel.load(Ordering::Relaxed) {
                    state.queue.clear();
                }
                if let Some(job) = state.queue.pop() {
                    state.active += 1;
                    break Some(job);
                }
                if state.active == 0 {
                    break None;
                }
                state = wake.wait(state).unwrap_or_else(|e| e.into_inner());
            }
        };
        let Some(job) = job else {
            wake.notify_all();
            return;
        };
        let outcome = walk_folder(&job, recursive, inside_internal, rules, &shared);
        let mut state = shared.lock().unwrap_or_else(|e| e.into_inner());
        state.result.entries.extend(outcome.entries);
        state.result.skipped.extend(outcome.skipped);
        state.queue.extend(outcome.children);
        state.active -= 1;
        drop(state);
        wake.notify_all();
    };
    let threads = if recursive { WALK_THREADS } else { 1 };
    std::thread::scope(|scope| {
        for _ in 1..threads {
            scope.spawn(worker);
        }
        worker();
    });
    if cancel.load(Ordering::Relaxed) {
        return Err("walk cancelled".into());
    }
    let mut result = shared.into_inner().unwrap_or_else(|e| e.into_inner()).result;
    // Worker order is not deterministic; the listing is.
    result.entries.sort_by(|a, b| a.0.cmp(&b.0));
    result.skipped.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

/// Walks under way, so one can be cancelled when its vault closes: a walk on
/// a network share that stopped answering would otherwise hold the teardown.
#[derive(Default)]
pub struct VaultWalks(Mutex<HashMap<u32, Arc<AtomicBool>>>);

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn vault_walk(
    root_id: String,
    rel_path: String,
    recursive: bool,
    inside_internal: bool,
    rules: WalkRules,
    walk_id: Option<u32>,
    roots: tauri::State<'_, WriteRoots>,
    walks: tauri::State<'_, VaultWalks>,
) -> Result<WalkResult, String> {
    let start = registered_path(&roots, &root_id, &rel_path)?;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(id) = walk_id {
        walks.0.lock().map_err(|_| "walk registry unavailable".to_string())?.insert(id, Arc::clone(&cancel));
    }
    let flag = Arc::clone(&cancel);
    let outcome = tauri::async_runtime::spawn_blocking(move || walk(&start, &rel_path, recursive, inside_internal, &rules, &flag))
        .await
        .map_err(|error| format!("vault walk failed: {error}"));
    if let Some(id) = walk_id {
        if let Ok(mut active) = walks.0.lock() {
            active.remove(&id);
        }
    }
    outcome?
}

#[tauri::command]
pub fn vault_walk_cancel(walk_id: u32, walks: tauri::State<'_, VaultWalks>) -> Result<(), String> {
    if let Some(flag) = walks.0.lock().map_err(|_| "walk registry unavailable".to_string())?.get(&walk_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Fixture {
        rules: WalkRules,
        internal: Vec<String>,
        user: Vec<String>,
    }

    /// The very file the frontend's unit test reads: the rules as the frontend
    /// exports them, and verdicts both sides must reach.
    fn fixture() -> Fixture {
        serde_json::from_str(include_str!("../../../../packages/core/src/vault/internalPathRules.fixture.json")).unwrap()
    }

    fn rules() -> WalkRules {
        fixture().rules
    }

    fn run(root: &Path, rel: &str, recursive: bool, inside_internal: bool) -> WalkResult {
        let start = if rel.is_empty() { root.to_path_buf() } else { root.join(rel) };
        walk(&start, rel, recursive, inside_internal, &rules(), &AtomicBool::new(false)).unwrap()
    }

    fn paths(result: &WalkResult) -> Vec<&str> {
        result.entries.iter().map(|e| e.0.as_str()).collect()
    }

    #[test]
    fn the_rules_reach_the_verdicts_the_frontend_reaches() {
        let fixture = fixture();
        for name in &fixture.internal {
            assert!(fixture.rules.is_internal(name), "{name:?} must be internal");
        }
        for name in &fixture.user {
            assert!(!fixture.rules.is_internal(name), "{name:?} must stay the user's");
        }
    }

    #[test]
    fn lists_files_and_folders_with_their_metadata() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Projects/Sub")).unwrap();
        fs::write(dir.path().join("top.md"), "12345").unwrap();
        fs::write(dir.path().join("Projects/Sub/note.md"), "x").unwrap();
        let result = run(dir.path(), "", true, false);
        assert_eq!(paths(&result), vec!["Projects", "Projects/Sub", "Projects/Sub/note.md", "top.md"]);
        assert!(result.skipped.is_empty());
        let top = result.entries.iter().find(|e| e.0 == "top.md").unwrap();
        assert!(!top.1);
        assert_eq!(top.4, 5);
        assert_eq!(Some(top.2), time_ms(fs::metadata(dir.path().join("top.md")).unwrap().modified()));
        assert!(result.entries.iter().find(|e| e.0 == "Projects").unwrap().1);
        let json = serde_json::to_string(&top).unwrap();
        assert!(json.starts_with("[\"top.md\",false,"), "{json}");
    }

    #[test]
    fn a_flat_listing_stays_in_its_folder_and_keeps_the_prefix() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Projects/Sub")).unwrap();
        fs::write(dir.path().join("Projects/a.md"), "x").unwrap();
        fs::write(dir.path().join("Projects/Sub/deep.md"), "x").unwrap();
        let result = run(dir.path(), "Projects", false, false);
        assert_eq!(paths(&result), vec!["Projects/Sub", "Projects/a.md"]);
    }

    #[test]
    fn internal_folders_are_not_descended_into() {
        let dir = tempfile::tempdir().unwrap();
        for folder in [".git", "node_modules/pkg", ".plainva/backups", "Notes", ".mypy_cache"] {
            fs::create_dir_all(dir.path().join(folder)).unwrap();
        }
        fs::write(dir.path().join(".git/HEAD"), "x").unwrap();
        fs::write(dir.path().join("node_modules/pkg/README.md"), "x").unwrap();
        fs::write(dir.path().join(".plainva/backups/a.md"), "x").unwrap();
        fs::write(dir.path().join(".mypy_cache/x.json"), "x").unwrap();
        fs::write(dir.path().join("Notes/.DS_Store"), "x").unwrap();
        fs::write(dir.path().join("Notes/.plainva-tmp-412-7-a.md"), "half").unwrap();
        fs::write(dir.path().join("Notes/.env-notes.md"), "a user's own dot file").unwrap();
        fs::write(dir.path().join("Notes/a.md"), "x").unwrap();
        let result = run(dir.path(), "", true, false);
        assert_eq!(paths(&result), vec!["Notes", "Notes/.env-notes.md", "Notes/a.md"]);
        assert!(result.skipped.is_empty(), "an internal folder is not a skipped one");
    }

    #[test]
    fn asking_for_an_internal_folder_lists_it() {
        // The version history walks `.plainva/backups` on purpose.
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join(".plainva/backups/.git")).unwrap();
        fs::write(dir.path().join(".plainva/backups/a.md"), "x").unwrap();
        fs::write(dir.path().join(".plainva/backups/.git/HEAD"), "x").unwrap();
        let result = run(dir.path(), ".plainva/backups", true, true);
        assert_eq!(paths(&result), vec![".plainva/backups/.git", ".plainva/backups/.git/HEAD", ".plainva/backups/a.md"]);
    }

    #[test]
    fn a_folder_that_is_not_there_is_reported_not_empty() {
        let dir = tempfile::tempdir().unwrap();
        let result = run(dir.path(), "gone", true, false);
        assert!(result.entries.is_empty());
        assert_eq!(result.skipped, vec![WalkSkip { path: "gone".into(), reason: "unreadable" }]);
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_folder_is_reported_and_the_rest_is_listed() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("locked")).unwrap();
        fs::create_dir_all(dir.path().join("open")).unwrap();
        fs::write(dir.path().join("locked/secret.md"), "x").unwrap();
        fs::write(dir.path().join("open/a.md"), "x").unwrap();
        fs::set_permissions(dir.path().join("locked"), fs::Permissions::from_mode(0o000)).unwrap();
        let readable_anyway = fs::read_dir(dir.path().join("locked")).is_ok();
        let result = run(dir.path(), "", true, false);
        fs::set_permissions(dir.path().join("locked"), fs::Permissions::from_mode(0o755)).unwrap();
        if readable_anyway {
            // Running as root: permissions do not bind, nothing to assert.
            return;
        }
        assert_eq!(paths(&result), vec!["locked", "open", "open/a.md"]);
        assert_eq!(result.skipped, vec![WalkSkip { path: "locked".into(), reason: "unreadable" }]);
    }

    fn link_dir(target: &Path, link: &Path) -> std::io::Result<()> {
        #[cfg(unix)]
        return std::os::unix::fs::symlink(target, link);
        #[cfg(windows)]
        return std::os::windows::fs::symlink_dir(target, link);
    }

    #[test]
    fn a_link_back_to_an_ancestor_is_cut_and_reported() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir_all(root.join("a")).unwrap();
        fs::write(root.join("a/n.md"), "x").unwrap();
        if link_dir(&root.join("a"), &root.join("a/loop")).is_err() {
            // Windows without the privilege to create links: nothing to walk.
            eprintln!("skipped: cannot create a directory link on this machine");
            return;
        }
        let result = run(&root, "", true, false);
        let cycles: Vec<_> = result.skipped.iter().filter(|s| s.reason == "cycle").collect();
        assert_eq!(cycles.len(), 1, "{:?}", result.skipped);
        assert!(result.entries.iter().any(|e| e.0 == "a/n.md"));
        if cfg!(unix) {
            // Identity cuts the loop where it closes; the note exists once.
            assert_eq!(cycles[0].path, "a/loop");
            assert_eq!(result.entries.iter().filter(|e| e.0.ends_with("n.md")).count(), 1);
        } else {
            // No identity on Windows: the depth cap ends it, as in the frontend walker.
            assert_eq!(cycles[0].path.matches("loop").count() as u32, MAX_WALK_DEPTH);
        }
    }

    #[test]
    fn two_links_to_one_folder_list_it_once_where_identity_exists() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir_all(root.join("lib")).unwrap();
        fs::write(root.join("lib/n.md"), "x").unwrap();
        if link_dir(&root.join("lib"), &root.join("lib64")).is_err() {
            eprintln!("skipped: cannot create a directory link on this machine");
            return;
        }
        let result = run(&root, "", true, false);
        let notes = result.entries.iter().filter(|e| e.0.ends_with("n.md")).count();
        if cfg!(unix) {
            assert_eq!(notes, 1);
            assert_eq!(result.skipped.len(), 1);
            assert_eq!(result.skipped[0].reason, "cycle");
        } else {
            assert_eq!(notes, 2);
        }
        // The link itself is a folder for the tree, whichever path won.
        assert!(result.entries.iter().any(|e| e.0 == "lib64" && e.1));
    }

    #[test]
    fn the_depth_cap_reports_where_it_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let mut deep = dir.path().to_path_buf();
        let mut rel = String::new();
        for _ in 0..(MAX_WALK_DEPTH + 2) {
            deep.push("d");
            rel = child_rel(&rel, "d");
        }
        fs::create_dir_all(&deep).unwrap();
        let result = run(dir.path(), "", true, false);
        assert_eq!(result.skipped.len(), 1);
        assert_eq!(result.skipped[0].reason, "cycle");
        assert_eq!(result.skipped[0].path.matches('d').count() as u32, MAX_WALK_DEPTH + 1);
        assert_eq!(result.entries.len() as u32, MAX_WALK_DEPTH + 1);
    }

    #[test]
    fn a_cancelled_walk_returns_nothing() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "x").unwrap();
        let cancelled = AtomicBool::new(true);
        assert!(walk(dir.path(), "", true, false, &rules(), &cancelled).is_err());
    }

    #[test]
    fn the_start_folder_cannot_leave_the_registered_root() {
        let dir = tempfile::tempdir().unwrap();
        let roots = WriteRoots::default();
        roots.0.lock().unwrap().insert("vault".into(), dir.path().to_path_buf());
        assert_eq!(registered_path(&roots, "vault", "").unwrap(), dir.path());
        assert!(registered_path(&roots, "vault", "Notes/Sub").unwrap().starts_with(dir.path()));
        assert!(registered_path(&roots, "vault", "../outside").is_err());
        assert!(registered_path(&roots, "vault", "Notes/../../outside").is_err());
        assert!(registered_path(&roots, "vault", "/etc").is_err());
        assert!(registered_path(&roots, "vault", "C:\\Windows").is_err() || cfg!(not(windows)));
        assert!(registered_path(&roots, "other", "").is_err());
    }

    /// Not a test: `PLAINVA_WALK_BENCH_DIR=<vault> cargo test --release walk_benchmark -- --ignored --nocapture`
    /// prints how long the walk of a real folder takes (docs/engineering/Vault_Watcher_and_Indexing.md).
    #[test]
    #[ignore]
    fn walk_benchmark() {
        let Ok(dir) = std::env::var("PLAINVA_WALK_BENCH_DIR") else {
            eprintln!("set PLAINVA_WALK_BENCH_DIR");
            return;
        };
        let root = PathBuf::from(dir).canonicalize().unwrap();
        for round in 0..5 {
            let started = std::time::Instant::now();
            let result = run(&root, "", true, false);
            let walked = started.elapsed();
            let started = std::time::Instant::now();
            let json = serde_json::to_string(&result).unwrap();
            eprintln!(
                "round {round}: {} entries, {} skipped, walk {:.1} ms, serialize {:.1} ms, {} bytes",
                result.entries.len(),
                result.skipped.len(),
                walked.as_secs_f64() * 1000.0,
                started.elapsed().as_secs_f64() * 1000.0,
                json.len()
            );
        }
    }
}
