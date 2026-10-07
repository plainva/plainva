//! Signing in to a remote server: OAuth 2.1 with PKCE (plan KI-Harness P4.5).
//!
//! The web view opens a browser and hands back what it returned with. That
//! is all it does: the verifier, the exchange of the code, the tokens and
//! their renewal stay here, and so does the choice of WHERE a code or a token
//! is sent — the endpoints come from a document this module fetched itself,
//! from an address on the authorization server's own origin, whose `issuer`
//! is the one that was asked for, letter for letter. A token is asked for the
//! server's registered address (or the part of it the server names as
//! itself), kept under the server's id, and put into requests to that address
//! only (`http.rs`).
//!
//! The rule functions decide the same as `packages/core/src/ai/mcp/oauthRules.ts`,
//! and the tests below run the same lists (`MCP_OAUTH_*_CASES` of
//! `oauthRules.test.ts`): a case added there is added here.

use std::collections::{BTreeMap, HashMap};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};

use super::registry::{normalize_url, server, Server, MCP_KEY_PREFIX};
use super::McpClientState;
use crate::ai_egress::only_main;
use crate::ai_web::{check_web_url, is_public_address};

const LINKS_FILE: &str = "ai-mcp-oauth.json";
/// A document of a sign-in is small; more than this is not one.
const MAX_REPLY_BYTES: usize = 256 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const DEADLINE: Duration = Duration::from_secs(20);
/// The longest a begun sign-in waits for its browser.
const PENDING: Duration = Duration::from_secs(600);
/// A renewal this fresh is not made again: a second request that was refused with the old token finds the new one.
const RECENT: Duration = Duration::from_secs(10);
const MAX_TOKEN: usize = 16_384;
const MAX_SCOPES: usize = 50;
/// The Windows credential store takes 2,560 bytes per entry: a long token is kept in parts.
const PART: usize = 1000;
const MAX_PARTS: usize = 64;
// The longest token there is fits into the parts there are.
const _: () = assert!(MAX_TOKEN <= PART * MAX_PARTS);

// ---------------------------------------------------------------- the rules

/// An address a server names for its sign-in — a document, an endpoint — as
/// it may be asked. On the server's own host it follows the rule the server's
/// address followed when the user confirmed it; everywhere else it is a
/// public https address on the default port, like a page the assistant reads.
pub(crate) fn oauth_address(raw: &str, server_url: &str) -> Option<reqwest::Url> {
    if raw.contains('#') {
        return None;
    }
    let own = reqwest::Url::parse(&normalize_url(server_url).ok()?).ok()?;
    let named = reqwest::Url::parse(&normalize_url(raw).ok()?).ok()?;
    if named.host_str() == own.host_str() {
        return Some(named);
    }
    check_web_url(raw).ok().map(|target| target.url)
}

/// An authorization server's metadata is read from its own origin, under
/// `/.well-known/` — where nobody but the one who runs that origin puts a
/// document. That, and the `issuer` inside, ties the endpoints to the name.
pub(crate) fn issuer_document_url_ok(issuer: &str, url: &str) -> bool {
    if issuer.contains('#') || issuer.contains('?') || url.contains('#') {
        return false;
    }
    let parsed = |text: &str| normalize_url(text).ok().and_then(|address| reqwest::Url::parse(&address).ok());
    match (parsed(issuer), parsed(url)) {
        (Some(named), Some(asked)) => named.origin() == asked.origin() && asked.path().contains("/.well-known/"),
        _ => false,
    }
}

/// A scope as RFC 6749 spells one: visible ASCII without the quote and the backslash.
pub(crate) fn scope_ok(scope: &str) -> bool {
    !scope.is_empty() && scope.len() <= 200 && scope.bytes().all(|byte| byte == 0x21 || (0x23..=0x5b).contains(&byte) || (0x5d..=0x7e).contains(&byte))
}

/// The scopes of a space-separated list or of a list of strings: each once, in order.
pub(crate) fn read_scopes(value: Option<&serde_json::Value>) -> Vec<String> {
    let parts: Vec<&str> = match value {
        Some(serde_json::Value::String(text)) => text.split(' ').collect(),
        Some(serde_json::Value::Array(list)) => list.iter().filter_map(|entry| entry.as_str()).collect(),
        _ => Vec::new(),
    };
    let mut out: Vec<String> = Vec::new();
    for part in parts {
        if scope_ok(part) && !out.iter().any(|known| known == part) && out.len() < MAX_SCOPES {
            out.push(part.to_string());
        }
    }
    out
}

/// An authorization server as it is kept for a sign-in.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Endpoints {
    pub(crate) issuer: String,
    pub(crate) authorization: String,
    pub(crate) token: String,
    pub(crate) registration: Option<String>,
    pub(crate) document: bool,
    pub(crate) iss: bool,
    pub(crate) scopes: Vec<String>,
}

/// Reads an authorization server's metadata (RFC 8414). It counts only when
/// it names the issuer it was asked as; its endpoints are addresses under the
/// rule above; and it says it does PKCE with SHA-256.
pub(crate) fn read_issuer_document(body: &str, issuer: &str, server_url: &str) -> Result<Endpoints, &'static str> {
    let raw: serde_json::Value = serde_json::from_str(body).map_err(|_| "oauth-no-metadata")?;
    let document = raw.as_object().ok_or("oauth-no-metadata")?;
    if document.get("issuer").and_then(|value| value.as_str()) != Some(issuer) {
        return Err("oauth-issuer");
    }
    let endpoint = |name: &str| document.get(name).and_then(|value| value.as_str()).and_then(|value| oauth_address(value, server_url)).map(String::from);
    let (Some(authorization), Some(token)) = (endpoint("authorization_endpoint"), endpoint("token_endpoint")) else {
        return Err("oauth-endpoints");
    };
    let lists = |name: &str, wanted: &str| document.get(name).and_then(|value| value.as_array()).map(|list| list.iter().any(|entry| entry.as_str() == Some(wanted)));
    if lists("response_types_supported", "code") == Some(false) {
        return Err("oauth-endpoints");
    }
    if lists("code_challenge_methods_supported", "S256") != Some(true) {
        return Err("oauth-no-pkce");
    }
    let flag = |name: &str| document.get(name).and_then(|value| value.as_bool()) == Some(true);
    Ok(Endpoints {
        issuer: issuer.to_string(),
        authorization,
        token,
        registration: endpoint("registration_endpoint"),
        document: flag("client_id_metadata_document_supported"),
        iss: flag("authorization_response_iss_parameter_supported"),
        scopes: read_scopes(document.get("scopes_supported")),
    })
}

/// Does what a server names as itself cover its registered address? The same
/// origin, and a path that is the address's own or a part of it that ends
/// where a segment ends. A token is asked for exactly this name.
pub(crate) fn resource_covers(resource: &str, server_url: &str) -> bool {
    if resource.contains('#') {
        return false;
    }
    let parsed = |text: &str| normalize_url(text).ok().and_then(|address| reqwest::Url::parse(&address).ok());
    let (Some(named), Some(own)) = (parsed(resource), parsed(server_url.split('#').next().unwrap_or(""))) else {
        return false;
    };
    if named.query().is_some_and(|query| !query.is_empty()) || named.origin() != own.origin() {
        return false;
    }
    let part = named.path().trim_end_matches('/');
    let whole = own.path().trim_end_matches('/');
    whole == part || whole.starts_with(&format!("{part}/"))
}

/// Where the browser comes back to: a port on this computer.
pub(crate) fn redirect_uri(port: u16) -> Option<String> {
    (port >= 1024).then(|| format!("http://127.0.0.1:{port}/callback"))
}

/// A client id: printable ASCII, at most 512 characters. As the address of
/// Plainva's own description it is a public https address with a path.
pub(crate) fn client_id(document: bool, id: &str) -> Option<String> {
    let text = id.trim();
    if text.is_empty() || text.len() > 512 || !text.bytes().all(|byte| (0x20..=0x7e).contains(&byte)) {
        return None;
    }
    if document && (text.contains('#') || !check_web_url(text).is_ok_and(|target| target.url.path() != "/")) {
        return None;
    }
    Some(text.to_string())
}

