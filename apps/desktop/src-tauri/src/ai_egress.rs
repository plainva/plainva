//! The native AI egress (ADR 0016).
//!
//! Every cloud call of the AI harness runs through `ai_http`. The web view
//! builds the request SPECIFICATION (packages/core/src/ai/providers.ts) but
//! never holds a provider key; this module
//!
//! 1. reads the key from the keychain by a fixed, purpose-bound slot and puts it
//!    into the request itself — the key never crosses back into the web view,
//!    not as a return value, an event or an error text;
//! 2. checks the recipient: the URL must lie under a built-in provider or under
//!    an endpoint the user confirmed in a native dialog — never a free URL;
//! 3. streams the answer (server-sent events) to the web view as it arrives and
//!    stops on `ai_http_cancel`;
//! 4. enforces the provider rules it can see: no provider-side storage on the
//!    official OpenAI API, whatever the body says.
//!
//! Only the central window may call it: AI v1 runs in the owner window.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

/// Keychain slots of the egress. `secure_store`'s generic commands refuse this
/// prefix, so no web-view code can read a provider key back.
pub const AI_KEY_PREFIX: &str = "ai-provider:";

const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES: usize = 64 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// A stream that sends nothing for this long is dead, not slow.
const IDLE_TIMEOUT: Duration = Duration::from_secs(180);

/// Where a provider expects its key.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AuthStyle {
    /// `x-api-key: <key>`
    ApiKeyHeader,
    /// `x-goog-api-key: <key>`
    GoogApiKey,
    /// `authorization: Bearer <key>`
    Bearer,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Endpoint {
    base: String,
    auth: AuthStyle,
    needs_key: bool,
    /// The official OpenAI API: `store` is forced to false.
    official_openai: bool,
}

fn builtin(id: &str) -> Option<Endpoint> {
    let (base, auth, needs_key, official_openai) = match id {
        "anthropic" => ("https://api.anthropic.com/", AuthStyle::ApiKeyHeader, true, false),
        "openai" => ("https://api.openai.com/", AuthStyle::Bearer, true, true),
        "gemini" => ("https://generativelanguage.googleapis.com/", AuthStyle::GoogApiKey, true, false),
        "openrouter" => ("https://openrouter.ai/api/", AuthStyle::Bearer, true, false),
        "ollama" => ("http://localhost:11434/", AuthStyle::Bearer, false, false),
        "lmstudio" => ("http://localhost:1234/", AuthStyle::Bearer, false, false),
        _ => return None,
    };
    Some(Endpoint { base: base.to_string(), auth, needs_key, official_openai })
}

/// Endpoints the user added (OpenAI-compatible servers, gateways). Kept in the
/// app data folder, written only after the native confirmation.
#[derive(Default, Serialize, Deserialize)]
struct UserEndpoints {
    endpoints: HashMap<String, String>,
}

/// Tauri-managed state: the running requests (for STOP) and the user endpoints.
#[derive(Default)]
pub struct AiEgress {
    running: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    user: Mutex<Option<UserEndpoints>>,
}

const USER_ENDPOINTS_FILE: &str = "ai-endpoints.json";

fn user_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(USER_ENDPOINTS_FILE))
}

/// Atomic, like every other file this app writes: a torn registry would
/// silently forget the servers the user confirmed.
fn save_user_endpoints(app: &AppHandle, snapshot: &str) -> Result<(), String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    crate::atomic_write::write_atomic_impl(&root, USER_ENDPOINTS_FILE, snapshot.as_bytes())
}

fn with_user_endpoints<T>(app: &AppHandle, state: &AiEgress, run: impl FnOnce(&mut UserEndpoints) -> T) -> Result<T, String> {
    let mut guard = state.user.lock().map_err(|_| "endpoint registry lock failed".to_string())?;
    if guard.is_none() {
        let loaded = std::fs::read_to_string(user_file(app)?)
            .ok()
            .and_then(|text| serde_json::from_str::<UserEndpoints>(&text).ok())
            .unwrap_or_default();
        *guard = Some(loaded);
    }
    Ok(run(guard.as_mut().expect("loaded above")))
}

fn resolve(app: &AppHandle, state: &AiEgress, id: &str) -> Result<Endpoint, String> {
    if let Some(endpoint) = builtin(id) {
        return Ok(endpoint);
    }
    let base = with_user_endpoints(app, state, |u| u.endpoints.get(id).cloned())?
        .ok_or_else(|| format!("unknown AI endpoint '{id}'"))?;
    // A user endpoint speaks the OpenAI-compatible protocol; its key is optional.
    Ok(Endpoint { base, auth: AuthStyle::Bearer, needs_key: false, official_openai: false })
}

