//! ManageSieve (RFC 5804) — the desktop's path to a server-side filter (S13).
//!
//! Same rustls-on-TcpStream stack as `mail_imap` and `mail_smtp`, and the same
//! two rules that shape the TypeScript twin the phone uses (`net/sieve.ts`):
//!
//! 1. **STARTTLS is not optional.** The password crosses this socket, and the
//!    default port 4190 starts in the clear. A server offering no STARTTLS is
//!    refused rather than spoken to.
//! 2. **Answers carry literals.** A script arrives as `{123+}` followed by
//!    exactly that many bytes. Reading it line by line works right up until
//!    someone's hand-written rule contains a blank line — and then it silently
//!    truncates a filter the user relies on.
//!
//! What gets WRITTEN into the script is not decided here. That lives once, in
//! the shared core (`sieveScript.ts`), so a rule written on the phone and one
//! written on the desktop are the same rule.

use base64::Engine as _;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

enum SieveStream {
    Plain(TcpStream),
    Tls(Box<rustls::StreamOwned<rustls::ClientConnection, TcpStream>>),
}

impl Read for SieveStream {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self {
            SieveStream::Plain(s) => s.read(buf),
            SieveStream::Tls(s) => s.read(buf),
        }
    }
}

impl Write for SieveStream {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match self {
            SieveStream::Plain(s) => s.write(buf),
            SieveStream::Tls(s) => s.write(buf),
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            SieveStream::Plain(s) => s.flush(),
            SieveStream::Tls(s) => s.flush(),
        }
    }
}

/// A parsed reply: the payload lines (literals already resolved) and the final
/// status line.
pub struct SieveReply {
    pub ok: bool,
    pub lines: Vec<String>,
    pub status: String,
}

/// The byte count of a trailing `{n}` / `{n+}` literal marker, if any. Pure.
pub fn literal_len(line: &str) -> Option<usize> {
    let trimmed = line.trim_end();
    let open = trimmed.rfind('{')?;
    if !trimmed.ends_with('}') {
        return None;
    }
    let inner = &trimmed[open + 1..trimmed.len() - 1];
    let digits = inner.strip_suffix('+').unwrap_or(inner);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// Whether a line ends the reply (RFC 5804: OK, NO or BYE). Pure.
pub fn is_status_line(line: &str) -> bool {
    let upper = line.trim_start().to_ascii_uppercase();
    upper.starts_with("OK") || upper.starts_with("NO") || upper.starts_with("BYE")
}

/// Quotes a ManageSieve string argument (only `\` and `"` are special). Pure.
pub fn quote(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

/// The name of the ACTIVE script from a LISTSCRIPTS reply, if there is one.
/// Only the active script actually runs — writing into another one looks like
/// it worked and filters nothing. Pure.
pub fn active_script(lines: &[String]) -> Option<String> {
    lines.iter().find_map(|line| {
        if !line.to_ascii_uppercase().contains("ACTIVE") {
            return None;
        }
        let start = line.find('"')? + 1;
        let end = line[start..].find('"')? + start;
        Some(line[start..end].replace("\\\"", "\"").replace("\\\\", "\\"))
    })
}

fn read_reply<R: BufRead>(reader: &mut R) -> Result<SieveReply, String> {
    let mut lines = Vec::new();
    loop {
        let mut line = String::new();
        let n = reader
            .read_line(&mut line)
            .map_err(|e| format!("sieve read failed: {e}"))?;
        if n == 0 {
            return Err("sieve connection closed by the server".into());
        }
        let trimmed = line.trim_end_matches(['\r', '\n']).to_string();
        if let Some(len) = literal_len(&trimmed) {
            let mut buf = vec![0u8; len];
            reader
                .read_exact(&mut buf)
                .map_err(|e| format!("sieve literal read failed: {e}"))?;
            // The rest of that line belongs to the SAME entry; treating it as a
            // line of its own appends a phantom newline to every script.
            let mut rest = String::new();
            reader
                .read_line(&mut rest)
                .map_err(|e| format!("sieve read failed: {e}"))?;
            let text = String::from_utf8_lossy(&buf).to_string();
            lines.push(text + rest.trim_end_matches(['\r', '\n']));
            continue;
        }
        if is_status_line(&trimmed) {
            return Ok(SieveReply {
                ok: trimmed.trim_start().to_ascii_uppercase().starts_with("OK"),
                lines,
                status: trimmed,
            });
        }
        lines.push(trimmed);
    }
}

struct Session {
    reader: BufReader<SieveStream>,
}

impl Session {
    fn send(&mut self, command: &str, what: &str) -> Result<SieveReply, String> {
        self.reader
            .get_mut()
            .write_all(format!("{command}\r\n").as_bytes())
            .map_err(|e| format!("sieve write failed: {e}"))?;
        self.reader
            .get_mut()
            .flush()
            .map_err(|e| format!("sieve flush failed: {e}"))?;
        let reply = read_reply(&mut self.reader)?;
        if !reply.ok {
            return Err(format!("{what}: {}", reply.status));
        }
        Ok(reply)
    }
}

fn connect(host: &str, port: u16, user: &str, pass: &str) -> Result<Session, String> {
    let tcp = TcpStream::connect((host, port)).map_err(|e| format!("sieve connect failed: {e}"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(30))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(30))).ok();

    let mut plain = BufReader::new(SieveStream::Plain(tcp));
    let greeting = read_reply(&mut plain)?;
    if !greeting
        .lines
        .iter()
        .any(|l| l.to_ascii_uppercase().contains("STARTTLS"))
    {
        return Err("this server offers no STARTTLS for ManageSieve".into());
    }

    plain
        .get_mut()
        .write_all(b"STARTTLS\r\n")
        .map_err(|e| format!("sieve write failed: {e}"))?;
    let tls_ok = read_reply(&mut plain)?;
    if !tls_ok.ok {
        return Err(format!("starttls: {}", tls_ok.status));
    }

    let tcp = match plain.into_inner() {
        SieveStream::Plain(s) => s,
        SieveStream::Tls(_) => return Err("sieve stream already encrypted".into()),
    };
    let server_name = rustls::pki_types::ServerName::try_from(host.to_string())
        .map_err(|e| format!("invalid server name: {e}"))?;
    let conn = rustls::ClientConnection::new(Arc::new(crate::mail_imap::tls_config_for(host)), server_name)
        .map_err(|e| format!("tls setup failed: {e}"))?;
    let mut session = Session {
        reader: BufReader::new(SieveStream::Tls(Box::new(rustls::StreamOwned::new(conn, tcp)))),
    };
    // Capabilities are announced again over the encrypted channel — a server
    // may only offer its SASL mechanisms once it can be trusted with the answer.
    read_reply(&mut session.reader)?;

    let sasl = format!("\0{user}\0{pass}");
    let encoded = base64::engine::general_purpose::STANDARD.encode(sasl.as_bytes());
    session.send(&format!("AUTHENTICATE \"PLAIN\" {}", quote(&encoded)), "authenticate")?;
    Ok(session)
}

/// Reads the active script (or a named one). Returns the script body and the
/// name it was read from, so the caller writes back into the SAME script.
#[tauri::command]
pub async fn mail_sieve_get(host: String, port: u16, user: String, pass: String) -> Result<(String, String), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = connect(&host, port, &user, &pass)?;
        let list = session.send("LISTSCRIPTS", "listscripts")?;
        let name = active_script(&list.lines).unwrap_or_else(|| "plainva".to_string());
        // A script that does not exist yet is not an error — it is an empty one.
        let body = match session.send(&format!("GETSCRIPT {}", quote(&name)), "getscript") {
            Ok(reply) => reply.lines.join("\n"),
            Err(_) => String::new(),
        };
        let _ = session.send("LOGOUT", "logout");
        Ok((name, body))
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

/// Uploads a script and makes it the active one. The body goes as a literal:
/// its own newlines would otherwise end the command mid-rule.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mail_sieve_put(
    host: String,
    port: u16,
    user: String,
    pass: String,
    name: String,
    body: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = connect(&host, port, &user, &pass)?;
        let command = format!("PUTSCRIPT {} {{{}+}}\r\n{}", quote(&name), body.len(), body);
        session.send(&command, "putscript")?;
        session.send(&format!("SETACTIVE {}", quote(&name)), "setactive")?;
        let _ = session.send("LOGOUT", "logout");
        Ok(())
    })
    .await
    .map_err(|e| format!("task join failed: {e}"))?
}

