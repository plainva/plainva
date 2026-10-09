import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_BUDGET } from "./context/package.js";
import { appendTurn, startConversation, withoutTools } from "./conversation.js";
import { failureFromChunk, fetchProviderJson, localOnlyEgress, runModelCall, type AiEgress, type EgressChunk } from "./egress.js";
import { modelListSpec } from "./models.js";
import { runAgent } from "./orchestrator.js";
import { contextBudgetFor } from "./platform.js";
import { BUILTIN_ENDPOINTS, type HttpRequestSpec } from "./providers.js";
import {
  AI_EMBEDDING_PROFILE,
  DEFAULT_AI_APP_SETTINGS,
  MODEL_WINDOW_MAX,
  MODEL_WINDOW_MIN,
  SEMANTIC_BY_PROVIDER,
  choiceOnDevice,
  deviceHelpers,
  initialModelChoice,
  localAnswerer,
  mcpServerOn,
  modeAnswerer,
  operatingMode,
  providerById,
  readAiAppSettings,
  runsOnDevice,
  statedModelFacts,
  systemFindOn,
  type AiAppSettings,
} from "./registry.js";
import { toolByName } from "./tools.js";
import { estimateRequestTokens, fitsWindow, WINDOW_ANSWER_ROOM } from "./window.js";

/**
 * "Fully local" in the core (plan KI-Harness P7, ADR 0030): the switch and
 * what it reads as, who answers while it is on, the state a device is in,
 * the egress that holds the promise, and the window a request to a model on
 * this device is held against.
 */

const settings = (patch: Partial<AiAppSettings>): AiAppSettings => ({ ...DEFAULT_AI_APP_SETTINGS, enabled: true, ...patch });
const cloud = { providerId: "anthropic", model: "big" };
const here = { providerId: "ollama", model: "gemma3:12b" };
const small = { providerId: "lmstudio", model: "tiny" };
const at = "2026-10-09T10:00:00Z";

function recordingEgress(chunks: EgressChunk[] = [{ type: "failed", code: "network", message: "nobody there" }]): AiEgress & { sent: HttpRequestSpec[]; managed: string[] } {
  const sent: HttpRequestSpec[] = [];
  const managed: string[] = [];
  return {
    sent,
    managed,
    async send(_id, spec, onChunk) {
      sent.push(spec);
      for (const chunk of chunks) onChunk(chunk);
    },
    async cancel(id) {
      managed.push(`cancel ${id}`);
    },
    async setKey(id) {
      managed.push(`setKey ${id}`);
    },
    async hasKey(id) {
      managed.push(`hasKey ${id}`);
      return true;
    },
    async deleteKey(id) {
      managed.push(`deleteKey ${id}`);
    },
    async addEndpoint(id) {
      managed.push(`addEndpoint ${id}`);
      return true;
    },
    async removeEndpoint(id) {
      managed.push(`removeEndpoint ${id}`);
    },
  };
}

describe("the switch and what a user says about a model", () => {
  it("is off until chosen, and a damaged value reads as off", () => {
    expect(DEFAULT_AI_APP_SETTINGS.localOnly).toBe(false);
    expect(readAiAppSettings({ localOnly: true }).localOnly).toBe(true);
    expect(readAiAppSettings({ localOnly: "yes" }).localOnly).toBe(false);
    expect(readAiAppSettings(undefined).localOnly).toBe(false);
  });

  it("keeps a stated window and a stated \"no tools\" only where they read as what they must be", () => {
    const read = readAiAppSettings({
      profiles: {
        local: { ...here, contextTokens: 8192, tools: false },
        fast: { ...small, contextTokens: 12.5, tools: true },
        strong: { ...cloud, contextTokens: MODEL_WINDOW_MIN - 1 },
        balanced: { ...cloud, contextTokens: String(MODEL_WINDOW_MAX), tools: "no" },
      },
    });
    expect(read.profiles.local).toEqual({ ...here, contextTokens: 8192, tools: false });
    expect(read.profiles.fast).toEqual(small);
    expect(read.profiles.strong).toEqual(cloud);
    expect(read.profiles.balanced).toEqual(cloud);
  });

  it("belongs to the pair of provider and model, wherever a profile names it", () => {
    const s = settings({ profiles: { balanced: cloud, local: { ...here, contextTokens: 8192, tools: false }, fast: here } });
    expect(statedModelFacts(s, "ollama", "gemma3:12b")).toEqual({ contextTokens: 8192, tools: false });
    expect(statedModelFacts(s, "ollama", "other")).toEqual({});
    expect(statedModelFacts(s, "anthropic", "big")).toEqual({});
    expect(statedModelFacts(settings({ profiles: { local: { ...here, contextTokens: 4096 } } }), "ollama", "gemma3:12b")).toEqual({ contextTokens: 4096 });
  });
});

