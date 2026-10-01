import { describe, expect, it } from "vitest";
import { appendTurn, DEFAULT_AI_APP_SETTINGS, EMPTY_USAGE, parsePolicyFile, readAiAppSettings, startConversation, type ConversationRecord } from "@plainva/core";
import {
  addableProviders,
  aiDefaultSettings,
  aiFailureText,
  aiVaultKey,
  configuredProviders,
  createAiVaultStores,
  createVaultPolicy,
  transcriptOf,
  unruledFolders,
  withoutRule,
  withRuleValue,
  type AiFileStore,
  type AiState,
} from "@plainva/ui";

const at = "2026-09-24T10:00:00Z";

function memoryFiles(): AiFileStore & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(p) {
      return files.get(p) ?? null;
    },
    async write(p, text) {
      files.set(p, text);
    },
    async remove(p) {
      files.delete(p);
    },
    async removeDir(p) {
      for (const key of [...files.keys()]) if (key.startsWith(`${p}/`)) files.delete(key);
    },
  };
}

function record(id: string, title: string): ConversationRecord {
  let conversation = startConversation(id, "s", ["search_vault"]);
  conversation = appendTurn(conversation, { role: "user", parts: [{ type: "text", text: "ctx", context: ["Offer.md#abc"] }, { type: "text", text: "Where is it?" }], at });
  conversation = appendTurn(conversation, { role: "assistant", parts: [{ type: "tool_call", id: "t1", name: "search_vault", args: {} }], at });
  conversation = appendTurn(conversation, { role: "user", parts: [{ type: "tool_result", callId: "t1", name: "search_vault", content: "hits" }], at });
  conversation = appendTurn(conversation, { role: "assistant", parts: [{ type: "text", text: "In [[Offer]]." }], at });
  return {
    version: 1,
    id,
    title,
    createdAt: at,
    updatedAt: at,
    providerId: "anthropic",
    model: "m",
    conversation,
    usage: EMPTY_USAGE,
    runs: [{ userTurn: 0, providerId: "anthropic", model: "m", sent: ["Offer.md"], kept: [], usage: EMPTY_USAGE, steps: 2, stop: "answered" }],
    pins: [],
  };
}

describe("conversation stores in app data", () => {
  it("keep one file per conversation and an index, per vault", async () => {
    const files = memoryFiles();
    const key = aiVaultKey("C:/Vaults/Work");
    expect(key).toMatch(/^v[0-9a-f]{16}$/);
    expect(aiVaultKey("C:/Vaults/Work")).toBe(key);
    expect(aiVaultKey("C:/Vaults/Home")).not.toBe(key);
    const { conversations, ledger } = createAiVaultStores(files, key);
    await conversations.save(record("a", "First"));
    await conversations.save(record("b", "Second"));
    expect((await conversations.list()).map((s) => s.id)).toEqual(["b", "a"]);
    expect((await conversations.load("a"))?.title).toBe("First");
    expect(await conversations.load("../../etc")).toBeNull();
    await conversations.remove("a");
    expect((await conversations.list()).map((s) => s.id)).toEqual(["b"]);
    await conversations.removeAll();
    expect(await conversations.list()).toEqual([]);
    expect([...files.files.keys()].every((p) => p.startsWith(`${key}/`))).toBe(true);
    await ledger.save([{ at, conversationId: "b", providerId: "p", model: "m", stop: "answered", steps: 1, tools: [], usage: EMPTY_USAGE }]);
    expect(await ledger.load()).toHaveLength(1);
  });

  it("survive a damaged index or transcript without throwing", async () => {
    const files = memoryFiles();
    const { conversations } = createAiVaultStores(files, "vkey");
    files.files.set("vkey/index.json", "{not json");
    files.files.set("vkey/conversations/x.json", "garbage");
    expect(await conversations.list()).toEqual([]);
    expect(await conversations.load("x")).toBeNull();
    expect(() => createAiVaultStores(files, "../x")).toThrow();
  });
});

describe("the transcript", () => {
  it("shows the user's words with their context, the steps, the answer and one line per run", () => {
    const items = transcriptOf(record("a", "t"));
    expect(items.map((i) => i.kind)).toEqual(["user", "steps", "answer", "run"]);
    expect(items[0]).toMatchObject({ text: "Where is it?", context: ["Offer.md"] });
    expect(items[1]).toMatchObject({ steps: [{ id: "t1", name: "search_vault", state: "done" }] });
  });
});

