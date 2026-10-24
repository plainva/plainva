//! IMAP mail capture (PIM stage 5) + a few explicit mailbox actions (mail-
//! client E4).
//!
//! Design constraints:
//! - Reads are non-mutating: `EXAMINE` instead of `SELECT` and `BODY.PEEK[…]`
//!   fetches (never sets `\Seen`). Explicit write commands are the only paths
//!   that `SELECT` a mailbox. Normal deletion moves to Trash; permanent delete
//!   is a separate, confirmed frontend action scoped to the Trash folder.
//! - No credential state in Rust: every command receives host/port/user/pass
//!   from the frontend (which reads the OS keychain). Connections themselves are
//!   pooled since findings round P7.2 — at most one idle session per account,
//!   handed out again only after a `NOOP` still gets a reply, retired on any
//!   error, and released explicitly on account switch (`mail_release_sessions`).
//!   The policy lives in `mail_pool`; IDLE push is still not implemented.
//! - Blocking `imap` client inside `spawn_blocking` (the async runtime and
//!   the UI stay free) — the same pattern as the OAuth loopback fix.
//! - TLS via rustls over a plain `TcpStream` (OpenSSL-free cross-platform).
//! - Parsing via `mail-parser` (RFC 2047 headers, multipart, attachments).

use base64::Engine as _;
use mail_parser::MimeHeaders as _;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MailboxInfo {
    pub name: String,
    /// The server-stated hierarchy delimiter of this mailbox (LIST reply), so
    /// the UI splits nested names at the real separator instead of guessing
    /// "/" or "." (which mangles names like "mailbox.org Rechnungen").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delimiter: Option<String>,
    /// The role the SERVER states through an RFC 6154 special-use attribute
    /// (`\Junk`, `\Trash`, `\Sent`, `\Drafts`, `\Archive`). Absent when the
    /// server states none; the UI then guesses from the name. Gmail marks its
    /// spam folder `\Junk` whatever language the account shows it in.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<&'static str>,
}

/// The special-use role among a mailbox's LIST attributes, if the server states
/// one. Mirrors `specialUseRole` in the shared mail code (the phone's socket
/// client). `\All`, `\Flagged` and `\Important` are views, not places to file
/// mail, and state no role. Pure.
fn special_use_role<'a>(attributes: impl IntoIterator<Item = &'a str>) -> Option<&'static str> {
    for raw in attributes {
        let Some(flag) = raw.trim().strip_prefix('\\') else {
            continue;
        };
        match flag.to_ascii_lowercase().as_str() {
            "junk" | "spam" => return Some("junk"),
            "trash" => return Some("trash"),
            "sent" => return Some("sent"),
            "drafts" => return Some("drafts"),
            "archive" => return Some("archive"),
            "inbox" => return Some("inbox"),
            _ => {}
        }
    }
    None
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MailEnvelope {
    pub uid: u32,
    pub uid_validity: Option<u32>,
    pub has_attachments: Option<bool>,
    pub subject: String,
    pub from: String,
    /// Unix ms of the INTERNALDATE (arrival), 0 when unknown.
    pub date_ts: i64,
    pub seen: bool,
    pub flagged: bool,
    /// Thread identity (findings P9.1), taken along in the SAME header FETCH —
    /// no extra roundtrip, same trick as the list preview. Passed on as the
    /// server wrote them: the shared TypeScript side owns the one normaliser
    /// both platforms use, so there is no second parser here to drift from it.
    /// `references` is space-joined, which is the header's own form.
    pub message_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MailEnvelopePage {
    pub total: u32,
    /// Number of unread (\Unseen) messages in the mailbox — the folder badge
    /// and status bar show this, not the total.
    pub unseen: u32,
    pub messages: Vec<MailEnvelope>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MailAttachmentInfo {
    pub index: usize,
    pub name: String,
    pub mime: String,
    pub size: usize,
}

/// One attachment's bytes, as `mail_fetch_attachments` hands them out. `index`
/// is the one `MailAttachmentInfo` carried, so the caller can match an answer
/// to the file it asked for.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FetchedAttachment {
    pub index: usize,
    pub content_base64: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MailMessage {
    pub uid: u32,
    pub subject: String,
    pub from: String,
    pub to: String,
    pub date_ts: i64,
    pub text: Option<String>,
    pub html: Option<String>,
    pub attachments: Vec<MailAttachmentInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid_validity: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_message_id: Option<String>,
    /// RFC 2369 `List-Unsubscribe`, verbatim — the reader is offered what the
    /// SENDER declared, never a route guessed from the body (S23).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_unsubscribe: Option<String>,
    /// RFC 8058 `List-Unsubscribe-Post`. Without it an https route is a page to
    /// open, not a POST to perform.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_unsubscribe_post: Option<String>,
}

/// A rustls stream over a plain TCP socket (the same OpenSSL-free stack the
/// SMTP client uses). The imap `Session` is generic over this concrete type.
type TlsStream = rustls::StreamOwned<rustls::ClientConnection, TcpStream>;
type ImapSession = imap::Session<TlsStream>;

#[derive(serde::Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MailAuth { Password, Xoauth2 }

fn credential_fingerprint_input(pass: &str, auth: Option<MailAuth>) -> String {
    if auth == Some(MailAuth::Xoauth2) { format!("xoauth2:{pass}") } else { pass.to_string() }
}

pub(crate) fn oauth_payload(user: &str, token: &str) -> Result<String, String> {
    if user.is_empty() || token.is_empty() || user.chars().chain(token.chars()).any(|c| c.is_ascii_control()) {
        return Err("Invalid OAuth mail credentials".into());
    }
    Ok(format!("user={user}\x01auth=Bearer {token}\x01\x01"))
}

struct Xoauth2 { payload: String, sent: std::cell::Cell<bool> }
impl imap::Authenticator for Xoauth2 {
    type Response = String;
    fn process(&self, challenge: &[u8]) -> String {
        // A JSON error challenge gets the required empty SASL response.
        if !self.sent.replace(true) && challenge.is_empty() { self.payload.clone() } else { String::new() }
    }
}

fn login_client(client: imap::Client<TlsStream>, user: &str, pass: &str, auth: Option<MailAuth>) -> Result<ImapSession, String> {
    if auth == Some(MailAuth::Xoauth2) {
        let response = Xoauth2 { payload: oauth_payload(user, pass)?, sent: std::cell::Cell::new(false) };
        client.authenticate("XOAUTH2", &response).map_err(|_| "MAIL_OAUTH_REJECTED".to_string())
    } else { client.login(user, pass).map_err(|(e, _)| format!("login failed: {e}")) }
}

/// True for a loopback host (localhost / 127.0.0.0/8 / ::1). A TLS connection
/// that never leaves the machine cannot be intercepted, so we accept a
/// self-signed certificate there — which is exactly what the Proton Mail
/// Bridge (127.0.0.1) presents. Every non-loopback host keeps full webpki
/// chain verification. Pure.
pub(crate) fn is_loopback_host(host: &str) -> bool {
    let h = host.trim().trim_matches(|c| c == '[' || c == ']');
    if h.eq_ignore_ascii_case("localhost") {
        return true;
    }
    match h.parse::<std::net::IpAddr>() {
        Ok(ip) => ip.is_loopback(),
        Err(_) => false,
    }
}

/// rustls verifier that accepts any certificate — used ONLY for loopback
/// hosts (see `is_loopback_host`), never on a network connection.
#[derive(Debug)]
struct AcceptLoopbackCert;

impl rustls::client::danger::ServerCertVerifier for AcceptLoopbackCert {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// TLS config: full webpki chain verification for real hosts, the accept-any
/// verifier for loopback (Proton Bridge and other local relays present a
/// self-signed cert that a network attacker could never substitute).
pub(crate) fn tls_config_for(host: &str) -> rustls::ClientConfig {
    if is_loopback_host(host) {
        rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(AcceptLoopbackCert))
            .with_no_client_auth()
    } else {
        let roots = rustls::RootCertStore {
            roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
        };
        rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth()
    }
}

/// Wraps a connected TCP socket in a rustls stream. For a loopback IP (Proton
/// Bridge) rustls still needs a valid ServerName — an IP maps to
/// `ServerName::IpAddress`, which our accept-any verifier does not inspect.
fn wrap_tls(host: &str, tcp: TcpStream) -> Result<TlsStream, String> {
    let server_name = rustls::pki_types::ServerName::try_from(host.to_string())
        .map_err(|e| format!("invalid server name: {e}"))?;
    let conn = rustls::ClientConnection::new(Arc::new(tls_config_for(host)), server_name)
        .map_err(|e| format!("tls setup failed: {e}"))?;
    Ok(rustls::StreamOwned::new(conn, tcp))
}

fn connect_tcp(host: &str, port: u16) -> Result<TcpStream, String> {
    let tcp = TcpStream::connect((host, port)).map_err(|e| format!("connect failed: {e}"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(60)))
        .map_err(|e| format!("socket setup failed: {e}"))?;
    tcp.set_write_timeout(Some(Duration::from_secs(60)))
        .map_err(|e| format!("socket setup failed: {e}"))?;
    Ok(tcp)
}

/// Runs the STARTTLS handshake on a plain socket (ports 143 / 1143 / any
/// non-993): read the greeting, send STARTTLS, then upgrade the SAME socket to
/// TLS. Returns the TLS stream ready for `Client::new` + `login` (the greeting
/// was already consumed, so the caller must NOT call `read_greeting` again).
fn starttls_upgrade(host: &str, tcp: TcpStream) -> Result<TlsStream, String> {
    let mut reader = BufReader::new(tcp.try_clone().map_err(|e| format!("socket clone failed: {e}"))?);
    let mut writer = tcp;
    // Greeting: "* OK ..." (or "* PREAUTH", though a pre-auth server would not
    // need login — we still upgrade for confidentiality).
    let mut greeting = String::new();
    reader.read_line(&mut greeting).map_err(|e| format!("greeting failed: {e}"))?;
    if !greeting.starts_with("* OK") && !greeting.starts_with("* PREAUTH") {
        return Err(format!("unexpected greeting: {}", greeting.trim()));
    }
    writer
        .write_all(b"aTLS STARTTLS\r\n")
        .map_err(|e| format!("starttls write failed: {e}"))?;
    writer.flush().map_err(|e| format!("starttls flush failed: {e}"))?;
    // Read the tagged response, skipping any untagged lines.
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).map_err(|e| format!("starttls read failed: {e}"))?;
        if n == 0 {
            return Err("connection closed during STARTTLS".into());
        }
        if line.starts_with("aTLS ") {
            if !line.starts_with("aTLS OK") {
                return Err(format!("STARTTLS refused: {}", line.trim()));
            }
            break;
        }
    }
    // The next bytes on the wire are the TLS handshake.
    wrap_tls(host, writer)
}

