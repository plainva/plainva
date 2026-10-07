//! The vault watcher (issue #110, E8).
//!
//! It used to be tauri-plugin-fs's `watch` with `delayMs`, i.e.
//! notify-debouncer-full. On macOS FSEvents does not pair the two sides of a
//! rename; the debouncer guesses which side is old by asking the disk, and when
//! FSEvents bundles `Created|Renamed` on the target it keeps only a create there.
//! The old path was never reported, the index kept the file at its old place,
//! and the plugin dropped watcher errors on the floor.
//!
//! This watcher runs `notify` directly and reports EVERY path of every event —
//! old and new side of a rename, whatever the backend delivers — classified
//! just enough for the frontend to know when to re-check a parent folder.
//! Errors travel too. Debouncing stays where it was: the frontend collects for
//! a second and indexes the batch (VaultContext).
//!
//! Events are gathered for a short window before they cross the IPC bridge,
//! only to keep a `git checkout` from becoming thousands of messages; nothing
//! is dropped or merged. A batch too large to be worth sending becomes one
//! rescan request — the frontend runs a full reconcile for 50 paths anyway.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::event::{EventKind, ModifyKind};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::ipc::Channel;

use crate::atomic_write::{WriteRoots, TEMP_PREFIX};

/// How long events are gathered before one batch crosses the bridge.
const GATHER_WINDOW: Duration = Duration::from_millis(150);
/// Above this many changes in one window, a single rescan request replaces them.
const MAX_BATCH: usize = 2000;

/// One change as the frontend sees it. `kind` is one of `create`, `modify`,
/// `remove`, `rename`, `any`, `rescan` (the backend lost track: reconcile
/// everything) or `error` (with `message`). `paths` are absolute, exactly as
/// the backend delivered them.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchChange {
    pub kind: &'static str,
    pub paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchStarted {
    id: u32,
    /// The directory actually watched (canonical). Event paths start with it,
    /// which is not always the path the vault was opened with (a symlink, a
    /// `\\?\` prefix on Windows, `/private/var` on macOS).
    root: String,
}

#[derive(Default)]
pub struct VaultWatchers {
    next_id: AtomicU32,
    /// Shared with each gathering thread, so a watcher whose window is gone
    /// (reloaded, closed) removes itself instead of running until exit.
    active: Arc<Mutex<HashMap<u32, RecommendedWatcher>>>,
}

fn path_strings(paths: &[PathBuf]) -> Vec<String> {
    paths.iter().map(|p| p.to_string_lossy().into_owned()).collect()
}

/// The temp file of the app's own atomic write (atomic_write.rs). It is
/// created, written and renamed away within milliseconds on every save, and
/// each of those steps is an event. None of them means anything to the index
/// — the save's result arrives as events for the note itself — so they are
/// dropped here instead of crossing the bridge to be dropped there
/// (issue #122). The frontend holds the same rule for whatever still names
/// such a file (`isInternalPath`).
fn is_own_temp(path: &std::path::Path) -> bool {
    path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(TEMP_PREFIX))
}

/// Maps one backend event. Access events (reads — the indexer's own) are
/// dropped: reacting to them re-indexed on every read. Everything else keeps
/// every path the backend named, including a rename that carries only its
/// target (FSEvents, and inotify when the pair is split across batches).
pub fn classify(event: &notify::Event) -> Option<WatchChange> {
    if event.need_rescan() {
        return Some(WatchChange { kind: "rescan", paths: path_strings(&event.paths), message: event.info().map(str::to_string) });
    }
    let kind = match event.kind {
        EventKind::Access(_) => return None,
        EventKind::Create(_) => "create",
        EventKind::Modify(ModifyKind::Name(_)) => "rename",
        EventKind::Modify(_) => "modify",
        EventKind::Remove(_) => "remove",
        EventKind::Any | EventKind::Other => "any",
    };
    // A paired rename (inotify) names the temp and the note in one event:
    // the note's side stays, the temp's goes.
    let paths: Vec<PathBuf> = event.paths.iter().filter(|p| !is_own_temp(p)).cloned().collect();
    if paths.is_empty() && !event.paths.is_empty() {
        return None;
    }
    Some(WatchChange { kind, paths: path_strings(&paths), message: None })
}

