//! One MCP connection after its client was admitted (plan KI-Harness §17.3):
//! the tool list the web view registered, calls forwarded to the main window
//! and checked again on the way back, one resource — the format contracts —
//! and the core skills as prompts (plan P1.5).
//!
//! Every client reads. A tool that writes is on the list only for a client
//! the user allowed to propose changes in this vault, and that is asked again
//! at every call: a name that is not on this client's list is refused here,
//! before anything reaches the web view. What such a tool does changes
//! nothing in the vault — it leaves a suggestion on a note or a draft — and a
//! rename, a move or a deletion goes by the round trip of the protocol
//! (`input_required`): the first call only asks the user in Plainva, and
//! nothing is carried out before the client comes back with its user's
//! answer and the request state this side handed out.

use std::sync::Arc;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, ElicitRequest, ElicitRequestParams, GetPromptRequestParams,
    GetPromptResponse, GetPromptResult, Implementation, InputRequest, InputRequests, InputRequiredResult, ListPromptsResult,
    ListResourcesResult, ListToolsResult, PaginatedRequestParams, Prompt, PromptArgument, PromptMessage, ProtocolVersion,
    ReadResourceRequestParams, ReadResourceResponse, ReadResourceResult, Resource, ResourceContents, Role, ServerCapabilities,
    ServerConfig, Tool, ToolAnnotations,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData as McpError, RoleServer, ServerHandler};
use tauri::{AppHandle, Manager, Runtime};

use super::paths;
use super::store::{AuditEntry, ClientRecord};
use super::{now_iso, CallExtra, McpState, PendingPlan, ToolKind};

/// The key of the one input request a plan sends: the note that it waits in Plainva.
pub(crate) const CONFIRM_KEY: &str = "confirm";

/// What a client is told about a tool that is not on its list — a tool that
/// does not exist, and one it was not given: the same words for both.
fn no_tool(name: &str) -> String {
    format!("There is no tool called {name}.")
}

/// What a client is told when it comes back with a request state this side
/// does not know (any more).
pub(crate) const NOT_WAITING: &str = "This request is not waiting in Plainva any more. Call the tool again.";

/// A request state as this side hands it out: a random handle, nothing a client could have composed.
fn clean_handle(raw: &str) -> Option<String> {
    let ok = (16..=64).contains(&raw.len()) && raw.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then(|| raw.to_string())
}

/// One line for the client's own user: no control characters, and short.
fn clean_message(raw: &str) -> String {
    raw.chars().map(|c| if c.is_control() { ' ' } else { c }).take(600).collect::<String>().trim().to_string()
}

/// The one resource: how Plainva stores what the tools return.
pub const FORMAT_URI: &str = "plainva://format";

/// The format contracts as the handbook states them (English), compiled in.
const FORMAT_REFERENCE: &str = include_str!("../../../../../docs/user/en/File_Format_Reference.md");

/// What a client sees when a path is outside its folders — the same words as
/// a note that does not exist, so a refusal does not reveal that there is one.
pub(crate) const NOT_AVAILABLE: &str = "No note is available at this path.";

/// What a client is told once the user took its access to this vault back,
/// while its connection is still open.
pub(crate) const NO_ACCESS: &str = "This client has no access to this vault any more. Restart the connection to ask for it again.";

pub struct PlainvaMcp<R: Runtime> {
    pub app: AppHandle<R>,
    pub client: ClientRecord,
    pub vault_key: String,
    /// The server generation this connection was admitted in (see `McpState::generation`).
    pub generation: u64,
}

impl<R: Runtime> PlainvaMcp<R> {
    fn refuse(text: &str) -> CallToolResponse {
        CallToolResult::error(vec![ContentBlock::text(text.to_string())]).into()
    }

    fn audit(&self, tool: &str, ok: bool, notes: usize) {
        self.audit_note(tool, ok, notes, None);
    }