const OUR_PARAMS: [&str; 8] = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "resource", "scope"];

/// The address the browser is sent to. What the endpoint already carries in its query stays.
pub(crate) fn authorization_url(endpoint: &str, client: &str, redirect: &str, challenge: &str, state: &str, scopes: &[String], resource: &str) -> Result<String, &'static str> {
    let mut url = reqwest::Url::parse(endpoint).map_err(|_| "oauth-endpoints")?;
    let kept: Vec<(String, String)> = url.query_pairs().filter(|(name, _)| !OUR_PARAMS.contains(&name.as_ref())).map(|(name, value)| (name.into_owned(), value.into_owned())).collect();
    {
        let mut query = url.query_pairs_mut();
        query.clear();
        query.extend_pairs(kept);
        query.append_pair("response_type", "code");
        query.append_pair("client_id", client);
        query.append_pair("redirect_uri", redirect);
        query.append_pair("code_challenge", challenge);
        query.append_pair("code_challenge_method", "S256");
        query.append_pair("state", state);
        query.append_pair("resource", resource);
        if !scopes.is_empty() {
            query.append_pair("scope", &scopes.join(" "));
        }
    }
    Ok(url.into())
}

/// The challenge of a verifier (RFC 7636 §4.2).
pub(crate) fn pkce_challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn random(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).map_err(|error| error.to_string())?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buffer))
}

/// What the browser came back with. Worth nothing without what is kept here.
#[derive(Deserialize, Default)]
pub struct OAuthRedirect {
    #[serde(default)]
    state: String,
    code: Option<String>,
    iss: Option<String>,
    error: Option<String>,
}

/// What came back, against what was begun (`state`, issuer, whether the
/// issuer promised to name itself). Who answered must be who was asked
/// (RFC 9207) — before anything of the answer is used, an error included.
pub(crate) fn check_redirect(pending: Option<(&str, &str, bool)>, redirect: &OAuthRedirect) -> Result<String, &'static str> {
    let Some((state, issuer, promised)) = pending else {
        return Err("oauth-no-flow");
    };
    if redirect.state.is_empty() || redirect.state != state {
        return Err("oauth-no-flow");
    }
    let named = match redirect.iss.as_deref() {
        Some(iss) => iss == issuer,
        None => !promised,
    };
    if !named {
        return Err("oauth-issuer");
    }
    if let Some(error) = redirect.error.as_deref() {
        return Err(if error == "access_denied" { "oauth-denied" } else { "oauth-failed" });
    }
    match redirect.code.as_deref() {
        Some(code) if !code.is_empty() => Ok(code.to_string()),
        _ => Err("oauth-failed"),
    }
}

