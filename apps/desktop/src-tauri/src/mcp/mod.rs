//! Plainva as a read-only MCP server (plan KI-Harness §17.3, P1b; ADR 0022).
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
use std::sync::Mutex;
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
/// How long a plan may take once its client came back for it: the user may still be answering in Plainva.
const PLAN_TIMEOUT: Duration = if cfg!(test) { Duration::from_secs(2) } else { Duration::from_secs(120) };
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
    /// How the tool is served: to whom, and in how many steps.
    #[serde(default)]
    pub kind: ToolKind,
    /// A plan that takes something away (a deletion): announced to the client as destructive.
    #[serde(default)]
    pub destructive: bool,
}

/// How a tool is served (plan KI-Harness §17.3, stage 2).
///
/// - `Read`: answered at once, for every paired client.
/// - `Propose`: a suggestion on a note or a draft — it changes nothing in the
///   vault and is answered at once, but only for a client the user allowed to
///   propose changes in this vault.
/// - `Plan`: a rename, a move, a deletion. The first call lays the plan before
///   the user in the main window and answers that input is required; nothing
///   is carried out before the client comes back with that request state AND
///   the user said yes in Plainva. What the client itself puts into its
///   answer approves nothing.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ToolKind {
    #[default]
    Read,
    Propose,
    Plan,
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
    /// A plan the user is being asked about in the main window (stage 2): the
    /// call did nothing yet, and the client is told that input is required.
    #[serde(default)]
    pub pending: Option<PendingPlan>,
    /// The user — or the client's own user — said no to a plan.
    #[serde(default)]
    pub declined: bool,
}

/// A plan that waits for the user's answer in the main window.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingPlan {
    /// What the client brings back with its next call. Opaque to it, and a
    /// handle only: what it stands for is kept in the main window.
    pub handle: String,
    /// One sentence for the client's own user: what waits in Plainva.
    pub message: String,
}

/// What a call brings beside its arguments (stage 2).
#[derive(Default, Clone)]
pub(crate) struct CallExtra {
    /// The client may propose changes in this vault — checked here, at this call.
    pub writes: bool,
    /// The request state of a plan the client comes back with.
    pub handle: Option<String>,
    /// What the client's own user answered to the note that input is required: `accept`, `decline` or `cancel`.
    pub answer: Option<String>,
}

struct PairAnswer {
    allow: bool,
    folders: Vec<String>,
    /// The client may propose changes in this vault; off unless the user ticked it.
    writes: bool,
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
    /// The client may propose changes in this vault (checked natively at this call).
    writes: bool,
    /// The request state of a plan the client comes back with.
    #[serde(skip_serializing_if = "Option::is_none")]
    handle: Option<String>,
    /// What the client's own user answered: `accept`, `decline` or `cancel`.
    #[serde(skip_serializing_if = "Option::is_none")]
    answer: Option<String>,
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

/// A question waits in the main window while the user looks at the program
/// that asked. The window says so in the taskbar or the dock; it does not
/// come to the front by itself.
pub(crate) fn hint_at_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
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