describe("who runs on this device", () => {
  it("is a server on this computer or the system's own model, and nothing else", () => {
    expect(runsOnDevice(providerById("ollama", []))).toBe(true);
    expect(runsOnDevice(providerById("lmstudio", []))).toBe(true);
    expect(runsOnDevice(providerById("apple", []))).toBe(true);
    expect(runsOnDevice(providerById("gemini-nano", []))).toBe(true);
    for (const id of ["anthropic", "openai", "gemini", "openrouter"]) expect(runsOnDevice(providerById(id, [])), id).toBe(false);
    expect(runsOnDevice(undefined)).toBe(false);
    expect(runsOnDevice({ kind: "platform-cloud" })).toBe(false);
  });

  it("counts a server the user added by its address: this device, or not", () => {
    const custom = readAiAppSettings({
      custom: [
        { id: "custom-1", label: "Here", baseUrl: "http://localhost:8080/v1" },
        { id: "custom-2", label: "Home server", baseUrl: "https://nas.example/v1" },
      ],
    }).custom;
    expect(choiceOnDevice({ custom }, { providerId: "custom-1" })).toBe(true);
    // A server in the home network is not this device, however near it stands.
    expect(choiceOnDevice({ custom }, { providerId: "custom-2" })).toBe(false);
    expect(choiceOnDevice({ custom }, { providerId: "gone" })).toBe(false);
    expect(choiceOnDevice({ custom }, null)).toBe(false);
  });
});

describe("who answers", () => {
  it("is the default profile, else the first filled one, while the switch is off", () => {
    expect(initialModelChoice(settings({ profiles: { balanced: cloud, local: here } }))).toEqual(cloud);
    expect(initialModelChoice(settings({ profiles: { local: here } }))).toEqual(here);
    expect(initialModelChoice(settings({}))).toBeNull();
  });

  it("is one of the user's own choices that runs here while the device is fully local", () => {
    // The default profile where its model runs here …
    expect(localAnswerer(settings({ defaultProfile: "strong", profiles: { strong: here, local: small } }))).toEqual({ profile: "strong", choice: here });
    // … else the profile "Local" …
    expect(localAnswerer(settings({ profiles: { balanced: cloud, fast: small, local: here } }))).toEqual({ profile: "local", choice: here });
    // … else the first chat profile whose model does.
    expect(localAnswerer(settings({ profiles: { balanced: cloud, strong: here } }))).toEqual({ profile: "strong", choice: here });
    expect(localAnswerer(settings({ profiles: { balanced: cloud } }))).toBeNull();
    expect(initialModelChoice(settings({ localOnly: true, profiles: { balanced: cloud, local: here } }))).toEqual(here);
  });

  it("never picks a model for the user: where none runs here, the ordinary choice stays named and is refused", () => {
    const s = settings({ localOnly: true, profiles: { balanced: cloud } });
    expect(initialModelChoice(s)).toEqual(cloud);
    expect(modeAnswerer(s)).toBeNull();
    expect(initialModelChoice(settings({ localOnly: true }))).toBeNull();
  });
});