/// The one idle session per account (findings round P7.2). Every command below
/// goes through `with_session`, so a burst of actions in one mailbox pays a
/// single TCP+TLS+LOGIN instead of one per action. The reuse policy — health
/// probe, error retires the session, idle expiry, exclusive while in use — lives
/// in `mail_pool` and is tested there without a server.
static POOL: std::sync::LazyLock<crate::mail_pool::SessionPool<ImapSession>> =
    std::sync::LazyLock::new(|| crate::mail_pool::SessionPool::new(crate::mail_pool::IDLE_TTL));

/// Runs `f` on a session for these credentials, reusing the pooled one when a
/// `NOOP` still gets a reply. `f` must leave the connection in a usable state;
/// anything it returns as an error retires the session.
fn with_session<T>(
    host: &str,
    port: u16,
    user: &str,
    pass: &str, auth: Option<MailAuth>,
    f: impl FnOnce(&mut ImapSession) -> Result<T, String>,
) -> Result<T, String> {
    POOL.with(
        &crate::mail_pool::session_key(host, port, user, &credential_fingerprint_input(pass, auth)),
        || open_session(host, port, user, pass, auth),
        // The cheapest possible round trip: if the server closed the connection
        // while it sat idle, this is where we find out — not mid-FETCH.
        |session| session.noop().is_ok(),
        |mut session| {
            let _ = session.logout();
        },
        f,
    )
}

/// `with_session` plus a writable `SELECT` (flag/move/append commands).
/// Re-selecting the same mailbox on a reused session is a normal IMAP no-op.
fn with_writable<T>(
    host: &str,
    port: u16,
    user: &str,
    pass: &str, auth: Option<MailAuth>,
    mailbox: &str,
    f: impl FnOnce(&mut ImapSession) -> Result<T, String>,
) -> Result<T, String> {
    with_session(host, port, user, pass, auth, |session| {
        session.select(mailbox).map_err(|e| format!("select failed: {e}"))?;
        f(session)
    })
}

/// Releases pooled sessions: one account when `user` is given (the user switched
/// mailboxes), all of them otherwise (vault close, app exit). A logged-in session
/// must not outlive its reason to exist, so the frontend calls this instead of
/// waiting for the idle timeout.
#[tauri::command]
pub async fn mail_release_sessions(user: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let released = match user.as_deref() {
            Some(user) => POOL.drain_account(&crate::mail_pool::account_marker(user)),
            None => POOL.drain_all(),
        };
        for mut session in released {
            let _ = session.logout();
        }
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))
}

fn open_session(host: &str, port: u16, user: &str, pass: &str, auth: Option<MailAuth>) -> Result<ImapSession, String> {
    let tcp = connect_tcp(host, port)?;
    // 993 = implicit TLS (greeting arrives encrypted); everything else does an
    // explicit STARTTLS upgrade on the plain socket (RFC 3501 §6.2.1). This is
    // what a local Proton Mail Bridge (127.0.0.1:1143) needs.
    if port == 993 {
        let tls = wrap_tls(host, tcp)?;
        // Client::new performs no handshake chatter of its own — the server
        // greeting stays in the buffer and read_greeting consumes it before the
        // first command (the connect() helper is native-tls-bound, which the
        // project deliberately avoids).
        let mut client = imap::Client::new(tls);
        client
            .read_greeting()
            .map_err(|e| format!("greeting failed: {e}"))?;
        login_client(client, user, pass, auth)
    } else {
        let tls = starttls_upgrade(host, tcp)?;
        // The greeting was consumed on the plain socket before STARTTLS, so we
        // go straight to LOGIN (login consumes the client).
        login_client(imap::Client::new(tls), user, pass, auth)
    }
}

fn header_text(msg: &mail_parser::Message, name: mail_parser::HeaderName) -> String {
    msg.header(name)
        .and_then(|h| h.as_text())
        .unwrap_or_default()
        .to_string()
}

/// First id of a message-id header (In-Reply-To normally carries exactly one).
/// `as_text` would answer with the LAST entry of a list, which for a parent
/// reference is the wrong end of the chain.
/// A header's raw text by name. `mail_parser` has no typed accessor for the
/// list headers, and their content is a URI list rather than an address list —
/// so it is forwarded verbatim and parsed in the shared TypeScript core, where
/// exactly one implementation decides what a route is.
fn raw_header(msg: &mail_parser::Message, name: &str) -> Option<String> {
    msg.headers()
        .iter()
        .find(|h| h.name().eq_ignore_ascii_case(name))
        .and_then(|h| h.value().as_text())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn first_message_id(msg: &mail_parser::Message, name: mail_parser::HeaderName) -> Option<String> {
    let list = msg.header(name).and_then(|h| h.as_text_list())?;
    list.first().map(|s| s.to_string()).filter(|s| !s.is_empty())
}

/// All ids of a References header, space-joined — the header's own form.
fn message_id_list(msg: &mail_parser::Message, name: mail_parser::HeaderName) -> Option<String> {
    let list = msg.header(name).and_then(|h| h.as_text_list())?;
    let joined = list
        .iter()
        .map(|s| s.as_ref())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    (!joined.is_empty()).then_some(joined)
}

fn address_text(addr: Option<&mail_parser::Address>) -> String {
    let Some(addr) = addr else {
        return String::new();
    };
    let mut out: Vec<String> = Vec::new();
    for a in addr.iter() {
        let name = a.name().unwrap_or_default();
        let email = a.address().unwrap_or_default();
        if name.is_empty() {
            out.push(email.to_string());
        } else if email.is_empty() {
            out.push(name.to_string());
        } else {
            out.push(format!("{name} <{email}>"));
        }
    }
    out.join(", ")
}

#[tauri::command]
pub async fn mail_check_login(host: String, port: u16, user: String, pass: String, auth: Option<MailAuth>) -> Result<Vec<MailboxInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&host, port, &user, &pass, auth, |session| {
            let names = session
                .list(None, Some("*"))
                .map_err(|e| format!("list failed: {e}"))?;
            let mut out: Vec<MailboxInfo> = names
                .iter()
                .filter(|n| {
                    !n.attributes()
                        .iter()
                        .any(|a| matches!(a, imap::types::NameAttribute::NoSelect))
                })
                .map(|n| MailboxInfo {
                    name: n.name().to_string(),
                    delimiter: n.delimiter().map(|d| d.to_string()),
                    role: special_use_role(n.attributes().iter().filter_map(|a| match a {
                        imap::types::NameAttribute::Custom(custom) => Some(custom.as_ref()),
                        _ => None,
                    })),
                })
                .collect();
            out.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(out)
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Builds an envelope from a FETCH row (UID FLAGS INTERNALDATE + the FROM/SUBJECT/DATE
/// header fields). Rows without a UID are skipped. Pure over the fetch row.
fn body_has_attachment(body: &imap_proto::types::BodyStructure<'_>) -> bool {
    use imap_proto::types::BodyStructure;
    let common = match body {
        BodyStructure::Basic { common, .. } | BodyStructure::Text { common, .. } | BodyStructure::Message { common, .. } | BodyStructure::Multipart { common, .. } => common,
    };
    let named = |params: &imap_proto::types::BodyParams<'_>| params.as_ref().is_some_and(|values| values.iter().any(|(key, value)| {
        let key = key.to_ascii_lowercase();
        !value.is_empty() && (key == "name" || key == "filename" || key.starts_with("name*") || key.starts_with("filename*"))
    }));
    named(&common.ty.params) || common.disposition.as_ref().is_some_and(|d| d.ty.eq_ignore_ascii_case("attachment") || named(&d.params)) || match body {
        BodyStructure::Multipart { bodies, .. } => bodies.iter().any(body_has_attachment),
        BodyStructure::Message { body, .. } => body_has_attachment(body),
        _ => false,
    }
}

