import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The native boundary of foreign MCP servers, as a test (plan KI-Harness
 * P4.5): the web view speaks the protocol, but it never decides where a
 * request goes or what program is started, and it never gets a credential
 * back. Three native implementations hold that line — the desktop's
 * `src-tauri/src/mcp_client`, Android's `AiMcpPlugin.java`, iOS's
 * `AiMcpPlugin.swift` — and none of them can run here. So their contract is
 * checked on the source, the way `aiKeyBoundary` checks the egress: what
 * every command takes and answers, where the registry is written, where a
 * credential is read, and that nothing starts a shell or follows a redirect.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repo, ...parts), "utf8");
/** Code without its comments: a rule that prose can satisfy or break is none. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** A file without its unit tests: what ships. */
const shipped = (source: string) => source.split("#[cfg(test)]")[0]!;

const rustDir = ["apps", "desktop", "src-tauri", "src", "mcp_client"] as const;
const registry = shipped(read(...rustDir, "registry.rs"));
const http = shipped(read(...rustDir, "http.rs"));
const program = shipped(read(...rustDir, "program.rs"));
const sandbox = shipped(read(...rustDir, "sandbox.rs"));
const secureStore = read("apps", "desktop", "src-tauri", "src", "secure_store.rs");
const lib = read("apps", "desktop", "src-tauri", "src", "lib.rs");
const android = read("apps", "mobile", "android", "app", "src", "main", "java", "com", "plainva", "app", "AiMcpPlugin.java");
const androidEgress = read("apps", "mobile", "android", "app", "src", "main", "java", "com", "plainva", "app", "AiNetPlugin.java");
const androidSecureStore = read("apps", "mobile", "android", "app", "src", "main", "java", "com", "plainva", "app", "SecureStorePlugin.java");
const ios = read("apps", "mobile", "ios", "App", "App", "AiMcpPlugin.swift");
const iosEgress = read("apps", "mobile", "ios", "App", "App", "AiNetPlugin.swift");
const iosSecureStore = read("apps", "mobile", "ios", "App", "App", "SecureStorePlugin.swift");
const desktopBridge = read("apps", "desktop", "src", "services", "ai", "desktopMcp.ts");
const mobileBridge = read("apps", "mobile", "src", "platform", "aiMcp.ts");
const contract = read("packages", "core", "src", "ai", "mcp", "native.ts");

interface Command {
  name: string;
  params: string;
  returns: string;
  body: string;
}

/** Every `#[tauri::command]` of a Rust file, with its body up to the closing brace at column zero. */
function commands(source: string): Command[] {
  return [...source.matchAll(/#\[tauri::command\]\s*(?:#\[allow\([^)]*\)\]\s*)?pub (?:async )?fn (\w+)\(([\s\S]*?)\)\s*->\s*([^{]+?)\s*\{([\s\S]*?)\n\}/g)].map((m) => ({
    name: m[1]!,
    params: m[2]!,
    returns: m[3]!,
    body: m[4]!,
  }));
}

const all = [...commands(registry), ...commands(http), ...commands(program), ...commands(sandbox)];
const byName = (name: string) => all.find((c) => c.name === name)!;

