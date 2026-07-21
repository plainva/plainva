//! IMAP mail capture (PIM stage 5) + a few explicit mailbox actions (mail-
//! client E4).
//!
//! Design constraints:
//! - Reads are non-mutating: `EXAMINE` instead of `SELECT` and `BODY.PEEK[…]`
//!   fetches (never sets `\Seen`). Explicit write commands are the only paths
//!   that `SELECT` a mailbox. Normal deletion moves to Trash; permanent delete
//!   is a separate, confirmed frontend action scoped to the Trash folder.
//! - No credential state in Rust: every command receives host/port/user/pass
//!   from the frontend (which reads the OS keychain) and opens a fresh
//!   connection. Personal-mailbox scale; pooling/IDLE is a later optimization.
//! - Blocking `imap` client inside `spawn_blocking` (the async runtime and
//!   the UI stay free) — the same pattern as the OAuth loopback fix.
//! - TLS via rustls over a plain `TcpStream` (OpenSSL-free cross-platform).
//! - Parsing via `mail-parser` (RFC 2047 headers, multipart, attachments).

use base64::Engine as _;
use mail_parser::MimeHeaders as _;
use serde::Serialize;
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
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MailEnvelope {
    pub uid: u32,
    pub subject: String,
    pub from: String,
    /// Unix ms of the INTERNALDATE (arrival), 0 when unknown.
    pub date_ts: i64,
    pub seen: bool,
    pub flagged: bool,
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
}

/// A rustls stream over a plain TCP socket (the same OpenSSL-free stack the
/// SMTP client uses). The imap `Session` is generic over this concrete type.
type TlsStream = rustls::StreamOwned<rustls::ClientConnection, TcpStream>;
type ImapSession = imap::Session<TlsStream>;

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

fn open_session(host: &str, port: u16, user: &str, pass: &str) -> Result<ImapSession, String> {
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
        client
            .login(user, pass)
            .map_err(|(e, _)| format!("login failed: {e}"))
    } else {
        let tls = starttls_upgrade(host, tcp)?;
        // The greeting was consumed on the plain socket before STARTTLS, so we
        // go straight to LOGIN (login consumes the client).
        imap::Client::new(tls)
            .login(user, pass)
            .map_err(|(e, _)| format!("login failed: {e}"))
    }
}

