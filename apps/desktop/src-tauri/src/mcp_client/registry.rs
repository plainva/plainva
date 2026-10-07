//! Which foreign servers this installation knows, and their credentials.
//!
//! The registry is a file in the app data folder. It grows in exactly two
//! commands, and in both only after a NATIVE dialog showed what is about to be
//! remembered: the address of a remote server, or the full command line of a
//! program. A request or a start names a server id; nothing else in this
//! module accepts an address or a command from the web view.

use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::McpClientState;
use crate::ai_egress::only_main;

/// Keychain slots of foreign servers: `ai-mcp:<id>` for a remote server's
/// token, `ai-mcp:<id>:<NAME>` for a value in a program's environment.
/// `secure_store`'s generic commands refuse the prefix.
pub const MCP_KEY_PREFIX: &str = "ai-mcp:";

const REGISTRY_FILE: &str = "ai-mcp-servers.json";
const MAX_URL: usize = 2048;
const MAX_ARGS: usize = 64;
const MAX_ARG: usize = 4096;
const MAX_ENV: usize = 32;
/// A command line longer than this cannot be read in a dialog, so it cannot be approved.
const MAX_COMMAND_TEXT: usize = 6000;
const MAX_SECRET: usize = 8192;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Server {
    /// A remote server: the one address requests go to.
    Http { url: String },
    /// A program on this computer: the file that is started, its arguments, the
    /// NAMES of the environment values kept in the keychain, and whether it
    /// runs in a sandbox.
    Program { program: String, args: Vec<String>, env: Vec<String>, sandbox: bool },
}

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Registry {
    pub(crate) servers: BTreeMap<String, Server>,
}

fn registry_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join(REGISTRY_FILE))
}

/// Atomic, like every other file this app writes: a torn registry would
/// silently forget — or half remember — what the user confirmed.
fn save(app: &AppHandle, snapshot: &str) -> Result<(), String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    crate::atomic_write::write_atomic_impl(&root, REGISTRY_FILE, snapshot.as_bytes())
}

pub(crate) fn with_registry<T>(app: &AppHandle, state: &McpClientState, run: impl FnOnce(&mut Registry) -> T) -> Result<T, String> {
    let mut guard = state.registry.lock().map_err(|_| "server registry lock failed".to_string())?;
    if guard.is_none() {
        // A file that cannot be read is an empty registry: nothing is approved that cannot be shown.
        let loaded = std::fs::read_to_string(registry_file(app)?)
            .ok()
            .and_then(|text| serde_json::from_str::<Registry>(&text).ok())
            .unwrap_or_default();
        *guard = Some(loaded);
    }
    Ok(run(guard.as_mut().expect("loaded above")))
}

pub(crate) fn server(app: &AppHandle, state: &McpClientState, id: &str) -> Result<Option<Server>, String> {
    with_registry(app, state, |registry| registry.servers.get(id).cloned())
}

/// The id is part of every tool name a server's tools get: short, lower case,
/// a letter first (`MCP_SERVER_ID_PATTERN` in packages/core).
pub(crate) fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_lowercase()) && id.len() <= 16 && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn is_loopback(host: &str) -> bool {
    host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1"
}

/// The address of a remote server as it is stored and shown: https — plain
/// http only to this device —, no credentials in it, no fragment. Printable
/// ASCII only: a name in another script is typed in its `xn--` form, so the
/// dialog shows what is connected to and nothing that only looks like it.
/// The same decisions as `checkMcpAddress` in packages/core (`MCP_ADDRESS_CASES`).
pub(crate) fn normalize_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_URL || !trimmed.bytes().all(|byte| (0x21..=0x7e).contains(&byte)) {
        return Err("not an address".into());
    }
    let mut url = reqwest::Url::parse(trimmed).map_err(|_| "not an address".to_string())?;
    let host = url.host_str().ok_or("the address has no host")?.to_string();
    match url.scheme() {
        "https" => {}
        "http" if is_loopback(&host) => {}
        _ => return Err("only https, or http to a server on this device".into()),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("no user name or password in the address".into());
    }
    url.set_fragment(None);
    Ok(url.to_string())
}

