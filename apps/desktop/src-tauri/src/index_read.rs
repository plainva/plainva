//! Reads a group of vault files for a pass of the index in one call.
//!
//! The full scan read one file per bridge call — three calls for a note (two
//! path calls and the read) — and hashed it in JavaScript; an attachment went
//! over the bridge whole only to be hashed. Here a group of files is read and
//! hashed in Rust, a few files at a time on blocking threads, and a note comes
//! back with its text and the hash of its bytes, an attachment with its hash
//! alone (streamed, never held whole).
//!
//! Only the plain case is answered. Everything else is `fallback` and goes the
//! ordinary way in JavaScript, which knows what to make of it: a path that is
//! gone, a file that cannot be read (left out and named), a "text" file whose
//! bytes are not UTF-8 (read as bytes and decoded there). One file that fails
//! is a fallback for that file alone; the rest of the group is answered.
//!
//! Each path is looked up in the registry of read roots as its read begins,
//! not when the call arrives: once the vault is closed (its root taken out of
//! the registry), nothing more of the group is read.

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::atomic_write::WriteRoots;
use crate::checked_fs::registered_path;

/// At most this many files of one group are read at the same time.
const READERS: usize = 8;
/// At most this many files in one call; the caller groups by bytes as well.
const MAX_REQUESTS: usize = 256;
const STREAM_BUFFER_BYTES: usize = 64 * 1024;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IndexReadRequest {
    rel_path: String,
    text: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IndexReadResult {
    Text { text: String, sha256: String },
    Bytes { sha256: String },
    Fallback,
}

fn to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

fn read_one(path: Option<PathBuf>, text: bool) -> IndexReadResult {
    let Some(path) = path else { return IndexReadResult::Fallback };
    if text {
        let Ok(bytes) = std::fs::read(&path) else { return IndexReadResult::Fallback };
        let sha256 = to_hex(&Sha256::digest(&bytes));
        return match String::from_utf8(bytes) {
            Ok(text) => IndexReadResult::Text { text, sha256 },
            Err(_) => IndexReadResult::Fallback,
        };
    }
    let Ok(file) = File::open(&path) else { return IndexReadResult::Fallback };
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; STREAM_BUFFER_BYTES];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => hasher.update(&buffer[..read]),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return IndexReadResult::Fallback,
        }
    }
    IndexReadResult::Bytes { sha256: to_hex(&hasher.finalize()) }
}

/// Reads every request, `READERS` at a time, and answers in the order asked.
/// `resolve` names where a request is on disk as its read begins (None: read
/// nowhere, the ordinary read answers).
fn read_all<F>(requests: Vec<IndexReadRequest>, resolve: F) -> Vec<IndexReadResult>
where
    F: Fn(&IndexReadRequest) -> Option<PathBuf> + Sync,
{
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    let next = AtomicUsize::new(0);
    let slots: Vec<Mutex<Option<IndexReadResult>>> = (0..requests.len()).map(|_| Mutex::new(None)).collect();
    std::thread::scope(|scope| {
        for _ in 0..READERS.min(requests.len()) {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(request) = requests.get(i) else { break };
                let result = read_one(resolve(request), request.text);
                if let Ok(mut slot) = slots[i].lock() {
                    *slot = Some(result);
                }
            });
        }
    });
    // A slot no reader filled (a poisoned lock) is a file the ordinary read answers.
    slots
        .into_iter()
        .map(|slot| slot.into_inner().ok().flatten().unwrap_or(IndexReadResult::Fallback))
        .collect()
}

/// Where a request is on disk. A path the registry or the lexical rules
/// refuse — a root that is not (or no longer) registered after a vault closed,
/// a parent segment, an absolute path, the root itself — is read nowhere: the
/// ordinary read gives that refusal its own words.
fn resolve_request(roots: &WriteRoots, root_id: &str, request: &IndexReadRequest) -> Option<PathBuf> {
    if request.rel_path.is_empty() {
        return None;
    }
    registered_path(roots, root_id, &request.rel_path).ok()
}

/// Reads a group of files below one registered root, looking the root up
/// anew for each file. `begin` hears of each file as its read begins, before
/// the lookup (the command passes nothing; the tests close the vault there).
fn read_group<B>(roots: &WriteRoots, root_id: &str, files: Vec<IndexReadRequest>, begin: B) -> Vec<IndexReadResult>
where
    B: Fn(&IndexReadRequest) + Sync,
{
    read_all(files, |request| {
        begin(request);
        resolve_request(roots, root_id, request)
    })
}

