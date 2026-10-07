import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACP_KNOWN_AGENTS, ACP_LOGIN_PROBLEMS, ACP_START_DECLINED, ACP_START_PROBLEMS, acpInitializeParams } from "@plainva/core";

/**
 * The native boundary of external agents, as a test (plan KI-Harness P4.6).
 * The web view speaks the protocol with an agent, but it never decides WHICH
 * program is one: that is a registry behind a dialog of the system. And the
 * things Plainva promises not to do for an agent are checked where they
 * would have to be written: no credential is taken, kept or passed; nothing
 * is fetched or installed; no shell stands between the app and the program;
 * and no terminal is offered to the agent to run commands in. The Rust code
 * cannot run here, so its contract is checked on the source, the way
 * `aiMcpBoundary` checks the MCP client.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repo, ...parts), "utf8");
/** Code without its comments: a rule that prose can satisfy or break is none. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** A file without its unit tests: what ships. */
const shipped = (source: string) => code(source.split("#[cfg(test)]\nmod tests")[0]!);

const rustDir = ["apps", "desktop", "src-tauri", "src", "acp"] as const;
const registry = shipped(read(...rustDir, "registry.rs"));
const process = shipped(read(...rustDir, "process.rs"));
const login = shipped(read(...rustDir, "login.rs"));
const mod = shipped(read(...rustDir, "mod.rs"));
const lib = read("apps", "desktop", "src-tauri", "src", "lib.rs");
const bridge = code(read("apps", "desktop", "src", "services", "ai", "desktopAcp.ts"));
const session = code(read("packages", "ui", "src", "ai", "acpSession.ts"));
const files = code(read("packages", "ui", "src", "ai", "acpFiles.ts"));
const client = code(read("packages", "core", "src", "ai", "acp", "client.ts"));
const agents = read("packages", "core", "src", "ai", "acp", "agents.ts");
const native = [registry, process, login, mod].join("\n");

interface Command {
  name: string;
  params: string;
  body: string;
}