describe("desktop: the commands of the MCP client", () => {
  it("are exactly these, and all of them are registered", () => {
    const names = all.map((c) => c.name).sort();
    expect(names).toEqual([
      "mcp_client_add_http",
      "mcp_client_add_program",
      "mcp_client_cancel",
      "mcp_client_http",
      "mcp_client_log",
      "mcp_client_remove",
      "mcp_client_sandbox",
      "mcp_client_secret_delete",
      "mcp_client_secret_present",
      "mcp_client_secret_set",
      "mcp_client_servers",
      "mcp_client_start",
      "mcp_client_stop",
      "mcp_client_write",
    ]);
    for (const name of names) expect(lib, name).toMatch(new RegExp(`mcp_client::\\w+::${name},`));
  });

  it("answer with a unit, a flag, the registry or scrubbed text — never with what the keychain holds", () => {
    const returns = Object.fromEntries(all.map((c) => [c.name, c.returns]));
    expect(returns).toEqual({
      mcp_client_servers: "Result<Vec<McpServerInfo>, String>",
      mcp_client_add_http: "Result<bool, String>",
      mcp_client_add_program: "Result<bool, String>",
      mcp_client_remove: "Result<(), String>",
      mcp_client_secret_set: "Result<(), String>",
      mcp_client_secret_present: "Result<bool, String>",
      mcp_client_secret_delete: "Result<(), String>",
      mcp_client_http: "Result<(), String>",
      mcp_client_cancel: "Result<bool, String>",
      mcp_client_start: "Result<(), String>",
      mcp_client_write: "Result<(), String>",
      mcp_client_stop: "Result<(), String>",
      mcp_client_log: "Result<String, String>",
      mcp_client_sandbox: "Result<SandboxInfo, String>",
    });
    // The one command that answers with text: the end of a program's error stream, through the scrubber.
    expect(byName("mcp_client_log").body).toContain("Ok(shown_log(&tail, &running.scrub))");
    expect(byName("mcp_client_log").body).not.toMatch(/read_secret|read_slot/);
    // The registry as it is shown carries names, never values.
    const info = /pub struct McpServerInfo \{([\s\S]*?)\n\}/.exec(code(registry))![1]!;
    expect([...info.matchAll(/^\s*(\w+):/gm)].map((m) => m[1])).toEqual(["id", "kind", "url", "program", "args", "env", "sandbox", "stored"]);
  });

  it("are only for the central window", () => {
    for (const command of all) {
      // Hanging up needs no window: it names an exchange the central window started, and stops it.
      if (command.name === "mcp_client_cancel") continue;
      expect(command.params, command.name).toContain("window: tauri::Window");
      expect(command.body.trimStart().startsWith("only_main(&window)?;"), command.name).toBe(true);
    }
  });

  it("take a server id where a request goes or a program starts — never an address or a command", () => {
    const request = /pub struct McpHttpRequest \{([\s\S]*?)\n\}/.exec(code(http))![1]!;
    expect([...request.matchAll(/^\s*(\w+):/gm)].map((m) => m[1])).toEqual(["request_id", "server_id", "method", "headers", "body", "timeout_ms"]);
    expect(byName("mcp_client_start").params).toMatch(/server_id: String,\s*on_event: Channel<McpPipe>,?\s*$/);
    expect(byName("mcp_client_start").params).not.toMatch(/program|command|args|env/);
    expect(byName("mcp_client_write").params).toMatch(/server_id: String, line: String$/);
    // The address and the command come out of the registry, inside the command.
    expect(byName("mcp_client_http").body).toContain("let Some(Server::Http { url }) = server(&app, &state, &request.server_id)?");
    expect(byName("mcp_client_start").body).toContain("let Some(Server::Program { program, args, env, sandbox: sandboxed }) = server(&app, &state, &server_id)?");
  });
});