fn header_text(msg: &mail_parser::Message, name: mail_parser::HeaderName) -> String {
    msg.header(name)
        .and_then(|h| h.as_text())
        .unwrap_or_default()
        .to_string()
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
pub async fn mail_check_login(host: String, port: u16, user: String, pass: String) -> Result<Vec<MailboxInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = open_session(&host, port, &user, &pass)?;
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
            })
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        let _ = session.logout();
        Ok(out)
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Builds an envelope from a FETCH row (UID FLAGS INTERNALDATE + the FROM/SUBJECT/DATE
/// header fields). Rows without a UID are skipped. Pure over the fetch row.
fn fetch_to_envelope(f: &imap::types::Fetch) -> Option<MailEnvelope> {
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
    Some(MailEnvelope { uid, subject, from, date_ts, seen, flagged })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_list_envelopes(
    host: String,
    port: u16,
    user: String,
    pass: String,
    mailbox: String,
    offset: u32,
    limit: u32,
    before_uid: Option<u32>,
) -> Result<MailEnvelopePage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = open_session(&host, port, &user, &pass)?;
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
            let _ = session.logout();
            return Ok(MailEnvelopePage { total, unseen, messages: Vec::new() });
        }
        let set = uids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        let fetches = session
            .uid_fetch(
                set,
                "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])",
            )
            .map_err(|e| format!("fetch failed: {e}"))?;
        let mut messages: Vec<MailEnvelope> = Vec::new();
        for f in fetches.iter() {
            if let Some(env) = fetch_to_envelope(f) {
                messages.push(env);
            }
        }
        messages.sort_by_key(|m| std::cmp::Reverse(m.uid));
        let _ = session.logout();
        Ok(MailEnvelopePage { total, unseen, messages })
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

#[tauri::command]
pub async fn mail_fetch_message(
    host: String,
    port: u16,
    user: String,
    pass: String,
    mailbox: String,
    uid: u32,
) -> Result<MailMessage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = open_session(&host, port, &user, &pass)?;
        let selected = session
            .examine(&mailbox)
            .map_err(|e| format!("examine failed: {e}"))?;
        let uid_validity = selected.uid_validity;
        let raw = fetch_raw(&mut session, uid)?;
        let _ = session.logout();
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
            text: parsed.body_text(0).map(|c| c.to_string()),
            html: parsed.body_html(0).map(|c| c.to_string()),
            attachments,
            uid_validity,
            provider_message_id: parsed.message_id().map(str::to_string),
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
    pass: String,
    mailbox: String,
    uid: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = open_session(&host, port, &user, &pass)?;
        session
            .examine(&mailbox)
            .map_err(|e| format!("examine failed: {e}"))?;
        let raw = fetch_raw(&mut session, uid)?;
        let _ = session.logout();
        Ok(base64::engine::general_purpose::STANDARD.encode(raw))
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

#[tauri::command]
pub async fn mail_fetch_attachment(
    host: String,
    port: u16,
    user: String,
    pass: String,
    mailbox: String,
    uid: u32,
    index: usize,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = open_session(&host, port, &user, &pass)?;
        session
            .examine(&mailbox)
            .map_err(|e| format!("examine failed: {e}"))?;
        let raw = fetch_raw(&mut session, uid)?;
        let _ = session.logout();
        let parsed = parse_message(&raw)?;
        let part = parsed
            .attachments()
            .nth(index)
            .ok_or_else(|| "attachment not found".to_string())?;
        Ok(base64::engine::general_purpose::STANDARD.encode(part.contents()))
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Builds the draft MIME (multipart/alternative when HTML is present;
/// RFC 2047 header encoding via mail-builder). Extracted for the roundtrip
/// unit test below.
fn build_draft_mime(to: &str, cc: &str, bcc: &str, subject: &str, text: &str, html: Option<&str>, attachments: &[crate::mail_smtp::MailAttachment]) -> Result<Vec<u8>, String> {
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
    pass: String,
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
        let mut session = open_session(&host, port, &user, &pass)?;
        session
            .append_with_flags(escape_imap_string(&mailbox), &mime, &[imap::types::Flag::Draft])
            .map_err(|e| format!("append failed: {e}"))?;
        let _ = session.logout();
        Ok(())
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

// ---- Mailbox actions (mail-client E4) -------------------------------------

/// Opens a session and SELECTs the mailbox writable (for flag/move commands).
fn open_writable(host: &str, port: u16, user: &str, pass: &str, mailbox: &str) -> Result<ImapSession, String> {
    let mut session = open_session(host, port, user, pass)?;
    session.select(mailbox).map_err(|e| format!("select failed: {e}"))?;
    Ok(session)
}

/// IMAP quoted-string escape for a free-text SEARCH term (backslash + quote). Pure.
fn escape_imap_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Builds the SEARCH argument for a free-text query. A non-ASCII query gets a
/// `CHARSET UTF-8` prefix so servers know the quoted bytes are UTF-8 (RFC 3501
/// forbids raw 8-bit in a quoted string without it — strict servers answer
/// `BAD [BADCHARSET]` otherwise). ASCII queries stay bare for maximum
/// compatibility. Pure.
fn build_search_arg(query: &str) -> String {
    let body = format!("TEXT \"{}\"", escape_imap_string(query));
    if query.is_ascii() {
        body
    } else {
        format!("CHARSET UTF-8 {body}")
    }
}

/// Sets or clears the `\Seen` flag on a message.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_set_seen(host: String, port: u16, user: String, pass: String, mailbox: String, uid: u32, seen: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = open_writable(&host, port, &user, &pass, &mailbox)?;
        let op = if seen { "+FLAGS (\\Seen)" } else { "-FLAGS (\\Seen)" };
        session.uid_store(uid.to_string(), op).map_err(|e| format!("store failed: {e}"))?;
        let _ = session.logout();
        Ok(())
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Sets or clears the RFC 3501 `\Flagged` marker on a message.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_set_flagged(host: String, port: u16, user: String, pass: String, mailbox: String, uid: u32, flagged: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = open_writable(&host, port, &user, &pass, &mailbox)?;
        let op = if flagged { "+FLAGS (\\Flagged)" } else { "-FLAGS (\\Flagged)" };
        session.uid_store(uid.to_string(), op).map_err(|e| format!("store failed: {e}"))?;
        let _ = session.logout();
        Ok(())
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Permanently removes exactly one message. With UIDPLUS the server can expunge
/// the UID directly. On older servers we temporarily unmark OTHER deleted
/// messages, run EXPUNGE, then restore those flags so unrelated mail is safe.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_delete_message(host: String, port: u16, user: String, pass: String, mailbox: String, uid: u32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = open_writable(&host, port, &user, &pass, &mailbox)?;
        let uid_s = uid.to_string();
        let has_uidplus = session.capabilities().map(|c| c.has_str("UIDPLUS")).unwrap_or(false);
        if has_uidplus {
            session.uid_store(&uid_s, "+FLAGS (\\Deleted)").map_err(|e| format!("delete flag failed: {e}"))?;
            session.uid_expunge(&uid_s).map_err(|e| format!("uid expunge failed: {e}"))?;
        } else {
            let other_deleted: Vec<u32> = session
                .uid_search("DELETED")
                .map_err(|e| format!("deleted search failed: {e}"))?
                .into_iter()
                .filter(|other| *other != uid)
                .collect();
            let other_set = other_deleted.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
            if !other_set.is_empty() {
                session.uid_store(&other_set, "-FLAGS (\\Deleted)").map_err(|e| format!("protect deleted messages failed: {e}"))?;
            }
            let result = (|| -> Result<(), String> {
                session.uid_store(&uid_s, "+FLAGS (\\Deleted)").map_err(|e| format!("delete flag failed: {e}"))?;
                session.expunge().map_err(|e| format!("expunge failed: {e}"))?;
                Ok(())
            })();
            if !other_set.is_empty() {
                let _ = session.uid_store(&other_set, "+FLAGS (\\Deleted)");
            }
            result?;
        }
        let _ = session.logout();
        Ok(())
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Moves a message to another mailbox (used for both "move" and "delete to
/// Trash"). Uses the MOVE extension; deletion stays reversible.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_move_message(host: String, port: u16, user: String, pass: String, mailbox: String, uid: u32, target: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = open_writable(&host, port, &user, &pass, &mailbox)?;
        session.uid_mv(uid.to_string(), &target).map_err(|e| format!("move failed: {e}"))?;
        let _ = session.logout();
        Ok(())
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Full-text SEARCH in a mailbox (read-only EXAMINE); returns matching UIDs,
/// newest first.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_search(host: String, port: u16, user: String, pass: String, mailbox: String, query: String) -> Result<Vec<u32>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = open_session(&host, port, &user, &pass)?;
        session.examine(&mailbox).map_err(|e| format!("examine failed: {e}"))?;
        let search = build_search_arg(&query);
        let uids = session.uid_search(&search).map_err(|e| format!("search failed: {e}"))?;
        let _ = session.logout();
        let mut v: Vec<u32> = uids.into_iter().collect();
        v.sort_unstable_by(|a, b| b.cmp(a));
        Ok(v)
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
    pass: String,
    mailbox: String,
    query: String,
    limit: u32,
) -> Result<Vec<MailEnvelope>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = open_session(&host, port, &user, &pass)?;
        session.examine(&mailbox).map_err(|e| format!("examine failed: {e}"))?;
        let search = build_search_arg(&query);
        let uids = session.uid_search(&search).map_err(|e| format!("search failed: {e}"))?;
        let mut ordered: Vec<u32> = uids.into_iter().collect();
        ordered.sort_unstable_by(|a, b| b.cmp(a)); // highest UID = newest first
        let cap = limit.min(500) as usize;
        ordered.truncate(cap.max(1));
        if ordered.is_empty() {
            let _ = session.logout();
            return Ok(Vec::new());
        }
        let set = ordered.iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
        let fetches = session
            .uid_fetch(set, "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
            .map_err(|e| format!("fetch failed: {e}"))?;
        let mut messages: Vec<MailEnvelope> = fetches.iter().filter_map(fetch_to_envelope).collect();
        // The server may return the set in any order; sort newest first by date.
        messages.sort_by_key(|m| std::cmp::Reverse(m.date_ts));
        let _ = session.logout();
        Ok(messages)
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
    pass: String,
    mailbox: String,
    limit: u32,
) -> Result<Vec<MailEnvelope>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = open_session(&host, port, &user, &pass)?;
        session.examine(&mailbox).map_err(|e| format!("examine failed: {e}"))?;
        let mut ordered: Vec<u32> = session.uid_search("FLAGGED").map_err(|e| format!("search flagged failed: {e}"))?.into_iter().collect();
        ordered.sort_unstable_by(|a, b| b.cmp(a));
        ordered.truncate(limit.clamp(1, 500) as usize);
        if ordered.is_empty() {
            let _ = session.logout();
            return Ok(Vec::new());
        }
        let set = ordered.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        let fetches = session
            .uid_fetch(set, "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
            .map_err(|e| format!("fetch failed: {e}"))?;
        let mut messages: Vec<MailEnvelope> = fetches.iter().filter_map(fetch_to_envelope).collect();
        messages.sort_by_key(|m| std::cmp::Reverse(m.date_ts));
        let _ = session.logout();
        Ok(messages)
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_imap_search_strings() {
        assert_eq!(escape_imap_string("hello"), "hello");
        assert_eq!(escape_imap_string("a\"b"), "a\\\"b");
        assert_eq!(escape_imap_string("a\\b"), "a\\\\b");
        assert_eq!(escape_imap_string("Drafts \\\"Team\\\""), "Drafts \\\\\\\"Team\\\\\\\"");
    }

    #[test]
    fn search_arg_declares_utf8_only_for_non_ascii() {
        assert_eq!(build_search_arg("invoice"), "TEXT \"invoice\"");
        // A non-ASCII query gets the CHARSET prefix so strict servers accept it.
        assert_eq!(build_search_arg("Grüße"), "CHARSET UTF-8 TEXT \"Grüße\"");
        assert_eq!(build_search_arg("日本語"), "CHARSET UTF-8 TEXT \"日本語\"");
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
}
