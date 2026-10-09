import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import { AI_EMBEDDING_PROFILE, DEFAULT_AI_APP_SETTINGS, SEMANTIC_BY_PROVIDER, providerById, type AiAppSettings } from "@plainva/core";
import { describesItself, modeFacts, profileFacts, readStatedWindow, searchRests, statedChoice, STATED_WINDOW_BOUNDS, type AiMcpServer, type AiState } from "@plainva/ui";
import { CLOUD, LOCAL, mcpSession } from "./mcpSessionHarness";

/**
 * The mode a device is in, as both shells say it (plan KI-Harness P7, ADR
 * 0030, mockup chapter 23): one line for what holds now, and — while the
 * device is fully local — what of the user's own set-up rests. One model for
 * the desktop's card and the phone's group.
 */

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);
let base: AiState;

beforeAll(async () => {
  await i18n.changeLanguage("en");
  base = (await mcpSession([], { profiles: {} })).s.getState();
});

const settings = (patch: Partial<AiAppSettings>): AiAppSettings => ({ ...DEFAULT_AI_APP_SETTINGS, enabled: true, ...patch });
const state = (patch: Partial<AiAppSettings>, more: Partial<AiState> = {}): AiState => ({ ...base, keys: {}, settings: settings(patch), ...more });
const facts = (patch: Partial<AiAppSettings>, more: Partial<AiState> = {}) => modeFacts(t, state(patch, more), "en");

describe("the line that says what holds now", () => {
  it("says that nothing is set up yet", () => {
    expect(facts({})).toMatchObject({ mode: "none", localOnly: false, empty: false, title: "Now: no model is set up yet", rests: [] });
  });

  it("says Cloud where a provider answers and this device computes nothing itself", () => {
    const now = facts({ providers: ["anthropic"], profiles: { balanced: CLOUD } });
    expect(now.title).toBe("Now: Cloud — a provider answers");
    expect(now.body).toBe("New conversations start with Anthropic · m-1. This device computes nothing for the AI itself.");
  });

  it("says Hybrid once this device computes something itself, and names what", () => {
    expect(facts({ profiles: { balanced: CLOUD }, semanticModel: "granite-r2-97m" }).body).toBe("New conversations start with Anthropic · m-1. This device computes itself: search by meaning.");
    const all = facts({ profiles: { balanced: CLOUD, local: LOCAL }, semanticModel: "granite-r2-97m", gists: true });
    expect(all.title).toBe("Now: Hybrid — this device sorts, a provider answers");
    expect(all.body).toBe("New conversations start with Anthropic · m-1. This device computes itself: search by meaning, reading e-mails and appointments (granite3.3:8b), and the gists.");
  });

  it("says that a model on this device answers — and that nothing is promised by it", () => {
    const now = facts({ profiles: { balanced: LOCAL } });
    expect(now).toMatchObject({ mode: "device", title: "Now: a model on this device answers — without a promise" });
    expect(now.body).toContain("New conversations start with Ollama · granite3.3:8b.");
    expect(now.body).toContain("“Fully local” turns this into a promise.");
  });

  it("says Fully local with the model that answers, by the profile that names it", () => {
    const now = facts({ localOnly: true, profiles: { balanced: CLOUD, local: LOCAL } });
    expect(now).toMatchObject({ mode: "local", localOnly: true, empty: false, title: "Now: Fully local — nothing leaves this device" });
    expect(now.body).toBe("Ollama · granite3.3:8b answers, the model of the profile “Local”.");
    // The default profile where its model runs here.
    expect(facts({ localOnly: true, profiles: { balanced: LOCAL } }).body).toBe("Ollama · granite3.3:8b answers, the model of the profile “Balanced”.");
  });

  it("says what is missing where no model is on this device, and offers the way there", () => {
    const now = facts({ localOnly: true, profiles: { balanced: CLOUD } });
    expect(now).toMatchObject({ mode: "local", empty: true, title: "Now: Fully local — and no model is set up on this device" });
    expect(now.body).toBe("Until one is, the AI cannot answer. Search, related notes and everything that needs no model go on.");
  });
});