/// How a client proves who it is at the token endpoint: not at all (a public
/// client), or with a secret a registration handed out.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ClientAuth {
    None,
    Post,
    Basic,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ClientKind {
    Document,
    Dynamic,
    Manual,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Client {
    pub(crate) id: String,
    pub(crate) auth: ClientAuth,
    pub(crate) secret: Option<String>,
}

pub(crate) enum Grant<'a> {
    Code { code: &'a str, verifier: &'a str, redirect: &'a str },
    Refresh { token: &'a str },
}

/// The fields of a token request, in order. A secret travels in the body only where the registration said so.
pub(crate) fn token_form(grant: &Grant<'_>, client: &Client, resource: &str) -> Vec<(&'static str, String)> {
    let mut fields: Vec<(&'static str, String)> = match grant {
        Grant::Code { code, verifier, redirect } => vec![
            ("grant_type", "authorization_code".to_string()),
            ("code", code.to_string()),
            ("redirect_uri", redirect.to_string()),
            ("code_verifier", verifier.to_string()),
        ],
        Grant::Refresh { token } => vec![("grant_type", "refresh_token".to_string()), ("refresh_token", token.to_string())],
    };
    fields.push(("client_id", client.id.clone()));
    fields.push(("resource", resource.to_string()));
    if let (ClientAuth::Post, Some(secret)) = (client.auth, client.secret.as_ref()) {
        fields.push(("client_secret", secret.clone()));
    }
    fields
}

/// One value of a form (application/x-www-form-urlencoded).
pub(crate) fn form_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => out.push(byte as char),
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

fn form_body(fields: &[(&'static str, String)]) -> String {
    fields.iter().map(|(name, value)| format!("{name}={}", form_encode(value))).collect::<Vec<_>>().join("&")
}

/// A token is visible ASCII without a space: anything else would end the header it travels in.
fn token_ok(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_TOKEN && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

#[derive(Debug, PartialEq)]
pub(crate) struct Tokens {
    pub(crate) access: String,
    pub(crate) refresh: Option<String>,
    /// Seconds from now.
    pub(crate) expires_in: Option<u64>,
    pub(crate) scopes: Option<Vec<String>>,
}

/// Reads a token endpoint's answer. Only a bearer token is one; a refresh
/// token that was refused for good (`invalid_grant`) says so.
pub(crate) fn read_token_response(status: u16, body: &str) -> Result<Tokens, &'static str> {
    let raw: serde_json::Value = serde_json::from_str(body).map_err(|_| "oauth-token")?;
    let answer = raw.as_object().ok_or("oauth-token")?;
    let text = |name: &str| answer.get(name).and_then(|value| value.as_str());
    if status != 200 {
        return Err(if status == 400 && text("error") == Some("invalid_grant") { "oauth-grant" } else { "oauth-token" });
    }
    if !text("token_type").is_some_and(|kind| kind.eq_ignore_ascii_case("bearer")) {
        return Err("oauth-token");
    }
    let access = text("access_token").filter(|token| token_ok(token)).ok_or("oauth-token")?.to_string();
    let refresh = match answer.get("refresh_token") {
        None | Some(serde_json::Value::Null) => None,
        Some(value) => Some(value.as_str().filter(|token| token_ok(token)).ok_or("oauth-token")?.to_string()),
    };
    let expires_in = answer.get("expires_in").and_then(|value| value.as_f64()).filter(|seconds| seconds.is_finite() && *seconds >= 1.0).map(|seconds| (seconds.floor() as u64).min(10 * 365 * 24 * 3600));
    let scopes = answer.get("scope").filter(|value| value.is_string()).map(|value| read_scopes(Some(value)));
    Ok(Tokens { access, refresh, expires_in, scopes })
}

/// What a client that registers itself says about itself (RFC 7591): a native app, without a secret.
pub(crate) fn registration_body(client_name: &str, redirect: &str) -> serde_json::Value {
    serde_json::json!({
        "client_name": client_name.chars().take(80).collect::<String>(),
        "redirect_uris": [redirect],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "application_type": "native",
    })
}

/// Reads a registration's answer: the id, and a secret where the server insists on one.
pub(crate) fn read_registration(status: u16, body: &str) -> Option<Client> {
    if status != 200 && status != 201 {
        return None;
    }
    let raw: serde_json::Value = serde_json::from_str(body).ok()?;
    let answer = raw.as_object()?;
    let id = client_id(false, answer.get("client_id")?.as_str()?)?;
    let secret = match answer.get("client_secret") {
        None | Some(serde_json::Value::Null) => None,
        Some(value) => Some(value.as_str().filter(|secret| token_ok(secret))?.to_string()),
    };
    let method = match answer.get("token_endpoint_auth_method") {
        None | Some(serde_json::Value::Null) => None,
        Some(value) => Some(value.as_str()?),
    };
    match (secret, method) {
        (None, None | Some("none")) => Some(Client { id, auth: ClientAuth::None, secret: None }),
        (None, _) => None,
        (Some(secret), Some("client_secret_post")) => Some(Client { id, auth: ClientAuth::Post, secret: Some(secret) }),
        // The default of a client with a secret (RFC 7591 §2).
        (Some(secret), None | Some("client_secret_basic")) => Some(Client { id, auth: ClientAuth::Basic, secret: Some(secret) }),
        // A secret that came with "none" is not used: the client stays a public one.
        (Some(_), Some("none")) => Some(Client { id, auth: ClientAuth::None, secret: None }),
        (Some(_), _) => None,
    }
}

/// A long value as the parts it is stored in.
pub(crate) fn split_long(value: &str) -> Vec<String> {
    value.as_bytes().chunks(PART).map(|part| String::from_utf8_lossy(part).into_owned()).collect()
}

// ---------------------------------------------------------------- what is kept

/// A sign-in as it is written down: everything about it that is no secret.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Link {
    issuer: String,
    token_endpoint: String,
    client_id: String,
    auth: ClientAuth,
    kind: ClientKind,
    redirect_uri: String,
    resource: String,
    scopes: Vec<String>,
    /// Unix time in seconds.
    expires_at: Option<u64>,
    signed_in: bool,
    renewable: bool,
}

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Links {
    links: BTreeMap<String, Link>,
}

struct Pending {
    server_id: String,
    server_url: String,
    endpoints: Endpoints,
    client: Client,
    kind: ClientKind,
    verifier: String,
    state: String,
    redirect: String,
    scopes: Vec<String>,
    resource: String,
    begun: Instant,
}

/// The part of the module's state that belongs to sign-ins.
#[derive(Default)]
pub struct OAuthState {
    links: Mutex<Option<Links>>,
    /// The authorization server each server was last asked about.
    issuers: Mutex<HashMap<String, Endpoints>>,
    pending: Mutex<Option<Pending>>,
    /// The access tokens that were read from the keychain already.
    access: Mutex<HashMap<String, String>>,
    renewed: Mutex<HashMap<String, Instant>>,
    /// One renewal at a time: a token for the next is used once.
    lane: tokio::sync::Mutex<()>,
}

fn links_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(LINKS_FILE))
}

fn with_links<T>(app: &AppHandle, state: &McpClientState, run: impl FnOnce(&mut Links) -> T) -> Result<T, String> {
    let mut guard = state.oauth.links.lock().map_err(|_| "sign-in lock failed".to_string())?;
    if guard.is_none() {
        // A file that cannot be read is no sign-in: the user signs in again.
        let loaded = std::fs::read_to_string(links_file(app)?).ok().and_then(|text| serde_json::from_str::<Links>(&text).ok()).unwrap_or_default();
        *guard = Some(loaded);
    }
    Ok(run(guard.as_mut().expect("loaded above")))
}

fn change_links(app: &AppHandle, state: &McpClientState, run: impl FnOnce(&mut Links)) -> Result<(), String> {
    let snapshot = with_links(app, state, |links| {
        run(links);
        serde_json::to_string_pretty(links)
    })?
    .map_err(|e| e.to_string())?;
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    crate::atomic_write::write_atomic_impl(&root, LINKS_FILE, snapshot.as_bytes())
}

fn link_of(app: &AppHandle, state: &McpClientState, id: &str) -> Result<Option<Link>, String> {
    with_links(app, state, |links| links.links.get(id).cloned())
}

/// `ai-mcp:<id>#access`, `#refresh`, `#client`: an id has no `#`, so these are nobody else's slots.
fn slot(id: &str, what: &str) -> String {
    format!("{MCP_KEY_PREFIX}{id}#{what}")
}

fn write_long(app: &AppHandle, slot: &str, value: Option<&str>) -> Result<(), String> {
    if let Some(count) = crate::secure_store::read_slot(app, slot)?.and_then(|count| count.parse::<usize>().ok()) {
        for index in 0..count.min(MAX_PARTS) {
            crate::secure_store::write_slot(app, &format!("{slot}.{index}"), None)?;
        }
    }
    let Some(value) = value else {
        return crate::secure_store::write_slot(app, slot, None);
    };
    let parts = split_long(value);
    for (index, part) in parts.iter().enumerate() {
        crate::secure_store::write_slot(app, &format!("{slot}.{index}"), Some(part))?;
    }
    crate::secure_store::write_slot(app, slot, Some(&parts.len().to_string()))
}

fn read_long(app: &AppHandle, slot: &str) -> Result<Option<String>, String> {
    let Some(count) = crate::secure_store::read_slot(app, slot)? else {
        return Ok(None);
    };
    let count: usize = count.parse().map_err(|_| "a stored value cannot be read".to_string())?;
    let mut value = String::new();
    for index in 0..count.min(MAX_PARTS) {
        value.push_str(&crate::secure_store::read_slot(app, &format!("{slot}.{index}"))?.ok_or("a part of a stored value is missing")?);
    }
    Ok(Some(value))
}

fn forget_tokens(app: &AppHandle, state: &McpClientState, id: &str) -> Result<(), String> {
    if let Ok(mut access) = state.oauth.access.lock() {
        access.remove(id);
    }
    write_long(app, &slot(id, "access"), None)?;
    write_long(app, &slot(id, "refresh"), None)
}

/// Everything about a sign-in goes: the tokens, who Plainva was to the
/// authorization server, a sign-in that was begun. Called when a server is
/// removed or registered anew, when a fixed token takes its place, and when
/// the user signs out.
pub(crate) fn forget(app: &AppHandle, state: &McpClientState, id: &str) -> Result<(), String> {
    if let Ok(mut pending) = state.oauth.pending.lock() {
        if pending.as_ref().is_some_and(|flow| flow.server_id == id) {
            *pending = None;
        }
    }
    if let Ok(mut issuers) = state.oauth.issuers.lock() {
        issuers.remove(id);
    }
    forget_tokens(app, state, id)?;
    write_long(app, &slot(id, "client"), None)?;
    if link_of(app, state, id)?.is_some() {
        change_links(app, state, |links| {
            links.links.remove(id);
        })?;
    }
    Ok(())
}

/// The credential of a request to a server that is signed in to; nothing where it is not.
pub(crate) fn access_token(app: &AppHandle, state: &McpClientState, id: &str) -> Result<Option<String>, String> {
    if let Some(known) = state.oauth.access.lock().map_err(|_| "sign-in lock failed".to_string())?.get(id) {
        return Ok(Some(known.clone()));
    }
    if !link_of(app, state, id)?.is_some_and(|link| link.signed_in) {
        return Ok(None);
    }
    let Some(token) = read_long(app, &slot(id, "access"))? else {
        return Ok(None);
    };
    state.oauth.access.lock().map_err(|_| "sign-in lock failed".to_string())?.insert(id.to_string(), token.clone());
    Ok(Some(token))
}

fn now_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|since| since.as_secs()).unwrap_or(0)
}

/// Writes down a sign-in and its tokens. `refresh` None keeps the token for the next that is there.
fn keep(app: &AppHandle, state: &McpClientState, id: &str, mut link: Link, tokens: &Tokens, client_secret: Option<&str>) -> Result<(), String> {
    write_long(app, &slot(id, "access"), Some(&tokens.access))?;
    if let Some(refresh) = tokens.refresh.as_deref() {
        write_long(app, &slot(id, "refresh"), Some(refresh))?;
    }
    write_long(app, &slot(id, "client"), client_secret)?;
    link.signed_in = true;
    link.renewable = read_long(app, &slot(id, "refresh"))?.is_some();
    link.expires_at = tokens.expires_in.map(|seconds| now_seconds() + seconds);
    if let Some(scopes) = tokens.scopes.as_ref() {
        link.scopes = scopes.clone();
    }
    change_links(app, state, |links| {
        links.links.insert(id.to_string(), link);
    })?;
    state.oauth.access.lock().map_err(|_| "sign-in lock failed".to_string())?.insert(id.to_string(), tokens.access.clone());
    Ok(())
}

// ---------------------------------------------------------------- the requests