/// Normalises a base URL a user entered: scheme and host lower-case, a
/// trailing slash, no query, no fragment, no credentials.
fn normalize_base(raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "not a URL".to_string())?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("only http and https endpoints".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("no credentials in the URL".into());
    }
    let host = url.host_str().ok_or("no host")?;
    if url.scheme() == "http" && !is_loopback(host) {
        return Err("plain http only for a server on this device".into());
    }
    let mut base = format!("{}://{}", url.scheme(), host.to_ascii_lowercase());
    if let Some(port) = url.port() {
        base.push_str(&format!(":{port}"));
    }
    let path = url.path().trim_end_matches('/');
    base.push_str(path);
    base.push('/');
    Ok(base)
}

fn is_loopback(host: &str) -> bool {
    host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1"
}

/// The request URL must lie under the endpoint's base — compared on the
/// parsed URL, so `https://api.openai.com.evil.test/` or `…@evil.test` cannot
/// pass as a prefix.
fn url_allowed(endpoint: &Endpoint, url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "invalid request URL".to_string())?;
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return Err("request URL not allowed".into());
    }
    let base = reqwest::Url::parse(&endpoint.base).map_err(|_| "invalid endpoint".to_string())?;
    let same_origin = parsed.scheme() == base.scheme() && parsed.host_str() == base.host_str() && parsed.port_or_known_default() == base.port_or_known_default();
    if !same_origin || !parsed.path().starts_with(base.path()) || parsed.path().contains("/../") {
        return Err("request URL is not under the endpoint".into());
    }
    Ok(parsed)
}

/// Headers the web view may set. Everything that could carry credentials or
/// redirect the request is decided here, not there.
fn filtered_headers(requested: &HashMap<String, String>) -> Vec<(String, String)> {
    const ALLOWED: [&str; 4] = ["content-type", "accept", "anthropic-version", "anthropic-beta"];
    requested
        .iter()
        .filter(|(name, value)| ALLOWED.contains(&name.to_ascii_lowercase().as_str()) && !value.contains(['\r', '\n']))
        .map(|(name, value)| (name.to_ascii_lowercase(), value.clone()))
        .collect()
}

/// Provider rules the egress enforces on the body (ADR 0017).
fn enforce_body_rules(endpoint: &Endpoint, url: &reqwest::Url, body: &mut serde_json::Value) {
    if endpoint.official_openai && (url.path().ends_with("/responses") || url.path().ends_with("/chat/completions")) {
        if let Some(object) = body.as_object_mut() {
            object.insert("store".into(), serde_json::Value::Bool(false));
        }
    }
}

/// Removes the key — and the masked key fragments some providers echo — from
/// any text that goes back to the web view.
fn redact(text: &str, key: Option<&str>) -> String {
    let mut out = text.to_string();
    if let Some(key) = key.filter(|k| k.len() >= 8) {
        out = out.replace(key, "[key]");
        // "Incorrect API key provided: sk-proj-****abcd" — the tail alone is
        // not the key, but it identifies it.
        let tail = &key[key.len() - 4..];
        out = out.replace(&format!("****{tail}"), "****");
    }
    out
}

/// Takes the longest prefix of `pending` that can go out as text. A UTF-8
/// sequence split across two packets waits for the next one; bytes that are
/// invalid anywhere else are replaced, never held back — a held-back byte
/// would stall the stream for good.
fn take_text(pending: &mut Vec<u8>) -> Option<String> {
    let mut cut = 0;
    loop {
        match std::str::from_utf8(&pending[cut..]) {
            Ok(_) => {
                cut = pending.len();
                break;
            }
            Err(e) => match e.error_len() {
                Some(invalid) => cut += e.valid_up_to() + invalid,
                None => {
                    cut += e.valid_up_to();
                    break;
                }
            },
        }
    }
    if cut == 0 {
        return None;
    }
    let text = String::from_utf8_lossy(&pending[..cut]).into_owned();
    pending.drain(..cut);
    Some(text)
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum AiMethod {
    /// A model call; the body is the provider request.
    #[default]
    Post,
    /// The model list of the connection test; no body.
    Get,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    request_id: String,
    endpoint_id: String,
    url: String,
    #[serde(default)]
    method: AiMethod,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<serde_json::Value>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiChunk {
    /// The provider answered; the stream follows.
    Open { status: u16 },
    /// Raw SSE text, in arrival order (the decoder lives in core).
    Data { text: String },
    /// The provider refused the request (status >= 300; redirects are not followed).
    HttpError {
        status: u16,
        body: String,
        /// The provider's Retry-After, when it sent one (rate limits, overload).
        #[serde(rename = "retryAfter")]
        retry_after: Option<String>,
    },
    /// The request never reached a provider, or the stream broke.
    Failed { code: String, message: String },
    /// The stream ended normally.
    Done,
    /// STOP was pressed.
    Cancelled,
}

fn key_entry_name(endpoint_id: &str) -> String {
    format!("{AI_KEY_PREFIX}{endpoint_id}")
}

fn read_key(app: &AppHandle, endpoint_id: &str) -> Result<Option<String>, String> {
    crate::secure_store::read_slot(app, &key_entry_name(endpoint_id))
}

fn only_main(window: &tauri::Window) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("the AI egress is only available to the main window".into())
    }
}

