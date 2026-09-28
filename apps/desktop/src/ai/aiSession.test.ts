import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_APP_SETTINGS,
  effectivePolicy,
  notePolicyFrom,
  readConversationRecord,
  type AiEgress,
  type ConversationRecord,
  type EgressChunk,
  type HttpRequestSpec,
  type LedgerEntry,
} from "@plainva/core";
import { AiSession, type AiVaultHost } from "@plainva/ui";

/** An Anthropic-shaped answer: text only. */
function answer(text: string): EgressChunk[] {
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { usage: { input_tokens: 50 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return [{ type: "open", status: 200 }, { type: "data", text: events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") }, { type: "done" }];
}

function fakeEgress(script: EgressChunk[][]) {
  const sent: HttpRequestSpec[] = [];
  const keys = new Set<string>(["anthropic"]);
  const egress: AiEgress = {
    async send(_id, spec, onChunk) {
      sent.push(spec);
      for (const chunk of script.shift() ?? [{ type: "failed", code: "network", message: "offline" }]) onChunk(chunk);
    },
    async cancel() {},
    async setKey(id) {
      keys.add(id);
    },
    async hasKey(id) {
      return keys.has(id);
    },
    async deleteKey(id) {
      keys.delete(id);
    },
    async addEndpoint() {
      return true;
    },
    async removeEndpoint() {},
  };
  return { egress, sent, keys };
}

const files: Record<string, string> = {
  "Offer.md": "# Offer\n\nRates as in [[Salaries]].",
  "Salaries.md": "---\nplainva:\n  ai:\n    cloud: deny\n---\nsecret",
  "Plan.md": "# Plan",
};

function vaultHost(active: string | null) {
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  const note = (path: string) => (files[path] ? { path, title: path.replace(/\.md$/, ""), text: files[path]! } : null);
  const host: AiVaultHost = {
    conversations: {
      async list() {
        return [...saved.values()].map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, providerId: r.providerId, model: r.model }));
      },
      async load(id) {
        const r = saved.get(id);
        return r ? readConversationRecord(JSON.parse(JSON.stringify(r))) : null;
      },
      async save(record) {
        saved.set(record.id, JSON.parse(JSON.stringify(record)));
      },
      async remove(id) {
        saved.delete(id);
      },
      async removeAll() {
        saved.clear();
      },
    },
    ledger: {
      async load() {
        return ledger;
      },
      async save(entries) {
        ledger = [...entries];
      },
    },
    async activeNote() {
      return active ? note(active) : null;
    },
    async readNote(path) {
      return note(path);
    },
    policy: {
      async policyOf(path, text) {
        const t = text ?? files[path] ?? "";
        return effectivePolicy(path, notePolicyFrom(t.includes("cloud: deny") ? { plainva: { ai: { cloud: "deny" } } } : {}), []);
      },
      async resolveLink(target) {
        return files[`${target}.md`] !== undefined ? `${target}.md` : null;
      },
    },
    tools: () => null,
  };
  return { host, saved, ledger: () => ledger };
}

function session(script: EgressChunk[][]) {
  const fake = fakeEgress(script);
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, profiles: { balanced: { providerId: "anthropic", model: "m-1" } } };
  const s = new AiSession({
    egress: fake.egress,
    async loadSettings() {
      return stored;
    },
    async saveSettings(settings) {
      stored = settings;
    },
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-09-24",
    now: () => new Date("2026-09-24T10:00:00Z"),
    newId: () => `id${++ids}`,
  });
  return { s, fake, stored: () => stored };
}

