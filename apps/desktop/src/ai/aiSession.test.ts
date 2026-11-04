import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  CONTEXT_NOTE_LIMIT,
  DEFAULT_AI_APP_SETTINGS,
  DEFAULT_CONTEXT_BUDGET,
  effectivePolicy,
  estimateTokensOfChars,
  notePolicyFrom,
  noteHash,
  readConversationRecord,
  type AiEgress,
  type ConversationRecord,
  type EgressChunk,
  type HttpRequestSpec,
  type LedgerEntry,
  EMPTY_INSTRUCTION_APPROVALS,
  EMPTY_SKILL_TESTS,
} from "@plainva/core";
import { AiSession, CHAT_TOOL_NAMES, createVaultToolExecutor, furtherToolNames, type AiVaultHost, type VaultToolDeps } from "@plainva/ui";
import { TRANSCRIPTION_MAX_BYTES } from "@plainva/core";

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

/** An answer of a system's own model (plan P2c): the platform plugins' small dialect. */
function platformAnswer(text: string): EgressChunk[] {
  return [
    { type: "open", status: 200 },
    { type: "data", text: `data: ${JSON.stringify({ text })}\n\ndata: ${JSON.stringify({ stop: "end" })}\n\n` },
    { type: "done" },
  ];
}

/** An answer of a server on this computer, as its chat endpoint streams it — with what it received. */
function serverAnswer(text: string): EgressChunk[] {
  const line = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
  return [
    { type: "open", status: 200 },
    { type: "data", text: `${line({ choices: [{ delta: { content: text } }] })}${line({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 40 } })}data: [DONE]\n\n` },
    { type: "done" },
  ];
}