describe("the policy rules editor", () => {
  it("sets, clears and removes folder rules; the vault default is the folder \"\"", () => {
    let rules = withRuleValue([], "Finance", "cloud", "deny");
    expect(rules).toEqual([{ folder: "Finance/", cloud: "deny" }]);
    rules = withRuleValue(rules, "", "web", "deny");
    expect(rules).toEqual([{ folder: "", web: "deny" }, { folder: "Finance/", cloud: "deny" }]);
    rules = withRuleValue(rules, "Finance/", "cloud", "inherit");
    expect(rules).toEqual([{ folder: "", web: "deny" }]);
    expect(withoutRule(rules, "")).toEqual([]);
    expect(unruledFolders([{ folder: "Finance/", cloud: "deny" }], ["Finance", "Journal", ".agent", "Projects/"])).toEqual(["Journal/", "Projects/"]);
  });

  it("reads note frontmatter and folder rules together, and caches the file briefly", async () => {
    let reads = 0;
    let clock = 0;
    const policy = createVaultPolicy({
      readFile: async (path) => {
        if (path === ".agent/policy.yml") {
          reads++;
          return "folders:\n  Finance/:\n    cloud: deny\n";
        }
        return path === "Diary.md" ? "---\nplainva:\n  ai:\n    cloud: deny\n---\nx" : "plain";
      },
      resolveLink: async () => null,
      encrypted: () => false,
      now: () => clock,
    });
    expect((await policy.policyOf("Finance/Pay.md")).policy.cloud).toBe("deny");
    expect((await policy.policyOf("Diary.md")).policy.cloud).toBe("deny");
    expect((await policy.policyOf("Notes/A.md")).policy.cloud).toBe("allow");
    expect(reads).toBe(1);
    clock += 5000;
    await policy.policyOf("Notes/A.md");
    expect(reads).toBe(2);
    policy.invalidate();
    await policy.policyOf("Notes/A.md");
    expect(reads).toBe(3);
    const sealed = createVaultPolicy({ readFile: async () => null, resolveLink: async () => null, encrypted: () => true });
    expect((await sealed.policyOf("Any.md")).policy.cloud).toBe("deny");
    expect(parsePolicyFile("folders:\n  /:\n    cloud: deny\n").rules).toEqual([{ folder: "", cloud: "deny" }]);
  });
});

describe("the settings model", () => {
  const state = (patch: Partial<AiState>): AiState => ({
    loaded: true,
    settings: { ...DEFAULT_AI_APP_SETTINGS, providers: ["ollama"], custom: [{ id: "custom-1", label: "Office", baseUrl: "https://llm.example/v1", api: "openai-chat", local: false }], profiles: { strong: { providerId: "openai", model: "m" } } },
    keys: { anthropic: true, gemini: false },
    tests: {},
    summaries: [],
    active: null,
    draftPins: [],
    draftChoice: null,
    excludeActive: false,
    leaveOutNext: [],
    originalsNext: [],
    draftRedact: [],
    live: null,
    notice: null,
    dress: null,
    hasVault: true,
    consent: null,
    ...patch,
  });

  it("lists what is set up: added, with a key, used by a profile, custom", () => {
    expect(configuredProviders(state({})).map((r) => r.provider.id)).toEqual(["anthropic", "openai", "ollama", "custom-1"]);
  });

  it("starts with AI on in a Labs build only; a stored choice still wins", () => {
    const build = (channel: string) => ({ channel, commit: "", branch: "", run: "" });
    expect(aiDefaultSettings(build("labs")).enabled).toBe(true);
    expect(aiDefaultSettings(build("release")).enabled).toBe(false);
    expect(aiDefaultSettings(build("local")).enabled).toBe(false);
    expect(readAiAppSettings({ ...DEFAULT_AI_APP_SETTINGS, enabled: false }, aiDefaultSettings(build("labs"))).enabled).toBe(false);
  });

  it("offers every provider not yet on the list, local servers only where they can run", () => {
    const desktop = addableProviders(state({}), { localServers: true });
    expect(desktop.cloud.map((p) => p.id)).toEqual(["gemini"]);
    expect(desktop.gateways.map((p) => p.id)).toEqual(["openrouter"]);
    expect(desktop.local.map((p) => p.id)).toEqual(["lmstudio"]);
    expect(addableProviders(state({}), { localServers: false }).local).toEqual([]);
    // The system's own model only on its own system (plan P2c).
    expect(desktop.device).toEqual([]);
    expect(addableProviders(state({}), { localServers: false, platformOs: "ios" }).device.map((p) => p.id)).toEqual(["apple"]);
    expect(addableProviders(state({}), { localServers: false, platformOs: "android" }).device.map((p) => p.id)).toEqual(["gemini-nano"]);
  });

  it("says why the system's model is not there, in words the reader can act on", () => {
    const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? JSON.stringify(vars) : ""}`;
    expect(aiFailureText(t, { kind: "platform_unavailable", reason: "appleIntelligenceNotEnabled" }, "Apple")).toBe('ai.error.platform.appleIntelligenceNotEnabled{"provider":"Apple"}');
    expect(aiFailureText(t, { kind: "platform_unavailable", reason: "a reason of a later system" }, "Gemini Nano")).toBe('ai.error.platform.unavailable{"provider":"Gemini Nano"}');
  });
});
