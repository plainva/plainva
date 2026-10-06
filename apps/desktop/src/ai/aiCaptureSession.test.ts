import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_APP_SETTINGS,
  DEFAULT_WEB_SETTINGS,
  EFFECT_DECLINED,
  EMPTY_SKILL_TESTS,
  effectivePolicy,
  notePolicyFrom,
  readConversationRecord,
  readFrontmatterPath,
  type AiEgress,
  type ConversationRecord,
  type EgressChunk,
  type FolderPolicyRule,
  type HttpRequestSpec,
  type LedgerEntry,
  type SkillTestRecords,
  type ToolResultPart,
  type WebFetchResult,
  type WebSettings,
} from "@plainva/core";
import { AiSession, CHAT_TOOL_NAMES, createVaultToolExecutor, furtherToolNames, writeCapturedNote, type AiVaultHost, type EffectRequest, type VaultToolDeps } from "@plainva/ui";

/**
 * "Keep as a note" and the two skills of plan KI-Harness P4-6 in the session:
 * an answer becomes a note the app writes, with what the run's own record
 * says it rests on; and of all skills only the one that names the internet's
 * tools brings them into its conversation — where the vault allows it.
 */

/** One Anthropic answer: optional text, optional tool calls. */
function turn(opts: { text?: string; calls?: Array<{ id: string; name: string; args: unknown }> }): EgressChunk[] {
  const events: Array<[string, unknown]> = [["message_start", { type: "message_start", message: { usage: { input_tokens: 40 } } }]];
  let index = 0;
  if (opts.text) {
    events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
    events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: opts.text } }]);
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
    index++;
  }
  for (const call of opts.calls ?? []) {
    events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: call.id, name: call.name, input: {} } }]);
    events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(call.args) } }]);
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
    index++;
  }
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: opts.calls?.length ? "tool_use" : "end_turn" }, usage: { output_tokens: 5 } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return [{ type: "open", status: 200 }, { type: "data", text: events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("") }, { type: "done" }];
}

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

const BASE_NOTES: Record<string, string> = {
  "Projects/Offer 2026.md": "# Offer 2026\n\nThe offer names a day rate of 1,800 euros.",
  "Projects/Rates.md": "# Rates\n\nLast year's rate was 1,750 euros.",
};

const RATES = "https://example.org/rates";
const PAGE: WebFetchResult = { kind: "page", url: RATES, status: 200, contentType: "text/html; charset=utf-8", body: "<html><head><title>Rates 2026</title></head><body><main><p>The day rate for 2026 is 1,900 euros.</p></main></body></html>", truncated: false };
const REPORT = JSON.stringify({ relevant: true, summary: "The day rate for 2026 is 1,900 euros.", facts: [{ text: "Day rate 2026: 1,900 euros", quote: "The day rate for 2026 is 1,900 euros." }], links: [] });

