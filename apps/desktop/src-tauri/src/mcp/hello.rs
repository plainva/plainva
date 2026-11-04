//! The first exchange on an MCP connection (plan KI-Harness §17.3), shared by
//! the app and the `plainva-mcp` helper: one JSON line each way before any MCP
//! message. The helper says which client started it and shows the secret it
//! received at pairing; the app answers with ok, a fresh secret after a new
//! pairing, or a refusal. Deliberately small and dependency-free apart from
//! serde: the helper links this file directly (`#[path]`), not the app library.

use serde::{Deserialize, Serialize};

/// Version of the hello line; an app that does not know it refuses.
pub const HELLO_VERSION: u32 = 1;

/// Longest hello line either side accepts (a secret, two names, a path).
pub const HELLO_MAX_BYTES: usize = 8 * 1024;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Hello {
    pub v: u32,
    /// `clientInfo.name` from the client's `initialize`, cleaned (see `clean_label`).
    pub client: String,
    /// `clientInfo.version`, cleaned.
    pub version: String,
    /// The program that started the helper, as far as the helper could tell. Shown, never trusted.
    pub program: String,
    /// The secret this client received at pairing; absent on the first contact.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct HelloReply {
    pub ok: bool,
    /// A new secret, sent once after the user allowed a new client.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
    /// Why the app refused: "denied", "no-vault", "busy", "version", "invalid".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl HelloReply {
    pub fn refuse(reason: &str) -> Self {
        Self { ok: false, secret: None, reason: Some(reason.to_string()) }
    }
}

/// A label a client gave itself, fit to be shown and stored: printable, one
/// line, at most 64 characters; empty becomes "unknown".
pub fn clean_label(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let cut: String = cleaned.chars().take(64).collect();
    if cut.is_empty() {
        "unknown".to_string()
    } else {
        cut
    }
}

/// The endpoint's base name for an installation: one per app identifier, so
/// the release app, the dev build and a Labs build never answer for each other.
pub fn endpoint_name(identifier: &str) -> String {
    let id: String = identifier
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
        .collect();
    format!("plainva-mcp-{id}")
}

/// The identifier of the published desktop app: the helper's default target.
#[allow(dead_code)] // read by the helper, which links this file directly
pub const RELEASE_IDENTIFIER: &str = "com.plainva.desktop";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_one_printable_line_of_bounded_length() {
        assert_eq!(clean_label("Claude\u{0}  Code\n2"), "Claude Code 2");
        assert_eq!(clean_label("   "), "unknown");
        assert_eq!(clean_label(&"x".repeat(200)).chars().count(), 64);
    }

    #[test]
    fn each_installation_has_its_own_endpoint() {
        assert_eq!(endpoint_name("com.plainva.desktop"), "plainva-mcp-com.plainva.desktop");
        assert_ne!(endpoint_name("com.plainva.desktop.labs"), endpoint_name("com.plainva.desktop"));
        assert_eq!(endpoint_name("a/b\\c"), "plainva-mcp-a_b_c");
    }

    #[test]
    fn the_hello_round_trips_and_omits_an_absent_secret() {
        let hello = Hello { v: HELLO_VERSION, client: "c".into(), version: "1".into(), program: "p".into(), secret: None };
        let line = serde_json::to_string(&hello).unwrap();
        assert!(!line.contains("secret"));
        assert_eq!(serde_json::from_str::<Hello>(&line).unwrap(), hello);
        assert_eq!(serde_json::to_string(&HelloReply::refuse("denied")).unwrap(), r#"{"ok":false,"reason":"denied"}"#);
    }
}
