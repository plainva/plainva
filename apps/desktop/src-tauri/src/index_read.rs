//! Reads many vault files for a pass of the index in one call (performance
//! plan L2, finding B3).
//!
//! The full scan read one file per bridge call — three calls for a note
//! (two path calls and the read) — and hashed it in JavaScript; an image went
//! over the bridge whole only to be hashed. Here a group of files is read and
//! hashed in Rust, a few files at a time on blocking threads, and a note comes
//! back with its text and the hash of its bytes, an attachment with its hash
//! alone (streamed, never held whole).
//!
//! Only the plain case is answered. Everything else is `fallback` and goes the
//! ordinary way in JavaScript, which knows what to make of it: a path that is
//! gone (its stored spelling, its existence check), a file that cannot be read
//! (left out and named), a "text" file whose bytes are not UTF-8 (read as
//! bytes and decoded there).

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

#[derive(Debug, Deserialize)]
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
fn read_all(requests: Vec<(Option<PathBuf>, bool)>) -> Vec<IndexReadResult> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    let next = AtomicUsize::new(0);
    let slots: Vec<Mutex<Option<IndexReadResult>>> = (0..requests.len()).map(|_| Mutex::new(None)).collect();
    std::thread::scope(|scope| {
        for _ in 0..READERS.min(requests.len()) {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some((path, text)) = requests.get(i) else { break };
                let result = read_one(path.clone(), *text);
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

#[tauri::command]
pub async fn read_files_for_index(
    root_id: String,
    files: Vec<IndexReadRequest>,
    state: tauri::State<'_, WriteRoots>,
) -> Result<Vec<IndexReadResult>, String> {
    if files.len() > MAX_REQUESTS {
        return Err(format!("at most {MAX_REQUESTS} files in one call"));
    }
    // A path the registry or the lexical rules refuse is read nowhere: the
    // ordinary read gives that refusal its own words.
    let requests: Vec<(Option<PathBuf>, bool)> = files
        .into_iter()
        .map(|request| {
            let path = if request.rel_path.is_empty() { None } else { registered_path(&state, &root_id, &request.rel_path).ok() };
            (path, request.text)
        })
        .collect();
    tauri::async_runtime::spawn_blocking(move || read_all(requests))
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

    #[test]
    fn answers_text_bytes_and_fallback_in_the_order_asked() {
        let dir = scratch("order");
        let note = write(&dir, "a.md", "\u{feff}# Title\nbody".as_bytes());
        let image = write(&dir, "b.png", &[0u8, 159, 146, 150]);
        let latin1 = write(&dir, "c.csv", &[0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]);
        let missing = dir.join("gone.md");
        let results = read_all(vec![
            (Some(note), true),
            (Some(image.clone()), false),
            (Some(latin1), true),
            (Some(missing), true),
            (None, true),
            (Some(image), true),
        ]);
        assert_eq!(
            results[0],
            IndexReadResult::Text {
                text: "\u{feff}# Title\nbody".into(),
                sha256: to_hex(&Sha256::digest("\u{feff}# Title\nbody".as_bytes())),
            }
        );
        assert_eq!(results[1], IndexReadResult::Bytes { sha256: to_hex(&Sha256::digest([0u8, 159, 146, 150])) });
        // Not UTF-8, gone, refused, an image asked for as text: the ordinary read decides.
        assert_eq!(results[2], IndexReadResult::Fallback);
        assert_eq!(results[3], IndexReadResult::Fallback);
        assert_eq!(results[4], IndexReadResult::Fallback);
        assert_eq!(results[5], IndexReadResult::Fallback);
    }

    #[test]
    fn a_large_group_keeps_its_order_across_the_readers() {
        let dir = scratch("many");
        let requests: Vec<(Option<PathBuf>, bool)> = (0..100)
            .map(|i| (Some(write(&dir, &format!("{i}.md"), format!("note {i}").as_bytes())), true))
            .collect();
        let results = read_all(requests);
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
        let path = write(&dir, "big.bin", &bytes);
        assert_eq!(read_all(vec![(Some(path), false)])[0], IndexReadResult::Bytes { sha256: to_hex(&Sha256::digest(&bytes)) });
    }

    #[test]
    fn the_wire_form_names_its_kind() {
        let json = serde_json::to_string(&IndexReadResult::Bytes { sha256: "ab".into() }).unwrap();
        assert_eq!(json, r#"{"kind":"bytes","sha256":"ab"}"#);
        assert_eq!(serde_json::to_string(&IndexReadResult::Fallback).unwrap(), r#"{"kind":"fallback"}"#);
    }
}