/// A watcher error is reported, never swallowed: it can mean lost events
/// (a full inotify queue, a dropped FSEvents stream), and the frontend then
/// reconciles and says so in the diagnostics.
pub fn classify_error(error: &notify::Error) -> WatchChange {
    WatchChange { kind: "error", paths: path_strings(&error.paths), message: Some(error.to_string()) }
}

fn classify_result(result: notify::Result<notify::Event>) -> Option<WatchChange> {
    match result {
        Ok(event) => classify(&event),
        Err(error) => Some(classify_error(&error)),
    }
}

/// Gathers one batch: blocks for the first event, then collects until the
/// window closes. `None` once the watcher is gone (its sender dropped).
fn gather(rx: &Receiver<notify::Result<notify::Event>>, window: Duration) -> Option<Vec<WatchChange>> {
    let first = rx.recv().ok()?;
    let mut batch: Vec<WatchChange> = classify_result(first).into_iter().collect();
    let deadline = Instant::now() + window;
    let mut overflow = false;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(left) {
            Ok(result) => {
                if overflow {
                    continue;
                }
                if let Some(change) = classify_result(result) {
                    batch.push(change);
                }
                if batch.len() > MAX_BATCH {
                    overflow = true;
                }
            }
            Err(RecvTimeoutError::Timeout) => break,
            // The watcher was stopped mid-window: deliver what arrived.
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    Some(fold(batch, overflow))
}

/// Keeps the batch as it is, unless it overflowed: then one rescan request
/// stands for all of it, and errors are kept so they still reach the log.
pub fn fold(batch: Vec<WatchChange>, overflow: bool) -> Vec<WatchChange> {
    if !overflow {
        return batch;
    }
    let mut out: Vec<WatchChange> = batch.into_iter().filter(|c| c.kind == "error").take(10).collect();
    out.push(WatchChange { kind: "rescan", paths: Vec::new(), message: Some("too many changes at once".into()) });
    out
}

#[tauri::command]
pub fn vault_watch_start(
    root_id: String,
    on_event: Channel<Vec<WatchChange>>,
    roots: tauri::State<'_, WriteRoots>,
    watchers: tauri::State<'_, VaultWatchers>,
) -> Result<WatchStarted, String> {
    let root = roots
        .0
        .lock()
        .map_err(|_| "watch root registry unavailable".to_string())?
        .get(&root_id)
        .cloned()
        .ok_or_else(|| "unknown watch root".to_string())?;
    let (tx, rx) = channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| format!("cannot start the watcher: {e}"))?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| format!("cannot watch the vault: {e}"))?;
    let id = watchers.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    watchers
        .active
        .lock()
        .map_err(|_| "watcher registry unavailable".to_string())?
        .insert(id, watcher);
    let registry = Arc::clone(&watchers.active);
    let spawned = std::thread::Builder::new()
        .name("vault-watch".into())
        .spawn(move || {
            // Ends when the watcher is dropped (vault_watch_stop) or the
            // frontend's channel is gone (window reloaded or closed) — then
            // the watcher is taken out of the registry, too.
            while let Some(batch) = gather(&rx, GATHER_WINDOW) {
                if batch.is_empty() {
                    continue;
                }
                if on_event.send(batch).is_err() {
                    if let Ok(mut active) = registry.lock() {
                        active.remove(&id);
                    }
                    break;
                }
            }
        });
    if let Err(e) = spawned {
        if let Ok(mut active) = watchers.active.lock() {
            active.remove(&id);
        }
        return Err(format!("cannot start the watcher thread: {e}"));
    }
    Ok(WatchStarted { id, root: root.to_string_lossy().into_owned() })
}

