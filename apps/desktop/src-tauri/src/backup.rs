// Vault ZIP backup (Gesamtplan Backups & Versionierung 2026-07-05, P3).
//
// The frontend owns filename, destination resolution, rotation and lastRun
// bookkeeping; this command only walks the vault and writes one archive.
// Work runs on a blocking thread; per-file read errors (locked/vanished
// files) are collected in `skipped` instead of failing the run.

use std::fs::{self, File};
use std::io::{self, BufWriter};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tauri::Emitter;

#[derive(serde::Serialize, Clone)]
pub struct ZipProgress {
    pub done: u64,
    pub total: u64,
}

#[derive(serde::Serialize)]
pub struct ZipBackupResult {
    pub zip_path: String,
    pub file_count: u64,
    pub total_bytes: u64,
    pub skipped: Vec<String>,
}

/// Collects (absolute, zip-entry-name) pairs under `root`. Directories whose
/// NAME matches an exclude are pruned at any depth; symlinks are never
/// followed; everything under `skip_subtree` (the destination folder, when it
/// lies inside the vault) is pruned so the archive never contains itself.
fn collect_files(
    root: &Path,
    exclude_dir_names: &[String],
    skip_subtree: Option<&Path>,
) -> Result<Vec<(PathBuf, String)>, String> {
    let mut out = Vec::new();
    let walker = walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            if e.path_is_symlink() {
                return false;
            }
            if let Some(skip) = skip_subtree {
                if e.path() == skip {
                    return false;
                }
            }
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                if exclude_dir_names.iter().any(|x| x.as_str() == name) {
                    return false;
                }
            }
            true
        });

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue, // vanished during the walk
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let rel = match entry.path().strip_prefix(root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let name = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        if name.is_empty() {
            continue;
        }
        out.push((entry.path().to_path_buf(), name));
    }
    Ok(out)
}

/// Streams the collected files into a zip at `out_path`. Returns
/// (file_count, total_input_bytes, skipped_entry_names).
fn zip_files(
    files: &[(PathBuf, String)],
    out_path: &Path,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<(u64, u64, Vec<String>), String> {
    let file = File::create(out_path).map_err(|e| format!("create {}: {e}", out_path.display()))?;
    let mut zip = zip::ZipWriter::new(BufWriter::new(file));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);

    let total = files.len() as u64;
    let mut file_count = 0u64;
    let mut total_bytes = 0u64;
    let mut skipped: Vec<String> = Vec::new();

    for (abs, name) in files {
        let mut src = match File::open(abs) {
            Ok(f) => f,
            Err(_) => {
                skipped.push(name.clone());
                on_progress(file_count + skipped.len() as u64, total);
                continue;
            }
        };
        zip.start_file(name.as_str(), options)
            .map_err(|e| format!("zip entry {name}: {e}"))?;
        match io::copy(&mut src, &mut zip) {
            Ok(n) => {
                total_bytes += n;
                file_count += 1;
            }
            Err(_) => {
                // Discard the partially written entry; the archive stays valid.
                let _ = zip.abort_file();
                skipped.push(name.clone());
            }
        }
        on_progress(file_count + skipped.len() as u64, total);
    }

    zip.finish().map_err(|e| format!("finish zip: {e}"))?;
    Ok((file_count, total_bytes, skipped))
}

fn create_vault_zip_sync(
    vault_path: &str,
    dest_path: &str,
    exclude_dir_names: &[String],
    mut on_progress: impl FnMut(u64, u64),
) -> Result<ZipBackupResult, String> {
    // canonicalize yields the \\?\ extended-length form on Windows, lifting the
    // 260-char path limit for the whole walk (also covers UNC shares).
    let root = fs::canonicalize(vault_path).map_err(|e| format!("vault path: {e}"))?;
    let dest = PathBuf::from(dest_path);
    let dest_parent = dest
        .parent()
        .ok_or_else(|| "destination has no parent directory".to_string())?;
    let dest_parent = fs::canonicalize(dest_parent).map_err(|e| format!("destination dir: {e}"))?;
    let file_name = dest
        .file_name()
        .ok_or_else(|| "destination has no file name".to_string())?;
    let final_path = dest_parent.join(file_name);
    let part_path = dest_parent.join(format!("{}.part", file_name.to_string_lossy()));

    let skip_subtree = dest_parent.starts_with(&root).then_some(dest_parent.as_path());
    let files = collect_files(&root, exclude_dir_names, skip_subtree)?;

    let result = zip_files(&files, &part_path, &mut on_progress);
    match result {
        Ok((file_count, total_bytes, skipped)) => {
            if final_path.exists() {
                let _ = fs::remove_file(&final_path);
            }
            fs::rename(&part_path, &final_path)
                .map_err(|e| format!("finalize {}: {e}", final_path.display()))?;
            Ok(ZipBackupResult {
                zip_path: dest_path.to_string(),
                file_count,
                total_bytes,
                skipped,
            })
        }
        Err(e) => {
            let _ = fs::remove_file(&part_path);
            Err(e)
        }
    }
}