describe("desktop: the registry of servers", () => {
  it("grows only after a native dialog showed what is remembered", () => {
    const adders = ["mcp_client_add_http", "mcp_client_add_program"];
    for (const name of adders) {
      const body = byName(name).body;
      const asked = body.indexOf("if !confirmed(&app, text, ");
      const declined = body.indexOf("return Ok(false);");
      const remembered = body.indexOf("remember(&app, &state, &server_id, ");
      expect(asked, name).toBeGreaterThan(-1);
      expect(declined, name).toBeGreaterThan(asked);
      expect(remembered, name).toBeGreaterThan(declined);
    }
    for (const command of all) if (!adders.includes(command.name)) expect(command.body, command.name).not.toContain("remember(");
    // What is confirmed is written natively: the address as it is stored, the command line part by part.
    expect(byName("mcp_client_add_http").body).toContain("confirmed(&app, text, address.clone())");
    expect(byName("mcp_client_add_program").body).toContain("let subject = command_text(&file, &args, &env, sandbox);");
    expect(code(registry)).toMatch(/let question = format!\("\{\}\\n\\n\{subject\}", clip\(&text\.message, 600\)\);/);
    expect(code(registry)).toContain(".blocking_show()");
  });

  it("keeps credentials in slots the generic keychain commands refuse, and writes only the slots a server has", () => {
    expect(code(registry)).toContain('pub const MCP_KEY_PREFIX: &str = "ai-mcp:";');
    expect(secureStore).toMatch(/fn generic\(key: &str\)[\s\S]*?starts_with\(crate::mcp_client::registry::MCP_KEY_PREFIX\)/);
    for (const name of ["mcp_client_secret_set", "mcp_client_secret_present", "mcp_client_secret_delete"]) {
      expect(byName(name).body, name).toContain("let slot = slot_for(&app, &state, &server_id, name.as_deref())?;");
    }
    // The registry reads a value only to say whether there is one.
    expect(code(registry).match(/read_secret\(/g)?.length).toBe(3);
    expect(code(registry).match(/read_secret\(&app, &id, (?:None|Some\(name\))\)\?\.is_some\(\)/g)?.length).toBe(2);
    expect(byName("mcp_client_servers").body).not.toMatch(/stored\.push\((?!name\.clone\(\))/);
    // A value that is used goes into a request or a process, in the two files that make them.
    expect(code(http).match(/read_secret\(/g)?.length).toBe(1);
    expect(code(program).match(/read_secret\(/g)?.length).toBe(1);
    expect(code(sandbox)).not.toMatch(/read_secret|read_slot|secure_store/);
  });
});

describe("desktop: one exchange with a remote server", () => {
  it("sends only protocol headers, puts the credential in itself, and follows no redirect", () => {
    expect(code(http)).toContain('const FIXED: [&str; 6] = ["content-type", "accept", "mcp-protocol-version", "mcp-method", "mcp-name", "mcp-session-id"];');
    expect(code(http)).toContain('let rest = lower.strip_prefix("mcp-param-")?;');
    expect(code(http)).toContain(".redirect(reqwest::redirect::Policy::none())");
    expect(code(http).match(/"authorization"/g)).toEqual(['"authorization"']);
    expect(code(http)).toContain('builder = builder.header("authorization", format!("Bearer {token}"));');
    // The only headers of a request: the filtered ones and the credential.
    expect(code(http).match(/builder\.header\(/g)?.length).toBe(2);
  });

  it("answers with status, two response headers, the body and fixed words — no text of the network's own", () => {
    const chunk = /pub enum McpChunk \{([\s\S]*?)\n\}/.exec(code(http))![1]!;
    const fields = [...chunk.matchAll(/(\w+): ((?:Option<)?(?:&'static str|String|u16)>?)/g)].map((m) => `${m[1]}: ${m[2]}`);
    expect(fields).toEqual(["status: u16", "content_type: String", "session: Option<String>", "challenge: Option<String>", "text: String", "code: &'static str", "message: Option<&'static str>"]);
    // Every field of a chunk is one of these: nothing else has a type the pattern above would miss.
    expect(chunk.match(/\w+: /g)?.length).toBe(fields.length);
    // A message is a sentence written in the file — the type allows nothing else — and only `refused` builds one.
    expect(code(http).match(/message: Some\(/g)).toEqual(["message: Some("]);
    expect(code(http)).toContain("McpChunk::Failed { code: \"refused\", message: Some(message) }");
    expect(code(http)).toContain("fn refused(message: &'static str) -> McpChunk {");
  });
});

describe("desktop: a server that is a program", () => {
  it("is started from the registry's own entry, without a shell and without the app's environment", () => {
    const start = byName("mcp_client_start").body;
    expect(code(program).match(/Command::new\(/g)?.length).toBe(2);
    expect(start).toContain("let mut command = Command::new(wrapper);");
    expect(start).toContain("let mut command = Command::new(&file);");
    expect(start).toContain("command.env_clear();");
    expect(start.indexOf("command.env_clear();")).toBeLessThan(start.indexOf("for (name, value) in &values {"));
    for (const shell of ['"sh"', '"bash"', '"cmd"', '"cmd.exe"', '"powershell"', '"-c"', '"/c"', '"/C"']) expect(code(program), shell).not.toContain(shell);
    expect(code(program)).toContain("tree::prepare(&mut command);");
    expect(start).toContain("let tree = tree::Tree::adopt(&child);");
  });

  it("is not started without the sandbox it was confirmed with", () => {
    const start = byName("mcp_client_start").body;
    const probed = start.indexOf("let info = sandbox::probe(&state).await;");
    const refused = start.indexOf('return Err("sandbox-unavailable".into());');
    const wrapped = start.indexOf("sandbox::wrap(info.kind, &file, &args, &denied)");
    expect(probed).toBeGreaterThan(-1);
    expect(refused).toBeGreaterThan(probed);
    expect(wrapped).toBeGreaterThan(refused);
    // What "works" means is decided by the self-test, and by nothing else.
    expect(code(sandbox)).toContain("let works = tauri::async_runtime::spawn_blocking(move || self_test(kind)).await.unwrap_or(false);");
    expect(code(sandbox)).toContain('read(&seen).as_deref() == Some(b"open".as_slice()) && read(&hidden).is_none()');
  });

  it("names why a start failed in fixed words the settings can say in the user's language", () => {
    const words = [...byName("mcp_client_start").body.matchAll(/Err\("([a-z-]+)"\.into\(\)\)|map_err\(\|_\| "([a-z-]+)"\.to_string\(\)\)/g)].map((m) => m[1] ?? m[2]);
    expect([...new Set(words)].sort()).toEqual(["already-running", "not-registered", "program-moved", "sandbox-unavailable", "start-failed"]);
    const known = /MCP_START_PROBLEMS = \[([^\]]*)\]/.exec(contract)![1]!.match(/"([a-z-]+)"/g)!.map((w) => w.slice(1, -1));
    expect([...known].sort()).toEqual([...new Set(words)].sort());
  });

  it("ends with the app", () => {
    expect(lib).toMatch(/matches!\(event, tauri::WindowEvent::Destroyed\) && window\.label\(\) == "main"[\s\S]{0,120}mcp_client::shutdown\(/);
    expect(code(program)).toContain("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE");
    expect(code(program)).toContain("command.process_group(0);");
  });
});

describe("Android: AiMcpPlugin", () => {
  it("keeps the tokens in a box of its own", () => {
    const box = /new KeystoreBox\(getContext\(\), "([^"]+)", "([^"]+)"\)/;
    expect(box.exec(android)?.slice(1)).toEqual(["plainva_ai_mcp_keys", "plainva_ai_mcp_keys"]);
    expect(box.exec(androidEgress)?.[1]).not.toBe("plainva_ai_mcp_keys");
    expect(androidSecureStore).not.toContain("plainva_ai_mcp_keys");
  });

  it("answers with flags, the registry, status and fixed words only", () => {
    const names = new Set([...code(android).matchAll(/\b\w+\.put\("(\w+)", /g)].map((m) => m[1]));
    expect([...names].sort()).toEqual(["added", "args", "cancelled", "challenge", "code", "contentType", "env", "id", "kind", "message", "present", "sandbox", "servers", "session", "status", "stored", "text", "type", "url"]);
    // A token is read in two places — whether one is stored, and the request — and put nowhere.
    expect(code(android).match(/secrets\(\)\.read\(/g)?.length).toBe(3);
    expect(code(android)).toMatch(/present = secrets\(\)\.read\(entry\.getKey\(\)\) != null;/);
    expect(code(android)).toMatch(/ret\.put\("present", secrets\(\)\.read\(serverId\) != null\);/);
    expect(code(android)).toMatch(/token = secrets\(\)\.read\(serverId\);/);
    expect(code(android)).not.toMatch(/\.put\([^;]*\btoken\b/);
    expect(code(android)).not.toMatch(/resolve\([^;]*\btoken\b/);
    // A failure carries a word of a fixed set and, at most, a sentence written in the plugin.
    for (const [, message] of code(android).matchAll(/failed\("[a-z-]+", ([^)]+)\)/g)) expect(message === "null" || /^"[^"]+"$/.test(message!), message).toBe(true);
    expect(code(android)).not.toMatch(/getMessage\(\)/);
  });

  it("takes the address from its registry, which grows only through a native dialog", () => {
    const request = /public void request\(PluginCall call\) \{([\s\S]*?)\n {4}\}\n/.exec(code(android))![1]!;
    expect(request).not.toMatch(/getString\("url"/);
    expect(request).toContain("String address = servers().getString(serverId, null);");
    expect(code(android).match(/servers\(\)\.edit\(\)\.putString\(/g)?.length).toBe(1);
    const add = /public void addServer\(PluginCall call\) \{([\s\S]*?)\n {4}\}\n/.exec(code(android))![1]!;
    expect(add.indexOf("new AlertDialog.Builder(getActivity())")).toBeGreaterThan(-1);
    expect(add.indexOf("servers().edit().putString(serverId, address)")).toBeGreaterThan(add.indexOf(".setPositiveButton(confirm"));
    expect(add).toContain('.setMessage(message + "\\n\\n" + address)');
  });

  it("follows no redirect and sends only protocol headers and the token", () => {
    expect(code(android)).toContain(".followRedirects(false)");
    expect(code(android)).toContain(".followSslRedirects(false)");
    expect(code(android).match(/builder\.header\(/g)?.length).toBe(2);
    expect(code(android)).toContain("builder.header(allowed, value);");
    expect(code(android)).toContain('if (token != null) builder.header("authorization", "Bearer " + token);');
  });
});

describe("iOS: AiMcpPlugin", () => {
  it("keeps the tokens in a keychain service of its own", () => {
    const service = /secretService = "([^"]+)"/.exec(ios)?.[1];
    expect(service).toBeTruthy();
    expect(service).not.toBe(/keyService = "([^"]+)"/.exec(iosEgress)?.[1]);
    expect(service).not.toBe(/service = "([^"]+)"/.exec(iosSecureStore)?.[1]);
    expect(ios).toContain("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly");
  });

  it("answers with flags, the registry, status and fixed words only", () => {
    const keys = new Set([...code(ios).matchAll(/"(\w+)": /g)].map((m) => m[1]));
    expect([...keys].sort()).toEqual(["added", "args", "cancelled", "code", "env", "id", "kind", "present", "sandbox", "servers", "status", "stored", "text", "type", "url"]);
    expect([...code(ios).matchAll(/(?:open|out)\["(\w+)"\] = /g)].map((m) => m[1]).sort()).toEqual(["challenge", "contentType", "message", "session"]);
    // A token is read where it is counted and where it goes into the request; it is put into nothing that is answered.
    expect(code(ios).match(/try\?? readSecret\(/g)?.length).toBe(3);
    expect(code(ios)).not.toMatch(/resolve\([^\n]*\btoken\b/);
    expect(code(ios)).not.toMatch(/(?:open|out)\["\w+"\] = [^\n]*\btoken\b/);
    expect(code(ios)).toContain('if let token = token { request.setValue("Bearer \\(token)", forHTTPHeaderField: "authorization") }');
    expect(code(ios)).not.toMatch(/localizedDescription/);
  });

  it("takes the address from its registry, which grows only through a native alert", () => {
    const request = /@objc func request\(_ call: CAPPluginCall\) \{([\s\S]*?)\n {4}\}\n/.exec(code(ios))![1]!;
    expect(request).not.toMatch(/getString\("url"\)/);
    expect(request).toContain("guard let address = registry()[serverId], let url = URL(string: address) else {");
    expect(code(ios).match(/UserDefaults\.standard\.set\(stored, forKey: AiMcpPlugin\.serversDefaultsKey\)/g)?.length).toBe(2);
    const add = /@objc func addServer\(_ call: CAPPluginCall\) \{([\s\S]*?)\n {4}\}\n/.exec(code(ios))![1]!;
    expect(add.indexOf("stored[serverId] = address")).toBeGreaterThan(add.indexOf('UIAlertAction(title: call.getString("confirm")'));
    expect(add).toContain('+ "\\n\\n" + address');
  });

  it("follows no redirect and sends only protocol headers and the token", () => {
    expect(code(ios)).toMatch(/willPerformHTTPRedirection[\s\S]*?\{\s*completionHandler\(nil\)/);
    expect(code(ios).match(/request\.setValue\(/g)?.length).toBe(2);
    expect(code(ios)).toContain("request.setValue(text, forHTTPHeaderField: allowed)");
  });
});

describe("the bridges of the web view", () => {
  it("have no way to read a credential back", () => {
    for (const source of [desktopBridge, mobileBridge, contract]) expect(source).not.toMatch(/getSecret|readSecret|secret_get|secret_read/i);
    const host = /export interface McpNativeHost \{([\s\S]*?)\n\}/.exec(code(contract))![1]!;
    expect([...host.matchAll(/^\s*(\w+)[(:]/gm)].map((m) => m[1])).toEqual(["servers", "addHttp", "remove", "setSecret", "hasSecret", "deleteSecret", "httpPort", "programs"]);
    expect(host).toContain("hasSecret(serverId: string, name: string | null): Promise<boolean>;");
  });

  it("name a server by its id in every call", () => {
    const invoked = [...desktopBridge.matchAll(/invoke(?:<[^>]+>)?\("(\w+)"/g)].map((m) => m[1]);
    expect([...new Set(invoked)].sort()).toEqual(all.map((c) => c.name).sort());
    expect(desktopBridge).toContain("request: { requestId, serverId, method: request.method, headers: request.headers, body: request.body, timeoutMs: request.timeoutMs }");
    expect(mobileBridge).toMatch(/registerPlugin<AiMcpNative>\("AiMcp"\)/);
    expect(mobileBridge).toContain("AiMcp.request({ requestId, serverId, method: request.method, headers: request.headers, body: request.body, timeoutMs: request.timeoutMs }");
    // A phone starts no programs.
    expect(mobileBridge).toContain("programs: null,");
  });
});