    fn audit_note(&self, tool: &str, ok: bool, notes: usize, note: Option<&str>) {
        let state = self.app.state::<McpState>();
        let entry = AuditEntry {
            at: now_iso(),
            client_id: self.client.id.clone(),
            client: self.client.name.clone(),
            tool: tool.to_string(),
            ok,
            notes,
            note: note.map(str::to_string),
        };
        let _ = state.store(&self.app).map(|store| store.append_audit(&self.vault_key, &entry));
    }

    /// Whether this request can do the round trip a plan needs: the protocol
    /// that has it (2026-07-28 or newer), and a client that says it can ask
    /// its user (elicitation, form mode). Without both, a plan is no tool of
    /// this client — it would have no way to come back with an answer.
    fn can_confirm(context: &RequestContext<RoleServer>) -> bool {
        let recent = context.protocol_version().is_some_and(|v| v.as_str() >= ProtocolVersion::V_2026_07_28.as_str());
        let asks = context
            .client_capabilities()
            .and_then(|capabilities| capabilities.elicitation)
            // An empty capability means the form mode; one that names only the URL mode has no form.
            .is_some_and(|elicitation| elicitation.form.is_some() || elicitation.url.is_none());
        recent && asks
    }

    /// The answer to a plan that waits: input is required — the note for the
    /// client's own user, and the handle it has to bring back.
    fn input_required(pending: &PendingPlan) -> Option<CallToolResponse> {
        let handle = clean_handle(&pending.handle)?;
        // A form without fields: the client shows the sentence and takes a yes or a no.
        let schema = serde_json::from_value(serde_json::json!({ "type": "object", "properties": {} })).ok()?;
        let mut requests = InputRequests::new();
        requests.insert(
            CONFIRM_KEY.to_string(),
            InputRequest::Elicitation(ElicitRequest::new(ElicitRequestParams::FormElicitationParams { meta: None, message: clean_message(&pending.message), requested_schema: schema })),
        );
        Some(InputRequiredResult::new(Some(requests), Some(handle)).into())
    }
}

impl<R: Runtime> ServerHandler for PlainvaMcp<R> {
    fn get_info(&self) -> ServerConfig {
        let server = Implementation::new("plainva", env!("CARGO_PKG_VERSION")).with_title("Plainva");
        ServerConfig::new(ServerCapabilities::builder().enable_tools().enable_resources().enable_prompts().build())
            .with_server_info(server)
            .with_instructions(
                "Access to the user's Plainva vault: notes are Markdown files; cite a note as [[Title]]. \
                 Only the folders the user shared with this client are visible. Nothing here changes the vault by itself: \
                 where the user allowed this client to propose changes, a tool that writes leaves a suggestion on a note or a draft, \
                 which the user accepts in Plainva, and a rename, a move or a deletion first asks the user there.",
            )
    }

    async fn list_tools(&self, _request: Option<PaginatedRequestParams>, context: RequestContext<RoleServer>) -> Result<ListToolsResult, McpError> {
        let state = self.app.state::<McpState>();
        // What a client may do is asked when it asks: a grant the user took back is gone from its next list,
        // and a client whose access was taken back has no tools at all.
        let (folders, writes) = state.grant(&self.app, &self.vault_key, &self.client.id);
        let reads = !folders.is_empty();
        let plans = writes && Self::can_confirm(&context);
        let tools = state
            .tools()
            .into_iter()
            .filter(|spec| match spec.kind {
                ToolKind::Read => reads,
                ToolKind::Propose => reads && writes,
                ToolKind::Plan => reads && plans,
            })
            .map(|spec| {
                let schema = match spec.input_schema {
                    serde_json::Value::Object(map) => map,
                    _ => serde_json::Map::new(),
                };
                let mut tool = Tool::new(spec.name, spec.description, Arc::new(schema));
                tool.annotations = Some(match spec.kind {
                    // Every tool here reads; `open_in_app` only shows a note.
                    ToolKind::Read => ToolAnnotations::new().read_only(true).destructive(false),
                    // A suggestion or a draft changes nothing; a plan changes the vault only after the user's yes —
                    // and only a deletion takes something away.
                    ToolKind::Propose | ToolKind::Plan => ToolAnnotations::new().read_only(false).destructive(spec.destructive),
                });
                tool
            })
            .collect();
        // The list changes only when the app or a grant does: clients may keep it for a while.
        Ok(ListToolsResult::with_all_items(tools).with_ttl_ms(60_000))
    }