pub(crate) fn clean_text(text: &str) -> bool {
    !text.chars().any(|c| c.is_control())
}

/// A name of an environment value the user may set for a program. Names that
/// change how a program is loaded are not among them, whoever asks.
pub(crate) fn valid_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    let shape = matches!(chars.next(), Some(first) if first.is_ascii_alphabetic() || first == '_') && name.len() <= 64 && chars.all(|c| c.is_ascii_alphanumeric() || c == '_');
    let upper = name.to_ascii_uppercase();
    shape && upper != "PATH" && upper != "PATHEXT" && upper != "COMSPEC" && !upper.starts_with("LD_") && !upper.starts_with("DYLD_")
}

fn check_program(program: &str, args: &[String], env: &[String]) -> Result<(), String> {
    if program.trim().is_empty() || program.len() > MAX_ARG || !clean_text(program) {
        return Err("not a program".into());
    }
    if args.len() > MAX_ARGS || args.iter().any(|arg| arg.len() > MAX_ARG || !clean_text(arg)) {
        return Err("too many arguments, or one that cannot be shown".into());
    }
    if env.len() > MAX_ENV || env.iter().any(|name| !valid_env_name(name)) {
        return Err("a name of an environment value is not allowed".into());
    }
    let mut seen = std::collections::BTreeSet::new();
    if !env.iter().all(|name| seen.insert(name.to_ascii_uppercase())) {
        return Err("an environment value is named twice".into());
    }
    Ok(())
}

/// The extensions a program name is tried with. Windows starts `npx` as
/// `npx.cmd`; everywhere else a name is the file.
pub(crate) fn program_extensions(windows: bool, pathext: Option<&str>) -> Vec<String> {
    if !windows {
        return vec![String::new()];
    }
    let mut extensions = vec![String::new()];
    extensions.extend(pathext.unwrap_or(".COM;.EXE;.BAT;.CMD").split(';').map(str::trim).filter(|ext| ext.starts_with('.') && ext.len() <= 8).map(str::to_string));
    extensions
}

/// The file a program name means: an absolute path as it is, a bare name as
/// the first match on the search path. A relative path with folders in it is
/// refused — what it means would depend on where the app happens to run.
pub(crate) fn resolve_program(program: &str, search: &[PathBuf], extensions: &[String]) -> Option<PathBuf> {
    let candidate = Path::new(program);
    let with_extensions = |base: &Path| {
        extensions.iter().find_map(|extension| {
            let mut name = base.as_os_str().to_os_string();
            name.push(extension);
            let path = PathBuf::from(name);
            path.is_file().then_some(path)
        })
    };
    if candidate.is_absolute() {
        return with_extensions(candidate);
    }
    if candidate.components().count() != 1 {
        return None;
    }
    search.iter().find_map(|folder| with_extensions(&folder.join(candidate)))
}

/// Where a bare program name is looked for: the app's own search path, and
/// the folders a desktop app started from the dock does not have on it.
pub(crate) fn search_path(path: Option<&OsStr>, home: Option<&Path>, unix: bool) -> Vec<PathBuf> {
    let mut folders: Vec<PathBuf> = path.map(|value| std::env::split_paths(value).collect()).unwrap_or_default();
    if unix {
        for extra in ["/opt/homebrew/bin", "/usr/local/bin"] {
            folders.push(PathBuf::from(extra));
        }
        if let Some(home) = home {
            folders.push(home.join(".local").join("bin"));
        }
    }
    folders.retain(|folder| folder.is_absolute());
    folders
}

pub(crate) fn locate(program: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let pathext = std::env::var("PATHEXT").ok();
    resolve_program(
        program.trim(),
        &search_path(std::env::var_os("PATH").as_deref(), home.as_deref(), cfg!(unix)),
        &program_extensions(cfg!(windows), pathext.as_deref()),
    )
}

/// What the native dialog shows for a program: every part on a line of its
/// own, nothing shortened. Written here, not by the web view.
pub(crate) fn command_text(program: &str, args: &[String], env: &[String], sandbox: bool) -> String {
    let mut lines = vec![program.to_string()];
    lines.extend(args.iter().cloned());
    lines.push(String::new());
    if !env.is_empty() {
        lines.push(format!("Env: {}", env.join(", ")));
    }
    lines.push(format!("Sandbox: {}", if sandbox { "on" } else { "off" }));
    lines.join("\n")
}