/** Every `#[tauri::command]` of a Rust file, with its body up to the closing brace at column zero. */
function commands(source: string): Command[] {
  return [...source.matchAll(/#\[tauri::command\]\s*(?:#\[allow\([^)]*\)\]\s*)?pub (?:async )?fn (\w+)\(([\s\S]*?)\)\s*->\s*[^{]+?\s*\{([\s\S]*?)\n\}/g)].map((m) => ({ name: m[1]!, params: m[2]!, body: m[3]! }));
}

const all = [...commands(registry), ...commands(process), ...commands(login)];
const byName = (name: string) => all.find((c) => c.name === name)!;
/** The names of a command's parameters that come from the web view (not the app's own state). */
const fromWebView = (command: Command) =>
  [...command.params.matchAll(/(\w+):\s*([^,]+)/g)]
    .filter((m) => !/tauri::Window|AppHandle|State<|Channel</.test(m[2]!))
    .map((m) => m[1]);

describe("desktop: the commands of external agents", () => {
  it("are exactly these, and all of them are registered", () => {
    expect(all.map((c) => c.name).sort()).toEqual(["acp_agent_add", "acp_agent_remove", "acp_agents", "acp_detect", "acp_log", "acp_login", "acp_login_cancel", "acp_start", "acp_stop", "acp_write"]);
    for (const command of all) expect(lib, command.name).toMatch(new RegExp(`acp::\\w+::${command.name},`));
    // And nothing else of the module is a command.
    expect([...lib.matchAll(/acp::\w+::(\w+),/g)].map((m) => m[1]).sort()).toEqual(all.map((c) => c.name).sort());
  });

  it("answer only the central window", () => {
    for (const command of all) expect(command.body, command.name).toContain("only_main(&window)?");
  });

  it("take from the web view an agent's id, a folder and what the agent named — never a program to start", () => {
    // `text` is the wording of the system's dialog before a start; what the dialog is about, the native side adds.
    expect(fromWebView(byName("acp_start"))).toEqual(["agent_id", "root", "text"]);
    expect(fromWebView(byName("acp_write"))).toEqual(["agent_id", "line"]);
    expect(fromWebView(byName("acp_stop"))).toEqual(["agent_id"]);
    expect(fromWebView(byName("acp_log"))).toEqual(["agent_id"]);
    expect(fromWebView(byName("acp_login"))).toEqual(["agent_id", "root", "args", "env"]);
    expect(fromWebView(byName("acp_login_cancel"))).toEqual([]);
    expect(fromWebView(byName("acp_agents"))).toEqual([]);
    expect(fromWebView(byName("acp_detect"))).toEqual(["programs"]);
    expect(fromWebView(byName("acp_agent_remove"))).toEqual(["agent_id"]);
    // The one command that takes a program is the one that asks the user in a dialog of the system.
    expect(fromWebView(byName("acp_agent_add"))).toEqual(["agent_id", "program", "args", "text"]);
    for (const command of all.filter((c) => c.name !== "acp_agent_add")) expect(command.params, command.name).not.toMatch(/\bprogram\b|\bcommand\b/);
  });

  it("remember a program only after the system's dialog showed the file and every argument", () => {
    const add = byName("acp_agent_add").body;
    const shown = add.indexOf("confirmed(&app, text, subject)");
    const kept = add.indexOf("registry.agents.insert");
    expect(shown).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(shown);
    expect(add.slice(shown, kept)).toContain("return Ok(false)");
    // What is shown is the file the name was resolved to, built natively — not a text of the web view's.
    expect(add).toMatch(/let file = locate\(&program\)/);
    expect(add).toMatch(/let subject = command_text\(&file, &args\)/);
    // No other command writes the registry.
    for (const command of all.filter((c) => c.name !== "acp_agent_add" && c.name !== "acp_agent_remove")) expect(command.body, command.name).not.toMatch(/agents\.insert|save\(&app/);
  });

  it("start the registered file, in a folder the app registered, and name why not in a fixed set of words", () => {
    for (const name of ["acp_start", "acp_login"]) {
      const body = byName(name).body;
      // The program comes from the registry, by the id — and has to be where it was confirmed.
      expect(body, name).toMatch(/agent\(&app, &state, &agent_id\)\?/);
      expect(body, name).toContain("PathBuf::from(&entry.program)");
      expect(body, name).toContain('"program-moved"');
      expect(body, name).toMatch(/vault_folder\(&roots, &root, app\.path\(\)\.app_data_dir\(\)\.ok\(\)\.as_deref\(\)\)/);
      expect(body, name).toContain('"not-a-vault"');
    }
    const start = byName("acp_start").body;
    expect(start).toContain("Command::new(&file)");
    expect(start).toContain("command.args(&entry.args)");
    expect(start).toContain("current_dir(&folder)");
    for (const word of [...start.matchAll(/Err\("([a-z-]+)"\.into\(\)\)|map_err\(\|_\| "([a-z-]+)"\.to_string\(\)\)/g)].map((m) => m[1] ?? m[2]!)) {
      if (word !== "lock failed") expect(ACP_START_PROBLEMS as readonly string[], word).toContain(word);
    }
    // Every word of the sign-in the surfaces know, the native side can say — and it says no other.
    const said = new Set([...login.matchAll(/(?:Err|map_err\(\|_\|)\s*\(?"([a-z-]+)"/g)].map((m) => m[1]!));
    for (const word of said) expect(ACP_LOGIN_PROBLEMS as readonly string[], word).toContain(word);
    for (const word of ACP_LOGIN_PROBLEMS) expect([...said], word).toContain(word);
  });

  it("ask in the system's dialog before a start nobody confirmed in this folder, and open no terminal for a sign-in without that yes", () => {
    // The web view speaks the protocol, so it could name a registered agent by itself. What it cannot do is answer this dialog.
    const start = byName("acp_start").body;
    const asked = start.indexOf("confirmed(&app, text, start_text(&folder, &entry.program, &entry.args))");
    const spawned = start.indexOf("command.spawn()");
    expect(asked).toBeGreaterThan(0);
    expect(spawned).toBeGreaterThan(asked);
    expect(start).toMatch(/if !start_confirmed\(&state, &agent_id, &folder\) \{\s*if !confirmed\(/);
    // Only a yes gets past it; a no is answered with the one word the session knows as "nothing happened".
    expect(start.slice(asked, spawned)).toContain("return Err(START_DECLINED.into())");
    expect(process).toContain(`pub(crate) const START_DECLINED: &str = "${ACP_START_DECLINED}";`);
    expect(ACP_START_PROBLEMS as readonly string[]).not.toContain(ACP_START_DECLINED);
    // The yes is remembered for this agent in this folder — after the dialog, and for the command it showed.
    const remembered = start.indexOf("remember_start(&state, &agent_id, &folder)");
    expect(remembered).toBeGreaterThan(asked);
    expect(start.slice(asked, remembered)).toContain("agent(&app, &state, &agent_id)?.as_ref() != Some(&entry)");
    // What the dialog shows is written natively: the folder, then the registered command.
    expect(process).toMatch(/fn start_text\(folder: &Path, program: &str, args: &\[String\]\) -> String/);
    // A sign-in runs the program too: never for an agent whose start here nobody confirmed.
    const signIn = byName("acp_login").body;
    const gate = signIn.indexOf("if !start_confirmed(&state, &agent_id, &folder)");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(signIn.indexOf("spawn_blocking"));
    // Another command under the id, or none: the yes goes with the old one.
    for (const name of ["acp_agent_add", "acp_agent_remove"]) expect(byName(name).body, name).toContain("forget_starts(&state, &agent_id)");
    // And the session treats the no as what it is: no session, no failure.
    expect(session).toContain("failure.detail === ACP_START_DECLINED");
  });

  it("never start a shell on the way to the program, and never fetch or install anything", () => {
    // No command interpreter is named where a program is started; the one script of a sign-in is written by the app and run by `sh` with every part quoted.
    expect(process).not.toMatch(/"sh"|"bash"|"cmd"|cmd\.exe|powershell|"-c"/i);
    expect(registry).not.toMatch(/"sh"|"bash"|cmd\.exe|powershell/i);
    expect(login.match(/"\/bin\/sh"/g) ?? []).toHaveLength(1);
    expect(login).not.toMatch(/cmd\.exe|powershell|"-c"/i);
    expect(login).toContain("sh_quote");
    // Nothing reaches out: no request, no download, no package runner.
    expect(native).not.toMatch(/reqwest|ureq|http:\/\/|https:\/\/|TcpStream|curl|wget/);
    expect(native).not.toMatch(/"npx"|"uvx"|"npm"|"pip"|"brew"/);
    for (const agent of ACP_KNOWN_AGENTS) for (const program of agent.programs) expect(["npx", "uvx", "npm", "pnpm", "bunx", "pipx", "node", "python"], agent.key).not.toContain(program);
    expect(agents).not.toMatch(/https?:\/\//);
  });

  it("hold no credential: nothing of an agent is written to the keychain, and the registry is a file and arguments", () => {
    expect(native).not.toMatch(/secure_store|keyring|keychain|write_slot|read_slot|password|token|secret/i);
    const entry = /pub\(crate\) struct Agent \{([\s\S]*?)\n\}/.exec(registry)![1]!;
    expect([...entry.matchAll(/pub\(crate\) (\w+):/g)].map((m) => m[1])).toEqual(["program", "args"]);
    expect(session).not.toMatch(/setSecret|keychain|password|apiKey|api_key/i);
  });

  it("add to a sign-in only arguments and values that can be shown, and no name that changes how a program is found or loaded", () => {
    const body = byName("acp_login").body;
    expect(body).toContain("check_additions(&args, &env)?");
    expect(body.indexOf("check_additions")).toBeLessThan(body.indexOf("spawn_blocking"));
    // The registered arguments first, the agent's after them: the same program, asked to do one more thing.
    expect(body).toContain("entry.args.iter().cloned().chain(args)");
    expect(login).toMatch(/valid_env_name\(name\)/);
    // One terminal at a time.
    expect(body).toContain('return Err("busy".into())');
  });

  it("end every agent with the app", () => {
    expect(lib).toMatch(/acp::shutdown\(&window\.state::<acp::AcpState>\(\)\)/);
    expect(mod).toContain("process::stop_all(state)");
    expect(process).toContain("tree::prepare(&mut command)");
    expect(process).toContain("tree::Tree::adopt(&child)");
  });
});

describe("the web view's side of external agents", () => {
  it("calls the native commands with an id and a folder, and nothing it could name a program with", () => {
    const calls = [...bridge.matchAll(/invoke(?:<[^>]*>)?\("(\w+)"(?:,\s*\{([^}]*)\})?/g)].map((m) => [m[1], (m[2] ?? "").replace(/\s+/g, " ").trim()]);
    expect(calls).toEqual([
      ["acp_start", "agentId, root, text, onEvent: channel"],
      ["acp_write", "agentId, line"],
      ["acp_stop", "agentId"],
      ["acp_agents", ""],
      ["acp_detect", "programs: [...programs]"],
      ["acp_agent_add", "agentId, program: command.program, args: [...command.args], text"],
      ["acp_agent_remove", "agentId"],
      ["acp_log", "agentId"],
      ["acp_login", "agentId, root, args: [...args], env: { ...env"],
      ["acp_login_cancel", ""],
    ]);
  });

  it("offers an agent files through the app and a sign-in that can be shown — and no terminal", () => {
    const offered = acpInitializeParams({ name: "plainva", title: "Plainva", version: "1" }) as { clientCapabilities: { fs: unknown; terminal: unknown; auth: unknown } };
    expect(offered.clientCapabilities).toEqual({ fs: { readTextFile: true, writeTextFile: true }, terminal: false, auth: { terminal: true } });
    // The client has a place for four things an agent may ask, and `terminal/` is not among them.
    expect([...client.matchAll(/case "([a-z_/]+)":/g)].map((m) => m[1])).toEqual(["session/request_permission", "fs/read_text_file", "fs/write_text_file"]);
    expect(client).not.toContain("terminal/");
  });

  it("writes nothing to the vault for an agent except a note the user created", () => {
    // The files' rules only read, plan and propose; the one write is the session's `create`, behind the user's own click.
    expect(files).not.toMatch(/\.create\(|writeTextFile|writeFile\(/);
    expect(files.match(/vault\.propose\(/g) ?? []).toHaveLength(1);
    expect(session.match(/access\.create\(/g) ?? []).toHaveLength(1);
    const create = /async createNote\(path: string\)[\s\S]*?\n {2}\}/.exec(session)![0];
    expect(create).toContain("access.create(path, acpNewNoteContent(");
    // Nothing an agent sends reaches `createNote`: it is called from the surface only.
    for (const handler of ["onUpdate", "onTool", "onQuestion", "onRead", "onWrite", "settle", "onExit"]) {
      const body = new RegExp(`private (?:async )?${handler}\\([\\s\\S]*?\\n {2}\\}`).exec(session)![0];
      expect(body, handler).not.toMatch(/createNote|access\.create/);
    }
  });

  it("signs what an agent proposes with the id the user gave it, never with what the agent calls itself", () => {
    expect(files).toContain("author: { id: acpAuthorId(agentId), displayName: texts.author }");
    expect(files).toContain("generated: generatedStamp(acpAuthorId(agentId), now)");
    expect(session).not.toMatch(/acpAuthorId\([^)]*agentName/);
    expect(session).toMatch(/author: this\.t\("ai\.agent\.author", \{ agent: live\.agent\.label \}\)/);
  });
});