describe("the AI session", () => {
  it("sends the open note through the gate, streams the answer and keeps the conversation", async () => {
    const { s, fake } = session([answer("It is in [[Offer]].")]);
    await s.load();
    const vault = vaultHost("Offer.md");
    await s.attachVault(vault.host);
    const stop = await s.send("Where is the offer?");
    expect(stop).toEqual({ kind: "answered" });
    const body = JSON.stringify(fake.sent[0]!.body);
    expect(body).toContain("Rates as in ⟦withheld note⟧.");
    expect(body).not.toContain("Salaries");
    expect(body).not.toContain("secret");
    const state = s.getState();
    expect(state.live).toBeNull();
    expect(state.active!.conversation.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(state.active!.runs).toEqual([
      { userTurn: 0, providerId: "anthropic", model: "m-1", sent: ["Offer.md"], kept: [], usage: { inputTokens: 50, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 }, steps: 1, stop: "answered" },
    ]);
    expect(state.summaries.map((x) => x.title)).toEqual(["Where is the offer?"]);
    expect(vault.saved.get("id1")!.runs).toHaveLength(1);
    expect(vault.ledger()).toHaveLength(1);
    expect(JSON.stringify(vault.ledger())).not.toContain("offer");
  });

  it("keeps a denied open note back entirely and says so in the run", async () => {
    const { s, fake } = session([answer("I cannot see it.")]);
    await s.load();
    await s.attachVault(vaultHost("Salaries.md").host);
    await s.send("What is in this note?");
    expect(JSON.stringify(fake.sent[0]!.body)).not.toContain("Salaries");
    expect(s.getState().active!.runs[0]).toMatchObject({ sent: [], kept: ["Salaries.md"] });
  });

  it("does not resend an unchanged note, and sends pinned notes", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    await s.attachVault(vaultHost("Offer.md").host);
    await s.pin("Plan.md");
    await s.send("First");
    await s.send("Second");
    const second = fake.sent[1]!.body!.messages as Array<{ role: string; content: Array<{ text?: string }> }>;
    const lastUser = second[second.length - 1]!;
    expect(lastUser.content.map((c: { text?: string }) => c.text)).toEqual(["Second"]);
    expect(JSON.stringify(fake.sent[0]!.body)).toContain('origin=\\"vault:Plan.md\\"');
  });

  it("shows a failure as a notice and keeps the question", async () => {
    const { s } = session([[{ type: "httpError", status: 401, body: "{}" }]]);
    await s.load();
    await s.attachVault(vaultHost(null).host);
    const stop = await s.send("Hello");
    expect(stop).toEqual({ kind: "failed", failure: { kind: "invalid_key", status: 401 } });
    expect(s.getState().notice?.stop).toEqual(stop);
    expect(s.getState().active!.conversation.turns).toHaveLength(1);
  });

  it("sends nothing while switched off, without a model or without a vault", async () => {
    const off = session([]);
    await off.s.attachVault(vaultHost(null).host);
    expect(await off.s.send("Hello")).toBeNull();
    const noVault = session([]);
    await noVault.s.load();
    expect(await noVault.s.send("Hello")).toBeNull();
    expect(off.fake.sent).toHaveLength(0);
    expect(noVault.fake.sent).toHaveLength(0);
  });

  it("knows only whether a key exists, and tests a provider through its model list", async () => {
    const { s, fake } = session([[{ type: "open", status: 200 }, { type: "data", text: '{"data":[{"id":"m-1","display_name":"M1"}]}' }, { type: "done" }]]);
    await s.load();
    expect(s.getState().keys).toMatchObject({ anthropic: true, openai: false });
    const test = await s.testProvider("anthropic");
    expect(test).toMatchObject({ state: "ok", models: [{ id: "m-1", label: "M1" }] });
    expect(fake.sent[0]!.method).toBe("GET");
    await s.deleteKey("anthropic");
    expect(s.getState().keys.anthropic).toBe(false);
    expect(s.getState().tests.anthropic).toBeUndefined();
  });

  it("renames, reopens, deletes and forgets expired conversations", async () => {
    const { s } = session([answer("Hi.")]);
    await s.load();
    const vault = vaultHost(null);
    await s.attachVault(vault.host);
    await s.send("Hello");
    await s.rename("id1", "Greeting");
    s.newConversation();
    expect(s.getState().active).toBeNull();
    await s.open("id1");
    expect(s.getState().active!.title).toBe("Greeting");
    const old = vault.saved.get("id1")!;
    vault.saved.set("old", { ...old, id: "old", updatedAt: "2025-01-01T00:00:00Z", conversation: { ...old.conversation, id: "old" } });
    await s.attachVault(vault.host);
    expect(s.getState().summaries.map((x) => x.id)).toEqual(["id1"]);
    expect(vault.saved.has("old")).toBe(false);
    await s.remove("id1");
    expect(s.getState().summaries).toEqual([]);
  });

  it("starts one run for two quick presses, and ends a broken egress as a notice rather than a spinner", async () => {
    const { s, fake } = session([answer("Once.")]);
    await s.load();
    await s.attachVault(vaultHost(null).host);
    const [first, second] = await Promise.all([s.send("Hello"), s.send("Hello")]);
    expect(first).toEqual({ kind: "answered" });
    expect(second).toBeNull();
    expect(fake.sent).toHaveLength(1);

    fake.egress.send = async () => {
      throw new Error("key store unavailable");
    };
    const stop = await s.send("Again");
    expect(stop).toEqual({ kind: "failed", failure: { kind: "offline", message: "key store unavailable" } });
    expect(s.getState().live).toBeNull();
    expect(s.getState().notice?.stop.kind).toBe("failed");
    // The question stays; the next message can go out.
    const turns = s.getState().active!.conversation.turns;
    expect(turns[turns.length - 1]!.role).toBe("user");
  });
});
