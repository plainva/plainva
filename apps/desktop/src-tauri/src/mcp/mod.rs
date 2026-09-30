//! Plainva as a read-only MCP server (plan KI-Harness §17.3, P1b; ADR 0021).
//!
//! Other AI tools on this computer — Claude Code, Claude Desktop, editors —
//! start the small helper `plainva-mcp` as a stdio server; the helper connects
//! to this app through a named pipe (Windows) or a Unix socket in a private
//! folder (macOS, Linux). No network port is ever opened. Everything is off
//! until the user switches it on for this device.
//!
//! A client is admitted in two steps: the first contact asks the user in the
//! main window (which client, which program started it, which folders), and
//! the helper then keeps a secret for the next time. Folders are granted per
//! client and vault, deny by default, and every path in a request and in an
//! answer is checked here against them (`paths.rs`). The tools themselves run
//! in the main window, through the same gate as the assistant's tools; this
//! side only forwards, checks and keeps the audit.

pub mod hello;
pub mod paths;
pub mod store;
#[cfg(unix)]
pub mod socket_dir;
mod handler;
mod listener;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rmcp::ServiceExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

use hello::{Hello, HelloReply, HELLO_MAX_BYTES, HELLO_VERSION};
use store::{ClientRecord, Store};

/// How long the user has to answer a pairing request.
const PAIR_TIMEOUT: Duration = if cfg!(test) { Duration::from_millis(300) } else { Duration::from_secs(120) };
/// How long one tool call may take in the main window.
const CALL_TIMEOUT: Duration = if cfg!(test) { Duration::from_secs(2) } else { Duration::from_secs(30) };
/// A client the user turned away is not asked about again for this long.
const DENIED_QUIET: Duration = Duration::from_secs(600);

/// A tool as the web view registers it (the core manifests with surface "mcp").
#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    /// Arguments that name a vault path: checked against the client's folders before the call.
    #[serde(default)]
    pub path_args: Vec<String>,
}

/// A prompt as the web view registers it (the core skills of plan P1.5), in the app's language.
#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PromptSpec {
    pub name: String,
    pub title: String,
    pub description: String,
    /// The message; `{{name}}` of the argument is replaced by its value.
    pub text: String,
    /// The one argument the prompt takes, if any; it is required.
    #[serde(default)]
    pub argument: Option<PromptArgumentSpec>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PromptArgumentSpec {
    pub name: String,
    pub description: String,
}

/// The longest argument a prompt takes in: a project's name, not a document.
const PROMPT_ARGUMENT_MAX: usize = 200;

