//! SMTP submission (mail-client E3): a small, hand-rolled SMTP client over the
//! SAME rustls-on-TcpStream stack as `mail_imap` (OpenSSL-free, no extra async
//! dependency). Supports STARTTLS (port 587) and implicit TLS (port 465),
//! AUTH LOGIN, and a text+html MIME built with mail-builder. Runs inside
//! spawn_blocking. Plainva speaks SMTP only to SUBMIT the user's own outgoing
//! mail through their provider — no relaying, no listener.
//!
//! The protocol helpers (reply parsing, DATA dot-stuffing, MIME building) are
//! pure and unit-tested; the live socket exchange is verified natively.

use base64::Engine as _;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

/// Either a plain TCP stream (before STARTTLS) or a rustls stream after it.
enum SmtpStream {
    Plain(TcpStream),
    Tls(Box<rustls::StreamOwned<rustls::ClientConnection, TcpStream>>),
}

impl Read for SmtpStream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            SmtpStream::Plain(s) => s.read(buf),
            SmtpStream::Tls(s) => s.read(buf),
        }
    }
}

impl Write for SmtpStream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            SmtpStream::Plain(s) => s.write(buf),
            SmtpStream::Tls(s) => s.write(buf),
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            SmtpStream::Plain(s) => s.flush(),
            SmtpStream::Tls(s) => s.flush(),
        }
    }
}

fn tls_config() -> rustls::ClientConfig {
    let roots = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth()
}

/// Parses the leading 3-digit status code of an SMTP reply line. Pure.
fn reply_code(line: &str) -> Option<u16> {
    line.get(0..3).and_then(|c| c.parse::<u16>().ok())
}

/// True when this reply line is the LAST of a (possibly multi-line) reply:
/// the 4th char is a space, not a hyphen ("250-foo" continues, "250 foo" ends).
fn is_final_reply_line(line: &str) -> bool {
    line.as_bytes().get(3).map(|b| *b == b' ').unwrap_or(true)
}

/// DATA payload dot-stuffing (RFC 5321 §4.5.2): a line starting with '.' gets
/// an extra leading '.', so the message body can never contain the "\r\n.\r\n"
/// terminator by accident. Input uses CRLF line endings. Pure.
fn dot_stuff(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len());
    let mut at_line_start = true;
    for &b in body {
        if at_line_start && b == b'.' {
            out.push(b'.');
        }
        out.push(b);
        at_line_start = b == b'\n';
    }
    out
}

/// Comma-separated recipient list -> trimmed, non-empty addresses. Pure.
fn split_recipients(to: &str) -> Vec<String> {
    to.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// An outgoing attachment (mail-client E5): base64 content decoded in Rust.
#[derive(serde::Deserialize)]
pub struct MailAttachment {
    pub name: String,
    pub mime: String,
    #[serde(rename = "contentBase64")]
    pub content_base64: String,
}

/// Adds the decoded attachments to a mail-builder message. Shared by send +
/// draft (E5/E6).
pub fn attach_all<'a>(
    mut builder: mail_builder::MessageBuilder<'a>,
    attachments: &'a [MailAttachment],
) -> Result<mail_builder::MessageBuilder<'a>, String> {
    for a in attachments {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(a.content_base64.trim())
            .map_err(|e| format!("attachment decode failed: {e}"))?;
        builder = builder.attachment(a.mime.clone(), a.name.clone(), bytes);
    }
    Ok(builder)
}

/// Builds the outgoing message MIME (From + To + text[/html] + attachments). Pure.
fn build_send_mime(from: &str, to: &str, subject: &str, text: &str, html: Option<&str>, attachments: &[MailAttachment]) -> Result<Vec<u8>, String> {
    let mut builder = mail_builder::MessageBuilder::new()
        .from(from.to_string())
        .to(to.to_string())
        .subject(subject.to_string())
        .text_body(text.to_string());
    if let Some(html) = html {
        builder = builder.html_body(html.to_string());
    }
    builder = attach_all(builder, attachments)?;
    builder
        .write_to_vec()
        .map_err(|e| format!("mime build failed: {e}"))
}