fn fetch_to_envelope(f: &imap::types::Fetch, uid_validity: Option<u32>) -> Option<MailEnvelope> {
    let uid = f.uid?;
    let header_bytes = f.header().unwrap_or_default();
    let parsed = mail_parser::MessageParser::default().parse(header_bytes);
    let (subject, from) = parsed
        .as_ref()
        .map(|m| {
            (
                header_text(m, mail_parser::HeaderName::Subject),
                address_text(m.header(mail_parser::HeaderName::From).and_then(|h| h.as_address())),
            )
        })
        .unwrap_or_default();
    let date_ts = f.internal_date().map(|d| d.timestamp_millis()).unwrap_or(0);
    let seen = f.flags().iter().any(|fl| matches!(fl, imap::types::Flag::Seen));
    let flagged = f.flags().iter().any(|fl| matches!(fl, imap::types::Flag::Flagged));
    let (message_id, in_reply_to, references) = parsed
        .as_ref()
        .map(|m| {
            (
                first_message_id(m, mail_parser::HeaderName::MessageId),
                first_message_id(m, mail_parser::HeaderName::InReplyTo),
                message_id_list(m, mail_parser::HeaderName::References),
            )
        })
        .unwrap_or((None, None, None));
    let has_attachments = f.bodystructure().map(body_has_attachment);
    Some(MailEnvelope { uid, uid_validity, has_attachments, subject, from, date_ts, seen, flagged, message_id, in_reply_to, references })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_list_envelopes(
    host: String,
    port: u16,
    user: String,
    pass: String, auth: Option<MailAuth>,
    mailbox: String,
    offset: u32,
    limit: u32,
    before_uid: Option<u32>,
) -> Result<MailEnvelopePage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&host, port, &user, &pass, auth, |session| {
            // EXAMINE = read-only select; the server rejects any store attempt.
            let mb = session
                .examine(&mailbox)
                .map_err(|e| format!("examine failed: {e}"))?;
            let total = mb.exists;
            // Unread count (read-only SEARCH is allowed after EXAMINE).
            let unseen = session.search("UNSEEN").map(|s| s.len() as u32).unwrap_or(0);
            // Page by stable UID, not sequence number. New arrivals change sequence
            // positions and previously caused duplicates/skips between pages.
            let mut uids: Vec<u32> = session
                .uid_search("ALL")
                .map_err(|e| format!("uid search failed: {e}"))?
                .into_iter()
                .collect();
            uids.sort_unstable_by(|a, b| b.cmp(a));
            if let Some(before) = before_uid {
                uids.retain(|uid| *uid < before);
            } else if offset > 0 {
                uids = uids.into_iter().skip(offset as usize).collect();
            }
            uids.truncate(limit.max(1) as usize);
            if uids.is_empty() {
                return Ok(MailEnvelopePage { total, unseen, messages: Vec::new() });
            }
            let set = uids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
            let fetches = session
                .uid_fetch(
                    set,
                    "(UID FLAGS BODYSTRUCTURE INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)])",
                )
                .map_err(|e| format!("fetch failed: {e}"))?;
            let mut messages: Vec<MailEnvelope> = Vec::new();
            for f in fetches.iter() {
                if let Some(env) = fetch_to_envelope(f, mb.uid_validity) {
                    messages.push(env);
                }
            }
            messages.sort_by_key(|m| std::cmp::Reverse(m.uid));
            Ok(MailEnvelopePage { total, unseen, messages })
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

fn fetch_raw(session: &mut ImapSession, uid: u32) -> Result<Vec<u8>, String> {
    let fetches = session
        .uid_fetch(uid.to_string(), "(BODY.PEEK[])")
        .map_err(|e| format!("uid fetch failed: {e}"))?;
    let msg = fetches
        .iter()
        .next()
        .ok_or_else(|| "message not found".to_string())?;
    Ok(msg.body().unwrap_or_default().to_vec())
}

fn parse_message(raw: &[u8]) -> Result<mail_parser::Message<'_>, String> {
    mail_parser::MessageParser::default()
        .parse(raw)
        .ok_or_else(|| "unparseable message".to_string())
}

/// The message's own plain-text body, when it has one.
///
/// `body_text(0)` also answers for a message that is HTML only — with a text
/// mail-parser makes out of the markup, hidden parts included. What a reply
/// quotes and a filed note holds is decided in ONE place, the shared mail core
/// (`mailMessageText` in `packages/ui/src/mail/messageText.ts`), from the parts
/// a message really has; the phone's parser and Microsoft Graph report only
/// those, so the same mail gave one quote here and another there (finding
/// 2026-10-09). This reports the part, and nothing made from another one.
fn plain_text_body(parsed: &mail_parser::Message<'_>) -> Option<String> {
    match &parsed.text_bodies().next()?.body {
        mail_parser::PartType::Text(text) => Some(text.to_string()),
        _ => None,
    }
}

/// The raw message as the frontend receives it: standard base64, with padding
/// and without line breaks, of exactly the bytes the server sent. Three
/// transports hand this out — this command, the phone's socket client and
/// Microsoft Graph — and one reader decodes it (`saveEmlFile`); the fixture in
/// the test below is the one `rawFetchContract.test.ts` holds for the other two.
fn raw_message_base64(raw: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(raw)
}

#[tauri::command]
pub async fn mail_fetch_message(
    host: String,
    port: u16,
    user: String,
    pass: String, auth: Option<MailAuth>,
    mailbox: String,
    uid: u32,
) -> Result<MailMessage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&host, port, &user, &pass, auth, |session| {
            let selected = session
                .examine(&mailbox)
                .map_err(|e| format!("examine failed: {e}"))?;
            let uid_validity = selected.uid_validity;
            let raw = fetch_raw(session, uid)?;
            let parsed = parse_message(&raw)?;
            let attachments = parsed
                .attachments()
                .enumerate()
                .map(|(index, part)| MailAttachmentInfo {
                    index,
                    name: part.attachment_name().unwrap_or("attachment").to_string(),
                    mime: part
                        .content_type()
                        .map(|c| match c.subtype() {
                            Some(sub) => format!("{}/{}", c.ctype(), sub),
                            None => c.ctype().to_string(),
                        })
                        .unwrap_or_else(|| "application/octet-stream".to_string()),
                    size: part.contents().len(),
                })
                .collect();
            Ok(MailMessage {
                uid,
                subject: header_text(&parsed, mail_parser::HeaderName::Subject),
                from: address_text(parsed.header(mail_parser::HeaderName::From).and_then(|h| h.as_address())),
                to: address_text(parsed.header(mail_parser::HeaderName::To).and_then(|h| h.as_address())),
                date_ts: parsed.date().map(|d| d.to_timestamp() * 1000).unwrap_or(0),
                text: plain_text_body(&parsed),
                html: parsed.body_html(0).map(|c| c.to_string()),
                attachments,
                uid_validity,
                provider_message_id: parsed.message_id().map(str::to_string),
                list_unsubscribe: raw_header(&parsed, "List-Unsubscribe"),
                list_unsubscribe_post: raw_header(&parsed, "List-Unsubscribe-Post"),
            })
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

#[tauri::command]
pub async fn mail_fetch_raw(
    host: String,
    port: u16,
    user: String,
    pass: String, auth: Option<MailAuth>,
    mailbox: String,
    uid: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&host, port, &user, &pass, auth, |session| {
            session
                .examine(&mailbox)
                .map_err(|e| format!("examine failed: {e}"))?;
            let raw = fetch_raw(session, uid)?;
            Ok(raw_message_base64(&raw))
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

#[tauri::command]
// Keep the flat IPC parameters used by existing callers; auth is optional.
#[allow(clippy::too_many_arguments)]
pub async fn mail_fetch_attachment(
    host: String,
    port: u16,
    user: String,
    pass: String, auth: Option<MailAuth>,
    mailbox: String,
    uid: u32,
    index: usize,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&host, port, &user, &pass, auth, |session| {
            session
                .examine(&mailbox)
                .map_err(|e| format!("examine failed: {e}"))?;
            let raw = fetch_raw(session, uid)?;
            attachment_contents(&raw, &[index])?
                .pop()
                .map(|found| found.content_base64)
                .ok_or_else(|| "attachment not found".to_string())
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// What the frontend reads as "the mailbox is not the one the message was read
/// in any more" (`MAIL_MAILBOX_CHANGED` in the shared mail client).
const MAILBOX_CHANGED: &str = "MAIL_MAILBOX_CHANGED";

/// The bytes a base64 body stands for, read as mail really writes it.
///
/// Nothing in a body is a reason to give the file up. What is not base64 is
/// passed over (the line breaks, a blank), and a `=` ends a group wherever it
/// stands — one or two characters are one byte, three are two — with the
/// reading going on behind it. A generator that pads every line on its own, or
/// joins two encodings into one, writes exactly that. The parser reads it so,
/// and so does the phone's reader (`base64Bytes` in
/// `packages/ui/src/mail/net/mime.ts`); a strict decoder does not, and this
/// used to be one (finding 2026-10-12). It refused such a body, the file was
/// then handed out as the parser's UTF-8 reading of it, and a list written in
/// Latin-1 was saved and forwarded as another file than the one attached.
///
/// The end of the body ends a group like a `=` does, so a last group without
/// its padding is read; only a single character left over there is no byte.
///
/// This is asked for a part the parser itself took for base64. One with any
/// other character in it — not a blank, a tab, a line break or a single hyphen
/// — the parser has given up before and calls not encoded at all: it never
/// arrives here, and `attachment_bytes` hands it out as it stands (parity
/// catalog, `mail-base64-reading`).
fn base64_bytes(body: &[u8]) -> Vec<u8> {
    /// Two characters of an open group are one byte, three are two.
    fn end_group(out: &mut Vec<u8>, group: u32, count: u8) {
        match count {
            2 => out.push((group >> 4) as u8),
            3 => out.extend_from_slice(&[(group >> 10) as u8, (group >> 2) as u8]),
            _ => {}
        }
    }
    let mut out = Vec::with_capacity(body.len() / 4 * 3 + 3);
    // The characters of the open group, six bits each, and how many they are.
    let (mut group, mut count) = (0u32, 0u8);
    for &byte in body {
        let six_bits = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => {
                if count == 1 {
                    // A single character in front of `=`: its six bits begin
                    // a byte. That is the parser's reading, kept here so that
                    // a text file and any other file are read alike.
                    out.push((group << 2) as u8);
                } else {
                    end_group(&mut out, group, count);
                }
                (group, count) = (0, 0);
                continue;
            }
            _ => continue,
        };
        group = (group << 6) | u32::from(six_bits);
        count += 1;
        if count == 4 {
            out.extend_from_slice(&group.to_be_bytes()[1..]);
            (group, count) = (0, 0);
        }
    }
    end_group(&mut out, group, count);
    out
}

/// Quoted-printable with the transfer encoding taken off, as mail really comes.
///
/// `=XX` is a byte, `=` at the end of a line joins it to the next, blanks at
/// the end of a line were added on the way and go — and an `=` that is neither
/// stays what it is. That last part is why this is not mail-parser's own
/// `quoted_printable_decode`: it gives the whole part up on one stray `=`, the
/// parser's reading of a message does not, and no mail program does. A CSV from
/// a generator that left one `=` unencoded was then handed out as the parser's
/// UTF-8 reading of it — another file than the one that was sent, and nothing
/// said so. For a well-formed body the two answer alike (held by a test).
fn quoted_printable_bytes(body: &[u8]) -> Vec<u8> {
    #[derive(Clone, Copy)]
    enum State {
        Plain,
        /// After `=`.
        Escape,
        /// After `=` and one hex digit: the digit as written, and its value.
        Digit(u8, u8),
    }
    let hex = |byte: u8| (byte as char).to_digit(16).map(|digit| digit as u8);
    let mut out = Vec::with_capacity(body.len());
    let mut state = State::Plain;
    // Blanks written since the last other byte of this line.
    let mut blanks = 0usize;
    let mut line_end: &[u8] = b"\n";
    for &byte in body {
        match byte {
            b'=' => match state {
                State::Plain => state = State::Escape,
                // `==`: the first one was itself; this one may open an escape.
                State::Escape => {
                    out.push(b'=');
                    blanks = 0;
                }
                State::Digit(written, _) => {
                    out.extend_from_slice(&[b'=', written]);
                    blanks = 0;
                    state = State::Escape;
                }
            },
            b'\n' => {
                match state {
                    // A soft line break: the line goes on.
                    State::Escape => {}
                    State::Digit(written, _) => {
                        out.extend_from_slice(&[b'=', written]);
                        out.extend_from_slice(line_end);
                    }
                    State::Plain => {
                        out.truncate(out.len().saturating_sub(blanks));
                        out.extend_from_slice(line_end);
                    }
                }
                state = State::Plain;
                blanks = 0;
            }
            b'\r' => line_end = b"\r\n",
            _ => match state {
                State::Plain => {
                    blanks = if byte.is_ascii_whitespace() { blanks + 1 } else { 0 };
                    out.push(byte);
                }
                State::Escape => match hex(byte) {
                    Some(value) => state = State::Digit(byte, value),
                    // Blanks between `=` and the end of its line.
                    None if byte.is_ascii_whitespace() => {}
                    None => {
                        out.extend_from_slice(&[b'=', byte]);
                        blanks = 0;
                        state = State::Plain;
                    }
                },
                State::Digit(written, high) => {
                    match hex(byte) {
                        Some(low) => out.push((high << 4) | low),
                        None => out.extend_from_slice(&[b'=', written, byte]),
                    }
                    blanks = 0;
                    state = State::Plain;
                }
            },
        }
    }
    if let State::Digit(written, _) = state {
        out.extend_from_slice(&[b'=', written]);
    }
    out
}

/// The bytes of one attachment as the sender attached them.
///
/// `contents()` is that for a binary part. For a part the parser reads as TEXT
/// it is not: mail-parser hands out the text decoded to UTF-8, so a CSV written
/// in Windows-1252 would be saved and forwarded as a different file, and one
/// whose charset is not declared would lose every byte that is not UTF-8. The
/// file's own bytes are still in the message — the part's raw body with only
/// the transfer encoding taken off — and those are what a file is.
fn attachment_bytes(raw: &[u8], part: &mail_parser::MessagePart) -> Vec<u8> {
    use mail_parser::{Encoding, PartType};
    if !matches!(part.body, PartType::Text(_) | PartType::Html(_)) {
        return part.contents().to_vec();
    }
    let body = raw.get(part.offset_body as usize..part.offset_end as usize);
    let own = body.map(|body| match part.encoding {
        Encoding::None => body.to_vec(),
        Encoding::QuotedPrintable => quoted_printable_bytes(body),
        Encoding::Base64 => base64_bytes(body),
    });
    // A part whose place in the message is not where the parser says is still
    // better handed out as the parser read it than not at all.
    own.unwrap_or_else(|| part.contents().to_vec())
}

/// The attachments a caller names, out of ONE parse of the message.
///
/// `indexes` are positions in `attachments()` — the list `mail_fetch_message`
/// reported. They come back in the order asked, each once; one the message
/// does not have is simply absent from the answer, because a file that is not
/// there must not take the others with it.
fn attachment_contents(raw: &[u8], indexes: &[usize]) -> Result<Vec<FetchedAttachment>, String> {
    let parsed = parse_message(raw)?;
    let parts: Vec<_> = parsed.attachments().collect();
    let mut found: Vec<FetchedAttachment> = Vec::with_capacity(indexes.len());
    for &index in indexes {
        if found.iter().any(|f| f.index == index) {
            continue;
        }
        if let Some(part) = parts.get(index) {
            found.push(FetchedAttachment {
                index,
                content_base64: base64::engine::general_purpose::STANDARD.encode(attachment_bytes(raw, part)),
            });
        }
    }
    Ok(found)
}

/// Every attachment of one message the caller names, from ONE fetch of it.
///
/// `mail_fetch_attachment` loads the whole message for a single file, so the
/// three files of one mail were three full downloads. A forward wants all of
/// them at once, and this is the same cost as opening the message once more.
///
/// `uid_validity` is the mailbox epoch the message was READ under. A UID names
/// a message only within its epoch: once the server has renumbered the mailbox
/// the same number is another message, and its files must not end up on a
/// draft that says it forwards this one.
#[tauri::command]
// The flat IPC parameters of the commands beside it, plus the two of its own.
#[allow(clippy::too_many_arguments)]
pub async fn mail_fetch_attachments(
    host: String,
    port: u16,
    user: String,
    pass: String, auth: Option<MailAuth>,
    mailbox: String,
    uid: u32,
    indexes: Vec<usize>,
    uid_validity: Option<u32>,
) -> Result<Vec<FetchedAttachment>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&host, port, &user, &pass, auth, |session| {
            let selected = session
                .examine(&mailbox)
                .map_err(|e| format!("examine failed: {e}"))?;
            if uid_validity.is_some() && selected.uid_validity.is_some() && uid_validity != selected.uid_validity {
                return Err(MAILBOX_CHANGED.to_string());
            }
            let raw = fetch_raw(session, uid)?;
            attachment_contents(&raw, &indexes)
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Builds the draft MIME (multipart/alternative when HTML is present;
/// RFC 2047 header encoding via mail-builder). Extracted for the roundtrip
/// unit test below.
fn build_draft_mime(to: &str, cc: &str, bcc: &str, subject: &str, text: &str, html: Option<&str>, attachments: &[crate::mail_smtp::MailAttachment]) -> Result<Vec<u8>, String> {
    crate::mail_smtp::validate_headers(&[to, cc, bcc, subject])?;
    let mut builder = mail_builder::MessageBuilder::new()
        .to(to.to_string())
        .subject(subject.to_string())
        .text_body(text.to_string());
    // A stored draft keeps Cc and Bcc so the user's mail client shows them.
    if !cc.trim().is_empty() {
        builder = builder.cc(cc.to_string());
    }
    if !bcc.trim().is_empty() {
        builder = builder.bcc(bcc.to_string());
    }
    if let Some(html) = html {
        builder = builder.html_body(html.to_string());
    }
    builder = crate::mail_smtp::attach_all(builder, attachments)?;
    builder
        .write_to_vec()
        .map_err(|e| format!("mime build failed: {e}"))
}

/// Stage 6 "Mail-raus": stores a DRAFT in the user's own mailbox via IMAP
/// APPEND with the \Draft flag (the user's regular mail program can open and
/// send it) — complementary to direct submission via `mail_smtp::mail_send`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_append_draft(
    host: String,
    port: u16,
    user: String,
    pass: String, auth: Option<MailAuth>,
    mailbox: String,
    to: String,
    subject: String,
    text: String,
    html: Option<String>,
    attachments: Option<Vec<crate::mail_smtp::MailAttachment>>,
    cc: Option<String>,
    bcc: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mime = build_draft_mime(&to, &cc.unwrap_or_default(), &bcc.unwrap_or_default(), &subject, &text, html.as_deref(), attachments.as_deref().unwrap_or(&[]))?;
        crate::mail_smtp::validate_headers(&[&mailbox])?;
        with_session(&host, port, &user, &pass, auth, |session| {
            session
                // The IMAP library quotes mailbox names itself, exactly once.
                .append_with_flags(&mailbox, &mime, &[imap::types::Flag::Draft])
                .map_err(|e| format!("append failed: {e}"))?;
            Ok(())
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

// ---- Mailbox actions (mail-client E4) -------------------------------------

/// IMAP quoted-string escape for a free-text SEARCH term (backslash + quote). Pure.
fn escape_imap_string(s: &str) -> Result<String, String> {
    if s.contains(['\r', '\n', '\0']) {
        return Err("Invalid IMAP argument".into());
    }
    Ok(s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Builds the SEARCH argument for a free-text query. A non-ASCII query gets a
/// `CHARSET UTF-8` prefix so servers know the quoted bytes are UTF-8 (RFC 3501
/// forbids raw 8-bit in a quoted string without it — strict servers answer
/// `BAD [BADCHARSET]` otherwise). ASCII queries stay bare for maximum
/// compatibility. Pure.
fn build_search_arg(query: &str) -> Result<String, String> {
    let body = format!("TEXT \"{}\"", escape_imap_string(query)?);
    if query.is_ascii() {
        Ok(body)
    } else {
        Ok(format!("CHARSET UTF-8 {body}"))
    }
}

/// Sets or clears the `\Seen` flag on a message.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_set_seen(host: String, port: u16, user: String, pass: String, auth: Option<MailAuth>, mailbox: String, uid: u32, seen: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_writable(&host, port, &user, &pass, auth, &mailbox, |session| {
            let op = if seen { "+FLAGS (\\Seen)" } else { "-FLAGS (\\Seen)" };
            session.uid_store(uid.to_string(), op).map_err(|e| format!("store failed: {e}"))?;
            Ok(())
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Sets or clears the RFC 3501 `\Flagged` marker on a message.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_set_flagged(host: String, port: u16, user: String, pass: String, auth: Option<MailAuth>, mailbox: String, uid: u32, flagged: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_writable(&host, port, &user, &pass, auth, &mailbox, |session| {
            let op = if flagged { "+FLAGS (\\Flagged)" } else { "-FLAGS (\\Flagged)" };
            session.uid_store(uid.to_string(), op).map_err(|e| format!("store failed: {e}"))?;
            Ok(())
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Sets or clears the `$Junk` keyword and its counterpart `$NotJunk` (S12).
///
/// Both are CUSTOM keywords, not system flags: a server may refuse them outright
/// (no `\*` in PERMANENTFLAGS), and one that stores them may still train nothing
/// from them. So this is allowed to fail, and the caller treats a failure as
/// "not trained" rather than as a failed action — the move into the junk folder
/// is what carries the message where it belongs.
///
/// The pair is kept consistent: marking junk clears `$NotJunk` and the other way
/// round, so a message never carries both at once.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_set_junk(host: String, port: u16, user: String, pass: String, auth: Option<MailAuth>, mailbox: String, uid: u32, junk: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_writable(&host, port, &user, &pass, auth, &mailbox, |session| {
            let (add, remove) = if junk { ("$Junk", "$NotJunk") } else { ("$NotJunk", "$Junk") };
            session
                .uid_store(uid.to_string(), format!("+FLAGS ({add})"))
                .map_err(|e| format!("store failed: {e}"))?;
            // Clearing the opposite keyword may fail on its own; the message is
            // already marked correctly, so that is not worth failing over.
            let _ = session.uid_store(uid.to_string(), format!("-FLAGS ({remove})"));
            Ok(())
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Creates a mailbox. Used when an account has no junk folder at all — Plainva
/// offers to make one rather than moving mail into a name it invented.
#[tauri::command]
pub async fn mail_create_mailbox(host: String, port: u16, user: String, pass: String, auth: Option<MailAuth>, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&host, port, &user, &pass, auth, |session| {
            session.create(&name).map_err(|e| format!("create failed: {e}"))?;
            // Not every server subscribes a freshly created mailbox, and an
            // unsubscribed folder is invisible in clients that list by
            // subscription. Best-effort: the folder exists either way.
            let _ = session.subscribe(&name);
            Ok(())
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MailBulkAction { Seen { value: bool }, Flagged { value: bool }, Move { target: String }, Delete }

#[derive(Serialize)]
pub struct MailBulkResult { uid: u32, status: &'static str, reason: Option<&'static str> }

fn uid_flags(session: &mut ImapSession, uids: &[u32]) -> Result<std::collections::HashMap<u32, (bool, bool)>, String> {
    let set = uids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    let rows = session.uid_fetch(set, "(UID FLAGS)").map_err(|_| "Could not verify message flags")?;
    Ok(rows.iter().filter_map(|f| f.uid.map(|uid| (uid, (
        f.flags().iter().any(|v| matches!(v, imap::types::Flag::Seen)),
        f.flags().iter().any(|v| matches!(v, imap::types::Flag::Flagged)),
    )))).collect())
}

/// No automatic replay after an uncertain write. The existing account pool
/// owns the session throughout SELECT, verification, mutation and read-back.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_bulk_action(host: String, port: u16, user: String, pass: String, auth: Option<MailAuth>, mailbox: String, uids: Vec<u32>, uid_validity: Option<u32>, action: MailBulkAction) -> Result<Vec<MailBulkResult>, String> {
    if uids.len() > 100 || uids.contains(&0) { return Err("Invalid mail UID batch".into()); }
    if uids.is_empty() { return Ok(vec![]); }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&host, port, &user, &pass, auth, |session| {
            let selected = session.select(&mailbox).map_err(|_| "Could not open the mailbox")?;
            let all_failed = |reason| uids.iter().map(|uid| MailBulkResult { uid: *uid, status: "failed", reason: Some(reason) }).collect();
            if uid_validity.is_some() && uid_validity != selected.uid_validity { return Ok(all_failed("changed")); }
            let caps = session.capabilities().map_err(|_| "Could not read mailbox capabilities")?;
            if (matches!(action, MailBulkAction::Move { .. }) && !caps.has_str("MOVE")) || (matches!(action, MailBulkAction::Delete) && !caps.has_str("UIDPLUS")) { return Ok(all_failed("unsupported")); }
            let before = uid_flags(session, &uids)?;
            let present: Vec<u32> = uids.iter().copied().filter(|uid| before.contains_key(uid)).collect();
            if present.is_empty() { return Ok(all_failed("missing")); }
            let set = present.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
            let changed = match &action {
                MailBulkAction::Seen { value } => session.uid_store(&set, if *value { "+FLAGS (\\Seen)" } else { "-FLAGS (\\Seen)" }).map(|_| ()),
                MailBulkAction::Flagged { value } => session.uid_store(&set, if *value { "+FLAGS (\\Flagged)" } else { "-FLAGS (\\Flagged)" }).map(|_| ()),
                MailBulkAction::Move { target } => if target == &mailbox { Ok(()) } else { session.uid_mv(&set, target) },
                MailBulkAction::Delete => session.uid_store(&set, "+FLAGS (\\Deleted)").and_then(|_| session.uid_expunge(&set)).map(|_| ()),
            };
            let after = uid_flags(session, &present);
            Ok(uids.iter().map(|uid| {
                if !before.contains_key(uid) { return MailBulkResult { uid: *uid, status: "failed", reason: Some("missing") }; }
                let applied = after.as_ref().ok().is_some_and(|flags| match &action {
                    MailBulkAction::Seen { value } => flags.get(uid).is_some_and(|v| v.0 == *value),
                    MailBulkAction::Flagged { value } => flags.get(uid).is_some_and(|v| v.1 == *value),
                    MailBulkAction::Move { target } if target == &mailbox => true,
                    _ => changed.is_ok() && !flags.contains_key(uid),
                });
                if applied { MailBulkResult { uid: *uid, status: "done", reason: None } }
                else { MailBulkResult { uid: *uid, status: if after.is_err() || matches!(action, MailBulkAction::Move { .. } | MailBulkAction::Delete) { "uncertain" } else { "failed" }, reason: Some(if after.is_err() { "connection" } else { "rejected" }) } }
            }).collect())
        })
    }).await.map_err(|_| "Mail task failed".to_string())?
}

/// Permanent deletion requires targeted UID EXPUNGE. Temporarily clearing
/// other clients' Deleted flags cannot make global EXPUNGE safe under races.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_delete_message(host: String, port: u16, user: String, pass: String, auth: Option<MailAuth>, mailbox: String, uid: u32) -> Result<(), String> {
    let result = mail_bulk_action(host, port, user, pass, auth, mailbox, vec![uid], None, MailBulkAction::Delete).await?;
    if result.first().is_some_and(|r| r.status == "done") { Ok(()) }
    else if result.first().is_some_and(|r| r.reason == Some("unsupported")) { Err("MAIL_BULK_UNSUPPORTED".into()) }
    else { Err("The mail server did not confirm the deletion".into()) }
}

/// Moves a message to another mailbox (used for both "move" and "delete to
/// Trash"). Uses the MOVE extension; deletion stays reversible.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_move_message(host: String, port: u16, user: String, pass: String, auth: Option<MailAuth>, mailbox: String, uid: u32, target: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_writable(&host, port, &user, &pass, auth, &mailbox, |session| {
            if !session.capabilities().map_err(|_| "Could not read mailbox capabilities")?.has_str("MOVE") { return Err("MAIL_BULK_UNSUPPORTED".into()); }
            session.uid_mv(uid.to_string(), &target).map_err(|e| format!("move failed: {e}"))?;
            Ok(())
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Full-text SEARCH in a mailbox (read-only EXAMINE); returns matching UIDs,
/// newest first.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_search(host: String, port: u16, user: String, pass: String, auth: Option<MailAuth>, mailbox: String, query: String) -> Result<Vec<u32>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&host, port, &user, &pass, auth, |session| {
            session.examine(&mailbox).map_err(|e| format!("examine failed: {e}"))?;
            let search = build_search_arg(&query)?;
            let uids = session.uid_search(&search).map_err(|e| format!("search failed: {e}"))?;
            let mut v: Vec<u32> = uids.into_iter().collect();
            v.sort_unstable_by(|a, b| b.cmp(a));
            Ok(v)
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Searches a mailbox and returns the matching ENVELOPES (newest first), not
/// just UIDs — so hits that are not in the currently loaded page still show.
/// The fetch is capped so a very broad query cannot pull an unbounded set.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_search_envelopes(
    host: String,
    port: u16,
    user: String,
    pass: String, auth: Option<MailAuth>,
    mailbox: String,
    query: String,
    limit: u32,
) -> Result<Vec<MailEnvelope>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&host, port, &user, &pass, auth, |session| {
            let selected = session.examine(&mailbox).map_err(|e| format!("examine failed: {e}"))?;
            let search = build_search_arg(&query)?;
            let uids = session.uid_search(&search).map_err(|e| format!("search failed: {e}"))?;
            let mut ordered: Vec<u32> = uids.into_iter().collect();
            ordered.sort_unstable_by(|a, b| b.cmp(a)); // highest UID = newest first
            let cap = limit.min(500) as usize;
            ordered.truncate(cap.max(1));
            if ordered.is_empty() {
                return Ok(Vec::new());
            }
            let set = ordered.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
            let fetches = session
                .uid_fetch(set, "(UID FLAGS BODYSTRUCTURE INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)])")
                .map_err(|e| format!("fetch failed: {e}"))?;
            let mut messages: Vec<MailEnvelope> = fetches.iter().filter_map(|f| fetch_to_envelope(f, selected.uid_validity)).collect();
            // The server may return the set in any order; sort newest first by date.
            messages.sort_by_key(|m| std::cmp::Reverse(m.date_ts));
            Ok(messages)
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Returns the newest flagged messages from one mailbox (server-side filter).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_list_flagged_envelopes(
    host: String,
    port: u16,
    user: String,
    pass: String, auth: Option<MailAuth>,
    mailbox: String,
    limit: u32,
) -> Result<Vec<MailEnvelope>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_session(&host, port, &user, &pass, auth, |session| {
            let selected = session.examine(&mailbox).map_err(|e| format!("examine failed: {e}"))?;
            let mut ordered: Vec<u32> = session.uid_search("FLAGGED").map_err(|e| format!("search flagged failed: {e}"))?.into_iter().collect();
            ordered.sort_unstable_by(|a, b| b.cmp(a));
            ordered.truncate(limit.clamp(1, 500) as usize);
            if ordered.is_empty() {
                return Ok(Vec::new());
            }
            let set = ordered.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
            let fetches = session
                .uid_fetch(set, "(UID FLAGS BODYSTRUCTURE INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)])")
                .map_err(|e| format!("fetch failed: {e}"))?;
            let mut messages: Vec<MailEnvelope> = fetches.iter().filter_map(|f| fetch_to_envelope(f, selected.uid_validity)).collect();
            messages.sort_by_key(|m| std::cmp::Reverse(m.date_ts));
            Ok(messages)
        })
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_special_use_role_the_server_states() {
        // Gmail: the spam folder is `\Junk` in every display language.
        assert_eq!(special_use_role(["\\HasNoChildren", "\\Junk"]), Some("junk"));
        assert_eq!(special_use_role(["\\hasnochildren", "\\TRASH"]), Some("trash"));
        assert_eq!(special_use_role(["\\Sent"]), Some("sent"));
        assert_eq!(special_use_role(["\\Drafts"]), Some("drafts"));
        assert_eq!(special_use_role(["\\Archive"]), Some("archive"));
        // Views, not folders to file into; and a keyword without the backslash
        // is not a system flag.
        assert_eq!(special_use_role(["\\All"]), None);
        assert_eq!(special_use_role(["\\Flagged", "\\Important"]), None);
        assert_eq!(special_use_role(["Junk"]), None);
        assert_eq!(special_use_role(Vec::<&str>::new()), None);
    }

    #[test]
    fn rejects_search_command_injection() {
        for query in ["x\r\nA9 LOGOUT", "x\nUID STORE 1 +FLAGS (\\Deleted)", "x\0y"] {
            assert!(build_search_arg(query).is_err());
        }
        assert_eq!(build_search_arg("a\\\"b").unwrap(), "TEXT \"a\\\\\\\"b\"");
    }

    #[test]
    fn draft_keeps_bcc_unicode_names_and_attachment_bytes() {
        let name = format!("{}.pdf", "Grüße-日本語-".repeat(20));
        let attachments = [crate::mail_smtp::MailAttachment { name: name.clone(), mime: "application/pdf".into(), content_base64: "AAECA//+".into() }];
        let mime = build_draft_mime("to@example.invalid", "cc@example.invalid", "bcc@example.invalid", "Grüße 日本語", "", Some("<p>Hallo</p>"), &attachments).unwrap();
        let parsed = parse_message(&mime).unwrap();
        assert_eq!(header_text(&parsed, mail_parser::HeaderName::Subject), "Grüße 日本語");
        assert_eq!(address_text(parsed.header(mail_parser::HeaderName::Bcc).and_then(|h| h.as_address())), "bcc@example.invalid");
        let part = parsed.attachments().next().unwrap();
        assert_eq!(part.attachment_name(), Some(name.as_str()));
        assert_eq!(part.contents(), &[0, 1, 2, 3, 255, 254]);
        assert!(build_draft_mime("to@example.invalid", "", "", "x\r\nBcc: injected@example.invalid", "", None, &[]).is_err());
    }

    #[test]
    fn received_inline_image_keeps_cid_and_binary_payload() {
        let raw = b"MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=B\r\n\r\n--B\r\nContent-Type: text/html\r\n\r\n<img src=\"cid:picture\">\r\n--B\r\nContent-Type: image/png\r\nContent-ID: <picture>\r\nContent-Disposition: inline; filename=picture.png\r\nContent-Transfer-Encoding: base64\r\n\r\nAAECA//+\r\n--B--\r\n";
        let parsed = parse_message(raw).unwrap();
        assert!(parsed.body_html(0).unwrap().contains("cid:picture"));
        let part = parsed.attachments().next().unwrap();
        assert_eq!(part.content_id(), Some("picture"));
        assert_eq!(part.contents(), &[0, 1, 2, 3, 255, 254]);
    }

    #[test]
    fn escapes_imap_search_strings() {
        assert_eq!(escape_imap_string("hello").unwrap(), "hello");
        assert_eq!(escape_imap_string("a\"b").unwrap(), "a\\\"b");
        assert_eq!(escape_imap_string("a\\b").unwrap(), "a\\\\b");
        assert_eq!(escape_imap_string("Drafts \\\"Team\\\"").unwrap(), "Drafts \\\\\\\"Team\\\\\\\"");
    }

    #[test]
    fn search_arg_declares_utf8_only_for_non_ascii() {
        assert_eq!(build_search_arg("invoice").unwrap(), "TEXT \"invoice\"");
        // A non-ASCII query gets the CHARSET prefix so strict servers accept it.
        assert_eq!(build_search_arg("Grüße").unwrap(), "CHARSET UTF-8 TEXT \"Grüße\"");
        assert_eq!(build_search_arg("日本語").unwrap(), "CHARSET UTF-8 TEXT \"日本語\"");
    }

    #[test]
    fn loopback_hosts_are_recognized() {
        assert!(is_loopback_host("127.0.0.1"));
        assert!(is_loopback_host("localhost"));
        assert!(is_loopback_host("LocalHost"));
        assert!(is_loopback_host("::1"));
        assert!(is_loopback_host("[::1]"));
        assert!(is_loopback_host("127.5.5.5")); // whole 127.0.0.0/8 is loopback
        assert!(!is_loopback_host("imap.gmail.com"));
        assert!(!is_loopback_host("10.0.0.1"));
        assert!(!is_loopback_host("192.168.1.1"));
        assert!(!is_loopback_host("example.com"));
    }

    #[test]
    fn tls_config_builds_for_both_host_kinds() {
        // Smoke: the loopback (accept-any) and the real-host (webpki) configs
        // both construct without panicking.
        let _loopback = tls_config_for("127.0.0.1");
        let _real = tls_config_for("imap.fastmail.com");
    }

    const SAMPLE: &[u8] = b"From: Anna Beispiel <anna@example.org>\r\nTo: marco@example.org\r\nSubject: =?utf-8?q?Gr=C3=BC=C3=9Fe?=\r\nDate: Mon, 20 Jul 2026 10:00:00 +0200\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=B\r\n\r\n--B\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHallo Welt\r\n--B\r\nContent-Type: application/pdf; name=doc.pdf\r\nContent-Disposition: attachment; filename=doc.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0=\r\n--B--\r\n";

    #[test]
    fn draft_mime_roundtrips_through_the_parser() {
        let mime = build_draft_mime("empfaenger@example.org", "", "", "Grüße aus Plainva", "Hallo Welt", Some("<p>Hallo <b>Welt</b></p>"), &[])
            .expect("builds");
        let parsed = parse_message(&mime).expect("parses");
        assert_eq!(header_text(&parsed, mail_parser::HeaderName::Subject), "Grüße aus Plainva");
        assert_eq!(
            address_text(parsed.header(mail_parser::HeaderName::To).and_then(|h| h.as_address())),
            "empfaenger@example.org"
        );
        assert_eq!(parsed.body_text(0).as_deref(), Some("Hallo Welt"));
        assert!(parsed.body_html(0).expect("html part").contains("<b>Welt</b>"));
    }

    #[test]
    fn parses_rfc2047_headers_bodies_and_attachments() {
        let parsed = parse_message(SAMPLE).expect("parses");
        assert_eq!(header_text(&parsed, mail_parser::HeaderName::Subject), "Gr\u{00fc}\u{00df}e");
        assert_eq!(
            address_text(parsed.header(mail_parser::HeaderName::From).and_then(|h| h.as_address())),
            "Anna Beispiel <anna@example.org>"
        );
        assert_eq!(parsed.body_text(0).as_deref(), Some("Hallo Welt"));
        let atts: Vec<_> = parsed.attachments().collect();
        assert_eq!(atts.len(), 1);
        assert_eq!(atts[0].attachment_name(), Some("doc.pdf"));
    }

    /// The text of a message is its plain-text part, or none (finding
    /// 2026-10-09): for an HTML-only mail the shared mail core makes the text
    /// from the markup, the same on both shells and without what the message
    /// hides. mail-parser's own conversion — one line, hidden parts included —
    /// must not reach the frontend as if the sender had written it.
    #[test]
    fn reports_a_plain_text_body_only_where_the_message_has_one() {
        let html_only = b"From: a@example.org\r\nSubject: Rechnung\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<div style=\"display:none\">Vorschau</div><p>Hallo</p><p>Welt</p>\r\n";
        let parsed = parse_message(html_only).expect("parses");
        assert_eq!(plain_text_body(&parsed), None);
        assert!(parsed.body_html(0).expect("html part").contains("<p>Hallo</p>"));
        // What the frontend used to receive as the text of this message.
        assert!(parsed.body_text(0).expect("converted").contains("Vorschau"));

        let both = b"MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=B\r\n\r\n--B\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHallo Welt\r\n--B\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hallo <b>Welt</b></p>\r\n--B--\r\n";
        let parsed = parse_message(both).expect("parses");
        assert_eq!(plain_text_body(&parsed).as_deref(), Some("Hallo Welt"));

        assert_eq!(plain_text_body(&parse_message(SAMPLE).expect("parses")).as_deref(), Some("Hallo Welt"));

        // An 8-bit body in a charset that is not UTF-8 arrives as its text.
        let latin1 = b"MIME-Version: 1.0\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: 8bit\r\n\r\nGr\xfc\xdfe aus M\xfcnchen.\r\n";
        let parsed = parse_message(latin1).expect("parses");
        assert_eq!(plain_text_body(&parsed).as_deref().map(str::trim_end), Some("Gr\u{00fc}\u{00df}e aus M\u{00fc}nchen."));
    }

    /// One fixture, one expected string, on both sides of the IPC: the same
    /// bytes and the same base64 stand in `rawFetchContract.test.ts`, where the
    /// phone's socket client and Microsoft Graph have to produce it too. The
    /// bytes are a mail no text decoder leaves alone — UTF-8, a lone Latin-1
    /// byte, a NUL and a bare line feed.
    #[test]
    fn raw_message_is_standard_base64_of_the_untouched_bytes() {
        let raw = b"Subject: Gr\xc3\xbc\xc3\x9fe\r\n\r\nM\xfcnchen \x00 \xff\n";
        assert_eq!(raw_message_base64(raw), "U3ViamVjdDogR3LDvMOfZQ0KDQpN/G5jaGVuIAAg/wo=");
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(raw_message_base64(raw)).expect("decodes"), raw);
    }

    fn fetched_bytes(found: &FetchedAttachment) -> Vec<u8> {
        base64::engine::general_purpose::STANDARD.decode(&found.content_base64).unwrap()
    }

    /// A message with three files: a PDF, and the same Latin-1 text twice — once
    /// as the bytes themselves, once in quoted-printable.
    fn three_files(csv_encoding: &str, csv_body: &[u8]) -> Vec<u8> {
        let mut raw = Vec::new();
        raw.extend_from_slice(b"From: anna@example.org\r\nSubject: Dateien\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=B\r\n\r\n");
        raw.extend_from_slice(b"--B\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSiehe Anhang.\r\n");
        raw.extend_from_slice(b"--B\r\nContent-Type: application/pdf; name=a.pdf\r\nContent-Disposition: attachment; filename=a.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0=\r\n");
        raw.extend_from_slice(b"--B\r\nContent-Type: text/csv; charset=iso-8859-1; name=liste.csv\r\nContent-Disposition: attachment; filename=liste.csv\r\nContent-Transfer-Encoding: ");
        raw.extend_from_slice(csv_encoding.as_bytes());
        raw.extend_from_slice(b"\r\n\r\n");
        raw.extend_from_slice(csv_body);
        raw.extend_from_slice(b"\r\n--B\r\nContent-Type: image/png\r\nContent-Disposition: attachment; filename=b.png\r\nContent-Transfer-Encoding: base64\r\n\r\nAAECA//+\r\n--B--\r\n");
        raw
    }

    /// "Größe;Müller" + CRLF + "1;ä", written in ISO-8859-1.
    const LATIN1_CSV: &[u8] = b"Gr\xf6\xdfe;M\xfcller\r\n1;\xe4";

    #[test]
    fn hands_out_the_named_attachments_from_one_parse() {
        let raw = three_files("8bit", LATIN1_CSV);
        // In the order asked, each once; the index the message does not have is
        // absent and does not cost the others.
        let found = attachment_contents(&raw, &[2, 0, 2, 7]).unwrap();
        assert_eq!(found.iter().map(|f| f.index).collect::<Vec<_>>(), vec![2, 0]);
        assert_eq!(fetched_bytes(&found[0]), vec![0, 1, 2, 3, 255, 254]);
        assert_eq!(fetched_bytes(&found[1]), b"%PDF-");
        assert!(attachment_contents(&raw, &[]).unwrap().is_empty());
        assert!(attachment_contents(b"", &[0]).is_err());
    }

    #[test]
    fn a_text_attachment_keeps_the_bytes_it_was_attached_with() {
        // The parser reads a text part as text and hands it out decoded to
        // UTF-8. A file is its bytes: a CSV in Latin-1 must leave as Latin-1,
        // whichever transfer encoding it travelled in.
        let cases: [(&str, &[u8]); 3] = [
            ("8bit", LATIN1_CSV),
            ("quoted-printable", b"Gr=F6=DFe;M=FCller\r\n1;=E4"),
            ("base64", b"R3L232U7TfxsbGVyDQox\r\nO+Q="),
        ];
        for (encoding, body) in cases {
            let raw = three_files(encoding, body);
            // What the parser itself offers is NOT these bytes — the reason
            // this function exists, held here so it stays true.
            let parsed = parse_message(&raw).unwrap();
            let as_parsed = parsed.attachments().nth(1).unwrap().contents().to_vec();
            assert_ne!(as_parsed, LATIN1_CSV, "{encoding}: the parser already hands out the file's own bytes");

            let found = attachment_contents(&raw, &[1]).unwrap();
            assert_eq!(fetched_bytes(&found[0]), LATIN1_CSV, "{encoding}");
        }
    }

    #[test]
    fn quoted_printable_is_read_as_the_parser_reads_it_where_it_is_well_formed() {
        // Soft line breaks, blanks the transport added at a line's end, a blank
        // that was encoded to survive there, both kinds of line end, lower-case
        // digits: on all of it the two readers agree.
        let bodies: [&[u8]; 6] = [
            b"Gr=F6=DFe;M=FCller\r\n1;=E4",
            b"eine lange Zei=\r\nle ohne Umbruch",
            b"am Ende Leerzeichen   \r\nund eins, das bleibt=20\r\n",
            b"weich mit Leerzeichen dahinter=  \r\nweiter",
            b"nur LF\nzweite=3D=3d\n",
            b"",
        ];
        for body in bodies {
            let strict = mail_parser::decoders::quoted_printable::quoted_printable_decode(body);
            assert_eq!(Some(quoted_printable_bytes(body)), strict, "{:?}", String::from_utf8_lossy(body));
        }
        assert_eq!(quoted_printable_bytes(b"a=\r\nb"), b"ab");
        assert_eq!(quoted_printable_bytes(b"x  \r\ny=20\r\n"), b"x\r\ny \r\n");
    }

    #[test]
    fn a_stray_equals_sign_does_not_cost_a_text_attachment_its_bytes() {
        // Not every generator encodes `=`. The strict reader gives such a part
        // up, and the file was then handed out as the parser's UTF-8 reading —
        // another file, and nothing said so.
        let sloppy: [(&[u8], &[u8]); 4] = [
            (b"a=b;Gr=F6=DFe", b"a=b;Gr\xf6\xdfe"),
            (b"x==F6", b"x=\xf6"),
            (b"Summe=4;=E4", b"Summe=4;\xe4"),
            (b"=Zz=F6", b"=Zz\xf6"),
        ];
        for (body, bytes) in sloppy {
            assert!(mail_parser::decoders::quoted_printable::quoted_printable_decode(body).is_none(), "{:?} is well-formed after all", String::from_utf8_lossy(body));
            assert_eq!(quoted_printable_bytes(body), bytes, "{:?}", String::from_utf8_lossy(body));
        }
        // Cut off in the middle of an escape: what stands there stays. (The
        // strict reader drops it without a word, so no comparison here.)
        assert_eq!(quoted_printable_bytes(b"am Ende=4"), b"am Ende=4");
        assert_eq!(quoted_printable_bytes(b"am Ende="), b"am Ende");
        // End to end: the Latin-1 list with one `=` nobody encoded.
        let raw = three_files("quoted-printable", b"Gr=F6=DFe;M=FCller\r\na=b;=E4");
        let found = attachment_contents(&raw, &[1]).unwrap();
        assert_eq!(fetched_bytes(&found[0]), b"Gr\xf6\xdfe;M\xfcller\r\na=b;\xe4");
    }

    #[test]
    fn a_single_attachment_is_the_same_bytes_as_in_the_batch() {
        let raw = three_files("8bit", LATIN1_CSV);
        let one = attachment_contents(&raw, &[1]).unwrap().pop().map(|f| f.content_base64);
        let all = attachment_contents(&raw, &[0, 1, 2]).unwrap();
        assert_eq!(one.as_deref(), Some(all[1].content_base64.as_str()));
    }

    const PDF_PART: &[u8] = b"--bnd\r\nContent-Type: application/pdf; name=\"rechnung.pdf\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"rechnung.pdf\"\r\n\r\nAAECA//+\r\n";

    /// The message `imapClient.test.ts` builds as `mixed`: `parts`, and a PDF
    /// behind them.
    fn mixed(parts: &[u8]) -> Vec<u8> {
        let mut raw = Vec::new();
        raw.extend_from_slice(b"From: Anna Beispiel <anna@example.org>\r\nSubject: Reise\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"bnd\"\r\n\r\n");
        raw.extend_from_slice(parts);
        raw.extend_from_slice(PDF_PART);
        raw.extend_from_slice(b"--bnd--\r\n");
        raw
    }

    /// The file of the message `imapClient.test.ts` builds as `withFile` — the
    /// text, a file of type `mime` whose base64 body is `data`, and the PDF —
    /// as the frontend receives it. The text and the PDF beside it have to be
    /// what they are, whatever the file's body is.
    fn file_of(mime: &str, data: &[u8]) -> Vec<u8> {
        let mut parts = Vec::new();
        parts.extend_from_slice(b"--bnd\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nHallo Marco,\r\n");
        parts.extend_from_slice(format!("--bnd\r\nContent-Type: {mime}; name=\"datei.bin\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"datei.bin\"\r\n\r\n").as_bytes());
        parts.extend_from_slice(data);
        parts.extend_from_slice(b"\r\n");
        let raw = mixed(&parts);
        let written = String::from_utf8_lossy(data);
        let parsed = parse_message(&raw).expect("parses");
        assert_eq!(plain_text_body(&parsed).as_deref(), Some("Hallo Marco,"), "{written:?}");
        let found = attachment_contents(&raw, &[0, 1]).unwrap();
        assert_eq!(found.len(), 2, "{written:?}");
        assert_eq!(fetched_bytes(&found[1]), vec![0, 1, 2, 3, 255, 254], "{written:?}");
        fetched_bytes(&found[0])
    }

    fn subject_of(word: &str) -> String {
        let raw = format!("From: a@example.org\r\nSubject: {word}\r\n\r\nText\r\n");
        header_text(&parse_message(raw.as_bytes()).expect("parses"), mail_parser::HeaderName::Subject)
    }

    /// "Grüße aus München." as the text of a message in base64, the second
    /// line ending in `last_line`.
    fn base64_text(last_line: &str) -> Vec<u8> {
        format!("From: a@example.org\r\nSubject: Reise\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\nR3LDvMOfZQ==\r\n{last_line}\r\n").into_bytes()
    }

    /// What a `=` inside base64 means is one reading on both shells (finding
    /// 2026-10-12): it ends a group, and the reading goes on behind it. A
    /// generator that pads every line on its own, or joins two encodings into
    /// one, writes that. The rows are the ones `imapClient.test.ts` holds for
    /// the phone's reader, which threw on most of them — on every `=` that is
    /// not exactly the padding its length asks for, and on a single character
    /// left over — and lost the whole message with it.
    #[test]
    fn base64_with_padding_inside_is_read_whole() {
        let rows: [(&[u8], &[u8]); 16] = [
            (b"SGVsbG8=\r\nV2VsdA==", b"HelloWelt"),
            (b"SGVsbG8=V2VsdA==", b"HelloWelt"),
            // One `=` short, and the padding as the rule wants it.
            (b"QQ=", b"A"),
            (b"QUJDRA=", b"ABCD"),
            (b"QUJDREU==", b"ABCDE"),
            // A `=` that has no group to end.
            (b"QUJD=", b"ABC"),
            (b"QUJD====", b"ABC"),
            (b"=", b""),
            (b"====", b""),
            (b"", b""),
            // A single character is six bits: in front of `=` they begin a byte, at the end they are none.
            (b"Q=", b"@"),
            (b"QUJDR", b"ABC"),
            // Blanks, line breaks and a lone hyphen are no base64 and are passed over.
            (b"QUJD RUZH", b"ABCEFG"),
            (b"QUJD\tRUZH", b"ABCEFG"),
            (b"QUJD\r\n\r\nRUZH", b"ABCEFG"),
            (b"QUJD-RUZH", b"ABCEFG"),
        ];
        for (data, file) in rows {
            let written = String::from_utf8_lossy(data);
            // A file that is not text is the parser's own reading; a text file
            // is read here (`attachment_bytes`). The same bytes either way.
            assert_eq!(file_of("application/octet-stream", data), file, "{written:?}");
            assert_eq!(file_of("text/csv", data), file, "as a text file: {written:?}");
        }
    }

    /// The same reading in the text of a message and in a word of a header,
    /// with the messages `imapClient.test.ts` holds for the phone's reader.
    #[test]
    fn padding_inside_base64_is_read_in_the_text_and_in_a_header() {
        // Every line encoded and padded on its own.
        let single = base64_text("IGF1cyBNw7xuY2hlbi4=");
        assert_eq!(plain_text_body(&parse_message(&single).expect("parses")).as_deref(), Some("Grüße aus München."));

        let both = b"From: a@example.org\r\nSubject: Reise\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"alt\"\r\n\r\n--alt\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\nR3LDvMOfZQ==\r\nIGF1cyBNw7xuY2hlbi4=\r\n--alt\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\nPHA+R3LDvMOfZQ==\r\nIGF1cyBNw7xuY2hlbi48L3A+\r\n--alt--\r\n";
        let parsed = parse_message(both).expect("parses");
        assert_eq!(plain_text_body(&parsed).as_deref(), Some("Grüße aus München."));
        assert_eq!(parsed.body_html(0).as_deref(), Some("<p>Grüße aus München.</p>"));

        // One `=` short, and a `=` inside the word.
        assert_eq!(subject_of("=?utf-8?B?R3LDvMOfZQ=?="), "Grüße");
        assert_eq!(subject_of("=?utf-8?B?R3LD=vMOfZQ==?="), "Grüße");
    }

    /// A text file is the bytes it was attached with, also where its base64 is
    /// padded line by line (finding 2026-10-12). The strict decoder this used
    /// to be refused such a body, and the file left as the parser's UTF-8
    /// reading of it: "Köln" in Latin-1 became another file.
    #[test]
    fn a_text_attachment_with_padding_inside_its_base64_keeps_its_bytes() {
        // "K\xf6" and "ln", each encoded and padded on its own.
        let raw = three_files("base64", b"S/Y=\r\nbG4=");
        let parsed = parse_message(&raw).unwrap();
        // What the parser offers for this part: its text, in UTF-8.
        assert_eq!(parsed.attachments().nth(1).unwrap().contents(), "Köln".as_bytes());
        let found = attachment_contents(&raw, &[1]).unwrap();
        assert_eq!(fetched_bytes(&found[0]), b"K\xf6ln");
    }

    /// Where this parser reads less than the phone's reader: the two points of
    /// the parity catalog's `mail-base64-reading`, each as the parser has it
    /// (`imapClient.test.ts` holds what the phone reads there). Held so that
    /// the entry goes when a difference goes.
    #[test]
    fn what_the_parser_gives_up_in_base64() {
        // 1. A last group without its padding is dropped: the last one or two
        //    bytes of a file, of the text of a message, of a word in a header.
        assert_eq!(file_of("application/octet-stream", b"QUJDRA"), b"ABC");
        assert_eq!(file_of("application/octet-stream", b"QUJDREU"), b"ABC");
        assert_eq!(file_of("application/octet-stream", b"SGVsbG8=V2VsdA"), b"HelloWel");
        let unpadded = base64_text("IGF1cyBNw7xuY2hlbi4");
        assert_eq!(plain_text_body(&parse_message(&unpadded).expect("parses")).as_deref(), Some("Grüße aus Münche"));
        assert_eq!(subject_of("=?utf-8?B?R3LDvMOfZQ?="), "Grüß");
        //    A text FILE is read here, not by the parser, and keeps them.
        assert_eq!(file_of("text/csv", b"QUJDRA"), b"ABCD");

        // 2. One character that is no base64 — other than a blank, a tab, a
        //    line break or a single hyphen —, and the part is not decoded at
        //    all. A file is handed out as it stands in the message, a text
        //    file too: the parser calls such a part not encoded …
        let foreign: [&[u8]; 5] = [b"QUJD*RUZH", b"QUJD--RUZH", b"QUJD.RUZH", b"QUJD\x0bRUZH", b"QUJDRU\xe4ZH"];
        for data in foreign {
            let written = String::from_utf8_lossy(data);
            assert_eq!(file_of("application/octet-stream", data), data, "{written:?}");
            assert_eq!(file_of("text/csv", data), data, "as a text file: {written:?}");
        }
        //    … a word in a header as it was written - in a word a hyphen too,
        //    which the parser passes over in a body …
        assert_eq!(subject_of("=?utf-8?B?R3LDvMOf*ZQ==?="), "=?utf-8?B?R3LDvMOf*ZQ==?=");
        assert_eq!(subject_of("=?utf-8?B?R3LD-vMOfZQ==?="), "=?utf-8?B?R3LD-vMOfZQ==?=");
        //    … and the text of a message is no longer its text: the part is
        //    listed as a file without a name.
        let raw = mixed(b"--bnd\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\nR3LDvMOfZQ==\r\n*IGF1cyBNw7xuY2hlbi4=\r\n");
        let parsed = parse_message(&raw).expect("parses");
        assert_eq!(plain_text_body(&parsed), None);
        assert_eq!(parsed.attachments().map(|part| part.attachment_name()).collect::<Vec<_>>(), vec![None, Some("rechnung.pdf")]);
    }

    /// A part needs no header lines (RFC 2046, 5.1): it begins with the empty
    /// line then, and is plain text from its first line - outside a
    /// multipart/digest (`a_digest_part_without_a_type_is_an_enclosed_message`).
    /// The phone's reader took the first paragraph of such a part for its
    /// header (finding 2026-10-12); these are the parts `imapClient.test.ts`
    /// holds for it.
    #[test]
    fn a_part_without_header_lines_is_text_from_its_first_line() {
        let text_of = |part: &str| {
            let raw = mixed(format!("--bnd\r\n{part}\r\n").as_bytes());
            let parsed = parse_message(&raw).expect("parses");
            assert_eq!(parsed.attachments().map(|file| file.attachment_name()).collect::<Vec<_>>(), vec![Some("rechnung.pdf")], "{part:?}");
            plain_text_body(&parsed)
        };
        assert_eq!(text_of("\r\nErster Absatz.\r\n\r\nZweiter Absatz.").as_deref(), Some("Erster Absatz.\r\n\r\nZweiter Absatz."));
        assert_eq!(text_of("\r\nNur eine Zeile.").as_deref(), Some("Nur eine Zeile."));
        // A first line that looks like a header line is text behind the empty line.
        assert_eq!(text_of("\r\nHinweis: das ist Text.\r\n\r\nZweiter Absatz.").as_deref(), Some("Hinweis: das ist Text.\r\n\r\nZweiter Absatz."));
        // Only ONE empty line ends the header lines; further ones are the text's own.
        assert_eq!(text_of("\r\n\r\n\r\nErster Absatz.").as_deref(), Some("\r\n\r\nErster Absatz."));
        // A part that is nothing but the empty line is an empty text.
        assert_eq!(plain_text_body(&parse_message(&mixed(b"--bnd\r\n\r\n")).expect("parses")).as_deref(), Some(""));

        // Written with bare line feeds.
        let bare = b"Subject: Reise\nContent-Type: multipart/mixed; boundary=\"bnd\"\n\n--bnd\n\nErster Absatz.\n\nZweiter Absatz.\n--bnd--\n";
        assert_eq!(plain_text_body(&parse_message(bare).expect("parses")).as_deref(), Some("Erster Absatz.\n\nZweiter Absatz."));

        // As the plain version next to an HTML one.
        let both = b"Subject: Reise\r\nContent-Type: multipart/alternative; boundary=\"alt\"\r\n\r\n--alt\r\n\r\nErster Absatz.\r\n\r\nZweiter Absatz.\r\n--alt\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Erster Absatz.</p><p>Zweiter Absatz.</p>\r\n--alt--\r\n";
        let parsed = parse_message(both).expect("parses");
        assert_eq!(plain_text_body(&parsed).as_deref(), Some("Erster Absatz.\r\n\r\nZweiter Absatz."));
        assert_eq!(parsed.body_html(0).as_deref(), Some("<p>Erster Absatz.</p><p>Zweiter Absatz.</p>"));

        // A whole message without header lines.
        let headerless = b"\r\nErster Absatz.\r\n\r\nZweiter Absatz.\r\n";
        assert_eq!(plain_text_body(&parse_message(headerless).expect("parses")).as_deref(), Some("Erster Absatz.\r\n\r\nZweiter Absatz.\r\n"));
    }

    /// An empty line between a delimiter and the header lines of a part — a
    /// generator's mistake — leaves the part without a header by the rule: the
    /// lines behind it are its text, and a file behind it is no file of the
    /// message. The phone's reader took such lines for the header by accident
    /// and reads them as this parser does now; `imapClient.test.ts` holds the
    /// same two messages for it.
    #[test]
    fn header_lines_behind_the_empty_line_are_the_parts_text() {
        let versions = b"Subject: Reise\r\nContent-Type: multipart/alternative; boundary=\"sl\"\r\n\r\n--sl\r\n\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nGr=C3=BC=C3=9Fe\r\n--sl\r\n\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hallo</p>\r\n--sl--\r\n";
        let parsed = parse_message(versions).expect("parses");
        assert_eq!(
            plain_text_body(&parsed).as_deref(),
            Some("Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nGr=C3=BC=C3=9Fe")
        );
        // A file behind such a line is text as well, and no file of the message.
        let file = b"Subject: Reise\r\nContent-Type: multipart/mixed; boundary=\"b\"\r\n\r\n--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHallo Marco,\r\n--b\r\n\r\nContent-Type: application/pdf; name=\"a.pdf\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"a.pdf\"\r\n\r\nAAECA//+\r\n--b--\r\n";
        let parsed = parse_message(file).expect("parses");
        assert_eq!(plain_text_body(&parsed).as_deref(), Some("Hallo Marco,"));
        assert_eq!(parsed.attachments().count(), 0);
    }

    /// In a multipart/digest a part that names no type of its own is an
    /// enclosed message (RFC 2046, 5.1.5): this parser has no text for the
    /// digest and lists the enclosed messages as files. The phone's reader does
    /// not know that default (parity catalog, `mail-digest-parts`);
    /// `imapClient.test.ts` holds the same message for it.
    #[test]
    fn a_digest_part_without_a_type_is_an_enclosed_message() {
        let digest = b"Subject: Reise\r\nContent-Type: multipart/digest; boundary=\"dg\"\r\n\r\n--dg\r\n\r\nFrom: anna@example.org\r\nSubject: Erste\r\n\r\nText der ersten.\r\n--dg\r\n\r\nFrom: ben@example.org\r\nSubject: Zweite\r\n\r\nText der zweiten.\r\n--dg--\r\n";
        let parsed = parse_message(digest).expect("parses");
        assert_eq!(plain_text_body(&parsed), None);
        assert_eq!(parsed.attachments().count(), 2);
    }

    /// P9.1: the thread headers of an envelope, read out of the header block the
    /// FETCH returns. Two traps are pinned here.
    #[test]
    fn reads_thread_headers_from_a_header_block() {
        // A folded References header with three ids — the realistic shape.
        let raw = concat!(
            "Subject: Re: Angebot\r\n",
            "From: Ada <ada@example.com>\r\n",
            "Message-ID: <c@z.org>\r\n",
            "In-Reply-To: <b@y.org>\r\n",
            "References: <a@x.org>\r\n\t<b@y.org>\r\n",
            "\r\n"
        );
        let parsed = mail_parser::MessageParser::default().parse(raw.as_bytes()).unwrap();

        // mail-parser strips the angle brackets. The shared TypeScript
        // normaliser accepts both forms, which is what lets the two platforms
        // agree — see threading.test.ts.
        assert_eq!(
            first_message_id(&parsed, mail_parser::HeaderName::MessageId),
            Some("c@z.org".to_string())
        );
        assert_eq!(
            first_message_id(&parsed, mail_parser::HeaderName::InReplyTo),
            Some("b@y.org".to_string())
        );
        // Trap: `HeaderValue::as_text()` answers with the LAST entry of a list,
        // so reading References that way would keep exactly one id and lose the
        // chain. `as_text_list` keeps all of them, in order.
        assert_eq!(
            message_id_list(&parsed, mail_parser::HeaderName::References),
            Some("a@x.org b@y.org".to_string())
        );
    }

    #[test]
    fn thread_headers_are_absent_when_the_message_has_none() {
        // A conversation starter has no In-Reply-To and no References. Empty
        // strings here would later read as "has an id", and a row whose id is
        // empty would match every other row without one.
        let raw = "Subject: Angebot\r\nFrom: Ada <ada@example.com>\r\n\r\n";
        let parsed = mail_parser::MessageParser::default().parse(raw.as_bytes()).unwrap();
        assert_eq!(first_message_id(&parsed, mail_parser::HeaderName::MessageId), None);
        assert_eq!(first_message_id(&parsed, mail_parser::HeaderName::InReplyTo), None);
        assert_eq!(message_id_list(&parsed, mail_parser::HeaderName::References), None);
    }
}
