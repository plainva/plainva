//! Model packages on the desktop (plan KI-Harness P2a-3, ADR 0021): downloaded on the
//! user's word from the one place the catalog names — a pinned commit on huggingface.co,
//! no sign-in — into the app's local data (never the roaming profile: a model is hundreds
//! of megabytes), and checked against the catalog's size and SHA-256 before anything
//! loads it. An interrupted download resumes; a file that fails the check is deleted,
//! never used.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncWriteExt;

/// Downloads under way, by model, with the flag that cancels them.
#[derive(Default)]
pub struct ModelDownloads {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    /// Catalog id of the package ("granite-r2-97m").
    model: String,
    /// Path inside the repository ("onnx/model_quantized.onnx").
    name: String,
    /// `https://huggingface.co/<repo>/resolve/<commit>/<name>`.
    url: String,
    bytes: u64,
    sha256: String,
}

#[derive(serde::Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DownloadEvent {
    Progress { received: u64, total: u64 },
    Verifying,
}

const MARKER: &str = ".sha256";
const PART: &str = ".part";
/// Progress is reported at most this often.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

fn only_main(window: &tauri::Window) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("model packages are managed from the main window only".into())
    }
}

/// A catalog id: lower-case letters, digits, dots and dashes.
fn valid_model(model: &str) -> bool {
    !model.is_empty() && model.len() <= 64 && model.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-') && !model.starts_with('.')
}

/// A repository path: plain segments joined by `/`, none of them `.` or `..`.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && name.split('/').all(|part| {
            !part.is_empty() && part != "." && part != ".." && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
        })
}

fn valid_sha(sha: &str) -> bool {
    sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Hosts a package download may reach: the hub, and its download CDNs it redirects to.
fn allowed_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "huggingface.co" || host.ends_with(".huggingface.co") || host.ends_with(".hf.co")
}

/// The request must be the pinned file of a package: the hub, a commit, the named file.
fn allowed_url(url: &str, name: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("huggingface.co") || parsed.query().is_some() || parsed.port().is_some() {
        return Err("download_not_allowed".into());
    }
    let path = parsed.path();
    let Some((_, tail)) = path.split_once("/resolve/") else {
        return Err("download_not_allowed".into());
    };
    let Some((revision, file)) = tail.split_once('/') else {
        return Err("download_not_allowed".into());
    };
    if revision.len() != 40 || !revision.bytes().all(|b| b.is_ascii_hexdigit()) || file != name {
        return Err("download_not_allowed".into());
    }
    Ok(parsed)
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("models"))
}

fn file_path(app: &AppHandle, model: &str, name: &str) -> Result<PathBuf, String> {
    if !valid_model(model) || !valid_name(name) {
        return Err("invalid model file".into());
    }
    let mut path = models_dir(app)?.join(model);
    for part in name.split('/') {
        path.push(part);
    }
    Ok(path)
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut os = path.as_os_str().to_owned();
    os.push(suffix);
    PathBuf::from(os)
}

/// Whether a file is there, of its size, and was checked against its hash.
fn verified(path: &Path, bytes: u64, sha256: &str) -> bool {
    let size_ok = std::fs::metadata(path).map(|m| m.is_file() && m.len() == bytes).unwrap_or(false);
    size_ok && std::fs::read_to_string(with_suffix(path, MARKER)).map(|m| m.trim() == sha256).unwrap_or(false)
}

