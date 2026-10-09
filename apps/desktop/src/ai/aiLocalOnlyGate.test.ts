import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_APP_SETTINGS, type AiAppSettings, type AiEgress, type EgressChunk, type HttpRequestSpec } from "@plainva/core";
import { AiSession } from "@plainva/ui";
import { CLOUD, LOCAL, SEARCH, body, chat, connect, mcpSession, toolNames, turn, viaDispatch } from "./mcpSessionHarness";

/**
 * "Fully local" as a gate (plan KI-Harness P7, ADR 0030): while the switch is
 * on, nothing the assistant handles reaches anyone but this device — whatever
 * way a request takes. The promise is held at ONE place, the session's
 * egress; these cases walk the ways that lead there and the ones that never
 * get that far: a conversation, one that ran with a provider before, a
 * connection test, search by meaning's own requests, the doors beside the
 * composer, a review, a foreign server, a request that is already under way.
 *
 * The real session, the real tools and the real protocol client; a scripted
 * model and a scripted server stand in for the outside.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..");
/** Code without its comments: a rule that prose can satisfy or break is none. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const fullyLocal = (s: AiSession, on = true) => s.updateSettings((settings) => ({ ...settings, localOnly: on }));
const both = { balanced: CLOUD, local: LOCAL };
const LOCAL_ONLY = { kind: "failed", failure: { kind: "local_only" } };
/** A model list as a server answers a connection test. */
const modelList: EgressChunk[] = [{ type: "open", status: 200 }, { type: "data", text: JSON.stringify({ data: [{ id: "granite3.3:8b" }] }) }, { type: "done" }];
const elsewhere = (sent: readonly HttpRequestSpec[]) => sent.filter((spec) => spec.endpointId !== "ollama");

describe("fully local: who answers", () => {
  it("a new conversation is answered by the model on this device, whatever the default profile names", async () => {
    const { s, fake } = await mcpSession([chat({ text: "For Northwind." })], { profiles: both });
    expect(s.choice()).toEqual(CLOUD);
    await fullyLocal(s);
    expect(s.choice()).toEqual(LOCAL);
    expect(await s.send("Who is the offer for?")).toEqual({ kind: "answered" });
    expect(fake.sent.map((spec) => spec.endpointId)).toEqual(["ollama"]);
    expect(s.getState().active).toMatchObject({ providerId: "ollama", onDevice: true });
  });

  it("picks no model for the user: without one on this device nothing is sent, and the reader is told why", async () => {
    const { s, fake } = await mcpSession([turn({ text: "never read" })], { profiles: { balanced: CLOUD } });
    await fullyLocal(s);
    // The ordinary choice stays named — so the answer can say which provider is not this device.
    expect(s.choice()).toEqual(CLOUD);
    expect(await s.send("Who is the offer for?")).toEqual(LOCAL_ONLY);
    expect(fake.sent).toEqual([]);
    expect(s.getState().active).toBeNull();
    expect(s.getState().notice).toMatchObject({ stop: LOCAL_ONLY });
  });

  it("a model chosen for the next conversation counts only where it runs on this device", async () => {
    const { s } = await mcpSession([], { profiles: both });
    await s.setChoice(CLOUD);
    expect(s.newConversationChoice()).toEqual(CLOUD);
    await fullyLocal(s);
    // The switch drops the choice it cannot keep, and a later one for a provider is not taken either.
    expect(s.getState().draftChoice).toBeNull();
    await s.setChoice(CLOUD);
    expect(s.newConversationChoice()).toEqual(LOCAL);
    expect(s.choice()).toEqual(LOCAL);
  });

  it("a conversation that ran with a provider's model does not go on — and does not change its model silently", async () => {
    const { s, fake } = await mcpSession([turn({ text: "An offer for Northwind." }), chat({ text: "never read" })], { profiles: both });
    expect(await s.send("What is the offer?")).toEqual({ kind: "answered" });
    const turns = s.getState().active!.conversation.turns.length;
    await fullyLocal(s);
    expect(s.choice()).toEqual(CLOUD);
    expect(await s.send("And for whom?")).toEqual(LOCAL_ONLY);
    expect(fake.sent).toHaveLength(1);
    expect(s.getState().active!.conversation.turns).toHaveLength(turns);
    // The way on is a new conversation: it starts with the model that answers here, and carries nothing of the old one.
    s.newConversation();
    expect(s.choice()).toEqual(LOCAL);
    expect(await s.send("And for whom?")).toEqual({ kind: "answered" });
    expect(fake.sent[1]!.endpointId).toBe("ollama");
    expect(body(fake.sent[1])).not.toContain("What is the offer?");
  });

  it("switched off again, everything is as it was set up: nothing was removed, only rested", async () => {
    const { s, fake } = await mcpSession([turn({ text: "For Northwind." })], { profiles: both });
    const before = s.getState().settings;
    await fullyLocal(s);
    await fullyLocal(s, false);
    expect(s.getState().settings).toEqual(before);
    expect(s.choice()).toEqual(CLOUD);
    expect(await s.send("Who is the offer for?")).toEqual({ kind: "answered" });
    expect(fake.sent[0]!.endpointId).toBe("anthropic");
  });
});

