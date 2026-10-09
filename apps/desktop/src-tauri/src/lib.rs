use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Manager;

mod acp;
mod ai_egress;
mod ai_web;
mod mcp;
mod mcp_client;
mod app_identity;
mod atomic_write;
mod checked_fs;
mod backup;
mod db_batch;
mod embedding;
mod linux_appimage;
mod mail_imap;
mod mail_pool;
mod mail_smtp;
mod mail_sieve;
mod model_store;
mod sync_upload;
mod tray;
mod unzip;
mod vault_watch;

mod secure_store;
mod session;

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
    /// Who the answer says it is from (RFC 9207), where it says so. The
    /// sign-in to an MCP server checks it natively (src/mcp_client/oauth.rs).
    #[serde(skip_serializing_if = "Option::is_none")]
    iss: Option<String>,
    /// The provider's error, only for a caller that asked to be told (see
    /// `oauth_loopback_wait`); `code` is empty then.
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
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

/// Aborts a running `oauth_loopback_wait` (N1/S1).
///
/// The flag itself has existed since the freeze fix — `oauth_loopback_start`
/// sets it to release the socket of an abandoned login before it rebinds. What
/// was missing is a way to reach it from OUTSIDE. Without that, closing the
/// consent tab left the app spinning for the full three minutes with no way to
/// stop it: the wait is on a worker thread so the UI stays alive, but the
/// dialog has nothing to say and nothing to offer.
///
/// Idempotent on purpose. Nothing pending is not an error — the redirect may
/// have landed a moment before the user reached for Cancel, and answering that
/// with a failure would put an error in front of a login that just succeeded.
#[tauri::command]
fn oauth_loopback_cancel(state: tauri::State<'_, OAuthLoopback>) -> Result<(), String> {
    abort_oauth_loopback(&state)
}

/// The body of `oauth_loopback_cancel`, free of Tauri's command wrapper so it
/// can be exercised directly.
fn abort_oauth_loopback(state: &OAuthLoopback) -> Result<(), String> {
    if let Some(flag) = state.cancel.lock().map_err(|e| e.to_string())?.take() {
        flag.store(true, Ordering::SeqCst);
    }
    // Drop the listener too: the waiting thread owns its own copy, but a start
    // that never got a wait would otherwise hold the port until the next start.
    state.listener.lock().map_err(|e| e.to_string())?.take();
    Ok(())
}

