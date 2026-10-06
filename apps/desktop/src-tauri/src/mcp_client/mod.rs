//! Foreign MCP servers, the native side (plan KI-Harness P4.5).
//!
//! Plainva's assistant can use tools of servers the user added: a remote
//! service, or a program on this computer. The protocol is spoken in the web
//! view (packages/core/src/ai/mcp). This module is everything the web view
//! must not be able to do on its own:
//!
//! 1. **Where a request goes.** The address of a remote server and the command
//!    line of a program live in a registry in the app data folder. It grows
//!    only through a native dialog that shows the exact address or the exact
//!    command. A request and a start name a server id, never a URL or a program
//!    (`registry.rs`).
//! 2. **Credentials.** A server's token and the values a program gets in its
//!    environment live in the keychain, in slots the generic commands refuse.
//!    They go into a request or a process here and never back.
//! 3. **The request.** https — plain http only to this device —, no redirect
//!    followed, protocol headers from a fixed list, the answer cut (`http.rs`).
//! 4. **The process.** Started without a shell and with a small environment,
//!    its tree ended with the app (`program.rs`), in a sandbox where this
//!    computer has one that passed its self-test (`sandbox.rs`).
//!
//! Only the central window may call it: the assistant runs in the owner window.
//!
//! Not to be confused with `crate::mcp`, where Plainva itself is a server.

use std::collections::HashMap;
use std::sync::Mutex;

pub(crate) mod http;
pub(crate) mod program;
pub(crate) mod registry;
pub(crate) mod sandbox;

/// Tauri-managed state: the registry, the exchanges that can be hung up on, the running programs, and what the sandbox self-test found.
#[derive(Default)]
pub struct McpClientState {
    pub(crate) registry: Mutex<Option<registry::Registry>>,
    pub(crate) exchanges: Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    pub(crate) programs: Mutex<HashMap<String, program::Running>>,
    pub(crate) sandbox: Mutex<Option<sandbox::SandboxInfo>>,
}

/// The app is closing: every program it started ends with it.
pub(crate) fn shutdown(state: &McpClientState) {
    program::stop_all(state);
}