describe("what rests while the device is fully local", () => {
  it("lists nothing while the switch is off, whatever is set up", () => {
    expect(facts({ providers: ["anthropic"], profiles: { balanced: CLOUD }, mcpEnabled: true, systemFind: true }, { web: { ...base.web, enabled: true } }).rests).toEqual([]);
  });

  it("lists nothing where everything that is set up stays on this device anyway", () => {
    expect(facts({ localOnly: true, providers: ["ollama"], profiles: { balanced: LOCAL }, semanticModel: "granite-r2-97m" }).rests).toEqual([]);
  });

  it("names the providers that receive nothing, and the profiles that do not answer", () => {
    const one = facts({ localOnly: true, providers: ["anthropic", "ollama"], profiles: { balanced: CLOUD, local: LOCAL } }).rests;
    expect(one).toEqual([{ kind: "providers", label: "Anthropic", desc: "Stays set up and receives nothing. This profile does not answer: Balanced." }]);
    const two = facts({ localOnly: true, providers: ["anthropic", "openai", "ollama"], profiles: { balanced: CLOUD, strong: CLOUD, audio: { providerId: "openai", model: "gpt-4o-transcribe" }, local: LOCAL } }).rests;
    expect(two).toEqual([{ kind: "providers", label: "Anthropic and OpenAI", desc: "Stay set up and receive nothing. These profiles do not answer: Balanced, Strong, and Audio." }]);
    // A provider that is on the list without a profile rests as well: it would be asked by a connection test.
    expect(facts({ localOnly: true, providers: ["openrouter"], profiles: { balanced: LOCAL } }).rests).toEqual([{ kind: "providers", label: "OpenRouter", desc: "Stays set up and receives nothing." }]);
  });

  it("names every other thing that has a way out of its own — only where it is set up", () => {
    const embedding = { [AI_EMBEDDING_PROFILE]: { providerId: "openai", model: "text-embedding-3-small" } };
    const rests = facts(
      { localOnly: true, profiles: { balanced: LOCAL, ...embedding }, semanticModel: SEMANTIC_BY_PROVIDER, mcpEnabled: true, systemFind: true },
      {
        web: { ...base.web, enabled: true },
        mcp: { ...base.mcp, available: true, servers: [{ id: "tracker" } as AiMcpServer] },
        agents: { ...base.agents, available: true, agents: [{ id: "gemini", label: "Gemini CLI", program: "/usr/local/bin/gemini", args: [], known: null }] },
      },
    ).rests;
    expect(rests.map((rest) => `${rest.kind}: ${rest.label}`)).toEqual([
      "providers: OpenAI",
      "web: Internet",
      "mcp: External tools (MCP)",
      "agents: External agents",
      "apps: AI apps on this computer",
      "search: Semantic search",
      "system: Siri & Shortcuts",
    ]);
    expect(rests.find((rest) => rest.kind === "search")!.desc).toBe("It computes with OpenAI, so search stays with the words. With a package on this device it goes on.");
    // The profile of search by meaning answers nobody: it is not among "the profiles that do not answer".
    expect(rests[0]!.desc).toBe("Stays set up and receives nothing.");
  });

  it("knows when search by meaning rests: through a provider that is not this device, and only while the switch is on", () => {
    const cloud = { [AI_EMBEDDING_PROFILE]: { providerId: "openai", model: "e" } };
    const here = { [AI_EMBEDDING_PROFILE]: { providerId: "ollama", model: "e" } };
    expect(searchRests(settings({ localOnly: true, semanticModel: SEMANTIC_BY_PROVIDER, profiles: cloud }))).toBe(true);
    expect(searchRests(settings({ localOnly: false, semanticModel: SEMANTIC_BY_PROVIDER, profiles: cloud }))).toBe(false);
    expect(searchRests(settings({ localOnly: true, semanticModel: SEMANTIC_BY_PROVIDER, profiles: here }))).toBe(false);
    expect(searchRests(settings({ localOnly: true, semanticModel: "granite-r2-97m", profiles: cloud }))).toBe(false);
    expect(searchRests(settings({ localOnly: true, semanticModel: null, profiles: cloud }))).toBe(false);
  });
});

describe("what a user says about a model on a server of this device", () => {
  const ollama = providerById("ollama", []);
  const named = { providerId: "ollama", model: "gemma3:12b" };

  it("is asked only of such a model: a provider's list and the system's own model say it themselves", () => {
    expect(describesItself(ollama)).toBe(false);
    expect(describesItself(providerById("lmstudio", []))).toBe(false);
    expect(describesItself(providerById("anthropic", []))).toBe(true);
    expect(describesItself(providerById("apple", []))).toBe(true);
    expect(describesItself(undefined)).toBe(true);
  });

  it("reads a window as it is typed, and nothing as unknown", () => {
    expect(readStatedWindow("")).toEqual({ ok: true, value: undefined });
    expect(readStatedWindow("   ")).toEqual({ ok: true, value: undefined });
    for (const typed of ["8192", " 8192 ", "8 192", "8.192", "8,192", "8'192"]) expect(readStatedWindow(typed), typed).toEqual({ ok: true, value: 8192 });
    expect(readStatedWindow("1.048.576")).toEqual({ ok: true, value: 1_048_576 });
    expect(readStatedWindow(String(STATED_WINDOW_BOUNDS.min))).toEqual({ ok: true, value: STATED_WINDOW_BOUNDS.min });
    expect(readStatedWindow(String(STATED_WINDOW_BOUNDS.max))).toEqual({ ok: true, value: STATED_WINDOW_BOUNDS.max });
    // Not a window: too small, too large, no whole number, no number at all. "4096.0" is not forty thousand.
    for (const typed of ["512", String(STATED_WINDOW_BOUNDS.max + 1), "4096.0", "8k", "-8192", "8192 tokens", "81,92"]) expect(readStatedWindow(typed), typed).toEqual({ ok: false });
  });

  it("goes into the choice only where it says something, and never for a model that describes itself", () => {
    expect(statedChoice(ollama, named, { window: 8192, tools: false })).toEqual({ ...named, contextTokens: 8192, tools: false });
    expect(statedChoice(ollama, named, { window: undefined, tools: true })).toEqual(named);
    expect(statedChoice(providerById("anthropic", []), { providerId: "anthropic", model: "m" }, { window: 8192, tools: false })).toEqual({ providerId: "anthropic", model: "m" });
  });

  it("stands in the profile's line", () => {
    const format = (value: number) => new Intl.NumberFormat("en").format(value);
    expect(profileFacts(t, { ...named, contextTokens: 8192, tools: false }, format)).toEqual(["window 8,192", "no tools"]);
    expect(profileFacts(t, named, format)).toEqual([]);
    expect(profileFacts(t, undefined, format)).toEqual([]);
  });
});
