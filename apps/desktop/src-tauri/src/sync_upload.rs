//! Streaming uploads for the sync (issue #48 — a 90 MB attachment froze the app).
//!
//! The old path carried every byte through the webview: `plugin-http` turns a
//! request body into `Array.from(new Uint8Array(buffer))` and then JSON —
//! 90 MB become ~94 million boxed numbers, well past a gigabyte of peak memory,
//! with the main thread blocked for minutes. That is one cause for all three
//! reported symptoms at once: freeze, crash, blank window.
//!
//! Here the content never enters the renderer. The command takes an OPAQUE root
//! id plus a vault-RELATIVE path (the `write_file_atomic` contract, same
//! validation) and streams the file straight to the server, so memory stays flat
//! no matter how large the file is.
//!
//! `offset`/`length` make the same command serve a plain PUT and a chunked
//! upload session; which of the two a provider needs stays in TypeScript.
//!
//! Reach: the webview already holds a broad fs scope and an unrestricted
//! `plugin-http` scope, so it could read any file and post it anywhere today —
//! this command adds convenience and safety, not new reach.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;

use sha2::{Digest, Sha256};

use crate::atomic_write::{validate_rel_path, WriteRoots};

/// Read buffer per chunk. Large enough to keep syscalls cheap on a fast link,
/// small enough that memory stays flat for any file size.
const READ_BUFFER_BYTES: usize = 256 * 1024;

/// Floor throughput the transfer budget assumes (mirrors `transferTimeout.ts`).
/// A timeout is there to end a dead connection, not to demand a speed: at
/// 50 KB/s even a slow uplink stays inside it, while a hung socket still gives
/// up in bounded time.
const MIN_TRANSFER_BYTES_PER_SECOND: u64 = 50 * 1024;
const BASE_TIMEOUT_SECS: u64 = 30;

/// One upload request. Grouped into a struct rather than eight positional
/// arguments so the call site stays readable on both sides of the boundary.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    pub root_id: String,
    pub rel_path: String,
    /// Byte range of the file to send; defaults to the whole file.
    pub offset: Option<u64>,
    pub length: Option<u64>,
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

#[derive(serde::Serialize)]
pub struct UploadResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    /// Response body as text. Provider answers to an upload are small (JSON,
    /// XML or empty); a binary answer would arrive lossy, which no upload
    /// endpoint sends.
    pub body: String,
}

#[derive(serde::Serialize)]
pub struct FileDigest {
    pub sha256: String,
    pub size: u64,
}

fn root_for(state: &tauri::State<'_, WriteRoots>, root_id: &str) -> Result<PathBuf, String> {
    let map = state.0.lock().map_err(|_| "state poisoned".to_string())?;
    map.get(root_id)
        .cloned()
        .ok_or_else(|| "unknown write root".to_string())
}

/// Resolves a vault-relative path inside a registered root, refusing anything
/// that escapes it — including through a symlinked subfolder, which is why the
/// check runs on the canonicalized target rather than the joined string.
fn resolve_in_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_clean = validate_rel_path(rel)?;
    let target = root.join(&rel_clean);
    let canon_root = fs::canonicalize(root).map_err(|e| format!("root not accessible: {e}"))?;
    let canon_target = fs::canonicalize(&target).map_err(|e| format!("file not accessible: {e}"))?;
    if !canon_target.starts_with(&canon_root) {
        return Err("path escapes the registered root".into());
    }
    if !canon_target.is_file() {
        return Err("not a regular file".into());
    }
    Ok(canon_target)
}

/// Byte range of the file this request sends, validated against its real size.
fn resolve_range(path: &Path, offset: Option<u64>, length: Option<u64>) -> Result<(u64, u64), String> {
    let size = fs::metadata(path)
        .map_err(|e| format!("file not accessible: {e}"))?
        .len();
    let start = offset.unwrap_or(0);
    if start > size {
        return Err(format!("offset {start} is past the end of the file ({size} bytes)"));
    }
    let remaining = size - start;
    let len = length.unwrap_or(remaining);
    if len > remaining {
        return Err(format!(
            "range {start}+{len} exceeds the file ({size} bytes)"
        ));
    }
    Ok((start, len))
}

fn transfer_timeout(len: u64) -> Duration {
    Duration::from_secs(BASE_TIMEOUT_SECS + len / MIN_TRANSFER_BYTES_PER_SECOND)
}

/// Reqwest's own wording rarely contains the words the sync classifier looks
/// for, and anything it does not recognise as temporary counts as fatal — a
/// dropped connection would then stop the sync instead of being retried. So the
/// transport failure class is named explicitly, in those words.
fn describe_transport_error(err: &reqwest::Error) -> String {
    let kind = if err.is_timeout() {
        "timed out"
    } else if err.is_connect() {
        "connection failed"
    } else {
        "network error"
    };
    format!("upload {kind}: {err}")
}

