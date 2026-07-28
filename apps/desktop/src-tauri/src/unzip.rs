//! Streaming ZIP extraction for the import wizard.
//!
//! The webview used to unpack archives with JSZip, which had three problems a
//! native extractor solves at once:
//!
//! 1. **Attachments were unreachable.** JSZip only decoded a fixed list of text
//!    extensions, so images, PDFs and every other attachment inside an export
//!    were dropped before an importer could ever see them.
//! 2. **The whole archive went through renderer memory.** A large Notion export
//!    could exhaust the webview.
//! 3. **No ceilings.** A zip bomb had nothing to run into.
//!
//! Here the archive is streamed entry by entry into a temp folder with hard
//! limits for a single entry and for the sum, symlink entries are skipped
//! rather than followed, and every entry path goes through the same
//! `validate_rel_path` guard the atomic writer uses.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::atomic_write::validate_rel_path;

/// Name of the folder under the OS temp dir that holds every extraction.
/// `discard_extracted_archive` refuses to delete anything outside it.
const EXTRACT_DIR_NAME: &str = "plainva-import";

const COPY_BUF: usize = 64 * 1024;

/// 1980-01-01T00:00:00Z — the zero of the DOS timestamp a ZIP entry carries.
const DOS_EPOCH_MS: i64 = 315_532_800_000;

/// Stable reason codes for a skipped entry.
///
/// The shell turns these into translated text, so they must stay machine
/// readable — prose here would end up untranslated in the user's language.
const SKIP_SYMLINK: &str = "symlink";
const SKIP_UNSAFE_PATH: &str = "unsafe_path";
const SKIP_TOO_LARGE: &str = "too_large";
const SKIP_UNREADABLE: &str = "unreadable";

/// Ceilings for one extraction run.
///
/// A notes export is text plus attachments; anything past these numbers is
/// either hostile or an archive Plainva could not index afterwards anyway.
#[derive(Clone, Copy, Debug)]
pub struct ExtractLimits {
    pub max_entry_bytes: u64,
    pub max_total_bytes: u64,
    pub max_entries: usize,
}