/// Waits (up to `timeout_secs`) for the single OAuth redirect, returns the code + state.
///
/// `async` on purpose: the accept-loop can block for the whole timeout when the
/// user abandons the browser login. A synchronous command would run that busy
/// wait on the MAIN thread and freeze the entire WebView UI (Tauri runs non-async
/// commands on the main thread) — which reads as a crash. `spawn_blocking` moves
/// the wait onto a blocking worker so the UI stays responsive throughout.
///
/// `report_errors` hands a provider's error redirect back as a RESULT (with
/// its `state` and `iss`) instead of a failure: the sign-in to an MCP server
/// has to check who answered before it believes even an error.
#[tauri::command]
async fn oauth_loopback_wait(
    state: tauri::State<'_, OAuthLoopback>,
    timeout_secs: u64,
    report_errors: Option<bool>,
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
    let report_errors = report_errors.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        wait_for_oauth_redirect_with(listener, timeout_secs, &cancel, report_errors)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The wait as every account sign-in uses it: a provider's error is a failure.
#[cfg(test)]
fn wait_for_oauth_redirect(
    listener: TcpListener,
    timeout_secs: u64,
    cancel: &AtomicBool,
) -> Result<OAuthResult, String> {
    wait_for_oauth_redirect_with(listener, timeout_secs, cancel, false)
}

/// Accept-loop behind `oauth_loopback_wait`, kept free of Tauri state so it is
/// unit-testable. Browsers open SPECULATIVE second connections (preconnect)
/// that never send data, and may request /favicon.ico — the first accepted
/// connection is therefore NOT necessarily the redirect. Every connection
/// without a `code` (or `error`) parameter is answered politely and the loop
/// keeps waiting until the deadline.
fn wait_for_oauth_redirect_with(
    listener: TcpListener,
    timeout_secs: u64,
    cancel: &AtomicBool,
    report_errors: bool,
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
                let oauth_iss = extract_query_param(&request, "iss");

                if let Some(c) = code {
                    let body = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Plainva</title></head><body style=\"font-family:sans-serif;padding:2rem\">Plainva: Anmeldung abgeschlossen. Du kannst dieses Fenster schliessen.</body></html>";
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                    return Ok(OAuthResult { code: c, state: oauth_state, iss: oauth_iss, error: None });
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
                    if report_errors {
                        return Ok(OAuthResult { code: String::new(), state: oauth_state, iss: oauth_iss, error: Some(err) });
                    }
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

/// Opens the native print dialog for the main webview.
///
/// WKWebView on macOS silently ignores the in-page `window.print()` (user
/// report, GitHub issue #6), so the frontend routes macOS through this
/// native path; Windows/Linux keep `window.print()`, which WebView2 and
/// WebKitGTK honor (wry's native print is macOS-only anyway). Deliberately
/// synchronous: AppKit print UI must run on the main thread.
#[tauri::command]
fn print_webview(webview_window: tauri::WebviewWindow) -> Result<(), String> {
    webview_window.print().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything loads a graphics library: the AppImage on a Mesa-25 host
    // needs the host's libwayland-client preloaded, which means a re-exec
    // (issue #85, see src/linux_appimage.rs). No-op for deb/rpm and dev runs.
    #[cfg(target_os = "linux")]
    linux_appimage::apply();

    let builder = tauri::Builder::default();

    // Single instance, and it has to be registered before every other plugin
    // (the plugin's own requirement). A second launch must not start a second
    // process: both would open the same appData index database and the same
    // sync queue, and `database is locked` is handled in exactly no place.
    // Instead the running window comes forward — including out of the tray,
    // where the close button only hides it (see src/tray.rs).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
    }));

    // The global quick capture. The plugin only provides the mechanism: no
    // shortcut exists until the central window registers the one the user
    // chose (services/quickCapture.ts), and it is off by default.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    builder
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(OAuthLoopback {
            listener: Mutex::new(None),
            cancel: Mutex::new(None),
        })
        .manage(atomic_write::WriteRoots::default())
        .manage(vault_watch::VaultWatchers::default())
        .manage(tray::TrayState::default())
        .manage(ai_egress::AiEgress::default())
        .manage(mcp::McpState::default())
        .manage(mcp_client::McpClientState::default())
        .manage(acp::AcpState::default())
        .manage(embedding::Embeddings::default())
        .manage(model_store::ModelDownloads::default())
        .setup(|app| {
            // The isolated dev build (tauri.dev.conf.json, identifier
            // com.plainva.desktop.dev) and the Labs build of a feature branch
            // (tauri.labs.conf.json, com.plainva.desktop.labs) keep their own
            // state directories beside the release install; label their windows
            // so the three are never confused. Inert in release builds.
            if let Some(title) = app_identity::window_title_for(&app.config().identifier) {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_title(title);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Only captured while a tray icon is actually registered — see
            // src/tray.rs. Without one, closing quits as it always has.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if tray::hide_instead_of_quit(window) {
                    api.prevent_close();
                }
            }
            // The owner window is gone: the programs the assistant started for
            // foreign MCP servers end with it (src/mcp_client), and so do the
            // external agents it hosted (src/acp).
            if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "main" {
                mcp_client::shutdown(&window.state::<mcp_client::McpClientState>());
                acp::shutdown(&window.state::<acp::AcpState>());
            }
        })
        .invoke_handler(tauri::generate_handler![
            secure_store::keychain_set,
            secure_store::keychain_get,
            secure_store::keychain_delete,
            secure_store::keychain_compare_and_set,
            ai_egress::ai_http,
            ai_egress::ai_http_cancel,
            ai_web::ai_web_fetch,
            ai_egress::ai_key_set,
            ai_egress::ai_key_present,
            ai_egress::ai_key_delete,
            ai_egress::ai_endpoint_add,
            ai_egress::ai_endpoint_remove,
            ai_egress::ai_local_only_set,
            mcp::mcp_configure,
            mcp::mcp_status,
            mcp::mcp_pair_answer,
            mcp::mcp_call_answer,
            mcp::mcp_set_folders,
            mcp::mcp_set_writes,
            mcp::mcp_revoke,
            mcp::mcp_write_package,
            mcp_client::registry::mcp_client_servers,
            mcp_client::registry::mcp_client_add_http,
            mcp_client::registry::mcp_client_add_program,
            mcp_client::registry::mcp_client_remove,
            mcp_client::registry::mcp_client_secret_set,
            mcp_client::registry::mcp_client_secret_present,
            mcp_client::registry::mcp_client_secret_delete,
            mcp_client::http::mcp_client_http,
            mcp_client::http::mcp_client_cancel,
            mcp_client::program::mcp_client_start,
            mcp_client::program::mcp_client_write,
            mcp_client::program::mcp_client_stop,
            mcp_client::program::mcp_client_log,
            mcp_client::sandbox::mcp_client_sandbox,
            mcp_client::oauth::mcp_client_oauth_document,
            mcp_client::oauth::mcp_client_oauth_issuer,
            mcp_client::oauth::mcp_client_oauth_begin,
            mcp_client::oauth::mcp_client_oauth_finish,
            mcp_client::oauth::mcp_client_oauth_cancel,
            mcp_client::oauth::mcp_client_oauth_renew,
            mcp_client::oauth::mcp_client_oauth_status,
            mcp_client::oauth::mcp_client_oauth_sign_out,
            acp::registry::acp_agents,
            acp::registry::acp_detect,
            acp::registry::acp_agent_add,
            acp::registry::acp_agent_remove,
            acp::process::acp_start,
            acp::process::acp_write,
            acp::process::acp_stop,
            acp::process::acp_log,
            acp::login::acp_login,
            acp::login::acp_login_cancel,
            model_store::model_status,
            model_store::model_download,
            model_store::model_download_cancel,
            model_store::model_remove,
            model_store::model_read_text,
            model_store::model_free_space,
            model_store::model_memory,
            embedding::embedding_load,
            embedding::embedding_run,
            embedding::embedding_unload,
            oauth_loopback_start,
            oauth_loopback_wait,
            oauth_loopback_cancel,
            oauth_token_request,
            move_to_trash,
            print_webview,
            tray::tray_enable,
            tray::tray_disable,
            tray::tray_set_next,
            session::desktop_session_kind,
            atomic_write::register_write_root,
            atomic_write::write_file_atomic,
            checked_fs::checked_path_exists,
            checked_fs::checked_read_text_file,
            checked_fs::checked_read_dir,
            vault_watch::vault_watch_start,
            vault_watch::vault_watch_stop,
            atomic_write::set_file_times,
            sync_upload::sync_upload_file,
            sync_upload::sync_file_sha256,
            backup::create_vault_zip,
            db_batch::db_batch,
            unzip::extract_archive,
            unzip::discard_extracted_archive,
            mail_imap::mail_check_login,
            mail_imap::mail_list_envelopes,
            mail_imap::mail_fetch_message,
            mail_imap::mail_fetch_raw,
            mail_imap::mail_fetch_attachment,
            mail_imap::mail_append_draft,
            mail_imap::mail_set_seen,
            mail_imap::mail_set_flagged,
            mail_imap::mail_move_message,
            mail_imap::mail_bulk_action,
            mail_imap::mail_set_junk,
            mail_imap::mail_create_mailbox,
            mail_sieve::mail_sieve_get,
            mail_sieve::mail_sieve_put,
            mail_imap::mail_delete_message,
            mail_imap::mail_search,
            mail_imap::mail_search_envelopes,
            mail_imap::mail_list_flagged_envelopes,
            mail_imap::mail_release_sessions,
            mail_smtp::mail_send
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
    fn a_caller_that_asks_is_told_who_answered_even_for_an_error() {
        // The sign-in to an MCP server checks the issuer natively before it
        // believes anything of the answer, an error included (RFC 9207).
        let serve = |request: &'static [u8], report_errors: bool| {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            let sender = std::thread::spawn(move || {
                let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
                s.write_all(request).unwrap();
                let mut sink = Vec::new();
                let _ = s.read_to_end(&mut sink);
            });
            let result = wait_for_oauth_redirect_with(listener, 10, &AtomicBool::new(false), report_errors);
            sender.join().unwrap();
            result
        };

        let denied = serve(b"GET /callback?error=access_denied&state=s1&iss=https%3A%2F%2Fauth.example.org HTTP/1.1\r\nHost: x\r\n\r\n", true).unwrap();
        assert_eq!((denied.code.as_str(), denied.state.as_deref(), denied.iss.as_deref(), denied.error.as_deref()), ("", Some("s1"), Some("https://auth.example.org"), Some("access_denied")));

        let granted = serve(b"GET /callback?code=c1&state=s1&iss=https%3A%2F%2Fauth.example.org HTTP/1.1\r\nHost: x\r\n\r\n", true).unwrap();
        assert_eq!((granted.code.as_str(), granted.iss.as_deref(), granted.error.as_deref()), ("c1", Some("https://auth.example.org"), None));

        // What every account sign-in gets is what it always got: no new field unless there is something in it.
        let plain = serve(b"GET /?code=c1&state=s1 HTTP/1.1\r\nHost: x\r\n\r\n", false).unwrap();
        assert_eq!(serde_json::to_value(&plain).unwrap(), serde_json::json!({ "code": "c1", "state": "s1" }));
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

    /// The abort flag has existed since the freeze fix, but only
    /// `oauth_loopback_start` could reach it — so closing the consent tab left
    /// the app waiting for the full three minutes with nothing to offer. This
    /// is the way in from outside (N1/S1).
    #[test]
    fn cancelling_from_outside_ends_a_pending_wait() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let state = OAuthLoopback {
            listener: Mutex::new(None),
            cancel: Mutex::new(Some(cancel.clone())),
        };
        let flag = cancel.clone();
        let waiter = std::thread::spawn(move || wait_for_oauth_redirect(listener, 30, &flag));

        std::thread::sleep(Duration::from_millis(150));
        abort_oauth_loopback(&state).unwrap();

        let started = Instant::now();
        let err = waiter.join().unwrap().unwrap_err();
        assert!(err.contains("cancel"), "unexpected error: {err}");
        assert!(started.elapsed() < Duration::from_secs(5), "the wait did not stop");
    }

    /// Nothing pending is not an error. The redirect may have landed a moment
    /// before the user reached for Cancel, and answering that with a failure
    /// would put an error in front of a sign-in that just succeeded.
    #[test]
    fn cancelling_twice_or_with_nothing_pending_is_fine() {
        let state = OAuthLoopback { listener: Mutex::new(None), cancel: Mutex::new(None) };
        assert!(abort_oauth_loopback(&state).is_ok());

        let state = OAuthLoopback {
            listener: Mutex::new(Some(TcpListener::bind(("127.0.0.1", 0)).unwrap())),
            cancel: Mutex::new(Some(Arc::new(AtomicBool::new(false)))),
        };
        assert!(abort_oauth_loopback(&state).is_ok());
        // The socket is released as well, so a start that never got a wait does
        // not hold its port until the next attempt.
        assert!(state.listener.lock().unwrap().is_none());
        assert!(abort_oauth_loopback(&state).is_ok());
    }
}