fn upload_blocking(
    path: PathBuf,
    start: u64,
    len: u64,
    url: String,
    method: String,
    headers: HashMap<String, String>,
) -> Result<UploadResponse, String> {
    let verb = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| format!("invalid HTTP method: {method}"))?;

    let mut file = File::open(&path).map_err(|e| format!("open failed: {e}"))?;
    if start > 0 {
        file.seek(SeekFrom::Start(start))
            .map_err(|e| format!("seek failed: {e}"))?;
    }
    // `sized` sets Content-Length and streams the reader — the whole point:
    // the bytes go from disk to socket without ever being materialized.
    let body = reqwest::blocking::Body::sized(BufReader::new(file).take(len), len);

    let client = reqwest::blocking::Client::builder()
        .timeout(transfer_timeout(len))
        .build()
        .map_err(|e| format!("http client failed: {e}"))?;

    let mut request = client.request(verb, &url).body(body);
    for (name, value) in headers {
        request = request.header(name, value);
    }

    let res = request.send().map_err(|e| describe_transport_error(&e))?;
    let status = res.status().as_u16();
    let mut out_headers = HashMap::new();
    for (name, value) in res.headers().iter() {
        if let Ok(v) = value.to_str() {
            out_headers.insert(name.as_str().to_ascii_lowercase(), v.to_string());
        }
    }
    let body = res.text().map_err(|e| describe_transport_error(&e))?;
    Ok(UploadResponse {
        status,
        headers: out_headers,
        body,
    })
}

/// Streams a byte range of a vault file to `url`; the content never crosses the
/// IPC boundary. Returns the provider's answer so the TypeScript side keeps
/// owning every protocol decision (etag, session URL, retry).
#[tauri::command]
pub async fn sync_upload_file(
    state: tauri::State<'_, WriteRoots>,
    request: UploadRequest,
) -> Result<UploadResponse, String> {
    let root = root_for(&state, &request.root_id)?;
    let path = resolve_in_root(&root, &request.rel_path)?;
    let (start, len) = resolve_range(&path, request.offset, request.length)?;
    let UploadRequest { url, method, headers, .. } = request;

    // A blocking reqwest client owns its own runtime thread; running it on a
    // blocking pool thread is what the mail commands do too.
    tauri::async_runtime::spawn_blocking(move || {
        upload_blocking(path, start, len, url, method, headers)
    })
    .await
    .map_err(|e| format!("upload task failed: {e}"))?
}

fn digest_blocking(path: PathBuf) -> Result<FileDigest, String> {
    let file = File::open(&path).map_err(|e| format!("open failed: {e}"))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; READ_BUFFER_BYTES];
    let mut size: u64 = 0;
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("read failed: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size += read as u64;
    }
    Ok(FileDigest {
        sha256: format!("{:x}", hasher.finalize()),
        size,
    })
}

/// Content hash of a vault file, computed while streaming it.
///
/// Without this the renderer would still have to read the whole file to hash it
/// for the sync base — half the memory peak would simply stay.
#[tauri::command]
pub async fn sync_file_sha256(
    state: tauri::State<'_, WriteRoots>,
    root_id: String,
    rel_path: String,
) -> Result<FileDigest, String> {
    let root = root_for(&state, &root_id)?;
    let path = resolve_in_root(&root, &rel_path)?;
    tauri::async_runtime::spawn_blocking(move || digest_blocking(path))
        .await
        .map_err(|e| format!("digest task failed: {e}"))?
}

#[cfg(test)]
mod sync_upload_tests {
    use super::*;
    use std::io::Write;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("plainva-upload-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    fn write(dir: &Path, rel: &str, bytes: &[u8]) {
        let target = dir.join(rel);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        let mut f = File::create(target).unwrap();
        f.write_all(bytes).unwrap();
    }

    #[test]
    fn resolves_a_file_inside_the_root_and_refuses_everything_else() {
        let root = scratch_dir("resolve");
        write(&root, "Notes/A.md", b"hello");

        assert!(resolve_in_root(&root, "Notes/A.md").is_ok());
        assert!(resolve_in_root(&root, "../escape.md").is_err());
        assert!(resolve_in_root(&root, "Notes/../../escape.md").is_err());
        assert!(resolve_in_root(&root, "Missing.md").is_err());
        // A directory is not an upload source.
        assert!(resolve_in_root(&root, "Notes").is_err());
        let abs = if cfg!(windows) { "C:\\escape.md" } else { "/etc/passwd" };
        assert!(resolve_in_root(&root, abs).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_range_may_never_read_past_the_file() {
        let root = scratch_dir("range");
        write(&root, "big.bin", &[7u8; 100]);
        let path = root.join("big.bin");

        assert_eq!(resolve_range(&path, None, None).unwrap(), (0, 100));
        assert_eq!(resolve_range(&path, Some(40), Some(10)).unwrap(), (40, 10));
        // Tail without an explicit length.
        assert_eq!(resolve_range(&path, Some(60), None).unwrap(), (60, 40));
        assert!(resolve_range(&path, Some(90), Some(20)).is_err());
        assert!(resolve_range(&path, Some(101), None).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn hashes_a_file_without_holding_it_in_memory() {
        let root = scratch_dir("digest");
        // Larger than the read buffer, so the streaming loop runs more than once.
        let bytes = vec![0xABu8; READ_BUFFER_BYTES * 2 + 13];
        write(&root, "big.bin", &bytes);

        let digest = digest_blocking(root.join("big.bin")).unwrap();
        let expected = format!("{:x}", Sha256::digest(&bytes));
        assert_eq!(digest.sha256, expected);
        assert_eq!(digest.size, bytes.len() as u64);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_transfer_budget_grows_with_the_payload() {
        // A flat budget was a speed requirement in disguise (issue #48): 90 MB
        // in 30 s means 3 MB/s, which an ordinary home uplink never sustains.
        let ninety_mb = 90 * 1024 * 1024;
        assert!(transfer_timeout(ninety_mb) > Duration::from_secs(30 * 60));
        assert_eq!(transfer_timeout(0), Duration::from_secs(BASE_TIMEOUT_SECS));
    }
}