impl Default for ExtractLimits {
    fn default() -> Self {
        Self {
            max_entry_bytes: 512 * 1024 * 1024,
            max_total_bytes: 4 * 1024 * 1024 * 1024,
            max_entries: 200_000,
        }
    }
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct ExtractedEntry {
    /// Path relative to `root`, always with forward slashes.
    pub rel_path: String,
    pub size: u64,
    /// Entry timestamp in epoch milliseconds, when the archive carries one.
    pub modified_ms: Option<i64>,
}

/// Epoch milliseconds from a civil date, treated as UTC.
///
/// A ZIP entry stores a DOS timestamp, which has no time zone at all. Reading
/// it as UTC is the honest approximation: it can be off by the writer's offset,
/// but it puts a note in the right year and month instead of "today", which is
/// the whole point of carrying timestamps over.
fn epoch_ms_from_civil(year: i64, month: i64, day: i64, hour: i64, min: i64, sec: i64) -> i64 {
    // Howard Hinnant's days_from_civil.
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    (days * 86_400 + hour * 3_600 + min * 60 + sec) * 1_000
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct SkippedEntry {
    pub rel_path: String,
    pub reason: String,
}

#[derive(Serialize, Debug)]
pub struct ExtractResult {
    /// Absolute path of the folder the archive was extracted into.
    pub root: String,
    pub entries: Vec<ExtractedEntry>,
    pub skipped: Vec<SkippedEntry>,
    pub total_bytes: u64,
}

/// `S_IFLNK`. A symlink entry carries its link target as "content"; writing it
/// out and later following it would escape the extraction folder.
fn is_symlink_mode(mode: u32) -> bool {
    mode & 0o170000 == 0o120000
}

enum CopyStop {
    EntryTooLarge,
    TotalExceeded,
    Io,
}

/// Streams one entry to disk, enforcing both ceilings while it copies.
///
/// The limits are checked on the bytes actually read, not on the size the
/// archive claims — a zip bomb lies about that.
fn copy_entry(
    reader: &mut impl Read,
    target: &Path,
    max_entry_bytes: u64,
    remaining_total: u64,
) -> Result<u64, CopyStop> {
    let file = File::create(target).map_err(|_| CopyStop::Io)?;
    let mut out = BufWriter::new(file);
    let mut buf = vec![0u8; COPY_BUF];
    let mut written: u64 = 0;

    loop {
        let read = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => return Err(CopyStop::Io),
        };
        written += read as u64;
        if written > max_entry_bytes {
            return Err(CopyStop::EntryTooLarge);
        }
        if written > remaining_total {
            return Err(CopyStop::TotalExceeded);
        }
        out.write_all(&buf[..read]).map_err(|_| CopyStop::Io)?;
    }

    out.flush().map_err(|_| CopyStop::Io)?;
    Ok(written)
}

/// Extracts `archive_path` into `dest`.
///
/// Per-entry problems (oversized, symlink, unsafe path, unreadable) are
/// reported in `skipped` and the run continues — one odd entry must not cost
/// the user their whole import. Only a breached total limit or a structurally
/// unusable archive aborts.
pub(crate) fn extract_archive_sync(
    archive_path: &Path,
    dest: &Path,
    limits: ExtractLimits,
) -> Result<ExtractResult, String> {
    let file =
        File::open(archive_path).map_err(|e| format!("open {}: {e}", archive_path.display()))?;
    let mut archive =
        zip::ZipArchive::new(BufReader::new(file)).map_err(|e| format!("read archive: {e}"))?;

    if archive.len() > limits.max_entries {
        return Err(format!(
            "archive holds {} entries, more than the limit of {}",
            archive.len(),
            limits.max_entries
        ));
    }

    fs::create_dir_all(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    let canon_root =
        fs::canonicalize(dest).map_err(|e| format!("canonicalize {}: {e}", dest.display()))?;

    let mut entries: Vec<ExtractedEntry> = Vec::new();
    let mut skipped: Vec<SkippedEntry> = Vec::new();
    let mut verified_parents: HashSet<PathBuf> = HashSet::new();
    let mut total_bytes: u64 = 0;

    for index in 0..archive.len() {
        let mut entry = match archive.by_index(index) {
            Ok(e) => e,
            Err(_) => {
                skipped.push(SkippedEntry {
                    rel_path: format!("entry #{index}"),
                    reason: SKIP_UNREADABLE.into(),
                });
                continue;
            }
        };

        let raw_name = entry.name().to_string();
        if entry.is_dir() {
            continue;
        }

        let modified_ms = entry
            .last_modified()
            .map(|d| {
                epoch_ms_from_civil(
                    d.year() as i64,
                    d.month() as i64,
                    d.day() as i64,
                    d.hour() as i64,
                    d.minute() as i64,
                    d.second() as i64,
                )
            })
            // A DOS timestamp cannot express "unset", so writers that have no
            // date store the format's zero, 1980-01-01. Passing that on would
            // date every note in such an archive to 1980 — worse than
            // admitting we do not know.
            .filter(|ms| *ms != DOS_EPOCH_MS);

        if entry.unix_mode().is_some_and(is_symlink_mode) {
            skipped.push(SkippedEntry {
                rel_path: raw_name,
                reason: SKIP_SYMLINK.into(),
            });
            continue;
        }

        let rel = match validate_rel_path(&raw_name) {
            Ok(p) => p,
            Err(_) => {
                skipped.push(SkippedEntry {
                    rel_path: raw_name,
                    reason: SKIP_UNSAFE_PATH.into(),
                });
                continue;
            }
        };

        let target = dest.join(&rel);

        // Second line of defence, same as the atomic writer: after the parent
        // exists, canonicalize it and prove it still sits under the root. This
        // catches an entry that resolves through a symlinked folder.
        if let Some(parent) = target.parent() {
            if !verified_parents.contains(parent) {
                if fs::create_dir_all(parent).is_err() {
                    skipped.push(SkippedEntry {
                        rel_path: raw_name,
                        reason: SKIP_UNSAFE_PATH.into(),
                    });
                    continue;
                }
                match fs::canonicalize(parent) {
                    Ok(canon_parent) if canon_parent.starts_with(&canon_root) => {
                        verified_parents.insert(parent.to_path_buf());
                    }
                    _ => {
                        skipped.push(SkippedEntry {
                            rel_path: raw_name,
                            reason: SKIP_UNSAFE_PATH.into(),
                        });
                        continue;
                    }
                }
            }
        }

        let remaining = limits.max_total_bytes.saturating_sub(total_bytes);
        match copy_entry(&mut entry, &target, limits.max_entry_bytes, remaining) {
            Ok(written) => {
                total_bytes += written;
                entries.push(ExtractedEntry {
                    rel_path: rel.to_string_lossy().replace('\\', "/"),
                    size: written,
                    modified_ms,
                });
            }
            Err(CopyStop::EntryTooLarge) => {
                let _ = fs::remove_file(&target);
                skipped.push(SkippedEntry {
                    rel_path: raw_name,
                    reason: SKIP_TOO_LARGE.into(),
                });
            }
            Err(CopyStop::TotalExceeded) => {
                let _ = fs::remove_file(&target);
                return Err(format!(
                    "archive expands beyond the total limit of {} bytes",
                    limits.max_total_bytes
                ));
            }
            Err(CopyStop::Io) => {
                let _ = fs::remove_file(&target);
                skipped.push(SkippedEntry {
                    rel_path: raw_name,
                    reason: SKIP_UNREADABLE.into(),
                });
            }
        }
    }

    Ok(ExtractResult {
        root: dest.to_string_lossy().to_string(),
        entries,
        skipped,
        total_bytes,
    })
}

/// Creates a fresh folder under `<temp>/plainva-import/` for one extraction.
fn make_extract_dir() -> Result<PathBuf, String> {
    let base = std::env::temp_dir().join(EXTRACT_DIR_NAME);
    fs::create_dir_all(&base).map_err(|e| format!("create {}: {e}", base.display()))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("clock: {e}"))?;
    let dir = base.join(format!("{}-{}", stamp.as_nanos(), std::process::id()));
    fs::create_dir(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    Ok(dir)
}

#[tauri::command]
pub async fn extract_archive(archive_path: String) -> Result<ExtractResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dest = make_extract_dir()?;
        match extract_archive_sync(Path::new(&archive_path), &dest, ExtractLimits::default()) {
            Ok(result) => Ok(result),
            Err(err) => {
                // An aborted run leaves nothing behind.
                let _ = fs::remove_dir_all(&dest);
                Err(err)
            }
        }
    })
    .await
    .map_err(|e| format!("extract task failed: {e}"))?
}

