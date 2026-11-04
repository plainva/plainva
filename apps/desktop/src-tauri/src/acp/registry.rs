//! Which external agents this installation knows.
//!
//! The registry is a file in the app data folder. It grows in exactly one
//! command, and only after a NATIVE dialog showed what is about to be
//! remembered: the file that will be started and every argument. A start and
//! a sign-in name an agent's id; nothing else in this module accepts a program
//! from the web view. A start is confirmed once more, per folder and run of
//! the app (`process.rs`). No credential is kept here or anywhere else — an agent
//! signs in by itself.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::AcpState;
use crate::ai_egress::only_main;
use crate::mcp_client::registry::{clean_text, confirmed, locate, valid_id, McpConfirmText};

const REGISTRY_FILE: &str = "ai-acp-agents.json";
const MAX_AGENTS: usize = 32;
const MAX_ARGS: usize = 32;
const MAX_ARG: usize = 4096;
/// A command line longer than this cannot be read in a dialog, so it cannot be approved.
const MAX_COMMAND_TEXT: usize = 6000;
const MAX_DETECT: usize = 64;

/// An agent: the file that is started and its arguments — exactly what the user confirmed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Agent {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
}

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Registry {
    pub(crate) agents: BTreeMap<String, Agent>,
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

fn with_registry<T>(app: &AppHandle, state: &AcpState, run: impl FnOnce(&mut Registry) -> T) -> Result<T, String> {
    let mut guard = state.registry.lock().map_err(|_| "agent registry lock failed".to_string())?;
    if guard.is_none() {
        // A file that cannot be read is an empty registry: nothing is started that cannot be shown.
        let loaded = std::fs::read_to_string(registry_file(app)?)
            .ok()
            .and_then(|text| serde_json::from_str::<Registry>(&text).ok())
            .unwrap_or_default();
        *guard = Some(loaded);
    }
    Ok(run(guard.as_mut().expect("loaded above")))
}

pub(crate) fn agent(app: &AppHandle, state: &AcpState, id: &str) -> Result<Option<Agent>, String> {
    with_registry(app, state, |registry| registry.agents.get(id).cloned())
}

/// A command as it may be registered: a program and arguments that can be shown, line by line.
pub(crate) fn check_command(program: &str, args: &[String]) -> Result<(), String> {
    if program.trim().is_empty() || program.len() > MAX_ARG || !clean_text(program) {
        return Err("not a program".into());
    }
    if args.len() > MAX_ARGS || args.iter().any(|arg| arg.len() > MAX_ARG || !clean_text(arg)) {
        return Err("too many arguments, or one that cannot be shown".into());
    }
    Ok(())
}

/// What the native dialog shows: the file and every argument on a line of its
/// own, nothing shortened. Written here, not by the web view.
pub(crate) fn command_text(program: &str, args: &[String]) -> String {
    let mut lines = vec![program.to_string()];
    lines.extend(args.iter().cloned());
    lines.join("\n")
}

/// A program's name as an agent is looked for: a bare name, never a path — where
/// it lies is this computer's business, and nothing is started by looking.
pub(crate) fn bare_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_lowercase() || first.is_ascii_digit()) && name.len() <= 64 && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

/// What the registry holds, for the settings to show: exactly what was confirmed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpAgentInfo {
    id: String,
    program: String,
    args: Vec<String>,
}

#[tauri::command]
pub fn acp_agents(window: tauri::Window, app: AppHandle, state: State<'_, AcpState>) -> Result<Vec<AcpAgentInfo>, String> {
    only_main(&window)?;
    let agents = with_registry(&app, &state, |registry| registry.agents.clone())?;
    Ok(agents.into_iter().map(|(id, agent)| AcpAgentInfo { id, program: agent.program, args: agent.args }).collect())
}

/// Which of these programs are installed: for each name, the file it means on
/// this computer, or nothing. Looks; starts nothing.
#[tauri::command]
pub fn acp_detect(window: tauri::Window, programs: Vec<String>) -> Result<Vec<Option<String>>, String> {
    only_main(&window)?;
    if programs.len() > MAX_DETECT {
        return Err("too many names".into());
    }
    Ok(programs.iter().map(|name| if bare_name(name) { locate(name).map(|file| file.to_string_lossy().into_owned()) } else { None }).collect())
}

