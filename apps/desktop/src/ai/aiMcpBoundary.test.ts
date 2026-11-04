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
const oauth = shipped(read(...rustDir, "oauth.rs"));
const secureStore = read("apps", "desktop", "src-tauri", "src", "secure_store.rs");
const lib = read("apps", "desktop", "src-tauri", "src", "lib.rs");
const android = read("apps", "mobile", "android", "app", "src", "main", "java", "com", "plainva", "app", "AiMcpPlugin.java");
const androidAuth = read("apps", "mobile", "android", "app", "src", "main", "java", "com", "plainva", "app", "AiMcpAuthPlugin.java");
const androidAuthStore = read("apps", "mobile", "android", "app", "src", "main", "java", "com", "plainva", "app", "AiMcpAuthStore.java");
const iosAuth = read("apps", "mobile", "ios", "App", "App", "AiMcpAuthPlugin.swift");
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

const all = [...commands(registry), ...commands(http), ...commands(program), ...commands(sandbox), ...commands(oauth)];
const byName = (name: string) => all.find((c) => c.name === name)!;
/** The fields of a struct, in order. */
const fields = (source: string, name: string) => [...new RegExp(`(?:pub(?:\\(crate\\))? )?struct ${name} \\{([\\s\\S]*?)\\n\\}`).exec(code(source))![1]!.matchAll(/^\s*(?:pub(?:\(crate\))? )?(\w+):/gm)].map((m) => m[1]);