/// A downloaded, checked model file for the runtime: `<model>/<name>`.
pub fn verified_file(app: &AppHandle, relative: &str) -> Result<PathBuf, String> {
    let (model, name) = relative.split_once('/').ok_or("invalid model file")?;
    let path = file_path(app, model, name)?;
    let bytes = std::fs::metadata(&path).map_err(|_| "model_missing".to_string())?.len();
    let marker = std::fs::read_to_string(with_suffix(&path, MARKER)).map_err(|_| "model_unverified".to_string())?;
    if !valid_sha(marker.trim()) || bytes == 0 {
        return Err("model_unverified".into());
    }
    Ok(path)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFileState {
    name: String,
    bytes: u64,
    sha256: String,
}

/// Which files of a package are present and checked, in the order asked.
#[tauri::command]
pub fn model_status(app: AppHandle, model: String, files: Vec<ModelFileState>) -> Result<Vec<bool>, String> {
    files.iter().map(|file| Ok(verified(&file_path(&app, &model, &file.name)?, file.bytes, &file.sha256))).collect()
}

/// A package's text file (the tokenizer) for the TypeScript side.
#[tauri::command]
pub fn model_read_text(window: tauri::Window, app: AppHandle, model: String, name: String) -> Result<String, String> {
    only_main(&window)?;
    let path = verified_file(&app, &format!("{model}/{name}"))?;
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn model_remove(window: tauri::Window, app: AppHandle, state: State<'_, ModelDownloads>, model: String) -> Result<(), String> {
    only_main(&window)?;
    if !valid_model(&model) {
        return Err("invalid model".into());
    }
    if let Some(flag) = state.cancels.lock().map_err(|e| e.to_string())?.get(&model) {
        flag.store(true, Ordering::Relaxed);
    }
    let dir = models_dir(&app)?.join(&model);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn model_download_cancel(state: State<'_, ModelDownloads>, model: String) -> Result<(), String> {
    if let Some(flag) = state.cancels.lock().map_err(|e| e.to_string())?.get(&model) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Free space where packages go, so the load dialog can say whether one fits.
#[tauri::command]
pub fn model_free_space(app: AppHandle) -> Result<u64, String> {
    let dir = models_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    free_space(&dir)
}

#[cfg(windows)]
fn free_space(dir: &Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut available = 0u64;
    // SAFETY: a NUL-terminated path; the two totals are optional and stay null.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut()) };
    if ok == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(available)
    }
}

// The field widths differ between Linux (u64) and macOS (u32 blocks): `from` is a no-op on one of them.
#[cfg(unix)]
#[allow(clippy::useless_conversion)]
fn free_space(dir: &Path) -> Result<u64, String> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(dir.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    // SAFETY: statvfs fills the zeroed struct for a NUL-terminated path.
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(path.as_ptr(), &mut stat) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(u64::from(stat.f_bavail) * u64::from(stat.f_frsize))
}

/// The app's memory now and at its peak, in bytes, for the device check of
/// search by meaning (plan KI-Harness P2a-6). `resident` is null where the
/// system gives only the peak cheaply (macOS).
#[derive(serde::Serialize)]
pub struct ProcessMemory {
    resident: Option<u64>,
    peak: u64,
}

#[tauri::command]
pub fn model_memory() -> Result<ProcessMemory, String> {
    process_memory()
}

#[cfg(windows)]
fn process_memory() -> Result<ProcessMemory, String> {
    use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    let size = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    // SAFETY: a zeroed counters struct is valid; the call fills it for this process's pseudo handle.
    let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
    counters.cb = size;
    if unsafe { GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, size) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(ProcessMemory { resident: Some(counters.WorkingSetSize as u64), peak: counters.PeakWorkingSetSize as u64 })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn process_memory() -> Result<ProcessMemory, String> {
    let status = std::fs::read_to_string("/proc/self/status").map_err(|e| e.to_string())?;
    Ok(ProcessMemory { resident: status_bytes(&status, "VmRSS:"), peak: status_bytes(&status, "VmHWM:").unwrap_or(0) })
}

/// A "Vm…:  1234 kB" line of /proc/self/status, in bytes.
#[cfg(any(test, all(unix, not(target_os = "macos"))))]
fn status_bytes(status: &str, field: &str) -> Option<u64> {
    let value = status.lines().find_map(|line| line.strip_prefix(field))?;
    value.trim().trim_end_matches("kB").trim().parse::<u64>().ok().map(|kib| kib * 1024)
}

// getrusage gives the peak in bytes on macOS; the current footprint would need the Mach task API.
#[cfg(target_os = "macos")]
fn process_memory() -> Result<ProcessMemory, String> {
    // SAFETY: getrusage fills the zeroed struct for this process.
    let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(ProcessMemory { resident: None, peak: u64::try_from(usage.ru_maxrss).unwrap_or(0) })
}

async fn hash_file(path: PathBuf) -> Result<(Sha256, u64), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(Sha256, u64), String> {
        let mut hasher = Sha256::new();
        let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        let length = std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
        Ok((hasher, length))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Downloads one file of a package: resumes a `.part` left behind, reports progress,
/// checks size and SHA-256, and only then gives the file its name.
#[tauri::command]
pub async fn model_download(window: tauri::Window, app: AppHandle, state: State<'_, ModelDownloads>, file: ModelFile, on_event: Channel<DownloadEvent>) -> Result<(), String> {
    only_main(&window)?;
    if !valid_sha(&file.sha256) || file.bytes == 0 {
        return Err("invalid checksum".into());
    }
    let url = allowed_url(&file.url, &file.name)?;
    let target = file_path(&app, &file.model, &file.name)?;
    if verified(&target, file.bytes, &file.sha256) {
        return Ok(());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    state.cancels.lock().map_err(|e| e.to_string())?.insert(file.model.clone(), cancel.clone());
    let result = download(&url, &target, &file, &cancel, &on_event).await;
    state.cancels.lock().map_err(|e| e.to_string())?.remove(&file.model);
    result
}

async fn download(url: &reqwest::Url, target: &Path, file: &ModelFile, cancel: &AtomicBool, on_event: &Channel<DownloadEvent>) -> Result<(), String> {
    let part = with_suffix(target, PART);
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(with_suffix(target, MARKER));
    let (mut hasher, mut received) = if part.is_file() { hash_file(part.clone()).await? } else { (Sha256::new(), 0) };
    if received > file.bytes {
        std::fs::remove_file(&part).map_err(|e| e.to_string())?;
        hasher = Sha256::new();
        received = 0;
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        // Only the hub and its CDNs, over https: a redirect elsewhere ends the download.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let ok = attempt.previous().len() < 10 && attempt.url().scheme() == "https" && attempt.url().host_str().map(allowed_host).unwrap_or(false);
            if ok {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = client.get(url.clone());
    if received > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={received}-"));
    }
    let mut response = request.send().await.map_err(|e| format!("download_failed: {e}"))?;
    let status = response.status();
    if status.is_redirection() {
        return Err("download_not_allowed".into());
    }
    if received > 0 && status == reqwest::StatusCode::OK {
        // The server sends the whole file again: start over.
        hasher = Sha256::new();
        received = 0;
    } else if !(status == reqwest::StatusCode::OK || (received > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT)) {
        return Err(format!("download_failed: HTTP {}", status.as_u16()));
    }
    let mut out = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(received > 0)
        .truncate(received == 0)
        .open(&part)
        .await
        .map_err(|e| e.to_string())?;
    let mut last = Instant::now();
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("download_failed: {e}"))? {
        if cancel.load(Ordering::Relaxed) {
            out.flush().await.map_err(|e| e.to_string())?;
            return Err("download_cancelled".into());
        }
        received += chunk.len() as u64;
        if received > file.bytes {
            drop(out);
            let _ = std::fs::remove_file(&part);
            return Err("download_too_large".into());
        }
        hasher.update(&chunk);
        out.write_all(&chunk).await.map_err(|e| e.to_string())?;
        if last.elapsed() >= PROGRESS_EVERY {
            last = Instant::now();
            let _ = on_event.send(DownloadEvent::Progress { received, total: file.bytes });
        }
    }
    out.flush().await.map_err(|e| e.to_string())?;
    out.sync_all().await.map_err(|e| e.to_string())?;
    drop(out);
    let _ = on_event.send(DownloadEvent::Progress { received, total: file.bytes });
    let _ = on_event.send(DownloadEvent::Verifying);
    let digest = to_hex(&hasher.finalize());
    if received != file.bytes || digest != file.sha256 {
        let _ = std::fs::remove_file(&part);
        return Err(if received != file.bytes { "download_incomplete".into() } else { "checksum_mismatch".into() });
    }
    std::fs::rename(&part, target).map_err(|e| e.to_string())?;
    std::fs::write(with_suffix(target, MARKER), &file.sha256).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_process_memory_of_this_system() {
        let memory = process_memory().unwrap();
        assert!(memory.peak > 0);
        assert!(memory.resident.is_none_or(|resident| resident > 0));
        assert_eq!(status_bytes("Name:\tx\nVmHWM:\t  2048 kB\nVmRSS:\t 1024 kB\n", "VmRSS:"), Some(1024 * 1024));
        assert_eq!(status_bytes("VmRSS: n/a\n", "VmRSS:"), None);
    }

    const REV: &str = "536a9f241cb3f02a9c5995a1e708c784bd274859";

    #[test]
    fn only_a_pinned_hub_file_may_be_downloaded() {
        let url = format!("https://huggingface.co/onnx-community/m-ONNX/resolve/{REV}/onnx/model_quantized.onnx");
        assert!(allowed_url(&url, "onnx/model_quantized.onnx").is_ok());
        assert!(allowed_url(&url, "tokenizer.json").is_err(), "another file than named");
        assert!(allowed_url(&url.replace(REV, "main"), "onnx/model_quantized.onnx").is_err(), "a moving branch");
        assert!(allowed_url(&url.replace("https://", "http://"), "onnx/model_quantized.onnx").is_err());
        assert!(allowed_url(&url.replace("huggingface.co", "example.com"), "onnx/model_quantized.onnx").is_err());
        assert!(allowed_url(&format!("{url}?download=1"), "onnx/model_quantized.onnx").is_err());
    }

    #[test]
    fn redirects_stay_with_the_hub_and_its_cdns() {
        assert!(allowed_host("huggingface.co"));
        assert!(allowed_host("us.aws.cdn.hf.co"));
        assert!(allowed_host("cdn-lfs.huggingface.co"));
        assert!(!allowed_host("hf.co.example.com"));
        assert!(!allowed_host("evilhuggingface.co"));
    }

    #[test]
    fn names_cannot_leave_the_package_folder() {
        assert!(valid_name("onnx/model_quantized.onnx"));
        assert!(valid_name("tokenizer.json"));
        assert!(!valid_name("../secrets"));
        assert!(!valid_name("onnx/../../x"));
        assert!(!valid_name("/abs"));
        assert!(!valid_name("a\\b"));
        assert!(valid_model("granite-r2-97m"));
        assert!(valid_model("qwen3-embedding-0.6b"));
        assert!(!valid_model("../x"));
        assert!(!valid_model("Granite"));
    }

    #[test]
    fn a_file_counts_only_when_checked() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("model.onnx");
        std::fs::write(&path, b"abc").unwrap();
        let sha = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert!(!verified(&path, 3, sha), "no marker yet");
        std::fs::write(with_suffix(&path, MARKER), sha).unwrap();
        assert!(verified(&path, 3, sha));
        assert!(!verified(&path, 4, sha), "wrong size");
        let mut hasher = Sha256::new();
        hasher.update(b"abc");
        assert_eq!(to_hex(&hasher.finalize()), sha);
    }
}