describe("the state a device is in", () => {
  it("names what the user's own choices amount to, and only \"local\" is chosen", () => {
    expect(operatingMode(settings({}))).toBe("none");
    expect(operatingMode(settings({ profiles: { balanced: cloud } }))).toBe("cloud");
    expect(operatingMode(settings({ profiles: { balanced: cloud, local: here } }))).toBe("hybrid");
    expect(operatingMode(settings({ profiles: { balanced: cloud }, semanticModel: "granite-r2-97m" }))).toBe("hybrid");
    expect(operatingMode(settings({ profiles: { balanced: here } }))).toBe("device");
    expect(operatingMode(settings({ localOnly: true, profiles: { balanced: cloud } }))).toBe("local");
    expect(operatingMode(settings({ localOnly: true }))).toBe("local");
  });

  it("lists what this device computes itself", () => {
    expect(deviceHelpers(settings({ profiles: { balanced: cloud } }))).toEqual([]);
    expect(deviceHelpers(settings({ semanticModel: "granite-r2-97m" }))).toEqual(["search"]);
    // Search by meaning through a provider is this device's own only where that provider is.
    expect(deviceHelpers(settings({ semanticModel: SEMANTIC_BY_PROVIDER, profiles: { [AI_EMBEDDING_PROFILE]: { providerId: "openai", model: "e" } } }))).toEqual([]);
    expect(deviceHelpers(settings({ semanticModel: SEMANTIC_BY_PROVIDER, profiles: { [AI_EMBEDDING_PROFILE]: { providerId: "ollama", model: "e" } } }))).toEqual(["search"]);
    expect(deviceHelpers(settings({ profiles: { local: here } }))).toEqual(["reader"]);
    expect(deviceHelpers(settings({ gists: true, profiles: { local: here } }))).toEqual(["reader", "gists"]);
    // Gists are written by a model on this device or not at all.
    expect(deviceHelpers(settings({ gists: true, profiles: { local: cloud } }))).toEqual([]);
  });

  it("serves no other program and tells the system nothing while the device is fully local", () => {
    const on = settings({ mcpEnabled: true, systemFind: true });
    expect(mcpServerOn(on)).toBe(true);
    expect(systemFindOn(on)).toBe(true);
    expect(mcpServerOn({ ...on, localOnly: true })).toBe(false);
    expect(systemFindOn({ ...on, localOnly: true })).toBe(false);
    expect(mcpServerOn({ ...on, enabled: false })).toBe(false);
    expect(systemFindOn({ ...on, enabled: false })).toBe(false);
  });
});

describe("the egress that holds the promise", () => {
  const onDevice = (id: string) => runsOnDevice(providerById(id, []));
  const spec = (endpointId: string): HttpRequestSpec => ({ endpointId, url: "https://example.test/v1/x", method: "POST", headers: {}, body: { model: "m" }, auth: null, stream: true });

  it("hands every request on while the switch is off", async () => {
    const inner = recordingEgress();
    const egress = localOnlyEgress(inner, { on: () => false, onDevice });
    await egress.send("r1", spec("anthropic"), () => undefined);
    await egress.send("r2", spec("ollama"), () => undefined);
    expect(inner.sent.map((s) => s.endpointId)).toEqual(["anthropic", "ollama"]);
  });

  it("answers a request for anyone but this device itself, and hands it to nobody", async () => {
    const inner = recordingEgress();
    const egress = localOnlyEgress(inner, { on: () => true, onDevice });
    const chunks: EgressChunk[] = [];
    for (const id of ["anthropic", "openai", "gemini", "openrouter", "custom-9", ""]) await egress.send(`r-${id}`, spec(id), (chunk) => chunks.push(chunk));
    expect(inner.sent).toEqual([]);
    expect(chunks).toHaveLength(6);
    for (const chunk of chunks) expect(chunk).toMatchObject({ type: "failed", code: "local_only" });
    await egress.send("r", spec("ollama"), () => undefined);
    await egress.send("r", spec("apple"), () => undefined);
    expect(inner.sent.map((s) => s.endpointId)).toEqual(["ollama", "apple"]);
  });

  it("is asked for every request anew: switched on in between, the next one stays", async () => {
    let on = false;
    const inner = recordingEgress();
    const egress = localOnlyEgress(inner, { on: () => on, onDevice });
    await egress.send("r1", spec("openai"), () => undefined);
    on = true;
    await egress.send("r2", spec("openai"), () => undefined);
    expect(inner.sent).toHaveLength(1);
  });

  it("still manages keys and servers: managing sends nothing", async () => {
    const inner = recordingEgress();
    const egress = localOnlyEgress(inner, { on: () => true, onDevice });
    await egress.setKey("anthropic", "k");
    await egress.hasKey("anthropic");
    await egress.deleteKey("anthropic");
    await egress.addEndpoint("custom-1", "https://example.test/v1");
    await egress.removeEndpoint("custom-1");
    await egress.cancel("r1");
    expect(inner.managed).toEqual(["setKey anthropic", "hasKey anthropic", "deleteKey anthropic", "addEndpoint custom-1", "removeEndpoint custom-1", "cancel r1"]);
  });

  it("reads as a failure of its own in a model call and in a connection test", async () => {
    expect(failureFromChunk("local_only", "x")).toEqual({ kind: "local_only" });
    const egress = localOnlyEgress(recordingEgress(), { on: () => true, onDevice });
    const anthropic = BUILTIN_ENDPOINTS.find((e) => e.id === "anthropic")!;
    const conversation = appendTurn(startConversation("c", "system", []), { role: "user", parts: [{ type: "text", text: "Hello" }], at });
    const call = await runModelCall(egress, anthropic, { model: "m", conversation, tools: [], maxOutputTokens: 100 }, () => undefined, { requestId: "r1" });
    expect(call.failure).toEqual({ kind: "local_only" });
    expect(await fetchProviderJson(egress, modelListSpec(anthropic), "t1")).toEqual({ ok: false, failure: { kind: "local_only" } });
  });
});

