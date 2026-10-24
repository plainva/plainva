//! Checked filesystem reads shared by vault adapters and recovery journals.
//! Only NotFound means absence; directory iterator and metadata errors survive.

use std::fs::{self, DirEntry, Metadata};
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::atomic_write::{validate_rel_path, WriteRoots};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckedDirEntry {
    name: String,
    is_file: bool,
    is_directory: bool,
    is_symlink: bool,
    /// A directory snapshot carries regular-file metadata in the same IPC.
    /// Links stay unresolved here; the walker applies its identity/cycle guard.
    metadata: Option<EntryMetadata>,
    /// Set when THIS entry could not be inspected (a name that is not UTF-8,
    /// a failing file type or metadata call). The walker protects exactly this
    /// entry; the rest of the listing stays trustworthy (issue #110, E8). It
    /// used to fail the whole directory, and the index then refused every
    /// deletion under it — one odd name kept every moved file in the tree.
    #[serde(skip_serializing_if = "Option::is_none")]
    unreadable: Option<String>,
}

fn unreadable_entry(name: String, reason: String) -> CheckedDirEntry {
    CheckedDirEntry {
        name,
        is_file: false,
        is_directory: false,
        is_symlink: false,
        metadata: None,
        unreadable: Some(reason),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryMetadata {
    size: u64,
    mtime: Option<u64>,
    ctime: Option<u64>,
}

fn timestamp_ms(value: io::Result<std::time::SystemTime>) -> Option<u64> {
    value.ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis().try_into().ok()
}

pub(crate) fn registered_path(roots: &WriteRoots, root_id: &str, relative: &str) -> Result<PathBuf, String> {
    let root = roots
        .0
        .lock()
        .map_err(|_| "read root registry unavailable".to_string())?
        .get(root_id)
        .cloned()
        .ok_or_else(|| "unknown read root".to_string())?;
    if relative.is_empty() {
        return Ok(root);
    }
    // Like the existing reader, this follows mounted folders within the vault.
    // The caller cannot spell an absolute path or escape with a parent segment.
    Ok(root.join(validate_rel_path(relative)?))
}

fn exists_result(result: io::Result<Metadata>) -> Result<bool, String> {
    match result {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("cannot inspect path: {error}")),
    }
}

fn read_text(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("cannot read text file: {error}")),
    }
}

/// An iterator error carries no name, so nothing narrower than the whole
/// directory can be protected: it still fails the listing. Everything that
/// fails for ONE named entry is reported on that entry instead.
fn collect_entries(
    entries: impl Iterator<Item = io::Result<DirEntry>>,
) -> Result<Vec<CheckedDirEntry>, String> {
    entries
        .map(|entry| {
            let entry = entry.map_err(|error| format!("cannot read directory entry: {error}"))?;
            Ok(inspect_entry(entry.file_name(), entry.file_type(), || entry.metadata()))
        })
        .collect()
}

fn inspect_entry(
    raw_name: std::ffi::OsString,
    kind: io::Result<fs::FileType>,
    metadata: impl FnOnce() -> io::Result<Metadata>,
) -> CheckedDirEntry {
    let name = match raw_name.into_string() {
        Ok(name) => name,
        Err(raw) => {
            return unreadable_entry(raw.to_string_lossy().into_owned(), "directory entry has an invalid filename".into())
        }
    };
    let kind = match kind {
        Ok(kind) => kind,
        Err(error) => return unreadable_entry(name, format!("cannot inspect directory entry: {error}")),
    };
    let metadata = if kind.is_file() {
        match metadata() {
            Ok(value) => Some(EntryMetadata {
                size: value.len(),
                mtime: timestamp_ms(value.modified()),
                ctime: timestamp_ms(value.created()),
            }),
            Err(error) => return unreadable_entry(name, format!("cannot inspect file metadata: {error}")),
        }
    } else {
        None
    };
    CheckedDirEntry {
        name,
        is_file: kind.is_file(),
        is_directory: kind.is_dir(),
        is_symlink: kind.is_symlink(),
        metadata,
        unreadable: None,
    }
}

fn read_directory(path: &Path) -> Result<Option<Vec<CheckedDirEntry>>, String> {
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("cannot read directory: {error}")),
    };
    collect_entries(entries).map(Some)
}

#[tauri::command]
pub fn checked_path_exists(
    root_id: String,
    rel_path: String,
    state: tauri::State<'_, WriteRoots>,
) -> Result<bool, String> {
    exists_result(fs::metadata(registered_path(&state, &root_id, &rel_path)?))
}

#[tauri::command]
pub fn checked_read_text_file(
    root_id: String,
    rel_path: String,
    state: tauri::State<'_, WriteRoots>,
) -> Result<Option<String>, String> {
    read_text(&registered_path(&state, &root_id, &rel_path)?)
}

