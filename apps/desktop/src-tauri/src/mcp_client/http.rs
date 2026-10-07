//! One exchange with a remote MCP server.
//!
//! The web view names a server id, protocol headers and a body. The address
//! comes from the registry, the credential from the keychain, and both stay
//! here: nothing of either goes back. No redirect is followed — a redirect
//! could carry the credential and the arguments of a call to another host —
//! and the answer is cut.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use super::registry::{read_secret, server, Server};
use super::McpClientState;
use crate::ai_egress::{only_main, take_text};

/// A listing of two hundred tools fits many times over; the protocol code in
/// the web view stops reading at four megabytes of text.
const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_HEADERS: usize = 64;
const MAX_HEADER_VALUE: usize = 8192;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum McpMethod {
    /// One JSON-RPC message.
    #[default]
    Post,
    /// The end of a session of an earlier protocol revision; no body.
    Delete,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHttpRequest {
    request_id: String,
    server_id: String,
    #[serde(default)]
    method: McpMethod,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: String,
    timeout_ms: u64,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum McpChunk {
    /// The server answered. The two headers are the ones the protocol reads.
    Open {
        status: u16,
        #[serde(rename = "contentType")]
        content_type: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        session: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        challenge: Option<String>,
    },
    /// The body, in arrival order, whatever the status.
    Data { text: String },
    Done,
    Cancelled,
    /// The request did not get an answer. `code` is one of a fixed set; a
    /// `message` is only ever a sentence written in this file.
    Failed {
        code: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<&'static str>,
    },
}

fn is_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte)
}

/// The headers the web view may set, lower-cased: the protocol's own, and the
/// ones a tool's arguments travel in. A credential, a cookie or a host is
/// never among them.
pub(crate) fn allowed_header(name: &str) -> Option<String> {
    const FIXED: [&str; 6] = ["content-type", "accept", "mcp-protocol-version", "mcp-method", "mcp-name", "mcp-session-id"];
    let lower = name.to_ascii_lowercase();
    if FIXED.contains(&lower.as_str()) {
        return Some(lower);
    }
    let rest = lower.strip_prefix("mcp-param-")?;
    (!rest.is_empty() && rest.len() <= 64 && rest.bytes().all(is_token_byte)).then_some(lower)
}

/// Visible ASCII, spaces and tabs: a line break never becomes part of a request.
pub(crate) fn header_value_ok(value: &str) -> bool {
    value.len() <= MAX_HEADER_VALUE && value.bytes().all(|byte| byte == b'\t' || (0x20..=0x7e).contains(&byte))
}

pub(crate) fn filtered_headers(requested: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut headers: Vec<(String, String)> = requested
        .iter()
        .filter(|(_, value)| header_value_ok(value))
        .filter_map(|(name, value)| allowed_header(name).map(|name| (name, value.clone())))
        .collect();
    headers.sort();
    headers.dedup_by(|a, b| a.0 == b.0);
    headers.truncate(MAX_HEADERS);
    headers
}

/// A response header as the web view gets it: printable, and no longer than it needs to be.
fn response_header(headers: &reqwest::header::HeaderMap, name: &str, max: usize) -> Option<String> {
    let value: String = headers.get(name)?.to_str().ok()?.chars().filter(|c| !c.is_control()).take(max).collect();
    (!value.is_empty()).then_some(value)
}

fn failure_code(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        return "timeout";
    }
    // A certificate that was not accepted surfaces as a connect error whose source names it.
    let text = format!("{error:?}").to_ascii_lowercase();
    if text.contains("certificate") || text.contains("tls") || text.contains("handshake") {
        return "tls";
    }
    if error.is_connect() || error.is_request() {
        return "offline";
    }
    "error"
}

fn refused(message: &'static str) -> McpChunk {
    McpChunk::Failed { code: "refused", message: Some(message) }
}

#[tauri::command]
pub async fn mcp_client_http(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>, request: McpHttpRequest, on_event: Channel<McpChunk>) -> Result<(), String> {
    only_main(&window)?;
    let answer = |chunk: McpChunk| {
        let _ = on_event.send(chunk);
        Ok(())
    };
    let Some(Server::Http { url }) = server(&app, &state, &request.server_id)? else {
        return answer(refused("no such server on this device"));
    };
    let Ok(url) = reqwest::Url::parse(&url) else {
        return answer(refused("the stored address cannot be read"));
    };
    if request.body.len() > MAX_REQUEST_BYTES {
        return answer(refused("the request is too large"));
    }
    // The server's one credential: the token the user stored, or the one a sign-in got.
    let token = match read_secret(&app, &request.server_id, None)? {
        Some(token) => Some(token),
        None => super::oauth::access_token(&app, &state, &request.server_id)?,
    };

    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    state.exchanges.lock().map_err(|_| "lock failed".to_string())?.insert(request.request_id.clone(), cancel_tx);

    // No redirects: a 3xx is an answer the protocol code is told about, never a new destination.
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut builder = match request.method {
        McpMethod::Post => client.post(url).body(request.body.clone()),
        McpMethod::Delete => client.delete(url),
    };
    for (name, value) in filtered_headers(&request.headers) {
        builder = builder.header(name, value);
    }
    if let Some(token) = token.as_deref() {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }

    let exchange = async {
        let mut response = match builder.send().await {
            Ok(response) => response,
            Err(error) => return McpChunk::Failed { code: failure_code(&error), message: None },
        };
        let _ = on_event.send(McpChunk::Open {
            status: response.status().as_u16(),
            content_type: response_header(response.headers(), "content-type", 200).unwrap_or_default(),
            session: response_header(response.headers(), "mcp-session-id", 256),
            challenge: response_header(response.headers(), "www-authenticate", 2000),
        });
        let mut pending: Vec<u8> = Vec::new();
        let mut total = 0usize;
        loop {
            match response.chunk().await {
                Err(error) => return McpChunk::Failed { code: failure_code(&error), message: None },
                Ok(None) => {
                    if !pending.is_empty() {
                        let _ = on_event.send(McpChunk::Data { text: String::from_utf8_lossy(&pending).into_owned() });
                    }
                    return McpChunk::Done;
                }
                Ok(Some(bytes)) => {
                    total += bytes.len();
                    if total > MAX_RESPONSE_BYTES {
                        return McpChunk::Failed { code: "too-large", message: None };
                    }
                    pending.extend_from_slice(&bytes);
                    if let Some(text) = take_text(&mut pending) {
                        let _ = on_event.send(McpChunk::Data { text });
                    }
                }
            }
        }
    };
    let deadline = Duration::from_millis(request.timeout_ms.clamp(1_000, 300_000));
    let outcome = tokio::select! {
        _ = &mut cancel_rx => McpChunk::Cancelled,
        result = tokio::time::timeout(deadline, exchange) => result.unwrap_or(McpChunk::Failed { code: "timeout", message: None }),
    };

    if let Ok(mut exchanges) = state.exchanges.lock() {
        exchanges.remove(&request.request_id);
    }
    answer(outcome)
}