#[tauri::command]
pub async fn ai_http(
    window: tauri::Window,
    app: AppHandle,
    state: State<'_, AiEgress>,
    request: AiRequest,
    on_event: Channel<AiChunk>,
) -> Result<(), String> {
    only_main(&window)?;
    let fail = |code: &str, message: &str| {
        let _ = on_event.send(AiChunk::Failed { code: code.into(), message: message.into() });
        Ok(())
    };
    let endpoint = match resolve(&app, &state, &request.endpoint_id) {
        Ok(endpoint) => endpoint,
        Err(message) => return fail("unknown_endpoint", &message),
    };
    let url = match url_allowed(&endpoint, &request.url) {
        Ok(url) => url,
        Err(message) => return fail("url_not_allowed", &message),
    };
    let payload = match (request.method, request.body) {
        (AiMethod::Get, _) => None,
        (AiMethod::Post, Some(mut body)) => {
            enforce_body_rules(&endpoint, &url, &mut body);
            let bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
            if bytes.len() > MAX_BODY_BYTES {
                return fail("too_large", "request too large");
            }
            Some(bytes)
        }
        (AiMethod::Post, None) => return fail("invalid_request", "a model call needs a body"),
    };
    let key = read_key(&app, &request.endpoint_id)?;
    if endpoint.needs_key && key.is_none() {
        let _ = on_event.send(AiChunk::Failed { code: "no_key".into(), message: "no key stored for this provider".into() });
        return Ok(());
    }

    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    state.running.lock().map_err(|_| "lock failed".to_string())?.insert(request.request_id.clone(), cancel_tx);

    // No redirects: a 3xx could carry the key to another host.
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut builder = match payload {
        Some(bytes) => client.post(url).body(bytes),
        None => client.get(url),
    };
    for (name, value) in filtered_headers(&request.headers) {
        builder = builder.header(name, value);
    }
    if let Some(key) = key.as_deref() {
        builder = match endpoint.auth {
            AuthStyle::ApiKeyHeader => builder.header("x-api-key", key),
            AuthStyle::GoogApiKey => builder.header("x-goog-api-key", key),
            AuthStyle::Bearer => builder.header("authorization", format!("Bearer {key}")),
        };
    }

    let outcome = async {
        let mut response = tokio::select! {
            _ = &mut cancel_rx => return AiChunk::Cancelled,
            result = tokio::time::timeout(IDLE_TIMEOUT, builder.send()) => match result {
                Err(_) => return AiChunk::Failed { code: "idle_timeout".into(), message: "the provider did not answer".into() },
                Ok(Err(e)) => return AiChunk::Failed { code: "network".into(), message: redact(&e.to_string(), key.as_deref()) },
                Ok(Ok(response)) => response,
            },
        };
        let status = response.status().as_u16();
        // Redirects are not followed, so a 3xx is an answer we cannot use.
        if status >= 300 {
            let retry_after = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .map(|value| value.chars().take(64).collect::<String>());
            // Read at most the limit: an error body is a sentence, not a download.
            let mut body: Vec<u8> = Vec::new();
            while body.len() < MAX_ERROR_BODY_BYTES {
                let next = tokio::select! {
                    _ = &mut cancel_rx => return AiChunk::Cancelled,
                    chunk = tokio::time::timeout(IDLE_TIMEOUT, response.chunk()) => chunk,
                };
                match next {
                    Ok(Ok(Some(bytes))) => body.extend_from_slice(&bytes),
                    _ => break,
                }
            }
            body.truncate(MAX_ERROR_BODY_BYTES);
            let text = String::from_utf8_lossy(&body);
            return AiChunk::HttpError { status, body: redact(&text, key.as_deref()), retry_after };
        }
        let _ = on_event.send(AiChunk::Open { status });
        let mut pending: Vec<u8> = Vec::new();
        loop {
            let next = tokio::select! {
                _ = &mut cancel_rx => return AiChunk::Cancelled,
                chunk = tokio::time::timeout(IDLE_TIMEOUT, response.chunk()) => chunk,
            };
            match next {
                Err(_) => return AiChunk::Failed { code: "idle_timeout".into(), message: "the provider stopped sending".into() },
                Ok(Err(e)) => return AiChunk::Failed { code: "network".into(), message: redact(&e.to_string(), key.as_deref()) },
                Ok(Ok(None)) => {
                    if !pending.is_empty() {
                        let _ = on_event.send(AiChunk::Data { text: String::from_utf8_lossy(&pending).into_owned() });
                    }
                    return AiChunk::Done;
                }
                Ok(Ok(Some(bytes))) => {
                    pending.extend_from_slice(&bytes);
                    if let Some(text) = take_text(&mut pending) {
                        let _ = on_event.send(AiChunk::Data { text });
                    }
                }
            }
        }
    }
    .await;

    if let Ok(mut running) = state.running.lock() {
        running.remove(&request.request_id);
    }
    let _ = on_event.send(outcome);
    Ok(())
}