fn read_reply(stream: &mut SmtpStream) -> Result<(u16, String), String> {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    let mut lines = String::new();
    loop {
        // Read a single CRLF-terminated line.
        buf.clear();
        loop {
            let n = stream.read(&mut byte).map_err(|e| format!("smtp read failed: {e}"))?;
            if n == 0 {
                return Err("smtp connection closed".into());
            }
            if byte[0] == b'\n' {
                break;
            }
            if byte[0] != b'\r' {
                buf.push(byte[0]);
            }
        }
        let line = String::from_utf8_lossy(&buf).to_string();
        let code = reply_code(&line).ok_or_else(|| format!("bad smtp reply: {line}"))?;
        lines.push_str(&line);
        lines.push('\n');
        if is_final_reply_line(&line) {
            return Ok((code, lines));
        }
    }
}

fn cmd(stream: &mut SmtpStream, line: &str, expect: u16) -> Result<String, String> {
    stream
        .write_all(format!("{line}\r\n").as_bytes())
        .map_err(|e| format!("smtp write failed: {e}"))?;
    stream.flush().map_err(|e| format!("smtp flush failed: {e}"))?;
    let (code, text) = read_reply(stream)?;
    if code != expect && !(expect == 250 && (code == 250 || code == 251)) {
        return Err(format!("smtp error ({code}): {}", text.trim()));
    }
    Ok(text)
}

fn wrap_tls(tcp: TcpStream, host: &str) -> Result<SmtpStream, String> {
    let server_name = rustls::pki_types::ServerName::try_from(host.to_string())
        .map_err(|e| format!("invalid server name: {e}"))?;
    let conn = rustls::ClientConnection::new(Arc::new(tls_config()), server_name)
        .map_err(|e| format!("tls setup failed: {e}"))?;
    Ok(SmtpStream::Tls(Box::new(rustls::StreamOwned::new(conn, tcp))))
}

/// Submits one outgoing message. `from` is the envelope sender + From header,
/// `to` a comma-separated recipient list. STARTTLS on 587, implicit TLS on 465.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_send(
    host: String,
    port: u16,
    user: String,
    pass: String,
    from: String,
    to: String,
    subject: String,
    text: String,
    html: Option<String>,
    attachments: Option<Vec<MailAttachment>>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let recipients = split_recipients(&to);
        if recipients.is_empty() {
            return Err("no recipient".into());
        }
        let mime = build_send_mime(&from, &to, &subject, &text, html.as_deref(), attachments.as_deref().unwrap_or(&[]))?;

        let tcp = TcpStream::connect((host.as_str(), port)).map_err(|e| format!("connect failed: {e}"))?;
        tcp.set_read_timeout(Some(Duration::from_secs(60))).map_err(|e| format!("socket setup failed: {e}"))?;
        tcp.set_write_timeout(Some(Duration::from_secs(60))).map_err(|e| format!("socket setup failed: {e}"))?;

        let mut stream = if port == 465 {
            // Implicit TLS: greeting arrives already encrypted.
            wrap_tls(tcp, &host)?
        } else {
            SmtpStream::Plain(tcp)
        };

        // Greeting.
        let (code, text) = read_reply(&mut stream)?;
        if code != 220 {
            return Err(format!("smtp greeting error ({code}): {}", text.trim()));
        }

        cmd(&mut stream, &format!("EHLO {}", client_ident()), 250)?;

        // STARTTLS upgrade for the submission port.
        if let SmtpStream::Plain(_) = stream {
            cmd(&mut stream, "STARTTLS", 220)?;
            let tcp = match stream {
                SmtpStream::Plain(t) => t,
                SmtpStream::Tls(_) => unreachable!(),
            };
            stream = wrap_tls(tcp, &host)?;
            cmd(&mut stream, &format!("EHLO {}", client_ident()), 250)?;
        }

        // AUTH LOGIN (base64 username, then base64 password).
        cmd(&mut stream, "AUTH LOGIN", 334)?;
        cmd(&mut stream, &base64::engine::general_purpose::STANDARD.encode(user.as_bytes()), 334)?;
        cmd(&mut stream, &base64::engine::general_purpose::STANDARD.encode(pass.as_bytes()), 235)?;

        cmd(&mut stream, &format!("MAIL FROM:<{}>", envelope_addr(&from)), 250)?;
        for rcpt in &recipients {
            cmd(&mut stream, &format!("RCPT TO:<{}>", envelope_addr(rcpt)), 250)?;
        }
        cmd(&mut stream, "DATA", 354)?;
        let mut payload = dot_stuff(&mime);
        payload.extend_from_slice(b"\r\n.\r\n");
        stream.write_all(&payload).map_err(|e| format!("smtp data write failed: {e}"))?;
        stream.flush().map_err(|e| format!("smtp flush failed: {e}"))?;
        let (code, text) = read_reply(&mut stream)?;
        if code != 250 {
            return Err(format!("smtp send rejected ({code}): {}", text.trim()));
        }
        let _ = cmd(&mut stream, "QUIT", 221);
        Ok(())
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