pub(crate) fn secret_slot(id: &str, name: Option<&str>) -> String {
    match name {
        Some(name) => format!("{MCP_KEY_PREFIX}{id}:{name}"),
        None => format!("{MCP_KEY_PREFIX}{id}"),
    }
}

pub(crate) fn read_secret(app: &AppHandle, id: &str, name: Option<&str>) -> Result<Option<String>, String> {
    crate::secure_store::read_slot(app, &secret_slot(id, name))
}

/// The texts of a native confirmation, in the app's language. What is
/// confirmed — the address, the command — is always added below them here.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfirmText {
    title: String,
    message: String,
    confirm: String,
    cancel: String,
}

fn clip(text: &str, max: usize) -> String {
    text.chars().filter(|c| !c.is_control() || *c == '\n').take(max).collect()
}

pub(crate) async fn confirmed(app: &AppHandle, text: McpConfirmText, subject: String) -> Result<bool, String> {
    let question = format!("{}\n\n{subject}", clip(&text.message, 600));
    let (title, confirm, cancel) = (clip(&text.title, 80), clip(&text.confirm, 40), clip(&text.cancel, 40));
    let dialog_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
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
    .map_err(|e| e.to_string())
}

fn remember(app: &AppHandle, state: &McpClientState, id: &str, entry: Server) -> Result<(), String> {
    let snapshot = with_registry(app, state, |registry| {
        registry.servers.insert(id.to_string(), entry);
        serde_json::to_string_pretty(registry)
    })?
    .map_err(|e| e.to_string())?;
    save(app, &snapshot)
}

/// What the registry holds, for the settings to show: exactly what was
/// confirmed, and which values are stored — never a value.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    id: String,
    kind: &'static str,
    url: Option<String>,
    program: Option<String>,
    args: Vec<String>,
    env: Vec<String>,
    sandbox: bool,
    /// The stored values by name; the empty name is a remote server's token.
    stored: Vec<String>,
}

#[tauri::command]
pub fn mcp_client_servers(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>) -> Result<Vec<McpServerInfo>, String> {
    only_main(&window)?;
    let servers = with_registry(&app, &state, |registry| registry.servers.clone())?;
    let mut out = Vec::new();
    for (id, entry) in servers {
        out.push(match entry {
            Server::Http { url } => McpServerInfo {
                stored: if read_secret(&app, &id, None)?.is_some() { vec![String::new()] } else { Vec::new() },
                id,
                kind: "http",
                url: Some(url),
                program: None,
                args: Vec::new(),
                env: Vec::new(),
                sandbox: false,
            },
            Server::Program { program, args, env, sandbox } => {
                let mut stored = Vec::new();
                for name in &env {
                    if read_secret(&app, &id, Some(name))?.is_some() {
                        stored.push(name.clone());
                    }
                }
                McpServerInfo { id, kind: "program", url: None, program: Some(program), args, env, sandbox, stored }
            }
        });
    }
    Ok(out)
}

/// Remembers a remote server after a NATIVE confirmation of its address.
#[tauri::command]
pub async fn mcp_client_add_http(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>, server_id: String, url: String, text: McpConfirmText) -> Result<bool, String> {
    only_main(&window)?;
    if !valid_id(&server_id) {
        return Err("invalid server id".into());
    }
    let address = normalize_url(&url)?;
    if !confirmed(&app, text, address.clone()).await? {
        return Ok(false);
    }
    forget_secrets(&app, &state, &server_id)?;
    remember(&app, &state, &server_id, Server::Http { url: address })?;
    Ok(true)
}