    /// What a client may do in a vault now: the folders it reads, and whether
    /// it may propose changes there. Read from the store at every request —
    /// what the user changed or took back in Plainva holds at once, also for a
    /// connection that is already open. No folders: the client has no place
    /// in this vault (any more).
    pub(crate) fn grant<R: Runtime>(&self, app: &AppHandle<R>, vault_key: &str, client_id: &str) -> (Vec<String>, bool) {
        let Ok(store) = self.store(app) else {
            return (Vec::new(), false);
        };
        let grants = store.grants(vault_key);
        (grants.folders.get(client_id).cloned().unwrap_or_default(), grants.may_write(client_id))
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
        extra: CallExtra,
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
            writes: extra.writes,
            handle: extra.handle,
            answer: extra.answer,
        };
        // A plan the client comes back for may wait for the user: the app's own delete dialog is theirs to answer.
        let limit = if request.handle.is_some() { PLAN_TIMEOUT } else { CALL_TIMEOUT };
        if app.emit_to("main", "mcp-call", request).is_err() {
            self.lock().calls.remove(&request_id);
            return Err("Plainva could not reach its window.".into());
        }
        match tokio::time::timeout(limit, rx).await {
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
        hint_at_main(app);
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
        // Proposing changes is its own answer in the same dialog, and off unless it was ticked there.
        if answer.writes {
            grants.writes.insert(client.id.clone());
        } else {
            grants.writes.remove(&client.id);
        }
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
    // The folders a client is admitted with are not kept: every request asks what it may do now.
    let (client, _folders, secret) = match state.admit(&app, &hello).await {
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
    let handler = handler::PlainvaMcp { app: app.clone(), client, vault_key, generation };
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
    /// May propose changes in the vault open now.
    writes: bool,
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
            writes: grants.may_write(&c.id),
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
pub fn mcp_pair_answer(window: tauri::Window, state: tauri::State<'_, McpState>, request_id: String, allow: bool, folders: Vec<String>, writes: Option<bool>) -> Result<(), String> {
    only_main(&window)?;
    let pending = state.lock().pairing.take();
    match pending {
        Some((id, tx)) if id == request_id => {
            let _ = tx.send(PairAnswer { allow, folders, writes: allow && writes.unwrap_or(false) });
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
        // A client that reads nothing proposes nothing.
        grants.writes.remove(&client_id);
        grants.folders.remove(&client_id);
    } else {
        grants.folders.insert(client_id, clean);
    }
    store.save_grants(&vault.key, &grants)
}

/// Whether a client may propose changes in the vault open now (stage 2). It
/// holds from the client's next call on, also on a connection that is open;
/// the list of tools it sees follows when it asks for the list again.
#[tauri::command]
pub fn mcp_set_writes(app: AppHandle, window: tauri::Window, state: tauri::State<'_, McpState>, client_id: String, allowed: bool) -> Result<(), String> {
    only_main(&window)?;
    let vault = state.lock().vault.clone().ok_or("no vault is open")?;
    let store = state.store(&app)?;
    let mut grants = store.grants(&vault.key);
    if allowed {
        // Only for a client that reads here: writing without reading is no grant the dialog can give.
        if grants.folders.get(&client_id).is_none_or(|folders| folders.is_empty()) {
            return Err("this client reads nothing in this vault".into());
        }
        grants.writes.insert(client_id);
    } else {
        grants.writes.remove(&client_id);
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
        "description": "Access to your Plainva vault: search, read, outlines, backlinks, databases, tasks. Where you allow it in Plainva, it can also propose changes — nothing changes until you accept them there. Plainva must be running.",
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
    use std::sync::Arc;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::Listener;
    use tokio::io::DuplexStream;

    fn mock_app(dir: &std::path::Path) -> tauri::App<MockRuntime> {
        let app = mock_builder().manage(McpState::default()).build(mock_context(noop_assets())).unwrap();
        let state = app.state::<McpState>();
        *state.store_dir.lock().unwrap() = Some(dir.join("mcp"));
        let mut inner = state.lock();
        inner.vault = Some(VaultBinding { key: "vault-key".into(), name: "Vault".into(), root: dir.join("vault").to_string_lossy().to_string() });
        let tool = |name: &str, kind: ToolKind, destructive: bool| ToolSpec {
            name: name.into(),
            description: format!("{name} of a note"),
            input_schema: serde_json::json!({ "type": "object", "properties": { "path": { "type": "string" }, "folder": { "type": "string" } } }),
            path_args: vec!["path".into(), "folder".into()],
            kind,
            destructive,
        };
        inner.tools = vec![
            tool("read_note", ToolKind::Read, false),
            tool("propose_edit", ToolKind::Propose, false),
            tool("rename_note", ToolKind::Plan, false),
            tool("move_note", ToolKind::Plan, false),
            tool("delete_note", ToolKind::Plan, true),
        ];
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
            let answer = CallAnswer { content: format!("text of {path}"), is_error: false, paths: vec![named], pending: None, declined: false };
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
        // A client that was only given folders to read sees the tools that read, and no other.
        assert_eq!(names(&tools), vec!["read_note"]);
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
                let _ = tx.send(PairAnswer { allow: true, folders: vec!["Projects".into(), "../Evil".into()], writes: false });
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
        assert!(!store.grants("vault-key").may_write(&id), "folders to read are no leave to propose changes");
        // The next start presents the secret: no question, no new secret.
        let (next, _) = connect(&app, Some(&secret)).await;
        assert!(next.ok && next.secret.is_none());
    }

    #[tokio::test]
    async fn the_pairing_answer_grants_proposing_only_when_it_says_so() {
        let dir = tempfile::tempdir().unwrap();
        vault(dir.path());
        let app = mock_app(dir.path());
        let handle = app.handle().clone();
        app.listen_any("mcp-pair", move |_event| {
            let state = handle.state::<McpState>();
            let pending = state.lock().pairing.take();
            if let Some((_, tx)) = pending {
                let _ = tx.send(PairAnswer { allow: true, folders: vec!["Projects".into()], writes: true });
            }
        });
        let (reply, _client) = connect(&app, None).await;
        assert!(reply.ok);
        let store = Store::new(dir.path().join("mcp"));
        let id = store.clients().clients[0].id.clone();
        assert!(store.grants("vault-key").may_write(&id));
        assert!(!store.grants("another-vault").may_write(&id), "a grant is this vault's");
    }

    // --- stage 2: a client may propose changes (plan KI-Harness §17.3, P5-5) ---------------------------

    /// The main window's stand-in: keeps what was forwarded, answers a plan as waiting until the client
    /// comes back with the handle and its user's yes, and everything else as done.
    fn stand_in(app: &tauri::App<MockRuntime>) -> Arc<Mutex<Vec<serde_json::Value>>> {
        let seen: Arc<Mutex<Vec<serde_json::Value>>> = Arc::default();
        let log = seen.clone();
        let handle = app.handle().clone();
        app.listen_any("mcp-call", move |event| {
            let request: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
            log.lock().unwrap().push(request.clone());
            let id = request["requestId"].as_str().unwrap().to_string();
            let tool = request["tool"].as_str().unwrap_or("").to_string();
            let path = request["args"]["path"].as_str().unwrap_or("").to_string();
            let plan = matches!(tool.as_str(), "rename_note" | "move_note" | "delete_note");
            let answer = if plan && request["handle"].is_null() {
                let pending = PendingPlan { handle: "h-0123456789abcdef".into(), message: "Confirm in Plainva:\u{7} rename a.".into() };
                CallAnswer { content: String::new(), is_error: false, paths: vec![path], pending: Some(pending), declined: false }
            } else if plan && request["answer"] != "accept" {
                CallAnswer { content: "The user did not allow this.".into(), is_error: true, paths: vec![], pending: None, declined: true }
            } else {
                CallAnswer { content: format!("{tool} done for {path}"), is_error: false, paths: vec![path], pending: None, declined: false }
            };
            let state = handle.state::<McpState>();
            let tx = state.lock().calls.remove(&id);
            if let Some(tx) = tx {
                let _ = tx.send(answer);
            }
        });
        seen
    }

    fn set_writes(dir: &std::path::Path, allowed: bool) {
        let store = Store::new(dir.join("mcp"));
        let mut grants = store.grants("vault-key");
        if allowed {
            grants.writes.insert("c1".into());
        } else {
            grants.writes.remove("c1");
        }
        store.save_grants("vault-key", &grants).unwrap();
    }

    /// A request as a client of the protocol 2026-07-28 sends it: there is no handshake, and what the
    /// client can do rides on every request.
    fn recent(id: u64, method: &str, mut params: serde_json::Value, asks_its_user: bool) -> serde_json::Value {
        let capabilities = if asks_its_user { serde_json::json!({ "elicitation": {} }) } else { serde_json::json!({}) };
        params["_meta"] = serde_json::json!({
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": { "name": "Test client", "version": "1" },
            "io.modelcontextprotocol/clientCapabilities": capabilities,
        });
        serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
    }

    async fn ask(client: &mut DuplexStream, request: serde_json::Value) -> serde_json::Value {
        send(client, request).await;
        serde_json::from_str(&line(client).await).unwrap()
    }

    fn names(list: &serde_json::Value) -> Vec<String> {
        list["result"]["tools"].as_array().map(|tools| tools.iter().map(|t| t["name"].as_str().unwrap_or("").to_string()).collect()).unwrap_or_default()
    }

    fn old_call(id: u64, tool: &str, path: &str) -> serde_json::Value {
        serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": tool, "arguments": { "path": path } } })
    }

    #[tokio::test]
    async fn a_tool_that_writes_exists_only_for_a_client_the_user_allowed() {
        let dir = tempfile::tempdir().unwrap();
        vault(dir.path());
        pair(dir.path(), "s3cret");
        let app = mock_app(dir.path());
        let seen = stand_in(&app);
        let (reply, mut client) = connect(&app, Some("s3cret")).await;
        assert!(reply.ok);
        initialize(&mut client).await;

        // Not allowed: a call by name finds no such tool — in the words of a tool that does not exist —,
        // and nothing reaches the main window.
        let refused = ask(&mut client, old_call(3, "propose_edit", "Projects/a.md")).await;
        assert_eq!(refused["result"]["isError"], true);
        assert_eq!(refused["result"]["content"][0]["text"], "There is no tool called propose_edit.");
        let unknown = ask(&mut client, old_call(4, "nonsense", "Projects/a.md")).await;
        assert_eq!(unknown["result"]["content"][0]["text"], "There is no tool called nonsense.");
        assert!(seen.lock().unwrap().is_empty());

        // Allowed in Plainva: the open connection gets the tool with its next list, and a call goes on with the grant.
        set_writes(dir.path(), true);
        let list = ask(&mut client, serde_json::json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/list" })).await;
        // A client of the older protocol could not come back with an answer: no plan is a tool of it.
        assert_eq!(names(&list), vec!["read_note", "propose_edit"]);
        assert_eq!(list["result"]["tools"][1]["annotations"]["readOnlyHint"], false);
        assert_eq!(list["result"]["tools"][1]["annotations"]["destructiveHint"], false);
        let done = ask(&mut client, old_call(6, "propose_edit", "Projects/a.md")).await;
        assert_eq!(done["result"]["isError"], false, "{done}");
        assert_eq!(done["result"]["content"][0]["text"], "propose_edit done for Projects/a.md");
        {
            let forwarded = seen.lock().unwrap();
            assert_eq!(forwarded.len(), 1);
            assert_eq!(forwarded[0]["writes"], true);
            assert_eq!(forwarded[0]["clientId"], "c1");
        }
        // Outside its folders a note does not exist for writing either.
        let outside = ask(&mut client, old_call(7, "propose_edit", "Private/b.md")).await;
        assert_eq!(outside["result"]["content"][0]["text"], handler::NOT_AVAILABLE);
        let plan = ask(&mut client, old_call(8, "rename_note", "Projects/a.md")).await;
        assert_eq!(plan["result"]["content"][0]["text"], "There is no tool called rename_note.");
        assert_eq!(seen.lock().unwrap().len(), 1);

        // Taken back: it holds at the very next call of the connection that is open.
        set_writes(dir.path(), false);
        let after = ask(&mut client, old_call(9, "propose_edit", "Projects/a.md")).await;
        assert_eq!(after["result"]["content"][0]["text"], "There is no tool called propose_edit.");
        assert_eq!(seen.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn what_the_user_takes_back_holds_on_a_connection_that_is_open() {
        let dir = tempfile::tempdir().unwrap();
        vault(dir.path());
        pair(dir.path(), "s3cret");
        let app = mock_app(dir.path());
        let seen = stand_in(&app);
        let (reply, mut client) = connect(&app, Some("s3cret")).await;
        assert!(reply.ok);
        initialize(&mut client).await;
        let inside = call(&mut client, 2, "Projects/a.md").await;
        assert_eq!(inside["result"]["isError"], false, "{inside}");

        // Other folders, chosen in Plainva: the connection reads those from its next call on, and the old ones no more.
        let store = Store::new(dir.path().join("mcp"));
        let mut grants = store.grants("vault-key");
        grants.folders.insert("c1".into(), vec!["Private".into()]);
        store.save_grants("vault-key", &grants).unwrap();
        let old = call(&mut client, 3, "Projects/a.md").await;
        assert_eq!(old["result"]["content"][0]["text"], handler::NOT_AVAILABLE);
        let new = call(&mut client, 4, "Private/b.md").await;
        assert_eq!(new["result"]["isError"], false, "{new}");
        assert_eq!(seen.lock().unwrap().last().unwrap()["folders"], serde_json::json!(["Private"]));

        // Revoked: nothing is read any more, nothing reaches the main window, and no tool is listed.
        store.revoke("c1").unwrap();
        let gone = call(&mut client, 5, "Private/b.md").await;
        assert_eq!(gone["result"]["isError"], true);
        assert_eq!(gone["result"]["content"][0]["text"], handler::NO_ACCESS);
        let list = ask(&mut client, serde_json::json!({ "jsonrpc": "2.0", "id": 6, "method": "tools/list" })).await;
        assert!(names(&list).is_empty(), "{list}");
        assert_eq!(seen.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn a_plan_is_carried_out_only_by_the_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        vault(dir.path());
        pair(dir.path(), "s3cret");
        set_writes(dir.path(), true);
        let app = mock_app(dir.path());
        let seen = stand_in(&app);
        let (reply, mut client) = connect(&app, Some("s3cret")).await;
        assert!(reply.ok);
        let rename = |state: Option<&str>, responses: Option<serde_json::Value>| {
            let mut params = serde_json::json!({ "name": "rename_note", "arguments": { "path": "Projects/a.md" } });
            if let Some(state) = state {
                params["requestState"] = serde_json::json!(state);
            }
            if let Some(responses) = responses {
                params["inputResponses"] = responses;
            }
            params
        };
        let yes = || Some(serde_json::json!({ "confirm": { "action": "accept", "content": {} } }));

        let list = ask(&mut client, recent(1, "tools/list", serde_json::json!({}), true)).await;
        assert_eq!(names(&list), vec!["read_note", "propose_edit", "rename_note", "move_note", "delete_note"], "{list}");
        assert_eq!(list["result"]["tools"][2]["annotations"]["destructiveHint"], false);
        assert_eq!(list["result"]["tools"][4]["annotations"]["destructiveHint"], true);

        // A client that cannot ask its own user has no way to come back with an answer: no plan is a tool of it.
        let mute = ask(&mut client, recent(2, "tools/list", serde_json::json!({}), false)).await;
        assert_eq!(names(&mute), vec!["read_note", "propose_edit"]);
        let refused = ask(&mut client, recent(3, "tools/call", rename(None, None), false)).await;
        assert_eq!(refused["result"]["content"][0]["text"], "There is no tool called rename_note.");
        assert!(seen.lock().unwrap().is_empty());

        // First call: the user is asked in Plainva, the client is told that input is required — nothing is done.
        let first = ask(&mut client, recent(4, "tools/call", rename(None, None), true)).await;
        assert_eq!(first["result"]["resultType"], "input_required", "{first}");
        assert_eq!(first["result"]["requestState"], "h-0123456789abcdef");
        let note = &first["result"]["inputRequests"]["confirm"];
        assert_eq!(note["method"], "elicitation/create", "{first}");
        // The sentence for the client's own user carries no control character.
        assert_eq!(note["params"]["message"], "Confirm in Plainva:  rename a.");
        assert_eq!(seen.lock().unwrap().len(), 1);
        assert!(seen.lock().unwrap()[0]["handle"].is_null());

        // Coming back with the state alone is not having asked: told again, and the main window hears nothing.
        let bare = ask(&mut client, recent(5, "tools/call", rename(Some("h-0123456789abcdef"), None), true)).await;
        assert_eq!(bare["result"]["resultType"], "input_required", "{bare}");
        assert_eq!(bare["result"]["requestState"], "h-0123456789abcdef");
        assert_eq!(seen.lock().unwrap().len(), 1);

        // A state this side never handed out is none.
        let forged = ask(&mut client, recent(6, "tools/call", rename(Some("../../x"), yes()), true)).await;
        assert_eq!(forged["result"]["content"][0]["text"], handler::NOT_WAITING, "{forged}");
        assert_eq!(seen.lock().unwrap().len(), 1);

        // With its user's answer the call goes on, carrying the handle and the answer — which the main window judges.
        let second = ask(&mut client, recent(7, "tools/call", rename(Some("h-0123456789abcdef"), yes()), true)).await;
        assert_eq!(second["result"]["isError"], false, "{second}");
        assert_eq!(second["result"]["content"][0]["text"], "rename_note done for Projects/a.md");
        {
            let forwarded = seen.lock().unwrap();
            assert_eq!(forwarded.len(), 2);
            assert_eq!(forwarded[1]["handle"], "h-0123456789abcdef");
            assert_eq!(forwarded[1]["answer"], "accept");
        }

        // The client's own user said no: the main window is told, and the audit says so.
        let mut delete = serde_json::json!({ "name": "delete_note", "arguments": { "path": "Projects/a.md" } });
        delete["requestState"] = serde_json::json!("h-0123456789abcdef");
        delete["inputResponses"] = serde_json::json!({ "confirm": { "action": "decline" } });
        let declined = ask(&mut client, recent(8, "tools/call", delete, true)).await;
        assert_eq!(declined["result"]["isError"], true, "{declined}");
        assert_eq!(seen.lock().unwrap()[2]["answer"], "decline");

        // A move names its target: a folder outside the client's is no place, and the vault itself only
        // for a client that was given all of it.
        let to = |folder: &str| serde_json::json!({ "name": "move_note", "arguments": { "path": "Projects/a.md", "folder": folder } });
        let outside = ask(&mut client, recent(9, "tools/call", to("Private"), true)).await;
        assert_eq!(outside["result"]["content"][0]["text"], handler::NOT_AVAILABLE);
        let root = ask(&mut client, recent(10, "tools/call", to(""), true)).await;
        assert_eq!(root["result"]["content"][0]["text"], handler::NOT_AVAILABLE);
        assert_eq!(seen.lock().unwrap().len(), 3);

        let audit = Store::new(dir.path().join("mcp")).audit("vault-key");
        let said: Vec<(&str, bool, Option<&str>)> = audit.iter().map(|a| (a.tool.as_str(), a.ok, a.note.as_deref())).collect();
        assert!(said.contains(&("rename_note", false, Some("asked"))), "{said:?}");
        assert!(said.contains(&("rename_note", true, None)), "{said:?}");
        assert!(said.contains(&("delete_note", false, Some("declined"))), "{said:?}");
    }
}