/// Removes one extraction folder again. Refuses any path that is not inside
/// `<temp>/plainva-import/`, so a wrong argument cannot delete user data.
#[tauri::command]
pub fn discard_extracted_archive(root: String) -> Result<(), String> {
    let target = PathBuf::from(&root);
    if !target.exists() {
        return Ok(());
    }

    let canon = fs::canonicalize(&target).map_err(|e| format!("canonicalize {root}: {e}"))?;
    let base = std::env::temp_dir().join(EXTRACT_DIR_NAME);
    let canon_base = match fs::canonicalize(&base) {
        Ok(b) => b,
        Err(_) => return Ok(()),
    };

    if canon == canon_base || !canon.starts_with(&canon_base) {
        return Err("refusing to remove a path outside the extraction folder".into());
    }

    fs::remove_dir_all(&canon).map_err(|e| format!("remove {}: {e}", canon.display()))
}

#[cfg(test)]
mod unzip_tests {
    use super::*;

    fn write_archive(dir: &Path, entries: &[(&str, &[u8], Option<u32>)]) -> PathBuf {
        let path = dir.join("source.zip");
        let file = File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(BufWriter::new(file));
        for (name, bytes, mode) in entries {
            let mut options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            if let Some(m) = mode {
                options = options.unix_permissions(*m);
            }
            zip.start_file(*name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for &byte in data {
            crc ^= byte as u32;
            for _ in 0..8 {
                let mask = (crc & 1).wrapping_neg();
                crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
            }
        }
        !crc
    }

    /// Builds a ZIP by hand so its entries claim a Unix host and carry real
    /// `st_mode` bits.
    ///
    /// The `zip` crate's writer stamps the host of the build machine, so an
    /// archive written on Windows always reads back as DOS and can never
    /// describe a symlink — which is precisely the case this guard exists for.
    /// Symlink entries reach users from macOS and Linux exports, so the test
    /// has to produce that shape regardless of where it runs.
    fn unix_archive(dir: &Path, entries: &[(&str, &[u8], u32)]) -> PathBuf {
        let mut out: Vec<u8> = Vec::new();
        let mut central: Vec<u8> = Vec::new();

        for (name, data, mode) in entries {
            let offset = out.len() as u32;
            let crc = crc32(data);
            let raw = name.as_bytes();
            let size = data.len() as u32;

            out.extend_from_slice(&0x0403_4b50u32.to_le_bytes()); // local header
            out.extend_from_slice(&10u16.to_le_bytes()); // version needed
            out.extend_from_slice(&0u16.to_le_bytes()); // flags
            out.extend_from_slice(&0u16.to_le_bytes()); // stored
            out.extend_from_slice(&0u16.to_le_bytes()); // time
            out.extend_from_slice(&0u16.to_le_bytes()); // date
            out.extend_from_slice(&crc.to_le_bytes());
            out.extend_from_slice(&size.to_le_bytes());
            out.extend_from_slice(&size.to_le_bytes());
            out.extend_from_slice(&(raw.len() as u16).to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes()); // extra len
            out.extend_from_slice(raw);
            out.extend_from_slice(data);

            central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
            central.extend_from_slice(&(((3u16) << 8) | 20).to_le_bytes()); // host 3 = Unix
            central.extend_from_slice(&10u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes());
            central.extend_from_slice(&crc.to_le_bytes());
            central.extend_from_slice(&size.to_le_bytes());
            central.extend_from_slice(&size.to_le_bytes());
            central.extend_from_slice(&(raw.len() as u16).to_le_bytes());
            central.extend_from_slice(&0u16.to_le_bytes()); // extra
            central.extend_from_slice(&0u16.to_le_bytes()); // comment
            central.extend_from_slice(&0u16.to_le_bytes()); // disk start
            central.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
            central.extend_from_slice(&(mode << 16).to_le_bytes()); // external attrs
            central.extend_from_slice(&offset.to_le_bytes());
            central.extend_from_slice(raw);
        }

        let cd_offset = out.len() as u32;
        let cd_size = central.len() as u32;
        let count = entries.len() as u16;
        out.extend_from_slice(&central);
        out.extend_from_slice(&0x0605_4b50u32.to_le_bytes()); // end of central directory
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
        out.extend_from_slice(&count.to_le_bytes());
        out.extend_from_slice(&cd_size.to_le_bytes());
        out.extend_from_slice(&cd_offset.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // comment len

        let path = dir.join("unix.zip");
        fs::write(&path, &out).unwrap();
        path
    }

    fn small_limits() -> ExtractLimits {
        ExtractLimits {
            max_entry_bytes: 32,
            max_total_bytes: 128,
            max_entries: 16,
        }
    }

    #[test]
    fn extracts_every_file_type_including_binary() {
        let tmp = tempfile::tempdir().unwrap();
        let png: Vec<u8> = vec![0x89, 0x50, 0x4E, 0x47, 0x00, 0xFF, 0x1A, 0x0A];
        let archive = write_archive(
            tmp.path(),
            &[
                ("note.md", b"# Hello", None),
                ("assets/logo.png", &png, None),
            ],
        );
        let dest = tmp.path().join("out");

        let result = extract_archive_sync(&archive, &dest, ExtractLimits::default()).unwrap();

        assert!(result.skipped.is_empty(), "{:?}", result.skipped);
        let mut names: Vec<&str> = result.entries.iter().map(|e| e.rel_path.as_str()).collect();
        names.sort();
        assert_eq!(names, vec!["assets/logo.png", "note.md"]);

        // The binary arrives byte-identical — that is the whole point of the
        // move away from JSZip, which decoded text only.
        assert_eq!(fs::read(dest.join("assets/logo.png")).unwrap(), png);
        assert_eq!(fs::read_to_string(dest.join("note.md")).unwrap(), "# Hello");
        assert_eq!(result.total_bytes, (png.len() + 7) as u64);
    }

    #[test]
    fn skips_an_entry_over_the_single_file_limit() {
        let tmp = tempfile::tempdir().unwrap();
        let big = vec![b'x'; 200];
        let archive = write_archive(
            tmp.path(),
            &[("big.bin", &big, None), ("small.md", b"ok", None)],
        );
        let dest = tmp.path().join("out");

        let result = extract_archive_sync(&archive, &dest, small_limits()).unwrap();

        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].rel_path, "small.md");
        assert_eq!(result.skipped.len(), 1);
        assert_eq!(result.skipped[0].rel_path, "big.bin");
        assert_eq!(result.skipped[0].reason, SKIP_TOO_LARGE);
        assert!(!dest.join("big.bin").exists(), "partial file left behind");
    }

    #[test]
    fn stops_when_the_archive_exceeds_the_total_limit() {
        let tmp = tempfile::tempdir().unwrap();
        let chunk = vec![b'y'; 30];
        let archive = write_archive(
            tmp.path(),
            &[
                ("a.bin", &chunk, None),
                ("b.bin", &chunk, None),
                ("c.bin", &chunk, None),
                ("d.bin", &chunk, None),
                ("e.bin", &chunk, None),
            ],
        );
        let dest = tmp.path().join("out");

        let err = extract_archive_sync(&archive, &dest, small_limits()).unwrap_err();

        assert!(err.contains("total limit"), "{err}");
    }

    #[test]
    fn rejects_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = write_archive(
            tmp.path(),
            &[
                ("../escape.md", b"nope", None),
                ("nested/../../escape2.md", b"nope", None),
                ("fine.md", b"yes", None),
            ],
        );
        let dest = tmp.path().join("out");

        let result = extract_archive_sync(&archive, &dest, ExtractLimits::default()).unwrap();

        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].rel_path, "fine.md");
        assert_eq!(result.skipped.len(), 2);
        assert!(result.skipped.iter().all(|s| s.reason == SKIP_UNSAFE_PATH));
        assert!(!tmp.path().join("escape.md").exists());
        assert!(!tmp.path().join("escape2.md").exists());
    }

    #[test]
    fn skips_symlink_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let archive = unix_archive(
            tmp.path(),
            &[
                ("link", b"/etc/passwd", 0o120777),
                ("real.md", b"content", 0o100644),
            ],
        );
        let dest = tmp.path().join("out");

        let result = extract_archive_sync(&archive, &dest, ExtractLimits::default()).unwrap();

        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].rel_path, "real.md");
        assert_eq!(result.skipped.len(), 1);
        assert_eq!(result.skipped[0].rel_path, "link");
        assert_eq!(result.skipped[0].reason, SKIP_SYMLINK);
        assert!(!dest.join("link").exists());
    }

    #[test]
    fn rejects_an_archive_with_too_many_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let entries: Vec<(String, Vec<u8>)> = (0..20)
            .map(|i| (format!("n{i}.md"), b"x".to_vec()))
            .collect();
        let refs: Vec<(&str, &[u8], Option<u32>)> = entries
            .iter()
            .map(|(n, b)| (n.as_str(), b.as_slice(), None))
            .collect();
        let archive = write_archive(tmp.path(), &refs);
        let dest = tmp.path().join("out");

        let err = extract_archive_sync(&archive, &dest, small_limits()).unwrap_err();

        assert!(err.contains("more than the limit"), "{err}");
    }

    #[test]
    fn carries_the_entry_timestamp_across() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("dated.zip");
        let file = File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(BufWriter::new(file));
        let stamp = zip::DateTime::from_date_and_time(2019, 3, 14, 9, 26, 52).unwrap();
        zip.start_file(
            "note.md",
            zip::write::SimpleFileOptions::default().last_modified_time(stamp),
        )
        .unwrap();
        zip.write_all(b"# Hi").unwrap();
        zip.finish().unwrap();
        let dest = tmp.path().join("out");

        let result = extract_archive_sync(&path, &dest, ExtractLimits::default()).unwrap();

        // DOS stamps have two-second resolution, hence :52 rather than :53.
        assert_eq!(result.entries[0].modified_ms, Some(1_552_555_612_000));
    }

    #[test]
    fn reads_the_dos_zero_date_as_no_timestamp() {
        let tmp = tempfile::tempdir().unwrap();
        // SimpleFileOptions::default() leaves the DOS zero, 1980-01-01 — which
        // means "unset", not "written in 1980".
        let archive = write_archive(tmp.path(), &[("note.md", b"# Hi", None)]);
        let dest = tmp.path().join("out");

        let result = extract_archive_sync(&archive, &dest, ExtractLimits::default()).unwrap();

        assert_eq!(result.entries[0].modified_ms, None);
    }

    #[test]
    fn converts_civil_dates_to_epoch_millis() {
        assert_eq!(epoch_ms_from_civil(1970, 1, 1, 0, 0, 0), 0);
        // 2019-03-14T09:26:53Z
        assert_eq!(
            epoch_ms_from_civil(2019, 3, 14, 9, 26, 53),
            1_552_555_613_000
        );
        // A leap day, the case an off-by-one in the civil algorithm would hit.
        assert_eq!(epoch_ms_from_civil(2024, 2, 29, 0, 0, 0), 1_709_164_800_000);
    }

    #[test]
    fn classifies_unix_modes() {
        assert!(is_symlink_mode(0o120777));
        assert!(!is_symlink_mode(0o100644));
        assert!(!is_symlink_mode(0o040755));
    }

    #[test]
    fn discard_refuses_paths_outside_the_extraction_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let victim = tmp.path().join("vault");
        fs::create_dir_all(&victim).unwrap();

        let err = discard_extracted_archive(victim.to_string_lossy().to_string()).unwrap_err();

        assert!(err.contains("refusing"), "{err}");
        assert!(victim.exists(), "the guard must not have deleted anything");
    }

    #[test]
    fn discard_removes_its_own_extraction_folder() {
        let dir = make_extract_dir().unwrap();
        fs::write(dir.join("a.md"), "x").unwrap();

        discard_extracted_archive(dir.to_string_lossy().to_string()).unwrap();

        assert!(!dir.exists());
    }
}