describe("fully local: nothing reaches anyone but this device", () => {
  it("not a connection test, and not a request search by meaning sends through the session's egress", async () => {
    const { s, fake } = await mcpSession([modelList], { profiles: both });
    await fullyLocal(s);
    expect(await s.testProvider("anthropic")).toMatchObject({ state: "failed", failure: { kind: "local_only" } });
    const chunks: EgressChunk[] = [];
    await s.egress.send("e1", { endpointId: "openai", url: "https://api.openai.com/v1/embeddings", method: "POST", headers: {}, body: { input: ["a section"] }, auth: null, stream: false }, (chunk) => chunks.push(chunk));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: "failed", code: "local_only" });
    expect(fake.sent).toEqual([]);
    // The server on this computer is asked like before.
    expect((await s.testProvider("ollama")).state).toBe("ok");
    expect(fake.sent.map((spec) => spec.endpointId)).toEqual(["ollama"]);
  });

  it("not through a door: each says so before it reads, asks or builds anything", async () => {
    const { s, fake } = await mcpSession([], { profiles: { balanced: CLOUD } });
    await fullyLocal(s);
    let read = false;
    const picture = await s.explainImage({
      path: "Pictures/plan.png",
      load: async () => {
        read = true;
        return "unreadable";
      },
    });
    expect(picture).toMatchObject({ kind: "refused", reason: "failed", provider: "Anthropic" });
    expect(read).toBe(false);
    expect(await s.runSkill("plainva:daily-orientation", "What matters today?")).toEqual(LOCAL_ONLY);
    expect(await s.fillProperty({ base: "Projects/Projects.base", column: { key: "status", label: "Status", type: "text" } as never, rows: [{ path: "Projects/Offer.md", title: "Offer" }] })).toMatchObject({ kind: "done", proposed: 0, failure: { kind: "local_only" } });
    // Nobody was asked to approve a send that cannot happen.
    expect(s.getState().consent).toBeNull();
    expect(fake.sent).toEqual([]);
  });

  it("not as a review: learning from a conversation goes to the model that led it, or to none", async () => {
    const { s, fake } = await mcpSession([turn({ text: "An offer for Northwind." })], { profiles: both });
    await s.send("What is the offer?");
    const id = s.getState().active!.id;
    await fullyLocal(s);
    expect(await s.learnPlan(id)).toMatchObject({ ok: false, reason: "failed", failure: { kind: "local_only" }, provider: "Anthropic" });
    expect(await s.learnFrom(id)).toMatchObject({ kind: "refused", reason: "failed", failure: { kind: "local_only" }, provider: "Anthropic" });
    expect(fake.sent).toHaveLength(1);
  });

  it("not to a foreign server: none is offered, asked or called — the model on this device does not reach it either", async () => {
    const { s, fake, server } = await mcpSession([chat({ calls: [viaDispatch("c1", SEARCH, { query: "login" })] }), chat({ text: "I cannot reach the tracker." })], { profiles: { balanced: LOCAL } });
    await connect(s);
    expect(await s.mcp.offeredNames()).toEqual([SEARCH]);
    const asked = server.methods.length;
    await fullyLocal(s);
    expect(await s.mcp.offeredNames()).toEqual([]);
    expect(await s.mcp.manifests([SEARCH])).toEqual([]);
    expect(await s.mcp.check("tracker")).toEqual({ ok: false, reason: "not-approved" });
    await expect(s.mcp.call("tracker", "search_issues", { query: "login" }, {})).rejects.toThrow();
    await expect(s.mcp.inspect("tracker")).rejects.toThrow();
    expect(await s.startMcpPrompt("tracker", "standup", {})).toEqual({ kind: "unavailable" });
    // A conversation begun now carries none of the server's tools; a call spelled out anyway finds none.
    expect(await s.send("Search the tracker for login.")).toEqual({ kind: "answered" });
    expect(s.getState().active!.conversation.more ?? []).not.toContain(SEARCH);
    expect(body(fake.sent[0])).not.toContain(SEARCH);
    expect(server.calls).toEqual([]);
    expect(server.methods).toHaveLength(asked);
    expect(elsewhere(fake.sent)).toEqual([]);
    // What was registered and approved is still there: it rests.
    expect(s.getState().mcp.servers.map((entry) => entry.id)).toEqual(["tracker"]);
  });

  it("not from a conversation that was begun with a server's tools: they are gone for as long as the switch is on", async () => {
    const { s, server } = await mcpSession([chat({ text: "Ready." }), chat({ calls: [viaDispatch("c1", SEARCH, { query: "login" })] }), chat({ text: "The tracker is out of reach." })], { profiles: { balanced: LOCAL } });
    await connect(s);
    expect(await s.send("Hello.")).toEqual({ kind: "answered" });
    expect(s.getState().active!.conversation.more).toContain(SEARCH);
    await fullyLocal(s);
    expect(await s.send("Search the tracker for login.")).toEqual({ kind: "answered" });
    expect(server.calls).toEqual([]);
    const turns = s.getState().active!.conversation.turns;
    const result = turns.flatMap((t) => t.parts).find((part) => part.type === "tool_result");
    expect(result).toMatchObject({ isError: true });
  });

  it("not a request that is already under way: switching on stops it like the user's own STOP", async () => {
    const { s, fake } = await mcpSession([], { profiles: { balanced: CLOUD } });
    const cancelled: string[] = [];
    let started = false;
    let end: (() => void) | null = null;
    fake.egress.send = async (_id, _spec, onChunk) => {
      started = true;
      await new Promise<void>((resolve) => (end = resolve));
      onChunk({ type: "cancelled" });
    };
    fake.egress.cancel = async (id) => {
      cancelled.push(id);
      end?.();
    };
    const running = s.send("Who is the offer for?");
    for (let i = 0; i < 200 && !started; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(started).toBe(true);
    await fullyLocal(s);
    expect(cancelled).toHaveLength(1);
    expect(await running).toEqual({ kind: "cancelled" });
  });

  it("a request to the model on this device goes on when the switch is turned on", async () => {
    const { s, fake } = await mcpSession([], { profiles: { balanced: LOCAL } });
    const cancelled: string[] = [];
    let started = false;
    let end: (() => void) | null = null;
    fake.egress.send = async (_id, _spec, onChunk) => {
      started = true;
      await new Promise<void>((resolve) => (end = resolve));
      for (const chunk of chat({ text: "For Northwind." })) onChunk(chunk);
    };
    fake.egress.cancel = async (id) => {
      cancelled.push(id);
    };
    const running = s.send("Who is the offer for?");
    for (let i = 0; i < 200 && !started; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    await fullyLocal(s);
    expect(cancelled).toEqual([]);
    end!();
    expect(await running).toEqual({ kind: "answered" });
  });
});