function vaultOf(
  options: {
    web?: WebSettings;
    shared?: boolean;
    capture?: boolean;
    active?: string;
    notes?: Record<string, string>;
    /** The vault's folder rules (`.agent/policy.yml`). */
    rules?: FolderPolicyRule[];
  } = {},
) {
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  let web = options.web ?? DEFAULT_WEB_SETTINGS;
  let tests: SkillTestRecords = EMPTY_SKILL_TESTS;
  const NOTES = { ...BASE_NOTES, ...(options.notes ?? {}) };
  /** The vault as the capture sees it: paths and what was written. */
  const written = new Map<string, string>();
  const dirs = new Set<string>();
  /** Paths whose rules cannot be looked up from now on. */
  const unreadable = new Set<string>();
  const policyOf = async (path: string) => {
    if (unreadable.has(path)) throw new Error("unreadable");
    return effectivePolicy(path, notePolicyFrom({}), options.rules ?? []);
  };
  const title = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  const note = (path: string) => (NOTES[path] === undefined ? null : { path, title: title(path), text: NOTES[path]! });
  const deps: VaultToolDeps = {
    // Every note of the vault is a hit: what a tool may return of them is the gate's to decide.
    search: async () => Object.keys(NOTES).map((path) => ({ path, title: title(path), snippet: NOTES[path]!.slice(0, 40) })),
    readNote: async (path) => NOTES[path] ?? null,
    resolveLink: async (target) => Object.keys(NOTES).find((path) => title(path) === target) ?? null,
    policyOf,
    taskRows: async () => [],
    todayKey: () => "2026-10-06",
    commands: () => [],
    events: async () => [],
    // A vault with mail behind its tools: no account answers in these tests, the tools are what matters.
    mail: { accounts: async () => [], folders: async () => [], newest: async () => ({ messages: [], offline: false }), search: async () => [], message: async () => null },
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
    activeNote: async () => (options.active ? note(options.active) : null),
    readNote: async (path) => note(path),
    async situation() {
      const active = options.active ? note(options.active) : null;
      return { now: "2026-10-06 10:00", weekday: "Tuesday", calendarDay: "2026-10-06", journalDay: "2026-10-06", active: active ? { kind: "note" as const, path: active.path, title: active.title } : null, tabs: [], tasks: [], events: [], dailyNote: null };
    },
    candidates: async () => [],
    policy: { policyOf, resolveLink: deps.resolveLink },
    tools(recipient, scope, redact, withWeb, narrowed) {
      const more = furtherToolNames(deps);
      return { names: CHAT_TOOL_NAMES, more, executor: createVaultToolExecutor(deps, { recipient, webTools: withWeb === true }, scope, redact, { more, ...(narrowed ? { narrowed } : {}) }) };
    },
    web: { load: async () => web, save: async (next) => void (web = next) },
    skillTests: { load: async () => tests, save: async (value) => void (tests = value) },
    encrypted: () => options.shared === true,
    ...(options.capture === false
      ? {}
      : {
          capture: {
            folder: async () => "Inbox",
            write: (folder, stem, content) =>
              writeCapturedNote({ exists: async (path) => written.has(path) || dirs.has(path), createDir: async (path) => void dirs.add(path), writeTextFile: async (path, text) => void written.set(path, text) }, folder, stem, content),
          },
        }),
  };
  return { host, saved, written, dirs, tests: () => tests, unreadable };
}