/** An Anthropic answer that calls tools, one after the other. */
function callsTools(calls: { name: string; args: unknown }[]): EgressChunk[] {
  const events: Array<[string, unknown]> = [["message_start", { type: "message_start", message: { usage: { input_tokens: 50 } } }]];
  calls.forEach((call, index) => {
    events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: `call-${index + 1}`, name: call.name, input: {} } }]);
    events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(call.args) } }]);
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return [{ type: "open", status: 200 }, { type: "data", text: events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") }, { type: "done" }];
}

/** An Anthropic answer that calls one tool. */
function callsTool(name: string, args: unknown): EgressChunk[] {
  return callsTools([{ name, args }]);
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
  "Contract.md": "# Contract\n\nThe contract runs until the end of the year and renews itself.\n\nRates follow.\n",
  "Journal/2026-09-24.md": "# Thursday\n\n- 08:12 ![[Voice 2026-09-24 0812.m4a]]\n- 09:30 Call back\n",
  // A note of which a question about the rate gets only a section (plan P9-6): the rest is what choosing saves.
  "Handbook.md": `# Handbook\n\n## Intro\n\n${"Long background. ".repeat(1200).trim()}\n\n## Rates\n\nThe rate is 95 EUR per hour.\n`,
  // A template: the rates only as an empty heading, the notes long below it (plan P9-6).
  "Template.md": `# Template\n\n## Rates\n\n## Next\n\n${"Notes to come. ".repeat(1000)}`,
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
    async situation() {
      return {
        now: "2026-09-24 10:00",
        weekday: "Thursday",
        calendarDay: "2026-09-24",
        journalDay: "2026-09-24",
        active: active ? { path: active, title: active.replace(/\.md$/, ""), kind: "note" as const } : null,
        tabs: [],
        tasks: [],
        events: [],
        dailyNote: null,
      };
    },
    async candidates() {
      return [];
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

/** The vault's real tools over `files`, as a shell hands them to a run — with the search a test gives, and what else it changes. */
function withTools(host: AiVaultHost, search: VaultToolDeps["search"] = async () => [], more: Partial<VaultToolDeps> = {}): void {
  const deps: VaultToolDeps = {
    search,
    readNote: async (path) => files[path] ?? null,
    resolveLink: async () => null,
    policyOf: (path, text) => host.policy.policyOf(path, text),
    taskRows: async () => [],
    todayKey: () => "2026-09-24",
    commands: () => [],
    events: async () => [],
    ...more,
  };
  host.tools = (recipient, scope, redact, web, narrowed, foreign) => {
    const more = furtherToolNames(deps);
    return { names: CHAT_TOOL_NAMES, more, executor: createVaultToolExecutor(deps, { recipient, webTools: web === true }, scope, redact, { more, ...(narrowed ? { narrowed } : {}), ...(foreign ? { foreign } : {}) }) };
  };
}

/** Resolves when the send overview asks for an answer. */
function consentAsked(s: AiSession): Promise<void> {
  return new Promise((resolve) => {
    const off = s.subscribe(() => {
      if (s.getState().consent) {
        off();
        resolve();
      }
    });
  });
}

function session(script: EgressChunk[][], options: { approve?: boolean; prices?: Record<string, { input: number; output: number }> } = {}) {
  const fake = fakeEgress(script);
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, profiles: { balanced: { providerId: "anthropic", model: "m-1" } }, ...(options.prices ? { prices: options.prices } : {}) };
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
    label: (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
  });
  // Most tests approve the send overview as it comes; the consent test answers itself.
  if (options.approve !== false) {
    s.subscribe(() => {
      if (s.getState().consent) s.answerConsent(true);
    });
  }
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
    expect(state.active!.runs).toHaveLength(1);
    // The linked note was kept back: its title is withheld in the sent text.
    expect(state.active!.runs[0]).toMatchObject({ userTurn: 0, providerId: "anthropic", model: "m-1", sent: ["Offer.md"], kept: ["Salaries.md"], usage: { inputTokens: 50, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 }, steps: 1, stop: "answered" });
    expect(state.active!.runs[0]!.manifest).toMatchObject({ providerId: "anthropic", model: "m-1", sources: [{ path: "Offer.md", tier: "evidence" }], excluded: [{ path: "Salaries.md", reason: "cloud-denied" }] });
    expect(state.summaries.map((x) => x.title)).toEqual(["Where is the offer?"]);
    expect(vault.saved.get("id1")!.runs).toHaveLength(1);
    expect(vault.ledger()).toHaveLength(1);
    expect(JSON.stringify(vault.ledger())).not.toContain("offer");
  });

  /** The most Plainva sends of one note, with the budget the models of these tests get. */
  const CEILING = Math.min(CONTEXT_NOTE_LIMIT, Math.max(DEFAULT_CONTEXT_BUDGET.evidenceChars, 4_000));

  it("records what choosing and shortening saved — the rest of a note of which a section went, up to the most Plainva sends of one note, in tokens and at the model's price — and the month sums it (plan P9-6)", async () => {
    const { s } = session([answer("95 EUR per hour.")], { prices: { "anthropic/m-1": { input: 3, output: 15 } } });
    await s.load();
    const vault = vaultHost("Handbook.md");
    // The index would call the notes large: what nobody chose is no saving, whatever its size.
    vault.host.noteSizes = async (paths) => new Map(paths.map((path) => [path, 1_000_000]));
    await s.attachVault(vault.host);
    await s.send("What is the rate?");
    const source = s.getState().active!.runs[0]!.manifest!.sources[0]!;
    expect(source).toMatchObject({ path: "Handbook.md", section: "Handbook > Rates" });
    // Longer than Plainva ever sends of one note: the rest beyond that would not have gone either.
    expect(files["Handbook.md"]!.length).toBeGreaterThan(CEILING);
    const saved = estimateTokensOfChars(CEILING - source.chars);
    expect(saved).toBeGreaterThan(3000);
    const entry = vault.ledger()[0]!;
    expect(entry.context).toEqual({ savedTokens: saved });
    expect(entry.savedUsd).toBeCloseTo((saved * 3) / 1_000_000, 12);
    // Numbers only: nothing of the note in the record of the run.
    expect(JSON.stringify(entry)).not.toContain("background");
    expect(await s.savings("2026-09")).toEqual({ savedTokens: saved, runs: 1, savedUsd: entry.savedUsd });
    expect(await s.savings("2026-08")).toEqual({ savedTokens: 0, runs: 0 });
  });

  it("records no saving where every note went whole, nor for a request no model received (plan P9-6)", async () => {
    const whole = session([answer("It is in [[Offer]].")]);
    await whole.s.load();
    const offer = vaultHost("Offer.md");
    offer.host.noteSizes = async (paths) => new Map(paths.map((path) => [path, 35_000]));
    await whole.s.attachVault(offer.host);
    // The open note went whole and nothing else was proposed: nothing was saved.
    await whole.s.send("Where is the offer?");
    expect(offer.ledger()[0]!.context).toBeUndefined();
    // The network failed before any model saw the request: what its context left out saved nothing.
    const failed = session([]);
    await failed.s.load();
    const handbook = vaultHost("Handbook.md");
    await failed.s.attachVault(handbook.host);
    expect((await failed.s.send("What is the rate?"))?.kind).toBe("failed");
    expect(handbook.ledger()).toHaveLength(1);
    expect(handbook.ledger()[0]!.context).toBeUndefined();
    expect(await failed.s.savings("2026-09")).toEqual({ savedTokens: 0, runs: 0 });
  });

  it("counts a version of a note once in a conversation: another section of it saves nothing more, a changed note counts again (plan P9-6)", async () => {
    const { s } = session([answer("95 EUR."), answer("Background."), answer("Still 95 EUR.")]);
    await s.load();
    const vault = vaultHost("Handbook.md");
    await s.attachVault(vault.host);
    await s.send("What is the rate?");
    await s.send("What is in the intro?");
    const runs = s.getState().active!.runs;
    // The second turn sent another section of the same note …
    expect(runs[1]!.manifest!.sources[0]).toMatchObject({ path: "Handbook.md", section: "Handbook > Intro" });
    expect(runs[1]!.manifest!.sources[0]!.hash).toBe(runs[0]!.manifest!.sources[0]!.hash);
    // … and saved nothing more: had the note gone whole, the second turn would not have sent it again.
    expect(vault.ledger()[0]!.context!.savedTokens).toBeGreaterThan(0);
    expect(vault.ledger()[1]!.context).toBeUndefined();
    // A changed note is another version: it counts again.
    const before = files["Handbook.md"]!;
    try {
      files["Handbook.md"] = `${before}The rate rises in May.\n`;
      await s.send("What is the rate now?");
    } finally {
      files["Handbook.md"] = before;
    }
    expect(vault.ledger()[2]!.context!.savedTokens).toBeGreaterThan(0);
    expect(await s.savings("2026-09")).toEqual({ savedTokens: vault.ledger()[0]!.context!.savedTokens + vault.ledger()[2]!.context!.savedTokens, runs: 2 });
  });

  it("counts nothing for a note a tool of the run looked at anyway (plan P9-6)", async () => {
    const { s } = session([callsTool("read_note", { path: "Handbook.md" }), answer("95 EUR per hour.")]);
    await s.load();
    const vault = vaultHost("Handbook.md");
    withTools(vault.host);
    await s.attachVault(vault.host);
    await s.send("What is the rate?");
    const run = s.getState().active!.runs[0]!;
    // The context sent a section, and the model read the note itself: nothing of it was left out.
    expect(run.manifest!.sources[0]).toMatchObject({ path: "Handbook.md", section: "Handbook > Rates" });
    expect(run.read).toEqual(["Handbook.md"]);
    expect(vault.ledger()[0]!.context).toBeUndefined();
  });

  it("still counts a note a search only listed, and leaves out one read after the run's record of paths is full (plan P9-6)", async () => {
    // The search lists the note the context sent a section of: its text did not go, so the rest still counts.
    const listed = session([callsTool("search_vault", { query: "rate" }), answer("95 EUR per hour.")]);
    await listed.s.load();
    const one = vaultHost("Handbook.md");
    withTools(one.host, async () => [{ path: "Handbook.md", title: "Handbook", snippet: null }]);
    await listed.s.attachVault(one.host);
    await listed.s.send("What is the rate?");
    expect(listed.s.getState().active!.runs[0]!.read).toEqual(["Handbook.md"]);
    expect(one.ledger()[0]!.context!.savedTokens).toBeGreaterThan(3000);
    // Eight pages of a search over other notes fill the record of paths; the note read after them is still one the
    // model read.
    const pages = Array.from({ length: 8 }, (_, page) => ({ name: "search_vault", args: { query: "other", limit: 25, cursor: String(page * 25) } }));
    const full = session([callsTools([...pages, { name: "read_note", args: { path: "Handbook.md" } }]), answer("95 EUR per hour.")]);
    await full.s.load();
    const two = vaultHost("Handbook.md");
    withTools(two.host, async (_query, limit, offset) => Array.from({ length: limit }, (_, i) => ({ path: `Other ${offset + i}.md`, title: `Other ${offset + i}`, snippet: null })));
    await full.s.attachVault(two.host);
    await full.s.send("What is the rate?");
    const run = full.s.getState().active!.runs[0]!;
    expect(run.readMore).toBe(true);
    expect(run.read).not.toContain("Handbook.md");
    expect(two.ledger()[0]!.context).toBeUndefined();
  });

  it("still counts a note whose outline a tool gave the model — its headings are no text of it (plan P9-6)", async () => {
    const { s } = session([callsTool("get_outline", { path: "Handbook.md" }), answer("95 EUR per hour.")]);
    await s.load();
    const vault = vaultHost("Handbook.md");
    withTools(vault.host);
    await s.attachVault(vault.host);
    await s.send("What is the rate?");
    expect(s.getState().active!.runs[0]!.read).toEqual(["Handbook.md"]);
    expect(vault.ledger()[0]!.context!.savedTokens).toBeGreaterThan(3000);
  });

  it("takes an answer of the system's own model with nothing in it as a request it received (plan P9-6)", async () => {
    const { s } = session([platformAnswer("")], { approve: false });
    await s.load();
    const vault = vaultHost("Handbook.md");
    await s.attachVault(vault.host);
    await s.setChoice({ providerId: "apple", model: "on-device" });
    await s.send("What is the rate?");
    const run = s.getState().active!.runs[0]!;
    expect(run.stop).toBe("answered");
    expect(run.unreached).toBeUndefined();
    expect(vault.ledger()[0]!.context!.savedTokens).toBeGreaterThan(0);
  });

  it("counts every turn with the system's own model, whose request sends the notes anew (plan P9-6)", async () => {
    const { s } = session([platformAnswer("95 EUR."), platformAnswer("Background.")], { approve: false });
    await s.load();
    const vault = vaultHost("Handbook.md");
    await s.attachVault(vault.host);
    await s.setChoice({ providerId: "apple", model: "on-device" });
    await s.send("What is the rate?");
    await s.send("What is in the intro?");
    expect(vault.ledger().map((entry) => entry.context?.savedTokens ?? 0).every((tokens) => tokens > 0)).toBe(true);
    expect(vault.ledger()).toHaveLength(2);
  });

  it("does not count a note less after a run no model received (plan P9-6)", async () => {
    const { s } = session([[{ type: "failed", code: "network", message: "offline" }], answer("Background.")]);
    await s.load();
    const vault = vaultHost("Handbook.md");
    await s.attachVault(vault.host);
    await s.send("What is the rate?");
    const lost = s.getState().active!.runs[0]!;
    expect(lost).toMatchObject({ stop: "failed", unreached: true });
    expect(vault.ledger()[0]!.context).toBeUndefined();
    // The lost run counts for nothing: another section of the same note that the next question takes counts. (The
    // same section asked again goes along as the conversation's earlier turn and is not counted — on the low side.)
    await s.send("What is in the intro?");
    expect(s.getState().active!.runs[1]!.unreached).toBeUndefined();
    expect(vault.ledger()[1]!.context!.savedTokens).toBeGreaterThan(0);
  });

  it("counts another part of a note after the same part was asked again following a lost request (plan P9-6)", async () => {
    const { s } = session([[{ type: "failed", code: "network", message: "offline" }], answer("95 EUR."), answer("Background.")]);
    await s.load();
    const vault = vaultHost("Handbook.md");
    await s.attachVault(vault.host);
    await s.send("What is the rate?");
    // Asked again: the section goes along as the lost turn, named here unchanged — not counted, on the low side.
    await s.send("What is the rate?");
    expect(s.getState().active!.runs[1]!.manifest!.sources[0]).toMatchObject({ path: "Handbook.md", unchanged: true });
    expect(vault.ledger()[1]!.context).toBeUndefined();
    // A name carried no part of the note: another part of it counts.
    await s.send("What is in the intro?");
    expect(vault.ledger()[2]!.context!.savedTokens).toBeGreaterThan(0);
  });

  it("counts a note that an earlier turn only named in a card with no sentence (plan P9-6)", async () => {
    const { s } = session([answer("No rates yet."), answer("Notes to come.")]);
    await s.load();
    const vault = vaultHost(null);
    await s.attachVault(vault.host);
    vault.host.candidates = async () => [[{ path: "Template.md", title: "Template", signals: { edited: 0.1 } }]];
    await s.send("What are the rates?");
    expect(s.getState().active!.runs[0]!.manifest!.sources[0]).toMatchObject({ path: "Template.md", tier: "card", chars: 0 });
    expect(vault.ledger()[0]!.context).toBeUndefined();
    vault.host.candidates = async () => [[{ path: "Template.md", title: "Template", signals: { lexical: 1 } }]];
    await s.send("Which notes are to come?");
    expect(s.getState().active!.runs[1]!.manifest!.sources[0]).toMatchObject({ path: "Template.md", tier: "evidence" });
    expect(vault.ledger()[1]!.context!.savedTokens).toBeGreaterThan(0);
  });

  it("counts a saving on this device at no dollars — also for the system's own model, which reports no tokens —, and gives none for a model without a price (plan P9-6)", async () => {
    const { s } = session([serverAnswer("95 EUR per hour."), answer("95 EUR per hour.")]);
    await s.load();
    const vault = vaultHost("Handbook.md");
    await s.attachVault(vault.host);
    await s.setChoice({ providerId: "ollama", model: "granite3.3:8b" });
    await s.send("What is the rate?");
    const local = vault.ledger()[0]!;
    expect(local).toMatchObject({ providerId: "ollama", savedUsd: 0 });
    expect(local.context!.savedTokens).toBeGreaterThan(3000);
    expect(await s.savings("2026-09")).toEqual({ savedTokens: local.context!.savedTokens, runs: 1, savedUsd: 0 });
    // The same question to a cloud model without a known price: tokens, and no dollars for the month either.
    s.newConversation();
    await s.setChoice({ providerId: "anthropic", model: "m-1" });
    await s.send("What is the rate?");
    const cloud = vault.ledger()[1]!;
    expect(cloud.providerId).toBe("anthropic");
    expect(cloud.context).toEqual(local.context);
    expect(cloud.savedUsd).toBeUndefined();
    expect(await s.savings("2026-09")).toEqual({ savedTokens: local.context!.savedTokens * 2, runs: 2 });
    // The system's own model says nothing of tokens; that it answered says the request reached it.
    const device = session([platformAnswer("95 EUR per hour.")], { approve: false });
    await device.s.load();
    const phone = vaultHost("Handbook.md");
    await device.s.attachVault(phone.host);
    await device.s.setChoice({ providerId: "apple", model: "on-device" });
    expect(await device.s.send("What is the rate?")).toEqual({ kind: "answered" });
    const own = phone.ledger()[0]!;
    expect(own.usage.inputTokens).toBe(0);
    expect(own.context!.savedTokens).toBeGreaterThan(0);
    expect(own.savedUsd).toBe(0);
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
    expect(JSON.stringify(fake.sent[0]!.body)).toContain('origin=\\"vault:Plan.md\\"');
    const second = fake.sent[1]!.body!.messages as Array<{ role: string; content: Array<{ text?: string }> }>;
    const lastUser = second[second.length - 1]!;
    const texts = lastUser.content.map((c: { text?: string }) => c.text ?? "");
    expect(texts[texts.length - 1]).toBe("Second");
    // The situation goes again; the notes it already sent are named, not repeated.
    expect(texts[0]).toContain("unchanged since it was sent earlier");
    expect(texts[0]).not.toContain("Rates as in");
  });

  it("names a section unchanged only where every view of the note since has the version it went in (plan P9-6)", async () => {
    const { s } = session([answer("95 EUR."), callsTool("read_note", { path: "Handbook.md" }), answer("It rises in May."), answer("95 EUR."), answer("Still 95 EUR.")]);
    await s.load();
    const vault = vaultHost("Handbook.md");
    withTools(vault.host);
    await s.attachVault(vault.host);
    await s.send("What is the rate?");
    const before = files["Handbook.md"]!;
    try {
      // The note changes; in a turn without it in the context the model reads it itself — the changed version.
      files["Handbook.md"] = `${before}The rate rises in May.\n`;
      s.setExcludeActive(true);
      await s.send("Read the handbook again.");
      expect(s.getState().active!.runs[1]!.readHashes?.map((read) => read.path)).toEqual(["Handbook.md"]);
    } finally {
      files["Handbook.md"] = before;
    }
    // Back as it was: the section the first turn sent is the one that goes now, but the model saw the note otherwise
    // since — so it goes again.
    s.setExcludeActive(false);
    await s.send("What is the rate?");
    const third = s.getState().active!.runs[2]!.manifest!.sources.find((source) => source.path === "Handbook.md")!;
    expect(third).toMatchObject({ section: "Handbook > Rates" });
    expect(third.unchanged).toBeUndefined();
    // Now the model's latest view is that section at this version: named, not sent.
    await s.send("What is the rate?");
    expect(s.getState().active!.runs[3]!.manifest!.sources.find((source) => source.path === "Handbook.md")).toMatchObject({ unchanged: true });
  });

  it("names a section unchanged after a run that listed many notes, and still knows a note such a run read (plan P9-6)", async () => {
    const pages = Array.from({ length: 9 }, (_, page) => ({ name: "search_vault", args: { query: "other", limit: 25, cursor: String(page * 25) } }));
    const { s } = session([
      answer("95 EUR."),
      callsTools(pages),
      answer("Many notes."),
      answer("95 EUR."),
      callsTools([...pages, { name: "read_note", args: { path: "Handbook.md" } }]),
      answer("It rises in May."),
      answer("95 EUR."),
    ]);
    await s.load();
    const vault = vaultHost("Handbook.md");
    withTools(vault.host, async (_query, limit, offset) => Array.from({ length: limit }, (_, i) => ({ path: `Other ${offset + i}.md`, title: `Other ${offset + i}`, snippet: null })));
    await s.attachVault(vault.host);
    await s.send("What is the rate?");
    // A turn without the note in its context lists more notes than the run's record of paths keeps.
    s.setExcludeActive(true);
    await s.send("List the other notes.");
    expect(s.getState().active!.runs[1]!.readMore).toBe(true);
    s.setExcludeActive(false);
    await s.send("What is the rate?");
    // A listing is no view of the note: the section is named, not sent again.
    expect(s.getState().active!.runs[2]!.manifest!.sources.find((source) => source.path === "Handbook.md")).toMatchObject({ unchanged: true });
    // The same listing, and then the model reads the note — changed: its version is known although the paths were full.
    const before = files["Handbook.md"]!;
    try {
      files["Handbook.md"] = `${before}The rate rises in May.\n`;
      s.setExcludeActive(true);
      await s.send("List them again and read the handbook.");
      expect(s.getState().active!.runs[3]!.readHashes?.map((read) => read.path)).toContain("Handbook.md");
    } finally {
      files["Handbook.md"] = before;
    }
    s.setExcludeActive(false);
    await s.send("What is the rate?");
    expect(s.getState().active!.runs[4]!.manifest!.sources.find((source) => source.path === "Handbook.md")!.unchanged).toBeUndefined();
  });

  it("knows no version of a note a run read at two versions, and sends its section again (plan P9-6)", async () => {
    const twice = [{ name: "read_note", args: { path: "Handbook.md" } }, { name: "read_note", args: { path: "Handbook.md" } }];
    const { s } = session([answer("95 EUR."), callsTools(twice), answer("Read twice."), answer("95 EUR.")]);
    await s.load();
    const vault = vaultHost("Handbook.md");
    // The note changes between the two reads of one run: the second read finds another text, and afterwards it is back.
    let reads = 0;
    withTools(vault.host, undefined, { readNote: async (path) => (path === "Handbook.md" && ++reads === 2 ? `${files[path]}The rate rises in May.\n` : (files[path] ?? null)) });
    await s.attachVault(vault.host);
    await s.send("What is the rate?");
    s.setExcludeActive(true);
    await s.send("Read the handbook twice.");
    const run = s.getState().active!.runs[1]!;
    expect(run.readChanged).toEqual(["Handbook.md"]);
    // The run's snapshot shows the last version read; for "unchanged" the note has none.
    expect(run.readHashes).toEqual([{ path: "Handbook.md", hash: noteHash(`${files["Handbook.md"]}The rate rises in May.\n`) }]);
    s.setExcludeActive(false);
    await s.send("What is the rate?");
    expect(s.getState().active!.runs[2]!.manifest!.sources.find((source) => source.path === "Handbook.md")!.unchanged).toBeUndefined();
  });

  it("asks with the send overview first and whenever the scope grows; a declined overview sends nothing", async () => {
    const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")], { approve: false });
    await s.load();
    await s.attachVault(vaultHost("Offer.md").host);

    let asked = consentAsked(s);
    const declined = s.send("First");
    await asked;
    expect(s.getState().consent!.growth).toEqual([{ kind: "first" }]);
    expect(s.getState().consent!.manifest.sources.map((x) => x.path)).toEqual(["Offer.md"]);
    s.answerConsent(false);
    expect(await declined).toBeNull();
    expect(fake.sent).toHaveLength(0);
    expect(s.getState().active).toBeNull();

    asked = consentAsked(s);
    const approved = s.send("First");
    await asked;
    s.answerConsent(true);
    expect(await approved).toEqual({ kind: "answered" });

    // Within the approved scope: no question.
    expect(await s.send("Again")).toEqual({ kind: "answered" });
    expect(s.getState().consent).toBeNull();

    // Another model is a new recipient: the overview comes back.
    await s.setChoice({ providerId: "anthropic", model: "m-2" });
    asked = consentAsked(s);
    const grown = s.send("Third");
    await asked;
    expect(s.getState().consent!.growth).toEqual([{ kind: "recipient", recipient: "anthropic/m-2" }]);
    s.stop();
    expect(await grown).toBeNull();
    expect(fake.sent).toHaveLength(2);
  });

  it("View context builds the next request without sending; a note left out there stays out of that request only", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Offer.md");
    const written: string[] = [];
    vault.host.keepOnDevice = async (path) => {
      written.push(path);
    };
    await s.attachVault(vault.host);
    await s.pin("Plan.md");

    const preview = (await s.previewContext("Where is the offer?"))!;
    expect(fake.sent).toHaveLength(0);
    expect(preview.pack.refs.map((r) => r.path).sort()).toEqual(["Offer.md", "Plan.md"]);
    expect(preview.manifest.excluded.map((e) => e.path)).toEqual(["Salaries.md"]);

    s.toggleLeaveOut("Plan.md");
    expect((await s.previewContext("Where is the offer?"))!.pack.refs.map((r) => r.path)).toEqual(["Offer.md"]);
    await s.send("Where is the offer?");
    expect(JSON.stringify(fake.sent[0]!.body)).not.toContain("vault:Plan.md");
    // Left out for one request: the next one carries the pinned note again.
    expect(s.getState().leaveOutNext).toEqual([]);
    await s.send("And now?");
    expect(JSON.stringify(fake.sent[1]!.body)).toContain('origin=\\"vault:Plan.md\\"');

    expect(await s.keepOnDevice("Offer.md")).toBe(true);
    expect(written).toEqual(["Offer.md"]);
  });

  it("names what looks sensitive; redacting it holds for the whole conversation, and a kind not yet approved asks again", async () => {
    files["Bank.md"] = "# Bank\n\nThe rent goes to DE89 3704 0044 0532 0130 00 every month.";
    try {
      const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")], { approve: false });
      await s.load();
      await s.attachVault(vaultHost("Plan.md").host);
      await s.pin("Bank.md");

      const preview = (await s.previewContext("Where does the rent go?"))!;
      expect(preview.pack.refs.find((r) => r.path === "Bank.md")!.sensitive).toEqual(["account"]);
      await s.toggleRedact("Bank.md");
      expect(s.getState().draftRedact).toEqual(["Bank.md"]);

      let asked = consentAsked(s);
      const first = s.send("Where does the rent go?");
      await asked;
      expect(s.getState().consent!.manifest.sources.find((x) => x.path === "Bank.md")).toMatchObject({ sensitive: ["account"], redacted: 1 });
      s.answerConsent(true);
      await first;
      expect(JSON.stringify(fake.sent[0]!.body)).not.toContain("DE89");
      expect(JSON.stringify(fake.sent[0]!.body)).toContain("⟦withheld account⟧");
      expect(s.getState().active!.redact).toEqual(["Bank.md"]);
      expect(s.getState().draftRedact).toEqual([]);
      // The run keeps the choice it was sent with: what a later "unchanged" is measured against (plan P9-6).
      expect(s.getState().active!.runs[0]!.redact).toEqual(["Bank.md"]);

      // The next message keeps the choice without asking; the conversation stores it.
      await s.send("And the deposit?");
      expect(JSON.stringify(fake.sent[1]!.body)).not.toContain("DE89");

      // Taken back, the number would go: a kind this session has not approved, so the overview asks — and redacting there holds again.
      await s.toggleRedact("Bank.md");
      asked = consentAsked(s);
      const third = s.send("Once more");
      await asked;
      expect(s.getState().consent!.growth).toContainEqual({ kind: "sensitive", sensitive: ["account"] });
      asked = consentAsked(s);
      s.redactInConsent("Bank.md");
      await asked;
      expect(s.getState().consent!.manifest.sources.find((x) => x.path === "Bank.md")).toMatchObject({ unchanged: true, redacted: 1 });
      s.answerConsent(true);
      await third;
      expect(JSON.stringify(fake.sent[2]!.body)).not.toContain("DE89");
      expect(s.getState().active!.redact).toEqual(["Bank.md"]);
    } finally {
      delete files["Bank.md"];
    }
  });

  it("answers with the system's own model on this device: no overview, no tools, the request cut to its window (plan P2c)", async () => {
    const { s, fake } = session([platformAnswer("From the device.")], { approve: false });
    await s.load();
    await s.attachVault(vaultHost("Offer.md").host);
    await s.setChoice({ providerId: "apple", model: "on-device" });

    expect(await s.send("Where is the offer?")).toEqual({ kind: "answered" });
    // Nothing leaves the device, so nothing is asked.
    expect(s.getState().consent).toBeNull();
    const spec = fake.sent[0]!;
    expect(spec).toMatchObject({ endpointId: "apple", url: "platform://apple/generate", auth: null });
    const body = spec.body as { instructions: string; prompt: string; maxOutputTokens: number };
    expect(body.prompt).toContain("Where is the offer?");
    // The open note went along whole — links included, a cloud rule does not apply on the device.
    expect(body.prompt).toContain("Rates as in [[Salaries]]");
    expect(body.maxOutputTokens).toBeLessThanOrEqual(700);
    expect(s.getState().active!.conversation.tools).toEqual([]);
    expect(s.getState().active!.runs[0]!.manifest!.local).toBe(true);

    // The profile "Local" may name it: gists then come from the phone's own model.
    expect(s.localCompletion()).toBeNull();
    await s.updateSettings((x) => ({ ...x, profiles: { ...x.profiles, local: { providerId: "apple", model: "on-device" } } }));
    expect(s.localCompletion()?.providerId).toBe("apple");
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

/** Plan KI-Harness P1.5 (E32, E33): an action at a selection comes back as a suggestion round. */
describe("an AI action at a selection", () => {
  const passage = "The contract runs until the end of the year and renews itself.";
  const contract = files["Contract.md"]!;
  const at = contract.indexOf(passage);
  const range = { path: "Contract.md", from: at, to: at + passage.length, text: passage, doc: contract };
  type Round = Parameters<NonNullable<AiVaultHost["propose"]>>[0];

  /** Holds every request until the test lets them go. */
  function held(fake: ReturnType<typeof fakeEgress>) {
    const send = fake.egress.send.bind(fake.egress);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => (reached = resolve));
    fake.egress.send = async (id, spec, onChunk) => {
      reached();
      await gate;
      return send(id, spec, onChunk);
    };
    return { waiting, release };
  }

  function proposing(active: string | null = "Contract.md") {
    const vault = vaultHost(active);
    const rounds: Round[] = [];
    vault.host.propose = async (round) => {
      rounds.push(round);
    };
    return { vault, rounds };
  }

  it("sends nothing for a vault that went while the passage was looked at", async () => {
    const { s, fake } = session([answer("```\nThe contract runs on.\n```"), answer("```\nThe contract runs on.\n```")]);
    await s.load();
    const { vault } = proposing();
    await s.attachVault(vault.host);
    // A first proposal: from here on a passage of this note goes within what was approved, without an overview.
    await s.proposeForSelection({ action: "rewrite", range });
    // The gate's look at the note held; meanwhile another vault.
    const policyOf = vault.host.policy.policyOf.bind(vault.host.policy);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const asking = new Promise<void>((resolve) => (reached = resolve));
    vault.host.policy.policyOf = async (path, text) => {
      reached();
      await gate;
      return policyOf(path, text);
    };
    const outcome = s.proposeForSelection({ action: "rewrite", range });
    await asking;
    await s.attachVault(vaultHost(null).host);
    release();
    expect(await outcome).toMatchObject({ kind: "refused", reason: "cancelled" });
    expect([fake.sent.length, s.getState().live, s.getState().active]).toEqual([1, null, null]);
  });

  it("lays no round through a host that is gone: a new host for the same vault after the answer stops it (strand 6, step 10)", async () => {
    const { s, fake } = session([answer("```\nThe contract runs on.\n```")]);
    await s.load();
    const { vault, rounds } = proposing();
    vault.host.key = "vault-1";
    await s.attachVault(vault.host);
    // The note is read again once the answer is in, to lay the round on it as it is now: that reading is held.
    const readNote = vault.host.readNote.bind(vault.host);
    const send = fake.egress.send.bind(fake.egress);
    let answered = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const reading = new Promise<void>((resolve) => (reached = resolve));
    fake.egress.send = async (id, spec, onChunk) => {
      const out = await send(id, spec, onChunk);
      answered = true;
      return out;
    };
    vault.host.readNote = async (path) => {
      if (answered) {
        answered = false;
        reached();
        await gate;
      }
      return readNote(path);
    };
    const outcome = s.proposeForSelection({ action: "rewrite", range });
    await reading;
    // The index rebuilt meanwhile: the shell hands a new host for the same vault.
    await s.attachVault({ ...vault.host });
    release();
    expect(await outcome).toEqual({ kind: "refused", reason: "cancelled" });
    expect(rounds).toEqual([]);
  });

  it("proposes nothing for a passage whose history Delete all cleared while it was looked at", async () => {
    const { s, fake } = session([answer("```\nThe contract runs on.\n```"), answer("```\nThe contract runs on.\n```")]);
    await s.load();
    const { vault } = proposing();
    await s.attachVault(vault.host);
    // A first proposal: from here on a passage of this note goes within what was approved, without an overview.
    await s.proposeForSelection({ action: "rewrite", range });
    const policyOf = vault.host.policy.policyOf.bind(vault.host.policy);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const asking = new Promise<void>((resolve) => (reached = resolve));
    let first = true;
    vault.host.policy.policyOf = async (path, text) => {
      if (first) {
        first = false;
        reached();
        await gate;
      }
      return policyOf(path, text);
    };
    const outcome = s.proposeForSelection({ action: "rewrite", range });
    await asking;
    await s.removeAll();
    release();
    expect(await outcome).toMatchObject({ kind: "refused", reason: "cancelled" });
    expect([fake.sent.length, vault.saved.size]).toEqual([1, 0]);
  });

  it("stores the conversation of an action at a selection only when its run ends", async () => {
    const { s, fake } = session([answer("```\nThe contract runs on.\n```")]);
    await s.load();
    const { vault } = proposing();
    await s.attachVault(vault.host);
    const request = held(fake);
    const outcome = s.proposeForSelection({ action: "rewrite", range });
    await request.waiting;
    // A pin on its conversation while it runs: the conversation is in no storage before its end.
    await s.pin("Offer.md");
    const id = s.getState().active!.id;
    expect(vault.saved.has(id)).toBe(false);
    request.release();
    await outcome;
    expect(vault.saved.get(id)?.pins).toEqual(["Offer.md"]);
  });

  it("proposes nothing for a passage while a message that began meanwhile is on its way", async () => {
    const { s, fake } = session([answer("Going."), answer("```\nThe contract runs on.\n```")]);
    await s.load();
    const { vault } = proposing();
    await s.attachVault(vault.host);
    // The gate's look at the note held; meanwhile a message of the composer goes, and its answer is on its way.
    const policyOf = vault.host.policy.policyOf.bind(vault.host.policy);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const asking = new Promise<void>((resolve) => (reached = resolve));
    let first = true;
    vault.host.policy.policyOf = async (path, text) => {
      if (first) {
        first = false;
        reached();
        await gate;
      }
      return policyOf(path, text);
    };
    const outcome = s.proposeForSelection({ action: "rewrite", range });
    await asking;
    const request = held(fake);
    const sending = s.send("Meanwhile");
    await request.waiting;
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    request.release();
    expect(await outcome).toMatchObject({ kind: "refused", reason: "busy" });
    await sending;
    expect(fake.sent.length).toBe(1);
  });

  it("sends the passage alone, without tools, and proposes the answer as a round authored by the model", async () => {
    const { s, fake } = session([answer("```\nThe contract runs until the end of the year; then it renews itself.\n```")]);
    await s.load();
    const { vault, rounds } = proposing();
    await s.attachVault(vault.host);
    await s.pin("Plan.md");
    const outcome = await s.proposeForSelection({ action: "rewrite", range });
    expect(outcome).toMatchObject({ kind: "proposed", changes: rounds[0]?.chunks.length });
    expect(fake.sent).toHaveLength(1);
    const body = JSON.stringify(fake.sent[0]!.body);
    expect(body).toContain(passage);
    expect(body).toContain("Rewrite the passage");
    // Only the passage: not the rest of the note, not the pinned note, no tools.
    expect(body).not.toContain("Rates follow");
    expect(body).not.toContain("Plan.md");
    expect(fake.sent[0]!.body!.tools ?? []).toEqual([]);

    expect(rounds).toHaveLength(1);
    const round = rounds[0]!;
    expect(round.path).toBe("Contract.md");
    expect(round.base).toBe(contract);
    expect(round.author).toEqual({ id: "plainva-ai/m-1", displayName: 'ai.suggestionAuthor {"model":"m-1"}' });
    expect(round.note).toBe('ai.selection.roundNote.rewrite {"model":"m-1"}');
    let accepted = round.base;
    for (const chunk of [...round.chunks].sort((a, b) => b.fromA - a.fromA)) accepted = accepted.slice(0, chunk.fromA) + chunk.replacement + accepted.slice(chunk.toA);
    expect(accepted).toBe(contract.replace(passage, "The contract runs until the end of the year; then it renews itself."));

    // A conversation of its own, kept in the history; the send overview named the selection.
    const saved = vault.saved.get(outcome.kind === "proposed" ? outcome.conversationId : "")!;
    expect(saved.title).toBe('ai.selection.title.rewrite {"note":"Contract"}');
    expect(saved.runs[0]!.manifest).toMatchObject({ dataClasses: ["selection"], sources: [{ path: "Contract.md", selection: true }], tools: [] });
    // The pin waits for the next message typed in the composer.
    expect(s.getState().draftPins).toEqual(["Plan.md"]);
  });

  it("puts tasks after the passage", async () => {
    const { s } = session([answer("- [ ] Check the renewal date")]);
    await s.load();
    const { vault, rounds } = proposing();
    await s.attachVault(vault.host);
    expect(await s.proposeForSelection({ action: "tasks", range })).toMatchObject({ kind: "proposed", changes: 1 });
    expect(rounds[0]!.chunks).toEqual([{ fromA: range.to, toA: range.to, replacement: "\n\n- [ ] Check the renewal date\n" }]);
  });

  it("says so when there is nothing to change, and when the passage moved on while the model wrote", async () => {
    const { s } = session([answer(passage), answer("Shorter.")]);
    await s.load();
    const { vault, rounds } = proposing();
    await s.attachVault(vault.host);
    expect(await s.proposeForSelection({ action: "rewrite", range })).toMatchObject({ kind: "unchanged" });
    vault.host.readNote = async (path) => ({ path, title: "Contract", text: "# Contract\n\nSomething else entirely.\n" });
    expect(await s.proposeForSelection({ action: "shorten", range })).toEqual({ kind: "refused", reason: "changed" });
    expect(rounds).toHaveLength(0);
  });

  it("refuses before anything goes out: encrypted workspace, a denied note, withheld links, an empty or oversized passage", async () => {
    const { s, fake } = session([]);
    await s.load();
    const { vault, rounds } = proposing();
    await s.attachVault(vault.host);

    vault.host.encrypted = () => true;
    expect(await s.proposeForSelection({ action: "rewrite", range })).toEqual({ kind: "refused", reason: "encrypted" });
    vault.host.encrypted = () => false;

    const secret = files["Salaries.md"]!;
    const denied = { path: "Salaries.md", from: secret.indexOf("secret"), to: secret.length, text: "secret", doc: secret };
    expect(await s.proposeForSelection({ action: "rewrite", range: denied })).toEqual({ kind: "refused", reason: "denied" });
    // An unsaved "cloud: deny" in the editor counts.
    const unsaved = { ...range, doc: `---\nplainva:\n  ai:\n    cloud: deny\n---\n${contract}` };
    expect(await s.proposeForSelection({ action: "rewrite", range: unsaved })).toEqual({ kind: "refused", reason: "denied" });

    const offer = files["Offer.md"]!;
    const linked = { path: "Offer.md", from: offer.indexOf("Rates"), to: offer.length, text: "Rates as in [[Salaries]].", doc: offer };
    expect(await s.proposeForSelection({ action: "rewrite", range: linked })).toEqual({ kind: "refused", reason: "withheld" });

    expect(await s.proposeForSelection({ action: "rewrite", range: { ...range, text: "  " } })).toEqual({ kind: "refused", reason: "empty" });
    expect(await s.proposeForSelection({ action: "rewrite", range: { ...range, text: "x".repeat(12_001) } })).toEqual({ kind: "refused", reason: "too-long" });

    expect(fake.sent).toHaveLength(0);
    expect(rounds).toHaveLength(0);
  });

  it("is off where the shell cannot take a round, and a declined send overview sends nothing", async () => {
    const plain = session([]);
    await plain.s.load();
    await plain.s.attachVault(vaultHost("Contract.md").host);
    expect(await plain.s.proposeForSelection({ action: "rewrite", range })).toEqual({ kind: "refused", reason: "off" });

    const { s, fake } = session([answer("Shorter.")], { approve: false });
    await s.load();
    const { vault, rounds } = proposing();
    await s.attachVault(vault.host);
    const asked = consentAsked(s);
    const pending = s.proposeForSelection({ action: "shorten", range });
    await asked;
    expect(s.getState().consent!.manifest.sources).toEqual([expect.objectContaining({ path: "Contract.md", selection: true })]);
    s.answerConsent(false);
    expect(await pending).toEqual({ kind: "refused", reason: "cancelled" });
    expect(fake.sent).toHaveLength(0);
    expect(rounds).toHaveLength(0);
  });
});

/** Plan KI-Harness P1.5 (§10.7, E28): a voice note, transcribed as a suggestion under the recording. */
describe("transcribing a voice note", () => {
  const day = "Journal/2026-09-24.md";
  const target = "Voice 2026-09-24 0812.m4a";
  const recording = { path: `Attachments/${target}`, name: target, mime: "audio/mp4", bytes: new Uint8Array([1, 2, 3]) };
  type Round = Parameters<NonNullable<AiVaultHost["propose"]>>[0];

  /** A JSON answer that does not stream, as the transcription endpoint gives it. */
  function json(body: unknown): EgressChunk[] {
    return [{ type: "open", status: 200 }, { type: "data", text: JSON.stringify(body) }, { type: "done" }];
  }

  async function transcribing(script: EgressChunk[][], audio: { providerId: string; model: string } | null = { providerId: "openai", model: "gpt-4o-transcribe" }, options: { approve?: boolean } = {}) {
    const made = session(script, options);
    await made.s.load();
    if (audio) await made.s.updateSettings((current) => ({ ...current, profiles: { ...current.profiles, audio } }));
    const vault = vaultHost(day);
    const rounds: Round[] = [];
    vault.host.propose = async (round) => {
      rounds.push(round);
    };
    await made.s.attachVault(vault.host);
    return { ...made, vault, rounds };
  }

  it("lays no round through a host that is gone: a new host for the same vault while the transcript comes back stops it (strand 6, step 10)", async () => {
    const { s, fake, vault, rounds } = await transcribing([json({ text: "Put community care on its own line.", usage: { input_tokens: 80, output_tokens: 20 } })]);
    vault.host.key = "vault-1";
    // Once the transcript is in, the note is read again to lay the round on it as it is now: that reading is held.
    const send = fake.egress.send.bind(fake.egress);
    const readNote = vault.host.readNote.bind(vault.host);
    let answered = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const reading = new Promise<void>((resolve) => (reached = resolve));
    fake.egress.send = async (id, spec, onChunk) => {
      const out = await send(id, spec, onChunk);
      answered = true;
      return out;
    };
    vault.host.readNote = async (path) => {
      if (answered) {
        answered = false;
        reached();
        await gate;
      }
      return readNote(path);
    };
    const outcome = s.transcribe({ notePath: day, target, audio: recording });
    await reading;
    await s.attachVault({ ...vault.host });
    release();
    expect(await outcome).toMatchObject({ kind: "refused", reason: "cancelled" });
    expect(rounds).toEqual([]);
  });

  it("sends the recording as it is and proposes the transcript under its line, authored by the model", async () => {
    const { s, fake, vault, rounds } = await transcribing([json({ text: "Put community care on its own line.\nAsk Tom about ten episodes.", usage: { input_tokens: 80, output_tokens: 20 } })]);
    const outcome = await s.transcribe({ notePath: day, target, audio: recording });
    expect(outcome).toEqual({ kind: "proposed", model: "gpt-4o-transcribe" });

    expect(fake.sent).toHaveLength(1);
    const spec = fake.sent[0]!;
    expect(spec.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(spec.body).toBeUndefined();
    expect(spec.rawBody!.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(atob(spec.rawBody!.base64)).toContain('name="file"; filename="Voice 2026-09-24 0812.m4a"');

    const note = files[day]!;
    const lineEnd = note.indexOf("\n", note.indexOf(target));
    expect(rounds).toEqual([
      {
        path: day,
        base: note,
        chunks: [{ fromA: lineEnd, toA: lineEnd, replacement: "\n\n> Put community care on its own line.\n> Ask Tom about ten episodes.\n" }],
        note: `ai.transcribe.roundNote {"name":"${target}"}`,
        author: { id: "plainva-ai/gpt-4o-transcribe", displayName: 'ai.suggestionAuthor {"model":"gpt-4o-transcribe"}' },
      },
    ]);
    // Counted like any request; no conversation of its own.
    expect(vault.ledger()).toEqual([expect.objectContaining({ providerId: "openai", model: "gpt-4o-transcribe", stop: "answered", usage: expect.objectContaining({ inputTokens: 80, outputTokens: 20 }) })]);
    expect(vault.saved.size).toBe(0);
  });

  /** Plan KI-Harness P7: a summary above a long transcript, by the model of the profile "Local" on this device. */
  const long = `We agreed on 12 March 2026 to raise the day rate to 1,900 euros. ${"Tom wants ten episodes and a call every Monday. ".repeat(18)}`.trim();
  const SUMMARY = "On 12 March 2026 the day rate was raised to 1,900 euros; Tom wants ten episodes and a call every Monday.";
  /** An answer of a server on this computer, as its chat endpoint streams it. */
  const said = (words: string): EgressChunk[] => {
    const line = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
    return [{ type: "open", status: 200 }, { type: "data", text: `${line({ choices: [{ delta: { content: words } }] })}${line({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 40 } })}data: [DONE]\n\n` }, { type: "done" }];
  };
  async function summarising(script: EgressChunk[][], patch: Record<string, unknown> = {}) {
    const made = await transcribing(script);
    await made.s.updateSettings((current) => ({ ...current, transcriptSummary: true, profiles: { ...current.profiles, local: { providerId: "ollama", model: "granite3.3:8b" } }, ...patch }));
    return made;
  }

  it("lays a checked summary above a long transcript, written on this device: one suggestion, and both requests in the audit", async () => {
    const { s, fake, vault, rounds } = await summarising([json({ text: long }), said(SUMMARY)]);
    expect(await s.transcribe({ notePath: day, target, audio: recording })).toEqual({ kind: "proposed", model: "gpt-4o-transcribe" });
    expect(fake.sent.map((spec) => spec.endpointId)).toEqual(["openai", "ollama"]);
    // What the model on this device was asked: the instruction, and the transcript as the one message — no tools.
    const body = fake.sent[1]!.body as { messages: { role: string; content: string }[]; tools?: unknown };
    expect(body.messages[0]!.content).toContain("Summarise the transcript of a voice recording");
    expect(body.messages[1]).toEqual({ role: "user", content: long });
    expect(body.tools).toBeUndefined();
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.chunks).toHaveLength(1);
    expect(rounds[0]!.chunks[0]!.replacement).toBe(`\n\nai.transcribe.summaryLabel ${SUMMARY}\n\n> ${long}\n`);
    expect(rounds[0]!.note).toBe(`ai.transcribe.roundNoteSummary {"name":"${target}","model":"granite3.3:8b"}`);
    // The suggestion is still the transcriber's; the note of the round names who summed it up.
    expect(rounds[0]!.author.id).toBe("plainva-ai/gpt-4o-transcribe");
    expect(vault.ledger().map((entry) => [entry.providerId, entry.model, entry.stop])).toEqual([["openai", "gpt-4o-transcribe", "answered"], ["ollama", "granite3.3:8b", "answered"]]);
  });

  it("leaves the summary out where it names something the recording does not — the transcript comes alone", async () => {
    const { s, fake, rounds } = await summarising([json({ text: long }), said("The day rate was raised to 2,400 euros.")]);
    expect(await s.transcribe({ notePath: day, target, audio: recording })).toEqual({ kind: "proposed", model: "gpt-4o-transcribe" });
    expect(fake.sent).toHaveLength(2);
    expect(rounds[0]!.chunks[0]!.replacement).toBe(`\n\n> ${long}\n`);
    expect(rounds[0]!.note).toBe(`ai.transcribe.roundNote {"name":"${target}"}`);
  });

  it("never holds the transcript back: a model on this device that fails costs the summary, nothing else", async () => {
    const { s, rounds } = await summarising([json({ text: long })]);
    expect(await s.transcribe({ notePath: day, target, audio: recording })).toEqual({ kind: "proposed", model: "gpt-4o-transcribe" });
    expect(rounds[0]!.chunks[0]!.replacement).toBe(`\n\n> ${long}\n`);
  });

  it("asks no model for a summary where it is switched off, the transcript is short, or the profile Local names a provider", async () => {
    const off = await summarising([json({ text: long }), said(SUMMARY)], { transcriptSummary: false });
    await off.s.transcribe({ notePath: day, target, audio: recording });
    expect(off.fake.sent.map((spec) => spec.endpointId)).toEqual(["openai"]);
    const short = await summarising([json({ text: "Call Tom about ten episodes." }), said(SUMMARY)]);
    await short.s.transcribe({ notePath: day, target, audio: recording });
    expect(short.fake.sent.map((spec) => spec.endpointId)).toEqual(["openai"]);
    // The summary is the device's own work: a provider behind the profile Local is never asked for it.
    const cloud = await summarising([json({ text: long }), answer(SUMMARY)]);
    await cloud.s.updateSettings((current) => ({ ...current, profiles: { ...current.profiles, local: { providerId: "anthropic", model: "m-1" } } }));
    await cloud.s.transcribe({ notePath: day, target, audio: recording });
    expect(cloud.fake.sent.map((spec) => spec.endpointId)).toEqual(["openai"]);
    expect(cloud.rounds[0]!.chunks[0]!.replacement).toBe(`\n\n> ${long}\n`);
  });

  it("asks with the send overview first, naming the recording and its data class; declined, nothing goes", async () => {
    const { s, fake, rounds } = await transcribing([json({ text: "x" })], undefined, { approve: false });
    const asked = consentAsked(s);
    const pending = s.transcribe({ notePath: day, target, audio: recording });
    await asked;
    const consent = s.getState().consent!;
    expect(consent.manifest).toMatchObject({ dataClasses: ["audio"], sources: [{ path: recording.path, audioBytes: 3 }] });
    expect(consent.growth).toEqual([{ kind: "first" }]);
    s.answerConsent(false);
    expect(await pending).toEqual({ kind: "refused", reason: "cancelled" });
    expect(fake.sent).toHaveLength(0);
    expect(rounds).toHaveLength(0);
  });

  it("refuses before anything goes out: no Audio profile, no audio route, too large, encrypted, denied, a recording no longer in the note", async () => {
    const none = await transcribing([], null);
    expect(await none.s.transcribe({ notePath: day, target, audio: recording })).toEqual({ kind: "refused", reason: "no-model" });

    const { s, fake, vault, rounds } = await transcribing([], { providerId: "anthropic", model: "m-1" });
    expect(await s.transcribe({ notePath: day, target, audio: recording })).toEqual({ kind: "refused", reason: "no-route", provider: "Anthropic" });
    await s.updateSettings((current) => ({ ...current, profiles: { ...current.profiles, audio: { providerId: "openai", model: "whisper-1" } } }));

    const big = { ...recording, bytes: new Uint8Array(TRANSCRIPTION_MAX_BYTES + 1) };
    expect(await s.transcribe({ notePath: day, target, audio: big })).toEqual({ kind: "refused", reason: "too-large", size: TRANSCRIPTION_MAX_BYTES + 1 });

    vault.host.encrypted = () => true;
    expect(await s.transcribe({ notePath: day, target, audio: recording })).toEqual({ kind: "refused", reason: "encrypted" });
    vault.host.encrypted = () => false;

    expect(await s.transcribe({ notePath: "Salaries.md", target: "secret", audio: recording })).toEqual({ kind: "refused", reason: "denied" });
    expect(await s.transcribe({ notePath: day, target: "Gone.m4a", audio: recording })).toEqual({ kind: "refused", reason: "changed" });

    expect(fake.sent).toHaveLength(0);
    expect(rounds).toHaveLength(0);
  });

  it("says so when the provider refuses or hears nothing, and proposes nothing", async () => {
    const { s, rounds, vault } = await transcribing([[{ type: "httpError", status: 401, body: "{}" }], json({ text: "  " })]);
    expect(await s.transcribe({ notePath: day, target, audio: recording })).toMatchObject({ kind: "refused", reason: "failed", failure: { kind: "invalid_key", status: 401 }, provider: "OpenAI" });
    expect(await s.transcribe({ notePath: day, target, audio: recording })).toEqual({ kind: "refused", reason: "empty" });
    expect(rounds).toHaveLength(0);
    expect(vault.ledger().map((entry) => entry.stop)).toEqual(["failed", "answered"]);
  });
});

/** Plan KI-Harness P3-6 (§19.1 D): "@AI" in a comment thread, answered as a reply in the thread. */
describe("answering in a comment thread", () => {
  const passage = "The contract runs until the end of the year and renews itself.";
  const at = "2026-09-24T09:00:00.000Z";
  const request = {
    path: "Contract.md",
    rootCommentId: "c1",
    quote: passage,
    thread: [{ author: "Anna", body: "Does this renew by itself?", at }],
    question: "What does the note say?",
  };
  type Reply = Parameters<NonNullable<AiVaultHost["reply"]>>[0];
  type Round = Parameters<NonNullable<AiVaultHost["propose"]>>[0];

  function replying(active: string | null = "Contract.md") {
    const vault = vaultHost(active);
    const replies: Reply[] = [];
    vault.host.reply = async (reply) => {
      replies.push(reply);
    };
    return { vault, replies };
  }

  it("posts no reply through a host that is gone: a new host for the same vault while the run's end is written stops it (strand 6, step 10)", async () => {
    const { s, fake } = session([answer("It renews itself.")]);
    await s.load();
    const { vault, replies } = replying();
    vault.host.key = "vault-1";
    await s.attachVault(vault.host);
    // Once the answer is in, the run's end is written: that write is held, and meanwhile the index is rebuilt.
    const send = fake.egress.send.bind(fake.egress);
    const save = vault.host.conversations.save.bind(vault.host.conversations);
    let answered = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const saving = new Promise<void>((resolve) => (reached = resolve));
    fake.egress.send = async (id, spec, onChunk) => {
      const out = await send(id, spec, onChunk);
      answered = true;
      return out;
    };
    vault.host.conversations.save = async (record) => {
      if (answered) {
        answered = false;
        reached();
        await gate;
      }
      return save(record);
    };
    const outcome = s.replyInThread(request);
    await saving;
    await s.attachVault({ ...vault.host });
    release();
    expect(await outcome).toMatchObject({ kind: "refused", reason: "cancelled" });
    expect(replies).toEqual([]);
  });

  it("asks with the thread, its passage and the note, and posts the answer as a reply under the model's name", async () => {
    const { s, fake } = session([answer("It renews itself — see [[Contract]].")]);
    await s.load();
    const { vault, replies } = replying();
    vault.host.tools = () => ({ names: ["search_vault", "read_note", "run_command"], executor: { execute: async () => ({ content: "unused" }) } });
    await s.attachVault(vault.host);
    await s.pin("Offer.md");
    const outcome = await s.replyInThread(request);
    expect(outcome).toEqual({ kind: "replied", conversationId: expect.any(String), model: "m-1" });

    expect(fake.sent).toHaveLength(1);
    const body = JSON.stringify(fake.sent[0]!.body);
    expect(body).toContain("Does this renew by itself?");
    expect(body).toContain(`Anna (${at})`);
    expect(body).toContain("posted as a reply in this comment thread");
    expect(body).toContain("What does the note say?");
    // The thread's note goes along; what the composer's next message was given does not.
    expect(body).toContain("Rates follow");
    expect(body).not.toContain("Rates as in");
    expect(s.getState().draftPins).toEqual(["Offer.md"]);

    expect(replies).toEqual([
      { path: "Contract.md", parentCommentId: "c1", body: "It renews itself — see [[Contract]].", author: { id: "plainva-ai/m-1", displayName: 'ai.suggestionAuthor {"model":"m-1"}' } },
    ]);

    // A conversation of its own, kept in the history, without skills; the send overview named the thread.
    const saved = vault.saved.get(outcome.kind === "replied" ? outcome.conversationId : "")!;
    expect(saved.title).toBe('ai.thread.title {"note":"Contract"}');
    expect(saved.pins).toEqual(["Contract.md"]);
    expect(saved.instructions).toBeUndefined();
    // It reads the vault to answer; it does not open notes or views from a comment.
    expect(saved.conversation.tools).toEqual(["search_vault", "read_note"]);
    const manifest = saved.runs[0]!.manifest!;
    expect(manifest.dataClasses).toContain("comments");
    expect(manifest.sources[0]).toMatchObject({ path: "Contract.md", tier: "evidence", comments: 1 });
    expect(manifest.sources.slice(1).some((source) => source.path === "Contract.md" && source.comments === undefined)).toBe(true);
    // Read back from disk, the run's overview still names the thread.
    const reread = await vault.host.conversations.load(saved.id);
    expect(reread!.runs[0]!.manifest!.sources[0]).toMatchObject({ path: "Contract.md", comments: 1 });
    expect(reread!.runs[0]!.manifest!.dataClasses).toContain("comments");
  });

  it("asks with the send overview first, naming the thread; leaving the note out keeps the thread, and declined, nothing goes", async () => {
    const { s, fake } = session([answer("x")], { approve: false });
    await s.load();
    const { vault, replies } = replying();
    await s.attachVault(vault.host);
    const asked = consentAsked(s);
    const pending = s.replyInThread(request);
    await asked;
    const consent = s.getState().consent!;
    expect(consent.growth).toEqual([{ kind: "first" }]);
    expect(consent.manifest.dataClasses).toContain("comments");
    expect(consent.manifest.sources[0]).toMatchObject({ path: "Contract.md", comments: 1 });
    expect(consent.manifest.sources.length).toBeGreaterThan(1);

    const again = consentAsked(s);
    s.leaveOutOfConsent("Contract.md");
    await again;
    expect(s.getState().consent!.manifest.sources).toEqual([expect.objectContaining({ path: "Contract.md", comments: 1 })]);

    s.answerConsent(false);
    expect(await pending).toEqual({ kind: "refused", reason: "cancelled" });
    expect(fake.sent).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });

  it("names no thread in the overview when the remark brings nothing but the user's own words", async () => {
    const { s } = session([answer("x")], { approve: false });
    await s.load();
    const { vault } = replying();
    await s.attachVault(vault.host);
    const asked = consentAsked(s);
    const pending = s.replyInThread({ ...request, quote: null, thread: [] });
    await asked;
    const manifest = s.getState().consent!.manifest;
    expect(manifest.dataClasses).not.toContain("comments");
    expect(manifest.sources.every((source) => source.comments === undefined)).toBe(true);
    s.answerConsent(false);
    await pending;
  });

  it("refuses before anything goes out: no way to post, an encrypted workspace, a denied note, nothing asked, a run under way", async () => {
    const { s, fake } = session([], { approve: false });
    await s.load();
    await s.attachVault(vaultHost("Contract.md").host);
    expect(await s.replyInThread(request)).toEqual({ kind: "refused", reason: "off" });

    const { vault, replies } = replying();
    await s.attachVault(vault.host);
    vault.host.encrypted = () => true;
    expect(await s.replyInThread(request)).toEqual({ kind: "refused", reason: "encrypted" });
    vault.host.encrypted = () => false;

    // Where the note may not go, its comments do not go either.
    expect(await s.replyInThread({ ...request, path: "Salaries.md" })).toEqual({ kind: "refused", reason: "denied" });
    expect(await s.replyInThread({ ...request, quote: null, thread: [], question: "  " })).toEqual({ kind: "refused", reason: "empty" });

    const asked = consentAsked(s);
    const typed = s.send("Hello?");
    await asked;
    expect(await s.replyInThread(request)).toEqual({ kind: "refused", reason: "busy" });
    s.answerConsent(false);
    await typed;

    expect(fake.sent).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });

  it("withholds a link to a note the rules keep back, in a remark as in a note", async () => {
    const { s, fake } = session([answer("Fine.")]);
    await s.load();
    const { vault } = replying();
    await s.attachVault(vault.host);
    await s.replyInThread({ ...request, quote: "Rates as in [[Salaries]].", thread: [{ author: "Anna", body: "Compare with [[Salaries]] first.", at }] });
    const body = JSON.stringify(fake.sent[0]!.body);
    expect(body).toContain("Compare with ⟦withheld note⟧ first.");
    expect(body).toContain("Rates as in ⟦withheld note⟧.");
    expect(body).not.toContain("Salaries");
  });

  it("makes inert every address the model brought and keeps the ones the thread already had", async () => {
    const { s } = session([answer("See https://evil.example/c?d=1 and https://docs.example/terms.")]);
    await s.load();
    const { vault, replies } = replying();
    await s.attachVault(vault.host);
    await s.replyInThread({ ...request, thread: [{ author: "Anna", body: "The terms are at https://docs.example/terms", at }] });
    expect(replies.map((reply) => reply.body)).toEqual(["See https[://]evil.example/c?d=1 and https://docs.example/terms."]);
  });

  it("applies the same rule to a proposal, and says so in the round's note", async () => {
    const contract = files["Contract.md"]!;
    const from = contract.indexOf(passage);
    const range = { path: "Contract.md", from, to: from + passage.length, text: passage, doc: contract };
    const { s } = session([answer("The contract runs until the end of the year; details at https://evil.example/x?d=1")]);
    await s.load();
    const vault = vaultHost("Contract.md");
    const rounds: Round[] = [];
    vault.host.propose = async (round) => {
      rounds.push(round);
    };
    await s.attachVault(vault.host);
    expect(await s.proposeForSelection({ action: "rewrite", range })).toMatchObject({ kind: "proposed" });
    let accepted = rounds[0]!.base;
    for (const chunk of [...rounds[0]!.chunks].sort((a, b) => b.fromA - a.fromA)) accepted = accepted.slice(0, chunk.fromA) + chunk.replacement + accepted.slice(chunk.toA);
    expect(accepted).toContain("details at https[://]evil.example/x?d=1");
    expect(accepted).not.toContain("https://evil.example");
    expect(rounds[0]!.note).toBe('ai.selection.roundNote.rewrite {"model":"m-1"} ai.lint.defused');
  });

  it("says what happened when the model writes nothing, the run fails, or the reply cannot be stored", async () => {
    const { s } = session([answer("  "), [{ type: "httpError", status: 401, body: "{}" }], answer("An answer.")]);
    await s.load();
    const { vault, replies } = replying();
    await s.attachVault(vault.host);
    expect(await s.replyInThread(request)).toEqual({ kind: "refused", reason: "no-answer", conversationId: expect.any(String) });
    expect(await s.replyInThread(request)).toEqual({ kind: "refused", reason: "failed", conversationId: expect.any(String) });
    vault.host.reply = async () => {
      throw new Error("comment-operation-pending");
    };
    // The answer exists: the history keeps it, and the outcome says where.
    const lost = await s.replyInThread(request);
    expect(lost).toEqual({ kind: "refused", reason: "post-failed", conversationId: expect.any(String), message: "comment-operation-pending" });
    expect(JSON.stringify(vault.saved.get(lost.kind === "refused" ? (lost.conversationId ?? "") : "")!.conversation.turns)).toContain("An answer.");
    expect(replies).toHaveLength(0);
  });

  it("asks the shell to show a conversation when the send overview waits and none is on screen", async () => {
    const { s } = session([answer("x")], { approve: false });
    await s.load();
    const { vault } = replying();
    await s.attachVault(vault.host);
    let revealed = 0;
    s.setReveal(() => {
      revealed += 1;
    });

    // A conversation on screen answers the overview itself.
    const unmount = s.mountSurface();
    let asked = consentAsked(s);
    let pending = s.replyInThread(request);
    await asked;
    expect(revealed).toBe(0);
    s.answerConsent(false);
    await pending;

    // Unmounted (twice makes no difference): the door asks, and the shell shows the place to answer.
    unmount();
    unmount();
    asked = consentAsked(s);
    pending = s.replyInThread(request);
    await asked;
    expect(revealed).toBe(1);
    s.answerConsent(false);
    await pending;
  });
});

/** Strand 6, step 8: what the user changes of a conversation while a run of it is on its way. */
describe("a conversation changed while a run of it is on its way", () => {
  /** Holds the provider's answer until the test lets it go. */
  function held(fake: ReturnType<typeof fakeEgress>) {
    const send = fake.egress.send.bind(fake.egress);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => (reached = resolve));
    fake.egress.send = async (id, spec, onChunk) => {
      reached();
      await gate;
      return send(id, spec, onChunk);
    };
    return { waiting, release };
  }

  /** Holds the first write of a conversation until the test lets it go. */
  function heldWrite(vault: ReturnType<typeof vaultHost>) {
    const save = vault.host.conversations.save.bind(vault.host.conversations);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => (reached = resolve));
    let first = true;
    vault.host.conversations.save = async (record) => {
      if (first) {
        first = false;
        reached();
        await gate;
      }
      return save(record);
    };
    return { waiting, release };
  }

  it("keeps the title, the pins and the redaction chosen meanwhile, and the run says what it went with", async () => {
    const { s, fake } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    const hold = held(fake);
    const run = s.send("Hello");
    await hold.waiting;
    const id = s.getState().active!.id;
    await s.pin("Offer.md");
    await s.toggleRedact("Plan.md");
    // The title is on screen at once, before it is stored: a run that writes back meanwhile takes it from there.
    const renaming = s.rename(id, "Mine");
    expect(s.getState().active!.title).toBe("Mine");
    await renaming;
    // A conversation the run began is in no storage before the run ends.
    expect(vault.saved.has(id)).toBe(false);
    hold.release();
    await run;
    const active = s.getState().active!;
    expect([active.title, active.pins, active.redact]).toEqual(["Mine", ["Offer.md"], ["Plan.md"]]);
    expect(vault.saved.get(id)).toMatchObject({ title: "Mine", pins: ["Offer.md"], redact: ["Plan.md"] });
    expect(s.getState().summaries.find((summary) => summary.id === id)!.title).toBe("Mine");
    expect(active.conversation.turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    // The run went without the redaction chosen after it was sent, and its record says so (P9-6).
    expect(active.runs[0]!.redact).toBeUndefined();
  });

  it("stores a choice made meanwhile onto the conversation as it was stored, never onto the run's unfinished turns", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    const hold = held(fake);
    const run = s.send("Second");
    await hold.waiting;
    await s.pin("Offer.md");
    // On screen: the message on its way, with the pin.
    expect(s.getState().active!.conversation.turns.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    expect(s.getState().active!.pins).toEqual(["Offer.md"]);
    // Stored: the conversation before this run, with the pin — not the message on its way.
    const meanwhile = vault.saved.get(id)!;
    expect([meanwhile.conversation.turns.length, meanwhile.runs.length, meanwhile.pins]).toEqual([2, 1, ["Offer.md"]]);
    hold.release();
    await run;
    const after = vault.saved.get(id)!;
    expect([after.conversation.turns.length, after.runs.length, after.pins]).toEqual([4, 2, ["Offer.md"]]);
  });

  it("keeps the model chosen meanwhile for the next message, and the run says which model it asked", async () => {
    const { s, fake } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    const hold = held(fake);
    const run = s.send("Hello");
    await hold.waiting;
    await s.setChoice({ providerId: "openai", model: "gpt-x" });
    hold.release();
    await run;
    const active = s.getState().active!;
    expect([active.providerId, active.model]).toEqual(["openai", "gpt-x"]);
    expect([active.runs[0]!.providerId, active.runs[0]!.model]).toEqual(["anthropic", "m-1"]);
    expect([vault.saved.get(active.id)!.providerId, vault.saved.get(active.id)!.model]).toEqual(["openai", "gpt-x"]);
    expect(s.getState().summaries.find((summary) => summary.id === active.id)!.model).toBe("gpt-x");
  });

  it("keeps a choice made while the run's end is written, and writes it after", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    const hold = heldWrite(vault);
    const run = s.send("Hello");
    await hold.waiting;
    const id = s.getState().active!.id;
    // While it is written, the conversation is on screen with the run in it; the pin goes onto that.
    expect([s.getState().active!.conversation.turns.length, s.getState().active!.runs.length]).toEqual([2, 1]);
    const pinning = s.pin("Offer.md");
    hold.release();
    await Promise.all([run, pinning]);
    const stored = vault.saved.get(id)!;
    expect([stored.conversation.turns.length, stored.runs.length, stored.pins]).toEqual([2, 1, ["Offer.md"]]);
    expect([s.getState().active!.runs.length, s.getState().active!.pins]).toEqual([1, ["Offer.md"]]);
  });

  it("keeps what is chosen beside the open send overview for the next message, and the message goes as the overview showed it", async () => {
    const { s } = session([answer("One.")], { approve: false });
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    let asked = consentAsked(s);
    const run = s.send("Hello");
    await asked;
    // Beside the overview, in the context view: a note pinned, one redacted.
    await s.pin("Offer.md");
    await s.toggleRedact("Contract.md");
    // In the overview: the open note redacted for this message.
    asked = consentAsked(s);
    s.redactInConsent("Plan.md");
    await asked;
    s.answerConsent(true);
    await run;
    const active = s.getState().active!;
    // The message went as the overview showed it.
    expect(active.runs[0]!.redact).toEqual(["Plan.md"]);
    expect(active.runs[0]!.sent).not.toContain("Offer.md");
    // The conversation goes on with all three choices.
    expect(active.pins).toEqual(["Offer.md"]);
    expect([...(active.redact ?? [])].sort()).toEqual(["Contract.md", "Plan.md"]);
    expect(vault.saved.get(active.id)).toMatchObject({ pins: ["Offer.md"] });
    expect([...(vault.saved.get(active.id)!.redact ?? [])].sort()).toEqual(["Contract.md", "Plan.md"]);
  });

  it("keeps a title and a model chosen while the overview of a later message is open", async () => {
    const { s } = session([answer("One."), answer("Two.")], { approve: false });
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    let asked = consentAsked(s);
    const first = s.send("First");
    await asked;
    s.answerConsent(true);
    await first;
    const id = s.getState().active!.id;
    await s.updateSettings((settings) => ({ ...settings, confirmEveryRequest: true }));
    asked = consentAsked(s);
    const second = s.send("Second");
    await asked;
    await s.rename(id, "Mine");
    await s.setChoice({ providerId: "anthropic", model: "m-2" });
    s.answerConsent(true);
    await second;
    const active = s.getState().active!;
    expect([active.title, active.model, active.runs[1]!.model]).toEqual(["Mine", "m-2", "m-1"]);
    expect(vault.saved.get(id)).toMatchObject({ title: "Mine", model: "m-2" });
  });

  it("leaves a conversation the user deleted meanwhile deleted", async () => {
    const { s, fake } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    const hold = held(fake);
    const run = s.send("Hello");
    await hold.waiting;
    const id = s.getState().active!.id;
    const removing = s.remove(id);
    hold.release();
    await Promise.all([run, removing]);
    expect(vault.saved.has(id)).toBe(false);
    expect(s.getState().summaries.some((summary) => summary.id === id)).toBe(false);
    expect([s.getState().active, s.getState().live]).toEqual([null, null]);
    // The month's usage still counts what was asked.
    expect(vault.ledger()).toHaveLength(1);
  });

  it("writes no choice back into a conversation that is being deleted", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    // The pin comes while the deletion is on its way: the conversation is still on screen, and stays gone.
    const removing = s.remove(id);
    const pinning = s.pin("Offer.md");
    await Promise.all([removing, pinning]);
    expect(vault.saved.has(id)).toBe(false);
  });

  it("sends nothing of a message whose conversation the user leaves while its overview is open", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")], { approve: false });
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    // A new conversation's message with a note pinned and one redacted; while its overview is open, a new conversation.
    await s.pin("Contract.md");
    await s.toggleRedact("Plan.md");
    let asked = consentAsked(s);
    let run = s.send("Hello");
    await asked;
    s.newConversation();
    expect(s.getState().consent).toBeNull();
    expect(await run).toBeNull();
    expect([fake.sent.length, vault.saved.size]).toEqual([0, 0]);
    // An existing conversation's next message, and while its overview is open the conversation is deleted.
    asked = consentAsked(s);
    const first = s.send("First");
    await asked;
    s.answerConsent(true);
    await first;
    const id = s.getState().active!.id;
    await s.updateSettings((settings) => ({ ...settings, confirmEveryRequest: true }));
    asked = consentAsked(s);
    run = s.send("Second");
    await asked;
    await s.remove(id);
    expect(s.getState().consent).toBeNull();
    expect(await run).toBeNull();
    expect([fake.sent.length, vault.saved.has(id), s.getState().active]).toEqual([1, false, null]);
  });

  it("takes nothing back when a deletion fails, and keeps one that comes while the run's end is written", async () => {
    const { s } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    const remove = vault.host.conversations.remove.bind(vault.host.conversations);
    vault.host.conversations.remove = async () => {
      throw new Error("locked");
    };
    await expect(s.remove(id)).rejects.toThrow("locked");
    // Not deleted: a choice is written as before.
    await s.pin("Offer.md");
    expect(vault.saved.get(id)!.pins).toEqual(["Offer.md"]);
    vault.host.conversations.remove = remove;
    // Deleted while the run's end is written — its conversation stored, its ledger entry on the way —: it stays gone,
    // on screen and in the history too.
    const saveLedger = vault.host.ledger.save.bind(vault.host.ledger);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const ending = new Promise<void>((resolve) => (reached = resolve));
    vault.host.ledger.save = async (entries) => {
      reached();
      await gate;
      return saveLedger(entries);
    };
    const run = s.send("Second");
    await ending;
    expect(vault.saved.get(id)!.runs).toHaveLength(2);
    await s.remove(id);
    release();
    await run;
    expect([vault.saved.has(id), s.getState().active, s.getState().summaries.some((summary) => summary.id === id)]).toEqual([false, null, false]);
  });

  it("carries the latest choice with a run whose conversation is on no screen when it ends", async () => {
    const { s, fake } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    const hold = held(fake);
    const run = s.send("Hello");
    await hold.waiting;
    const id = s.getState().active!.id;
    await s.pin("Offer.md");
    await s.toggleRedact("Contract.md");
    // Another vault: the screen forgets the conversation; the run still ends in its own vault, with the pin and the redaction.
    await s.attachVault(vaultHost("Plan.md").host);
    hold.release();
    await run;
    expect(vault.saved.get(id)).toMatchObject({ pins: ["Offer.md"], redact: ["Contract.md"] });
  });

  it("reads a conversation that is not on screen only after its writes, so that a rename keeps a pin still being written", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    const hold = heldWrite(vault);
    const pinning = s.pin("Offer.md");
    await hold.waiting;
    s.newConversation();
    const renaming = s.rename(id, "Mine");
    // A full turn first: a reading that did not wait for the write would have read the conversation without the pin.
    await new Promise((resolve) => setTimeout(resolve, 0));
    hold.release();
    await Promise.all([pinning, renaming]);
    expect(vault.saved.get(id)).toMatchObject({ title: "Mine", pins: ["Offer.md"] });
  });

  /** Holds the first reading of the situation — what a message is put together from — until the test lets it go. */
  function heldSituation(vault: ReturnType<typeof vaultHost>) {
    const situation = vault.host.situation.bind(vault.host);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => (reached = resolve));
    let first = true;
    vault.host.situation = async () => {
      if (first) {
        first = false;
        reached();
        await gate;
      }
      return situation();
    };
    return { waiting, release };
  }

  it("asks and sends nothing of a message whose screen the user left while it was put together", async () => {
    const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")], { approve: false });
    // Every overview that comes is counted and approved: a message that is to go nowhere would go.
    let asked = 0;
    s.subscribe(() => {
      if (s.getState().consent) {
        asked += 1;
        s.answerConsent(true);
      }
    });
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    const b = s.getState().active!.id;
    const before = [fake.sent.length, asked];
    // The next message of a conversation, within the approved scope, so no overview asks — and each way of leaving
    // its screen while its context is put together.
    const ways: [string, string, () => unknown][] = [
      ["a new conversation begun", b, () => s.newConversation()],
      ["another conversation opened", b, () => s.open(a)],
      ["the conversation deleted", b, () => s.remove(b)],
      ["the vault attached again", a, () => s.attachVault(vault.host)],
      ["the whole history deleted", a, () => s.removeAll()],
    ];
    for (const [way, from, leave] of ways) {
      await s.open(from);
      const hold = heldSituation(vault);
      const run = s.send("Next");
      await hold.waiting;
      await leave();
      hold.release();
      expect(await run, way).toBeNull();
    }
    // Where every request asks first, its overview does not come.
    await s.updateSettings((settings) => ({ ...settings, confirmEveryRequest: true }));
    const hold = heldSituation(vault);
    const run = s.send("Last");
    await hold.waiting;
    s.newConversation();
    hold.release();
    expect(await run).toBeNull();
    expect([fake.sent.length, asked]).toEqual(before);
  });

  it("asks nothing again and sends nothing of a message whose screen the user left while its overview was built again", async () => {
    const { s, fake } = session([answer("One.")], { approve: false });
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    const shown = consentAsked(s);
    const run = s.send("Hello");
    await shown;
    // A note left out — the overview is built again —, and meanwhile another conversation begun.
    s.leaveOutOfConsent("Plan.md");
    s.newConversation();
    // Were the overview to come again, it would be approved.
    let again = 0;
    s.subscribe(() => {
      if (s.getState().consent) {
        again += 1;
        s.answerConsent(true);
      }
    });
    expect(await run).toBeNull();
    expect([fake.sent.length, vault.saved.size, again]).toEqual([0, 0, 0]);
  });

  it("sends nothing of a message whose overview is open when the user opens another conversation, and keeps what was chosen there", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")], { approve: false });
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    // Every request asks: each message here has its overview.
    await s.updateSettings((settings) => ({ ...settings, confirmEveryRequest: true }));
    const approved = async (text: string) => {
      const asked = consentAsked(s);
      const run = s.send(text);
      await asked;
      s.answerConsent(true);
      await run;
    };
    await approved("First");
    const a = s.getState().active!.id;
    s.newConversation();
    await approved("Second");
    const b = s.getState().active!.id;
    await s.open(a);
    const asked = consentAsked(s);
    const third = s.send("Third");
    await asked;
    // Beside the overview: a note redacted in the context view, stored with the conversation at once.
    await s.toggleRedact("Plan.md");
    await s.open(b);
    expect(s.getState().consent).toBeNull();
    expect(await third).toBeNull();
    expect([fake.sent.length, vault.saved.get(a)!.redact, vault.saved.get(a)!.conversation.turns.length]).toEqual([2, ["Plan.md"], 2]);
  });

  it("loses nothing chosen before, during or after a deletion that fails", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    // Before: a pin still being written, and a redaction waiting for it.
    const hold = heldWrite(vault);
    const pinning = s.pin("Offer.md");
    await hold.waiting;
    const redacting = s.toggleRedact("Plan.md");
    vault.host.conversations.remove = async () => {
      throw new Error("locked");
    };
    const removing = s.remove(id).catch((error: Error) => error.message);
    // During: a new title, while the deletion is on its way.
    const renaming = s.rename(id, "Kept");
    hold.release();
    expect(await removing).toBe("locked");
    await Promise.all([pinning, redacting, renaming]);
    // After: another pin.
    await s.pin("Contract.md");
    expect(vault.saved.get(id)).toMatchObject({ pins: ["Offer.md", "Contract.md"], redact: ["Plan.md"], title: "Kept" });
  });

  it("puts a run's end on screen and into storage where a deletion asked for meanwhile fails, with a choice made while it waited", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    const hold = held(fake);
    const run = s.send("Second");
    await hold.waiting;
    let fail!: (error: Error) => void;
    let started!: () => void;
    const deleting = new Promise<void>((resolve) => (started = resolve));
    vault.host.conversations.remove = () =>
      new Promise<void>((_, reject) => {
        fail = reject;
        started();
      });
    const removing = s.remove(id).catch(() => "failed");
    await deleting;
    hold.release();
    // While the deletion is on its way, the run's end does not come on screen.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.getState().active?.runs.length).toBe(1);
    // A pin now goes onto the run's end, not onto what the screen still shows.
    const pinning = s.pin("Offer.md");
    fail(new Error("locked"));
    expect(await removing).toBe("failed");
    await Promise.all([run, pinning]);
    const active = s.getState().active;
    expect([active?.id, active?.runs.length, active?.pins, vault.saved.get(id)!.runs.length, vault.saved.get(id)!.pins]).toEqual([id, 2, ["Offer.md"], 2, ["Offer.md"]]);
  });

  it("deletes with Delete all only the conversations of the vault on screen", async () => {
    for (const moment of ["on its way", "being written"] as const) {
      const { s, fake } = session([answer("One.")]);
      await s.load();
      const first = vaultHost("Plan.md");
      await s.attachVault(first.host);
      const hold = moment === "on its way" ? held(fake) : heldWrite(first);
      const run = s.send("Hello");
      await hold.waiting;
      const id = s.getState().active!.id;
      // Another vault, and all of its conversations deleted while the first vault's conversation is still on its way
      // or being written.
      await s.attachVault(vaultHost("Plan.md").host);
      await s.removeAll();
      hold.release();
      await run;
      // Back in the first vault, it is there: on screen when opened, and a title chosen now is stored.
      await s.attachVault(first.host);
      await s.open(id);
      await s.rename(id, "Kept");
      expect([s.getState().active?.title, first.saved.get(id)?.title], moment).toEqual(["Kept", "Kept"]);
    }
  });

  it("asks and sends nothing of a message whose vault went while it was put together, nor of a run asked again", async () => {
    const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")], { approve: false });
    // Every overview that comes is counted and approved: a message that is to go nowhere would go.
    let asked = 0;
    s.subscribe(() => {
      if (s.getState().consent) {
        asked += 1;
        s.answerConsent(true);
      }
    });
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    // A message of the composer, the first of this session: its overview would ask.
    let hold = heldSituation(vault);
    const run = s.send("Hello");
    await hold.waiting;
    await s.attachVault(vaultHost("Plan.md").host);
    hold.release();
    expect(await run).toBeNull();
    expect([fake.sent.length, asked, s.getState().live, s.getState().active]).toEqual([0, 0, null, null]);
    // A run asked again of a model (plan P9-2) starts apart from the composer, so only its vault decides — where the
    // overview would not ask, and where it would.
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    const before = [fake.sent.length, asked];
    for (const strict of [false, true]) {
      await s.updateSettings((settings) => ({ ...settings, confirmEveryRequest: strict }));
      await s.attachVault(vault.host);
      hold = heldSituation(vault);
      const replay = s.replay(id, 0, { providerId: "anthropic", model: "m-1" });
      await hold.waiting;
      await s.attachVault(vaultHost("Plan.md").host);
      hold.release();
      expect(await replay, strict ? "the overview would ask" : "nothing would ask").toBeNull();
    }
    expect([fake.sent.length, asked]).toEqual(before);
  });

  it("keeps a conversation deleted when another deletion of it fails, whichever comes first", async () => {
    // The two deletions in the order they are asked for, and which of them the store refuses.
    const cases: [string, ("remove" | "all")[], number][] = [
      ["a second deletion of it fails", ["remove", "remove"], 1],
      ["Delete all fails after it", ["remove", "all"], 1],
      ["the first deletion fails, a second succeeds", ["remove", "remove"], 0],
      ["it fails, Delete all succeeds", ["remove", "all"], 0],
      ["Delete all fails, a deletion of it succeeds", ["all", "remove"], 0],
    ];
    for (const [name, order, failing] of cases) {
      const { s, fake } = session([answer("One."), answer("Two.")]);
      await s.load();
      const vault = vaultHost("Plan.md");
      await s.attachVault(vault.host);
      await s.send("First");
      const id = s.getState().active!.id;
      // A run of it on its way, which ends once both deletions are through.
      const hold = held(fake);
      const run = s.send("Second");
      await hold.waiting;
      const remove = vault.host.conversations.remove.bind(vault.host.conversations);
      const removeAll = vault.host.conversations.removeAll.bind(vault.host.conversations);
      let asked = 0;
      const refused = () => (asked += 1) - 1 === failing;
      vault.host.conversations.remove = async (target) => {
        if (refused()) throw new Error("locked");
        return remove(target);
      };
      vault.host.conversations.removeAll = async () => {
        if (refused()) throw new Error("locked");
        return removeAll();
      };
      const outcomes = await Promise.all(order.map((kind) => (kind === "remove" ? s.remove(id) : s.removeAll()).then(() => "done", () => "failed")));
      expect(outcomes, name).toEqual(order.map((_, index) => (index === failing ? "failed" : "done")));
      hold.release();
      await run;
      // Nothing of it comes back: not on screen, not in the history, not in storage, not through a choice made now.
      await s.rename(id, "Back");
      expect([s.getState().active, s.getState().summaries.some((summary) => summary.id === id), vault.saved.has(id)], name).toEqual([null, false, false]);
    }
  });

  it("loses nothing when Delete all fails: a conversation opens as before, what is chosen afterwards is stored, and a run's end comes on screen", async () => {
    const { s } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    vault.host.conversations.removeAll = async () => {
      throw new Error("locked");
    };
    expect(await s.removeAll().catch((error: Error) => error.message)).toBe("locked");
    s.newConversation();
    await s.open(id);
    await s.rename(id, "Kept");
    expect([s.getState().active?.id, s.getState().active?.title, vault.saved.get(id)?.title]).toEqual([id, "Kept", "Kept"]);
    await s.send("Again");
    expect([s.getState().active?.runs.length, s.getState().summaries.some((summary) => summary.id === id), vault.saved.get(id)?.runs.length]).toEqual([2, true, 2]);
  });

  /** Holds the vault's "Delete all" until the test lets it go; `begun` once it was asked of the vault. */
  function heldClearing(vault: ReturnType<typeof vaultHost>) {
    const removeAll = vault.host.conversations.removeAll.bind(vault.host.conversations);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const begun = new Promise<void>((resolve) => (started = resolve));
    vault.host.conversations.removeAll = async () => {
      started();
      await gate;
      return removeAll();
    };
    return { begun, release };
  }

  /** Reads a conversation at once but hands the first reading back only once the test lets it go; `reading` once it was read. */
  function slowRead(vault: ReturnType<typeof vaultHost>) {
    const load = vault.host.conversations.load.bind(vault.host.conversations);
    let read!: () => void;
    const reading = new Promise<void>((resolve) => (read = resolve));
    let reply!: () => void;
    const replied = new Promise<void>((resolve) => (reply = resolve));
    let first = true;
    vault.host.conversations.load = async (id) => {
      const record = await load(id);
      if (first) {
        first = false;
        read();
        await replied;
      }
      return record;
    };
    return { reading, reply };
  }

  /** Holds the writes of conversations with these numbers (the first after this call is 1) until the test lets each go. */
  function heldSaves(vault: ReturnType<typeof vaultHost>, numbers: readonly number[]) {
    const save = vault.host.conversations.save.bind(vault.host.conversations);
    const gates = new Map(
      numbers.map((n) => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        let reached!: () => void;
        const waiting = new Promise<void>((resolve) => (reached = resolve));
        return [n, { gate, release, reached, waiting }] as const;
      }),
    );
    let count = 0;
    vault.host.conversations.save = async (record) => {
      const hold = gates.get((count += 1));
      if (hold) {
        hold.reached();
        await hold.gate;
      }
      return save(record);
    };
    return { waiting: (n: number) => gates.get(n)!.waiting, release: (n: number) => gates.get(n)!.release() };
  }

  /** A conversation another window wrote, which this session does not list — and which reads. */
  function writtenElsewhere(vault: ReturnType<typeof vaultHost>, like: string) {
    const written = vault.saved.get(like)!;
    vault.saved.set("elsewhere", { ...written, id: "elsewhere", conversation: { ...written.conversation, id: "elsewhere" } });
  }

  it("clears the history only once the writes on their way have landed", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    // A pin still being written when Delete all comes: it lands before the history is cleared, never after.
    const hold = heldWrite(vault);
    const pinning = s.pin("Offer.md");
    await hold.waiting;
    const clearing = s.removeAll();
    // Whatever does not wait for the pin has happened by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    hold.release();
    await Promise.all([pinning, clearing]);
    expect(vault.saved.size).toBe(0);
  });

  it("writes a conversation begun while the history is cleared after the clearing, so that it stays", async () => {
    const { s } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const first = s.getState().active!.id;
    const hold = heldClearing(vault);
    const clearing = s.removeAll();
    await hold.begun;
    // While the history is cleared: a new conversation's message, answered, and its end on screen.
    const ended = new Promise<void>((resolve) => {
      const off = s.subscribe(() => {
        const active = s.getState().active;
        if (active && active.id !== first && active.runs.length === 1) {
          off();
          resolve();
        }
      });
    });
    s.newConversation();
    const sending = s.send("Meanwhile");
    await ended;
    // Whatever does not wait for the clearing has happened by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    hold.release();
    await Promise.all([clearing, sending]);
    const id = s.getState().active!.id;
    expect([id !== first, vault.saved.has(id), vault.saved.has(first)]).toEqual([true, true, false]);
    expect(s.getState().summaries.map((summary) => summary.id)).toEqual([id]);
  });

  it("reads a conversation opened while the history is cleared only after the clearing", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    // A conversation another window wrote meanwhile, which this one does not list — and which reads.
    const written = vault.saved.get(s.getState().active!.id)!;
    vault.saved.set("elsewhere", { ...written, id: "elsewhere", conversation: { ...written.conversation, id: "elsewhere" } });
    expect(await vault.host.conversations.load("elsewhere")).not.toBeNull();
    const hold = heldClearing(vault);
    const clearing = s.removeAll();
    await hold.begun;
    const slow = slowRead(vault);
    const opening = s.open("elsewhere");
    // A full turn first: a reading that did not wait for the clearing would have read the conversation before it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    hold.release();
    await clearing;
    slow.reply();
    await opening;
    expect([s.getState().active, vault.saved.size]).toEqual([null, 0]);
  });

  it("shows no conversation that was read for opening just before it was deleted", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    s.newConversation();
    const slow = slowRead(vault);
    const opening = s.open(id);
    await slow.reading;
    await s.remove(id);
    slow.reply();
    await opening;
    expect([s.getState().active, vault.saved.has(id)]).toEqual([null, false]);
  });

  it("lists a conversation whose deletion, asked for while its first run's end was written, fails", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    // The run's end held at its ledger entry: its conversation is written by then.
    const saveLedger = vault.host.ledger.save.bind(vault.host.ledger);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const ending = new Promise<void>((resolve) => (reached = resolve));
    vault.host.ledger.save = async (entries) => {
      reached();
      await gate;
      return saveLedger(entries);
    };
    const run = s.send("Hello");
    await ending;
    const id = s.getState().active!.id;
    // A deletion asked for now, which fails a moment later.
    let fail!: (error: Error) => void;
    vault.host.conversations.remove = () => new Promise<void>((_, reject) => (fail = reject));
    const removing = s.remove(id).catch(() => "failed");
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fail(new Error("locked"));
    expect(await removing).toBe("failed");
    await run;
    expect([s.getState().active?.id, s.getState().summaries.map((summary) => summary.id), vault.saved.has(id)]).toEqual([id, [id], true]);
  });

  it("keeps the overview of a run asked again open when the user begins a new conversation", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")], { approve: false });
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    let shown = consentAsked(s);
    const first = s.send("First");
    await shown;
    s.answerConsent(true);
    await first;
    const id = s.getState().active!.id;
    await s.updateSettings((settings) => ({ ...settings, confirmEveryRequest: true }));
    shown = consentAsked(s);
    const replay = s.replay(id, 0, { providerId: "anthropic", model: "m-1" });
    await shown;
    // A run asked again is no message of the composer: leaving the screen leaves its overview open.
    s.newConversation();
    expect(s.getState().consent).not.toBeNull();
    s.answerConsent(true);
    expect(await replay).toEqual({ kind: "answered" });
    expect(fake.sent.length).toBe(2);
  });

  it("takes off the screen with Delete all only what it deleted: a conversation begun meanwhile stays", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const clearingHold = heldClearing(vault);
    const clearing = s.removeAll();
    await clearingHold.begun;
    // While the history is cleared: a new conversation's message on its way.
    s.newConversation();
    const request = held(fake);
    const sending = s.send("Meanwhile");
    await request.waiting;
    const id = s.getState().active!.id;
    clearingHold.release();
    await clearing;
    expect([s.getState().active?.id, s.getState().live?.conversationId]).toEqual([id, id]);
    request.release();
    await sending;
    expect([s.getState().active?.id, vault.saved.has(id)]).toEqual([id, true]);
  });

  it("lists a conversation whose first run's end was written when a Delete all that then fails was asked", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    // The run's end held at its ledger entry: its conversation is written by then.
    const saveLedger = vault.host.ledger.save.bind(vault.host.ledger);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const ending = new Promise<void>((resolve) => (reached = resolve));
    vault.host.ledger.save = async (entries) => {
      reached();
      await gate;
      return saveLedger(entries);
    };
    const run = s.send("Hello");
    await ending;
    const id = s.getState().active!.id;
    // Delete all now, which fails a moment later.
    let fail!: (error: Error) => void;
    vault.host.conversations.removeAll = () => new Promise<void>((_, reject) => (fail = reject));
    const clearing = s.removeAll().catch(() => "failed");
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fail(new Error("locked"));
    expect(await clearing).toBe("failed");
    await run;
    expect([s.getState().active?.id, s.getState().summaries.map((summary) => summary.id), vault.saved.has(id)]).toEqual([id, [id], true]);
  });

  it("clears with Delete all also what a run of the vault writes through the host it began with", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    vault.host.key = "vault-1";
    await s.attachVault(vault.host);
    const hold = heldWrite(vault);
    const run = s.send("Hello");
    await hold.waiting;
    // The shell hands a new host for the same vault — the same data key —, and all its conversations are deleted.
    await s.attachVault({ ...vault.host });
    const clearing = s.removeAll();
    // Whatever does not wait for the write has happened by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    hold.release();
    await Promise.all([clearing, run]);
    expect(vault.saved.size).toBe(0);
  });

  it("keeps a conversation begun while a second Delete all is on its way", async () => {
    const { s } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const first = s.getState().active!.id;
    // Two Delete alls in a row; the second held in the store.
    const removeAll = vault.host.conversations.removeAll.bind(vault.host.conversations);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const second = new Promise<void>((resolve) => (reached = resolve));
    vault.host.conversations.removeAll = async () => {
      calls += 1;
      if (calls === 2) {
        reached();
        await gate;
      }
      return removeAll();
    };
    const clearing = Promise.all([s.removeAll(), s.removeAll()]);
    await second;
    // While the second is on its way: a new conversation's message, answered, and its end on screen.
    const ended = new Promise<void>((resolve) => {
      const off = s.subscribe(() => {
        const active = s.getState().active;
        if (active && active.id !== first && active.runs.length === 1) {
          off();
          resolve();
        }
      });
    });
    s.newConversation();
    const sending = s.send("Meanwhile");
    await ended;
    // Whatever does not wait for the clearing has happened by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([clearing, sending]);
    const id = s.getState().active!.id;
    expect([id !== first, vault.saved.has(id)]).toEqual([true, true]);
    expect(s.getState().summaries.map((summary) => summary.id)).toEqual([id]);
  });

  it("renames nothing that Delete all took while it was read", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    writtenElsewhere(vault, s.getState().active!.id);
    expect(await vault.host.conversations.load("elsewhere")).not.toBeNull();
    // Read for a rename, then Delete all, then the reading comes back.
    const slow = slowRead(vault);
    const renaming = s.rename("elsewhere", "Back");
    await slow.reading;
    await s.removeAll();
    slow.reply();
    await renaming;
    expect(vault.saved.size).toBe(0);
  });

  it("opens a conversation renamed from the history while it was read as it is now", async () => {
    const { s } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    // The first opened from the history and read slowly; meanwhile renamed there.
    const slow = slowRead(vault);
    const opening = s.open(a);
    await slow.reading;
    await s.rename(a, "New");
    slow.reply();
    await opening;
    expect([s.getState().active?.id, s.getState().active?.title]).toEqual([a, "New"]);
    // A choice made now keeps the new title.
    await s.pin("Offer.md");
    expect(vault.saved.get(a)).toMatchObject({ title: "New", pins: ["Offer.md"] });
  });

  it("sends nothing of a message begun after another conversation was clicked, once that one comes on screen", async () => {
    const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    const b = s.getState().active!.id;
    await s.open(a);
    // The second conversation clicked; it is read slowly.
    const slow = slowRead(vault);
    const opening = s.open(b);
    await slow.reading;
    // Still looking at the first: a message, and a pin.
    const situation = heldSituation(vault);
    const run = s.send("Still here");
    await situation.waiting;
    await s.pin("Offer.md");
    slow.reply();
    await opening;
    situation.release();
    expect(await run).toBeNull();
    expect([s.getState().active?.id, fake.sent.length, vault.saved.get(a)?.pins]).toEqual([b, 2, ["Offer.md"]]);
  });

  it("shows the conversation clicked last, whichever reading comes back first", async () => {
    const { s } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    const b = s.getState().active!.id;
    s.newConversation();
    // Both read slowly; the one clicked first comes back first.
    const load = vault.host.conversations.load.bind(vault.host.conversations);
    const gates = new Map<string, () => void>();
    const waits = new Map<string, Promise<void>>();
    for (const id of [a, b]) waits.set(id, new Promise<void>((resolve) => gates.set(id, resolve)));
    vault.host.conversations.load = async (id) => {
      const record = await load(id);
      await waits.get(id);
      return record;
    };
    const first = s.open(a);
    const second = s.open(b);
    gates.get(a)!();
    await first;
    gates.get(b)!();
    await second;
    expect(s.getState().active?.id).toBe(b);
  });

  it("leaves a slow opening behind a later step on screen", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    const slow = slowRead(vault);
    const opening = s.open(a);
    await slow.reading;
    s.newConversation();
    slow.reply();
    await opening;
    expect(s.getState().active).toBeNull();
  });

  it("goes on with a message whose overview is open while its own conversation is opened again or another is deleted", async () => {
    const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")], { approve: false });
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.updateSettings((settings) => ({ ...settings, confirmEveryRequest: true }));
    const approved = async (text: string) => {
      const asked = consentAsked(s);
      const run = s.send(text);
      await asked;
      s.answerConsent(true);
      await run;
    };
    await approved("First");
    const a = s.getState().active!.id;
    s.newConversation();
    await approved("Second");
    const b = s.getState().active!.id;
    await s.open(a);
    const asked = consentAsked(s);
    const third = s.send("Third");
    await asked;
    // Neither leaves the conversation the message is for.
    await s.open(a);
    await s.remove(b);
    expect(s.getState().consent).not.toBeNull();
    s.answerConsent(true);
    expect(await third).toEqual({ kind: "answered" });
    expect([fake.sent.length, vault.saved.has(b), vault.saved.get(a)!.runs.length]).toEqual([3, false, 2]);
  });

  it("takes a redaction back for the conversation where its overview took it back", async () => {
    const { s } = session([answer("One."), answer("Two.")], { approve: false });
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    let asked = consentAsked(s);
    const first = s.send("First");
    await asked;
    s.answerConsent(true);
    await first;
    const id = s.getState().active!.id;
    await s.toggleRedact("Plan.md");
    await s.updateSettings((settings) => ({ ...settings, confirmEveryRequest: true }));
    asked = consentAsked(s);
    const second = s.send("Second");
    await asked;
    // In the overview the redaction is taken back: the overview is built again and asks again.
    asked = consentAsked(s);
    s.redactInConsent("Plan.md");
    await asked;
    s.answerConsent(true);
    await second;
    expect([s.getState().active?.redact ?? [], vault.saved.get(id)!.redact ?? []]).toEqual([[], []]);
  });

  it("keeps each later write behind the one before it, also once an earlier one landed", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    const saves = heldSaves(vault, [1, 2]);
    const pinning = s.pin("Offer.md");
    await saves.waiting(1);
    const pinningMore = s.pin("Contract.md");
    saves.release(1);
    await saves.waiting(2);
    // The third comes while the second is in the store.
    const redacting = s.toggleRedact("Plan.md");
    await new Promise((resolve) => setTimeout(resolve, 0));
    saves.release(2);
    await Promise.all([pinning, pinningMore, redacting]);
    expect(vault.saved.get(id)).toMatchObject({ pins: ["Offer.md", "Contract.md"], redact: ["Plan.md"] });
  });

  it("starts nothing of a skill whose screen the user left while it was looked up", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    // The vault's instructions are read slowly; meanwhile the first conversation is opened again.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const scanning = new Promise<void>((resolve) => (reached = resolve));
    vault.host.instructions = {
      async scan() {
        reached();
        await gate;
        return [];
      },
      scanOne: async () => null,
      readFile: async () => null,
      approvals: { load: async () => EMPTY_INSTRUCTION_APPROVALS, save: async () => undefined },
    };
    const starting = s.runSkill("plainva:writing", "Summarise it.");
    await scanning;
    await s.open(a);
    release();
    expect(await starting).toBeNull();
    expect([fake.sent.length, s.getState().active?.id]).toEqual([1, a]);
  });

  it("opens again after a skill's regression run the conversation that was open, as it is now", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    // A scenario on its way; meanwhile the conversation renamed from the history.
    const hold = held(fake);
    const testing = s.testSkills(["plainva:task-triage"], { maxCostUsd: null });
    await hold.waiting;
    await s.rename(id, "Kept");
    hold.release();
    await testing;
    expect([s.getState().active?.id, s.getState().active?.title]).toEqual([id, "Kept"]);
  });

  it("leaves the screen as the user made it after a skill's regression run", async () => {
    const { s } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    const b = s.getState().active!.id;
    await s.open(a);
    // The scenario's result being saved; meanwhile the user goes to the second conversation.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const saving = new Promise<void>((resolve) => (reached = resolve));
    vault.host.skillTests = {
      load: async () => EMPTY_SKILL_TESTS,
      async save() {
        reached();
        await gate;
      },
    };
    const testing = s.testSkills(["plainva:task-triage"], { maxCostUsd: null });
    await saving;
    await s.open(b);
    release();
    await testing;
    expect(s.getState().active?.id).toBe(b);
  });

  it("keeps a run's end off the screen while a deletion of it is on its way — beside one that failed, or a Delete all", async () => {
    for (const second of ["remove", "all"] as const) {
      const { s, fake } = session([answer("One."), answer("Two.")]);
      await s.load();
      const vault = vaultHost("Plan.md");
      await s.attachVault(vault.host);
      await s.send("First");
      const id = s.getState().active!.id;
      const hold = held(fake);
      const run = s.send("Second");
      await hold.waiting;
      // A first deletion the store refuses at once — only for a deletion beside it —, a second one it holds.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const remove = vault.host.conversations.remove.bind(vault.host.conversations);
      const removeAll = vault.host.conversations.removeAll.bind(vault.host.conversations);
      let removes = 0;
      vault.host.conversations.remove = async (target) => {
        removes += 1;
        if (removes === 1 && second === "remove") throw new Error("locked");
        await gate;
        return remove(target);
      };
      vault.host.conversations.removeAll = async () => {
        await gate;
        return removeAll();
      };
      const first = second === "remove" ? s.remove(id).catch(() => "failed") : Promise.resolve("none");
      const other = second === "remove" ? s.remove(id) : s.removeAll();
      expect(await first, second).toBe(second === "remove" ? "failed" : "none");
      hold.release();
      // The run's end is through its answer while the deletion is still on its way: it does not come on screen.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(s.getState().active?.runs.length, second).toBe(1);
      release();
      await Promise.all([other, run]);
      expect([s.getState().active, vault.saved.has(id)], second).toEqual([null, false]);
    }
  });

  /** Holds every deletion of a conversation in the store until the test lets it go, then deletes it. */
  function heldDeletion(vault: ReturnType<typeof vaultHost>) {
    const remove = vault.host.conversations.remove.bind(vault.host.conversations);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => (reached = resolve));
    vault.host.conversations.remove = async (id) => {
      reached();
      await gate;
      return remove(id);
    };
    return { waiting, release };
  }

  /** Holds the run's ledger entry until the test lets it go; `reached` once the run's end is there — its conversation written. */
  function heldLedger(vault: ReturnType<typeof vaultHost>) {
    const save = vault.host.ledger.save.bind(vault.host.ledger);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let arrived!: () => void;
    const reached = new Promise<void>((resolve) => (arrived = resolve));
    vault.host.ledger.save = async (entries) => {
      arrived();
      await gate;
      return save(entries);
    };
    return { reached, release };
  }

  it("takes no message into a conversation whose deletion was asked for", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    // The deletion on its way in a slow store; the conversation is still on screen.
    const deletion = heldDeletion(vault);
    const removing = s.remove(id);
    await deletion.waiting;
    expect(s.getState().active?.id).toBe(id);
    const into = s.send("Into it");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([fake.sent.length, s.getState().live]).toEqual([1, null]);
    deletion.release();
    expect(await into).toBeNull();
    await removing;
    expect([fake.sent.length, s.getState().active, vault.saved.has(id)]).toEqual([1, null, false]);
  });

  it("keeps a run's end in storage when deletions asked for while it ended fail, with the choices made meanwhile", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    const hold = held(fake);
    const run = s.send("Second");
    await hold.waiting;
    // Every deletion fails, each when the test says so.
    const fails: ((error: Error) => void)[] = [];
    let asked!: () => void;
    let deletion = new Promise<void>((resolve) => (asked = resolve));
    vault.host.conversations.remove = () =>
      new Promise<void>((_, reject) => {
        fails.push(reject);
        asked();
      });
    const ledger = heldLedger(vault);
    const first = s.remove(id).catch(() => "failed");
    await deletion;
    hold.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fails[0]!(new Error("locked"));
    expect(await first).toBe("failed");
    // The run's end is written; while its ledger entry is held, a pin goes onto it — its write held in the store.
    await ledger.reached;
    const saves = heldSaves(vault, [1]);
    const pinning = s.pin("Offer.md");
    await saves.waiting(1);
    ledger.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The run's end now waits for the pin's write; a second deletion comes behind it, and fails too.
    deletion = new Promise<void>((resolve) => (asked = resolve));
    const second = s.remove(id).catch(() => "failed");
    saves.release(1);
    await deletion;
    fails[1]!(new Error("locked"));
    expect(await second).toBe("failed");
    await Promise.all([run, pinning]);
    // A choice after the run's end goes onto the run's end.
    await s.pin("Contract.md");
    expect([vault.saved.get(id)!.runs.length, vault.saved.get(id)!.pins]).toEqual([2, ["Offer.md", "Contract.md"]]);
  });

  it("lists nothing of a conversation's first run while a deletion asked for after its end was written is on its way", async () => {
    const { s, fake } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    const ledger = heldLedger(vault);
    const run = s.send("Hello");
    await ledger.reached;
    const id = s.getState().active!.id;
    // A pin while the ledger is held, its write held in the store; then the end goes on and waits for it.
    const saves = heldSaves(vault, [1]);
    const pinning = s.pin("Offer.md");
    await saves.waiting(1);
    ledger.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Deleted now, in a slow store, behind the pin's write.
    const deletion = heldDeletion(vault);
    const removing = s.remove(id);
    saves.release(1);
    await deletion.waiting;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.getState().summaries.some((summary) => summary.id === id)).toBe(false);
    deletion.release();
    await Promise.all([removing, run, pinning]);
    expect([s.getState().summaries.some((summary) => summary.id === id), s.getState().active, vault.saved.has(id), fake.sent.length]).toEqual([false, null, false, 1]);
  });

  it("asks nothing again of a conversation that Delete all takes while the replay is put together", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    const hold = heldSituation(vault);
    const replay = s.replay(id, 0, { providerId: "anthropic", model: "m-1" });
    await hold.waiting;
    await s.removeAll();
    hold.release();
    expect(await replay).toBeNull();
    expect([fake.sent.length, vault.saved.size, s.getState().summaries]).toEqual([1, 0, []]);
  });

  it("starts nothing again of a conversation not on screen that is deleted while the replay is put together", async () => {
    const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    const b = s.getState().active!.id;
    // Asked again of the first, which is not on screen; its notes read slowly, and meanwhile it is deleted.
    const readNote = vault.host.readNote.bind(vault.host);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const reading = new Promise<void>((resolve) => (reached = resolve));
    let first = true;
    vault.host.readNote = async (path) => {
      if (first) {
        first = false;
        reached();
        await gate;
      }
      return readNote(path);
    };
    const replay = s.replay(a, 0, { providerId: "anthropic", model: "m-1" });
    await reading;
    await s.remove(a);
    release();
    expect(await replay).toBeNull();
    // The screen stays as the user made it.
    expect([fake.sent.length, s.getState().active?.id]).toEqual([2, b]);
  });

  it("keeps a notice about another conversation when one is deleted", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    // The next conversation's request gets no answer: a notice on that one.
    await s.send("Second");
    const notice = s.getState().notice;
    expect([notice !== null, notice?.conversationId === a]).toEqual([true, false]);
    await s.remove(a);
    expect(s.getState().notice).toBe(notice);
  });

  it("takes a notice about a conversation off the screen with the conversation", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    // The next request gets no answer: a notice on the conversation.
    await s.send("Second");
    expect(s.getState().notice?.conversationId).toBe(id);
    await s.remove(id);
    expect([s.getState().active, s.getState().notice]).toEqual([null, null]);
  });

  it("runs a regression run's scenarios where the conversation of their last run cannot be deleted", async () => {
    const { s } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    // The results are kept on this device: the next run knows the conversation of the last one.
    let records = EMPTY_SKILL_TESTS;
    vault.host.skillTests = {
      load: async () => records,
      save: async (next) => void (records = next),
    };
    expect(await s.testSkills(["plainva:task-triage"], { maxCostUsd: null })).toMatchObject({ kind: "done", ran: 1 });
    const last = records.records.find((record) => record.id === "plainva:task-triage")?.scenarios[0]?.conversationId;
    expect(last && vault.saved.has(last)).toBe(true);
    // From now on the store refuses to delete anything.
    vault.host.conversations.remove = async () => {
      throw new Error("locked");
    };
    expect(await s.testSkills(["plainva:task-triage"], { maxCostUsd: null })).toMatchObject({ kind: "done", ran: 1, stopped: null });
    expect(vault.saved.has(last!)).toBe(true);
  });

  it("keeps a scenario's conversation the user went on with when the regression run comes again", async () => {
    const { s } = session([answer("One."), answer("Two."), answer("More."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    let records = EMPTY_SKILL_TESTS;
    vault.host.skillTests = {
      load: async () => records,
      save: async (next) => void (records = next),
    };
    expect(await s.testSkills(["plainva:task-triage"], { maxCostUsd: null })).toMatchObject({ kind: "done", ran: 1 });
    const last = records.records.find((record) => record.id === "plainva:task-triage")?.scenarios[0]?.conversationId;
    // The user went on with the scenario's conversation (strand 6, step 9).
    await s.open(last!);
    expect(await s.send("Tell me more.")).toMatchObject({ kind: "answered" });
    s.newConversation();
    expect(await s.testSkills(["plainva:task-triage"], { maxCostUsd: null })).toMatchObject({ kind: "done", ran: 1 });
    expect([vault.saved.has(last!), s.getState().summaries.some((summary) => summary.id === last)]).toEqual([true, true]);
  });

  it("keeps a scenario's conversation that is on screen when the regression run comes again", async () => {
    const { s } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    let records = EMPTY_SKILL_TESTS;
    vault.host.skillTests = {
      load: async () => records,
      save: async (next) => void (records = next),
    };
    expect(await s.testSkills(["plainva:task-triage"], { maxCostUsd: null })).toMatchObject({ kind: "done", ran: 1 });
    const last = records.records.find((record) => record.id === "plainva:task-triage")?.scenarios[0]?.conversationId;
    // On screen when the run comes again: in use, not the app's to delete (step 9).
    await s.open(last!);
    expect(await s.testSkills(["plainva:task-triage"], { maxCostUsd: null })).toMatchObject({ kind: "done", ran: 1 });
    expect([vault.saved.has(last!), s.getState().active?.id]).toEqual([true, last]);
  });

  it("drops a scenario's last conversation whose run itself sent a note redacted", async () => {
    const { s } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    let records = EMPTY_SKILL_TESTS;
    vault.host.skillTests = {
      load: async () => records,
      save: async (next) => void (records = next),
    };
    expect(await s.testSkills(["plainva:task-triage"], { maxCostUsd: null })).toMatchObject({ kind: "done", ran: 1 });
    const last = records.records.find((record) => record.id === "plainva:task-triage")?.scenarios[0]?.conversationId;
    // As where the run's own overview redacted a note: the conversation and its run carry the same (step 9).
    const stored = vault.saved.get(last!)!;
    vault.saved.set(last!, { ...stored, redact: ["Plan.md"], runs: stored.runs.map((run) => ({ ...run, redact: ["Plan.md"] })) });
    expect(await s.testSkills(["plainva:task-triage"], { maxCostUsd: null })).toMatchObject({ kind: "done", ran: 1 });
    expect(vault.saved.has(last!)).toBe(false);
  });

  it("keeps a cancelled scenario's conversation the user renamed while it ran", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const hold = held(fake);
    const testing = s.testSkills(["plainva:task-triage"], { maxCostUsd: null });
    await hold.waiting;
    // The scenario's conversation is on screen while it runs: the user names it, then stops the run (step 9).
    const scenario = s.getState().active!.id;
    await s.rename(scenario, "Mine");
    s.stop();
    hold.release();
    await testing;
    expect(vault.saved.get(scenario)?.title).toBe("Mine");
  });

  it("asks nothing again of a conversation deleted from the history while the replay's request is put together", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    const hold = heldSituation(vault);
    const replay = s.replay(id, 0, { providerId: "anthropic", model: "m-1" });
    await hold.waiting;
    // The replay has the screen by now: the original, deleted from the history, is no step on it.
    expect(s.getState().active).toBeNull();
    await s.remove(id);
    hold.release();
    expect(await replay).toBeNull();
    expect([fake.sent.length, vault.saved.size]).toEqual([1, 0]);
  });

  it("asks nothing again of, and learns nothing from, a conversation whose deletion was asked for", async () => {
    const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    const deletion = heldDeletion(vault);
    const removing = s.remove(id);
    await deletion.waiting;
    let reads = 0;
    const readNote = vault.host.readNote.bind(vault.host);
    vault.host.readNote = async (path) => {
      reads += 1;
      return readNote(path);
    };
    expect(await s.replay(id, 0, { providerId: "anthropic", model: "m-1" })).toBeNull();
    expect(await s.learnFrom(id)).toMatchObject({ kind: "refused", reason: "gone" });
    // Refused at once: the screen stays as it is, and nothing the conversation rests on is read for it.
    expect([s.getState().active?.id, reads]).toEqual([id, 0]);
    deletion.release();
    await removing;
    expect(fake.sent.length).toBe(1);
  });

  it("keeps the screen on a run that began after another conversation was clicked", async () => {
    const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    const b = s.getState().active!.id;
    await s.open(a);
    const slow = slowRead(vault);
    const opening = s.open(b);
    await slow.reading;
    // Still on the first: a message goes, and its answer is on its way when the second's reading comes back.
    const hold = held(fake);
    const run = s.send("Still here");
    await hold.waiting;
    slow.reply();
    await opening;
    expect(s.getState().active?.id).toBe(a);
    hold.release();
    await run;
    expect(s.getState().active?.id).toBe(a);
  });

  it("deletes a conversation only once a write of it on its way has landed", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    const hold = heldWrite(vault);
    const pinning = s.pin("Offer.md");
    await hold.waiting;
    const removing = s.remove(id);
    // Whatever does not wait for the pin's write has happened by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    hold.release();
    await Promise.all([pinning, removing]);
    expect(vault.saved.has(id)).toBe(false);
  });

  it("leaves another vault's history alone when a Delete all of the vault before ends", async () => {
    const { s } = session([answer("One."), answer("Two.")]);
    await s.load();
    const first = vaultHost("Plan.md");
    await s.attachVault(first.host);
    await s.send("First");
    const hold = heldClearing(first);
    const clearing = s.removeAll();
    await hold.begun;
    // Another vault, with a conversation of its own.
    const second = vaultHost("Plan.md");
    await s.attachVault(second.host);
    await s.send("Second");
    const listed = s.getState().summaries.map((summary) => summary.id);
    expect(listed).toHaveLength(1);
    hold.release();
    await clearing;
    expect(s.getState().summaries.map((summary) => summary.id)).toEqual(listed);
  });

  it("keeps a notice about anything Delete all did not take", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const hold = heldClearing(vault);
    const clearing = s.removeAll();
    await hold.begun;
    // While the history is cleared: a new conversation's message under Fully local, to a model that is not on this device.
    s.newConversation();
    await s.updateSettings((settings) => ({ ...settings, localOnly: true }));
    await s.send("Meanwhile");
    const notice = s.getState().notice;
    expect(notice).not.toBeNull();
    hold.release();
    await clearing;
    expect(s.getState().notice).toEqual(notice);
  });

  it("lists on attaching a vault what a deletion on its way leaves, and nothing a Delete all on its way takes", async () => {
    const { s } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    // A deletion on its way, and the vault attached again: its list waits for it — and lists the conversation where it failed.
    const remove = vault.host.conversations.remove.bind(vault.host.conversations);
    for (const fails of [true, false]) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let reached!: () => void;
      const waiting = new Promise<void>((resolve) => (reached = resolve));
      vault.host.conversations.remove = async (id) => {
        reached();
        await gate;
        if (fails) throw new Error("locked");
        return remove(id);
      };
      const removing = s.remove(a).then(() => "done", () => "failed");
      await waiting;
      const attaching = s.attachVault(vault.host);
      await new Promise((resolve) => setTimeout(resolve, 0));
      release();
      await Promise.all([removing, attaching]);
      expect(s.getState().summaries.some((summary) => summary.id === a), fails ? "failed" : "done").toBe(fails);
    }
    vault.host.conversations.remove = remove;
    s.newConversation();
    await s.send("Second");
    s.newConversation();
    // A Delete all on its way, and the vault attached again: its list is read once the clearing is through.
    const hold = heldClearing(vault);
    const clearing = s.removeAll();
    await hold.begun;
    const list = vault.host.conversations.list.bind(vault.host.conversations);
    let listed!: () => void;
    const answered = new Promise<void>((resolve) => (listed = resolve));
    vault.host.conversations.list = async () => {
      const rows = await list();
      await answered;
      return rows;
    };
    const attaching = s.attachVault(vault.host);
    hold.release();
    await clearing;
    listed();
    await attaching;
    expect(s.getState().summaries).toEqual([]);
  });

  it("expires no conversation that is being written", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    await s.updateSettings((settings) => ({ ...settings, historyDays: 30 }));
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    // Last changed long ago, as the store says — and a pin of it on its way when the vault is attached again.
    vault.saved.set(id, { ...vault.saved.get(id)!, updatedAt: "2020-01-01T00:00:00.000Z" });
    const hold = heldWrite(vault);
    const pinning = s.pin("Offer.md");
    await hold.waiting;
    const attaching = s.attachVault(vault.host);
    await new Promise((resolve) => setTimeout(resolve, 0));
    hold.release();
    await Promise.all([pinning, attaching]);
    expect(vault.saved.get(id)?.pins).toEqual(["Offer.md"]);
  });

  it("gives a conversation begun under Fully local the model it ran on, not one the device may not ask", async () => {
    const { s } = session([platformAnswer("One.")]);
    await s.load();
    await s.updateSettings((settings) => ({ ...settings, localOnly: true, profiles: { ...settings.profiles, balanced: { providerId: "apple", model: "on-device" } } }));
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    // A cloud model chosen in the composer: Fully local leaves it resting.
    await s.setChoice({ providerId: "anthropic", model: "m-2" });
    expect(await s.send("Hello")).toEqual({ kind: "answered" });
    const active = s.getState().active!;
    expect([active.providerId, active.model, active.runs[0]!.providerId]).toEqual(["apple", "on-device", "apple"]);
  });

  it("opens again after a regression run whose scenario failed the conversation that was open", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    // The scenario's request gets no answer.
    const outcome = await s.testSkills(["plainva:task-triage"], { maxCostUsd: null });
    expect(outcome).toMatchObject({ kind: "done", stopped: "failed" });
    expect(s.getState().active?.id).toBe(id);
  });

  it("takes no message while a regression run brings back the conversation that was open", async () => {
    const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    const hold = held(fake);
    const testing = s.testSkills(["plainva:task-triage"], { maxCostUsd: null });
    await hold.waiting;
    // The conversation is read back slowly; meanwhile a message is typed.
    const slow = slowRead(vault);
    hold.release();
    await slow.reading;
    expect(await s.send("Now")).toBeNull();
    slow.reply();
    await testing;
    expect([fake.sent.length, s.getState().active?.id]).toEqual([2, id]);
  });

  it("expires no conversation whose run is on its way", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    await s.updateSettings((settings) => ({ ...settings, historyDays: 30 }));
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    // Last changed long ago, as the store says — and a run of it on its way when the vault is attached again.
    vault.saved.set(id, { ...vault.saved.get(id)!, updatedAt: "2020-01-01T00:00:00.000Z" });
    const hold = held(fake);
    const run = s.send("Second");
    await hold.waiting;
    const attaching = s.attachVault(vault.host);
    await new Promise((resolve) => setTimeout(resolve, 0));
    hold.release();
    await Promise.all([run, attaching]);
    expect(vault.saved.get(id)?.runs.length).toBe(2);
  });

  it("expires no conversation the user opened while the vault was being attached", async () => {
    const { s } = session([answer("One."), answer("Two.")]);
    await s.load();
    await s.updateSettings((settings) => ({ ...settings, historyDays: 30 }));
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    const b = s.getState().active!.id;
    // Both last changed long ago; the first one's deletion held while the second is opened.
    for (const id of [a, b]) vault.saved.set(id, { ...vault.saved.get(id)!, updatedAt: "2020-01-01T00:00:00.000Z" });
    const deletion = heldDeletion(vault);
    const attaching = s.attachVault(vault.host);
    await deletion.waiting;
    await s.open(b);
    deletion.release();
    await attaching;
    expect([vault.saved.has(a), vault.saved.has(b), s.getState().active?.id]).toEqual([false, true, b]);
    // The one it expired is not listed either.
    expect(s.getState().summaries.some((summary) => summary.id === a)).toBe(false);
  });

  it("lists again on attaching a vault where a Delete all came while it listed and expired", async () => {
    const { s } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    await s.updateSettings((settings) => ({ ...settings, historyDays: 30 }));
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const old = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    const older = s.getState().active!.id;
    s.newConversation();
    await s.send("Third");
    s.newConversation();
    // The first two expired; the first one's deletion held while Delete all is asked for, the second's behind it.
    for (const id of [old, older]) vault.saved.set(id, { ...vault.saved.get(id)!, updatedAt: "2020-01-01T00:00:00.000Z" });
    const deletion = heldDeletion(vault);
    const attaching = s.attachVault(vault.host);
    await deletion.waiting;
    const clearing = s.removeAll();
    deletion.release();
    await Promise.all([clearing, attaching]);
    expect([s.getState().summaries, vault.saved.size]).toEqual([[], 0]);
  });

  it("clears with Delete all a notice about a conversation it took", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    // The next request gets no answer: a notice on the conversation.
    await s.send("Second");
    expect(s.getState().notice?.conversationId).toBe(id);
    await s.removeAll();
    expect(s.getState().notice).toBeNull();
  });

  it("asks nothing again of a conversation deleted while the replay was put together", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    // The run's notes read slowly for its snapshot; meanwhile the conversation is deleted.
    const readNote = vault.host.readNote.bind(vault.host);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const reading = new Promise<void>((resolve) => (reached = resolve));
    let first = true;
    vault.host.readNote = async (path) => {
      if (first) {
        first = false;
        reached();
        await gate;
      }
      return readNote(path);
    };
    const replay = s.replay(id, 0, { providerId: "anthropic", model: "m-1" });
    await reading;
    await s.remove(id);
    release();
    expect(await replay).toBeNull();
    expect([fake.sent.length, vault.saved.size]).toEqual([1, 0]);
  });

  it("asks nothing again of a conversation when Delete all came while the replay was put together", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const id = s.getState().active!.id;
    s.newConversation();
    const readNote = vault.host.readNote.bind(vault.host);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const reading = new Promise<void>((resolve) => (reached = resolve));
    let first = true;
    vault.host.readNote = async (path) => {
      if (first) {
        first = false;
        reached();
        await gate;
      }
      return readNote(path);
    };
    s.setExcludeActive(true);
    const replay = s.replay(id, 0, { providerId: "anthropic", model: "m-1" });
    await reading;
    await s.removeAll();
    release();
    expect(await replay).toBeNull();
    // Nothing of it reached the screen either: what the user set there stays.
    expect([fake.sent.length, vault.saved.size, s.getState().summaries, s.getState().excludeActive]).toEqual([1, 0, [], true]);
  });

  it("asks again of a conversation as it is now, also while a write of it is on its way", async () => {
    const { s } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    // The first renamed from the history, its write held; then asked again of a model.
    const hold = heldWrite(vault);
    const renaming = s.rename(a, "New");
    await hold.waiting;
    const replay = s.replay(a, 0, { providerId: "anthropic", model: "m-1" });
    hold.release();
    await Promise.all([renaming, replay]);
    expect(s.getState().active?.title).toContain("New");
  });

  it("opens nothing after a run began and ended since the click", async () => {
    const { s } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    const b = s.getState().active!.id;
    await s.open(a);
    const slow = slowRead(vault);
    const opening = s.open(b);
    await slow.reading;
    // Still on the first: a message goes, and its answer comes, before the second's reading is back.
    expect(await s.send("Still here")).toEqual({ kind: "answered" });
    slow.reply();
    await opening;
    expect([s.getState().active?.id, s.getState().active?.runs.length]).toEqual([a, 2]);
  });

  it("keeps a regression run's conversation in the history where it cannot be deleted", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    // The scenario gets no answer, and its conversation cannot be deleted.
    vault.host.conversations.remove = async () => {
      throw new Error("locked");
    };
    const before = new Set(vault.saved.keys());
    await s.testSkills(["plainva:task-triage"], { maxCostUsd: null });
    const scenario = [...vault.saved.keys()].find((id) => !before.has(id))!;
    expect([Boolean(scenario), s.getState().summaries.some((summary) => summary.id === scenario)]).toEqual([true, true]);
  });

  it("deletes a regression run's cancelled scenario in its own vault after a switch", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const before = new Set(vault.saved.keys());
    const hold = held(fake);
    const testing = s.testSkills(["plainva:task-triage"], { maxCostUsd: null });
    await hold.waiting;
    await s.attachVault(vaultHost("Plan.md").host);
    hold.release();
    await testing;
    expect([...vault.saved.keys()].filter((id) => !before.has(id))).toEqual([]);
  });

  it("passes the moment each action began to every run it starts, taken before its first await", () => {
    // Each run but a message of the composer and a preview starts after awaits of its own: a Delete all asked for
    // since the action began must reach it (step 8). Read as TypeScript reads it: no string, comment or pattern hides
    // a call or an await.
    const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../../../packages/ui/src/ai/aiSession.ts");
    const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    /** A function written here runs later: what it awaits, the code around it does not. */
    const later = (node: ts.Node) => ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);
    /** Whether `node` is or holds a call of the session's own method `name`. */
    const calls = (node: ts.Node, name: string): boolean =>
      (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword && node.expression.name.text === name) ||
      node.getChildren(file).some((child) => calls(child, name));
    const runs: ts.CallExpression[] = [];
    const takers: { method: string; awaits: number }[] = [];
    let removes = 0;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
        if (node.expression.name.text === "runMessage") runs.push(node);
        if (node.expression.name.text === "remove") removes += 1;
      }
      if (ts.isMethodDeclaration(node) && node.body) {
        const body = node.body;
        // Where a method takes the count — `since`, from `clearsOf` —, the awaits of its own before.
        const look = (inner: ts.Node) => {
          if (ts.isVariableDeclaration(inner) && ts.isIdentifier(inner.name) && inner.name.text === "since" && inner.initializer && calls(inner.initializer, "clearsOf")) {
            const at = inner.getStart(file);
            let awaits = 0;
            const before = (step: ts.Node) => {
              if (step.getStart(file) >= at || later(step)) return;
              if (ts.isAwaitExpression(step)) awaits += 1;
              ts.forEachChild(step, before);
            };
            ts.forEachChild(body, before);
            takers.push({ method: node.name.getText(file), awaits });
          }
          if (!later(inner)) ts.forEachChild(inner, look);
        };
        ts.forEachChild(body, look);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    /** Whether `node` is or holds the property `name: true`. */
    const holdsTrue = (node: ts.Node, name: string): boolean =>
      (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer.kind === ts.SyntaxKind.TrueKeyword) ||
      node.getChildren(file).some((child) => holdsTrue(child, name));
    // What a run gets is the count its action took, `since` — never one counted where the call is made.
    const kinds = runs.map((run) => {
      if (run.arguments.map((arg) => arg.getText(file)).join(", ") === "message, vault, choice") return "message";
      const options = run.arguments[3];
      if (!options || !ts.isObjectLiteralExpression(options)) return "missing";
      if (holdsTrue(options, "preview")) return "preview";
      const since = options.properties.find((property) => property.name !== undefined && ts.isIdentifier(property.name) && property.name.text === "since");
      const taken = since && (ts.isShorthandPropertyAssignment(since) || (ts.isPropertyAssignment(since) && ts.isIdentifier(since.initializer) && since.initializer.text === "since"));
      return taken ? "since" : "missing";
    });
    expect(kinds.filter((kind) => kind === "missing")).toEqual([]);
    expect(kinds.filter((kind) => kind === "since").length).toBeGreaterThanOrEqual(7);
    // Where an action takes it, nothing of the action is awaited before.
    expect(takers.length).toBeGreaterThanOrEqual(7);
    expect(takers.filter((taker) => taker.awaits > 0)).toEqual([]);
    // The app's own deletions go through the path that keeps to their vault, never through the user's `remove`.
    expect(removes).toBe(0);
  });

  it("keeps a choice on screen through every step of the run", async () => {
    const { s, fake } = session([callsTool("read_note", { path: "Plan.md" }), answer("Done.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    withTools(vault.host);
    await s.attachVault(vault.host);
    // Each request held until the test lets it go.
    const send = fake.egress.send.bind(fake.egress);
    const gates: (() => void)[] = [];
    const reached: (() => void)[] = [];
    const waits = [0, 1].map((n) => new Promise<void>((resolve) => (reached[n] = resolve)));
    let count = 0;
    fake.egress.send = async (id, spec, onChunk) => {
      const n = count++;
      reached[n]?.();
      await new Promise<void>((resolve) => (gates[n] = resolve));
      return send(id, spec, onChunk);
    };
    const run = s.send("Hello");
    await waits[0];
    await s.pin("Offer.md");
    gates[0]!();
    // The first step — a tool call — is through and the second request on its way: the pin is still on screen.
    await waits[1];
    expect(s.getState().active?.pins).toEqual(["Offer.md"]);
    gates[1]!();
    await run;
    expect(s.getState().active?.pins).toEqual(["Offer.md"]);
  });

  it("expires no conversation whose run ended while the vault was being attached through a new host", async () => {
    const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    await s.updateSettings((settings) => ({ ...settings, historyDays: 30 }));
    const vault = vaultHost("Plan.md");
    vault.host.key = "vault-1";
    await s.attachVault(vault.host);
    await s.send("First");
    const x = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    const c = s.getState().active!.id;
    // Both last changed long ago, as the store says; the first listed first.
    for (const id of [x, c]) vault.saved.set(id, { ...vault.saved.get(id)!, updatedAt: "2020-01-01T00:00:00.000Z" });
    // A run of the second on its way when the shell hands a new host for the vault; the first one's expiry slow.
    const hold = held(fake);
    const run = s.send("Third");
    await hold.waiting;
    const deletion = heldDeletion(vault);
    const attaching = s.attachVault({ ...vault.host });
    await deletion.waiting;
    // The run ends — its conversation written now — before the expiry comes to it.
    hold.release();
    await run;
    deletion.release();
    await attaching;
    expect([vault.saved.has(x), vault.saved.get(c)?.runs.length]).toEqual([false, 2]);
  });

  it("expires no conversation whose write began before the vault was listed and landed before its expiry", async () => {
    const { s } = session([answer("One."), answer("Two.")]);
    await s.load();
    await s.updateSettings((settings) => ({ ...settings, historyDays: 30 }));
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const x = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    const c = s.getState().active!.id;
    for (const id of [x, c]) vault.saved.set(id, { ...vault.saved.get(id)!, updatedAt: "2020-01-01T00:00:00.000Z" });
    // A pin of the second on its way when the vault is attached again; the first one's expiry slow.
    const write = heldWrite(vault);
    const pinning = s.pin("Offer.md");
    await write.waiting;
    const deletion = heldDeletion(vault);
    const attaching = s.attachVault(vault.host);
    await deletion.waiting;
    // The pin lands before the expiry comes to the second.
    write.release();
    await pinning;
    deletion.release();
    await attaching;
    expect([vault.saved.has(x), vault.saved.get(c)?.pins]).toEqual([false, ["Offer.md"]]);
  });

  it("expires no conversation the user changed while the vault was being attached", async () => {
    const { s } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    await s.updateSettings((settings) => ({ ...settings, historyDays: 30 }));
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const x = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    const c = s.getState().active!.id;
    s.newConversation();
    await s.send("Third");
    const d = s.getState().active!.id;
    for (const id of [x, c]) vault.saved.set(id, { ...vault.saved.get(id)!, updatedAt: "2020-01-01T00:00:00.000Z" });
    // The first one's expiry slow; meanwhile the second is opened, pinned, and left for another.
    const deletion = heldDeletion(vault);
    const attaching = s.attachVault(vault.host);
    await deletion.waiting;
    await s.open(c);
    await s.pin("Offer.md");
    await s.open(d);
    deletion.release();
    await attaching;
    expect([vault.saved.has(x), vault.saved.get(c)?.pins]).toEqual([false, ["Offer.md"]]);
  });

  it("leaves a history the user cleared meanwhile cleared", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const hold = held(fake);
    const run = s.send("Second");
    await hold.waiting;
    const clearing = s.removeAll();
    hold.release();
    await Promise.all([run, clearing]);
    expect(vault.saved.size).toBe(0);
    expect([s.getState().active, s.getState().live, s.getState().summaries]).toEqual([null, null, []]);
    expect(vault.ledger()).toHaveLength(2);
  });

  it("lists the end of a run that a new host for the same vault stopped, and puts it on no screen (strand 6, step 10)", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    vault.host.key = "vault-1";
    await s.attachVault(vault.host);
    // A run that begins a conversation on its way when the shell hands a new host for the vault — the index rebuilt.
    const hold = held(fake);
    const run = s.send("First");
    await hold.waiting;
    const n = s.getState().active!.id;
    await s.attachVault({ ...vault.host });
    hold.release();
    await run;
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A new host is an attaching: the run stopped, and the screen begins anew — what the run wrote is listed.
    expect([s.getState().active, vault.saved.has(n), s.getState().summaries.some((summary) => summary.id === n)]).toEqual([null, true, true]);
  });

  it("lists the end of a stopped run also where it comes while the new host's attaching lists (strand 6, step 10)", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    vault.host.key = "vault-1";
    await s.attachVault(vault.host);
    const hold = held(fake);
    const run = s.send("First");
    await hold.waiting;
    const n = s.getState().active!.id;
    // The new host's list is read before the run's end is written, and handed back only after.
    const list = vault.host.conversations.list.bind(vault.host.conversations);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const read = new Promise<void>((resolve) => (reached = resolve));
    let first = true;
    vault.host.conversations.list = async () => {
      const rows = await list();
      if (first) {
        first = false;
        reached();
        await gate;
      }
      return rows;
    };
    const attaching = s.attachVault({ ...vault.host });
    await read;
    hold.release();
    await run;
    release();
    await attaching;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.getState().summaries.some((summary) => summary.id === n)).toBe(true);
  });

  it("lists nothing of a run that another vault's attaching stopped (strand 6, step 10)", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    vault.host.key = "vault-1";
    await s.attachVault(vault.host);
    const hold = held(fake);
    const run = s.send("First");
    await hold.waiting;
    const n = s.getState().active!.id;
    const other = vaultHost("Plan.md");
    other.host.key = "vault-2";
    await s.attachVault(other.host);
    hold.release();
    await run;
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The run is its own vault's: written there, listed nowhere else.
    expect([vault.saved.has(n), s.getState().summaries.some((summary) => summary.id === n)]).toEqual([true, false]);
  });

  it("shows a conversation whose run a new host stopped with that run's end once it comes, and the next message keeps its turns (strand 6, step 10)", async () => {
    const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    vault.host.key = "vault-1";
    await s.attachVault(vault.host);
    await s.send("First");
    const c = s.getState().active!.id;
    // Its next run on its way when the shell hands a new host; the user opens the conversation again before the
    // stopped run's end is written.
    const hold = held(fake);
    const run = s.send("Second");
    await hold.waiting;
    await s.attachVault({ ...vault.host });
    const opening = s.open(c);
    // A full turn first: the conversation is read, and shown, before the stopped run's end is written.
    await new Promise((resolve) => setTimeout(resolve, 0));
    hold.release();
    await Promise.all([run, opening]);
    expect(JSON.stringify(s.getState().active?.conversation.turns)).toContain("Second");
    await s.send("Third");
    expect(JSON.stringify(vault.saved.get(c)?.conversation.turns)).toContain("Second");
  });

  it("lists nothing of a stopped run in a vault attached while its end is read for the history (strand 6, step 10)", async () => {
    const { s, fake } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    vault.host.key = "vault-1";
    await s.attachVault(vault.host);
    const hold = held(fake);
    const run = s.send("First");
    await hold.waiting;
    const n = s.getState().active!.id;
    await s.attachVault({ ...vault.host });
    // The stopped run's end, read for the history through the new host, is held there while another vault is attached.
    const read = slowRead(vault);
    hold.release();
    await run;
    await read.reading;
    const other = vaultHost("Plan.md");
    other.host.key = "vault-2";
    await s.attachVault(other.host);
    read.reply();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.getState().summaries.some((summary) => summary.id === n)).toBe(false);
  });

  it("lists no stopped run's end that a Delete all cleared while it was read for the history (strand 6, step 10)", async () => {
    const { s, fake } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    vault.host.key = "vault-1";
    await s.attachVault(vault.host);
    const hold = held(fake);
    const run = s.send("First");
    await hold.waiting;
    const n = s.getState().active!.id;
    await s.attachVault({ ...vault.host });
    const read = slowRead(vault);
    hold.release();
    await run;
    await read.reading;
    // Read before it, handed back after: the conversation the reading found is gone.
    await s.removeAll();
    read.reply();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect([vault.saved.has(n), s.getState().summaries.some((summary) => summary.id === n)]).toEqual([false, false]);
  });

  it("opens a conversation again however a run of it broke: no reading waits on a run that is over (strand 6, step 10)", async () => {
    const { s } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const c = s.getState().active!.id;
    // A shell's listener that breaks as the next run puts itself on screen: that run ends before its end is decided.
    let broke = false;
    const off = s.subscribe(() => {
      if (!broke && s.getState().live) {
        broke = true;
        throw new Error("listener broke");
      }
    });
    expect(await s.send("Second")).toMatchObject({ kind: "failed" });
    off();
    s.newConversation();
    await s.open(c);
    expect(s.getState().active?.id).toBe(c);
  });

  it("keeps a stopped run's turns however its end and an opening interleave: an opening reads again what was written since (strand 6, step 10)", async () => {
    for (let turns = 0; turns <= 40; turns++) {
      const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")]);
      await s.load();
      const vault = vaultHost("Plan.md");
      vault.host.key = "vault-1";
      await s.attachVault(vault.host);
      await s.send("First");
      const c = s.getState().active!.id;
      const hold = held(fake);
      const run = s.send("Second");
      await hold.waiting;
      await s.attachVault({ ...vault.host });
      // The opening's reading is held; the stopped run ends, and the reading comes back a few turns later or sooner.
      const read = slowRead(vault);
      const opening = s.open(c);
      await read.reading;
      hold.release();
      for (let turn = 0; turn < turns; turn++) await Promise.resolve();
      read.reply();
      await Promise.all([run, opening]);
      await s.send("Third");
      expect(JSON.stringify(vault.saved.get(c)?.conversation.turns), `${turns} turns`).toContain("Second");
    }
  });

  it("lists no conversation an earlier attaching deleted, also where the shell made a new host meanwhile", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    await s.updateSettings((settings) => ({ ...settings, historyDays: 30 }));
    const vault = vaultHost("Plan.md");
    vault.host.key = "vault-1";
    await s.attachVault(vault.host);
    await s.send("First");
    const x = s.getState().active!.id;
    s.newConversation();
    vault.saved.set(x, { ...vault.saved.get(x)!, updatedAt: "2020-01-01T00:00:00.000Z" });
    // The vault attached again, its expiry slow; meanwhile the shell hands a new host, which lists the conversation
    // whose deletion is on its way.
    const deletion = heldDeletion(vault);
    const first = s.attachVault(vault.host);
    await deletion.waiting;
    await s.attachVault({ ...vault.host });
    expect(s.getState().summaries.map((summary) => summary.id)).toEqual([x]);
    deletion.release();
    await first;
    expect([vault.saved.has(x), s.getState().summaries]).toEqual([false, []]);
  });

  it("keeps listed on attaching a conversation whose deletion was on its way and then failed", async () => {
    const { s } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const x = s.getState().active!.id;
    s.newConversation();
    // Its deletion on its way while the vault is attached again — and then it fails.
    let fail!: () => void;
    const gate = new Promise<void>((resolve) => (fail = resolve));
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => (reached = resolve));
    vault.host.conversations.remove = async () => {
      reached();
      await gate;
      throw new Error("locked");
    };
    const removing = s.remove(x).catch(() => undefined);
    await waiting;
    await s.attachVault(vault.host);
    fail();
    await removing;
    expect([vault.saved.has(x), s.getState().summaries.map((summary) => summary.id)]).toEqual([true, [x]]);
  });

  it("starts nothing of a skill where the whole history was deleted while it was looked up", async () => {
    const { s, fake } = session([answer("One.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    // The vault's instructions are read slowly; meanwhile the whole history is deleted.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const scanning = new Promise<void>((resolve) => (reached = resolve));
    vault.host.instructions = {
      async scan() {
        reached();
        await gate;
        return [];
      },
      scanOne: async () => null,
      readFile: async () => null,
      approvals: { load: async () => EMPTY_INSTRUCTION_APPROVALS, save: async () => undefined },
    };
    s.setExcludeActive(true);
    const starting = s.runSkill("plainva:writing", "Summarise it.");
    await scanning;
    await s.removeAll();
    release();
    expect(await starting).toBeNull();
    // Nothing of it reached the screen either: what the user set there stays.
    expect([fake.sent.length, s.getState().excludeActive]).toEqual([0, true]);
  });

  it("starts nothing again where the user left the screen while the replay was put together", async () => {
    const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    await s.send("Second");
    const b = s.getState().active!.id;
    await s.open(a);
    // The notes its run read are looked at slowly; meanwhile the second conversation is opened.
    const readNote = vault.host.readNote.bind(vault.host);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const reading = new Promise<void>((resolve) => (reached = resolve));
    let first = true;
    vault.host.readNote = async (path) => {
      if (first) {
        first = false;
        reached();
        await gate;
      }
      return readNote(path);
    };
    const replay = s.replay(a, 0, { providerId: "anthropic", model: "m-1" });
    await reading;
    await s.open(b);
    release();
    expect(await replay).toBeNull();
    expect([fake.sent.length, s.getState().active?.id]).toEqual([2, b]);
  });

  it("takes no message while a replay reads its conversation", async () => {
    const { s, fake } = session([answer("One."), answer("Two."), answer("Three.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    const a = s.getState().active!.id;
    s.newConversation();
    const slow = slowRead(vault);
    const replay = s.replay(a, 0, { providerId: "anthropic", model: "m-1" });
    await slow.reading;
    expect(await s.send("Now")).toBeNull();
    slow.reply();
    await replay;
    expect(fake.sent).toHaveLength(2);
  });

  it("runs no scenario of a regression run where Delete all came while it was put together", async () => {
    const { s, fake } = session([answer("One."), answer("Two.")]);
    await s.load();
    const vault = vaultHost("Plan.md");
    await s.attachVault(vault.host);
    await s.send("First");
    // The vault's instructions are read slowly; meanwhile the whole history is deleted.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const scanning = new Promise<void>((resolve) => (reached = resolve));
    vault.host.instructions = {
      async scan() {
        reached();
        await gate;
        return [];
      },
      scanOne: async () => null,
      readFile: async () => null,
      approvals: { load: async () => EMPTY_INSTRUCTION_APPROVALS, save: async () => undefined },
    };
    const testing = s.testSkills(["plainva:task-triage"], { maxCostUsd: null });
    await scanning;
    await s.removeAll();
    release();
    await testing;
    expect([fake.sent.length, vault.saved.size]).toEqual([1, 0]);
  });
});