#[tauri::command]
pub async fn read_files_for_index(
    root_id: String,
    files: Vec<IndexReadRequest>,
    app: tauri::AppHandle,
) -> Result<Vec<IndexReadResult>, String> {
    use tauri::Manager;
    if files.len() > MAX_REQUESTS {
        return Err(format!("at most {MAX_REQUESTS} files in one call"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let roots = app.state::<WriteRoots>();
        read_group(&roots, &root_id, files, |_| {})
    })
        .await
        .map_err(|error| format!("index read failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("plainva-index-read-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(dir: &std::path::Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        File::create(&path).unwrap().write_all(bytes).unwrap();
        path
    }

    fn ask(rel: &str, text: bool) -> IndexReadRequest {
        IndexReadRequest { rel_path: rel.into(), text }
    }

    fn roots_at(dir: &std::path::Path) -> WriteRoots {
        let roots = WriteRoots::default();
        roots.0.lock().unwrap().insert("root".into(), dir.to_path_buf());
        roots
    }

    #[test]
    fn answers_text_bytes_and_fallback_in_the_order_asked() {
        let dir = scratch("order");
        write(&dir, "a.md", "\u{feff}# Title\nbody".as_bytes());
        write(&dir, "b.png", &[0u8, 159, 146, 150]);
        write(&dir, "c.csv", &[0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]);
        let roots = roots_at(&dir);
        let results = read_all(
            vec![ask("a.md", true), ask("b.png", false), ask("c.csv", true), ask("gone.md", true), ask("", true), ask("b.png", true)],
            |request| resolve_request(&roots, "root", request),
        );
        assert_eq!(
            results[0],
            IndexReadResult::Text {
                text: "\u{feff}# Title\nbody".into(),
                sha256: to_hex(&Sha256::digest("\u{feff}# Title\nbody".as_bytes())),
            }
        );
        assert_eq!(results[1], IndexReadResult::Bytes { sha256: to_hex(&Sha256::digest([0u8, 159, 146, 150])) });
        // Not UTF-8, gone, refused, an image asked for as text: the ordinary read decides, for that file alone.
        assert_eq!(results[2], IndexReadResult::Fallback);
        assert_eq!(results[3], IndexReadResult::Fallback);
        assert_eq!(results[4], IndexReadResult::Fallback);
        assert_eq!(results[5], IndexReadResult::Fallback);
    }

    #[test]
    fn a_large_group_keeps_its_order_across_the_readers() {
        let dir = scratch("many");
        for i in 0..100 {
            write(&dir, &format!("{i}.md"), format!("note {i}").as_bytes());
        }
        let roots = roots_at(&dir);
        let results = read_all((0..100).map(|i| ask(&format!("{i}.md"), true)).collect(), |request| resolve_request(&roots, "root", request));
        for (i, result) in results.iter().enumerate() {
            match result {
                IndexReadResult::Text { text, .. } => assert_eq!(text, &format!("note {i}")),
                other => panic!("{i}: {other:?}"),
            }
        }
    }

    #[test]
    fn a_streamed_hash_is_the_hash_of_the_whole_file() {
        let dir = scratch("stream");
        let bytes: Vec<u8> = (0..(STREAM_BUFFER_BYTES * 3 + 17)).map(|i| (i % 251) as u8).collect();
        write(&dir, "big.bin", &bytes);
        let roots = roots_at(&dir);
        assert_eq!(
            read_all(vec![ask("big.bin", false)], |request| resolve_request(&roots, "root", request))[0],
            IndexReadResult::Bytes { sha256: to_hex(&Sha256::digest(&bytes)) }
        );
    }

    #[test]
    fn refused_and_unregistered_paths_are_read_nowhere() {
        let dir = scratch("roots");
        write(&dir, "a.md", b"# A");
        let roots = roots_at(&dir);
        assert_eq!(resolve_request(&roots, "root", &ask("a.md", true)), Some(dir.join("a.md")));
        assert_eq!(resolve_request(&roots, "root", &ask("../outside.md", true)), None);
        assert_eq!(resolve_request(&roots, "root", &ask("", true)), None);
        assert_eq!(resolve_request(&roots, "root", &ask("/abs.md", true)), None);
        // A root that was never registered, or no longer is after its vault closed.
        assert_eq!(resolve_request(&roots, "closed-root", &ask("a.md", true)), None);
    }

    #[test]
    fn a_vault_closed_during_the_call_is_read_no_further() {
        let dir = scratch("closed");
        for i in 0..64 {
            write(&dir, &format!("{i}.md"), format!("note {i}").as_bytes());
        }
        let roots = roots_at(&dir);
        // The vault closes as the second file begins, and every later beginning
        // waits on the same lock until the close is done: no reader takes another
        // file before it, however the threads are scheduled. Only the first file
        // may have found the root.
        let begun = std::sync::Mutex::new(0usize);
        let results = read_group(&roots, "root", (0..64).map(|i| ask(&format!("{i}.md"), true)).collect(), |_| {
            let mut begun = begun.lock().unwrap();
            *begun += 1;
            if *begun == 2 {
                roots.0.lock().unwrap().remove("root");
            }
        });
        let read = results.iter().filter(|result| matches!(result, IndexReadResult::Text { .. })).count();
        assert!(read <= 1, "{read} files were read after the vault closed");
        assert_eq!(*begun.lock().unwrap(), 64);
        assert_eq!(results.len(), 64);
    }

    #[test]
    fn the_wire_form_names_its_kind() {
        let json = serde_json::to_string(&IndexReadResult::Bytes { sha256: "ab".into() }).unwrap();
        assert_eq!(json, r#"{"kind":"bytes","sha256":"ab"}"#);
        assert_eq!(serde_json::to_string(&IndexReadResult::Fallback).unwrap(), r#"{"kind":"fallback"}"#);
    }
}