#[tauri::command]
pub fn ai_http_cancel(state: State<'_, AiEgress>, request_id: String) -> Result<bool, String> {
    let sender = state.running.lock().map_err(|_| "lock failed".to_string())?.remove(&request_id);
    Ok(sender.map(|s| s.send(()).is_ok()).unwrap_or(false))
}

/// Stores a provider key. Write-only: there is no command that reads it back.
#[tauri::command]
pub fn ai_key_set(window: tauri::Window, app: AppHandle, endpoint_id: String, value: String) -> Result<(), String> {
    only_main(&window)?;
    let value = value.trim();
    if value.is_empty() || value.len() > 4096 {
        return Err("invalid key".into());
    }
    crate::secure_store::write_slot(&app, &key_entry_name(&endpoint_id), Some(value))
}

#[tauri::command]
pub fn ai_key_present(app: AppHandle, endpoint_id: String) -> Result<bool, String> {
    Ok(read_key(&app, &endpoint_id)?.is_some())
}

#[tauri::command]
pub fn ai_key_delete(window: tauri::Window, app: AppHandle, endpoint_id: String) -> Result<(), String> {
    only_main(&window)?;
    crate::secure_store::write_slot(&app, &key_entry_name(&endpoint_id), None)
}

/// The texts of the native confirmation, in the app's language. The address
/// itself is always added here, below them: whatever the web view writes,
/// the dialog shows where the requests will go.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmText {
    title: String,
    message: String,
    confirm: String,
    cancel: String,
}

fn clip(text: &str, max: usize) -> String {
    text.chars().filter(|c| !c.is_control() || *c == '\n').take(max).collect()
}

/// Adds a user endpoint after a NATIVE confirmation — the web view cannot add
/// a recipient on its own, so an injected script cannot widen the allowlist.
#[tauri::command]
pub async fn ai_endpoint_add(
    window: tauri::Window,
    app: AppHandle,
    state: State<'_, AiEgress>,
    endpoint_id: String,
    base_url: String,
    text: ConfirmText,
) -> Result<bool, String> {
    only_main(&window)?;
    if builtin(&endpoint_id).is_some() || !endpoint_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') || endpoint_id.is_empty() || endpoint_id.len() > 64 {
        return Err("invalid endpoint id".into());
    }
    let base = normalize_base(&base_url)?;
    let question = format!("{}\n\n{base}", clip(&text.message, 400));
    let (title, confirm, cancel) = (clip(&text.title, 80), clip(&text.confirm, 40), clip(&text.cancel, 40));
    let dialog_app = app.clone();
    let confirmed = tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
        dialog_app
            .dialog()
            .message(question)
            .title(title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(confirm, cancel))
            .blocking_show()
    })
    .await
    .map_err(|e| e.to_string())?;
    if !confirmed {
        return Ok(false);
    }
    let snapshot = with_user_endpoints(&app, &state, |u| {
        u.endpoints.insert(endpoint_id.clone(), base.clone());
        serde_json::to_string_pretty(u)
    })?
    .map_err(|e| e.to_string())?;
    save_user_endpoints(&app, &snapshot)?;
    Ok(true)
}