/// Remembers a program after a NATIVE confirmation of its whole command line:
/// the file that will be started, every argument, the names of the values it
/// gets, and whether it runs in a sandbox.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mcp_client_add_program(
    window: tauri::Window,
    app: AppHandle,
    state: State<'_, McpClientState>,
    server_id: String,
    program: String,
    args: Vec<String>,
    env: Vec<String>,
    sandbox: bool,
    text: McpConfirmText,
) -> Result<bool, String> {
    only_main(&window)?;
    if !valid_id(&server_id) {
        return Err("invalid server id".into());
    }
    check_program(&program, &args, &env)?;
    let file = locate(&program).ok_or("the program was not found")?;
    let file = file.to_string_lossy().into_owned();
    let subject = command_text(&file, &args, &env, sandbox);
    if subject.len() > MAX_COMMAND_TEXT {
        return Err("the command is too long to be shown".into());
    }
    if !confirmed(&app, text, subject).await? {
        return Ok(false);
    }
    super::program::stop(&state, &server_id);
    forget_secrets(&app, &state, &server_id)?;
    remember(&app, &state, &server_id, Server::Program { program: file, args, env, sandbox })?;
    Ok(true)
}

/// Everything stored for a server goes with it: a new entry under an old id starts without the old one's values — and without its sign-in.
fn forget_secrets(app: &AppHandle, state: &McpClientState, id: &str) -> Result<(), String> {
    let old = server(app, state, id)?;
    super::oauth::forget(app, state, id)?;
    crate::secure_store::write_slot(app, &secret_slot(id, None), None)?;
    if let Some(Server::Program { env, .. }) = old {
        for name in env {
            crate::secure_store::write_slot(app, &secret_slot(id, Some(&name)), None)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn mcp_client_remove(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>, server_id: String) -> Result<(), String> {
    only_main(&window)?;
    super::program::stop(&state, &server_id);
    forget_secrets(&app, &state, &server_id)?;
    let snapshot = with_registry(&app, &state, |registry| {
        registry.servers.remove(&server_id);
        serde_json::to_string_pretty(registry)
    })?
    .map_err(|e| e.to_string())?;
    save(&app, &snapshot)
}

/// The slot a value of this server may be written to: a remote server has one
/// token, a program the values it was confirmed with — and no other.
fn slot_for(app: &AppHandle, state: &McpClientState, id: &str, name: Option<&str>) -> Result<String, String> {
    match (server(app, state, id)?, name) {
        (Some(Server::Http { .. }), None) => Ok(secret_slot(id, None)),
        (Some(Server::Program { env, .. }), Some(name)) if env.iter().any(|known| known == name) => Ok(secret_slot(id, Some(name))),
        _ => Err("no such value for this server".into()),
    }
}

/// Stores a credential. Write-only: no command returns it.
#[tauri::command]
pub fn mcp_client_secret_set(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>, server_id: String, name: Option<String>, value: String) -> Result<(), String> {
    only_main(&window)?;
    let slot = slot_for(&app, &state, &server_id, name.as_deref())?;
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_SECRET || !clean_text(value) {
        return Err("invalid value".into());
    }
    // A fixed token takes the place of a sign-in: a server has one credential, not two.
    if name.is_none() {
        super::oauth::forget(&app, &state, &server_id)?;
    }
    crate::secure_store::write_slot(&app, &slot, Some(value))
}

#[tauri::command]
pub fn mcp_client_secret_present(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>, server_id: String, name: Option<String>) -> Result<bool, String> {
    only_main(&window)?;
    let slot = slot_for(&app, &state, &server_id, name.as_deref())?;
    Ok(crate::secure_store::read_slot(&app, &slot)?.is_some())
}

#[tauri::command]
pub fn mcp_client_secret_delete(window: tauri::Window, app: AppHandle, state: State<'_, McpClientState>, server_id: String, name: Option<String>) -> Result<(), String> {
    only_main(&window)?;
    let slot = slot_for(&app, &state, &server_id, name.as_deref())?;
    crate::secure_store::write_slot(&app, &slot, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_id_is_short_lower_case_and_starts_with_a_letter() {
        for good in ["a", "tracker", "github2", "abcdefghijklmnop"] {
            assert!(valid_id(good), "{good}");
        }
        for bad in ["", "2go", "Tracker", "my-server", "my_server", "abcdefghijklmnopq", "tr\u{e4}cker", "a b", "a:b", "../x"] {
            assert!(!valid_id(bad), "{bad}");
        }
    }

    /// [what the user typed, whether it is an address a server may have] — the same list as
    /// `MCP_ADDRESS_CASES` in packages/core/src/ai/mcp/native.test.ts, which the phones run too.
    const MCP_ADDRESS_CASES: &[(&str, bool)] = &[
        (" https://MCP.Example.com/mcp ", true),
        ("https://mcp.example.com/mcp?toolsets=issues#top", true),
        ("https://mcp.example.com:8443", true),
        ("https://192.168.1.20/mcp", true),
        ("https://xn--bcher-kva.example/mcp", true),
        ("http://localhost:3000/mcp", true),
        ("http://127.0.0.1:3000/mcp", true),
        ("http://[::1]:3000/mcp", true),
        ("", false),
        ("   ", false),
        ("mcp.example.com/mcp", false),
        ("http://mcp.example.com/mcp", false),
        ("http://192.168.1.20:3000/mcp", false),
        ("http://localhost.evil.test/mcp", false),
        ("https://user:secret@mcp.example.com/mcp", false),
        ("https://user@mcp.example.com/mcp", false),
        ("ftp://mcp.example.com/", false),
        ("file:///etc/passwd", false),
        ("javascript:alert(1)", false),
        ("https://", false),
        ("https://mcp.example.com/a b", false),
        // A Cyrillic letter in the host: what only looks like a name is not one.
        ("https://ex\u{430}mple.com/mcp", false),
        ("https://mcp.example.com/caf\u{e9}", false),
    ];

    #[test]
    fn an_address_is_ascii_https_or_this_device() {
        for (typed, accepted) in MCP_ADDRESS_CASES {
            assert_eq!(normalize_url(typed).is_ok(), *accepted, "{typed}");
        }
        assert!(normalize_url(&format!("https://mcp.example.com/{}", "a".repeat(3000))).is_err());
    }

    #[test]
    fn an_address_is_stored_in_one_form_without_its_fragment() {
        assert_eq!(normalize_url(" https://MCP.Example.com/mcp ").unwrap(), "https://mcp.example.com/mcp");
        assert_eq!(normalize_url("https://mcp.example.com/mcp?toolsets=issues#top").unwrap(), "https://mcp.example.com/mcp?toolsets=issues");
        assert_eq!(normalize_url("https://mcp.example.com:8443").unwrap(), "https://mcp.example.com:8443/");
        assert_eq!(normalize_url("https://mcp.example.com:443/mcp").unwrap(), "https://mcp.example.com/mcp");
        assert_eq!(normalize_url("http://[::1]:3000/mcp").unwrap(), "http://[::1]:3000/mcp");
    }

    #[test]
    fn environment_names_are_plain_and_not_the_ones_that_change_how_a_program_loads() {
        for good in ["GITHUB_TOKEN", "API_KEY", "_PRIVATE", "token2"] {
            assert!(valid_env_name(good), "{good}");
        }
        for bad in ["", "2FAST", "MY-KEY", "MY KEY", "A=B", "PATH", "Path", "PATHEXT", "ComSpec", "LD_PRELOAD", "ld_library_path", "DYLD_INSERT_LIBRARIES", &"A".repeat(65)] {
            assert!(!valid_env_name(bad), "{bad}");
        }
    }

    #[test]
    fn a_command_must_be_showable() {
        let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(check_program("npx", &args(&["-y", "@scope/server"]), &args(&["API_KEY"])).is_ok());
        assert!(check_program("", &[], &[]).is_err());
        assert!(check_program("  ", &[], &[]).is_err());
        assert!(check_program("npx\n", &[], &[]).is_err());
        assert!(check_program("npx", &args(&["a\u{0}b"]), &[]).is_err());
        assert!(check_program("npx", &args(&["line\nbreak"]), &[]).is_err());
        assert!(check_program("npx", &vec!["x".to_string(); 65], &[]).is_err());
        assert!(check_program("npx", &args(&[&"x".repeat(5000)]), &[]).is_err());
        assert!(check_program("npx", &[], &args(&["LD_PRELOAD"])).is_err());
        assert!(check_program("npx", &[], &args(&["TOKEN", "token"])).is_err());
    }

    #[test]
    fn the_dialog_shows_every_part_of_a_command_on_its_own_line() {
        let text = command_text("/usr/local/bin/npx", &["-y".into(), "@scope/server --flag".into()], &["API_KEY".into(), "REGION".into()], true);
        assert_eq!(text, "/usr/local/bin/npx\n-y\n@scope/server --flag\n\nEnv: API_KEY, REGION\nSandbox: on");
        assert_eq!(command_text("C:\\tools\\server.exe", &[], &[], false), "C:\\tools\\server.exe\n\nSandbox: off");
    }

    #[test]
    fn a_program_is_an_absolute_file_or_a_name_on_the_search_path() {
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("bin");
        let other = root.path().join("other");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(bin.join("server"), b"").unwrap();
        std::fs::write(other.join("server"), b"").unwrap();
        std::fs::write(other.join("npx.cmd"), b"").unwrap();
        std::fs::create_dir_all(bin.join("folder")).unwrap();
        let search = vec![bin.clone(), other.clone()];
        let plain = vec![String::new()];

        assert_eq!(resolve_program("server", &search, &plain), Some(bin.join("server")));
        assert_eq!(resolve_program(other.join("server").to_str().unwrap(), &search, &plain), Some(other.join("server")));
        // A folder is no program, a name that is nowhere is none, and a relative path means nothing fixed.
        assert_eq!(resolve_program("folder", &search, &plain), None);
        assert_eq!(resolve_program("missing", &search, &plain), None);
        assert_eq!(resolve_program("bin/server", &search, &plain), None);
        assert_eq!(resolve_program("../bin/server", &search, &plain), None);
        // Windows finds `npx` as `npx.cmd`; elsewhere the name is the file.
        assert_eq!(resolve_program("npx", &search, &plain), None);
        // (The extensions are spelled as the file is: a case-sensitive file system tells `.cmd` from `.CMD`.)
        assert_eq!(resolve_program("npx", &search, &program_extensions(true, Some(".exe;.cmd"))), Some(other.join("npx.cmd")));
    }

    #[test]
    fn extensions_come_from_the_system_on_windows_and_are_none_elsewhere() {
        assert_eq!(program_extensions(false, Some(".EXE")), vec![String::new()]);
        assert_eq!(program_extensions(true, None), vec!["", ".COM", ".EXE", ".BAT", ".CMD"]);
        assert_eq!(program_extensions(true, Some(".EXE; .CMD ;bad;.toolongextension")), vec!["", ".EXE", ".CMD"]);
    }

    #[test]
    fn the_search_path_keeps_absolute_folders_and_adds_the_usual_ones_on_unix() {
        let joined = std::env::join_paths([PathBuf::from(if cfg!(windows) { "C:\\bin" } else { "/bin" }), PathBuf::from("relative")]).unwrap();
        let plain = search_path(Some(&joined), None, false);
        assert_eq!(plain.len(), 1);
        let home = PathBuf::from(if cfg!(windows) { "C:\\Users\\me" } else { "/home/me" });
        let unix = search_path(Some(&joined), Some(&home), true);
        assert!(unix.contains(&home.join(".local").join("bin")));
        assert!(search_path(None, None, false).is_empty());
    }

    #[test]
    fn slots_are_per_server_and_per_name() {
        assert_eq!(secret_slot("tracker", None), "ai-mcp:tracker");
        assert_eq!(secret_slot("tracker", Some("API_KEY")), "ai-mcp:tracker:API_KEY");
        assert!(secret_slot("tracker", None).starts_with(MCP_KEY_PREFIX));
    }

    #[test]
    fn the_registry_survives_a_round_trip_and_an_unreadable_file_is_empty() {
        let mut registry = Registry::default();
        registry.servers.insert("tracker".into(), Server::Http { url: "https://mcp.example.com/mcp".into() });
        registry.servers.insert("local".into(), Server::Program { program: "/usr/bin/server".into(), args: vec!["--stdio".into()], env: vec!["TOKEN".into()], sandbox: true });
        let text = serde_json::to_string_pretty(&registry).unwrap();
        let back: Registry = serde_json::from_str(&text).unwrap();
        assert_eq!(back.servers, registry.servers);
        assert!(text.contains("\"kind\": \"http\"") && text.contains("\"kind\": \"program\""));
        assert!(serde_json::from_str::<Registry>("{\"servers\": [1,2]}").is_err());
    }
}
