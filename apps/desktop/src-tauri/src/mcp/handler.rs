//! One MCP connection after its client was admitted (plan KI-Harness §17.3):
//! the tool list the web view registered, calls forwarded to the main window
//! and checked again on the way back, one resource — the format contracts —
//! and the core skills as prompts (plan P1.5).
//! Read-only: the list holds no tool that writes, and a name that is not on
//! it is refused here, before anything reaches the web view.

use std::sync::Arc;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, GetPromptRequestParams, GetPromptResponse, GetPromptResult,
    Implementation, ListPromptsResult, ListResourcesResult, ListToolsResult, PaginatedRequestParams, Prompt, PromptArgument, PromptMessage,
    ReadResourceRequestParams, ReadResourceResponse, ReadResourceResult, Resource, ResourceContents, Role, ServerCapabilities,
    ServerConfig, Tool, ToolAnnotations,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData as McpError, RoleServer, ServerHandler};
use tauri::{AppHandle, Manager, Runtime};

use super::paths;
use super::store::{AuditEntry, ClientRecord};
use super::{now_iso, McpState};

/// The one resource: how Plainva stores what the tools return.
pub const FORMAT_URI: &str = "plainva://format";

/// The format contracts as the handbook states them (English), compiled in.
const FORMAT_REFERENCE: &str = include_str!("../../../../../docs/user/en/File_Format_Reference.md");

/// What a client sees when a path is outside its folders — the same words as
/// a note that does not exist, so a refusal does not reveal that there is one.
pub(crate) const NOT_AVAILABLE: &str = "No note is available at this path.";

pub struct PlainvaMcp<R: Runtime> {
    pub app: AppHandle<R>,
    pub client: ClientRecord,
    pub vault_key: String,
    pub folders: Arc<Vec<String>>,
    /// The server generation this connection was admitted in (see `McpState::generation`).
    pub generation: u64,
}

impl<R: Runtime> PlainvaMcp<R> {
    fn refuse(text: &str) -> CallToolResponse {
        CallToolResult::error(vec![ContentBlock::text(text.to_string())]).into()
    }

    fn audit(&self, tool: &str, ok: bool, notes: usize) {
        let state = self.app.state::<McpState>();
        let entry = AuditEntry { at: now_iso(), client_id: self.client.id.clone(), client: self.client.name.clone(), tool: tool.to_string(), ok, notes };
        let _ = state.store(&self.app).map(|store| store.append_audit(&self.vault_key, &entry));
    }
}

impl<R: Runtime> ServerHandler for PlainvaMcp<R> {
    fn get_info(&self) -> ServerConfig {
        let server = Implementation::new("plainva", env!("CARGO_PKG_VERSION")).with_title("Plainva");
        ServerConfig::new(ServerCapabilities::builder().enable_tools().enable_resources().enable_prompts().build())
            .with_server_info(server)
            .with_instructions(
                "Read-only access to the user's Plainva vault: notes are Markdown files; cite a note as [[Title]]. \
                 Only the folders the user shared with this client are visible. Nothing here can change the vault.",
            )
    }

    async fn list_tools(&self, _request: Option<PaginatedRequestParams>, _context: RequestContext<RoleServer>) -> Result<ListToolsResult, McpError> {
        let state = self.app.state::<McpState>();
        let tools = state
            .tools()
            .into_iter()
            .map(|spec| {
                let schema = match spec.input_schema {
                    serde_json::Value::Object(map) => map,
                    _ => serde_json::Map::new(),
                };
                let mut tool = Tool::new(spec.name, spec.description, Arc::new(schema));
                // Every tool here reads; `open_in_app` only shows a note.
                tool.annotations = Some(ToolAnnotations::new().read_only(true).destructive(false));
                tool
            })
            .collect();
        // The list changes only when the app does: clients may keep it for a while.
        Ok(ListToolsResult::with_all_items(tools).with_ttl_ms(60_000))
    }

    async fn call_tool(&self, request: CallToolRequestParams, _context: RequestContext<RoleServer>) -> Result<CallToolResponse, McpError> {
        let state = self.app.state::<McpState>();
        let name = request.name.to_string();
        // Switched off, or another vault opened since this client was admitted: it asks again.
        if state.generation() != self.generation {
            return Ok(Self::refuse("Plainva's settings or its open vault changed. Restart the connection."));
        }
        let Some(spec) = state.tools().into_iter().find(|t| t.name == name) else {
            self.audit(&name, false, 0);
            return Ok(Self::refuse(&format!("There is no tool called {name}.")));
        };
        let args = request.arguments.unwrap_or_default();
        let Some(root) = state.vault_root() else {
            return Ok(Self::refuse("Plainva has no vault open."));
        };
        // The first wall: a path outside the client's folders — also by way of
        // a link — never reaches the web view.
        for key in &spec.path_args {
            if let Some(value) = args.get(key) {
                let inside = value.as_str().and_then(|raw| paths::allowed(raw, &self.folders));
                if !inside.is_some_and(|rel| paths::real_inside(&root, &rel, &self.folders)) {
                    self.audit(&name, false, 0);
                    return Ok(Self::refuse(NOT_AVAILABLE));
                }
            }
        }
        let answer = match state.forward_call(&self.app, &self.client, &name, serde_json::Value::Object(args), &self.folders).await {
            Ok(answer) => answer,
            Err(message) => {
                self.audit(&name, false, 0);
                return Ok(Self::refuse(&message));
            }
        };
        // The second wall: an answer that names a note outside the folders is refused whole.
        let real = answer.paths.iter().all(|p| paths::real_inside(&root, p, &self.folders));
        if !paths::result_paths_allowed(&answer.paths, &self.folders) || !real {
            self.audit(&name, false, 0);
            return Ok(Self::refuse("The answer could not be checked and was withheld."));
        }
        self.audit(&name, !answer.is_error, answer.paths.len());
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