enum Ask<'a> {
    Get,
    Form(&'a [(&'static str, String)], Option<(&'a str, &'a str)>),
    Json(&'a str),
}

struct Reply {
    status: u16,
    body: String,
}

/// One request of a sign-in. An address on the server's own host is the one
/// the user confirmed; every other one must resolve to public addresses, and
/// the connection goes to exactly those — no second lookup that could answer
/// differently. No redirect is followed; the answer is cut.
async fn ask(url: &reqwest::Url, server_url: &str, what: Ask<'_>) -> Result<Reply, &'static str> {
    let host = url.host_str().ok_or("oauth-address")?.to_string();
    let own = reqwest::Url::parse(server_url).ok().and_then(|own| own.host_str().map(str::to_owned));
    let mut builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).connect_timeout(CONNECT_TIMEOUT);
    if own.as_deref() != Some(host.as_str()) {
        let found = tokio::net::lookup_host((host.as_str(), url.port_or_known_default().unwrap_or(443))).await.map_err(|_| "oauth-unreachable")?;
        let addresses: Vec<SocketAddr> = found.collect();
        if addresses.is_empty() {
            return Err("oauth-unreachable");
        }
        if addresses.iter().any(|address| !is_public_address(address.ip())) {
            return Err("oauth-address");
        }
        builder = builder.https_only(true).resolve_to_addrs(&host, &addresses);
    }
    let client = builder.build().map_err(|_| "oauth-unreachable")?;
    let request = match what {
        Ask::Get => client.get(url.clone()),
        Ask::Form(fields, basic) => {
            let request = client.post(url.clone()).header("content-type", "application/x-www-form-urlencoded").body(form_body(fields));
            match basic {
                // The id and the secret are form-encoded before they are joined (RFC 6749 §2.3.1).
                Some((id, secret)) => request.header("authorization", format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", form_encode(id), form_encode(secret))))),
                None => request,
            }
        }
        Ask::Json(body) => client.post(url.clone()).header("content-type", "application/json").body(body.to_string()),
    }
    .header("accept", "application/json");
    let exchange = async {
        let mut response = request.send().await.map_err(|_| "oauth-unreachable")?;
        let status = response.status().as_u16();
        let mut bytes: Vec<u8> = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "oauth-unreachable")? {
            if bytes.len() + chunk.len() > MAX_REPLY_BYTES {
                return Err("oauth-unreachable");
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(Reply { status, body: String::from_utf8_lossy(&bytes).into_owned() })
    };
    tokio::time::timeout(DEADLINE, exchange).await.unwrap_or(Err("oauth-unreachable"))
}

fn basic_of(client: &Client) -> Option<(&str, &str)> {
    match (client.auth, client.secret.as_deref()) {
        (ClientAuth::Basic, Some(secret)) => Some((client.id.as_str(), secret)),
        _ => None,
    }
}

/// The registered address of a remote server; a program signs in to nothing.
fn remote(app: &AppHandle, state: &McpClientState, id: &str) -> Result<String, String> {
    match server(app, state, id)? {
        Some(Server::Http { url }) => Ok(url),
        _ => Err("oauth-address".into()),
    }
}

// ---------------------------------------------------------------- the commands

#[derive(Serialize)]
pub struct OAuthDocument {
    status: u16,
    body: String,
}

/// A document a server names for its sign-in (its resource metadata, RFC 9728). No secret, and none is sent.
#[tauri::command]
pub async fn mcp_client_oauth_document(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>, server_id: String, url: String) -> Result<OAuthDocument, String> {
    only_main(&window)?;
    let server_url = remote(&app, &state, &server_id)?;
    let address = oauth_address(&url, &server_url).ok_or("oauth-address")?;
    let reply = ask(&address, &server_url, Ask::Get).await?;
    Ok(OAuthDocument { status: reply.status, body: reply.body })
}

/// What the web view is told about an authorization server: what it offers, not where its endpoints are.
#[derive(Serialize)]
pub struct OAuthIssuerInfo {
    issuer: String,
    document: bool,
    dynamic: bool,
    iss: bool,
    scopes: Vec<String>,
}

/// Reads an authorization server's metadata from an address on its own origin and keeps it for the sign-in.
#[tauri::command]
pub async fn mcp_client_oauth_issuer(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>, server_id: String, issuer: String, url: String) -> Result<OAuthIssuerInfo, String> {
    only_main(&window)?;
    let server_url = remote(&app, &state, &server_id)?;
    if !issuer_document_url_ok(&issuer, &url) {
        return Err("oauth-address".into());
    }
    let address = oauth_address(&url, &server_url).ok_or("oauth-address")?;
    let reply = ask(&address, &server_url, Ask::Get).await?;
    if reply.status != 200 {
        return Err("oauth-no-metadata".into());
    }
    let endpoints = read_issuer_document(&reply.body, &issuer, &server_url)?;
    let info = OAuthIssuerInfo { issuer: endpoints.issuer.clone(), document: endpoints.document, dynamic: endpoints.registration.is_some(), iss: endpoints.iss, scopes: endpoints.scopes.clone() };
    state.oauth.issuers.lock().map_err(|_| "sign-in lock failed".to_string())?.insert(server_id, endpoints);
    Ok(info)
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum OAuthClientChoice {
    Stored,
    Document { id: String },
    Dynamic,
    Manual { id: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthBegin {
    issuer: String,
    #[serde(default)]
    scopes: Vec<String>,
    resource: String,
    client: OAuthClientChoice,
    client_name: String,
    redirect_port: Option<u16>,
}

/// Begins a sign-in: decides who Plainva is to the authorization server,
/// makes the verifier and the state, and answers with the address to open.
/// The verifier stays here.
#[tauri::command]
pub async fn mcp_client_oauth_begin(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>, server_id: String, request: OAuthBegin) -> Result<String, String> {
    only_main(&window)?;
    let server_url = remote(&app, &state, &server_id)?;
    let endpoints = state.oauth.issuers.lock().map_err(|_| "sign-in lock failed".to_string())?.get(&server_id).filter(|known| known.issuer == request.issuer).cloned().ok_or("oauth-no-metadata")?;
    if !resource_covers(&request.resource, &server_url) {
        return Err("oauth-resource".into());
    }
    let redirect = request.redirect_port.and_then(redirect_uri).ok_or("oauth-address")?;
    let scopes: Vec<String> = request.scopes.iter().filter(|scope| scope_ok(scope)).take(MAX_SCOPES).cloned().collect();
    let kept = link_of(&app, &state, &server_id)?.filter(|link| link.issuer == endpoints.issuer);
    let (client, kind) = match (&request.client, kept) {
        (OAuthClientChoice::Document { id }, _) => {
            if !endpoints.document {
                return Err("oauth-client".into());
            }
            (Client { id: client_id(true, id).ok_or("oauth-client")?, auth: ClientAuth::None, secret: None }, ClientKind::Document)
        }
        (OAuthClientChoice::Manual { id }, _) => (Client { id: client_id(false, id).ok_or("oauth-client")?, auth: ClientAuth::None, secret: None }, ClientKind::Manual),
        (_, Some(link)) if link.kind != ClientKind::Dynamic || link.redirect_uri == redirect => {
            (Client { id: link.client_id.clone(), auth: link.auth, secret: read_long(&app, &slot(&server_id, "client"))? }, link.kind)
        }
        (OAuthClientChoice::Stored, None) => return Err("oauth-client".into()),
        // A registration is for one way back: another one is another registration.
        _ => {
            let address = endpoints.registration.as_deref().and_then(|registration| reqwest::Url::parse(registration).ok()).ok_or("oauth-client")?;
            let body = registration_body(&request.client_name, &redirect).to_string();
            let reply = ask(&address, &server_url, Ask::Json(&body)).await?;
            (read_registration(reply.status, &reply.body).ok_or("oauth-registration")?, ClientKind::Dynamic)
        }
    };
    let verifier = random(32)?;
    let state_value = random(16)?;
    let url = authorization_url(&endpoints.authorization, &client.id, &redirect, &pkce_challenge(&verifier), &state_value, &scopes, &request.resource)?;
    *state.oauth.pending.lock().map_err(|_| "sign-in lock failed".to_string())? =
        Some(Pending { server_id, server_url, endpoints, client, kind, verifier, state: state_value, redirect, scopes, resource: request.resource, begun: Instant::now() });
    Ok(url)
}

/// Ends a sign-in with what the browser came back with: checks it against
/// what was begun, exchanges the code and keeps the tokens. Answers with the
/// id of the server that is signed in to now — and with nothing else.
#[tauri::command]
pub async fn mcp_client_oauth_finish(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>, redirect: OAuthRedirect) -> Result<String, String> {
    only_main(&window)?;
    let (flow, code) = {
        let mut pending = state.oauth.pending.lock().map_err(|_| "sign-in lock failed".to_string())?;
        let live = pending.as_ref().filter(|flow| flow.begun.elapsed() < PENDING);
        let checked = check_redirect(live.map(|flow| (flow.state.as_str(), flow.endpoints.issuer.as_str(), flow.endpoints.iss)), &redirect);
        // An answer to nothing that was begun leaves what was begun alone: the real one may still come.
        if checked == Err("oauth-no-flow") {
            return Err("oauth-no-flow".into());
        }
        (pending.take().ok_or("oauth-no-flow")?, checked)
    };
    let code = code?;
    // The server may have gone, or become another one, while the browser was open.
    if remote(&app, &state, &flow.server_id).ok().as_deref() != Some(flow.server_url.as_str()) {
        return Err("oauth-no-flow".into());
    }
    let address = reqwest::Url::parse(&flow.endpoints.token).map_err(|_| "oauth-endpoints")?;
    let fields = token_form(&Grant::Code { code: &code, verifier: &flow.verifier, redirect: &flow.redirect }, &flow.client, &flow.resource);
    let reply = ask(&address, &flow.server_url, Ask::Form(&fields, basic_of(&flow.client))).await?;
    let tokens = read_token_response(reply.status, &reply.body)?;
    // A sign-in and a fixed token exclude each other, and so does the token for the next of an earlier sign-in.
    forget_tokens(&app, &state, &flow.server_id)?;
    crate::secure_store::write_slot(&app, &super::registry::secret_slot(&flow.server_id, None), None)?;
    let link = Link {
        issuer: flow.endpoints.issuer.clone(),
        token_endpoint: flow.endpoints.token.clone(),
        client_id: flow.client.id.clone(),
        auth: flow.client.auth,
        kind: flow.kind,
        redirect_uri: flow.redirect.clone(),
        resource: flow.resource.clone(),
        scopes: flow.scopes.clone(),
        expires_at: None,
        signed_in: true,
        renewable: false,
    };
    keep(&app, &state, &flow.server_id, link, &tokens, flow.client.secret.as_deref())?;
    Ok(flow.server_id)
}

/// Forgets a sign-in that was begun and will not be finished.
#[tauri::command]
pub fn mcp_client_oauth_cancel(window: tauri::Window, state: State<'_, McpClientState>) -> Result<(), String> {
    only_main(&window)?;
    *state.oauth.pending.lock().map_err(|_| "sign-in lock failed".to_string())? = None;
    Ok(())
}

/// Gets a new token with the one kept for that. False where there is none, or it was refused.
#[tauri::command]
pub async fn mcp_client_oauth_renew(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>, server_id: String) -> Result<bool, String> {
    only_main(&window)?;
    let server_url = remote(&app, &state, &server_id)?;
    let _lane = state.oauth.lane.lock().await;
    if state.oauth.renewed.lock().map_err(|_| "sign-in lock failed".to_string())?.get(&server_id).is_some_and(|at| at.elapsed() < RECENT) {
        return Ok(true);
    }
    let Some(link) = link_of(&app, &state, &server_id)? else {
        return Ok(false);
    };
    let Some(refresh) = read_long(&app, &slot(&server_id, "refresh"))? else {
        return Ok(false);
    };
    // The endpoint was read from the authorization server's own document when the sign-in was made; the rule is asked again.
    let Some(address) = oauth_address(&link.token_endpoint, &server_url) else {
        return Ok(false);
    };
    let client = Client { id: link.client_id.clone(), auth: link.auth, secret: read_long(&app, &slot(&server_id, "client"))? };
    let fields = token_form(&Grant::Refresh { token: &refresh }, &client, &link.resource);
    let Ok(reply) = ask(&address, &server_url, Ask::Form(&fields, basic_of(&client))).await else {
        return Ok(false);
    };
    match read_token_response(reply.status, &reply.body) {
        Ok(tokens) => {
            keep(&app, &state, &server_id, link, &tokens, client.secret.as_deref())?;
            state.oauth.renewed.lock().map_err(|_| "sign-in lock failed".to_string())?.insert(server_id, Instant::now());
            Ok(true)
        }
        // Refused for good: the sign-in is over; who Plainva is to this authorization server stays.
        Err("oauth-grant") => {
            forget_tokens(&app, &state, &server_id)?;
            change_links(&app, &state, |links| {
                if let Some(link) = links.links.get_mut(&server_id) {
                    link.signed_in = false;
                    link.renewable = false;
                    link.expires_at = None;
                }
            })?;
            Ok(false)
        }
        Err(_) => Ok(false),
    }
}

/// A sign-in as the settings may show it: where, for what, until when — never a token.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStatus {
    issuer: String,
    scopes: Vec<String>,
    expires_at: Option<u64>,
    signed_in: bool,
    renewable: bool,
    client: bool,
}

#[tauri::command]
pub fn mcp_client_oauth_status(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>, server_id: String) -> Result<Option<OAuthStatus>, String> {
    only_main(&window)?;
    Ok(link_of(&app, &state, &server_id)?.map(|link| OAuthStatus { issuer: link.issuer, scopes: link.scopes, expires_at: link.expires_at, signed_in: link.signed_in, renewable: link.renewable, client: true }))
}

#[tauri::command]
pub fn mcp_client_oauth_sign_out(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>, server_id: String) -> Result<(), String> {
    only_main(&window)?;
    forget(&app, &state, &server_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ISSUER: &str = "https://auth.example.org";
    const SERVER: &str = "https://mcp.example.com/mcp";

    /// [the server's registered address, an address it names, whether that may be asked] — `MCP_OAUTH_ADDRESS_CASES`.
    const ADDRESS_CASES: &[(&str, &str, bool)] = &[
        ("https://mcp.example.com/mcp", "https://auth.example.org/.well-known/oauth-authorization-server", true),
        ("https://mcp.example.com/mcp", "https://mcp.example.com:8443/token", true),
        ("https://mcp.example.com/mcp", "https://auth.example.org:8443/token", false),
        ("https://mcp.example.com/mcp", "http://auth.example.org/token", false),
        ("https://mcp.example.com/mcp", "https://192.168.1.1/token", false),
        ("https://mcp.example.com/mcp", "https://router.lan/token", false),
        ("https://mcp.example.com/mcp", "https://localhost/token", false),
        ("https://mcp.example.com/mcp", "https://user:pw@auth.example.org/token", false),
        ("https://mcp.example.com/mcp", "https://auth.example.org/token#x", false),
        ("https://mcp.example.com/mcp", "javascript:alert(1)", false),
        ("https://mcp.example.com/mcp", "", false),
        ("https://192.168.1.20/mcp", "https://192.168.1.20/oauth/token", true),
        ("https://192.168.1.20/mcp", "https://192.168.1.21/oauth/token", false),
        ("http://localhost:3000/mcp", "http://localhost:9000/token", true),
        ("http://localhost:3000/mcp", "http://127.0.0.1:9000/token", false),
        ("http://localhost:3000/mcp", "https://auth.example.org/token", true),
    ];

    /// `MCP_OAUTH_ISSUER_URL_CASES`.
    const ISSUER_URL_CASES: &[(&str, &str, bool)] = &[
        ("https://auth.example.org", "https://auth.example.org/.well-known/oauth-authorization-server", true),
        ("https://auth.example.org/tenant1", "https://auth.example.org/.well-known/oauth-authorization-server/tenant1", true),
        ("https://auth.example.org/tenant1", "https://auth.example.org/tenant1/.well-known/openid-configuration", true),
        ("http://localhost:9000", "http://localhost:9000/.well-known/oauth-authorization-server", true),
        ("https://auth.example.org", "https://auth.example.org/metadata.json", false),
        ("https://auth.example.org", "https://evil.example.net/.well-known/oauth-authorization-server", false),
        ("https://auth.example.org", "https://auth.example.org:8443/.well-known/oauth-authorization-server", false),
        ("https://auth.example.org", "http://auth.example.org/.well-known/oauth-authorization-server", false),
        ("https://auth.example.org?x=1", "https://auth.example.org/.well-known/oauth-authorization-server", false),
        ("https://auth.example.org#x", "https://auth.example.org/.well-known/oauth-authorization-server", false),
    ];

    /// `MCP_OAUTH_ISSUER_DOC_CASES`: [what the case is about, the metadata as it was served, "ok" or why it does not count].
    const ISSUER_DOC_CASES: &[(&str, &str, &str)] = &[
        (
            "complete",
            r#"{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token","response_types_supported":["code"],"code_challenge_methods_supported":["S256","plain"],"registration_endpoint":"https://auth.example.org/register","client_id_metadata_document_supported":true,"authorization_response_iss_parameter_supported":true,"scopes_supported":["read","write"]}"#,
            "ok",
        ),
        (
            "the token endpoint on another public host",
            r#"{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://tokens.example.net/token","code_challenge_methods_supported":["S256"]}"#,
            "ok",
        ),
        (
            "another issuer, by one character",
            r#"{"issuer":"https://auth.example.org/","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token","code_challenge_methods_supported":["S256"]}"#,
            "oauth-issuer",
        ),
        ("no issuer", r#"{"authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token","code_challenge_methods_supported":["S256"]}"#, "oauth-issuer"),
        ("it does not say it does PKCE", r#"{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token"}"#, "oauth-no-pkce"),
        (
            "PKCE without SHA-256",
            r#"{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token","code_challenge_methods_supported":["plain"]}"#,
            "oauth-no-pkce",
        ),
        (
            "the token endpoint in the local network",
            r#"{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://router.lan/token","code_challenge_methods_supported":["S256"]}"#,
            "oauth-endpoints",
        ),
        ("no authorization endpoint", r#"{"issuer":"https://auth.example.org","token_endpoint":"https://auth.example.org/token","code_challenge_methods_supported":["S256"]}"#, "oauth-endpoints"),
        (
            "no code flow",
            r#"{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token","response_types_supported":["token"],"code_challenge_methods_supported":["S256"]}"#,
            "oauth-endpoints",
        ),
        ("a page, not a document", "<html><body>Not found</body></html>", "oauth-no-metadata"),
        ("a list, not a document", "[]", "oauth-no-metadata"),
    ];

    /// `MCP_OAUTH_RESOURCE_CASES`.
    const RESOURCE_CASES: &[(&str, &str, bool)] = &[
        ("https://mcp.example.com/mcp", "https://mcp.example.com/mcp", true),
        ("https://mcp.example.com", "https://mcp.example.com/mcp", true),
        ("https://mcp.example.com/", "https://mcp.example.com/mcp", true),
        ("https://mcp.example.com/mcp", "https://mcp.example.com/mcp/v1?x=1", true),
        ("https://MCP.Example.com/mcp", "https://mcp.example.com/mcp", true),
        ("http://localhost:3000/mcp", "http://localhost:3000/mcp", true),
        ("https://mcp.example.com/mc", "https://mcp.example.com/mcp", false),
        ("https://mcp.example.com/mcp/v1", "https://mcp.example.com/mcp", false),
        ("https://other.example.com/mcp", "https://mcp.example.com/mcp", false),
        ("https://mcp.example.com:8443/mcp", "https://mcp.example.com/mcp", false),
        ("http://mcp.example.com/mcp", "https://mcp.example.com/mcp", false),
        ("https://mcp.example.com/mcp?x=1", "https://mcp.example.com/mcp", false),
        ("https://mcp.example.com/mcp#x", "https://mcp.example.com/mcp", false),
        ("", "https://mcp.example.com/mcp", false),
    ];

    /// `MCP_OAUTH_REDIRECT_CASES`: [the issuer promised to name itself, state, code, iss, error, "ok" or the problem] — begun with state `s1` at `ISSUER`.
    #[allow(clippy::type_complexity)]
    const REDIRECT_CASES: &[(bool, &str, Option<&str>, Option<&str>, Option<&str>, &str)] = &[
        (false, "s1", Some("c"), None, None, "ok"),
        (true, "s1", Some("c"), Some("https://auth.example.org"), None, "ok"),
        (false, "s1", Some("c"), Some("https://auth.example.org"), None, "ok"),
        (true, "s1", Some("c"), None, None, "oauth-issuer"),
        (false, "s1", Some("c"), Some("https://auth.example.org/"), None, "oauth-issuer"),
        (true, "s1", None, Some("https://evil.example.net"), Some("access_denied"), "oauth-issuer"),
        (false, "s2", Some("c"), None, None, "oauth-no-flow"),
        (false, "", Some("c"), None, None, "oauth-no-flow"),
        (false, "s1", None, None, Some("access_denied"), "oauth-denied"),
        (false, "s1", None, None, Some("server_error"), "oauth-failed"),
        (false, "s1", None, None, None, "oauth-failed"),
        (false, "s1", Some(""), None, None, "oauth-failed"),
    ];

    /// `MCP_OAUTH_TOKEN_CASES`.
    const TOKEN_CASES: &[(u16, &str, &str)] = &[
        (200, r#"{"access_token":"at","token_type":"Bearer","expires_in":3600,"refresh_token":"rt","scope":"read write"}"#, "ok"),
        (200, r#"{"access_token":"at","token_type":"bearer"}"#, "ok"),
        (200, r#"{"access_token":"at","token_type":"mac"}"#, "oauth-token"),
        (200, r#"{"access_token":"","token_type":"Bearer"}"#, "oauth-token"),
        (200, r#"{"access_token":"a b","token_type":"Bearer"}"#, "oauth-token"),
        (200, r#"{"token_type":"Bearer"}"#, "oauth-token"),
        (200, r#"{"access_token":"at","token_type":"Bearer","refresh_token":7}"#, "oauth-token"),
        (200, "not json", "oauth-token"),
        (400, r#"{"error":"invalid_grant"}"#, "oauth-grant"),
        (400, r#"{"error":"invalid_client"}"#, "oauth-token"),
        (401, r#"{"error":"invalid_grant"}"#, "oauth-token"),
        (500, "", "oauth-token"),
    ];

    /// `MCP_OAUTH_REGISTRATION_CASES`.
    const REGISTRATION_CASES: &[(u16, &str, Option<ClientAuth>)] = &[
        (201, r#"{"client_id":"abc","token_endpoint_auth_method":"none"}"#, Some(ClientAuth::None)),
        (200, r#"{"client_id":"abc"}"#, Some(ClientAuth::None)),
        (201, r#"{"client_id":"abc","client_secret":"s3","token_endpoint_auth_method":"client_secret_post"}"#, Some(ClientAuth::Post)),
        (201, r#"{"client_id":"abc","client_secret":"s3","token_endpoint_auth_method":"client_secret_basic"}"#, Some(ClientAuth::Basic)),
        (201, r#"{"client_id":"abc","client_secret":"s3"}"#, Some(ClientAuth::Basic)),
        (201, r#"{"client_id":"abc","client_secret":"s3","token_endpoint_auth_method":"none"}"#, Some(ClientAuth::None)),
        (201, r#"{"client_id":"abc","token_endpoint_auth_method":"client_secret_post"}"#, None),
        (201, r#"{"client_id":"abc","client_secret":"s3","token_endpoint_auth_method":"private_key_jwt"}"#, None),
        (201, r#"{"client_secret":"s3"}"#, None),
        (400, r#"{"error":"invalid_redirect_uri"}"#, None),
        (201, "nope", None),
    ];

    #[test]
    fn an_address_a_server_names_is_on_its_own_host_or_public_like_a_page() {
        for (server, named, accepted) in ADDRESS_CASES {
            assert_eq!(oauth_address(named, server).is_some(), *accepted, "{server} -> {named}");
        }
        assert_eq!(oauth_address(" https://AUTH.example.org/token ", SERVER).map(String::from).as_deref(), Some("https://auth.example.org/token"));
        assert_eq!(oauth_address("https://mcp.example.com:8443/token", SERVER).map(String::from).as_deref(), Some("https://mcp.example.com:8443/token"));
    }

    #[test]
    fn metadata_is_read_from_the_issuers_own_origin_under_well_known() {
        for (issuer, url, accepted) in ISSUER_URL_CASES {
            assert_eq!(issuer_document_url_ok(issuer, url), *accepted, "{issuer} at {url}");
        }
    }

    #[test]
    fn metadata_counts_when_it_names_the_issuer_usable_endpoints_and_pkce() {
        for (about, body, expected) in ISSUER_DOC_CASES {
            let read = read_issuer_document(body, ISSUER, SERVER);
            assert_eq!(read.as_ref().map(|_| "ok").unwrap_or_else(|problem| problem), *expected, "{about}");
        }
        assert_eq!(
            read_issuer_document(ISSUER_DOC_CASES[0].1, ISSUER, SERVER).unwrap(),
            Endpoints {
                issuer: ISSUER.into(),
                authorization: "https://auth.example.org/authorize".into(),
                token: "https://auth.example.org/token".into(),
                registration: Some("https://auth.example.org/register".into()),
                document: true,
                iss: true,
                scopes: vec!["read".into(), "write".into()],
            }
        );
        // A registration endpoint that may not be asked is none; the rest still counts.
        let plain = read_issuer_document(
            r#"{"issuer":"https://auth.example.org","authorization_endpoint":"https://auth.example.org/authorize","token_endpoint":"https://auth.example.org/token","code_challenge_methods_supported":["S256"],"registration_endpoint":"http://auth.example.org/register"}"#,
            ISSUER,
            SERVER,
        )
        .unwrap();
        assert_eq!((plain.registration, plain.document, plain.iss, plain.scopes.len()), (None, false, false, 0));
    }

    #[test]
    fn a_token_is_for_the_servers_address_or_a_part_of_it() {
        for (resource, server, covers) in RESOURCE_CASES {
            assert_eq!(resource_covers(resource, server), *covers, "{resource} for {server}");
        }
    }

    #[test]
    fn the_way_back_is_a_port_on_this_computer() {
        assert_eq!(redirect_uri(43117).as_deref(), Some("http://127.0.0.1:43117/callback"));
        assert_eq!(redirect_uri(80), None);
        assert_eq!(redirect_uri(1024).as_deref(), Some("http://127.0.0.1:1024/callback"));
    }

    #[test]
    fn what_came_back_is_checked_against_what_was_begun() {
        for (promised, state, code, iss, error, expected) in REDIRECT_CASES {
            let redirect = OAuthRedirect { state: state.to_string(), code: code.map(str::to_string), iss: iss.map(str::to_string), error: error.map(str::to_string) };
            let checked = check_redirect(Some(("s1", ISSUER, *promised)), &redirect);
            assert_eq!(checked.as_ref().map(|_| "ok").unwrap_or_else(|problem| problem), *expected, "{state} {code:?} {iss:?} {error:?}");
        }
        let fine = OAuthRedirect { state: "s1".into(), code: Some("c".into()), iss: None, error: None };
        assert_eq!(check_redirect(None, &fine), Err("oauth-no-flow"));
        assert_eq!(check_redirect(Some(("s1", ISSUER, false)), &fine), Ok("c".to_string()));
    }

    #[test]
    fn the_request_for_a_sign_in_names_everything_and_keeps_the_endpoints_own_query() {
        let url = authorization_url(
            "https://auth.example.org/authorize?tenant=a",
            "https://plainva.com/oauth/client.json",
            "http://127.0.0.1:43117/callback",
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            "s1",
            &["read".to_string(), "write".to_string()],
            "https://mcp.example.com/mcp",
        )
        .unwrap();
        assert!(url.starts_with("https://auth.example.org/authorize?"));
        let pairs: Vec<(String, String)> = reqwest::Url::parse(&url).unwrap().query_pairs().map(|(name, value)| (name.into_owned(), value.into_owned())).collect();
        let expected = [
            ("tenant", "a"),
            ("response_type", "code"),
            ("client_id", "https://plainva.com/oauth/client.json"),
            ("redirect_uri", "http://127.0.0.1:43117/callback"),
            ("code_challenge", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"),
            ("code_challenge_method", "S256"),
            ("state", "s1"),
            ("resource", "https://mcp.example.com/mcp"),
            ("scope", "read write"),
        ];
        assert_eq!(pairs, expected.iter().map(|(name, value)| (name.to_string(), value.to_string())).collect::<Vec<_>>());
        let bare = authorization_url("https://auth.example.org/authorize", "c", "r", "x", "s", &[], "q").unwrap();
        assert!(!bare.contains("scope="));
    }

    #[test]
    fn the_challenge_is_the_hash_of_the_verifier_and_secrets_are_long_enough() {
        // RFC 7636, appendix B.
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let verifier = random(32).unwrap();
        assert_eq!(verifier.len(), 43);
        assert!(verifier.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'));
        assert_ne!(random(32).unwrap(), verifier);
        assert_eq!(random(16).unwrap().len(), 22);
    }

    #[test]
    fn a_client_id_is_printable_and_as_a_description_a_public_address_with_a_path() {
        assert_eq!(client_id(false, " my-client 1 ").as_deref(), Some("my-client 1"));
        assert_eq!(client_id(false, ""), None);
        assert_eq!(client_id(false, "a\nb"), None);
        assert_eq!(client_id(false, &"a".repeat(513)), None);
        assert_eq!(client_id(true, "https://plainva.com/oauth/client.json").as_deref(), Some("https://plainva.com/oauth/client.json"));
        for bad in ["https://plainva.com/", "https://plainva.com", "http://plainva.com/oauth/client.json", "https://192.168.1.2/client.json", "https://plainva.com/oauth/client.json#x", "my-client"] {
            assert_eq!(client_id(true, bad), None, "{bad}");
        }
    }

    #[test]
    fn the_token_endpoint_is_asked_with_the_grant_the_client_and_who_the_token_is_for() {
        let open = Client { id: "abc".into(), auth: ClientAuth::None, secret: None };
        let fields = token_form(&Grant::Code { code: "c1", verifier: "v1", redirect: "http://127.0.0.1:43117/callback" }, &open, "https://mcp.example.com/mcp");
        assert_eq!(
            fields,
            vec![
                ("grant_type", "authorization_code".to_string()),
                ("code", "c1".to_string()),
                ("redirect_uri", "http://127.0.0.1:43117/callback".to_string()),
                ("code_verifier", "v1".to_string()),
                ("client_id", "abc".to_string()),
                ("resource", "https://mcp.example.com/mcp".to_string()),
            ]
        );
        assert_eq!(
            form_body(&fields),
            "grant_type=authorization_code&code=c1&redirect_uri=http%3A%2F%2F127.0.0.1%3A43117%2Fcallback&code_verifier=v1&client_id=abc&resource=https%3A%2F%2Fmcp.example.com%2Fmcp"
        );
        let post = Client { id: "abc".into(), auth: ClientAuth::Post, secret: Some("s3".into()) };
        assert_eq!(
            token_form(&Grant::Refresh { token: "rt" }, &post, "https://mcp.example.com"),
            vec![
                ("grant_type", "refresh_token".to_string()),
                ("refresh_token", "rt".to_string()),
                ("client_id", "abc".to_string()),
                ("resource", "https://mcp.example.com".to_string()),
                ("client_secret", "s3".to_string()),
            ]
        );
        // A secret that is the request's own credential is not in the body as well.
        let basic = Client { id: "abc".into(), auth: ClientAuth::Basic, secret: Some("s3".into()) };
        assert!(token_form(&Grant::Refresh { token: "rt" }, &basic, "r").iter().all(|(name, _)| *name != "client_secret"));
        assert_eq!(basic_of(&basic), Some(("abc", "s3")));
        assert_eq!(basic_of(&post), None);
        assert_eq!(form_encode("a b+c/d=e&f~"), "a+b%2Bc%2Fd%3De%26f%7E");
    }

    #[test]
    fn a_token_endpoint_answers_with_a_bearer_token_or_says_the_sign_in_is_over() {
        for (status, body, expected) in TOKEN_CASES {
            let read = read_token_response(*status, body);
            assert_eq!(read.as_ref().map(|_| "ok").unwrap_or_else(|problem| problem), *expected, "{status} {body}");
        }
        assert_eq!(read_token_response(200, TOKEN_CASES[0].1), Ok(Tokens { access: "at".into(), refresh: Some("rt".into()), expires_in: Some(3600), scopes: Some(vec!["read".into(), "write".into()]) }));
        assert_eq!(read_token_response(200, TOKEN_CASES[1].1), Ok(Tokens { access: "at".into(), refresh: None, expires_in: None, scopes: None }));
        assert_eq!(read_token_response(200, r#"{"access_token":"at","token_type":"Bearer","expires_in":-5,"refresh_token":null}"#), Ok(Tokens { access: "at".into(), refresh: None, expires_in: None, scopes: None }));
        // A lifetime no whole number holds is capped, not believed.
        assert_eq!(read_token_response(200, r#"{"access_token":"at","token_type":"Bearer","expires_in":1e300}"#).unwrap().expires_in, Some(10 * 365 * 24 * 3600));
        assert!(read_token_response(200, &format!(r#"{{"access_token":"{}","token_type":"Bearer"}}"#, "a".repeat(MAX_TOKEN + 1))).is_err());
    }

    #[test]
    fn a_registration_gives_an_id_and_a_secret_only_where_the_server_insists() {
        assert_eq!(
            registration_body("Plainva", "http://127.0.0.1:43117/callback"),
            serde_json::json!({
                "client_name": "Plainva",
                "redirect_uris": ["http://127.0.0.1:43117/callback"],
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
                "token_endpoint_auth_method": "none",
                "application_type": "native"
            })
        );
        for (status, body, expected) in REGISTRATION_CASES {
            assert_eq!(read_registration(*status, body).map(|client| client.auth), *expected, "{status} {body}");
        }
        assert_eq!(read_registration(201, REGISTRATION_CASES[2].1), Some(Client { id: "abc".into(), auth: ClientAuth::Post, secret: Some("s3".into()) }));
        assert_eq!(read_registration(201, REGISTRATION_CASES[5].1), Some(Client { id: "abc".into(), auth: ClientAuth::None, secret: None }));
    }

    #[test]
    fn scopes_are_visible_ascii_each_once() {
        assert_eq!(read_scopes(Some(&serde_json::json!("read  wri\"te read ok"))), vec!["read".to_string(), "ok".to_string()]);
        assert_eq!(read_scopes(Some(&serde_json::json!(["a", 7, "a", "b"]))), vec!["a".to_string(), "b".to_string()]);
        assert_eq!(read_scopes(Some(&serde_json::json!((0..80).map(|i| format!("s{i}")).collect::<Vec<_>>().join(" ")))).len(), MAX_SCOPES);
        assert!(read_scopes(None).is_empty());
    }

    #[test]
    fn a_long_token_is_kept_in_parts_that_fit_every_keychain() {
        let token = "t".repeat(2 * PART + 17);
        let parts = split_long(&token);
        assert_eq!(parts.iter().map(String::len).collect::<Vec<_>>(), vec![PART, PART, 17]);
        assert_eq!(parts.concat(), token);
        assert_eq!(split_long("short"), vec!["short".to_string()]);
    }

    #[test]
    fn slots_of_a_sign_in_are_nobody_elses() {
        assert_eq!(slot("tracker", "access"), "ai-mcp:tracker#access");
        assert!(slot("tracker", "refresh").starts_with(MCP_KEY_PREFIX));
        // An id has no `#`, an environment name neither: no value of a program can be stored under such a name.
        assert!(!super::super::registry::valid_id("tracker#access"));
        assert!(!super::super::registry::valid_env_name("#access"));
    }

    #[test]
    fn a_sign_in_is_written_down_without_a_secret() {
        let link = Link {
            issuer: ISSUER.into(),
            token_endpoint: "https://auth.example.org/token".into(),
            client_id: "abc".into(),
            auth: ClientAuth::Basic,
            kind: ClientKind::Dynamic,
            redirect_uri: "http://127.0.0.1:43117/callback".into(),
            resource: SERVER.into(),
            scopes: vec!["read".into()],
            expires_at: Some(1_900_000_000),
            signed_in: true,
            renewable: true,
        };
        let mut links = Links::default();
        links.links.insert("tracker".into(), link.clone());
        let text = serde_json::to_string_pretty(&links).unwrap();
        let fields: Vec<&str> = text.lines().filter_map(|line| line.trim().strip_prefix('"')).filter_map(|line| line.split('"').next()).collect();
        assert_eq!(fields, vec!["links", "tracker", "issuer", "tokenEndpoint", "clientId", "auth", "kind", "redirectUri", "resource", "scopes", "read", "expiresAt", "signedIn", "renewable"]);
        assert_eq!(serde_json::from_str::<Links>(&text).unwrap().links.get("tracker"), Some(&link));
        assert!(serde_json::from_str::<Links>("{\"links\": 3}").is_err());
    }

    #[test]
    fn what_the_web_view_sends_is_read_in_its_own_spelling() {
        let begin: OAuthBegin = serde_json::from_value(serde_json::json!({
            "issuer": ISSUER, "scopes": ["read"], "resource": SERVER, "client": { "kind": "document", "id": "https://plainva.com/oauth/client.json" }, "clientName": "Plainva", "redirectPort": 43117
        }))
        .unwrap();
        assert!(matches!(begin.client, OAuthClientChoice::Document { ref id } if id == "https://plainva.com/oauth/client.json"));
        assert_eq!((begin.redirect_port, begin.client_name.as_str()), (Some(43117), "Plainva"));
        for (text, expected) in [("stored", 0), ("dynamic", 1)] {
            let choice: OAuthClientChoice = serde_json::from_value(serde_json::json!({ "kind": text })).unwrap();
            assert_eq!(match choice { OAuthClientChoice::Stored => 0, OAuthClientChoice::Dynamic => 1, _ => 2 }, expected);
        }
        let redirect: OAuthRedirect = serde_json::from_value(serde_json::json!({ "state": "s1", "code": "c", "iss": ISSUER })).unwrap();
        assert_eq!((redirect.state.as_str(), redirect.code.as_deref(), redirect.iss.as_deref(), redirect.error.as_deref()), ("s1", Some("c"), Some(ISSUER), None));
        let status = serde_json::to_value(OAuthStatus { issuer: ISSUER.into(), scopes: vec![], expires_at: None, signed_in: true, renewable: false, client: true }).unwrap();
        assert_eq!(status, serde_json::json!({ "issuer": ISSUER, "scopes": [], "expiresAt": null, "signedIn": true, "renewable": false, "client": true }));
    }
}