describe("fully local: held at one place", () => {
  const session = (stored: Partial<AiAppSettings>, egress: AiEgress, told: boolean[] = []) => {
    let kept: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic", "ollama"], profiles: both, ...stored };
    let ids = 0;
    return new AiSession({
      egress,
      loadSettings: async () => kept,
      saveSettings: async (settings) => {
        kept = settings;
      },
      defaults: DEFAULT_AI_APP_SETTINGS,
      language: () => "English",
      today: () => "2026-10-09",
      now: () => new Date("2026-10-09T10:00:00Z"),
      newId: () => `id${++ids}`,
      localOnly: async (on) => {
        told.push(on);
      },
    });
  };
  const recording = () => {
    const sent: HttpRequestSpec[] = [];
    const egress: AiEgress = {
      async send(_id, spec, onChunk) {
        sent.push(spec);
        for (const chunk of modelList) onChunk(chunk);
      },
      async cancel() {},
      async setKey() {},
      hasKey: async () => true,
      async deleteKey() {},
      addEndpoint: async () => true,
      async removeEndpoint() {},
    };
    return { egress, sent };
  };

  it("the session names the host's egress once — where it puts the switch in front of it", () => {
    const source = code(readFileSync(join(repo, "packages", "ui", "src", "ai", "aiSession.ts"), "utf8"));
    expect(source.match(/\bhost\.egress\b/g)).toHaveLength(1);
    expect(source).toContain("this.out = localOnlyEgress(host.egress, {");
    // No other file of the shared AI code reaches around it.
    for (const file of ["privateData.ts", "webTools.ts", "localEmbeddings.ts"]) {
      expect(code(readFileSync(join(repo, "packages", "ui", "src", "ai", file), "utf8")), file).not.toMatch(/createDesktopAiEgress|createMobileAiEgress|registerPlugin/);
    }
  });

  it("nothing leaves before the settings are read: what the switch says is not known yet", async () => {
    const net = recording();
    const s = session({ localOnly: false }, net.egress);
    expect(await s.testProvider("anthropic")).toMatchObject({ state: "failed", failure: { kind: "local_only" } });
    expect(net.sent).toEqual([]);
    await s.load();
    expect((await s.testProvider("anthropic")).state).toBe("ok");
    expect(net.sent).toHaveLength(1);
  });

  it("the native side is told what the switch says: when the settings are read, and whenever it changes", async () => {
    const told: boolean[] = [];
    const s = session({ localOnly: true }, recording().egress, told);
    await s.load();
    expect(told).toEqual([true]);
    await s.updateSettings((settings) => ({ ...settings, historyDays: 30 }));
    expect(told).toEqual([true]);
    await fullyLocal(s, false);
    await fullyLocal(s);
    expect(told).toEqual([true, false, true]);
  });

  it("a native side that cannot be told changes nothing about what this side holds", async () => {
    const net = recording();
    let kept: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic"], profiles: { balanced: CLOUD }, localOnly: true };
    const s = new AiSession({
      egress: net.egress,
      loadSettings: async () => kept,
      saveSettings: async (settings) => {
        kept = settings;
      },
      defaults: DEFAULT_AI_APP_SETTINGS,
      language: () => "English",
      today: () => "2026-10-09",
      now: () => new Date("2026-10-09T10:00:00Z"),
      newId: () => "id",
      localOnly: () => Promise.reject(new Error("no such command")),
    });
    await s.load();
    expect(s.getState().loaded).toBe(true);
    expect(await s.testProvider("anthropic")).toMatchObject({ state: "failed", failure: { kind: "local_only" } });
    expect(net.sent).toEqual([]);
  });
});