describe("desktop: the commands of the MCP client", () => {
  it("are exactly these, and all of them are registered", () => {
    const names = all.map((c) => c.name).sort();
    expect(names).toEqual([
      "mcp_client_add_http",
      "mcp_client_add_program",
      "mcp_client_cancel",
      "mcp_client_http",
      "mcp_client_log",
      "mcp_client_oauth_begin",
      "mcp_client_oauth_cancel",
      "mcp_client_oauth_document",
      "mcp_client_oauth_finish",
      "mcp_client_oauth_issuer",
      "mcp_client_oauth_renew",
      "mcp_client_oauth_sign_out",
      "mcp_client_oauth_status",
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
      mcp_client_oauth_document: "Result<OAuthDocument, String>",
      mcp_client_oauth_issuer: "Result<OAuthIssuerInfo, String>",
      mcp_client_oauth_begin: "Result<String, String>",
      mcp_client_oauth_finish: "Result<String, String>",
      mcp_client_oauth_cancel: "Result<(), String>",
      mcp_client_oauth_renew: "Result<bool, String>",
      mcp_client_oauth_status: "Result<Option<OAuthStatus>, String>",
      mcp_client_oauth_sign_out: "Result<(), String>",
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

describe("desktop: signing in to a remote server", () => {
  it("answers with an address to open, a server id, a flag or a state — never with a token, a verifier or an endpoint", () => {
    // The two commands that answer with text: the address the browser is sent to, and the id of the server that is signed in to.
    const begin = byName("mcp_client_oauth_begin").body;
    expect(begin).toContain("let url = authorization_url(&endpoints.authorization, &client.id, &redirect, &pkce_challenge(&verifier), &state_value, &scopes, &request.resource)?;");
    expect(begin.trimEnd().endsWith("Ok(url)")).toBe(true);
    expect(byName("mcp_client_oauth_finish").body.trimEnd().endsWith("Ok(flow.server_id)")).toBe(true);
    // What the web view is told about an authorization server and about a sign-in.
    expect(fields(oauth, "OAuthIssuerInfo")).toEqual(["issuer", "document", "dynamic", "iss", "scopes"]);
    expect(fields(oauth, "OAuthStatus")).toEqual(["issuer", "scopes", "expires_at", "signed_in", "renewable", "client"]);
    expect(fields(oauth, "OAuthDocument")).toEqual(["status", "body"]);
    // What is written down of a sign-in is no secret; the tokens are in the keychain, in slots the generic commands refuse.
    expect(fields(oauth, "Link")).toEqual(["issuer", "token_endpoint", "client_id", "auth", "kind", "redirect_uri", "resource", "scopes", "expires_at", "signed_in", "renewable"]);
    expect(code(oauth)).toContain('format!("{MCP_KEY_PREFIX}{id}#{what}")');
    // A token leaves this module in one function, and that function is called where a request is made — nowhere else.
    expect(code(oauth).match(/fn access_token\(/g)?.length).toBe(1);
    expect(code(oauth).match(/access_token\(/g)?.length).toBe(1);
    expect(code(http).match(/access_token\(/g)?.length).toBe(1);
    for (const source of [registry, program, sandbox]) expect(code(source)).not.toMatch(/access_token\(|read_long\(/);
    for (const command of commands(oauth)) expect(command.returns, command.name).not.toMatch(/Tokens|Client|Pending|Endpoints|Link/);
  });

  it("takes from the web view what the browser came back with and what to ask for — never where a code or a token goes", () => {
    expect(fields(oauth, "OAuthBegin")).toEqual(["issuer", "scopes", "resource", "client", "client_name", "redirect_port"]);
    expect(fields(oauth, "OAuthRedirect")).toEqual(["state", "code", "iss", "error"]);
    // The endpoints come from a document this module fetched itself, from the issuer's own origin, with the issuer inside.
    const issuer = byName("mcp_client_oauth_issuer").body;
    const checked = issuer.indexOf("if !issuer_document_url_ok(&issuer, &url) {");
    const asked = issuer.indexOf("ask(&address, &server_url, Ask::Get)");
    const read = issuer.indexOf("read_issuer_document(&reply.body, &issuer, &server_url)?");
    expect(checked).toBeGreaterThan(-1);
    expect(asked).toBeGreaterThan(checked);
    expect(read).toBeGreaterThan(asked);
    expect(code(oauth)).toContain('if document.get("issuer").and_then(|value| value.as_str()) != Some(issuer) {');
    // A code goes to the token endpoint of that document; a token for the next to the one that was kept, under the address rule again.
    expect(byName("mcp_client_oauth_finish").body).toContain("reqwest::Url::parse(&flow.endpoints.token)");
    expect(byName("mcp_client_oauth_renew").body).toContain("oauth_address(&link.token_endpoint, &server_url)");
    // Who a token is for is checked against the registered address, and the way back is a port on this computer.
    const begin = byName("mcp_client_oauth_begin").body;
    expect(begin).toContain("if !resource_covers(&request.resource, &server_url) {");
    expect(begin).toContain("let redirect = request.redirect_port.and_then(redirect_uri).ok_or(\"oauth-address\")?;");
    expect(code(oauth)).toContain('(port >= 1024).then(|| format!("http://127.0.0.1:{port}/callback"))');
  });

  it("checks who answered before it uses anything of the answer, and uses what was begun once", () => {
    const finish = byName("mcp_client_oauth_finish").body;
    const check = finish.indexOf("check_redirect(live.map(");
    const taken = finish.indexOf("pending.take()");
    const exchange = finish.indexOf("token_form(&Grant::Code");
    expect(check).toBeGreaterThan(-1);
    expect(taken).toBeGreaterThan(check);
    expect(exchange).toBeGreaterThan(taken);
    expect(code(oauth)).toMatch(/let named = match redirect\.iss\.as_deref\(\) \{\s*Some\(iss\) => iss == issuer,\s*None => !promised,\s*\};\s*if !named \{\s*return Err\("oauth-issuer"\);\s*\}\s*if let Some\(error\)/);
  });

  it("asks only addresses under the rule, follows no redirect, and connects to what it checked", () => {
    expect(code(oauth).match(/\.redirect\(reqwest::redirect::Policy::none\(\)\)/g)?.length).toBe(1);
    expect(code(oauth).match(/reqwest::Client::builder\(\)/g)?.length).toBe(1);
    expect(code(oauth)).toContain("if addresses.iter().any(|address| !is_public_address(address.ip())) {");
    expect(code(oauth)).toContain("builder = builder.https_only(true).resolve_to_addrs(&host, &addresses);");
    for (const name of ["mcp_client_oauth_document", "mcp_client_oauth_issuer"]) expect(byName(name).body, name).toContain('let address = oauth_address(&url, &server_url).ok_or("oauth-address")?;');
    // Every request of a sign-in goes through the one function that does all of that.
    expect(code(oauth).match(/\.send\(\)/g)?.length).toBe(1);
  });

  it("names what went wrong in the fixed words the settings can say in the user's language", () => {
    const words = new Set([...code(oauth).matchAll(/"(oauth-[a-z-]+)"/g)].map((m) => m[1]));
    const known = /MCP_OAUTH_PROBLEMS = \[([^\]]*)\]/.exec(contract)![1]!.match(/"([a-z-]+)"/g)!.map((w) => w.slice(1, -1));
    for (const word of words) expect(known, word).toContain(word);
    // Every word the web view knows is one the native side can say.
    expect([...words].sort()).toEqual([...known].sort());
  });

  it("forgets a sign-in with its server, and when a fixed token takes its place", () => {
    expect(code(registry)).toMatch(/fn forget_secrets\([^)]*\) -> Result<\(\), String> \{\s*let old = server\(app, state, id\)\?;\s*super::oauth::forget\(app, state, id\)\?;/);
    expect(byName("mcp_client_secret_set").body).toMatch(/if name\.is_none\(\) \{\s*super::oauth::forget\(&app, &state, &server_id\)\?;\s*\}/);
    expect(byName("mcp_client_oauth_sign_out").body).toContain("forget(&app, &state, &server_id)");
    // A sign-in removes the fixed token in turn.
    expect(byName("mcp_client_oauth_finish").body).toContain("crate::secure_store::write_slot(&app, &super::registry::secret_slot(&flow.server_id, None), None)?;");
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

describe("Android: AiMcpAuthPlugin", () => {
  it("keeps what it keeps in the box of the MCP plugin, under names no server id can have", () => {
    expect(/new KeystoreBox\(getContext\(\), "([^"]+)", "([^"]+)"\)/.exec(androidAuth)?.slice(1)).toEqual(["plainva_ai_mcp_keys", "plainva_ai_mcp_keys"]);
    expect(code(androidAuthStore)).toContain('static final String PENDING = "#pending";');
    expect(code(androidAuthStore)).toContain('return serverId + "#oauth";');
    // The request takes the stored token first and the sign-in's otherwise; a new token, a new entry and a removal forget the sign-in.
    expect(code(android)).toContain("if (token == null) token = AiMcpAuthStore.bearer(secrets(), serverId);");
    expect(code(android).match(/AiMcpAuthStore\.forget\(secrets\(\), serverId\);/g)?.length).toBe(3);
  });

  it("answers with an address to open, a server id, a flag or a state — never with a token or a verifier", () => {
    const names = new Set([...code(androidAuth).matchAll(/\b(?:ret|info|shown)\.put\("(\w+)", /g)].map((m) => m[1]));
    expect([...names].sort()).toEqual(["body", "client", "document", "dynamic", "expiresAt", "iss", "issuer", "renewable", "renewed", "scopes", "serverId", "signedIn", "status", "url"]);
    // Nothing that is answered is read from a secret field of what is kept.
    for (const [, value] of code(androidAuth).matchAll(/\b(?:ret|info|shown)\.put\("\w+", ([^;]+)\);/g)) expect(value, value).not.toMatch(/"access"\)(?! != null)|"refresh"\)(?! != null)|verifier|clientSecret|tokens\./);
    // A rejection carries one of the fixed words, or a sentence written in the plugin.
    for (const [, reason] of code(androidAuth).matchAll(/call\.reject\(([^)]*)\)/g)) expect(reason === "e.word" || /^"[^"]+"$/.test(reason!), reason).toBe(true);
    expect(code(androidAuth)).not.toMatch(/getMessage\(\)/);
  });

  it("takes the server's address from the registry, and the endpoints from a document it fetched itself", () => {
    expect(code(androidAuth)).toContain("servers.getString(serverId, null)");
    expect(code(androidAuth)).not.toMatch(/getString\("(?:tokenEndpoint|authorizationEndpoint|redirectUri|verifier)"/);
    const issuer = /public void issuer\(PluginCall call\) \{([\s\S]*?)\n {4}\}\n/.exec(code(androidAuth))![1]!;
    expect(issuer.indexOf("AiMcpOAuthRules.issuerDocumentUrlOk(issuer, url)")).toBeGreaterThan(-1);
    expect(issuer.indexOf("AiMcpOAuthRules.readIssuerDocument(reply.body, issuer, serverUrl)")).toBeGreaterThan(issuer.indexOf("ask(target, serverUrl, null, null, null)"));
    const begin = /public void begin\(PluginCall call\) \{([\s\S]*?)\n {4}\}\n/.exec(code(androidAuth))![1]!;
    expect(begin).toContain("AiMcpOAuthRules.redirectUri(getContext().getPackageName())");
    expect(begin).toContain("if (!AiMcpOAuthRules.resourceCovers(resource, serverUrl)) {");
    const finish = /public void finish\(PluginCall call\) \{([\s\S]*?)\n {4}\}\n/.exec(code(androidAuth))![1]!;
    expect(finish.indexOf("AiMcpOAuthRules.checkRedirect(")).toBeGreaterThan(-1);
    expect(finish.indexOf("AiMcpOAuthRules.codeForm(")).toBeGreaterThan(finish.indexOf("AiMcpOAuthRules.checkRedirect("));
    expect(finish).toContain('ask(AiMcpAuthStore.text(flow, "tokenEndpoint"), serverUrl,');
  });

  it("follows no redirect and connects to the addresses it checked", () => {
    expect(code(androidAuth)).toContain(".followRedirects(false)");
    expect(code(androidAuth)).toContain(".followSslRedirects(false)");
    expect(code(androidAuth)).toContain('if (!AiWebRules.isPublicAddress(candidate)) throw problem("oauth-address");');
    expect(code(androidAuth)).toContain("http = client.newBuilder().dns(name -> name.equalsIgnoreCase(host) ? found : Dns.SYSTEM.lookup(name)).build();");
    expect(code(androidAuth).match(/\.execute\(\)/g)?.length).toBe(1);
  });
});

describe("iOS: AiMcpAuthPlugin", () => {
  it("keeps what it keeps in the keychain service of the MCP plugin, on this device only", () => {
    expect(code(iosAuth)).toContain("kSecAttrService as String: AiMcpPlugin.secretService,");
    expect(code(iosAuth)).toContain("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly");
    expect(code(iosAuth)).toContain('static let pending = "#pending"');
    expect(code(iosAuth)).toContain('return serverId + "#oauth"');
    expect(code(ios)).toContain("let token = stored ?? AiMcpAuthStore.bearer(serverId)");
    expect(code(ios).match(/AiMcpAuthStore\.forget\(serverId\)/g)?.length).toBe(3);
  });

  it("answers with an address to open, a server id, a flag or a state — never with a token or a verifier", () => {
    const resolved = [...code(iosAuth).matchAll(/call\.resolve\(\[([^\]]*)\]\)/g)].map((m) => m[1]!);
    expect(resolved.sort()).toEqual(['"issuer": info', '"renewed": done', '"renewed": false', '"renewed": true', '"serverId": serverId', '"status": NSNull()', '"status": reply.status, "body": reply.body', '"status": shown', '"url": url'].sort());
    const info = /let info: \[String: Any\] = \[([^\]]*)\]/.exec(code(iosAuth))![1]!;
    expect([...info.matchAll(/"(\w+)": /g)].map((m) => m[1])).toEqual(["issuer", "document", "dynamic", "iss", "scopes"]);
    const shown = /var shown: \[String: Any\] = \[([\s\S]*?)\n {8}\]/.exec(code(iosAuth))![1]!;
    expect([...shown.matchAll(/"(\w+)": /g)].map((m) => m[1])).toEqual(["issuer", "scopes", "signedIn", "renewable", "client"]);
    expect(shown).toContain('"signedIn": link["access"] is String,');
    expect(shown).toContain('"renewable": link["refresh"] is String,');
    for (const [, reason] of code(iosAuth).matchAll(/call\.reject\(([^)]*\)?)\)/g)) expect(reason === "AiMcpAuthPlugin.word(error)" || /^"[^"]+"$/.test(reason!), reason).toBe(true);
    expect(code(iosAuth)).not.toMatch(/localizedDescription/);
  });

  it("takes the server's address from the registry, and the endpoints from a document it fetched itself", () => {
    expect(code(iosAuth)).toContain("UserDefaults.standard.dictionary(forKey: AiMcpPlugin.serversDefaultsKey)");
    expect(code(iosAuth)).not.toMatch(/getString\("(?:tokenEndpoint|authorizationEndpoint|redirectUri|verifier)"\)/);
    expect(code(iosAuth)).toContain("AiMcpOAuthRules.issuerDocumentUrlOk(issuer: named, url: url)");
    expect(code(iosAuth)).toContain("try AiMcpOAuthRules.readIssuerDocument(reply.body, issuer: named, serverUrl: serverUrl)");
    expect(code(iosAuth)).toContain("AiMcpOAuthRules.redirectUri(appId: AiMcpAuthPlugin.appId())");
    expect(code(iosAuth)).toContain("AiMcpOAuthRules.resourceCovers(resource, serverUrl: serverUrl)");
    const finish = /@objc func finish\(_ call: CAPPluginCall\) \{([\s\S]*?)\n {4}\}\n/.exec(code(iosAuth))![1]!;
    expect(finish.indexOf("AiMcpOAuthRules.checkRedirect(")).toBeGreaterThan(-1);
    expect(finish.indexOf("AiMcpOAuthRules.codeForm(")).toBeGreaterThan(finish.indexOf("AiMcpOAuthRules.checkRedirect("));
    expect(finish).toContain('AiMcpAuthPlugin.ask(flow?["tokenEndpoint"] as? String, serverUrl: serverUrl,');
  });

  it("follows no redirect, and checks where an answer came from before it uses it", () => {
    expect(code(iosAuth)).toMatch(/willPerformHTTPRedirection[\s\S]*?\{\s*completionHandler\(nil\)/);
    expect(code(iosAuth)).toContain("if addresses.contains(where: { !AiWebRules.isPublicAddress($0) }) { throw AiMcpOAuthRules.Problem(\"oauth-address\") }");
    expect(code(iosAuth)).toContain("guard let remote = exchange.remote, AiWebRules.isPublicAddress(remote) else { throw AiMcpOAuthRules.Problem(\"oauth-address\") }");
    expect(code(iosAuth).match(/\.dataTask\(with: request\)/g)?.length).toBe(1);
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
    expect([...host.matchAll(/^\s*(\w+)[(:]/gm)].map((m) => m[1])).toEqual(["servers", "addHttp", "remove", "setSecret", "hasSecret", "deleteSecret", "httpPort", "programs", "oauth"]);
    expect(host).toContain("hasSecret(serverId: string, name: string | null): Promise<boolean>;");
  });

  it("learn of a sign-in where it is, for what and until when — and get no token, no verifier and no endpoint", () => {
    const host = /export interface McpOAuthHost \{([\s\S]*?)\n\}/.exec(code(contract))![1]!;
    expect([...host.matchAll(/^\s*(\w+)\(/gm)].map((m) => m[1])).toEqual(["document", "issuer", "begin", "finish", "cancel", "renew", "status", "signOut"]);
    const status = /export interface McpOAuthStatus \{([\s\S]*?)\n\}/.exec(code(contract))![1]!;
    expect([...status.matchAll(/^\s*(\w+):/gm)].map((m) => m[1])).toEqual(["issuer", "scopes", "expiresAt", "signedIn", "renewable", "client"]);
    const issuer = /export interface McpOAuthIssuer \{([\s\S]*?)\n\}/.exec(code(contract))![1]!;
    expect([...issuer.matchAll(/^\s*(\w+):/gm)].map((m) => m[1])).toEqual(["issuer", "document", "dynamic", "iss", "scopes"]);
    // (`mcp_client_secret_set` and its two neighbours are the write-only slots of a fixed token: the names of commands, not of fields.)
    for (const source of [code(desktopBridge), code(mobileBridge), code(contract)]) expect(source).not.toMatch(/access_?token|refresh_?token|verifier|\bclient_?secret\b|token_?endpoint/i);
  });

  it("name a server by its id in every call", () => {
    const invoked = [...desktopBridge.matchAll(/invoke(?:<[^>]+>)?\("(\w+)"/g)].map((m) => m[1]!);
    expect([...new Set(invoked.filter((name) => name.startsWith("mcp_client_")))].sort()).toEqual(all.map((c) => c.name).sort());
    // The way back from the browser is the listener every account sign-in of the app uses; what arrives there is handed to the native side as it is.
    expect([...new Set(invoked.filter((name) => !name.startsWith("mcp_client_")))].sort()).toEqual(["oauth_loopback_cancel", "oauth_loopback_start", "oauth_loopback_wait"]);
    expect(mobileBridge).toMatch(/registerPlugin<AiMcpAuthNative>\("AiMcpAuth"\)/);
    expect(desktopBridge).toContain("request: { requestId, serverId, method: request.method, headers: request.headers, body: request.body, timeoutMs: request.timeoutMs }");
    expect(mobileBridge).toMatch(/registerPlugin<AiMcpNative>\("AiMcp"\)/);
    expect(mobileBridge).toContain("AiMcp.request({ requestId, serverId, method: request.method, headers: request.headers, body: request.body, timeoutMs: request.timeoutMs }");
    // A phone starts no programs.
    expect(mobileBridge).toContain("programs: null,");
  });
});