/// Creates a ZIP backup of the vault at `dest_path` (full path incl. filename;
/// the parent directory must already exist). Emits throttled
/// `plainva-backup-zip-progress` events while running.
#[tauri::command]
pub async fn create_vault_zip(
    app: tauri::AppHandle,
    vault_path: String,
    dest_path: String,
    exclude_dir_names: Vec<String>,
) -> Result<ZipBackupResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut last_emit = Instant::now();
        let mut last_done = 0u64;
        create_vault_zip_sync(&vault_path, &dest_path, &exclude_dir_names, |done, total| {
            if done == total || done - last_done >= 100 || last_emit.elapsed() >= Duration::from_millis(500) {
                last_done = done;
                last_emit = Instant::now();
                let _ = app.emit("plainva-backup-zip-progress", ZipProgress { done, total });
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn write(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }

    fn default_excludes() -> Vec<String> {
        vec![
            ".plainva".to_string(),
            ".git".to_string(),
            ".trash".to_string(),
            "node_modules".to_string(),
        ]
    }

    #[test]
    fn collect_skips_excluded_dirs_at_any_depth() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        write(&root, "a.md", "a");
        write(&root, "sub/b.md", "b");
        write(&root, ".plainva/backups/x.md.123.bak", "bak");
        write(&root, ".git/config", "git");
        write(&root, ".trash/t.md", "t");
        write(&root, "deep/node_modules/m.js", "js");
        write(&root, "deep/keep.md", "k");
        write(&root, ".obsidian/app.json", "{}"); // NOT excluded: user config belongs in the backup

        let mut names: Vec<String> = collect_files(&root, &default_excludes(), None)
            .unwrap()
            .into_iter()
            .map(|(_, n)| n)
            .collect();
        names.sort();
        assert_eq!(names, vec![".obsidian/app.json", "a.md", "deep/keep.md", "sub/b.md"]);
    }

    #[test]
    fn collect_skips_destination_subtree_inside_vault() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        write(&root, "a.md", "a");
        write(&root, "backups_out/old.zip", "zip");
        let skip = root.join("backups_out");

        let names: Vec<String> = collect_files(&root, &default_excludes(), Some(skip.as_path()))
            .unwrap()
            .into_iter()
            .map(|(_, n)| n)
            .collect();
        assert_eq!(names, vec!["a.md"]);
    }

    #[test]
    fn zip_roundtrip_preserves_contents_and_excludes() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        write(&root, "Notizen/Übung äöü.md", "umlaut content");
        write(&root, "a.md", "hello");
        write(&root, ".plainva/vault.db", "sqlite");
        let out_dir = tempfile::tempdir().unwrap();
        let dest = out_dir.path().join("Vault_2026-07-05_10-00-00.zip");

        let result = create_vault_zip_sync(
            root.to_string_lossy().as_ref(),
            dest.to_string_lossy().as_ref(),
            &default_excludes(),
            |_, _| {},
        )
        .unwrap();
        assert_eq!(result.file_count, 2);
        assert!(result.skipped.is_empty());
        assert!(dest.exists());
        assert!(!out_dir.path().join("Vault_2026-07-05_10-00-00.zip.part").exists());

        let mut archive = zip::ZipArchive::new(File::open(&dest).unwrap()).unwrap();
        let mut names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        names.sort();
        assert_eq!(names, vec!["Notizen/Übung äöü.md", "a.md"]);
        let mut content = String::new();
        archive.by_name("a.md").unwrap().read_to_string(&mut content).unwrap();
        assert_eq!(content, "hello");
    }

    #[test]
    fn zip_handles_long_paths_on_windows() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap(); // \\?\ form lifts MAX_PATH
        let mut deep = root.clone();
        for i in 0..30 {
            deep = deep.join(format!("langer-ordnername-{i:02}"));
        }
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("tief.md"), "deep").unwrap();
        assert!(deep.join("tief.md").to_string_lossy().len() > 260);

        let out_dir = tempfile::tempdir().unwrap();
        let dest = out_dir.path().join("deep.zip");
        let result = create_vault_zip_sync(
            root.to_string_lossy().as_ref(),
            dest.to_string_lossy().as_ref(),
            &default_excludes(),
            |_, _| {},
        )
        .unwrap();
        assert_eq!(result.file_count, 1);
    }

    #[test]
    fn unreadable_files_land_in_skipped() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        write(&root, "ok.md", "ok");
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("x.zip");

        // Feed a nonexistent file directly into the zip stage.
        let files = vec![
            (root.join("ok.md"), "ok.md".to_string()),
            (root.join("missing.md"), "missing.md".to_string()),
        ];
        let (count, _, skipped) = zip_files(&files, &dest, |_, _| {}).unwrap();
        assert_eq!(count, 1);
        assert_eq!(skipped, vec!["missing.md".to_string()]);
    }

    #[test]
    fn reports_progress_with_total() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        write(&root, "a.md", "a");
        write(&root, "b.md", "b");
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("p.zip");

        let mut seen: Vec<(u64, u64)> = Vec::new();
        create_vault_zip_sync(
            root.to_string_lossy().as_ref(),
            dest.to_string_lossy().as_ref(),
            &default_excludes(),
            |done, total| seen.push((done, total)),
        )
        .unwrap();
        assert_eq!(seen.last(), Some(&(2, 2)));
    }
}