#[tauri::command]
pub async fn checked_read_dir(
    root_id: String,
    rel_path: String,
    state: tauri::State<'_, WriteRoots>,
) -> Result<Option<Vec<CheckedDirEntry>>, String> {
    let path = registered_path(&state, &root_id, &rel_path)?;
    tauri::async_runtime::spawn_blocking(move || read_directory(&path))
        .await.map_err(|error| format!("directory read failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_not_found_is_absence() {
        assert!(!exists_result(Err(io::Error::from(io::ErrorKind::NotFound))).unwrap());
        for kind in [
            io::ErrorKind::PermissionDenied,
            io::ErrorKind::Interrupted,
            io::ErrorKind::Other,
        ] {
            assert!(exists_result(Err(io::Error::from(kind))).is_err());
        }
    }

    #[test]
    fn complete_files_and_missing_entries_remain_distinguishable() {
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("Note.md");
        fs::write(&note, "The whole note.\n").unwrap();
        assert!(exists_result(fs::metadata(&note)).unwrap());
        assert_eq!(
            read_text(&note).unwrap().as_deref(),
            Some("The whole note.\n")
        );
        assert_eq!(read_text(&dir.path().join("missing.md")).unwrap(), None);
        assert!(read_directory(&dir.path().join("missing"))
            .unwrap()
            .is_none());
        let entries = read_directory(dir.path()).unwrap().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "Note.md");
        assert!(entries[0].is_file);
        let metadata = entries[0].metadata.as_ref().unwrap();
        assert_eq!(metadata.size, "The whole note.\n".len() as u64);
        assert_eq!(metadata.mtime, timestamp_ms(fs::metadata(&note).unwrap().modified()));
        assert!(read_directory(&note).is_err());
        assert!(read_text(dir.path()).is_err());
    }

    #[test]
    fn a_failed_iterator_entry_cannot_turn_into_a_partial_listing() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("visible.md"), "kept").unwrap();
        let entry = fs::read_dir(dir.path()).unwrap().next().unwrap().unwrap();
        let broken = vec![
            Ok(entry),
            Err(io::Error::from(io::ErrorKind::PermissionDenied)),
        ];
        assert!(collect_entries(broken.into_iter()).is_err());
    }

    #[test]
    fn one_uninspectable_entry_is_reported_on_that_entry_only() {
        // Issue #110: one entry the walker cannot inspect used to fail the whole
        // directory, and the index then kept every row under it forever.
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("visible.md"), "kept").unwrap();
        let file_type = fs::metadata(dir.path().join("visible.md")).unwrap().file_type();

        let broken_type = inspect_entry("odd.md".into(), Err(io::Error::from(io::ErrorKind::PermissionDenied)), || {
            fs::metadata(dir.path().join("visible.md"))
        });
        assert_eq!(broken_type.name, "odd.md");
        assert!(broken_type.unreadable.is_some());
        assert!(!broken_type.is_file && !broken_type.is_directory && !broken_type.is_symlink);

        let broken_metadata = inspect_entry("odd.md".into(), Ok(file_type), || {
            Err(io::Error::from(io::ErrorKind::PermissionDenied))
        });
        assert!(broken_metadata.unreadable.is_some());

        let fine = inspect_entry("visible.md".into(), Ok(file_type), || fs::metadata(dir.path().join("visible.md")));
        assert!(fine.unreadable.is_none());
        assert!(fine.is_file);
        assert_eq!(fine.metadata.as_ref().unwrap().size, 4);
    }

    #[cfg(unix)]
    #[test]
    fn a_name_that_is_not_utf8_is_reported_not_fatal() {
        use std::os::unix::ffi::OsStringExt;
        let raw = std::ffi::OsString::from_vec(vec![b'n', 0xff, b'.', b'm', b'd']);
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "x").unwrap();
        let file_type = fs::metadata(dir.path().join("a.md")).unwrap().file_type();
        let entry = inspect_entry(raw, Ok(file_type), || fs::metadata(dir.path().join("a.md")));
        assert!(entry.unreadable.is_some());
        assert!(entry.name.starts_with('n'));
    }

    #[test]
    fn a_healthy_listing_carries_no_unreadable_marker_on_the_wire() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Note.md"), "x").unwrap();
        let entries = read_directory(dir.path()).unwrap().unwrap();
        let json = serde_json::to_string(&entries).unwrap();
        assert!(!json.contains("unreadable"), "{json}");
    }

    #[test]
    fn invalid_text_is_an_error_not_a_missing_journal() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("journal.json");
        fs::write(&file, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_text(&file).is_err());
    }

    #[test]
    fn readers_stay_within_the_registered_lexical_root() {
        let dir = tempfile::tempdir().unwrap();
        let roots = WriteRoots::default();
        roots
            .0
            .lock()
            .unwrap()
            .insert("vault".into(), dir.path().to_path_buf());
        assert_eq!(registered_path(&roots, "vault", "").unwrap(), dir.path());
        assert!(registered_path(&roots, "unknown", "note.md").is_err());
        assert!(registered_path(&roots, "vault", "../outside.md").is_err());
        assert!(registered_path(&roots, "vault", "/outside.md").is_err());
    }
}
