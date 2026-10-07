//! External agents, the native side (plan KI-Harness P4.6, ADR 0025).
//!
//! An external agent is a program of another maker that the user installed
//! and signed in to themselves. Plainva starts it in the vault's folder and
//! talks to it in the Agent Client Protocol over its input and output; the
//! protocol is spoken in the web view (packages/core/src/ai/acp). This module
//! is what the web view must not be able to do on its own:
//!
//! 1. **Which program is started.** The command line of an agent lives in a
//!    registry in the app data folder. It grows only through a native dialog
//!    that shows the exact file and every argument. A start names an agent's
//!    id, never a program (`registry.rs`).
//! 2. **Where it is started, and that somebody asked.** In a folder that is an
//!    open vault of this app, and nowhere else. The first start of an agent in
//!    a folder since the app started is confirmed in a native dialog that shows
//!    the folder and the command: a start nobody asked for — a script in the
//!    web view naming a registered agent — does not happen silently
//!    (`process.rs`).
//! 3. **The sign-in.** An agent signs in by itself: where it wants a
//!    terminal for that, the same registered program is opened in one, with
//!    the few arguments the agent named added — and Plainva sees nothing of
//!    what is typed there (`login.rs`).
//!
//! What this module does NOT do is as much the point. It fetches no agent and
//! installs none. It holds no credential of an agent, and none passes through
//! it. And it puts no fence around the process: an agent is started without
//! a sandbox and with the environment of the user's own session, because it
//! has to find its own sign-in, its own tools and the network. It runs with
//! the user's rights — the surfaces say so before every start.
//!
//! And it does not stand between the web view and an agent that runs: the
//! protocol is spoken there, so whatever can run script in the web view can
//! speak to a running agent — a program that runs commands. That is why an
//! agent is registered and started only through the system's own dialogs, and
//! why the threat model names it as a residual risk (docs/engineering).
//!
//! Only the central window may call it: an agent's session lives in the owner
//! window.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

pub(crate) mod login;
pub(crate) mod process;
pub(crate) mod registry;

/// Tauri-managed state: the registry, the running agents, what an agent that ended last wrote to its error stream, and the one terminal a sign-in may have open.
#[derive(Default)]
pub struct AcpState {
    pub(crate) registry: Mutex<Option<registry::Registry>>,
    pub(crate) running: Mutex<HashMap<String, process::Running>>,
    /// Why a program ended is usually in the last lines it wrote: kept after its end, until it is started again.
    pub(crate) last_words: Mutex<HashMap<String, String>>,
    pub(crate) login: Mutex<Option<login::Login>>,
    /// Where the user said yes to a start in the system's dialog since the app started: an agent's id and the folder.
    pub(crate) confirmed: Mutex<HashSet<(String, PathBuf)>>,
}

/// The app is closing: every agent it started ends with it.
pub(crate) fn shutdown(state: &AcpState) {
    process::stop_all(state);
    login::give_up(state);
}
