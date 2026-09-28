import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_APP_SETTINGS, type AiEgress } from "@plainva/core";
import { AiSession } from "@plainva/ui";

/**
 * The key boundary of the AI egress, as a test (plan KI-Harness P1a gate,
 * ADR 0016): no provider key reaches the web view — not as a return value, not
 * in an event, not in an error text — and none ends up in a log or a prompt.
 *
 * The key crosses the boundary exactly once, inward, when the user types it.
 * Everything after that is native: the desktop's `ai_egress.rs`, Android's
 * `AiNetPlugin.java`, iOS's `AiNetPlugin.swift`. Those three cannot run here,
 * so their contract is checked on the source, the way `iosPluginBridge` checks
 * the bridge: every command or method that answers the web view answers with
 * a unit, a flag or scrubbed text, and the generic secret stores cannot open
 * the AI slots. The web-view side is checked by behaviour.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(repo, ...parts), "utf8");

const rust = read("apps", "desktop", "src-tauri", "src", "ai_egress.rs");
const secureStore = read("apps", "desktop", "src-tauri", "src", "secure_store.rs");
const android = read("apps", "mobile", "android", "app", "src", "main", "java", "com", "plainva", "app", "AiNetPlugin.java");
const androidSecureStore = read("apps", "mobile", "android", "app", "src", "main", "java", "com", "plainva", "app", "SecureStorePlugin.java");
const ios = read("apps", "mobile", "ios", "App", "App", "AiNetPlugin.swift");
const iosSecureStore = read("apps", "mobile", "ios", "App", "App", "SecureStorePlugin.swift");
const coreEgress = read("packages", "core", "src", "ai", "egress.ts");
const mobileBridge = read("apps", "mobile", "src", "platform", "aiNet.ts");

describe("desktop: the Rust egress", () => {
  it("answers every command with a unit or a flag, never a string", () => {
    const commands = [...rust.matchAll(/#\[tauri::command\]\s*pub (?:async )?fn (\w+)\(([^)]*)\)\s*->\s*([^{]+?)\s*\{/g)];
    expect(commands.map((c) => c[1]).sort()).toEqual([
      "ai_endpoint_add",
      "ai_endpoint_remove",
      "ai_http",
      "ai_http_cancel",
      "ai_key_delete",
      "ai_key_present",
      "ai_key_set",
    ]);
    for (const [, name, , returns] of commands) expect(returns, name).toMatch(/^Result<(\(\)|bool), String>$/);
  });

  it("streams only status, raw provider text and scrubbed error text", () => {
    const start = rust.indexOf("pub enum AiChunk");
    const chunk = rust.slice(start, rust.indexOf("\n}", start));
    const fields = [...chunk.matchAll(/(\w+): (\w+)/g)].map((m) => `${m[1]}:${m[2]}`).sort();
    expect(fields).toEqual(["body:String", "code:String", "message:String", "retry_after:Option", "status:u16", "status:u16", "text:String"]);
    const built = rust.split("\n").filter((line) => /AiChunk::(Failed|HttpError) \{/.test(line));
    for (const line of built) {
      // Text from the network or the provider goes through `redact`; fixed texts are literals.
      if (/to_string\(\)|&text/.test(line)) expect(line).toMatch(/(message|body): redact\(/);
    }
    // The failed send, the provider's refusal and a stream that breaks.
    expect(built.filter((line) => line.includes("redact(")).length).toBe(3);
  });

  it("keeps the generic keychain commands away from the AI slots", () => {
    const commands = [...secureStore.matchAll(/#\[tauri::command\]\s*pub fn (keychain_\w+)\(([^)]*)\)[^{]*\{([\s\S]*?)\n\}/g)];
    expect(commands.map((c) => c[1]).sort()).toEqual(["keychain_compare_and_set", "keychain_delete", "keychain_get", "keychain_set"]);
    for (const [, name, , body] of commands) expect(body, name).toContain("generic(&key)?");
    expect(secureStore).toMatch(/fn generic\(key: &str\)[\s\S]*?starts_with\(crate::ai_egress::AI_KEY_PREFIX\)/);
    // The slot readers the egress uses are crate-private, never commands.
    expect(secureStore).toMatch(/pub\(crate\) fn read_slot/);
    expect(secureStore).toMatch(/pub\(crate\) fn write_slot/);
  });
});

describe("Android: AiNetPlugin", () => {
  it("keeps the keys in a box of its own", () => {
    expect(android).toMatch(/new KeystoreBox\(getContext\(\), "plainva_ai_keys", "plainva_ai_keys"\)/);
    expect(androidSecureStore).toMatch(/KEY_ALIAS = "plainva_secrets"/);
    expect(androidSecureStore).toMatch(/PREFS = "plainva_secure"/);
  });

  it("answers with flags, status and scrubbed text only", () => {
    const puts = [...android.matchAll(/\b\w+\.put\("(\w+)", ([^;]+)\);/g)];
    const names = new Set(puts.map((p) => p[1]));
    expect([...names].sort()).toEqual(["added", "body", "cancelled", "code", "message", "present", "retryAfter", "status", "store", "text", "type"]);
    for (const [, name, value] of puts) {
      if (name === "present") expect(value).toMatch(/!= null$/);
      if (name === "body" || (name === "message" && !value.startsWith("message"))) expect(value, name).toMatch(/^redact\(/);
    }
  });
});

describe("iOS: AiNetPlugin", () => {
  it("keeps the keys in a keychain service of its own", () => {
    const service = /keyService = "([^"]+)"/.exec(ios)?.[1];
    const secure = /service = "([^"]+)"/.exec(iosSecureStore)?.[1];
    expect(service).toBeTruthy();
    expect(service).not.toBe(secure);
  });

  it("answers with flags, status and scrubbed text only", () => {
    const answers = [...ios.matchAll(/resolve\(\[([^\]]*)\]\)/g)].map((m) => m[1]!);
    expect(answers.length).toBeGreaterThan(8);
    for (const answer of answers) {
      for (const [, name, value] of answer.matchAll(/"(\w+)": ([^,]+(?:\([^)]*\))?)/g)) {
        expect(["type", "code", "message", "status", "body", "retryAfter", "text", "present", "cancelled", "added"], name).toContain(name);
        if (name === "present") expect(value).toMatch(/!= nil$/);
        if ((name === "message" || name === "body") && !value!.startsWith('"')) expect(value, name).toMatch(/^AiNetPlugin\.redact\(/);
      }
    }
  });
});

describe("the web view's side", () => {
  it("has no method that could return a key", () => {
    const iface = coreEgress.slice(coreEgress.indexOf("export interface AiEgress"), coreEgress.indexOf("\n}", coreEgress.indexOf("export interface AiEgress")));
    const returns = [...iface.matchAll(/\): (Promise<[^>]+>);/g)].map((m) => m[1]);
    expect(returns.length).toBe(7);
    for (const type of returns) expect(["Promise<void>", "Promise<boolean>"]).toContain(type);
    // The phone's bridge: object answers carry flags only (the string is Capacitor's callback id).
    const nativeAnswers = [...mobileBridge.matchAll(/Promise<\{ (\w+): (\w+) \}>/g)];
    expect(nativeAnswers.length).toBe(3);
    for (const [, , type] of nativeAnswers) expect(type).toBe("boolean");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands a typed key to the egress once and keeps it nowhere — not in state, settings, log or request", async () => {
    const key = "sk-test-3f9a1c7e5b2d4a6c8e0f";
    const logged: unknown[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      });
    }
    const received: string[] = [];
    const sent: unknown[] = [];
    const stored = new Set<string>();
    const egress: AiEgress = {
      async send(_id, spec, onChunk) {
        sent.push(spec);
        onChunk({ type: "failed", code: "network", message: "offline" });
      },
      async cancel() {},
      async setKey(id, value) {
        received.push(value);
        stored.add(id);
      },
      async hasKey(id) {
        return stored.has(id);
      },
      async deleteKey(id) {
        stored.delete(id);
      },
      async addEndpoint() {
        return true;
      },
      async removeEndpoint() {},
    };
    let settings: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic"], profiles: { balanced: { providerId: "anthropic", model: "m" } } };
    const session = new AiSession({
      egress,
      async loadSettings() {
        return settings;
      },
      async saveSettings(next) {
        settings = next;
      },
      defaults: DEFAULT_AI_APP_SETTINGS,
      language: () => "English",
      today: () => "2026-09-24",
      now: () => new Date("2026-09-24T10:00:00Z"),
      newId: () => "c1",
    });
    await session.load();
    await session.setKey("anthropic", `  ${key}\n`);
    await session.testProvider("anthropic");

    expect(received).toEqual([key]);
    expect(session.getState().keys.anthropic).toBe(true);
    const everything = JSON.stringify([session.getState(), settings, sent, logged.map(String)]);
    expect(everything).not.toContain(key);
    expect(everything).not.toContain(key.slice(-8));
  });
});