impl PromptSpec {
    /// The message with its argument filled in; an error names what is missing.
    pub fn render(&self, arguments: Option<&serde_json::Map<String, serde_json::Value>>) -> Result<String, String> {
        let Some(argument) = &self.argument else {
            return Ok(self.text.clone());
        };
        let value = arguments
            .and_then(|args| args.get(&argument.name))
            .and_then(|value| value.as_str())
            .map(|raw| raw.chars().map(|c| if c.is_control() { ' ' } else { c }).collect::<String>())
            .map(|clean| clean.trim().chars().take(PROMPT_ARGUMENT_MAX).collect::<String>())
            .filter(|clean| !clean.is_empty())
            .ok_or_else(|| format!("The prompt {} needs the argument {}.", self.name, argument.name))?;
        Ok(self.text.replace(&format!("{{{{{}}}}}", argument.name), &value))
    }
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultBinding {
    /// The web view's stable handle of the open vault (`aiVaultKey`).
    pub key: String,
    pub name: String,
    /// The vault's folder on disk: paths are resolved against it (symlinks, junctions).
    pub root: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CallAnswer {
    pub content: String,
    pub is_error: bool,
    /// Every vault path the answer names: checked against the client's folders.
    pub paths: Vec<String>,
}

struct PairAnswer {
    allow: bool,
    folders: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PairRequest {
    request_id: String,
    client: String,
    version: String,
    program: String,
    /// Paired before: this asks only for folders of the vault open now.
    known: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CallRequest {
    request_id: String,
    client_id: String,
    client: String,
    tool: String,
    args: serde_json::Value,
    folders: Vec<String>,
}

#[derive(Default)]
struct Inner {
    enabled: bool,
    listener: Option<tauri::async_runtime::JoinHandle<()>>,
    vault: Option<VaultBinding>,
    tools: Vec<ToolSpec>,
    prompts: Vec<PromptSpec>,
    calls: HashMap<String, oneshot::Sender<CallAnswer>>,
    pairing: Option<(String, oneshot::Sender<PairAnswer>)>,
    denied: HashMap<String, Instant>,
    next_id: u64,
    /// Raised when the server stops or the vault changes: older connections stop answering.
    generation: u64,
}

#[derive(Default)]
pub struct McpState {
    inner: Mutex<Inner>,
    /// Where the pairing store lives when it is not the app's data folder (tests).
    store_dir: Mutex<Option<std::path::PathBuf>>,
}

pub(crate) fn now_iso() -> String {
    // Seconds since the epoch are enough for ordering and display; the web view formats them.
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    secs.to_string()
}

impl McpState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn store<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Store, String> {
        if let Some(dir) = self.store_dir.lock().unwrap_or_else(|p| p.into_inner()).clone() {
            return Ok(Store::new(dir));
        }
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("mcp");
        Ok(Store::new(dir))
    }

    pub(crate) fn vault_root(&self) -> Option<std::path::PathBuf> {
        self.lock().vault.as_ref().map(|v| std::path::PathBuf::from(&v.root))
    }

    pub(crate) fn generation(&self) -> u64 {
        self.lock().generation
    }

    pub(crate) fn tools(&self) -> Vec<ToolSpec> {
        self.lock().tools.clone()
    }

    pub(crate) fn prompts(&self) -> Vec<PromptSpec> {
        self.lock().prompts.clone()
    }

    fn next_id(&self, prefix: &str) -> String {
        let mut inner = self.lock();
        inner.next_id += 1;
        format!("{prefix}-{}", inner.next_id)
    }

    /// Hands one call to the main window and waits for its answer.
    pub(crate) async fn forward_call<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        client: &ClientRecord,
        tool: &str,
        args: serde_json::Value,
        folders: &[String],
    ) -> Result<CallAnswer, String> {
        let request_id = self.next_id("call");
        let (tx, rx) = oneshot::channel();
        self.lock().calls.insert(request_id.clone(), tx);
        let request = CallRequest {
            request_id: request_id.clone(),
            client_id: client.id.clone(),
            client: client.name.clone(),
            tool: tool.to_string(),
            args,
            folders: folders.to_vec(),
        };
        if app.emit_to("main", "mcp-call", request).is_err() {
            self.lock().calls.remove(&request_id);
            return Err("Plainva could not reach its window.".into());
        }
        match tokio::time::timeout(CALL_TIMEOUT, rx).await {
            Ok(Ok(answer)) => Ok(answer),
            _ => {
                self.lock().calls.remove(&request_id);
                Err("Plainva did not answer in time.".into())
            }
        }
    }

    /// Asks the user in the main window; one question at a time.
    async fn ask_pairing<R: Runtime>(&self, app: &AppHandle<R>, hello: &Hello, known: bool) -> Result<PairAnswer, &'static str> {
        let request_id = self.next_id("pair");
        let (tx, rx) = oneshot::channel();
        {
            let mut inner = self.lock();
            if inner.pairing.is_some() {
                return Err("busy");
            }
            inner.pairing = Some((request_id.clone(), tx));
        }
        let request = PairRequest {
            request_id: request_id.clone(),
            client: hello.client.clone(),
            version: hello.version.clone(),
            program: hello.program.clone(),
            known,
        };
        if app.emit_to("main", "mcp-pair", request).is_err() {
            self.lock().pairing = None;
            return Err("denied");
        }
        let answer = tokio::time::timeout(PAIR_TIMEOUT, rx).await;
        let mut inner = self.lock();
        if inner.pairing.as_ref().is_some_and(|(id, _)| *id == request_id) {
            inner.pairing = None;
        }
        match answer {
            Ok(Ok(answer)) => Ok(answer),
            _ => Err("denied"),
        }
    }

    /// Admits a client or says why not (see `HelloReply::reason`).
    async fn admit<R: Runtime>(&self, app: &AppHandle<R>, hello: &Hello) -> Result<(ClientRecord, Vec<String>, Option<String>), HelloReply> {
        if hello.v != HELLO_VERSION {
            return Err(HelloReply::refuse("version"));
        }
        let vault = self.lock().vault.clone().ok_or_else(|| HelloReply::refuse("no-vault"))?;
        let store = self.store(app).map_err(|_| HelloReply::refuse("invalid"))?;
        let quiet_key = format!("{}\u{1}{}", hello.client, hello.program);
        {
            let mut inner = self.lock();
            inner.denied.retain(|_, at| at.elapsed() < DENIED_QUIET);
            if inner.denied.contains_key(&quiet_key) {
                return Err(HelloReply::refuse("denied"));
            }
        }
        let mut clients = store.clients();
        let known = clients.find(&hello.client, hello.secret.as_deref()).cloned();
        let mut grants = store.grants(&vault.key);
        if let Some(client) = &known {
            if let Some(folders) = grants.folders.get(&client.id).filter(|f| !f.is_empty()).cloned() {
                if let Some(record) = clients.clients.iter_mut().find(|c| c.id == client.id) {
                    record.last_seen = now_iso();
                }
                let _ = store.save_clients(&clients);
                return Ok((client.clone(), folders, None));
            }
        }
        let answer = match self.ask_pairing(app, hello, known.is_some()).await {
            Ok(answer) if answer.allow && !answer.folders.is_empty() => answer,
            Ok(_) | Err("denied") => {
                self.lock().denied.insert(quiet_key, Instant::now());
                return Err(HelloReply::refuse("denied"));
            }
            Err(reason) => return Err(HelloReply::refuse(reason)),
        };
        let folders: Vec<String> = answer
            .folders
            .iter()
            .filter_map(|f| if f.is_empty() { Some(String::new()) } else { paths::safe_rel_path(f) })
            .collect();
        if folders.is_empty() {
            return Err(HelloReply::refuse("denied"));
        }
        let (client, secret) = match known {
            Some(client) => (client, None),
            None => {
                let secret = store::new_secret().map_err(|_| HelloReply::refuse("invalid"))?;
                let record = ClientRecord {
                    id: store::new_id().map_err(|_| HelloReply::refuse("invalid"))?,
                    name: hello.client.clone(),
                    program: hello.program.clone(),
                    secret_sha256: store::hash_secret(&secret),
                    created_at: now_iso(),
                    last_seen: now_iso(),
                };
                clients.clients.push(record.clone());
                store.save_clients(&clients).map_err(|_| HelloReply::refuse("invalid"))?;
                (record, Some(secret))
            }
        };
        grants.folders.insert(client.id.clone(), folders.clone());
        store.save_grants(&vault.key, &grants).map_err(|_| HelloReply::refuse("invalid"))?;
        Ok((client, folders, secret))
    }
}

/// One connection: the hello line, admission, then MCP until the client leaves.
pub(crate) async fn serve_connection<R: Runtime, S>(app: AppHandle<R>, stream: S)
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (read_half, mut write_half) = tokio::io::split(stream);
    let mut reader = BufReader::new(read_half);
    let mut line = Vec::new();
    let read = tokio::time::timeout(Duration::from_secs(10), async {
        let mut limited = (&mut reader).take(HELLO_MAX_BYTES as u64);
        limited.read_until(b'\n', &mut line).await
    })
    .await;
    let hello: Option<Hello> = match read {
        Ok(Ok(n)) if n > 0 => serde_json::from_slice(&line).ok(),
        _ => None,
    };
    let reply_line = |reply: &HelloReply| format!("{}\n", serde_json::to_string(reply).unwrap_or_else(|_| "{\"ok\":false}".into()));
    let Some(mut hello) = hello else {
        let _ = write_half.write_all(reply_line(&HelloReply::refuse("invalid")).as_bytes()).await;
        return;
    };
    hello.client = hello::clean_label(&hello.client);
    hello.version = hello::clean_label(&hello.version);
    hello.program = hello.program.chars().filter(|c| !c.is_control()).take(512).collect();
    let state = app.state::<McpState>();
    let vault_key = state.lock().vault.as_ref().map(|v| v.key.clone()).unwrap_or_default();
    let (client, folders, secret) = match state.admit(&app, &hello).await {
        Ok(admitted) => admitted,
        Err(reply) => {
            let _ = write_half.write_all(reply_line(&reply).as_bytes()).await;
            return;
        }
    };
    let ok = HelloReply { ok: true, secret, reason: None };
    if write_half.write_all(reply_line(&ok).as_bytes()).await.is_err() {
        return;
    }
    let generation = state.generation();
    let handler = handler::PlainvaMcp { app: app.clone(), client, vault_key, folders: Arc::new(folders), generation };
    if let Ok(service) = handler.serve((reader, write_half)).await {
        let _ = service.waiting().await;
    }
}

