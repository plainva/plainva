import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * "Fully local" on the native side, as a test (plan KI-Harness P7, ADR 0030).
 *
 * The session holds the promise first: its one egress answers every request
 * for anyone but this device (`aiLocalOnlyGate.test.ts` walks that). Behind
 * it, each shell's native side holds the same rule once more — a flag the web
 * view sets, read by every command and every plugin that sends something for
 * the assistant or starts a program for it. That is no defence against a web
 * view that was taken over (it could clear the flag the way it sets it); it
 * is a second check against a mistake in the web view's own code.
 *
 * None of the native code runs here, so its contract is read from the source,
 * the way `aiKeyBoundary` reads the egress: where the flag lives, that one
 * command sets it, and that nothing that sends gets past it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repo, ...parts), "utf8");
/** Code without its comments: a rule that prose can satisfy or break is none. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const tauri = (...parts: string[]) => code(read("apps", "desktop", "src-tauri", "src", ...parts));
const java = (name: string) => code(read("apps", "mobile", "android", "app", "src", "main", "java", "com", "plainva", "app", name));
const swift = (name: string) => code(read("apps", "mobile", "ios", "App", "App", name));

/** The body of a Rust command, from its opening brace to the closing one at column zero. */
function rustCommand(source: string, name: string): string {
  const found = new RegExp(`#\\[tauri::command\\]\\s*(?:#\\[allow\\([^)]*\\)\\]\\s*)?pub (?:async )?fn ${name}\\(([\\s\\S]*?)\\)\\s*->\\s*[^{]+?\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!found) throw new Error(`no command ${name}`);
  return found[2]!;
}
const javaMethod = (source: string, name: string) => new RegExp(`public void ${name}\\(PluginCall call\\) \\{([\\s\\S]*?)\\n {4}\\}\\n`).exec(source)?.[1] ?? "";
const swiftMethod = (source: string, name: string) => new RegExp(`@objc func ${name}\\(_ call: CAPPluginCall\\) \\{([\\s\\S]*?)\\n {4}\\}\\n`).exec(source)?.[1] ?? "";

describe("desktop: the flag", () => {
  const egress = tauri("ai_egress.rs");
  const shipped = egress.slice(0, egress.indexOf("#[cfg(test)]"));

  it("is off until the web view tells it, and one command of the main window sets it", () => {
    expect(shipped).toContain("static LOCAL_ONLY: AtomicBool = AtomicBool::new(false);");
    expect(shipped.match(/LOCAL_ONLY\.store\(/g)).toHaveLength(1);
    const set = rustCommand(egress, "ai_local_only_set");
    expect(set.trimStart().startsWith("only_main(&window)?;")).toBe(true);
    expect(set).toContain("LOCAL_ONLY.store(on, Ordering::SeqCst);");
    expect(tauri("lib.rs")).toContain("ai_egress::ai_local_only_set,");
    expect(read("apps", "desktop", "src", "services", "ai", "desktopAiEgress.ts")).toContain('await invoke("ai_local_only_set", { on });');
    expect(read("apps", "desktop", "src", "services", "ai", "desktopAi.ts")).toContain("localOnly: setDesktopLocalOnly,");
  });

  it("answers a model request for anyone but this device before a key is read or anything is sent", () => {
    const http = rustCommand(egress, "ai_http");
    const refused = http.indexOf("if local_only() && !on_this_device(&endpoint) {");
    expect(refused).toBeGreaterThan(http.indexOf("resolve(&app, &state, &request.endpoint_id)"));
    expect(http.slice(refused)).toMatch(/^if local_only\(\) && !on_this_device\(&endpoint\) \{\s*return fail\("local_only", /);
    expect(http.indexOf("read_key(")).toBeGreaterThan(refused);
    expect(http.indexOf("reqwest::Client::builder()")).toBeGreaterThan(refused);
    // "This device" is this computer's own address, read from the endpoint the native side resolved — never from the web view.
    expect(shipped).toMatch(/fn on_this_device\(endpoint: &Endpoint\) -> bool \{\s*reqwest::Url::parse\(&endpoint\.base\)\.ok\(\)\.and_then\(\|url\| url\.host_str\(\)\.map\(is_loopback\)\)\.unwrap_or\(false\)\s*\}/);
  });

  it("refuses in every other command that sends something for the assistant, or starts a program for it", () => {
    const guarded: [string, string[]][] = [
      [tauri("ai_web.rs"), ["ai_web_fetch"]],
      [tauri("mcp_client", "http.rs"), ["mcp_client_http"]],
      [tauri("mcp_client", "program.rs"), ["mcp_client_start"]],
      [tauri("mcp_client", "oauth.rs"), ["mcp_client_oauth_document", "mcp_client_oauth_issuer", "mcp_client_oauth_begin", "mcp_client_oauth_finish", "mcp_client_oauth_renew"]],
      [tauri("acp", "process.rs"), ["acp_start"]],
      [tauri("acp", "login.rs"), ["acp_login"]],
    ];
    for (const [source, names] of guarded) {
      for (const name of names) expect(rustCommand(source, name).trimStart(), name).toMatch(/^only_main\(&window\)\?;\s*not_while_local\(\)\?;/);
    }
    expect(shipped).toMatch(/pub\(crate\) fn not_while_local\(\) -> Result<\(\), String> \{\s*if local_only\(\) \{\s*Err\("local_only"\.into\(\)\)/);
    // The server for AI apps on this computer does not listen: what an app does with what it reads, nobody here can see.
    expect(rustCommand(tauri("mcp", "mod.rs"), "mcp_configure")).toMatch(/only_main\(&window\)\?;\s*let enabled = enabled && !crate::ai_egress::local_only\(\);/);
  });
});

describe("Android: the flag", () => {
  it("is one value, off until told, set through the egress plugin", () => {
    const flag = java("AiLocalOnly.java");
    expect(flag).toContain("private static volatile boolean on = false;");
    expect(javaMethod(java("AiNetPlugin.java"), "setLocalOnly")).toContain('AiLocalOnly.set(Boolean.TRUE.equals(call.getBoolean("on", false)));');
    const setters = ["AiNetPlugin.java", "AiWebPlugin.java", "AiMcpPlugin.java", "AiMcpAuthPlugin.java"].filter((name) => java(name).includes("AiLocalOnly.set("));
    expect(setters).toEqual(["AiNetPlugin.java"]);
  });

  it("answers a model request for anyone but this device before anything is built for it", () => {
    const request = javaMethod(java("AiNetPlugin.java"), "request");
    const refused = request.indexOf("if (AiLocalOnly.on() && !AiNetRules.onThisDevice(url.host())) {");
    expect(refused).toBeGreaterThan(request.indexOf("urlAllowed(endpoint, url)"));
    expect(request.slice(refused)).toMatch(/^if \(AiLocalOnly\.on\(\) && !AiNetRules\.onThisDevice\(url\.host\(\)\)\) \{\s*call\.resolve\(failed\("local_only", "[^"]+"\)\);\s*return;/);
    expect(request.indexOf("new Request.Builder()")).toBeGreaterThan(refused);
  });

  it("refuses in every other plugin that sends something for the assistant", () => {
    const refusal = /if \(AiLocalOnly\.on\(\)\) \{\s*call\.reject\("local_only"\);\s*return;\s*\}/;
    expect(javaMethod(java("AiWebPlugin.java"), "fetchPage")).toMatch(refusal);
    expect(javaMethod(java("AiMcpPlugin.java"), "request")).toMatch(refusal);
    for (const name of ["document", "issuer", "begin", "finish", "renew"]) expect(javaMethod(java("AiMcpAuthPlugin.java"), name).trimStart(), name).toMatch(new RegExp(`^${refusal.source}`));
  });
});

describe("iOS: the flag", () => {
  it("is one value behind a lock, off until told, set through the egress plugin", () => {
    const egress = swift("AiNetPlugin.swift");
    expect(egress).toMatch(/enum AiLocalOnly \{\s*private static let lock = NSLock\(\)\s*private static var value = false/);
    expect(egress).toContain('CAPPluginMethod(name: "setLocalOnly", returnType: CAPPluginReturnPromise),');
    expect(swiftMethod(egress, "setLocalOnly")).toContain('AiLocalOnly.set(call.getBool("on") ?? false)');
    const setters = ["AiNetPlugin.swift", "AiWebPlugin.swift", "AiMcpPlugin.swift", "AiMcpAuthPlugin.swift"].filter((name) => /AiLocalOnly\.set\(/.test(swift(name)));
    expect(setters).toEqual(["AiNetPlugin.swift"]);
  });

  it("answers a model request for anyone but this device before anything is built for it", () => {
    const request = swiftMethod(swift("AiNetPlugin.swift"), "request");
    const refused = request.indexOf("if AiLocalOnly.on && !AiLocalOnly.onThisDevice(url.host) {");
    expect(refused).toBeGreaterThan(request.indexOf("AiNetPlugin.urlAllowed(endpoint, url)"));
    expect(request.slice(refused)).toMatch(/^if AiLocalOnly\.on && !AiLocalOnly\.onThisDevice\(url\.host\) \{\s*call\.resolve\(\["type": "failed", "code": "local_only", "message": "[^"]+"\]\); return/);
    expect(request.indexOf("URLRequest(url:")).toBeGreaterThan(refused);
  });

  it("refuses in every other plugin that sends something for the assistant", () => {
    const refusal = /if AiLocalOnly\.on \{ call\.reject\("local_only"\); return \}/;
    expect(swiftMethod(swift("AiWebPlugin.swift"), "fetchPage")).toMatch(refusal);
    expect(swiftMethod(swift("AiMcpPlugin.swift"), "request")).toMatch(refusal);
    for (const name of ["document", "issuer", "begin", "finish", "renew"]) expect(swiftMethod(swift("AiMcpAuthPlugin.swift"), name).trimStart(), name).toMatch(new RegExp(`^${refusal.source}`));
  });
});

describe("patience for a model on this device", () => {
  it("is one rule on all three native sides: fifteen minutes of silence here, three for everyone else", () => {
    const egress = tauri("ai_egress.rs");
    const shipped = egress.slice(0, egress.indexOf("#[cfg(test)]"));
    expect(shipped).toContain("const IDLE_TIMEOUT: Duration = Duration::from_secs(180);");
    expect(shipped).toContain("const LOCAL_IDLE_TIMEOUT: Duration = Duration::from_secs(900);");
    expect(shipped).toMatch(/fn silence_limit\(endpoint: &Endpoint\) -> Duration \{\s*if on_this_device\(endpoint\) \{\s*LOCAL_IDLE_TIMEOUT\s*\} else \{\s*IDLE_TIMEOUT\s*\}\s*\}/);
    const http = rustCommand(egress, "ai_http");
    expect(http).toContain("let idle = silence_limit(&endpoint);");
    // Every wait of a request — for its answer, for an error's body, for the next piece — is held against that one limit.
    expect(http.match(/tokio::time::timeout\(idle, /g)).toHaveLength(3);
    expect(http).not.toContain("IDLE_TIMEOUT");

    const rules = java("AiNetRules.java");
    expect(rules).toContain("static final int SILENCE_SECONDS = 180;");
    expect(rules).toContain("static final int LOCAL_SILENCE_SECONDS = 900;");
    expect(rules).toMatch(/static int silenceSeconds\(String host\) \{\s*return onThisDevice\(host\) \? LOCAL_SILENCE_SECONDS : SILENCE_SECONDS;\s*\}/);
    const plugin = java("AiNetPlugin.java");
    expect(plugin).toContain(".readTimeout(AiNetRules.SILENCE_SECONDS, TimeUnit.SECONDS)");
    expect(plugin).toContain("client.newBuilder().readTimeout(AiNetRules.LOCAL_SILENCE_SECONDS, TimeUnit.SECONDS).build();");
    expect(javaMethod(plugin, "request")).toContain("(AiNetRules.silenceSeconds(url.host()) == AiNetRules.LOCAL_SILENCE_SECONDS ? patient : client).newCall(");

    const ios = swift("AiNetPlugin.swift");
    expect(ios).toContain("static let silence: TimeInterval = 180");
    expect(ios).toContain("static let localSilence: TimeInterval = 900");
    expect(ios).toContain("config.timeoutIntervalForRequest = AiLocalOnly.silence");
    expect(swiftMethod(ios, "request")).toContain("if AiLocalOnly.onThisDevice(url.host) { request.timeoutInterval = AiLocalOnly.localSilence }");
  });
});

describe("the phone's bridge", () => {
  it("tells the plugin what the switch says, and the session is given that way", () => {
    const bridge = read("apps", "mobile", "src", "platform", "aiNet.ts");
    expect(bridge).toContain("setLocalOnly(options: { on: boolean }): Promise<void>;");
    expect(bridge).toContain("await AiNet.setLocalOnly({ on });");
    expect(read("apps", "mobile", "src", "services", "ai", "mobileAi.ts")).toContain("localOnly: setMobileLocalOnly,");
  });
});
