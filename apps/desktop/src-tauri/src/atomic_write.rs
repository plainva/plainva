//! Atomic vault writes (hardening plan P2 — torn/zero-byte files on crash,
//! disk-full or a network-share drop must never corrupt a note).
//!
//! Contract (shared with the mobile adapter): write to an EXCLUSIVE temp file
//! in the destination directory, flush + fsync, then rename over the target.
//! Atomicity (no torn file becomes visible) and durability (content survives
//! power loss) are separate goals: `sync_all` covers the file, and on Unix a
//! best-effort parent-directory fsync covers the name change; network file
//! systems keep their own cache semantics and stay best-effort.
//!
//! Security shape (P4-ready): the write command takes an OPAQUE root id plus
//! a vault-RELATIVE path — never an absolute frontend path. In P2 the webview
//! still registers roots itself (it holds broad fs scope anyway); P4 moves
//! registration behind Rust-owned dialogs without changing this command.

use std::collections::HashMap;
use std::fs::{self, FileTimes, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;

#[derive(Default)]
pub struct WriteRoots(pub Mutex<HashMap<String, PathBuf>>);

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Stable, opaque handle for a canonical root path (FNV-1a; the map value is
/// authoritative, the id is only a lookup key — no crypto needed).
fn root_id_for(path: &Path) -> String {
    let s = path.to_string_lossy();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[tauri::command]
pub fn register_write_root(
    state: tauri::State<'_, WriteRoots>,
    path: String,
) -> Result<String, String> {
    let canonical = fs::canonicalize(&path).map_err(|e| format!("root not accessible: {e}"))?;
    if !canonical.is_dir() {
        return Err("root is not a directory".into());
    }
    let id = root_id_for(&canonical);
    state
        .0
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .insert(id.clone(), canonical);
    Ok(id)
}

/// Rejects absolute paths, `..` traversal, NUL bytes and drive prefixes;
/// returns the cleaned relative path.
///
/// Shared with the ZIP extractor so an archive entry is held to exactly the
/// same standard as a write coming from the app.
pub(crate) fn validate_rel_path(rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Err("empty path".into());
    }
    if rel.contains('\u{0}') {
        return Err("NUL in path".into());
    }
    let p = Path::new(rel);
    if p.is_absolute() {
        return Err("absolute path rejected".into());
    }
    let mut clean = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::Normal(c) => clean.push(c),
            Component::CurDir => {}
            // ParentDir, RootDir and Windows Prefix components all escape.
            _ => return Err("path traversal rejected".into()),
        }
    }
    if clean.as_os_str().is_empty() {
        return Err("empty path".into());
    }
    Ok(clean)
}