describe("a model on this device as its user described it", () => {
  it("is sent no tools where its user said it takes none, and the conversation is begun without any", async () => {
    const quiet = { ...LOCAL, tools: false as const };
    const { s, fake } = await mcpSession([chat({ text: "For Northwind." })], { profiles: { balanced: quiet } });
    expect(await s.send("Who is the offer for?")).toEqual({ kind: "answered" });
    expect(toolNames(fake.sent[0])).toEqual([]);
    expect(fake.sent[0]!.body).not.toHaveProperty("tools");
    expect(s.getState().active!.conversation.tools).toEqual([]);
  });

  it("is sent none from then on, also in a conversation that was begun with tools", async () => {
    const { s, fake } = await mcpSession([chat({ text: "Ready." }), chat({ text: "For Northwind." })], { profiles: { balanced: LOCAL } });
    await s.send("Hello.");
    expect(toolNames(fake.sent[0]).length).toBeGreaterThan(0);
    await s.updateSettings((settings) => ({ ...settings, profiles: { ...settings.profiles, balanced: { ...LOCAL, tools: false } } }));
    expect(await s.send("Who is the offer for?")).toEqual({ kind: "answered" });
    expect(fake.sent[1]!.body).not.toHaveProperty("tools");
  });

  it("is not sent a request that cannot fit the window its user stated — the reader learns by how much it misses", async () => {
    const tiny = { ...LOCAL, contextTokens: 1_024 };
    const { s, fake } = await mcpSession([chat({ text: "never read" })], { profiles: { balanced: tiny } });
    const stop = await s.send("Who is the offer for?");
    expect(stop).toMatchObject({ kind: "failed", failure: { kind: "window_too_small", window: 1_024 } });
    expect((stop as { failure: { needed: number } }).failure.needed).toBeGreaterThan(1_024);
    expect(fake.sent).toEqual([]);
    expect(s.getState().notice).toMatchObject({ stop: { kind: "failed", failure: { kind: "window_too_small" } } });
  });

  it("is sent the request where the stated window holds it", async () => {
    const roomy = { ...LOCAL, contextTokens: 32_768 };
    const { s, fake } = await mcpSession([chat({ text: "For Northwind." })], { profiles: { balanced: roomy } });
    expect(await s.send("Who is the offer for?")).toEqual({ kind: "answered" });
    expect(fake.sent).toHaveLength(1);
  });
});
