import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_AI_APP_SETTINGS,
  effectivePolicy,
  notePolicyFrom,
  parsePolicyFile,
  readConversationRecord,
  type AiEgress,
  type ConversationRecord,
  type EgressChunk,
  type EgressManifest,
  type HttpRequestSpec,
  type LedgerEntry,
} from "@plainva/core";
import {
  AiSession,
  CHAT_TOOL_NAMES,
  FILL_INSTRUCTION,
  FILL_LIMITS,
  FILTER_INSTRUCTION,
  captureVocabularyOf,
  createVaultToolExecutor,
  furtherToolNames,
  noteMovePlan,
  noteRenamePlan,
  type AiVaultHost,
  type FillColumn,
  type FilterSchemaColumn,
  type ProposalRound,
  type VaultToolDeps,
  type VaultWriteDeps,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * A column filled with proposed values, and a filter from a sentence, in the
 * session (plan KI-Harness P5-4): each note goes in a request of its own with
 * nothing of another; what a model answers is laid on the note through the
 * tool every proposed value takes; the run asks once; a filter in words sends
 * the database's columns and nothing of its entries.
 */

/** One Anthropic answer in text. */
function turn(text: string): EgressChunk[] {
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: { usage: { input_tokens: 40 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return [{ type: "open", status: 200 }, { type: "data", text: events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") }, { type: "done" }];
}
const value = (v: unknown) => turn(JSON.stringify({ value: v }));

function fakeEgress(script: EgressChunk[][]) {
  const sent: HttpRequestSpec[] = [];
  const egress: AiEgress = {
    async send(_id, spec, onChunk) {
      sent.push(spec);
      for (const chunk of script.shift() ?? [{ type: "failed", code: "network", message: "offline" }]) onChunk(chunk);
    },
    async cancel() {},
    async setKey() {},
    hasKey: async () => true,
    async deleteKey() {},
    addEndpoint: async () => true,
    async removeEndpoint() {},
  };
  return { egress, sent };
}

const NOTES: Record<string, string> = {
  "Clients/Acme.md": "---\ncompany: Acme\n---\n# Acme\n\nAcme builds machines for bakeries. More at https://acme.example.\n",
  "Clients/Bolt.md": "---\ncompany: Bolt\n---\n# Bolt\n\nBolt is a law firm.\n",
  "Clients/Core.md": "---\ncompany: Core\n---\n# Core\n\nNothing about what they do.\n",
  // Kept from the cloud by its folder's rule.
  "Private/Dora.md": "---\ncompany: Dora\n---\n# Dora\n\nDora sells insurance.\n",
  // Kept from the internet by its folder's rule: a cloud model without the internet may read it.
  "Offline/Echo.md": "---\ncompany: Echo\n---\n# Echo\n\nEcho is a bakery.\n",
  // Names a note that is kept from the internet.
  "Clients/Fox.md": "---\ncompany: Fox\n---\n# Fox\n\nFox bakes with [[Echo]].\n",
  "Clients/Clients.base": "views:\n  - type: table\n    name: All\n",
  "Private/Secret.base": "views:\n  - type: table\n    name: All\n",
};
const rules = parsePolicyFile("folders:\n  Private/:\n    cloud: deny\n  Offline/:\n    web: deny\n").rules;
const BASE = "Clients/Clients.base";
const row = (name: string, folder = "Clients") => ({ path: `${folder}/${name}.md`, title: name });
const branche: FillColumn = { key: "branche", label: "Branche", input: "text" };

function fillVault(options: { sealed?: boolean; onPropose?: (round: ProposalRound) => void } = {}) {
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  const proposed: ProposalRound[] = [];
  const exists = async (path: string) => NOTES[path] !== undefined;
  const policyOf = async (path: string) => effectivePolicy(path, notePolicyFrom({}), rules);
  const title = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  const note = (path: string) => (NOTES[path] === undefined ? null : { path, title: title(path), text: NOTES[path]! });
  const writes: VaultWriteDeps = {
    sealed: () => options.sealed === true,
    current: async (path) => NOTES[path] ?? null,
    propose: async (round) => {
      proposed.push(round);
      options.onPropose?.(round);
    },
    folderExists: async () => true,
    taskVocabulary: () => captureVocabularyOf((key) => i18n.t(key), "en"),
    draftPlace: async () => null,
    renamePlan: (path, name) => noteRenamePlan({ getBacklinks: async () => [] as never }, exists, path, name),
    rename: async () => null,
    movePlan: (path, folder) => noteMovePlan(exists, path, folder),
    move: async () => null,
    requestDelete: async () => false,
    setRule: async () => false,
    entryPlace: async () => null,
  };
  const deps: VaultToolDeps = {
    search: async () => [],
    readNote: async (path) => NOTES[path] ?? null,
    resolveLink: async (target) => Object.keys(NOTES).find((path) => title(path) === target) ?? null,
    policyOf,
    taskRows: async () => [],
    todayKey: () => "2026-10-07",
    commands: () => [],
    writes,
  };
  const host: AiVaultHost = {
    conversations: {
      list: async () => [...saved.values()].map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, providerId: r.providerId, model: r.model })),
      load: async (id) => (saved.has(id) ? readConversationRecord(JSON.parse(JSON.stringify(saved.get(id)))) : null),
      save: async (record) => void saved.set(record.id, JSON.parse(JSON.stringify(record))),
      remove: async (id) => void saved.delete(id),
      removeAll: async () => saved.clear(),
    },
    ledger: { load: async () => ledger, save: async (entries) => void (ledger = [...entries]) },
    activeNote: async () => null,
    readNote: async (path) => note(path),
    situation: async () => ({ now: "2026-10-07 10:00", weekday: "Wednesday", calendarDay: "2026-10-07", journalDay: "2026-10-07", active: null, tabs: [], tasks: [], events: [], dailyNote: null }),
    candidates: async () => [],
    policy: { policyOf, resolveLink: deps.resolveLink },
    tools(recipient, scope, redact, web, narrowed, foreign, writing) {
      const more = furtherToolNames(deps);
      return { names: CHAT_TOOL_NAMES, more, executor: createVaultToolExecutor(deps, { recipient, webTools: web === true }, scope, redact, { more, ...(narrowed ? { narrowed } : {}), ...(foreign ? { foreign } : {}) }, writing) };
    },
    ...(options.sealed ? { encrypted: () => true } : {}),
  };
  return { host, saved, proposed, ledger: () => ledger };
}

const CLOUD = { providerId: "anthropic", model: "m-1" };
const LOCAL = { providerId: "ollama", model: "granite3.3:8b" };

async function session(script: EgressChunk[][], vault: ReturnType<typeof fillVault>, options: { model?: { providerId: string; model: string }; approve?: boolean } = {}) {
  const fake = fakeEgress(script);
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic", "ollama"], profiles: { balanced: options.model ?? CLOUD } };
  const s = new AiSession({
    egress: fake.egress,
    loadSettings: async () => stored,
    saveSettings: async (settings) => void (stored = settings),
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-07",
    now: () => new Date("2026-10-07T10:00:00Z"),
    newId: () => `id-${String(++ids).padStart(4, "0")}`,
    label: (key, vars) => (key === "ai.suggestionAuthor" ? `Plainva AI · ${String(vars?.model)}` : key === "ai.fill.roundNote" ? `Suggested for ${String(vars?.column)}` : key),
  });
  // Every send overview is kept and answered as the test says; the run's progress is kept as it was shown.
  const overviews: EgressManifest[] = [];
  const progress: (string | null)[] = [];
  s.subscribe(() => {
    const state = s.getState();
    const shown = state.fill ? `${state.fill.done}/${state.fill.total}` : null;
    if (progress[progress.length - 1] !== shown) progress.push(shown);
    if (state.consent) {
      overviews.push(state.consent.manifest);
      s.answerConsent(options.approve !== false);
    }
  });
  await s.load();
  await s.attachVault(vault.host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { s, fake, overviews, progress };
}

const body = (spec: HttpRequestSpec | undefined) => JSON.stringify(spec?.body ?? {});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("a run that fills a column", () => {
  it("reads each note on its own and lays what the model answers on that note, as a proposed value", async () => {
    const vault = fillVault();
    const { s, fake, overviews, progress } = await session([value("Maschinenbau"), value("Recht"), value(null)], vault);
    const outcome = await s.fillProperty({ base: BASE, column: branche, rows: [row("Acme"), row("Bolt"), row("Dora", "Private"), row("Core")] });
    expect(outcome).toEqual({ kind: "done", proposed: 2, silent: 1, kept: 1, failed: 0, stopped: false, provider: "Anthropic", model: "m-1" });

    // One request per note that may go: its own text, and nothing of another. The note the rules keep is never sent.
    expect(fake.sent).toHaveLength(3);
    expect(body(fake.sent[0])).toContain("Acme builds machines for bakeries");
    expect(body(fake.sent[0])).toContain("company: Acme");
    expect(body(fake.sent[0])).not.toContain("law firm");
    expect(body(fake.sent[1])).toContain("Bolt is a law firm");
    expect(body(fake.sent[1])).not.toContain("bakeries");
    for (const spec of fake.sent) {
      expect(body(spec)).not.toContain("insurance");
      expect(body(spec)).not.toContain("Dora");
      // Fixed sentences as the instruction, the column with the entry, and no tool.
      expect(body(spec)).toContain(FILL_INSTRUCTION.slice(0, 60));
      expect(body(spec)).toContain('The property is called \\"Branche\\" (key: \\"branche\\")');
      expect(spec.body).not.toHaveProperty("tools");
    }

    // Laid down through the tool every proposed value takes: one round per note, signed with the model.
    expect(vault.proposed.map((round) => round.path)).toEqual(["Clients/Acme.md", "Clients/Bolt.md"]);
    const round = vault.proposed[0]!;
    expect(round.author).toEqual({ id: "plainva-ai/m-1", displayName: "Plainva AI · m-1" });
    expect(round.note).toBe("Suggested for Branche");
    expect(round.base).toBe(NOTES["Clients/Acme.md"]);
    expect(round.chunks).toHaveLength(1);
    expect(round.chunks[0]!.replacement).toContain("branche: Maschinenbau");
    expect(vault.proposed[0]!.batch.id).not.toBe(vault.proposed[1]!.batch.id);

    // Asked once, with every note of the run in one overview — and the one the rules keep counted, not named.
    expect(overviews).toHaveLength(1);
    const overview = overviews[0]!;
    expect(overview.fill).toEqual({ column: "Branche" });
    expect(overview.sources.map((source) => source.path)).toEqual(["Clients/Acme.md", "Clients/Bolt.md", "Clients/Core.md"]);
    expect(overview.withheld.notes).toBe(1);
    expect(overview.dataClasses).toEqual(["notes"]);
    expect(overview.folders).toEqual(["Clients"]);
    expect(overview.tools).toEqual([]);
    expect(JSON.stringify(overview)).not.toContain("Dora");

    // How far the run is, and that it is over.
    expect(progress).toEqual([null, "0/3", "1/3", "2/3", "3/3", null]);
    expect(s.getState().fill).toBeNull();

    // One line in the ledger for the whole run; no conversation is kept.
    const ledger = vault.ledger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ providerId: "anthropic", model: "m-1", stop: "answered", steps: 3, tools: [], usage: { inputTokens: 120, outputTokens: 15 } });
    expect(ledger[0]!.conversationId.startsWith("fill-")).toBe(true);
    expect(vault.saved.size).toBe(0);
    expect(s.getState().summaries).toEqual([]);
  });

  it("takes no value that is none of the column's kind, and none that brings an address the note does not have", async () => {
    const vault = fillVault();
    const stage: FillColumn = { key: "stage", label: "Stage", input: "select", options: ["Open", "Won"] };
    const first = await session([value("Lost"), turn("I think it is Won."), value("won")], vault);
    expect(await first.s.fillProperty({ base: BASE, column: stage, rows: [row("Acme"), row("Bolt"), row("Core")] })).toMatchObject({ proposed: 1, silent: 0, failed: 2 });
    expect(vault.proposed.map((round) => [round.path, round.chunks[0]!.replacement.trim()])).toEqual([["Clients/Core.md", "stage: Won"]]);

    const site: FillColumn = { key: "website", label: "Website", input: "url" };
    const other = fillVault();
    const second = await session([value("https://acme.example"), value("https://bolt-law.example")], other);
    expect(await second.s.fillProperty({ base: BASE, column: site, rows: [row("Acme"), row("Bolt")] })).toMatchObject({ proposed: 1, failed: 1 });
    expect(other.proposed.map((round) => round.path)).toEqual(["Clients/Acme.md"]);
    expect(other.proposed[0]!.chunks[0]!.replacement).toContain("website: https://acme.example");
  });

  it("keeps a value from a note whose rules do not cover what the note names", async () => {
    const vault = fillVault();
    // Fox names Echo, which is kept from the internet; Fox itself is not — a value drawn from it does not go where that rule does not hold.
    const { s, fake } = await session([value("Bakery"), value("Bakery")], vault);
    expect(await s.fillProperty({ base: BASE, column: branche, rows: [row("Fox"), row("Echo", "Offline")] })).toMatchObject({ proposed: 1, kept: 1, failed: 0 });
    expect(fake.sent).toHaveLength(2);
    // Echo carries its rule itself: a value on it stays under it.
    expect(vault.proposed.map((round) => round.path)).toEqual(["Offline/Echo.md"]);
  });

  it("ends at a request that fails, with what was laid down so far", async () => {
    const vault = fillVault();
    const { s, fake } = await session([value("Maschinenbau")], vault);
    const outcome = await s.fillProperty({ base: BASE, column: branche, rows: [row("Acme"), row("Bolt"), row("Core")] });
    expect(outcome).toMatchObject({ kind: "done", proposed: 1, failed: 0, stopped: false, failure: { kind: "offline" } });
    // The third note is not asked: it would fail the same way.
    expect(fake.sent).toHaveLength(2);
    expect(vault.proposed).toHaveLength(1);
    // The failure's kind — never the provider's own words, which may quote what was sent.
    expect(vault.ledger()[0]).toMatchObject({ stop: "failed", steps: 2, failure: "offline" });
    expect(s.getState().fill).toBeNull();
  });

  it("can be ended between two entries; what was laid down stays", async () => {
    let stop: () => void = () => {};
    const vault = fillVault({ onPropose: () => stop() });
    const { s, fake } = await session([value("Maschinenbau"), value("Recht"), value("Other")], vault);
    stop = () => s.stopFill();
    const outcome = await s.fillProperty({ base: BASE, column: branche, rows: [row("Acme"), row("Bolt"), row("Core")] });
    expect(outcome).toMatchObject({ kind: "done", proposed: 1, stopped: true });
    expect(fake.sent).toHaveLength(1);
    expect(vault.proposed.map((round) => round.path)).toEqual(["Clients/Acme.md"]);
    expect(vault.ledger()[0]).toMatchObject({ stop: "cancelled", steps: 1 });
    // The next run starts as if nothing had been.
    expect(await s.fillProperty({ base: BASE, column: branche, rows: [row("Bolt")] })).toMatchObject({ kind: "done", proposed: 1 });
  });

  it("asks nobody for a model on this device, and sends nothing when the overview is declined", async () => {
    const local = fillVault();
    const chat = (text: string): EgressChunk[] => [
      { type: "open", status: 200 },
      { type: "data", text: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 4 } })}\n\ndata: [DONE]\n\n` },
      { type: "done" },
    ];
    const onDevice = await session([chat('{"value": "Versicherung"}')], local, { model: LOCAL });
    // A model on this device may read what is kept from the cloud — and the value stays where that rule holds.
    expect(await onDevice.s.fillProperty({ base: BASE, column: branche, rows: [row("Dora", "Private")] })).toMatchObject({ kind: "done", proposed: 1, kept: 0 });
    expect(onDevice.overviews).toEqual([]);
    expect(local.proposed.map((round) => round.path)).toEqual(["Private/Dora.md"]);

    const vault = fillVault();
    const declined = await session([value("Maschinenbau")], vault, { approve: false });
    expect(await declined.s.fillProperty({ base: BASE, column: branche, rows: [row("Acme")] })).toEqual({ kind: "refused", reason: "cancelled" });
    expect(declined.fake.sent).toEqual([]);
    expect(vault.proposed).toEqual([]);
    expect(vault.ledger()).toEqual([]);
    expect(declined.progress).toEqual([null]);
  });

  it("does not start where it cannot: off, sealed, no entries, a column no run takes, notes the rules all keep", async () => {
    const vault = fillVault();
    const { s, fake } = await session([], vault);
    expect(await s.fillProperty({ base: BASE, column: branche, rows: [] })).toEqual({ kind: "refused", reason: "nothing" });
    expect(await s.fillProperty({ base: BASE, column: { key: "plainva.ai.cloud", label: "Cloud", input: "text" }, rows: [row("Acme")] })).toEqual({ kind: "refused", reason: "unfit" });
    expect(await s.fillProperty({ base: BASE, column: { key: "client", label: "Client", input: "relation" }, rows: [row("Acme")] })).toEqual({ kind: "refused", reason: "unfit" });
    expect(await s.fillProperty({ base: BASE, column: branche, rows: [row("Dora", "Private"), row("Gone")] })).toEqual({ kind: "refused", reason: "kept" });
    await s.updateSettings((settings) => ({ ...settings, enabled: false }));
    expect(await s.fillProperty({ base: BASE, column: branche, rows: [row("Acme")] })).toEqual({ kind: "refused", reason: "off" });
    expect(fake.sent).toEqual([]);

    const sealed = fillVault({ sealed: true });
    const inside = await session([value("x")], sealed);
    expect(await inside.s.fillProperty({ base: BASE, column: branche, rows: [row("Acme")] })).toEqual({ kind: "refused", reason: "encrypted" });
    expect(inside.fake.sent).toEqual([]);
  });

  it("takes at most a run's limit of entries", async () => {
    const vault = fillVault();
    const many = Array.from({ length: FILL_LIMITS.rows + 5 }, () => row("Core"));
    const { s, fake } = await session(Array.from({ length: FILL_LIMITS.rows + 5 }, () => value(null)), vault);
    expect(await s.fillProperty({ base: BASE, column: branche, rows: many })).toMatchObject({ kind: "done", silent: FILL_LIMITS.rows });
    expect(fake.sent).toHaveLength(FILL_LIMITS.rows);
  });
});

describe("a filter in words", () => {
  const columns: FilterSchemaColumn[] = [
    { key: "stage", label: "Stage", input: "select", options: ["Open", "Sent"] },
    { key: "amount", label: "Amount", input: "number" },
  ];
  const answer = (match: string, list: unknown[]) => turn(JSON.stringify({ match, rules: list }));

  it("sends the sentence and the columns — no note, no value of an entry — and reads rules from the answer", async () => {
    const vault = fillVault();
    const { s, fake, overviews } = await session([answer("all", [{ column: "stage", op: "is", value: "sent" }, { column: "amount", op: "greater than", value: 5000 }])], vault);
    expect(await s.filterFromWords({ base: BASE, words: "  sent offers\nover 5000 ", columns })).toEqual({
      kind: "rules",
      logic: "all",
      rules: [
        { column: "stage", op: "==", value: "Sent" },
        { column: "amount", op: ">", value: "5000" },
      ],
      model: "m-1",
    });
    expect(fake.sent).toHaveLength(1);
    const sent = body(fake.sent[0]);
    expect(sent).toContain(FILTER_INSTRUCTION.slice(0, 60));
    expect(sent).toContain('- key \\"stage\\", name \\"Stage\\", kind select, choices: \\"Open\\", \\"Sent\\"');
    expect(sent).toContain("The sentence:\\nsent offers over 5000");
    expect(fake.sent[0]!.body).not.toHaveProperty("tools");
    for (const text of ["bakeries", "law firm", "Acme", "company"]) expect(sent).not.toContain(text);

    // The overview names the database and how many of its columns go — and that is all that goes.
    expect(overviews).toHaveLength(1);
    expect(overviews[0]!.sources).toEqual([{ path: BASE, title: "Clients", tier: "evidence", chars: expect.any(Number), reasons: [], columns: 2 }]);
    expect(overviews[0]!.folders).toEqual(["Clients"]);
    expect(vault.ledger()[0]).toMatchObject({ stop: "answered", steps: 1 });
    expect(vault.ledger()[0]!.conversationId.startsWith("filter-")).toBe(true);
    expect(vault.saved.size).toBe(0);
    expect(vault.proposed).toEqual([]);
  });

  it("says why there is no filter: none that fits, no filter at all, a request that failed", async () => {
    const vault = fillVault();
    const { s } = await session([answer("all", []), answer("all", [{ column: "city", op: "is", value: "Berlin" }]), turn("Sure — which offers?")], vault);
    expect(await s.filterFromWords({ base: BASE, words: "the nice ones", columns })).toEqual({ kind: "refused", reason: "none" });
    expect(await s.filterFromWords({ base: BASE, words: "in Berlin", columns })).toEqual({ kind: "refused", reason: "invalid" });
    expect(await s.filterFromWords({ base: BASE, words: "offers", columns })).toEqual({ kind: "refused", reason: "invalid" });
    expect(await s.filterFromWords({ base: BASE, words: "offers", columns })).toEqual({ kind: "refused", reason: "failed", failure: expect.objectContaining({ kind: "offline" }), provider: "Anthropic", model: "m-1" });
  });

  it("does not ask where it may not: nothing typed, no columns, a database the rules keep, a declined overview", async () => {
    const vault = fillVault();
    const { s, fake } = await session([], vault);
    expect(await s.filterFromWords({ base: BASE, words: "   ", columns })).toEqual({ kind: "refused", reason: "empty" });
    expect(await s.filterFromWords({ base: BASE, words: "offers", columns: [] })).toEqual({ kind: "refused", reason: "empty" });
    expect(await s.filterFromWords({ base: "Private/Secret.base", words: "offers", columns })).toEqual({ kind: "refused", reason: "denied" });
    expect(fake.sent).toEqual([]);

    const declined = await session([answer("all", [])], fillVault(), { approve: false });
    expect(await declined.s.filterFromWords({ base: BASE, words: "offers", columns })).toEqual({ kind: "refused", reason: "cancelled" });
    expect(declined.fake.sent).toEqual([]);
  });

  it("is offered inside an encrypted workspace too: it proposes nothing to a note", async () => {
    // What may go from a sealed workspace is its rules' to say; this fixture's rules let the database go.
    const sealed = fillVault({ sealed: true });
    const { s } = await session([answer("any", [{ column: "amount", op: "at least", value: "10" }])], sealed);
    expect(await s.filterFromWords({ base: BASE, words: "ten or more", columns })).toMatchObject({ kind: "rules", logic: "any", rules: [{ column: "amount", op: ">=", value: "10" }] });
  });
});