pub fn write_atomic_impl(root: &Path, rel: &str, bytes: &[u8]) -> Result<(), String> {
    let rel_clean = validate_rel_path(rel)?;
    let target = root.join(&rel_clean);
    let parent = target
        .parent()
        .ok_or_else(|| "no parent directory".to_string())?
        .to_path_buf();
    fs::create_dir_all(&parent).map_err(|e| format!("mkdir failed: {e}"))?;

    // Containment check AFTER mkdir: canonicalize the (now existing) parent
    // and require it inside the root — catches symlinked subfolders pointing
    // outside the vault.
    let canon_parent =
        fs::canonicalize(&parent).map_err(|e| format!("parent not accessible: {e}"))?;
    let canon_root = fs::canonicalize(root).map_err(|e| format!("root not accessible: {e}"))?;
    if !canon_parent.starts_with(&canon_root) {
        return Err("path escapes the registered root".into());
    }

    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "invalid file name".to_string())?
        .to_string();
    // Dot-prefixed temp: the JS directory walker and the watcher filter skip
    // dot files, so half-written temps never show up in the tree or the sync.
    let temp_path = canon_parent.join(format!(
        ".plainva-tmp-{}-{}-{file_name}",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let final_target = canon_parent.join(&file_name);

    let result = (|| -> Result<(), String> {
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true) // exclusive — never clobber a concurrent temp
            .open(&temp_path)
            .map_err(|e| format!("temp create failed: {e}"))?;
        f.write_all(bytes)
            .map_err(|e| format!("write failed: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync failed: {e}"))?;
        drop(f);

        // std::fs::rename replaces the destination atomically on Unix
        // (rename(2)) and Windows (MoveFileEx + REPLACE_EXISTING). Windows
        // note: ReplaceFileW would additionally preserve the target's ACLs
        // and alternate data streams; for vault notes the directory-inherited
        // ACLs of the temp file are equivalent, so we keep the std call and
        // avoid a windows-sys dependency (documented deviation). Antivirus
        // can hold short locks on the destination — retry briefly.
        let mut last_err: Option<std::io::Error> = None;
        for attempt in 0u32..5 {
            match fs::rename(&temp_path, &final_target) {
                Ok(()) => {
                    last_err = None;
                    break;
                }
                Err(e) => {
                    last_err = Some(e);
                    if attempt < 4 {
                        std::thread::sleep(std::time::Duration::from_millis(10 << attempt));
                    }
                }
            }
        }
        if let Some(e) = last_err {
            return Err(format!("rename failed: {e}"));
        }

        // Durability of the NAME change where the platform supports it.
        #[cfg(unix)]
        {
            if let Ok(dir) = fs::File::open(&canon_parent) {
                let _ = dir.sync_all();
            }
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

#[tauri::command]
pub fn write_file_atomic(
    state: tauri::State<'_, WriteRoots>,
    root_id: String,
    rel_path: String,
    contents: String,
    encoding: String,
) -> Result<(), String> {
    let root = {
        let map = state.0.lock().map_err(|_| "state poisoned".to_string())?;
        map.get(&root_id)
            .cloned()
            .ok_or_else(|| "unknown write root".to_string())?
    };
    let bytes: Vec<u8> = match encoding.as_str() {
        "utf8" => contents.into_bytes(),
        "base64" => base64::engine::general_purpose::STANDARD
            .decode(contents.as_bytes())
            .map_err(|e| format!("base64 decode failed: {e}"))?,
        other => return Err(format!("unknown encoding: {other}")),
    };
    write_atomic_impl(&root, &rel_path, &bytes)
}

fn system_time_from_ms(ms: f64) -> Result<SystemTime, String> {
    if !ms.is_finite() {
        return Err("timestamp is not a finite number".into());
    }
    let millis = ms.round();
    let magnitude = Duration::from_millis(millis.abs() as u64);
    let time = if millis >= 0.0 {
        UNIX_EPOCH.checked_add(magnitude)
    } else {
        UNIX_EPOCH.checked_sub(magnitude)
    };
    time.ok_or_else(|| "timestamp out of range".to_string())
}

/// Stamps an already written file with the timestamps of its source.
///
/// An import carries notes that were written over years; without this every
/// one of them looks like it was created today, and "recently opened", the
/// graph heatmap and every sort by date lose their meaning at once.
///
/// Modification time is portable. Creation time can only be set on Windows —
/// elsewhere the portable carrier is the `created` frontmatter key the
/// importers write alongside the file.
pub fn set_file_times_impl(
    root: &Path,
    rel: &str,
    modified_ms: f64,
    created_ms: Option<f64>,
) -> Result<(), String> {
    let rel_clean = validate_rel_path(rel)?;
    let target = root.join(&rel_clean);

    let canon_root = fs::canonicalize(root).map_err(|e| format!("root not accessible: {e}"))?;
    let canon_target =
        fs::canonicalize(&target).map_err(|e| format!("file not accessible: {e}"))?;
    if !canon_target.starts_with(&canon_root) {
        return Err("path escapes the registered root".into());
    }

    let modified = system_time_from_ms(modified_ms)?;
    let file = OpenOptions::new()
        .write(true)
        .open(&canon_target)
        .map_err(|e| format!("open failed: {e}"))?;

    let times = FileTimes::new()
        .set_accessed(modified)
        .set_modified(modified);

    #[cfg(windows)]
    let times = match created_ms {
        Some(ms) => {
            use std::os::windows::fs::FileTimesExt;
            times.set_created(system_time_from_ms(ms)?)
        }
        None => times,
    };
    #[cfg(not(windows))]
    let _ = created_ms;

    file.set_times(times)
        .map_err(|e| format!("set times failed: {e}"))
}

#[tauri::command]
pub fn set_file_times(
    state: tauri::State<'_, WriteRoots>,
    root_id: String,
    rel_path: String,
    modified_ms: f64,
    created_ms: Option<f64>,
) -> Result<(), String> {
    let root = {
        let map = state.0.lock().map_err(|_| "state poisoned".to_string())?;
        map.get(&root_id)
            .cloned()
            .ok_or_else(|| "unknown write root".to_string())?
    };
    set_file_times_impl(&root, &rel_path, modified_ms, created_ms)
}

#[cfg(test)]
mod atomic_write_tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("plainva-atomic-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    #[test]
    fn stamps_a_file_with_its_source_modification_time() {
        let dir = scratch_dir("set-times");
        write_atomic_impl(&dir, "Imported/Note.md", b"# Note").unwrap();
        // 2019-03-14T09:26:53.589Z — a date an import would carry over.
        let source_ms = 1_552_555_613_589f64;

        set_file_times_impl(&dir, "Imported/Note.md", source_ms, Some(source_ms)).unwrap();

        let meta = fs::metadata(dir.join("Imported/Note.md")).unwrap();
        let modified = meta
            .modified()
            .unwrap()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        assert_eq!(modified, source_ms as u64);
    }

    #[test]
    fn set_times_rejects_traversal_and_a_missing_file() {
        let dir = scratch_dir("set-times-guard");
        write_atomic_impl(&dir, "Note.md", b"x").unwrap();

        assert!(set_file_times_impl(&dir, "../escape.md", 0.0, None).is_err());
        assert!(set_file_times_impl(&dir, "C:/Windows/system.ini", 0.0, None).is_err());
        assert!(set_file_times_impl(&dir, "Missing.md", 0.0, None).is_err());
        // A non-finite value must not silently become the epoch.
        assert!(set_file_times_impl(&dir, "Note.md", f64::NAN, None).is_err());
    }

    fn no_temp_leftovers(dir: &Path) -> bool {
        fs::read_dir(dir)
            .expect("read_dir")
            .filter_map(|e| e.ok())
            .all(|e| !e.file_name().to_string_lossy().starts_with(".plainva-tmp-"))
    }

    #[test]
    fn creates_and_overwrites_atomically() {
        let root = scratch_dir("roundtrip");
        write_atomic_impl(&root, "Notes/A.md", b"first").expect("create");
        assert_eq!(fs::read(root.join("Notes/A.md")).unwrap(), b"first");
        write_atomic_impl(&root, "Notes/A.md", b"second").expect("overwrite");
        assert_eq!(fs::read(root.join("Notes/A.md")).unwrap(), b"second");
        assert!(no_temp_leftovers(&root.join("Notes")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let root = scratch_dir("traversal");
        assert!(write_atomic_impl(&root, "../escape.md", b"x").is_err());
        assert!(write_atomic_impl(&root, "a/../../escape.md", b"x").is_err());
        assert!(write_atomic_impl(&root, "", b"x").is_err());
        let abs = if cfg!(windows) {
            "C:\\escape.md"
        } else {
            "/escape.md"
        };
        assert!(write_atomic_impl(&root, abs, b"x").is_err());
        assert!(no_temp_leftovers(&root));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn failed_replace_keeps_the_original_and_cleans_the_temp() {
        let root = scratch_dir("failure");
        // Make the TARGET a directory: the rename over it must fail on every
        // platform, the original tree stays, and the temp file is removed.
        fs::create_dir_all(root.join("Blocked.md/marker")).unwrap();
        let err = write_atomic_impl(&root, "Blocked.md", b"new").unwrap_err();
        assert!(err.contains("rename failed"), "unexpected error: {err}");
        assert!(
            root.join("Blocked.md/marker").is_dir(),
            "original clobbered"
        );
        assert!(no_temp_leftovers(&root), "temp file left behind");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn curdir_components_are_tolerated() {
        let root = scratch_dir("curdir");
        write_atomic_impl(&root, "./Notes/./B.md", b"ok").expect("write");
        assert_eq!(fs::read(root.join("Notes/B.md")).unwrap(), b"ok");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn root_ids_are_stable_and_distinct() {
        let a = root_id_for(Path::new("/vault/a"));
        let b = root_id_for(Path::new("/vault/b"));
        assert_eq!(a, root_id_for(Path::new("/vault/a")));
        assert_ne!(a, b);
        assert_eq!(a.len(), 16);
    }
}