#[tauri::command]
pub fn vault_watch_stop(id: u32, watchers: tauri::State<'_, VaultWatchers>) -> Result<(), String> {
    // Dropping the watcher closes its sender; the gathering thread ends with it.
    watchers
        .active
        .lock()
        .map_err(|_| "watcher registry unavailable".to_string())?
        .remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, CreateKind, DataChange, Flag, RemoveKind, RenameMode};
    use notify::Event;

    fn ev(kind: EventKind, paths: &[&str]) -> Event {
        let mut e = Event::new(kind);
        for p in paths {
            e = e.add_path(PathBuf::from(p));
        }
        e
    }

    #[test]
    fn a_rename_that_carries_only_its_target_keeps_that_path() {
        // FSEvents: no pairing, and a bundled Created|Renamed on the target.
        // The debouncer turned this into a bare create and lost the old side;
        // here each side arrives as its own rename.
        let to = classify(&ev(EventKind::Modify(ModifyKind::Name(RenameMode::To)), &["/v/4 blog/taken/n.md"])).unwrap();
        assert_eq!(to, WatchChange { kind: "rename", paths: vec!["/v/4 blog/taken/n.md".into()], message: None });
    }

    #[test]
    fn unpaired_any_renames_keep_both_sides() {
        let old = classify(&ev(EventKind::Modify(ModifyKind::Name(RenameMode::Any)), &["/v/4 blog/n.md"])).unwrap();
        let new = classify(&ev(EventKind::Modify(ModifyKind::Name(RenameMode::Any)), &["/v/4 blog/taken/n.md"])).unwrap();
        assert_eq!(old.kind, "rename");
        assert_eq!(new.kind, "rename");
        assert_eq!(old.paths, vec!["/v/4 blog/n.md".to_string()]);
        assert_eq!(new.paths, vec!["/v/4 blog/taken/n.md".to_string()]);
    }

    #[test]
    fn a_paired_rename_reports_both_paths() {
        let both = classify(&ev(EventKind::Modify(ModifyKind::Name(RenameMode::Both)), &["/v/a.md", "/v/b.md"])).unwrap();
        assert_eq!(both.kind, "rename");
        assert_eq!(both.paths, vec!["/v/a.md".to_string(), "/v/b.md".to_string()]);
        let from = classify(&ev(EventKind::Modify(ModifyKind::Name(RenameMode::From)), &["/v/a.md"])).unwrap();
        assert_eq!(from.kind, "rename");
    }

    #[test]
    fn kinds_are_mapped_and_reads_are_dropped() {
        assert_eq!(classify(&ev(EventKind::Create(CreateKind::File), &["/v/x.md"])).unwrap().kind, "create");
        assert_eq!(classify(&ev(EventKind::Modify(ModifyKind::Data(DataChange::Content)), &["/v/x.md"])).unwrap().kind, "modify");
        assert_eq!(classify(&ev(EventKind::Remove(RemoveKind::File), &["/v/x.md"])).unwrap().kind, "remove");
        assert_eq!(classify(&ev(EventKind::Any, &["/v/x.md"])).unwrap().kind, "any");
        assert_eq!(classify(&ev(EventKind::Other, &["/v/x.md"])).unwrap().kind, "any");
        assert!(classify(&ev(EventKind::Access(AccessKind::Any), &["/v/x.md"])).is_none());
    }

    #[test]
    fn the_apps_own_temp_file_never_crosses_the_bridge() {
        // Windows: the temp is created and changed on its own.
        assert!(classify(&ev(EventKind::Create(CreateKind::File), &["/v/Sub/.plainva-tmp-412-7-note.md"])).is_none());
        assert!(classify(&ev(EventKind::Modify(ModifyKind::Any), &["/v/Sub/.plainva-tmp-412-7-note.md"])).is_none());
        assert!(classify(&ev(EventKind::Modify(ModifyKind::Name(RenameMode::From)), &["/v/Sub/.plainva-tmp-412-7-note.md"])).is_none());
        // inotify pairs the rename: the note's side must survive.
        let both = classify(&ev(EventKind::Modify(ModifyKind::Name(RenameMode::Both)), &["/v/Sub/.plainva-tmp-412-7-note.md", "/v/Sub/note.md"])).unwrap();
        assert_eq!(both, WatchChange { kind: "rename", paths: vec!["/v/Sub/note.md".into()], message: None });
        // A user's own dot-file is a note like any other.
        assert!(classify(&ev(EventKind::Modify(ModifyKind::Any), &["/v/Sub/.env-notes.md"])).is_some());
        assert!(classify(&ev(EventKind::Modify(ModifyKind::Any), &["/v/Sub/plainva-tmp-notes.md"])).is_some());
        // A folder that merely contains one is still reported.
        assert!(classify(&ev(EventKind::Modify(ModifyKind::Any), &["/v/Sub"])).is_some());
    }

    #[test]
    fn a_rescan_notice_asks_for_a_full_reconcile() {
        let e = ev(EventKind::Other, &["/v/sub"]).set_flag(Flag::Rescan).set_info("rescan: kernel dropped");
        let change = classify(&e).unwrap();
        assert_eq!(change.kind, "rescan");
        assert_eq!(change.message.as_deref(), Some("rescan: kernel dropped"));
    }

    #[test]
    fn errors_are_reported_not_swallowed() {
        let error = notify::Error::generic("queue overflow").add_path(PathBuf::from("/v"));
        let change = classify_error(&error);
        assert_eq!(change.kind, "error");
        assert_eq!(change.paths, vec!["/v".to_string()]);
        assert!(change.message.unwrap().contains("queue overflow"));
        assert_eq!(classify_result(Err(notify::Error::generic("x"))).unwrap().kind, "error");
    }

    #[test]
    fn a_batch_keeps_every_event_in_order() {
        let (tx, rx) = channel();
        tx.send(Ok(ev(EventKind::Modify(ModifyKind::Name(RenameMode::Any)), &["/v/a.md"]))).unwrap();
        tx.send(Ok(ev(EventKind::Access(AccessKind::Any), &["/v/a.md"]))).unwrap();
        tx.send(Ok(ev(EventKind::Modify(ModifyKind::Name(RenameMode::Any)), &["/v/sub/a.md"]))).unwrap();
        tx.send(Err(notify::Error::generic("lost"))).unwrap();
        drop(tx);
        let batch = gather(&rx, Duration::from_millis(50)).unwrap();
        let kinds: Vec<_> = batch.iter().map(|c| c.kind).collect();
        assert_eq!(kinds, vec!["rename", "rename", "error"]);
        assert!(gather(&rx, Duration::from_millis(10)).is_none(), "a dropped watcher ends the thread");
    }

    #[test]
    fn an_overflowing_batch_becomes_one_rescan_and_keeps_its_errors() {
        let mut batch: Vec<WatchChange> = (0..5).map(|i| WatchChange { kind: "create", paths: vec![format!("/v/{i}.md")], message: None }).collect();
        batch.push(WatchChange { kind: "error", paths: vec![], message: Some("lost".into()) });
        assert_eq!(fold(batch.clone(), false), batch);
        let folded = fold(batch, true);
        assert_eq!(folded.len(), 2);
        assert_eq!(folded[0].kind, "error");
        assert_eq!(folded[1].kind, "rescan");
    }

    #[test]
    fn the_real_watcher_reports_a_move_between_folders() {
        // A real backend on the machine running the tests (ReadDirectoryChanges
        // on Windows, inotify on Linux, FSEvents on macOS). Whatever it
        // delivers, BOTH sides of the move must reach the batch.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("blog/taken")).unwrap();
        std::fs::write(root.join("blog/n.md"), "x").unwrap();
        let (tx, rx) = channel();
        let mut watcher = notify::recommended_watcher(tx).unwrap();
        watcher.watch(&root, RecursiveMode::Recursive).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        std::fs::rename(root.join("blog/n.md"), root.join("blog/taken/n.md")).unwrap();
        let mut seen: Vec<String> = Vec::new();
        let until = Instant::now() + Duration::from_secs(10);
        while Instant::now() < until {
            if let Ok(result) = rx.recv_timeout(Duration::from_millis(200)) {
                if let Some(change) = classify_result(result) {
                    seen.extend(change.paths);
                }
            }
            let has = |suffix: &str| seen.iter().any(|p| p.replace('\\', "/").ends_with(suffix));
            if has("blog/n.md") && has("blog/taken/n.md") {
                break;
            }
        }
        let has = |suffix: &str| seen.iter().any(|p| p.replace('\\', "/").ends_with(suffix));
        assert!(has("blog/n.md"), "old side missing: {seen:?}");
        assert!(has("blog/taken/n.md"), "new side missing: {seen:?}");
        drop(watcher);
    }
}