    async fn call_tool(&self, request: CallToolRequestParams, context: RequestContext<RoleServer>) -> Result<CallToolResponse, McpError> {
        let state = self.app.state::<McpState>();
        let name = request.name.to_string();
        // Switched off, or another vault opened since this client was admitted: it asks again.
        if state.generation() != self.generation {
            return Ok(Self::refuse("Plainva's settings or its open vault changed. Restart the connection."));
        }
        // What this client may do here is asked at this call, whatever it was admitted with and whatever
        // list it still holds: its folders, and whether it may propose changes.
        let (folders, may_write) = state.grant(&self.app, &self.vault_key, &self.client.id);
        if folders.is_empty() {
            self.audit(&name, false, 0);
            return Ok(Self::refuse(NO_ACCESS));
        }
        let Some(spec) = state.tools().into_iter().find(|t| t.name == name) else {
            self.audit(&name, false, 0);
            return Ok(Self::refuse(&no_tool(&name)));
        };
        // A tool that writes is a tool of this client only while the user allows it to propose changes here.
        // Refused like a tool that does not exist.
        let writes = spec.kind != ToolKind::Read && may_write;
        if spec.kind != ToolKind::Read && !writes {
            self.audit(&name, false, 0);
            return Ok(Self::refuse(&no_tool(&name)));
        }
        if spec.kind == ToolKind::Plan && !Self::can_confirm(&context) {
            self.audit(&name, false, 0);
            return Ok(Self::refuse(&no_tool(&name)));
        }
        let mut extra = CallExtra { writes, handle: None, answer: None };
        if spec.kind == ToolKind::Plan {
            if let Some(state_text) = request.request_state.as_deref() {
                // Only a state this side handed out comes back; anything else is no state.
                let Some(handle) = clean_handle(state_text) else {
                    self.audit(&name, false, 0);
                    return Ok(Self::refuse(NOT_WAITING));
                };
                // What the client's own user said to the note that input is required. A client that comes
                // back without it has not asked: it is told again, and nothing reaches the main window.
                let answer = request
                    .input_responses
                    .as_ref()
                    .and_then(|responses| responses.get(CONFIRM_KEY))
                    .and_then(|response| response.get("action"))
                    .and_then(|action| action.as_str())
                    .filter(|action| matches!(*action, "accept" | "decline" | "cancel"))
                    .map(str::to_string);
                if answer.is_none() {
                    let again = PendingPlan { handle, message: "Plainva is waiting for your answer. Confirm or decline it there, then continue here.".into() };
                    return Ok(Self::input_required(&again).unwrap_or_else(|| Self::refuse(NOT_WAITING)));
                }
                extra.handle = Some(handle);
                extra.answer = answer;
            }
        }
        let args = request.arguments.unwrap_or_default();
        let Some(root) = state.vault_root() else {
            return Ok(Self::refuse("Plainva has no vault open."));
        };
        // The first wall: a path outside the client's folders — also by way of
        // a link — never reaches the web view.
        for key in &spec.path_args {
            if let Some(value) = args.get(key) {
                let inside = match value.as_str() {
                    // An empty folder names the vault itself (where a note is moved to): a place only for a
                    // client that was given the whole vault.
                    Some("") if key == "folder" => folders.iter().any(|folder| folder.trim_matches('/').is_empty()).then(String::new),
                    Some(raw) => paths::allowed(raw, &folders),
                    None => None,
                };
                if !inside.is_some_and(|rel| rel.is_empty() || paths::real_inside(&root, &rel, &folders)) {
                    self.audit(&name, false, 0);
                    return Ok(Self::refuse(NOT_AVAILABLE));
                }
            }
        }
        let answer = match state.forward_call(&self.app, &self.client, &name, serde_json::Value::Object(args), &folders, extra).await {
            Ok(answer) => answer,
            Err(message) => {
                self.audit(&name, false, 0);
                return Ok(Self::refuse(&message));
            }
        };
        // The second wall: an answer that names a note outside the folders is refused whole.
        let real = answer.paths.iter().all(|p| paths::real_inside(&root, p, &folders));
        if !paths::result_paths_allowed(&answer.paths, &folders) || !real {
            self.audit(&name, false, 0);
            return Ok(Self::refuse("The answer could not be checked and was withheld."));
        }
        // A plan the user is being asked about: the client is told that input is required. Only a plan
        // may wait — from any other tool it would mean the web view lost its way, and the answer is withheld.
        if let Some(pending) = &answer.pending {
            let waits = if spec.kind == ToolKind::Plan { Self::input_required(pending) } else { None };
            return Ok(match waits {
                Some(response) => {
                    self.audit_note(&name, false, 0, Some("asked"));
                    super::hint_at_main(&self.app);
                    response
                }
                None => {
                    self.audit(&name, false, 0);
                    Self::refuse("The answer could not be checked and was withheld.")
                }
            });
        }
        if answer.declined {
            self.audit_note(&name, false, 0, Some("declined"));
        } else {
            self.audit(&name, !answer.is_error, answer.paths.len());
        }
        let text = paths::strip_local_urls(&answer.content);
        let result = if answer.is_error { CallToolResult::error(vec![ContentBlock::text(text)]) } else { CallToolResult::success(vec![ContentBlock::text(text)]) };
        Ok(result.into())
    }