/// Hangs up on an exchange: the protocol's way to stop a request over HTTP.
#[tauri::command]
pub fn mcp_client_cancel(state: State<'_, McpClientState>, request_id: String) -> Result<bool, String> {
    let sender = state.exchanges.lock().map_err(|_| "lock failed".to_string())?.remove(&request_id);
    Ok(sender.map(|s| s.send(()).is_ok()).unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_protocol_headers_pass() {
        for (name, lower) in [
            ("Content-Type", "content-type"),
            ("Accept", "accept"),
            ("MCP-Protocol-Version", "mcp-protocol-version"),
            ("Mcp-Method", "mcp-method"),
            ("Mcp-Name", "mcp-name"),
            ("Mcp-Session-Id", "mcp-session-id"),
            ("Mcp-Param-Region", "mcp-param-region"),
            ("mcp-param-x_y.z", "mcp-param-x_y.z"),
        ] {
            assert_eq!(allowed_header(name).as_deref(), Some(lower), "{name}");
        }
        for name in [
            "Authorization",
            "Cookie",
            "Host",
            "Origin",
            "X-Api-Key",
            "Proxy-Authorization",
            "Mcp-Param-",
            "Mcp-Param-Bad Name",
            "Mcp-Param-a:b",
            "Mcp-Param-a\r\nAuthorization",
            "Mcp-Other",
            "",
        ] {
            assert_eq!(allowed_header(name), None, "{name}");
        }
        assert_eq!(allowed_header(&format!("Mcp-Param-{}", "a".repeat(65))), None);
    }

    #[test]
    fn a_header_value_is_visible_ascii() {
        assert!(header_value_ok("application/json, text/event-stream"));
        assert!(header_value_ok("=?base64?SGVsbG8sIOS4lueVjA==?="));
        assert!(header_value_ok("a\tb"));
        assert!(header_value_ok(""));
        for bad in ["a\r\nb", "a\nb", "a\u{0}b", "caf\u{e9}", "a\u{7f}b"] {
            assert!(!header_value_ok(bad), "{bad:?}");
        }
        assert!(!header_value_ok(&"a".repeat(MAX_HEADER_VALUE + 1)));
    }

    #[test]
    fn what_does_not_pass_is_left_out_not_sent_differently() {
        let mut requested = HashMap::new();
        requested.insert("Mcp-Method".to_string(), "tools/call".to_string());
        requested.insert("Authorization".to_string(), "Bearer stolen".to_string());
        requested.insert("Mcp-Name".to_string(), "bad\r\nvalue".to_string());
        requested.insert("mcp-method".to_string(), "tools/list".to_string());
        let headers = filtered_headers(&requested);
        assert_eq!(headers.len(), 1);
        assert_eq!(headers[0].0, "mcp-method");
    }

    #[test]
    fn the_chunks_have_the_shape_the_protocol_code_reads() {
        let open = serde_json::to_value(McpChunk::Open { status: 200, content_type: "application/json".into(), session: None, challenge: Some("Bearer".into()) }).unwrap();
        assert_eq!(open, serde_json::json!({ "type": "open", "status": 200, "contentType": "application/json", "challenge": "Bearer" }));
        assert_eq!(serde_json::to_value(McpChunk::Done).unwrap(), serde_json::json!({ "type": "done" }));
        assert_eq!(serde_json::to_value(McpChunk::Failed { code: "timeout", message: None }).unwrap(), serde_json::json!({ "type": "failed", "code": "timeout" }));
        assert_eq!(serde_json::to_value(refused("no such server on this device")).unwrap(), serde_json::json!({ "type": "failed", "code": "refused", "message": "no such server on this device" }));
    }

    #[test]
    fn a_request_names_a_server_and_nothing_else_about_where_it_goes() {
        let request: McpHttpRequest = serde_json::from_value(serde_json::json!({
            "requestId": "r1", "serverId": "tracker", "method": "POST", "headers": {}, "body": "{}", "timeoutMs": 1000,
            "url": "https://evil.example/", "authorization": "Bearer x"
        }))
        .unwrap();
        assert_eq!(request.server_id, "tracker");
        assert_eq!(request.method, McpMethod::Post);
        assert!(serde_json::from_value::<McpHttpRequest>(serde_json::json!({ "requestId": "r1", "serverId": "t", "method": "GET", "timeoutMs": 1 })).is_err());
    }
}
