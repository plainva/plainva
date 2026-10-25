import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_APP_SETTINGS,
  effectivePolicy,
  EMPTY_INSTRUCTION_APPROVALS,
  noteHash,
  notePolicyFrom,
  readConversationRecord,
  readInstructionFile,
  scanInstruction,
  scanVaultInstructions,
  type Candidate,
  type ConversationRecord,
  type EgressChunk,
  type InstructionIO,
  type LedgerEntry,
  type ModelChoice,
} from "@plainva/core";
import { AiSession, CHAT_TOOL_NAMES, createMcpVaultStore, createVaultToolExecutor, furtherToolNames, replayRequest, type AiVaultHost, type VaultToolDeps } from "@plainva/ui";
import { fakeEgress, turn } from "./mcpSessionHarness";
import { memoryFiles } from "./mcpTestHost";

/**
 * A run's snapshot and its replay in the real session (plan KI-Harness P9-2,
 * ADR 0034): the run keeps the version of each note its context carried and
 * of each one its tools read whole — a hash, never the text —; looked at
 * later, it says what changed since; and "Ask another model…" asks the same
 * words of another model in a new conversation, with exactly the run's notes
 * pinned and nothing a search finds, under the rules as they are now, through
 * the send overview like every request.
 */

const OFFER = "# Offer 2026\n\nThe day rate is 1,800 euros.\n";
const BUDGET = "# Budget 2026\n\nTravel for block two is still open.\n";
const PLAN = "# Plan\n\nKick-off on Monday.\n";
const ORIGINAL: ModelChoice = { providerId: "anthropic", model: "m-1" };
const OTHER: ModelChoice = { providerId: "anthropic", model: "m-2" };

/** A vault whose notes a test changes, whose search a test counts, and whose tools are the real ones. */
function vault() {
  const notes = new Map<string, string>([
    ["Projects/Offer.md", OFFER],
    ["Projects/Budget.md", BUDGET],
    ["Projects/Plan.md", PLAN],
  ]);
  const searches: string[] = [];
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  const io: InstructionIO = { list: async () => [], read: async () => null };
  const title = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  // A note's own rule, as its properties block says it (the one rule these tests need).
  const policyOf: VaultToolDeps["policyOf"] = async (path, text) => {
    const said = text ?? notes.get(path) ?? "";
    return effectivePolicy(path, notePolicyFrom(said.includes("cloud: deny") ? { plainva: { ai: { cloud: "deny" } } } : {}), []);
  };
  const deps: VaultToolDeps = {
    search: async () => [],
    readNote: async (path) => notes.get(path) ?? null,
    resolveLink: async () => null,
    policyOf,
    taskRows: async () => [],
    todayKey: () => "2026-10-25",
    commands: () => [],
  };
  const host: AiVaultHost = {
    conversations: {
      list: async () => [...saved.values()].map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, providerId: r.providerId, model: r.model })),
      load: async (id) => {
        const r = saved.get(id);
        return r ? readConversationRecord(JSON.parse(JSON.stringify(r))) : null;
      },
      save: async (record) => void saved.set(record.id, JSON.parse(JSON.stringify(record))),
      remove: async (id) => void saved.delete(id),
      removeAll: async () => saved.clear(),
    },
    ledger: { load: async () => ledger, save: async (entries) => void (ledger = [...entries]) },
    activeNote: async () => null,
    readNote: async (path) => {
      const text = notes.get(path);
      return text === undefined ? null : { path, title: title(path), text };
    },
    situation: async () => ({ now: "2026-10-25 09:14", weekday: "Sunday", calendarDay: "2026-10-25", journalDay: "2026-10-25", active: null, tabs: [], tasks: [], events: [], dailyNote: null }),
    // What a question finds: the plan, every time — so a replay that asks no search is told apart.
    candidates: async (question) => {
      searches.push(question);
      const found: Candidate[] = [{ path: "Projects/Plan.md", title: "Plan", signals: { lexical: 1 } }];
      return [found];
    },
    policy: { policyOf, resolveLink: deps.resolveLink },
    tools(recipient, scope, redact, web, narrowed) {
      const more = furtherToolNames(deps);
      return { names: CHAT_TOOL_NAMES, more, executor: createVaultToolExecutor(deps, { recipient, webTools: web === true }, scope, redact, { more, ...(narrowed ? { narrowed } : {}) }) };
    },
    mcp: createMcpVaultStore(memoryFiles(), "vault-snapshot"),
    instructions: {
      scan: () => scanVaultInstructions(io),
      scanOne: (id) => scanInstruction(io, id),
      readFile: (source, rel) => readInstructionFile(io, source, rel),
      approvals: { load: async () => EMPTY_INSTRUCTION_APPROVALS, save: async () => {} },
    },
  };
  return { host, notes, searches };
}