/// Remembers an agent after a NATIVE confirmation of its whole command line.
#[tauri::command]
pub async fn acp_agent_add(window: tauri::Window, app: AppHandle, state: State<'_, AcpState>, agent_id: String, program: String, args: Vec<String>, text: McpConfirmText) -> Result<bool, String> {
    only_main(&window)?;
    if !valid_id(&agent_id) {
        return Err("invalid agent id".into());
    }
    check_command(&program, &args)?;
    let known = with_registry(&app, &state, |registry| (registry.agents.len(), registry.agents.contains_key(&agent_id)))?;
    if known.0 >= MAX_AGENTS && !known.1 {
        return Err("too many agents".into());
    }
    let file = locate(&program).ok_or("the program was not found")?;
    let file = file.to_string_lossy().into_owned();
    let subject = command_text(&file, &args);
    if subject.len() > MAX_COMMAND_TEXT {
        return Err("the command is too long to be shown".into());
    }
    if !confirmed(&app, text, subject).await? {
        return Ok(false);
    }
    // Another command under an id that runs: the old one ends first, and a yes to a start was for the old command.
    super::process::stop(&state, &agent_id);
    super::process::forget_starts(&state, &agent_id);
    let snapshot = with_registry(&app, &state, |registry| {
        registry.agents.insert(agent_id.clone(), Agent { program: file, args });
        serde_json::to_string_pretty(registry)
    })?
    .map_err(|e| e.to_string())?;
    save(&app, &snapshot)?;
    Ok(true)
}

#[tauri::command]
pub fn acp_agent_remove(window: tauri::Window, app: AppHandle, state: State<'_, AcpState>, agent_id: String) -> Result<(), String> {
    only_main(&window)?;
    super::process::stop(&state, &agent_id);
    super::process::forget_starts(&state, &agent_id);
    let snapshot = with_registry(&app, &state, |registry| {
        registry.agents.remove(&agent_id);
        serde_json::to_string_pretty(registry)
    })?
    .map_err(|e| e.to_string())?;
    save(&app, &snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_command_is_a_program_and_arguments_that_can_be_shown() {
        assert!(check_command("gemini", &["--acp".into()]).is_ok());
        assert!(check_command("C:\\Program Files\\Agent\\agent.exe", &[]).is_ok());
        assert!(check_command("", &[]).is_err());
        assert!(check_command("   ", &[]).is_err());
        assert!(check_command("agent\nrm -rf", &[]).is_err());
        assert!(check_command("agent", &["ok".into(), "line\nbreak".into()]).is_err());
        assert!(check_command("agent", &vec!["x".to_string(); MAX_ARGS + 1]).is_err());
        assert!(check_command("agent", &["x".repeat(MAX_ARG + 1)]).is_err());
    }

    #[test]
    fn the_dialog_shows_every_part_on_a_line_of_its_own() {
        assert_eq!(command_text("/usr/bin/gemini", &["--acp".into(), "two words".into()]), "/usr/bin/gemini\n--acp\ntwo words");
        assert_eq!(command_text("/usr/bin/codex-acp", &[]), "/usr/bin/codex-acp");
    }

    #[test]
    fn an_agent_is_looked_for_by_a_bare_name() {
        for good in ["gemini", "codex-acp", "claude-agent-acp", "vibe-acp", "7zip", "a.b_c"] {
            assert!(bare_name(good), "{good}");
        }
        for bad in ["", "Gemini", "./gemini", "../gemini", "/usr/bin/gemini", "C:\\gemini", "a b", "a;b", "-rf", ".hidden", "gemini.exe\n", "tr\u{e4}cker"] {
            assert!(!bare_name(bad), "{bad}");
        }
        assert!(!bare_name(&"a".repeat(65)));
    }

    #[test]
    fn the_registry_reads_what_it_wrote_and_nothing_from_a_broken_file() {
        let mut registry = Registry::default();
        registry.agents.insert("gemini".into(), Agent { program: "/usr/bin/gemini".into(), args: vec!["--acp".into()] });
        let text = serde_json::to_string_pretty(&registry).unwrap();
        let read: Registry = serde_json::from_str(&text).unwrap();
        assert_eq!(read.agents.get("gemini"), Some(&Agent { program: "/usr/bin/gemini".into(), args: vec!["--acp".into()] }));
        assert!(serde_json::from_str::<Registry>("{ not json").is_err());
        assert!(serde_json::from_str::<Registry>("{\"agents\":{\"x\":{\"program\":5}}}").is_err());
    }
}