    async fn list_prompts(&self, _request: Option<PaginatedRequestParams>, _context: RequestContext<RoleServer>) -> Result<ListPromptsResult, McpError> {
        let prompts = self
            .app
            .state::<McpState>()
            .prompts()
            .into_iter()
            .map(|spec| {
                let arguments = spec.argument.map(|a| vec![PromptArgument::new(a.name).with_description(a.description).with_required(true)]);
                Prompt::new(spec.name, Some(spec.description), arguments).with_title(spec.title)
            })
            .collect();
        Ok(ListPromptsResult::with_all_items(prompts))
    }

    async fn get_prompt(&self, request: GetPromptRequestParams, _context: RequestContext<RoleServer>) -> Result<GetPromptResponse, McpError> {
        let state = self.app.state::<McpState>();
        if state.generation() != self.generation {
            return Err(McpError::invalid_request("Plainva's settings or its open vault changed. Restart the connection.", None));
        }
        let Some(spec) = state.prompts().into_iter().find(|p| p.name == request.name) else {
            return Err(McpError::invalid_params(format!("There is no prompt called {}.", request.name), None));
        };
        let text = spec.render(request.arguments.as_ref()).map_err(|message| McpError::invalid_params(message, None))?;
        Ok(GetPromptResult::new(vec![PromptMessage::new_text(Role::User, text)]).with_description(spec.description).into())
    }

    async fn list_resources(&self, _request: Option<PaginatedRequestParams>, _context: RequestContext<RoleServer>) -> Result<ListResourcesResult, McpError> {
        let resource = Resource::new(FORMAT_URI, "format")
            .with_title("How Plainva stores notes")
            .with_description("The file format: frontmatter, the plainva namespace, databases (.base), links and what a tool must never touch.")
            .with_mime_type("text/markdown");
        Ok(ListResourcesResult::with_all_items(vec![resource]).with_ttl_ms(3_600_000))
    }

    async fn read_resource(&self, request: ReadResourceRequestParams, _context: RequestContext<RoleServer>) -> Result<ReadResourceResponse, McpError> {
        if request.uri != FORMAT_URI {
            return Err(McpError::resource_not_found(format!("unknown resource {}", request.uri), None));
        }
        Ok(ReadResourceResult::new(vec![ResourceContents::text(FORMAT_REFERENCE, FORMAT_URI)]).into())
    }
}