#[cfg(test)]
mod tests {
    //! The socket exchange is verified natively; what is pinned here is the
    //! parsing, because that is where a hand-written filter gets truncated.
    use super::*;

    #[test]
    fn a_literal_marker_is_recognized_in_both_forms() {
        assert_eq!(literal_len("{42}"), Some(42));
        assert_eq!(literal_len("{42+}"), Some(42));
        assert_eq!(literal_len("OK \"done\""), None);
        // A brace inside a rule is not a length.
        assert_eq!(literal_len("if true { keep; }"), None);
    }

    #[test]
    fn status_lines_end_a_reply() {
        assert!(is_status_line("OK \"done\""));
        assert!(is_status_line("NO \"nope\""));
        assert!(is_status_line("BYE"));
        assert!(!is_status_line("\"plainva\" ACTIVE"));
    }

    #[test]
    fn the_active_script_is_the_one_that_runs() {
        let lines = vec!["\"plainva\"".to_string(), "\"work\" ACTIVE".to_string()];
        assert_eq!(active_script(&lines).as_deref(), Some("work"));
        assert_eq!(active_script(&["\"plainva\"".to_string()]), None);
    }

    #[test]
    fn a_reply_keeps_a_scripts_own_blank_lines() {
        // The case line-by-line reading gets wrong: the blank line inside a
        // hand-written rule is part of the script, not a reply boundary.
        let body = "require [\"fileinto\"];\n\nif true {\n  keep;\n}";
        let wire = format!("{{{}}}\r\n{}\r\nOK \"done\"\r\n", body.len(), body);
        let mut reader = BufReader::new(wire.as_bytes());
        let reply = read_reply(&mut reader).unwrap();
        assert!(reply.ok);
        assert_eq!(reply.lines.join("\n"), body);
    }

    #[test]
    fn quoting_escapes_what_the_protocol_reserves() {
        assert_eq!(quote("a\"b\\c"), "\"a\\\"b\\\\c\"");
    }
}
