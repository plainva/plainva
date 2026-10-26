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

  function proposing(active: string | null = "Contract.md") {
    const vault = vaultHost(active);
    const rounds: Round[] = [];
    vault.host.propose = async (round) => {
      rounds.push(round);
    };
    return { vault, rounds };
  }

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