describe("the window of a model on this device", () => {
  const ollama = BUILTIN_ENDPOINTS.find((e) => e.id === "ollama")!;
  const talk = (text: string, tools: string[] = []) => appendTurn(startConversation("c", "You answer from the notes.", tools), { role: "user", parts: [{ type: "text", text }], at });
  const manifests = (names: string[]) => names.map((name) => toolByName(name)!);

  it("counts the instructions, every turn as it is sent, and the tools with their schemas", () => {
    const plain = estimateRequestTokens(talk("Find the offer"), []);
    expect(plain).toBeGreaterThan(8);
    expect(plain).toBeLessThan(40);
    const longer = estimateRequestTokens(talk("Find the offer ".repeat(100)), []);
    expect(longer).toBeGreaterThan(plain + 300);
    const withTools = estimateRequestTokens(talk("Find the offer", ["search_vault", "read_note"]), manifests(["search_vault", "read_note"]));
    expect(withTools).toBeGreaterThan(plain + 100);
    const withResult = estimateRequestTokens(
      appendTurn(appendTurn(talk("Find the offer"), { role: "assistant", parts: [{ type: "tool_call", id: "t1", name: "search_vault", args: { query: "offer" } }], at }), {
        role: "user",
        parts: [{ type: "tool_result", callId: "t1", name: "search_vault", content: "x".repeat(3_200) }],
        at,
      }),
      [],
    );
    expect(withResult).toBeGreaterThan(plain + 1_000);
    const withPicture = estimateRequestTokens(appendTurn(talk("Look"), { role: "user", parts: [{ type: "image", mime: "image/png", data: "AAAA", name: "p.png", width: 750, height: 1000 }], at }), []);
    expect(withPicture).toBeGreaterThan(1_000);
  });

  it("says whether a request fits with room for an answer, and what it would take", () => {
    const conversation = talk("word ".repeat(2_000));
    const needed = estimateRequestTokens(conversation, []) + WINDOW_ANSWER_ROOM;
    expect(fitsWindow(conversation, [], needed)).toEqual({ fits: true, needed });
    expect(fitsWindow(conversation, [], needed - 1)).toEqual({ fits: false, needed });
  });

  it("makes the context package smaller by what the request carries anyway, and never larger than the default one", () => {
    const bare = contextBudgetFor(8_192)!;
    const loaded = contextBudgetFor(8_192, 5_500)!;
    expect(loaded.evidenceChars!).toBeLessThan(bare.evidenceChars!);
    expect(loaded.activeChars!).toBeLessThan(bare.activeChars!);
    // What a request carries never counts for less than the instructions, the situation and an answer.
    expect(contextBudgetFor(8_192, 100)).toEqual(bare);
    // A window that leaves nothing still names a floor: the request is then held against the window, not cut to nothing.
    expect(contextBudgetFor(4_096, 9_000)!.evidenceChars).toBe(Math.round(1_000 * 2.6 * 0.7));
    for (const window of [4_096, 8_192, 16_384, 31_999]) {
      const budget = contextBudgetFor(window)!;
      expect(budget.evidenceChars!, String(window)).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET.evidenceChars);
      expect(budget.activeChars!, String(window)).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET.activeChars);
      expect(budget.sectionChars!, String(window)).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET.sectionChars);
    }
    expect(contextBudgetFor(32_000, 5_000)).toBeNull();
  });

  it("sends no tools to a model its user said takes none, whatever the conversation was started with", async () => {
    const egress = recordingEgress();
    const conversation = talk("Find the offer", ["search_vault", "read_note"]);
    const base = { conversation, egress, endpoint: ollama, model: "tiny", executor: { execute: async () => ({ content: "x" }) }, context: { privateContext: true, untrustedContext: true }, now: () => at };
    await runAgent(base);
    expect((egress.sent[0]!.body as { tools?: unknown[] }).tools).toHaveLength(2);
    await runAgent({ ...base, toolless: true });
    expect(egress.sent[1]!.body).not.toHaveProperty("tools");
  });

  it("reads a conversation that used tools as its words: no call, no result, and roles that alternate", async () => {
    const begun = talk("Find the offer", ["search_vault", "read_note"]);
    const called = appendTurn(begun, { role: "assistant", parts: [{ type: "text", text: "I will look." }, { type: "tool_call", id: "t1", name: "search_vault", args: { query: "offer" } }], at });
    const answered = appendTurn(called, { role: "user", parts: [{ type: "tool_result", callId: "t1", name: "search_vault", content: "Offers/Northwind.md" }], at });
    const said = appendTurn(answered, { role: "assistant", parts: [{ type: "text", text: "It is for Northwind." }], at });
    const next = appendTurn(said, { role: "user", parts: [{ type: "text", text: "And when?" }], at });
    const view = withoutTools(next);
    expect(view.tools).toEqual([]);
    expect(view.more).toBeUndefined();
    expect(view.turns.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    expect(view.turns[1]!.parts).toEqual([
      { type: "text", text: "I will look." },
      { type: "text", text: "It is for Northwind." },
    ]);
    expect(JSON.stringify(view)).not.toContain("search_vault");
    // The record itself is untouched, and a conversation of words alone is handed back as it is.
    expect(next.turns).toHaveLength(5);
    expect(next.tools).toEqual(["search_vault", "read_note"]);
    const plain = talk("Hello");
    expect(withoutTools(plain)).toBe(plain);
    // What goes out is that view: a chat request without a tool, a call or a result in it.
    const egress = recordingEgress();
    await runAgent({ conversation: next, egress, endpoint: ollama, model: "tiny", executor: { execute: async () => ({ content: "x" }) }, context: { privateContext: true, untrustedContext: true }, now: () => at, toolless: true });
    const body = egress.sent[0]!.body as { messages: Array<{ role: string; tool_calls?: unknown }>; tools?: unknown };
    expect(body.tools).toBeUndefined();
    expect(body.messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(body.messages.some((message) => message.tool_calls !== undefined)).toBe(false);
  });

  it("does not send a request that cannot fit the stated window, and says by how much it misses", async () => {
    const egress = recordingEgress();
    const conversation = talk("word ".repeat(4_000), ["search_vault"]);
    const base = { conversation, egress, endpoint: ollama, model: "tiny", executor: { execute: async () => ({ content: "x" }) }, context: { privateContext: true, untrustedContext: true }, now: () => at };
    const refused = await runAgent({ ...base, window: 4_096 });
    expect(egress.sent).toEqual([]);
    expect(refused.stop).toMatchObject({ kind: "failed", failure: { kind: "window_too_small", window: 4_096 } });
    const failure = (refused.stop as { failure: { needed: number } }).failure;
    expect(failure.needed).toBeGreaterThan(4_096);
    expect(refused.usage.steps).toBe(0);
    expect(refused.conversation).toBe(conversation);
    // The same request with a window that holds it goes out.
    await runAgent({ ...base, window: 32_000 });
    expect(egress.sent).toHaveLength(1);
    // And one without tools needs less: what "no tools" buys a small window.
    const light = fitsWindow(conversation, [], 32_000).needed;
    expect(light).toBeLessThan(failure.needed);
  });
});