async function session(script: EgressChunk[][], v = vault()) {
  const fake = fakeEgress(script);
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic"], profiles: { balanced: ORIGINAL, fast: OTHER } };
  const s = new AiSession({
    egress: fake.egress,
    loadSettings: async () => stored,
    saveSettings: async (settings) => void (stored = settings),
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-25",
    now: () => new Date("2026-10-25T09:14:00Z"),
    newId: () => `id${++ids}`,
    label: (key, vars) => (key === "ai.replay.title" ? `${vars?.title} · ${vars?.model}` : key),
  });
  // Every send overview the session showed — and approved, as the user would here.
  const overviews: string[] = [];
  s.subscribe(() => {
    const consent = s.getState().consent;
    if (consent) {
      overviews.push(`${consent.manifest.providerId}/${consent.manifest.model}`);
      s.answerConsent(true);
    }
  });
  await s.load();
  await s.attachVault(v.host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { s, fake, v, overviews };
}

/** The original run: the offer pinned, a question, the model reads the budget with a tool and answers. */
async function asked(script: EgressChunk[][] = []) {
  const h = await session([turn({ calls: [{ id: "c1", name: "read_note", args: { path: "Projects/Budget.md" } }] }), turn({ text: "The day rate is 1,800 euros; travel is still open." }), ...script]);
  await h.s.pin("Projects/Offer.md");
  await h.s.send("What is the day rate, and what is still open?");
  const record = h.s.getState().active!;
  return { ...h, record, run: record.runs[0]! };
}

/** The text a request carried, whatever the provider's format. */
const said = (spec: { body?: unknown } | undefined) => JSON.stringify(spec?.body ?? null);

describe("a run's snapshot", () => {
  it("keeps the version of each note its context carried and of each its tools read whole — a hash, never the text", async () => {
    const { run } = await asked();
    const sources = new Map((run.manifest?.sources ?? []).map((source) => [source.path, source.hash]));
    expect(sources.get("Projects/Offer.md")).toBe(noteHash(OFFER));
    // Found by the question's search, and carried: its version is kept as well.
    expect(sources.get("Projects/Plan.md")).toBe(noteHash(PLAN));
    expect(run.readHashes).toEqual([{ path: "Projects/Budget.md", hash: noteHash(BUDGET) }]);
    const stored = JSON.stringify(run);
    expect(stored).not.toContain("1,800 euros");
    expect(stored).not.toContain("Travel for block two");
  });

  it("says what changed since: a note edited, a note gone — asked on this device when it is looked at", async () => {
    const { s, v, run, fake } = await asked();
    const sent = fake.sent.length;
    expect(await s.snapshotStates(run)).toEqual({
      sources: { "Projects/Offer.md": "same", "Projects/Plan.md": "same" },
      read: { "Projects/Budget.md": "same" },
      skills: {},
    });
    v.notes.set("Projects/Offer.md", `${OFFER}Travel is extra.\n`);
    v.notes.delete("Projects/Budget.md");
    const now = await s.snapshotStates(run);
    expect(now.sources["Projects/Offer.md"]).toBe("changed");
    expect(now.read["Projects/Budget.md"]).toBe("gone");
    expect(fake.sent).toHaveLength(sent);
  });
});

describe("asking another model", () => {
  it("asks the same words with exactly the run's notes, in a new conversation that says where it comes from — through the send overview", async () => {
    const { s, v, record, run, fake, overviews } = await asked([turn({ text: "1,800 euros a day; travel is open." })]);
    v.notes.set("Projects/Offer.md", `${OFFER}Travel is extra.\n`);
    const searches = v.searches.length;
    const before = fake.sent.length;
    const stop = await s.replay(record.id, run.userTurn, OTHER);
    expect(stop).toMatchObject({ kind: "answered" });
    expect(fake.sent).toHaveLength(before + 1);
    const request = said(fake.sent[before]);
    expect(request).toContain('"model":"m-2"');
    expect(request).toContain("What is the day rate, and what is still open?");
    // The run's notes as they are now — the changed offer included —, and nothing a search would find.
    expect(request).toContain("Travel is extra.");
    expect(request).toContain("Kick-off on Monday.");
    expect(v.searches).toHaveLength(searches);
    expect(overviews[overviews.length - 1]).toBe("anthropic/m-2");
    const replay = s.getState().active!;
    expect(replay.id).not.toBe(record.id);
    expect(replay.title).toBe(`${record.title} · m-2`);
    expect(replay.pins.sort()).toEqual(["Projects/Offer.md", "Projects/Plan.md"]);
    expect(replay.replayOf).toEqual({ conversationId: record.id, userTurn: run.userTurn, title: record.title, at: record.conversation.turns[run.userTurn]!.at, providerId: "anthropic", model: "m-1", changed: 1 });
    expect(replay.providerId).toBe("anthropic");
    expect(replay.model).toBe("m-2");
    // The original stays as it was.
    expect((await v.host.conversations.load(record.id))!.runs).toHaveLength(1);
  });

  it("holds the rules as they are now: a note kept from this model since does not go along", async () => {
    const { s, v, record, run, fake } = await asked([turn({ text: "1,800 euros a day." })]);
    // Since the answer, the plan says it never goes to a cloud.
    v.notes.set("Projects/Plan.md", `---\nplainva:\n  ai:\n    cloud: deny\n---\n${PLAN}`);
    const before = fake.sent.length;
    await s.replay(record.id, run.userTurn, OTHER);
    expect(said(fake.sent[before])).not.toContain("Kick-off on Monday.");
    expect(s.getState().active!.runs[0]!.kept).toContain("Projects/Plan.md");
  });

  it("asks only the first question of a conversation — a later one rests on what was said before", async () => {
    const { s, record, fake } = await asked([turn({ text: "And the plan starts on Monday." })]);
    await s.send("And when does the plan start?");
    const later = s.getState().active!.runs[1]!;
    const updated = s.getState().active!;
    expect(replayRequest(updated, later)).toEqual({ ok: false, reason: "later" });
    const before = fake.sent.length;
    expect(await s.replay(record.id, later.userTurn, OTHER)).toBeNull();
    expect(fake.sent).toHaveLength(before);
  });
});

describe("what can be asked again", () => {
  const record = (parts: ConversationRecord["conversation"]["turns"][number]["parts"]): ConversationRecord => ({
    version: 1,
    id: "c1",
    title: "Day rate",
    createdAt: "2026-10-25T09:14:00Z",
    updatedAt: "2026-10-25T09:14:00Z",
    providerId: "anthropic",
    model: "m-1",
    conversation: { id: "c1", system: "", tools: [], turns: [{ role: "user", parts, at: "2026-10-25T09:14:00Z" }] },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    runs: [{ userTurn: 0, providerId: "anthropic", model: "m-1", sent: [], kept: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, steps: 1, stop: "answered" }],
    pins: [],
  });
  const context = { type: "text" as const, text: "<context>", context: ["Projects/Offer.md#abc"] };

  it("is the user's words beside the context, and nothing a door brought along", () => {
    const plain = record([context, { type: "text", text: "What is the day rate?" }]);
    expect(replayRequest(plain, plain.runs[0]!)).toEqual({ ok: true, words: "What is the day rate?" });
    // A selection or a log's material is a second part beside the context; a picture is no text at all.
    const door = record([context, { type: "text", text: "<selection>", context: ["Projects/Offer.md#sel"] }, { type: "text", text: "Explain this." }]);
    expect(replayRequest(door, door.runs[0]!)).toEqual({ ok: false, reason: "material" });
    const picture = record([context, { type: "image", mime: "image/png", data: "iVBOR", name: "chart.png" } as never, { type: "text", text: "What does it show?" }]);
    expect(replayRequest(picture, picture.runs[0]!)).toEqual({ ok: false, reason: "material" });
    const empty = record([context, { type: "text", text: "  " }]);
    expect(replayRequest(empty, empty.runs[0]!)).toEqual({ ok: false, reason: "empty" });
  });
});