/** One answer of a server on this computer, as a chat stream: text, or tool calls. */
function chat(opts: { text?: string; calls?: Array<{ id: string; name: string; args: unknown }> }): EgressChunk[] {
  const lines: unknown[] = [];
  if (opts.text) lines.push({ choices: [{ delta: { content: opts.text } }] });
  (opts.calls ?? []).forEach((call, index) => lines.push({ choices: [{ delta: { tool_calls: [{ index, id: call.id, function: { name: call.name, arguments: JSON.stringify(call.args) } }] } }] }));
  lines.push({ choices: [{ delta: {}, finish_reason: opts.calls?.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: 300, completion_tokens: 40 } });
  return [{ type: "open", status: 200 }, { type: "data", text: `${lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join("")}data: [DONE]\n\n` }, { type: "done" }];
}

const CLOUD = { providerId: "anthropic", model: "m-1" };
const LOCAL = { providerId: "ollama", model: "granite3.3:8b" };

async function session(script: EgressChunk[][], vault: ReturnType<typeof vaultOf>, model: { providerId: string; model: string } = CLOUD) {
  const fake = fakeEgress(script);
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic", "ollama"], profiles: { balanced: model } };
  const fetched: string[] = [];
  const s = new AiSession({
    egress: fake.egress,
    loadSettings: async () => stored,
    saveSettings: async (settings) => void (stored = settings),
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-06",
    now: () => new Date("2026-10-06T10:00:00Z"),
    newId: () => `id${++ids}`,
    // The words the note is written with, as the app's language would give them.
    label: (key, vars) =>
      ({
        "ai.capture.fallbackTitle": "AI answer",
        "ai.capture.intro": `Answer by Plainva AI · ${vars?.model}, ${vars?.date}, to: “${vars?.question}”`,
        "ai.capture.sources": "Sources",
        "ai.capture.web": "From the web",
        "ai.capture.vault": "From your notes",
        "ai.capture.read": `read on ${vars?.date}`,
        "ai.capture.search": `Search “${vars?.query}” via ${vars?.provider}, ${vars?.date}`,
      })[key] ?? key,
    web: {
      async fetch(url) {
        fetched.push(url);
        return url === RATES ? PAGE : { kind: "failed", code: "offline" };
      },
    },
  });
  const effects: EffectRequest[] = [];
  s.subscribe(() => {
    if (s.getState().consent) s.answerConsent(true);
  });
  await s.load();
  await s.attachVault(vault.host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  /** Answers each question to the user as it comes. */
  const answer = (how: (effect: EffectRequest) => "once" | "always" | "deny") =>
    s.subscribe(() => {
      const effect = s.getState().effect;
      if (effect && !effects.includes(effect)) {
        effects.push(effect);
        s.answerEffect(how(effect));
      }
    });
  return { s, fake, effects, answer, fetched };
}

const toolNames = (spec: HttpRequestSpec | undefined) => ((spec?.body?.tools ?? []) as { name?: string }[]).map((tool) => tool.name);

describe("keep as a note", () => {
  it("writes the answer of a run into the inbox folder, with the notes it rests on — sent along or read by a tool", async () => {
    const vault = vaultOf({ active: "Projects/Offer 2026.md" });
    const { s, fake } = await session([turn({ calls: [{ id: "c1", name: "read_note", args: { path: "Projects/Rates.md" } }, { id: "c2", name: "read_note", args: { path: "Projects/Missing.md" } }] }), turn({ text: "The offer names 1,800 euros; last year it was 1,750 [[Rates]]." })], vault);
    expect(await s.send("How does the offer compare with last year?")).toEqual({ kind: "answered" });
    expect(s.canCapture()).toBe(true);
    const sentBefore = fake.sent.length;
    const outcome = await s.captureAnswer(0);
    expect(outcome).toEqual({ kind: "captured", path: "Inbox/How does the offer compare with last year.md", title: "How does the offer compare with last year?" });
    // The app wrote it: no model was asked for anything.
    expect(fake.sent).toHaveLength(sentBefore);
    const note = vault.written.get("Inbox/How does the offer compare with last year.md")!;
    expect(readFrontmatterPath(note, ["generated", "by"])).toBe("plainva-ai/m-1");
    // The open note went along; `Rates` was read by a tool; the note that could not be read is no source.
    expect(readFrontmatterPath(note, ["sources"])).toEqual([
      { resource: "Projects/Offer 2026.md", title: "Offer 2026" },
      { resource: "Projects/Rates.md", title: "Rates" },
    ]);
    expect(note).toContain("to: “How does the offer compare with last year?”");
    expect(note).toContain("The offer names 1,800 euros; last year it was 1,750 [[Rates]].");
    expect(note).not.toContain("Missing");
  });

  it("names the pages a run read and the searches it made — from the run's record, with the addresses as they were read", async () => {
    const vault = vaultOf({ web: { enabled: true, allow: [] } });
    const { s, answer, fetched } = await session(
      [
        turn({ calls: [{ id: "c1", name: "fetch_url", args: { url: RATES, question: "What is the day rate?" } }] }),
        turn({ text: REPORT }),
        turn({ text: `The day rate is 1,900 euros (${RATES}). More at https://other.example.net/more.` }),
      ],
      vault,
    );
    answer(() => "once");
    s.setDraftWeb(true);
    expect(await s.send(`What does ${RATES} say about day rates?`)).toEqual({ kind: "answered" });
    expect(fetched).toEqual([RATES]);
    const outcome = await s.captureAnswer(0);
    expect(outcome.kind).toBe("captured");
    const [note] = [...vault.written.values()];
    expect(readFrontmatterPath(note!, ["sources"])).toEqual([{ resource: RATES, title: "Rates 2026" }]);
    const [body, sources] = note!.slice(note!.indexOf("\n---\n") + 5).split("## Sources");
    // In the answer every address is inert — the page that was read as much as the one the model only named.
    expect(body).toContain("https[://]example.org/rates");
    expect(body).toContain("https[://]other.example.net/more");
    // (The heading and the first line repeat the user's own question, address and all: those are the user's words.)
    expect(body!.replace(/^[#>] .*$/gm, "")).not.toMatch(/https?:\/\//);
    // The app's list holds the one page that was read, live.
    expect(sources).toContain("- [Rates 2026](https://example.org/rates) — read on ");
    expect(sources).not.toContain("other.example.net");
  });

  it("inside a shared workspace asks first, each time — and writes nothing after a no", async () => {
    const vault = vaultOf({ shared: true });
    const { s, effects, answer } = await session([turn({ text: "An answer." }), turn({ text: "Another." })], vault);
    // The question below is about who reads the note, not about where the answer came from.
    await s.send("First question?");
    let reply: "once" | "deny" = "deny";
    answer(() => reply);
    expect(await s.captureAnswer(0)).toEqual({ kind: "refused", reason: "cancelled" });
    expect(vault.written.size).toBe(0);
    expect(effects[0]).toMatchObject({ kind: "write", audience: "members", title: "First question?", folder: "Inbox" });
    reply = "once";
    expect(await s.captureAnswer(0)).toMatchObject({ kind: "captured", path: "Inbox/First question.md" });
    // A yes for one note is no yes for the next.
    await s.send("Second question?");
    reply = "deny";
    expect(await s.captureAnswer(2)).toEqual({ kind: "refused", reason: "cancelled" });
    expect(effects).toHaveLength(3);
    expect([...vault.written.keys()]).toEqual(["Inbox/First question.md"]);
  });

  it("takes leaving the conversation as a no: the question does not stay behind over another one", async () => {
    const vault = vaultOf({ shared: true });
    const { s } = await session([turn({ text: "An answer." }), turn({ text: "Another." })], vault);
    await s.send("First question?");
    const first = s.getState().active!.id;
    // A new conversation, while the question waits.
    let pending = s.captureAnswer(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.getState().effect).toMatchObject({ kind: "write", title: "First question?" });
    s.newConversation();
    expect(s.getState().effect).toBeNull();
    expect(await pending).toEqual({ kind: "refused", reason: "cancelled" });
    // Another conversation opened from the history.
    await s.send("Second question?");
    await s.open(first);
    pending = s.captureAnswer(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.getState().effect).toMatchObject({ kind: "write" });
    await s.open([...vault.saved.keys()].find((id) => id !== first)!);
    expect(await pending).toEqual({ kind: "refused", reason: "cancelled" });
    // And the conversation deleted from under its question.
    await s.open(first);
    pending = s.captureAnswer(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await s.remove(first);
    expect(await pending).toEqual({ kind: "refused", reason: "cancelled" });
    expect(s.getState().effect).toBeNull();
    expect(vault.written.size).toBe(0);
    // Nothing is left waiting: the next answer can be kept, after its own question.
    await s.open([...vault.saved.keys()][0]!);
    pending = s.captureAnswer(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(s.getState().effect).toMatchObject({ kind: "write", title: "Second question?" });
    s.answerEffect("once");
    expect(await pending).toMatchObject({ kind: "captured", path: "Inbox/Second question.md" });
    expect([...vault.written.keys()]).toEqual(["Inbox/Second question.md"]);
  });

  it("asks nothing in a vault of one's own", async () => {
    const vault = vaultOf();
    const { s, effects, answer } = await session([turn({ text: "An answer." })], vault);
    answer(() => "deny");
    await s.send("A question?");
    expect(await s.captureAnswer(0)).toMatchObject({ kind: "captured" });
    expect(effects).toEqual([]);
  });

  it("keeps a second note beside the first instead of writing over it", async () => {
    const vault = vaultOf();
    const { s } = await session([turn({ text: "An answer." })], vault);
    await s.send("A question?");
    await s.captureAnswer(0);
    expect(await s.captureAnswer(0)).toMatchObject({ kind: "captured", path: "Inbox/A question 2.md" });
  });

  it("says why there is nothing to keep", async () => {
    const vault = vaultOf();
    const { s } = await session([[{ type: "httpError", status: 500, body: "{}" }]], vault);
    expect(await s.captureAnswer(0)).toEqual({ kind: "refused", reason: "nothing" });
    await s.send("A question?");
    // A run without an answer has nothing to keep; neither has a turn that began no run.
    expect(await s.captureAnswer(0)).toEqual({ kind: "refused", reason: "nothing" });
    expect(await s.captureAnswer(7)).toEqual({ kind: "refused", reason: "nothing" });
    await s.updateSettings((settings) => ({ ...settings, enabled: false }));
    expect(await s.captureAnswer(0)).toEqual({ kind: "refused", reason: "off" });
    expect(s.canCapture()).toBe(false);
    expect(vault.written.size).toBe(0);
  });

  it("names a note a skill started after the skill and the open note — never after the skill's own request", async () => {
    const vault = vaultOf({ active: "Projects/Offer 2026.md" });
    const { s } = await session([turn({ text: "The offer names 1,800 euros." }), turn({ text: "Yes, per day." })], vault);
    expect(await s.runSkill("plainva:research", "I want to research something on the web and in my notes.")).toEqual({ kind: "answered" });
    expect(await s.captureAnswer(0)).toEqual({ kind: "captured", path: "Inbox/ai.skills.research.title – Offer 2026.md", title: "ai.skills.research.title – Offer 2026" });
    // What was sent still stands in the note, as what was asked.
    expect(vault.written.get("Inbox/ai.skills.research.title – Offer 2026.md")).toContain("to: “I want to research something on the web and in my notes.”");
    // What the user asks next in that conversation are their own words again.
    expect(await s.send("Is that per day?")).toEqual({ kind: "answered" });
    expect(await s.captureAnswer(2)).toMatchObject({ kind: "captured", path: "Inbox/Is that per day.md" });

    // Without an open note, the day tells such notes apart.
    const bare = vaultOf();
    const other = await session([turn({ text: "What should I look for?" })], bare);
    await other.s.runSkill("plainva:research", "I want to research something on the web and in my notes.");
    expect(await other.s.captureAnswer(0)).toMatchObject({ kind: "captured", path: "Inbox/ai.skills.research.title – 2026-10-06.md" });
  });

  it("is not offered where the shell writes no notes", async () => {
    const vault = vaultOf({ capture: false });
    const { s } = await session([turn({ text: "An answer." })], vault);
    await s.send("A question?");
    expect(s.canCapture()).toBe(false);
    expect(await s.captureAnswer(0)).toEqual({ kind: "refused", reason: "unavailable" });
  });
});

describe("a kept note inherits the rules of what it rests on", () => {
  const PRIVATE = { "Private/Client.md": "# Client\n\nNorthwind pays 2,400 euros a day." };
  const rules: FolderPolicyRule[] = [{ folder: "Private/", cloud: "deny" }];
  const ruleOf = (note: string) => readFrontmatterPath(note, ["plainva", "ai"]);

  it("a model on this device read a note kept from the cloud: the new note is kept from it too", async () => {
    // Through a tool: the search returns the private note, because nothing leaves this device for this model.
    const vault = vaultOf({ notes: PRIVATE, rules });
    const { s } = await session([chat({ calls: [{ id: "c1", name: "search_vault", args: { query: "day rate" } }] }), chat({ text: "Northwind pays 2,400 euros a day." })], vault, LOCAL);
    expect(await s.send("What does Northwind pay?")).toEqual({ kind: "answered" });
    // The run's record keeps the rule, never the path.
    expect(s.getState().active!.runs[0]!.restricted).toEqual(["cloud"]);
    expect(JSON.stringify(s.getState().active!.runs[0]!.restricted)).not.toContain("Private");
    expect(await s.captureAnswer(0)).toEqual({ kind: "captured", path: "Inbox/What does Northwind pay.md", title: "What does Northwind pay?", inherited: ["cloud"] });
    const note = vault.written.get("Inbox/What does Northwind pay.md")!;
    expect(ruleOf(note)).toEqual({ cloud: "deny" });
    // The stamp and the rule stand side by side in the note's properties.
    expect(readFrontmatterPath(note, ["generated", "by"])).toBe("plainva-ai/granite3.3:8b");

    // The same when the private note is the open one and went along as context.
    const open = vaultOf({ notes: PRIVATE, rules, active: "Private/Client.md" });
    const other = await session([chat({ text: "2,400 euros a day." })], open, LOCAL);
    await other.s.send("What does this client pay?");
    expect(other.s.getState().active!.runs[0]!.restricted).toBeUndefined();
    expect(await other.s.captureAnswer(0)).toMatchObject({ kind: "captured", inherited: ["cloud"] });
    expect(ruleOf([...open.written.values()][0]!)).toEqual({ cloud: "deny" });
  });

  it("a cloud model never got the note: nothing is inherited, and the new note carries no rule", async () => {
    const vault = vaultOf({ notes: PRIVATE, rules });
    const { s } = await session([turn({ calls: [{ id: "c1", name: "search_vault", args: { query: "day rate" } }] }), turn({ text: "The offer names 1,800 euros." })], vault);
    await s.send("What are the day rates?");
    expect(s.getState().active!.runs[0]!.restricted).toBeUndefined();
    expect(await s.captureAnswer(0)).toEqual({ kind: "captured", path: "Inbox/What are the day rates.md", title: "What are the day rates?" });
    expect(ruleOf(vault.written.get("Inbox/What are the day rates.md")!)).toBeUndefined();
  });

  it("a note kept from the internet, read in a conversation without it: the new note is kept from the internet too", async () => {
    const vault = vaultOf({ notes: PRIVATE, rules: [{ folder: "Private/", web: "deny" }] });
    const { s } = await session([turn({ calls: [{ id: "c1", name: "read_note", args: { path: "Private/Client.md" } }] }), turn({ text: "2,400 euros a day." })], vault);
    await s.send("What does Northwind pay?");
    expect(s.getState().active!.runs[0]!.restricted).toEqual(["web"]);
    expect(await s.captureAnswer(0)).toMatchObject({ kind: "captured", inherited: ["web"] });
    expect(ruleOf([...vault.written.values()][0]!)).toEqual({ web: "deny" });
  });

  it("counts everything the conversation carried up to the answer, not only the last run", async () => {
    const vault = vaultOf({ notes: PRIVATE, rules });
    const { s } = await session([chat({ calls: [{ id: "c1", name: "read_note", args: { path: "Private/Client.md" } }] }), chat({ text: "Read." }), chat({ text: "It is 2,400 euros a day." })], vault, LOCAL);
    await s.send("Read the client note.");
    await s.send("And what is the rate?");
    const [first, second] = s.getState().active!.runs;
    expect(first!.restricted).toEqual(["cloud"]);
    expect(second!.restricted).toBeUndefined();
    // The second answer rests on what the first run read: the conversation still carries it.
    expect(await s.captureAnswer(second!.userTurn)).toMatchObject({ kind: "captured", inherited: ["cloud"] });
  });

  it("writes no rule where the place the note lands in keeps it back already", async () => {
    // The inbox folder itself is kept from the cloud: the folder's rule covers the new note.
    const vault = vaultOf({ notes: PRIVATE, rules: [...rules, { folder: "Inbox/", cloud: "deny" }] });
    const { s } = await session([chat({ calls: [{ id: "c1", name: "read_note", args: { path: "Private/Client.md" } }] }), chat({ text: "2,400 euros a day." })], vault, LOCAL);
    await s.send("What does Northwind pay?");
    expect(await s.captureAnswer(0)).toEqual({ kind: "captured", path: "Inbox/What does Northwind pay.md", title: "What does Northwind pay?" });
    expect(ruleOf([...vault.written.values()][0]!)).toBeUndefined();
  });

  it("takes a rule it cannot look up as one that says no", async () => {
    const vault = vaultOf({ active: "Projects/Offer 2026.md" });
    const { s } = await session([turn({ text: "1,800 euros." })], vault);
    await s.send("What does the offer say?");
    // Between the answer and the press, the note's rules can no longer be read (the file is gone, the disk is away).
    vault.unreadable.add("Projects/Offer 2026.md");
    expect(await s.captureAnswer(0)).toMatchObject({ kind: "captured", inherited: ["cloud", "web"] });
    expect(ruleOf([...vault.written.values()][0]!)).toEqual({ cloud: "deny", web: "deny" });
    // And where the place itself cannot be judged, the rules are written rather than assumed.
    const blind = vaultOf({ notes: PRIVATE, rules });
    const other = await session([chat({ calls: [{ id: "c1", name: "read_note", args: { path: "Private/Client.md" } }] }), chat({ text: "2,400 euros a day." })], blind, LOCAL);
    await other.s.send("What does Northwind pay?");
    blind.unreadable.add("Inbox/What does Northwind pay.md");
    expect(await other.s.captureAnswer(0)).toMatchObject({ kind: "captured", inherited: ["cloud"] });
  });
});

describe("skills and the internet", () => {
  const WEB = ["fetch_url", "web_search"];

  it("the research skill brings the internet's tools along where the vault allows the internet, and the overview says so", async () => {
    const vault = vaultOf({ web: { enabled: true, allow: [] } });
    const { s, fake } = await session([turn({ text: "What should I look for?" })], vault);
    expect(await s.runSkill("plainva:research", "I want to research something.")).toEqual({ kind: "answered" });
    expect(toolNames(fake.sent[0])).toEqual(expect.arrayContaining(WEB));
    // Narrowed to what the skill names: the vault's read tools it uses, the two of the web, nothing that moves the app.
    expect(toolNames(fake.sent[0]).sort()).toEqual(["fetch_url", "get_backlinks", "get_outline", "read_note", "search_vault", "web_search"]);
    const record = s.getState().active!;
    expect(record.runs[0]!.manifest).toMatchObject({ web: true });
    // The user never pressed the globe: starting this skill was the choice, for this one conversation.
    expect(s.getState().draftWeb).toBe(false);
  });

  it("has no such tools where the vault's switch is off", async () => {
    const vault = vaultOf();
    const { s, fake } = await session([turn({ text: "I cannot look anything up on the web here." })], vault);
    expect(await s.runSkill("plainva:research", "I want to research something.")).toEqual({ kind: "answered" });
    for (const name of WEB) expect(toolNames(fake.sent[0])).not.toContain(name);
    expect(s.getState().active!.runs[0]!.manifest).toMatchObject({ web: false });
  });

  it("no other skill reaches the internet, whatever the vault allows and whatever was chosen for the next conversation", async () => {
    const vault = vaultOf({ web: { enabled: true, allow: [] } });
    const { s, fake } = await session([turn({ text: "Today." }), turn({ text: "This week." })], vault);
    s.setDraftWeb(true);
    expect(await s.runSkill("plainva:daily-orientation", "What matters today?")).toEqual({ kind: "answered" });
    for (const name of WEB) expect(toolNames(fake.sent[0])).not.toContain(name);
    expect(await s.runSkill("plainva:mail-and-calendar", "What does the week hold?")).toEqual({ kind: "answered" });
    for (const name of WEB) expect(toolNames(fake.sent[1])).not.toContain(name);
    // It names the mail tools, so its conversation carries them — and the first reach for mail still asks.
    expect(toolNames(fake.sent[1])).toEqual(expect.arrayContaining(["search_mail", "read_mail", "get_calendar", "get_event"]));
  });

  it("a regression run has nobody to ask: it never reaches the internet, and mail nobody allowed in this session stays unread", async () => {
    // The vault allows the internet, and holds the note the research skill's scenario asks about.
    const vault = vaultOf({ web: { enabled: true, allow: [] }, notes: { "Projects/en/Harbour Bridge Lighting.md": "# Harbour Bridge Lighting\n\nColour temperature: 3000 K. Next step: the mock-up." } });
    const { s, fake, effects, answer } = await session(
      [
        // research / vault-first
        turn({ calls: [{ id: "c1", name: "search_vault", args: { query: "harbour bridge lighting" } }] }),
        turn({ text: "3000 K; next is the mock-up, see [[Harbour Bridge Lighting]]." }),
        // mail-and-calendar / week-ahead: it reaches for mail, gets a no nobody was asked for, and carries on with the calendar.
        turn({ calls: [{ id: "c2", name: "search_mail", args: {} }, { id: "c3", name: "get_calendar", args: { from: "2026-10-06", to: "2026-10-12" } }] }),
        turn({ text: "No appointments in the coming days." }),
      ],
      vault,
    );
    answer(() => "always");
    const outcome = await s.testSkills(["plainva:research", "plainva:mail-and-calendar"], { maxCostUsd: null });
    expect(outcome).toMatchObject({ kind: "done", ran: 2 });
    // Research, bound to its skill — and without the two tools of the web: a regression run is nobody's choice of the internet.
    expect(toolNames(fake.sent[0]).sort()).toEqual(["get_backlinks", "get_outline", "read_note", "search_vault"]);
    for (const spec of fake.sent) for (const name of WEB) expect(toolNames(spec)).not.toContain(name);
    // No question was put to anybody, although a yes was waiting.
    expect(effects).toEqual([]);
    expect(s.getState().effect).toBeNull();
    // The reach for mail was answered like a user's no — and the run went on.
    const mailRun = [...vault.saved.values()].find((record) => record.conversation.turns.some((t) => t.parts.some((p) => p.type === "tool_call" && p.name === "search_mail")))!;
    const results = mailRun.conversation.turns.flatMap((t) => t.parts.filter((p): p is ToolResultPart => p.type === "tool_result"));
    expect(results.map((r) => [r.name, r.isError === true])).toEqual([["search_mail", true], ["get_calendar", false]]);
    expect(results[0]!.content).toBe(EFFECT_DECLINED);
    expect(mailRun.runs[0]!.reading).toBeUndefined();
    expect(vault.tests().records.map((record) => record.id).sort()).toEqual(["plainva:mail-and-calendar", "plainva:research"]);
  });
});