fn only_main(window: &tauri::Window) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("MCP is only available to the main window".into())
    }
}

/// The main window's settings: on/off, the vault it serves, the tools and the prompts.
#[tauri::command]
pub fn mcp_configure(
    app: AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, McpState>,
    enabled: bool,
    vault: Option<VaultBinding>,
    tools: Vec<ToolSpec>,
    prompts: Option<Vec<PromptSpec>>,
) -> Result<(), String> {
    only_main(&window)?;
    let mut inner = state.lock();
    let vault_changed = inner.vault != vault;
    inner.vault = vault;
    inner.tools = tools;
    inner.prompts = prompts.unwrap_or_default();
    // Open connections belong to the vault they were admitted for: a switch closes them.
    if !enabled || vault_changed {
        if let Some(task) = inner.listener.take() {
            task.abort();
        }
        inner.generation += 1;
    }
    inner.enabled = enabled;
    if enabled && inner.listener.is_none() {
        let endpoint = hello::endpoint_name(&app.config().identifier);
        let app2 = app.clone();
        inner.listener = Some(tauri::async_runtime::spawn(async move {
            if let Err(error) = listener::serve(app2, endpoint).await {
                eprintln!("mcp: the listener stopped: {error}");
            }
        }));
    }
    if !enabled {
        inner.calls.clear();
        inner.pairing = None;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientView {
    id: String,
    name: String,
    program: String,
    created_at: String,
    last_seen: String,
    /// Folders in the vault open now; empty = none.
    folders: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    running: bool,
    /// The helper next to the app, for the set-up snippets.
    helper_path: Option<String>,
    identifier: String,
    clients: Vec<ClientView>,
    audit: Vec<store::AuditEntry>,
}

#[tauri::command]
pub fn mcp_status(app: AppHandle, window: tauri::Window, state: tauri::State<'_, McpState>) -> Result<McpStatus, String> {
    only_main(&window)?;
    let (running, vault) = {
        let inner = state.lock();
        (inner.listener.as_ref().is_some(), inner.vault.clone())
    };
    let store = state.store(&app)?;
    let grants = vault.as_ref().map(|v| store.grants(&v.key)).unwrap_or_default();
    let clients = store
        .clients()
        .clients
        .into_iter()
        .map(|c| ClientView {
            folders: grants.folders.get(&c.id).cloned().unwrap_or_default(),
            id: c.id,
            name: c.name,
            program: c.program,
            created_at: c.created_at,
            last_seen: c.last_seen,
        })
        .collect();
    let mut audit = vault.as_ref().map(|v| store.audit(&v.key)).unwrap_or_default();
    audit.reverse();
    audit.truncate(100);
    Ok(McpStatus { running, helper_path: listener::helper_path().map(|p| p.to_string_lossy().to_string()), identifier: app.config().identifier.clone(), clients, audit })
}

#[tauri::command]
pub fn mcp_pair_answer(window: tauri::Window, state: tauri::State<'_, McpState>, request_id: String, allow: bool, folders: Vec<String>) -> Result<(), String> {
    only_main(&window)?;
    let pending = state.lock().pairing.take();
    match pending {
        Some((id, tx)) if id == request_id => {
            let _ = tx.send(PairAnswer { allow, folders });
            Ok(())
        }
        other => {
            state.lock().pairing = other;
            Err("no such pairing request".into())
        }
    }
}

#[tauri::command]
pub fn mcp_call_answer(window: tauri::Window, state: tauri::State<'_, McpState>, request_id: String, answer: CallAnswer) -> Result<(), String> {
    only_main(&window)?;
    let tx = state.lock().calls.remove(&request_id);
    if let Some(tx) = tx {
        let _ = tx.send(answer);
    }
    Ok(())
}

#[tauri::command]
pub fn mcp_set_folders(app: AppHandle, window: tauri::Window, state: tauri::State<'_, McpState>, client_id: String, folders: Vec<String>) -> Result<(), String> {
    only_main(&window)?;
    let vault = state.lock().vault.clone().ok_or("no vault is open")?;
    let store = state.store(&app)?;
    let mut grants = store.grants(&vault.key);
    let clean: Vec<String> = folders.iter().filter_map(|f| if f.is_empty() { Some(String::new()) } else { paths::safe_rel_path(f) }).collect();
    if clean.is_empty() {
        grants.folders.remove(&client_id);
    } else {
        grants.folders.insert(client_id, clean);
    }
    store.save_grants(&vault.key, &grants)
}

#[tauri::command]
pub fn mcp_revoke(app: AppHandle, window: tauri::Window, state: tauri::State<'_, McpState>, client_id: String) -> Result<(), String> {
    only_main(&window)?;
    state.store(&app)?.revoke(&client_id)
}

/// A package for Claude Desktop (MCPB, manifest v0.3): the helper and a
/// manifest in one zip, written where the user chose.
#[tauri::command]
pub fn mcp_write_package(app: AppHandle, window: tauri::Window, target: String) -> Result<(), String> {
    only_main(&window)?;
    let helper = listener::helper_path().ok_or("the helper program is missing next to Plainva")?;
    let binary = std::fs::read(&helper).map_err(|e| e.to_string())?;
    let file_name = helper.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "plainva-mcp".into());
    let identifier = app.config().identifier.clone();
    let manifest = serde_json::json!({
        "manifest_version": "0.3",
        "name": "plainva",
        "display_name": "Plainva",
        "version": env!("CARGO_PKG_VERSION"),
        "description": "Read-only access to your Plainva vault: search, read, outlines, backlinks, databases, tasks. Plainva must be running.",
        "author": { "name": "Plainva contributors", "url": "https://plainva.com" },
        "homepage": "https://plainva.com",
        "license": "AGPL-3.0-or-later",
        "server": {
            "type": "binary",
            "entry_point": format!("server/{file_name}"),
            "mcp_config": { "command": format!("${{__dirname}}/server/{file_name}"), "args": ["--app", identifier] }
        },
        "tools_generated": true,
        "compatibility": { "platforms": [std::env::consts::OS.replace("macos", "darwin").replace("windows", "win32")] }
    });
    let file = std::fs::File::create(&target).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let text = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let exec = text.unix_permissions(0o755);
    use std::io::Write as _;
    zip.start_file("manifest.json", text).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?.as_bytes()).map_err(|e| e.to_string())?;
    zip.start_file(format!("server/{file_name}"), exec).map_err(|e| e.to_string())?;
    zip.write_all(&binary).map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// The server end to end over a real byte stream, with Tauri's mock runtime
/// standing in for the app (the gate of plan P1b: an unpaired client gets
/// nothing; paths bounce natively; a result naming a note outside the folders
/// is withheld; a vault change closes older connections).
#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::Listener;
    use tokio::io::DuplexStream;

    fn mock_app(dir: &std::path::Path) -> tauri::App<MockRuntime> {
        let app = mock_builder().manage(McpState::default()).build(mock_context(noop_assets())).unwrap();
        let state = app.state::<McpState>();
        *state.store_dir.lock().unwrap() = Some(dir.join("mcp"));
        let mut inner = state.lock();
        inner.vault = Some(VaultBinding { key: "vault-key".into(), name: "Vault".into(), root: dir.join("vault").to_string_lossy().to_string() });
        inner.tools = vec![ToolSpec {
            name: "read_note".into(),
            description: "Reads a note".into(),
            input_schema: serde_json::json!({ "type": "object", "properties": { "path": { "type": "string" } } }),
            path_args: vec!["path".into()],
        }];
        inner.prompts = vec![PromptSpec {
            name: "project-status".into(),
            title: "Project status".into(),
            description: "Where a project stands".into(),
            text: "What is the status of the project “{{project}}”?".into(),
            argument: Some(PromptArgumentSpec { name: "project".into(), description: "The project".into() }),
        }];
        drop(inner);
        app
    }

    fn vault(dir: &std::path::Path) {
        std::fs::create_dir_all(dir.join("vault/Projects")).unwrap();
        std::fs::create_dir_all(dir.join("vault/Private")).unwrap();
        std::fs::write(dir.join("vault/Projects/a.md"), "a").unwrap();
        std::fs::write(dir.join("vault/Private/b.md"), "b").unwrap();
    }

    fn pair(dir: &std::path::Path, secret: &str) {
        let store = Store::new(dir.join("mcp"));
        let record = ClientRecord {
            id: "c1".into(),
            name: "Test client".into(),
            program: "test".into(),
            secret_sha256: store::hash_secret(secret),
            created_at: "0".into(),
            last_seen: "0".into(),
        };
        store.save_clients(&store::Clients { clients: vec![record] }).unwrap();
        let mut grants = store::Grants::default();
        grants.folders.insert("c1".into(), vec!["Projects".into()]);
        store.save_grants("vault-key", &grants).unwrap();
    }

    async fn line(stream: &mut DuplexStream) -> String {
        let mut out = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            let n = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut byte)).await.expect("an answer").unwrap_or(0);
            if n == 0 || byte[0] == b'\n' {
                break;
            }
            out.push(byte[0]);
        }
        String::from_utf8(out).unwrap()
    }

    async fn send(stream: &mut DuplexStream, value: serde_json::Value) {
        stream.write_all(format!("{value}\n").as_bytes()).await.unwrap();
    }

    async fn connect(app: &tauri::App<MockRuntime>, secret: Option<&str>) -> (HelloReply, DuplexStream) {
        let (mut client, server) = tokio::io::duplex(1 << 16);
        tokio::spawn(serve_connection(app.handle().clone(), server));
        let hello = Hello { v: HELLO_VERSION, client: "Test client".into(), version: "1".into(), program: "test".into(), secret: secret.map(str::to_string) };
        send(&mut client, serde_json::to_value(&hello).unwrap()).await;
        let reply = serde_json::from_str(&line(&mut client).await).unwrap();
        (reply, client)
    }

    async fn initialize(client: &mut DuplexStream) -> serde_json::Value {
        send(
            client,
            serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": { "name": "Test client", "version": "1" } } }),
        )
        .await;
        let answer: serde_json::Value = serde_json::from_str(&line(client).await).unwrap();
        send(client, serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).await;
        answer
    }

    async fn call(client: &mut DuplexStream, id: u64, path: &str) -> serde_json::Value {
        send(client, serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": "read_note", "arguments": { "path": path } } })).await;
        serde_json::from_str(&line(client).await).unwrap()
    }

    #[test]
    fn a_prompt_takes_its_argument_clean() {
        let spec = PromptSpec {
            name: "project-status".into(),
            title: "Project status".into(),
            description: "Where a project stands".into(),
            text: "Status of {{project}}.".into(),
            argument: Some(PromptArgumentSpec { name: "project".into(), description: "The project".into() }),
        };
        let args = |value: serde_json::Value| value.as_object().cloned();
        assert_eq!(spec.render(args(serde_json::json!({ "project": "  Offer\n2026 " })).as_ref()).unwrap(), "Status of Offer 2026.");
        assert!(spec.render(args(serde_json::json!({ "project": "   " })).as_ref()).is_err());
        assert!(spec.render(args(serde_json::json!({ "project": 7 })).as_ref()).is_err());
        assert!(spec.render(None).is_err());
        let long = spec.render(args(serde_json::json!({ "project": "x".repeat(500) })).as_ref()).unwrap();
        assert_eq!(long.chars().count(), "Status of .".chars().count() + PROMPT_ARGUMENT_MAX);
        let plain = PromptSpec { argument: None, text: "Today?".into(), ..spec.clone() };
        assert_eq!(plain.render(None).unwrap(), "Today?");
    }

    #[tokio::test]
    async fn an_unpaired_client_gets_nothing() {
        let dir = tempfile::tempdir().unwrap();
        vault(dir.path());
        let app = mock_app(dir.path());
        // Nobody answers the pairing question: it ends as a refusal.
        let (reply, mut client) = connect(&app, None).await;
        assert_eq!(reply, HelloReply::refuse("denied"));
        // The connection is closed: an MCP request finds no one.
        let _ = client.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}\n").await;
        let mut buf = [0u8; 8];
        let n = tokio::time::timeout(Duration::from_secs(5), client.read(&mut buf)).await.unwrap().unwrap_or(0);
        assert_eq!(n, 0);
        // A refused client is not asked about again for a while, and a wrong secret is no pairing.
        pair(dir.path(), "right");
        let (again, _) = connect(&app, Some("wrong")).await;
        assert_eq!(again, HelloReply::refuse("denied"));
        assert!(Store::new(dir.path().join("mcp")).audit("vault-key").is_empty(), "nothing was read");
    }

    #[tokio::test]
    async fn a_paired_client_reads_its_folders_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        vault(dir.path());
        pair(dir.path(), "s3cret");
        let app = mock_app(dir.path());
        // The main window's stand-in: answers every forwarded call, naming what the path argument names.
        let handle = app.handle().clone();
        app.listen_any("mcp-call", move |event| {
            let request: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
            let id = request["requestId"].as_str().unwrap().to_string();
            let path = request["args"]["path"].as_str().unwrap_or("").to_string();
            // "Projects/leak.md" plays a broken web-view gate: its answer names a note outside the folders.
            let named = if path == "Projects/leak.md" { "Private/b.md".to_string() } else { path.clone() };
            let answer = CallAnswer { content: format!("text of {path}"), is_error: false, paths: vec![named] };
            let state = handle.state::<McpState>();
            let tx = state.lock().calls.remove(&id);
            if let Some(tx) = tx {
                let _ = tx.send(answer);
            }
        });

        let (reply, mut client) = connect(&app, Some("s3cret")).await;
        assert!(reply.ok && reply.secret.is_none(), "{reply:?}");
        let init = initialize(&mut client).await;
        assert_eq!(init["result"]["serverInfo"]["name"], "plainva");

        send(&mut client, serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).await;
        let tools: serde_json::Value = serde_json::from_str(&line(&mut client).await).unwrap();
        assert_eq!(tools["result"]["tools"][0]["name"], "read_note");
        assert_eq!(tools["result"]["tools"][0]["annotations"]["readOnlyHint"], true);

        // The core skills as prompts: listed with their argument, filled in, refused without it.
        assert!(init["result"]["capabilities"]["prompts"].is_object(), "{init}");
        send(&mut client, serde_json::json!({ "jsonrpc": "2.0", "id": 20, "method": "prompts/list" })).await;
        let prompts: serde_json::Value = serde_json::from_str(&line(&mut client).await).unwrap();
        assert_eq!(prompts["result"]["prompts"][0]["name"], "project-status");
        assert_eq!(prompts["result"]["prompts"][0]["arguments"][0]["required"], true);
        send(&mut client, serde_json::json!({ "jsonrpc": "2.0", "id": 21, "method": "prompts/get", "params": { "name": "project-status", "arguments": { "project": "Offer 2026" } } })).await;
        let prompt: serde_json::Value = serde_json::from_str(&line(&mut client).await).unwrap();
        assert_eq!(prompt["result"]["messages"][0]["content"]["text"], "What is the status of the project “Offer 2026”?");
        send(&mut client, serde_json::json!({ "jsonrpc": "2.0", "id": 22, "method": "prompts/get", "params": { "name": "project-status" } })).await;
        let missing: serde_json::Value = serde_json::from_str(&line(&mut client).await).unwrap();
        assert!(missing["error"]["message"].as_str().unwrap_or("").contains("needs the argument project"), "{missing}");

        let inside = call(&mut client, 3, "Projects/a.md").await;
        assert_eq!(inside["result"]["isError"], false);
        assert_eq!(inside["result"]["content"][0]["text"], "text of Projects/a.md");

        // Outside the folders: refused here, before the main window sees it.
        let outside = call(&mut client, 4, "Private/b.md").await;
        assert_eq!(outside["result"]["isError"], true);
        assert_eq!(outside["result"]["content"][0]["text"], handler::NOT_AVAILABLE);
        let traversal = call(&mut client, 5, "Projects/../Private/b.md").await;
        assert_eq!(traversal["result"]["isError"], true);

        // A result that names a note outside the folders is withheld whole.
        let leak = call(&mut client, 6, "Projects/leak.md").await;
        assert_eq!(leak["result"]["isError"], true);
        assert!(!leak.to_string().contains("text of"), "{leak}");

        // Another vault opened: this connection stops answering.
        app.state::<McpState>().lock().generation += 1;
        let stale = call(&mut client, 7, "Projects/a.md").await;
        assert_eq!(stale["result"]["isError"], true);

        let audit = Store::new(dir.path().join("mcp")).audit("vault-key");
        assert_eq!(audit.iter().filter(|a| a.ok).count(), 1);
        assert!(audit.iter().all(|a| a.client_id == "c1" && a.tool == "read_note"));
    }

    #[tokio::test]
    async fn a_new_client_is_paired_once_and_keeps_its_secret() {
        let dir = tempfile::tempdir().unwrap();
        vault(dir.path());
        let app = mock_app(dir.path());
        // The main window's stand-in allows the first question with one folder.
        let handle = app.handle().clone();
        app.listen_any("mcp-pair", move |event| {
            let request: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
            let id = request["requestId"].as_str().unwrap().to_string();
            let state = handle.state::<McpState>();
            let pending = state.lock().pairing.take();
            if let Some((pending_id, tx)) = pending {
                assert_eq!(pending_id, id);
                let _ = tx.send(PairAnswer { allow: true, folders: vec!["Projects".into(), "../Evil".into()] });
            }
        });
        let (reply, _client) = connect(&app, None).await;
        assert!(reply.ok);
        let secret = reply.secret.expect("a new client gets its secret once");
        let store = Store::new(dir.path().join("mcp"));
        let clients = store.clients();
        assert_eq!(clients.clients.len(), 1);
        assert!(!serde_json::to_string(&clients).unwrap().contains(&secret), "only the hash is kept");
        let id = clients.clients[0].id.clone();
        assert_eq!(store.grants("vault-key").folders[&id], vec!["Projects".to_string()], "an unsafe folder is dropped");
        // The next start presents the secret: no question, no new secret.
        let (next, _) = connect(&app, Some(&secret)).await;
        assert!(next.ok && next.secret.is_none());
    }
}
