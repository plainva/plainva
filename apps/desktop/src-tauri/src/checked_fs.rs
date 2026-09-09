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
}

fn registered_path(roots: &WriteRoots, root_id: &str, relative: &str) -> Result<PathBuf, String> {
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

fn collect_entries(
    entries: impl Iterator<Item = io::Result<DirEntry>>,
) -> Result<Vec<CheckedDirEntry>, String> {
    entries
        .map(|entry| {
            let entry = entry.map_err(|error| format!("cannot read directory entry: {error}"))?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| "directory entry has an invalid filename".to_string())?;
            let kind = entry
                .file_type()
                .map_err(|error| format!("cannot inspect directory entry: {error}"))?;
            Ok(CheckedDirEntry {
                name,
                is_file: kind.is_file(),
                is_directory: kind.is_dir(),
                is_symlink: kind.is_symlink(),
            })
        })
        .collect()
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
pub fn checked_read_dir(
    root_id: String,
    rel_path: String,
    state: tauri::State<'_, WriteRoots>,
) -> Result<Option<Vec<CheckedDirEntry>>, String> {
    read_directory(&registered_path(&state, &root_id, &rel_path)?)
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