#[tauri::command]
pub fn ai_endpoint_remove(window: tauri::Window, app: AppHandle, state: State<'_, AiEgress>, endpoint_id: String) -> Result<(), String> {
    only_main(&window)?;
    let snapshot = with_user_endpoints(&app, &state, |u| {
        u.endpoints.remove(&endpoint_id);
        serde_json::to_string_pretty(u)
    })?
    .map_err(|e| e.to_string())?;
    save_user_endpoints(&app, &snapshot)?;
    crate::secure_store::write_slot(&app, &key_entry_name(&endpoint_id), None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn openai() -> Endpoint {
        builtin("openai").unwrap()
    }

    #[test]
    fn only_urls_under_the_endpoint_pass() {
        assert!(url_allowed(&openai(), "https://api.openai.com/v1/responses").is_ok());
        for bad in [
            "https://api.openai.com.evil.test/v1/responses",
            "https://evil.test/https://api.openai.com/v1",
            "https://user@api.openai.com/v1/responses",
            "http://api.openai.com/v1/responses",
            "https://api.openai.com:8443/v1/responses",
            "https://api.openai.com/v1/responses#frag",
            "notaurl",
        ] {
            assert!(url_allowed(&openai(), bad).is_err(), "{bad}");
        }
        let router = builtin("openrouter").unwrap();
        assert!(url_allowed(&router, "https://openrouter.ai/api/v1/chat/completions").is_ok());
        assert!(url_allowed(&router, "https://openrouter.ai/other/v1").is_err());
    }

    #[test]
    fn the_web_view_cannot_set_credentials_or_smuggle_headers() {
        let mut requested = HashMap::new();
        requested.insert("Authorization".to_string(), "Bearer stolen".to_string());
        requested.insert("x-api-key".to_string(), "k".to_string());
        requested.insert("Content-Type".to_string(), "application/json".to_string());
        requested.insert("anthropic-version".to_string(), "2023-06-01\r\nX-Evil: 1".to_string());
        let mut headers = filtered_headers(&requested);
        headers.sort();
        assert_eq!(headers, vec![("content-type".to_string(), "application/json".to_string())]);
    }

    #[test]
    fn official_openai_never_stores() {
        let url = reqwest::Url::parse("https://api.openai.com/v1/responses").unwrap();
        let mut body = serde_json::json!({ "model": "m", "store": true });
        enforce_body_rules(&openai(), &url, &mut body);
        assert_eq!(body["store"], serde_json::Value::Bool(false));
        let mut other = serde_json::json!({ "model": "m" });
        enforce_body_rules(&builtin("ollama").unwrap(), &reqwest::Url::parse("http://localhost:11434/v1/chat/completions").unwrap(), &mut other);
        assert!(other.get("store").is_none());
    }

    #[test]
    fn keys_never_come_back_in_text() {
        let key = "sk-proj-abcdefgh12345678wxyz";
        let text = format!("Incorrect API key provided: sk-proj-****wxyz. Sent {key}.");
        let out = redact(&text, Some(key));
        assert!(!out.contains(key));
        assert!(!out.contains("wxyz"));
    }

    #[test]
    fn stream_text_never_splits_a_character_and_never_stalls() {
        // "\u{e9}" is two bytes; the packet boundary falls between them.
        let mut pending = b"caf\xc3".to_vec();
        assert_eq!(take_text(&mut pending).as_deref(), Some("caf"));
        assert_eq!(pending, vec![0xc3]);
        pending.push(0xa9);
        assert_eq!(take_text(&mut pending).as_deref(), Some("\u{e9}"));
        assert!(pending.is_empty());
        // An invalid byte in the middle is replaced; the text after it still goes out.
        let mut broken = b"a\xffb".to_vec();
        assert_eq!(take_text(&mut broken).as_deref(), Some("a\u{fffd}b"));
        assert!(broken.is_empty());
        // Nothing but an incomplete sequence: wait for more.
        let mut waiting = vec![0xe2, 0x82];
        assert_eq!(take_text(&mut waiting), None);
        assert_eq!(waiting.len(), 2);
    }

    #[test]
    fn user_endpoints_are_normalised_and_plain_http_stays_local() {
        assert_eq!(normalize_base("https://Example.org/v1/").unwrap(), "https://example.org/v1/");
        assert_eq!(normalize_base("http://localhost:8080").unwrap(), "http://localhost:8080/");
        assert!(normalize_base("http://example.org/v1").is_err());
        assert!(normalize_base("https://user:pw@example.org/").is_err());
        assert!(normalize_base("file:///etc/passwd").is_err());
    }
}
