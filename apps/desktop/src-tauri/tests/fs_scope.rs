//! The filesystem capability scope, checked the way tauri-plugin-fs checks it.
//!
//! Issue #70: an Obsidian vault holding `.attachments/.gitkeep` was rejected on
//! Linux and macOS. The plugin matches every resolved path against the
//! capability patterns with the `glob` crate, and `require_literal_leading_dot`
//! defaults to `cfg!(unix)` — with it on, `*` and `**` never match a segment
//! starting with a dot, so no pattern covers two dot-segments in a row. The
//! patterns in capabilities/default.json already carry four dot-variants from an
//! earlier attempt at this; they do not close it either, because the trailing
//! `**` still has to match `.gitkeep`.
//!
//! Those four are kept rather than pruned. Measured, they are redundant only
//! WHILE the flag is off: with it on, `**/.*/**` is the only thing that reaches
//! a single-level dot folder like `.obsidian/config`. They are the fallback if
//! the flag is ever lost, and narrowing the scope belongs to the trusted-roots
//! work, not here.
//!
//! These tests read the REAL patterns and the REAL flag, so a later change to
//! either — the narrowed scope planned for trusted roots, say — has to keep the
//! coverage or fail here. A test that pinned the config value could not see that.

use std::path::Path;

const CAPABILITIES: &str = include_str!("../capabilities/default.json");
const TAURI_CONF: &str = include_str!("../tauri.conf.json");

/// Every `path` allowed by an `fs:` permission in the owner capability.
fn fs_scope_patterns() -> Vec<String> {
    let caps: serde_json::Value = serde_json::from_str(CAPABILITIES).expect("capabilities json");
    let mut out = Vec::new();
    for perm in caps["permissions"].as_array().expect("permissions array") {
        let Some(id) = perm.get("identifier").and_then(|v| v.as_str()) else { continue };
        if !id.starts_with("fs:") {
            continue;
        }
        for allow in perm["allow"].as_array().into_iter().flatten() {
            if let Some(p) = allow.get("path").and_then(|v| v.as_str()) {
                if !out.iter().any(|e: &String| e == p) {
                    out.push(p.to_string());
                }
            }
        }
    }
    assert!(!out.is_empty(), "no fs: allow patterns found");
    out
}

/// The effective flag: our config value, or the plugin's platform default.
fn require_literal_leading_dot() -> bool {
    let conf: serde_json::Value = serde_json::from_str(TAURI_CONF).expect("tauri conf json");
    conf["plugins"]["fs"]["requireLiteralLeadingDot"]
        .as_bool()
        .unwrap_or(cfg!(unix))
}

/// Mirrors tauri-plugin-fs commands.rs: `require_literal_separator` is pinned on
/// (GHSA-6mv3-wm7j-h4w5, so `/dir/*` cannot reach into subdirectories) and the
/// leading-dot flag comes from the config.
fn is_allowed(path: &str, leading_dot: bool) -> bool {
    let path = Path::new(path);
    fs_scope_patterns().iter().any(|p| {
        glob::Pattern::new(p).expect("valid pattern").matches_path_with(
            path,
            glob::MatchOptions {
                require_literal_separator: true,
                require_literal_leading_dot: leading_dot,
                ..Default::default()
            },
        )
    })
}

/// The scope sees absolute, canonicalised paths, and those look different per
/// platform — which is why the pattern list carries both `**` and `/*/**`.
#[cfg(unix)]
const VAULT: &str = "/home/user/vault";
#[cfg(windows)]
const VAULT: &str = r"C:\Users\user\vault";

fn in_vault(rel: &str) -> String {
    let sep = std::path::MAIN_SEPARATOR_STR;
    format!("{VAULT}{sep}{}", rel.replace('/', sep))
}

#[test]
fn a_dot_file_inside_a_dot_folder_is_in_scope() {
    // The exact shape from issue #70.
    for rel in [".attachments/.gitkeep", ".rumdl_cache/.gitignore"] {
        assert!(
            is_allowed(&in_vault(rel), require_literal_leading_dot()),
            "{rel} must be reachable — this is what issue #70 reported"
        );
    }
}

#[test]
fn ordinary_and_single_dot_paths_stay_in_scope() {
    for rel in ["Notes/A.md", ".obsidian/config", "Attachments/img.png", ".env-notes.md"] {
        assert!(is_allowed(&in_vault(rel), require_literal_leading_dot()), "{rel}");
    }
}

#[test]
fn the_platform_default_is_what_broke_it() {
    // Red counter-check for the fix: with the flag on, the very same patterns
    // reject the path. Deliberately not gated on cfg!(unix) — measured on
    // Windows, no pattern matches there either, and the CI's Rust job runs this
    // on Linux. If it ever passes, the leading-dot flag has stopped doing the
    // work and the test above is green by accident.
    assert!(
        !is_allowed(&in_vault(".attachments/.gitkeep"), true),
        "expected the leading-dot default to reject a dot-in-dot path"
    );
}

#[test]
fn the_config_carries_the_fix() {
    // Read the value EXPLICITLY rather than through require_literal_leading_dot():
    // that helper falls back to the platform default, which on Windows is already
    // false — so dropping the config line would not fail this test when run here,
    // and the check would be unfalsifiable on half the machines that run it.
    let conf: serde_json::Value = serde_json::from_str(TAURI_CONF).expect("tauri conf json");
    assert_eq!(
        conf["plugins"]["fs"]["requireLiteralLeadingDot"].as_bool(),
        Some(false),
        "the fs scope relies on requireLiteralLeadingDot=false; removing it breaks dot-in-dot paths on Linux and macOS"
    );
}

