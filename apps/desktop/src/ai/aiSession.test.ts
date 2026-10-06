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

function session(script: EgressChunk[][], options: { approve?: boolean } = {}) {
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
