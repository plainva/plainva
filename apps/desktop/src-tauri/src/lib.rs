use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

mod backup;

// OS keychain bridge (ADR 0005, phase 5.1 A6).
//
// NOTE (maintainer): this native code was NOT compiled or run in the AI harness
// (no cargo). It follows the `keyring` v3 API (Entry::new / set_password /
// get_password / delete_credential) and Tauri v2 command conventions. Verify the
// native build on macOS/Windows/Linux before release — in particular the Linux
// secret-service/DBus path and the chosen keyring feature flags in Cargo.toml.
const KEYRING_SERVICE: &str = "plainva";

/// Stores a secret under the given key in the OS keychain (upsert).
#[tauri::command]
fn keychain_set(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

/// Returns the secret for the key, or `None` if there is no such entry.
#[tauri::command]
fn keychain_get(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Deletes the secret for the key. Missing entries are treated as success.
#[tauri::command]
fn keychain_delete(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// --- Google OAuth loopback redirect listener (ADR 0006, phase 5.1 G2) ---
//
// NOTE (maintainer): NOT compiled or run in the AI harness (no cargo). The PKCE/token
// logic lives in @plainva/core (DriveAuth, G1, unit-tested); this only receives the
// browser redirect on 127.0.0.1. Flow: the frontend calls `oauth_loopback_start` to bind
// an ephemeral port and build redirect_uri = http://127.0.0.1:<port>, opens the system
// browser to the auth URL, then calls `oauth_loopback_wait` which accepts a single
// connection, extracts ?code=&state=, replies with a small HTML page and returns them.
// Verify natively (single-connection accept, timeout, URL-decoding of the code).

/// Native OAuth loopback state.
///
/// `listener` holds the bound socket between `oauth_loopback_start` and
/// `oauth_loopback_wait`. `cancel` is the abort flag of the CURRENT (or most
/// recently started) wait loop: setting it to `true` makes the accept-loop
/// return early instead of idling until the timeout. This lets a NEW
/// authorization attempt tear down a previous, abandoned one (e.g. the user
/// closed the browser tab without granting access) so its port and blocking
/// thread are released — otherwise a fixed-port provider (Dropbox) would stay
/// unreachable for the full timeout.
struct OAuthLoopback {
    listener: Mutex<Option<TcpListener>>,
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

#[derive(serde::Serialize, Debug)]
struct OAuthResult {
    code: String,
    state: Option<String>,
}

fn url_decode(s: &str) -> String {
    // Byte-based on purpose: slicing the &str (`&s[i+1..i+3]`) would panic on
    // multi-byte UTF-8 directly after a '%'. Query strings are attacker-ish
    // input here (any local process can hit the loopback port).
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let decoded = std::str::from_utf8(&bytes[i + 1..i + 3])
                    .ok()
                    .and_then(|h| u8::from_str_radix(h, 16).ok());
                match decoded {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Extracts a query parameter from the HTTP request's first line
/// ("GET /?code=...&state=... HTTP/1.1").
fn extract_query_param(request: &str, key: &str) -> Option<String> {
    let first_line = request.lines().next()?;
    let path_and_query = first_line.split_whitespace().nth(1)?;
    let query = path_and_query.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next()?;
        if k == key {
            return Some(url_decode(it.next().unwrap_or("")));
        }
    }
    None
}

/// Binds a loopback listener and returns the bound port so the caller can build
/// `redirect_uri = http://127.0.0.1:<port>` before opening the browser.
///
/// `port` is optional: `None` binds an ephemeral port (Google/Microsoft accept any
/// loopback port). Providers that require an EXACTLY registered redirect URI
/// (Dropbox) pass their fixed port; a bind failure (port already in use) surfaces
/// as an error string for the UI.
#[tauri::command]
fn oauth_loopback_start(
    state: tauri::State<'_, OAuthLoopback>,
    port: Option<u16>,
) -> Result<u16, String> {
    // Abort a previous wait loop that is still running (e.g. an earlier login the
    // user abandoned in the browser). It releases its socket + blocking thread
    // once it observes the flag, which frees a fixed port for a retry.
    if let Some(prev) = state.cancel.lock().map_err(|e| e.to_string())?.take() {
        prev.store(true, Ordering::SeqCst);
    }
    let listener = TcpListener::bind(("127.0.0.1", port.unwrap_or(0))).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    *state.listener.lock().map_err(|e| e.to_string())? = Some(listener);
    *state.cancel.lock().map_err(|e| e.to_string())? = Some(Arc::new(AtomicBool::new(false)));
    Ok(port)
}

/// Waits (up to `timeout_secs`) for the single OAuth redirect, returns the code + state.
///
/// `async` on purpose: the accept-loop can block for the whole timeout when the
/// user abandons the browser login. A synchronous command would run that busy
/// wait on the MAIN thread and freeze the entire WebView UI (Tauri runs non-async
/// commands on the main thread) — which reads as a crash. `spawn_blocking` moves
/// the wait onto a blocking worker so the UI stays responsive throughout.
#[tauri::command]
async fn oauth_loopback_wait(
    state: tauri::State<'_, OAuthLoopback>,
    timeout_secs: u64,
) -> Result<OAuthResult, String> {
    // Take the listener and clone the cancel flag under short, non-async locks;
    // the std Mutex guards are dropped before the await below (guards are not Send).
    let (listener, cancel) = {
        let listener = {
            let mut guard = state.listener.lock().map_err(|e| e.to_string())?;
            guard.take().ok_or_else(|| "oauth listener not started".to_string())?
        };
        let cancel = state
            .cancel
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        (listener, cancel)
    };
    tauri::async_runtime::spawn_blocking(move || {
        wait_for_oauth_redirect(listener, timeout_secs, &cancel)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Accept-loop behind `oauth_loopback_wait`, kept free of Tauri state so it is
/// unit-testable. Browsers open SPECULATIVE second connections (preconnect)
/// that never send data, and may request /favicon.ico — the first accepted
/// connection is therefore NOT necessarily the redirect. Every connection
/// without a `code` (or `error`) parameter is answered politely and the loop
/// keeps waiting until the deadline.
fn wait_for_oauth_redirect(
    listener: TcpListener,
    timeout_secs: u64,
    cancel: &AtomicBool,
) -> Result<OAuthResult, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(timeout_secs.max(1));
    loop {
        // Torn down by a newer authorization attempt (or an explicit abort):
        // stop waiting instead of holding the port until the timeout.
        if cancel.load(Ordering::SeqCst) {
            return Err("oauth loopback cancelled".to_string());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false).ok();
                // A connection that never sends data must not stall the flow
                // until the OVERALL deadline — give it a short read window.
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let code = extract_query_param(&request, "code");
                let oauth_state = extract_query_param(&request, "state");
                let oauth_error = extract_query_param(&request, "error");

                if let Some(c) = code {
                    let body = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Plainva</title></head><body style=\"font-family:sans-serif;padding:2rem\">Plainva: Anmeldung abgeschlossen. Du kannst dieses Fenster schliessen.</body></html>";
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                    return Ok(OAuthResult { code: c, state: oauth_state });
                }

                if let Some(err) = oauth_error {
                    // The provider redirected with an explicit error (e.g. the
                    // user clicked "deny"): fail fast instead of idling until
                    // the timeout.
                    let body = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Plainva</title></head><body style=\"font-family:sans-serif;padding:2rem\">Plainva: Anmeldung abgebrochen. Du kannst dieses Fenster schliessen.</body></html>";
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                    return Err(format!("oauth error in redirect: {err}"));
                }

                // Speculative/preflight connection, favicon request, or an
                // empty read: answer and keep waiting for the real redirect.
                let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
                let _ = stream.flush();
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("oauth loopback timed out".to_string());
                }
                // Short poll so a cancel (checked at the loop top) reacts quickly
                // and the port is freed promptly for a retry.
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Moves a file or directory to the OS trash/recycle bin.
#[tauri::command]
fn move_to_trash(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// JSON-serializable HTTP response for the relayed OAuth token POST.
#[derive(serde::Serialize)]
struct TokenHttpResponse {
    status: u16,
    body: String,
}

/// Performs an OAuth token POST from Rust (reqwest) so NO `Origin` header is attached.
/// The webview `fetch` sends the WebView Origin, which Microsoft's token endpoint rejects
/// for a native client (AADSTS90023: cross-origin token redemption). The frontend routes
/// ONLY the Microsoft token endpoint here; all other requests keep the normal fetch.
#[tauri::command]
async fn oauth_token_request(url: String, body: String) -> Result<TokenHttpResponse, String> {
    let client = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
    let res = client
        .post(&url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(TokenHttpResponse { status, body })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(OAuthLoopback {
            listener: Mutex::new(None),
            cancel: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            keychain_set,
            keychain_get,
            keychain_delete,
            oauth_loopback_start,
            oauth_loopback_wait,
            oauth_token_request,
            move_to_trash,
            backup::create_vault_zip
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod oauth_tests {
    use super::*;
    use std::net::TcpStream;

    #[test]
    fn url_decode_basics() {
        assert_eq!(url_decode("a%20b"), "a b");
        assert_eq!(url_decode("a+b"), "a b");
        assert_eq!(url_decode("%C3%A4"), "ä");
        assert_eq!(url_decode("abc%"), "abc%");
        assert_eq!(url_decode("%zz"), "%zz");
    }

    #[test]
    fn url_decode_never_panics_on_multibyte_after_percent() {
        // The former &str slicing panicked when a multi-byte char followed '%'
        // at an awkward boundary. Byte-based decoding must survive anything.
        let _ = url_decode("%aä");
        let _ = url_decode("%ä");
        let _ = url_decode("äö%1");
        let _ = url_decode("%🙂x");
    }

    #[test]
    fn extract_query_param_parses_the_request_line() {
        let req = "GET /?code=abc123&state=xyz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert_eq!(extract_query_param(req, "code").as_deref(), Some("abc123"));
        assert_eq!(extract_query_param(req, "state").as_deref(), Some("xyz"));
        assert_eq!(extract_query_param(req, "missing"), None);
        assert_eq!(extract_query_param("GET /favicon.ico HTTP/1.1\r\n\r\n", "code"), None);
    }

    #[test]
    fn redirect_survives_speculative_connections_and_favicon() {
        // Browsers open extra connections that never carry the redirect; the
        // old single-accept implementation aborted the whole login on those.
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();

        let sender = std::thread::spawn(move || {
            // 1. Speculative connection: opened and closed without data.
            let s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            drop(s);
            // 2. A favicon request without any query.
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            s.write_all(b"GET /favicon.ico HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            let mut sink = Vec::new();
            let _ = s.read_to_end(&mut sink);
            // 3. The real redirect.
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            s.write_all(b"GET /?code=the-code&state=the-state HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            let mut sink = Vec::new();
            let _ = s.read_to_end(&mut sink);
        });

        let result = wait_for_oauth_redirect(listener, 10, &AtomicBool::new(false)).unwrap();
        sender.join().unwrap();
        assert_eq!(result.code, "the-code");
        assert_eq!(result.state.as_deref(), Some("the-state"));
    }

    #[test]
    fn provider_error_fails_fast_instead_of_waiting_for_the_timeout() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();

        let sender = std::thread::spawn(move || {
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            s.write_all(b"GET /?error=access_denied HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            let mut sink = Vec::new();
            let _ = s.read_to_end(&mut sink);
        });

        let err = wait_for_oauth_redirect(listener, 10, &AtomicBool::new(false)).unwrap_err();
        sender.join().unwrap();
        assert!(err.contains("access_denied"), "unexpected error: {err}");
    }

    #[test]
    fn cancel_flag_ends_the_wait_without_a_redirect() {
        // The user abandoned the browser login: no redirect ever arrives. A newer
        // attempt (or an explicit abort) sets the cancel flag; the loop must return
        // promptly instead of blocking a thread/port until the long timeout — which
        // is what used to leave the UI frozen and the fixed Dropbox port occupied.
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(250));
            flag.store(true, Ordering::SeqCst);
        });

        let started = Instant::now();
        let err = wait_for_oauth_redirect(listener, 30, &cancel).unwrap_err();
        canceller.join().unwrap();
        assert!(err.contains("cancel"), "unexpected error: {err}");
        // Returned via the cancel flag, nowhere near the 30 s timeout.
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "cancel did not short-circuit the wait"
        );
    }
}