fn client_ident() -> &'static str {
    "plainva.local"
}

/// Extracts the bare address from a "Name <addr>" string for the SMTP envelope. Pure.
fn envelope_addr(addr: &str) -> String {
    if let (Some(lt), Some(gt)) = (addr.rfind('<'), addr.rfind('>')) {
        if lt < gt {
            return addr[lt + 1..gt].trim().to_string();
        }
    }
    addr.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_reply_codes_and_continuation() {
        assert_eq!(reply_code("250 OK"), Some(250));
        assert_eq!(reply_code("235 2.7.0 Accepted"), Some(235));
        assert_eq!(reply_code("xyz"), None);
        assert!(is_final_reply_line("250 OK"));
        assert!(!is_final_reply_line("250-PIPELINING"));
        assert!(is_final_reply_line("50")); // short line = final (defensive)
    }

    #[test]
    fn dot_stuffs_leading_dots_only() {
        assert_eq!(dot_stuff(b"a\r\n.b\r\nc"), b"a\r\n..b\r\nc".to_vec());
        assert_eq!(dot_stuff(b".\r\n"), b"..\r\n".to_vec());
        assert_eq!(dot_stuff(b"no dots here"), b"no dots here".to_vec());
        // A dot mid-line is untouched.
        assert_eq!(dot_stuff(b"a.b\r\n"), b"a.b\r\n".to_vec());
    }

    #[test]
    fn splits_and_normalizes_recipients() {
        assert_eq!(split_recipients("a@x.org, b@y.org"), vec!["a@x.org", "b@y.org"]);
        assert_eq!(split_recipients(" one@x.org ,, "), vec!["one@x.org"]);
        assert!(split_recipients("").is_empty());
    }

    #[test]
    fn envelope_strips_display_name() {
        assert_eq!(envelope_addr("Anna <anna@example.org>"), "anna@example.org");
        assert_eq!(envelope_addr("plain@example.org"), "plain@example.org");
        assert_eq!(envelope_addr("  spaced@example.org "), "spaced@example.org");
    }

    #[test]
    fn builds_a_from_to_text_html_mime() {
        let mime = build_send_mime("me@example.org", "you@example.org", "Grüße", "Hallo", Some("<p>Hallo</p>"), &[]).expect("builds");
        let s = String::from_utf8_lossy(&mime);
        assert!(s.contains("me@example.org"));
        assert!(s.contains("you@example.org"));
        // Subject is RFC 2047 encoded for the non-ASCII "Grüße".
        assert!(s.to_lowercase().contains("subject:"));
        assert!(mime.windows(2).any(|w| w == b"\r\n"));
    }

    #[test]
    fn attaches_a_decoded_file() {
        // "hello" base64 = aGVsbG8=
        let att = MailAttachment { name: "note.md".into(), mime: "text/markdown".into(), content_base64: "aGVsbG8=".into() };
        let mime = build_send_mime("me@example.org", "you@example.org", "S", "body", None, std::slice::from_ref(&att)).expect("builds");
        let s = String::from_utf8_lossy(&mime);
        assert!(s.contains("note.md"));
        assert!(s.to_lowercase().contains("multipart/"));
    }
}
