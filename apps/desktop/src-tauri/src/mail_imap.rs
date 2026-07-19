//! IMAP mail capture (PIM stage 5) + a few explicit mailbox actions (mail-
//! client E4).
//!
//! Design constraints:
//! - Reads are non-mutating: `EXAMINE` instead of `SELECT` and `BODY.PEEK[…]`
//!   fetches (never sets `\Seen`). The write commands (mail_set_seen,
//!   mail_move_message, mail_search) are the ONLY ones that `SELECT` the
//!   mailbox; deletion is a MOVE to Trash (reversible), never a hard expunge.
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
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

#[derive(Serialize, Clone)]
pub struct MailboxInfo {
    pub name: String,
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
}

type TlsStream = rustls::StreamOwned<rustls::ClientConnection, TcpStream>;
type ImapSession = imap::Session<TlsStream>;

fn open_session(host: &str, port: u16, user: &str, pass: &str) -> Result<ImapSession, String> {
    let roots = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    let config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let server_name = rustls::pki_types::ServerName::try_from(host.to_string())
        .map_err(|e| format!("invalid server name: {e}"))?;
    let conn = rustls::ClientConnection::new(Arc::new(config), server_name)
        .map_err(|e| format!("tls setup failed: {e}"))?;
    let tcp = TcpStream::connect((host, port)).map_err(|e| format!("connect failed: {e}"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(60)))
        .map_err(|e| format!("socket setup failed: {e}"))?;
    tcp.set_write_timeout(Some(Duration::from_secs(60)))
        .map_err(|e| format!("socket setup failed: {e}"))?;
    let tls = rustls::StreamOwned::new(conn, tcp);
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
            .map(|n| MailboxInfo { name: n.name().to_string() })
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        let _ = session.logout();
        Ok(out)
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

#[tauri::command]
pub async fn mail_list_envelopes(
    host: String,
    port: u16,
    user: String,
    pass: String,
    mailbox: String,
    offset: u32,
    limit: u32,
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
        // Newest first: sequence numbers count from 1 = oldest.
        let hi = total.saturating_sub(offset);
        if total == 0 || hi == 0 {
            let _ = session.logout();
            return Ok(MailEnvelopePage { total, unseen, messages: Vec::new() });
        }
        let lo = hi.saturating_sub(limit.saturating_sub(1)).max(1);
        let fetches = session
            .fetch(
                format!("{lo}:{hi}"),
                "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])",
            )
            .map_err(|e| format!("fetch failed: {e}"))?;
        let mut messages: Vec<MailEnvelope> = Vec::new();
        for f in fetches.iter() {
            let Some(uid) = f.uid else { continue };
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
            messages.push(MailEnvelope { uid, subject, from, date_ts, seen });
        }
        // fetch returns ascending sequence order — newest first for the UI.
        messages.reverse();
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
        session
            .examine(&mailbox)
            .map_err(|e| format!("examine failed: {e}"))?;
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
/// APPEND with the \Draft flag — the user's regular mail program opens and
/// SENDS it. Plainva deliberately never speaks SMTP (no sender reputation,
/// no deliverability surface); this is the whole point of the design.
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
            .append_with_flags(&mailbox, &mime, &[imap::types::Flag::Draft])
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
        let search = format!("TEXT \"{}\"", escape_imap_string(&query));
        let uids = session.uid_search(&search).map_err(|e| format!("search failed: {e}"))?;
        let _ = session.logout();
        let mut v: Vec<u32> = uids.into_iter().collect();
        v.sort_unstable_by(|a, b| b.cmp(a));
        Ok(v)
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
