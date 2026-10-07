import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_AI_APP_SETTINGS,
  EFFECT_DECLINED,
  EMPTY_INSTRUCTION_APPROVALS,
  EMPTY_SKILL_TESTS,
  WRITE_REFUSALS,
  WRITE_RESULTS,
  approveInstruction,
  effectivePolicy,
  notePolicyFrom,
  parsePolicyFile,
  readConversationRecord,
  readFrontmatterPath,
  readInstructionFile,
  scanInstruction,
  scanVaultInstructions,
  type AiEgress,
  type ConversationRecord,
  type EgressChunk,
  type HttpRequestSpec,
  type InstructionApprovals,
  type InstructionIO,
  type LedgerEntry,
  type SkillTestRecords,
  type ToolResultPart,
} from "@plainva/core";
import {
  AiSession,
  CHAT_TOOL_NAMES,
  captureVocabularyOf,
  createVaultToolExecutor,
  createWriteDraftStore,
  furtherToolNames,
  noteMovePlan,
  noteRenamePlan,
  transcriptOf,
  type AiVaultHost,
  type EffectRequest,
  type OpenProposal,
  type ProposalRound,
  type VaultToolDeps,
  type VaultWriteDeps,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { memoryFiles } from "./mcpTestHost";

/**
 * The writing tools in the session (plan KI-Harness P5-2): a conversation
 * reaches them through its tool search; what a run lays down is signed with
 * its model and kept with the run; a draft waits on this device until the user
 * creates or discards it; a plan is a question above the composer.
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

/** One answer of a server on this computer, as a chat stream: text, or tool calls. */
function chat(opts: { text?: string; calls?: Array<{ id: string; name: string; args: unknown }> }): EgressChunk[] {
  const lines: unknown[] = [];
  if (opts.text) lines.push({ choices: [{ delta: { content: opts.text } }] });
  (opts.calls ?? []).forEach((call, index) => lines.push({ choices: [{ delta: { tool_calls: [{ index, id: call.id, function: { name: call.name, arguments: JSON.stringify(call.args) } }] } }] }));
  lines.push({ choices: [{ delta: {}, finish_reason: opts.calls?.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: 300, completion_tokens: 40 } });
  return [{ type: "open", status: 200 }, { type: "data", text: `${lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join("")}data: [DONE]\n\n` }, { type: "done" }];
}

/** A found tool is called through the conversation's dispatcher. */
const viaDispatch = (id: string, name: string, args: unknown = {}) => ({ id, name: "call_tool", args: { name, args } });

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

const OFFER = "# Offer\n\nThe day rate is 1,800 euros.\n";
const BRIEF = "---\nstage: open\nowner: Anna\n---\n# Brief\n\nShort.\n";
const NOTES: Record<string, string> = {
  "Projects/Offer.md": OFFER,
  "Projects/Brief.md": BRIEF,
  "Private/Client.md": "# Client\n\nPays 1,800 euros.\n",
};
const rules = parsePolicyFile("folders:\n  Private/:\n    cloud: deny\n").rules;
const WRITE_TOOLS = ["propose_edit", "set_property", "create_note", "create_task", "add_journal_entry", "rename_note", "move_note", "delete_note"];

interface Made {
  kind: "note" | "task" | "journal";
  folder?: string | null;
  stem?: string;
  content?: string;
  text?: string;
  day?: string;
  time?: string;
  task?: boolean;
  atProvider?: boolean;
}

/** A vault whose tools are the real ones, with the writing tools behind them; `skills` are files below `.agent/skills/`. */
function writeVault(options: { active?: string; skills?: Record<string, string>; sealed?: boolean; creates?: false | "failing"; proposals?: OpenProposal[]; taskList?: string } = {}) {
  const disk = new Map(Object.entries(options.skills ?? {}));
  const io: InstructionIO = {
    async list(folder) {
      const prefix = `${folder}/`;
      const names = new Map<string, boolean>();
      for (const path of disk.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        names.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0);
      }
      return [...names].map(([name, isFolder]) => ({ name, folder: isFolder }));
    },
    async read(path) {
      const text = disk.get(path);
      return text === undefined ? null : new TextEncoder().encode(text);
    },
  };
  let approvals: InstructionApprovals = EMPTY_INSTRUCTION_APPROVALS;
  let tests: SkillTestRecords = EMPTY_SKILL_TESTS;
  const saved = new Map<string, ConversationRecord>();
  let ledger: LedgerEntry[] = [];
  const proposed: ProposalRound[] = [];
  const acts: string[] = [];
  const created: Made[] = [];
  const files = memoryFiles();
  const exists = async (path: string) => NOTES[path] !== undefined;
  const policyOf = async (path: string) => effectivePolicy(path, notePolicyFrom({}), rules);
  const title = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  const note = (path: string) => (NOTES[path] === undefined ? null : { path, title: title(path), text: NOTES[path]! });
  const writes: VaultWriteDeps = {
    sealed: () => options.sealed === true,
    current: async (path) => NOTES[path] ?? null,
    propose: async (round) => void proposed.push(round),
    folderExists: async (folder) => folder === "" || Object.keys(NOTES).some((path) => path.startsWith(`${folder}/`)),
    taskVocabulary: () => captureVocabularyOf((key) => i18n.t(key), "en"),
    draftPlace: async (kind, day) => (kind === "task" ? "Tasks/task.md" : `Daily/${day}.md`),
    renamePlan: (path, name) => noteRenamePlan({ getBacklinks: async () => [] as never }, exists, path, name),
    rename: async (path, name) => {
      acts.push(`rename ${path} -> ${name}`);
      return `${path.slice(0, path.lastIndexOf("/") + 1)}${name}.md`;
    },
    movePlan: (path, folder) => noteMovePlan(exists, path, folder),
    move: async (path, folder) => {
      acts.push(`move ${path} -> ${folder}`);
      return `${folder ? `${folder}/` : ""}${path.slice(path.lastIndexOf("/") + 1)}`;
    },
    requestDelete: async (path) => {
      acts.push(`delete dialog ${path}`);
      return true;
    },
    setRule: async (path, rule, set) => {
      acts.push(`rule ${rule} ${set ? "into" : "out of"} ${path}`);
      return true;
    },
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
    activeNote: async () => (options.active ? note(options.active) : null),
    readNote: async (path) => note(path),
    async situation() {
      const active = options.active ? note(options.active) : null;
      return { now: "2026-10-07 10:00", weekday: "Wednesday", calendarDay: "2026-10-07", journalDay: "2026-10-07", active: active ? { kind: "note" as const, path: active.path, title: active.title } : null, tabs: [], tasks: [], events: [], dailyNote: null };
    },
    candidates: async () => [],
    policy: { policyOf, resolveLink: deps.resolveLink },
    tools(recipient, scope, redact, web, narrowed, foreign, writing) {
      const more = furtherToolNames(deps);
      return { names: CHAT_TOOL_NAMES, more, executor: createVaultToolExecutor(deps, { recipient, webTools: web === true }, scope, redact, { more, ...(narrowed ? { narrowed } : {}), ...(foreign ? { foreign } : {}) }, writing) };
    },
    instructions: {
      scan: () => scanVaultInstructions(io),
      scanOne: (id) => scanInstruction(io, id),
      readFile: (source, rel) => readInstructionFile(io, source, rel),
      approvals: { load: async () => approvals, save: async (value) => void (approvals = value) },
    },
    skillTests: { load: async () => tests, save: async (value) => void (tests = value) },
    drafts: createWriteDraftStore(files, "vault-a"),
    ...(options.creates === false
      ? {}
      : {
          creates: {
            async note(input) {
              if (options.creates === "failing") throw new Error("The folder is read-only.");
              created.push({ kind: "note", ...input });
              return `${input.folder ?? "Inbox"}/${input.stem}.md`;
            },
            async task(input) {
              created.push({ kind: "task", ...input });
              return "Tasks/Buy nails.md";
            },
            // The provider list the vault's task database names, where it names one.
            ...(options.taskList ? { taskList: async () => options.taskList! } : {}),
            async journal(input) {
              created.push({ kind: "journal", ...input });
              return `Daily/${input.day}.md`;
            },
            placeDenies: async (folder) => (folder === "Private" ? (["cloud"] as const) : []),
          },
        }),
    proposals: async () => options.proposals ?? [],
  };
  /** Approves a skill as it is now, as the workshop's dialog would. */
  const approve = async (id: string) => {
    approvals = approveInstruction(approvals, (await scanInstruction(io, id))!, "2026-10-07T09:00:00Z", "review");
  };
  return { host, saved, proposed, acts, created, files, approve };
}

const CLOUD = { providerId: "anthropic", model: "m-1" };
const LOCAL = { providerId: "ollama", model: "granite3.3:8b" };

async function session(script: EgressChunk[][], vault: ReturnType<typeof writeVault>, model: { providerId: string; model: string } = CLOUD) {
  const fake = fakeEgress(script);
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: ["anthropic", "ollama"], profiles: { balanced: model } };
  const s = new AiSession({
    egress: fake.egress,
    loadSettings: async () => stored,
    saveSettings: async (settings) => void (stored = settings),
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-07",
    now: () => new Date("2026-10-07T10:00:00Z"),
    newId: () => `id-${String(++ids).padStart(4, "0")}`,
    label: (key, vars) => (key === "ai.suggestionAuthor" ? `Plainva AI · ${String(vars?.model)}` : key),
  });
  // The send overview is approved as it comes; what these tests are about is what a run lays down.
  s.subscribe(() => {
    if (s.getState().consent) s.answerConsent(true);
  });
  await s.load();
  await s.attachVault(vault.host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { s, fake };
}

/** Answers every question as it comes and keeps what was asked. */
function answering(s: AiSession, answer: (effect: EffectRequest) => "once" | "always" | "deny") {
  const seen: EffectRequest[] = [];
  s.subscribe(() => {
    const effect = s.getState().effect;
    if (effect && !seen.includes(effect)) {
      seen.push(effect);
      s.answerEffect(answer(effect));
    }
  });
  return seen;
}

const body = (spec: HttpRequestSpec | undefined) => JSON.stringify(spec?.body ?? {});
const toolNames = (spec: HttpRequestSpec | undefined) => ((spec?.body?.tools ?? []) as { name?: string }[]).map((tool) => tool.name);
const results = (record: ConversationRecord) => record.conversation.turns.flatMap((t) => t.parts.filter((p): p is ToolResultPart => p.type === "tool_result"));
const CANNOT = "You cannot change notes, send anything or act outside this conversation.";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("the writing tools of a conversation", () => {
  it("are within reach through the tool search, never in the conversation's own list — and it is told what a proposal is", async () => {
    const vault = writeVault();
    const { s, fake } = await session([turn({ text: "Hello." })], vault);
    expect(await s.send("Hello?")).toEqual({ kind: "answered" });
    const record = s.getState().active!;
    expect(record.conversation.tools).toEqual([...CHAT_TOOL_NAMES, "find_tools", "call_tool", "use_skill"]);
    expect(record.conversation.more).toEqual(WRITE_TOOLS);
    expect(toolNames(fake.sent[0])).toEqual([...CHAT_TOOL_NAMES, "find_tools", "call_tool", "use_skill"]);
    expect(body(fake.sent[0])).toContain(
      "You can propose: a suggestion on a note that is there (its text or one of its properties), a draft of something new (a note, a task or a journal entry) or a plan to rename, move or delete a note.",
    );
    expect(body(fake.sent[0])).toContain("Further tools exist, for example to propose a change to the vault");
    expect(body(fake.sent[0])).not.toContain(CANNOT);
    // A run that laid nothing down keeps no record of writing.
    expect(record.runs[0]).not.toHaveProperty("writes");
  });

  it("are not offered inside an encrypted workspace: a conversation there is told that it changes nothing", async () => {
    const vault = writeVault({ sealed: true });
    const { s, fake } = await session([turn({ text: "Hello." })], vault);
    await s.send("Hello?");
    const record = s.getState().active!;
    expect(record.conversation.more ?? []).toEqual([]);
    expect(record.conversation.tools).not.toContain("call_tool");
    expect(body(fake.sent[0])).toContain(CANNOT);
  });
});

describe("a proposal of a run", () => {
  it("is laid on the note without a question — accepting it is the approval — and the run's record says where", async () => {
    const vault = writeVault({ active: "Projects/Offer.md" });
    const { s } = await session(
      [turn({ calls: [viaDispatch("c1", "propose_edit", { path: "Projects/Offer.md", edits: [{ find: "1,800 euros", replace: "1,900 euros" }], note: "New rate" })] }), turn({ text: "I proposed the new rate on [[Offer]]; it waits for you." })],
      vault,
    );
    // The run carries the open note — private and untrusted at once. A proposal still asks nothing: it changes nothing.
    const seen = answering(s, () => "deny");
    expect(await s.send("Raise the day rate to 1,900.")).toEqual({ kind: "answered" });
    expect(seen).toEqual([]);
    expect(vault.proposed).toHaveLength(1);
    expect(vault.proposed[0]).toMatchObject({ path: "Projects/Offer.md", base: OFFER, note: "New rate", author: { id: "plainva-ai/m-1", displayName: "Plainva AI · m-1" } });
    const record = s.getState().active!;
    const [result] = results(record);
    expect(result).toMatchObject({ name: "call_tool", tool: "propose_edit", content: WRITE_RESULTS.proposed("Projects/Offer.md", 1, 0) });
    expect(result!.isError).toBeFalsy();
    const writes = { rounds: [{ path: "Projects/Offer.md", blocks: 1, properties: 0 }], drafts: [], plans: [] };
    expect(record.runs[0]!.writes).toEqual(writes);
    // Kept with the conversation: opened again, the line under the answer is still there.
    expect(vault.saved.get(record.id)!.runs[0]!.writes).toEqual(writes);
    expect(transcriptOf(record).flatMap((item) => (item.kind === "steps" ? item.steps : []))).toEqual([{ id: "c1", name: "propose_edit", state: "done" }]);
    expect(s.getState().drafts).toEqual({ drafts: [], done: [] });
  });

  it("carries a value of a property the same way: the property's entry, with the hint that says which property (plan P5-3)", async () => {
    const vault = writeVault();
    const { s } = await session(
      [
        turn({ calls: [viaDispatch("c1", "set_property", { path: "Projects/Brief.md", key: "stage", value: "sent", note: "Sent today" }), viaDispatch("c2", "set_property", { path: "Projects/Brief.md", key: "effort", value: 3 })] }),
        turn({ text: "I proposed both on [[Brief]]; they wait for you." }),
      ],
      vault,
    );
    const seen = answering(s, () => "deny");
    expect(await s.send("Mark the brief as sent, effort 3.")).toEqual({ kind: "answered" });
    // A value of a property changes nothing either, so nothing is asked.
    expect(seen).toEqual([]);
    expect(vault.proposed.map((round) => ({ path: round.path, chunks: round.chunks, note: round.note, author: round.author.id }))).toEqual([
      { path: "Projects/Brief.md", chunks: [{ fromA: 4, toA: 15, replacement: "stage: sent", property: "stage" }], note: "Sent today", author: "plainva-ai/m-1" },
      // A property the note does not have yet is an entry in front of the line that closes its properties.
      { path: "Projects/Brief.md", chunks: [{ fromA: 28, toA: 28, replacement: "effort: 3\n" }], note: "", author: "plainva-ai/m-1" },
    ]);
    // Two steps of one run on one note: one round in the note's margin, the second block behind the first.
    expect(vault.proposed.map((round) => round.batch.index)).toEqual([0, 1]);
    expect(vault.proposed[1]!.batch.id).toBe(vault.proposed[0]!.batch.id);
    const record = s.getState().active!;
    const [first, second] = results(record);
    expect(first).toMatchObject({ name: "call_tool", tool: "set_property", content: WRITE_RESULTS.proposedProperty("Projects/Brief.md", "stage", false, 0) });
    expect(second).toMatchObject({ tool: "set_property", content: WRITE_RESULTS.proposedProperty("Projects/Brief.md", "effort", false, 0) });
    // The answers name the property, never the value: what was proposed is the user's to read in Plainva.
    expect(first!.content).not.toContain("sent");
    expect(record.runs[0]!.writes).toEqual({ rounds: [{ path: "Projects/Brief.md", blocks: 0, properties: 2 }], drafts: [], plans: [] });
  });

  it("is not laid where the rules of what the conversation read do not hold — a draft takes them along instead", async () => {
    const vault = writeVault();
    const { s } = await session(
      [
        chat({ calls: [{ id: "c1", name: "read_note", args: { path: "Private/Client.md" } }] }),
        chat({ calls: [viaDispatch("c2", "create_note", { title: "Client summary", content: "Pays 1,800." }), viaDispatch("c3", "propose_edit", { path: "Projects/Offer.md", append: "The client pays 1,800." })] }),
        chat({ text: "I drafted a summary." }),
      ],
      vault,
      LOCAL,
    );
    expect(await s.send("Summarise the client and note it on the offer.")).toEqual({ kind: "answered" });
    const record = s.getState().active!;
    const [, drafted, proposal] = results(record);
    // The model on this device read a note kept from the cloud. The offer is not: a round on it would carry the note out.
    expect(proposal).toMatchObject({ tool: "propose_edit", content: WRITE_REFUSALS.restricted, isError: true });
    expect(vault.proposed).toEqual([]);
    expect(drafted).toMatchObject({ tool: "create_note", content: WRITE_RESULTS.drafted('a note "Client summary"', 0) });
    const [draft] = s.getState().drafts.drafts;
    expect(draft).toMatchObject({ title: "Client summary", inherited: ["cloud"], sources: [{ resource: "Private/Client.md" }] });
    expect(record.runs[0]!.restricted).toEqual(["cloud"]);
    // Created in the inbox, the note says itself what its folder would not: kept from the cloud.
    expect(await s.createDraft(draft!.id)).toEqual({ kind: "created", path: "Inbox/Client summary.md" });
    expect(readFrontmatterPath(vault.created[0]!.content!, ["plainva", "ai", "cloud"])).toBe("deny");
  });
});

describe("a draft of a run", () => {
  it("waits on this device, signed with the model and with what the run rested on — nothing exists yet", async () => {
    const vault = writeVault({ active: "Projects/Offer.md" });
    const { s, fake } = await session([turn({ calls: [viaDispatch("c1", "create_note", { title: "Kick-off", content: "Agenda\n\n- one" })] }), turn({ text: "I drafted the note; it waits for you." })], vault);
    expect(await s.send("Draft a kick-off note for the offer.")).toEqual({ kind: "answered" });
    const record = s.getState().active!;
    const [draft] = s.getState().drafts.drafts;
    expect(draft).toEqual({
      id: expect.stringMatching(/^d-id-\d{4}$/),
      createdAt: "2026-10-07T10:00:00.000Z",
      author: { id: "plainva-ai/m-1", label: "Plainva AI · m-1" },
      conversationId: record.id,
      title: "Kick-off",
      body: { kind: "note", path: null, folder: null, content: "Agenda\n\n- one" },
      inherited: [],
      // From the run's record — the open note went along —, never from the model's words.
      sources: [{ resource: "Projects/Offer.md" }],
      defused: 0,
    });
    expect(record.runs[0]!.writes).toEqual({ rounds: [], drafts: [{ id: draft!.id, kind: "note", title: "Kick-off" }], plans: [] });
    expect(vault.created).toEqual([]);
    expect(JSON.parse(vault.files.files.get("vault-a/drafts.json")!).drafts).toHaveLength(1);

    // "Create" is the user's own step: the app makes the note, and no model is asked for anything.
    const sentBefore = fake.sent.length;
    expect(s.canCreateDrafts()).toBe(true);
    expect(await s.createDraft(draft!.id)).toEqual({ kind: "created", path: "Inbox/Kick-off.md" });
    expect(fake.sent).toHaveLength(sentBefore);
    expect(vault.created).toHaveLength(1);
    const made = vault.created[0]!;
    expect(made).toMatchObject({ kind: "note", folder: null, stem: "Kick-off" });
    expect(readFrontmatterPath(made.content!, ["generated", "by"])).toBe("plainva-ai/m-1");
    expect(readFrontmatterPath(made.content!, ["sources"])).toEqual([{ resource: "Projects/Offer.md" }]);
    expect(readFrontmatterPath(made.content!, ["plainva"])).toBeUndefined();
    expect(made.content).toContain("# Kick-off\n\nAgenda\n\n- one\n");
    // The draft is gone, and what became of it is kept for the conversation that laid it down.
    expect(s.getState().drafts).toEqual({ drafts: [], done: [{ id: draft!.id, kind: "note", title: "Kick-off", outcome: "created", path: "Inbox/Kick-off.md", at: "2026-10-07T10:00:00.000Z" }] });
    expect(await s.createDraft(draft!.id)).toEqual({ kind: "refused", reason: "gone" });
    expect(vault.created).toHaveLength(1);
  });

  it("keeps two drafts of one run both, creates a task through the app's own way and discards the other", async () => {
    const vault = writeVault();
    const { s } = await session([turn({ calls: [viaDispatch("c1", "create_task", { text: "Buy nails tomorrow" }), viaDispatch("c2", "add_journal_entry", { text: "Met Anna" })] }), turn({ text: "Both wait for you." })], vault);
    expect(await s.send("Note that I met Anna, and remind me to buy nails tomorrow.")).toEqual({ kind: "answered" });
    const [task, line] = s.getState().drafts.drafts;
    expect(task).toMatchObject({ title: "Buy nails", body: { kind: "task", text: "Buy nails tomorrow", day: "2026-10-07" } });
    // The time is the clock of this device, as the journal writes it.
    expect(line).toMatchObject({ title: "Met Anna", body: { kind: "journal", text: "Met Anna", day: "2026-10-07", time: expect.stringMatching(/^\d{2}:00$/), task: false } });
    expect(s.getState().active!.runs[0]!.writes!.drafts).toEqual([
      { id: task!.id, kind: "task", title: "Buy nails" },
      { id: line!.id, kind: "journal", title: "Met Anna" },
    ]);
    // The task is read from its words with the day it was drafted on as "today" — whenever it is created.
    expect(await s.createDraft(task!.id)).toEqual({ kind: "created", path: "Tasks/Buy nails.md" });
    // Nothing said about a provider list: the task stays in the vault.
    expect(vault.created).toEqual([{ kind: "task", text: "Buy nails tomorrow", day: "2026-10-07", atProvider: false }]);
    expect(await s.draftTaskList()).toBeNull();
    await s.discardDraft(line!.id);
    expect(s.getState().drafts).toEqual({
      drafts: [],
      done: [
        { id: task!.id, kind: "task", title: "Buy nails", outcome: "created", path: "Tasks/Buy nails.md", at: "2026-10-07T10:00:00.000Z" },
        { id: line!.id, kind: "journal", title: "Met Anna", outcome: "discarded", at: "2026-10-07T10:00:00.000Z" },
      ],
    });
    expect(vault.created).toHaveLength(1);
    // Kept on this device: a session that opens the vault again finds what waited and what became of it.
    const again = await session([], vault);
    expect(again.s.getState().drafts.done.map((outcome) => outcome.outcome)).toEqual(["created", "discarded"]);
  });

  it("sends a task to its provider list only where the user left that on, on the card", async () => {
    const drafted = () => [turn({ calls: [viaDispatch("c1", "create_task", { text: "Buy nails" })] }), turn({ text: "Drafted." })];
    const vault = writeVault({ taskList: "Errands" });
    const { s } = await session([...drafted(), ...drafted()], vault);
    // The card asks with the list's name, as the capture field does.
    expect(await s.draftTaskList()).toBe("Errands");
    await s.send("Remind me to buy nails.");
    await s.createDraft(s.getState().drafts.drafts[0]!.id, { atProvider: true });
    await s.send("And once more.");
    await s.createDraft(s.getState().drafts.drafts[0]!.id, { atProvider: false });
    expect(vault.created.map((made) => made.atProvider)).toEqual([true, false]);
    // A list that cannot be named is no list: nothing is offered, and nothing fails.
    const broken = writeVault({ taskList: "Errands" });
    broken.host.creates!.taskList = async () => {
      throw new Error("accounts unreadable");
    };
    expect(await (await session([], broken)).s.draftTaskList()).toBeNull();
  });

  it("stays a draft when it cannot be created — and says why, or that this device cannot", async () => {
    const failing = writeVault({ creates: "failing" });
    const first = await session([turn({ calls: [viaDispatch("c1", "create_note", { title: "Kick-off", content: "Agenda" })] }), turn({ text: "Drafted." })], failing);
    await first.s.send("Draft a kick-off note.");
    const [draft] = first.s.getState().drafts.drafts;
    expect(await first.s.createDraft(draft!.id)).toEqual({ kind: "refused", reason: "failed", message: "The folder is read-only." });
    expect(first.s.getState().drafts.drafts.map((item) => item.id)).toEqual([draft!.id]);
    expect(first.s.getState().drafts.done).toEqual([]);

    const without = writeVault({ creates: false });
    const second = await session([turn({ calls: [viaDispatch("c1", "create_note", { title: "Kick-off", content: "Agenda" })] }), turn({ text: "Drafted." })], without);
    await second.s.send("Draft a kick-off note.");
    expect(second.s.canCreateDrafts()).toBe(false);
    expect(await second.s.createDraft(second.s.getState().drafts.drafts[0]!.id)).toEqual({ kind: "refused", reason: "unavailable" });
    expect(second.s.getState().drafts.drafts).toHaveLength(1);
  });
});

describe("a plan of a run", () => {
  const rename = () => [turn({ calls: [viaDispatch("c1", "rename_note", { path: "Projects/Offer.md", title: "Offer 2027" })] }), turn({ text: "Done as you decided." })];

  it("is a question above the composer with what it would do; after the yes the app does it", async () => {
    const vault = writeVault();
    const { s } = await session(rename(), vault);
    const seen = answering(s, () => "once");
    expect(await s.send("Rename the offer to Offer 2027.")).toEqual({ kind: "answered" });
    expect(seen).toEqual([{ id: "c1", kind: "plan", question: { plan: "rename", path: "Projects/Offer.md", title: "Offer 2027", target: "Projects/Offer 2027.md", files: [], links: 0 } }]);
    expect(vault.acts).toEqual(["rename Projects/Offer.md -> Offer 2027"]);
    const record = s.getState().active!;
    expect(results(record)[0]).toMatchObject({ tool: "rename_note", content: WRITE_RESULTS.renamed("Projects/Offer 2027.md") });
    expect(record.runs[0]!.writes).toEqual({ rounds: [], drafts: [], plans: [{ kind: "rename", path: "Projects/Offer.md", outcome: "done" }] });
    expect(s.getState().effect).toBeNull();
  });

  it("does nothing after a no, and shows the step as declined", async () => {
    const vault = writeVault();
    const { s } = await session(rename(), vault);
    answering(s, () => "deny");
    expect(await s.send("Rename the offer to Offer 2027.")).toEqual({ kind: "answered" });
    expect(vault.acts).toEqual([]);
    const record = s.getState().active!;
    expect(results(record)[0]).toMatchObject({ tool: "rename_note", content: EFFECT_DECLINED, isError: true });
    expect(transcriptOf(record).flatMap((item) => (item.kind === "steps" ? item.steps : []))).toEqual([{ id: "c1", name: "rename_note", state: "declined" }]);
    expect(record.runs[0]!.writes!.plans).toEqual([{ kind: "rename", path: "Projects/Offer.md", outcome: "declined" }]);
  });

  it("asks before the app's delete dialog opens, and that dialog decides", async () => {
    const vault = writeVault();
    const { s } = await session([turn({ calls: [viaDispatch("c1", "delete_note", { path: "Projects/Offer.md" })] }), turn({ text: "You deleted it." })], vault);
    const seen = answering(s, () => "once");
    await s.send("Delete the offer.");
    expect(seen).toEqual([{ id: "c1", kind: "plan", question: { plan: "delete", path: "Projects/Offer.md" } }]);
    expect(vault.acts).toEqual(["delete dialog Projects/Offer.md"]);
    expect(results(s.getState().active!)[0]).toMatchObject({ tool: "delete_note", content: WRITE_RESULTS.deleted });
  });

  it("asks the same way before one of a note's own AI rules is written: a rule is never a suggestion (plan P5-3)", async () => {
    const rule = () => [turn({ calls: [viaDispatch("c1", "set_property", { path: "Projects/Brief.md", key: "plainva.ai.cloud", value: "deny" })] }), turn({ text: "Done as you decided." })];
    const vault = writeVault();
    const { s } = await session(rule(), vault);
    const seen = answering(s, () => "once");
    expect(await s.send("Keep the brief away from cloud models.")).toEqual({ kind: "answered" });
    expect(seen).toEqual([{ id: "c1", kind: "plan", question: { plan: "rule", path: "Projects/Brief.md", rule: "cloud", set: true } }]);
    expect(vault.acts).toEqual(["rule cloud into Projects/Brief.md"]);
    expect(vault.proposed).toEqual([]);
    const record = s.getState().active!;
    expect(results(record)[0]).toMatchObject({ tool: "set_property", content: WRITE_RESULTS.ruleSet("Projects/Brief.md", true) });
    expect(record.runs[0]!.writes).toEqual({ rounds: [], drafts: [], plans: [{ kind: "rule", path: "Projects/Brief.md", outcome: "done" }] });

    const untouched = writeVault();
    const second = await session(rule(), untouched);
    answering(second.s, () => "deny");
    await second.s.send("Keep the brief away from cloud models.");
    expect(untouched.acts).toEqual([]);
    expect(results(second.s.getState().active!)[0]).toMatchObject({ tool: "set_property", content: EFFECT_DECLINED, isError: true });
    expect(transcriptOf(second.s.getState().active!).flatMap((item) => (item.kind === "steps" ? item.steps : []))).toEqual([{ id: "c1", name: "set_property", state: "declined" }]);
  });
});

describe("a skill and the writing tools", () => {
  const TIDY = ".agent/skills/tidy-up";
  const skill = (tools: string) => `---\nname: tidy-up\ndescription: Tidies a note.\n${tools}---\n\nTidy the note the user names.\n`;
  const proposes = () => [turn({ calls: [{ id: "c1", name: "propose_edit", args: { path: "Projects/Offer.md", append: "Checked." } }] }), turn({ text: "I proposed a line; it waits for you." })];

  it("has them only by naming them — then its conversation carries them itself and is told what a proposal is", async () => {
    const vault = writeVault({ skills: { [`${TIDY}/SKILL.md`]: skill("allowed-tools: read_note propose_edit rename_note\n") } });
    await vault.approve(TIDY);
    const { s, fake } = await session(proposes(), vault);
    expect(await s.runSkill(TIDY, "Tidy the offer.")).toEqual({ kind: "answered" });
    const record = s.getState().active!;
    expect(record.conversation.tools).toEqual(["read_note", "propose_edit", "rename_note"]);
    expect(record.conversation.more).toBeUndefined();
    expect(body(fake.sent[0])).toContain("You can propose: a suggestion on a note that is there (its text) or a plan to rename a note.");
    expect(body(fake.sent[0])).not.toContain(CANNOT);
    expect(vault.proposed.map((round) => round.path)).toEqual(["Projects/Offer.md"]);
    expect(record.runs[0]!.writes!.rounds).toEqual([{ path: "Projects/Offer.md", blocks: 1, properties: 0 }]);
  });

  it("gains none by naming nothing: what was approved before there were such tools still changes nothing", async () => {
    const vault = writeVault({ skills: { [`${TIDY}/SKILL.md`]: skill("") } });
    await vault.approve(TIDY);
    const { s, fake } = await session([turn({ text: "The offer looks tidy." })], vault);
    expect(await s.runSkill(TIDY, "Tidy the offer.")).toEqual({ kind: "answered" });
    const record = s.getState().active!;
    for (const name of WRITE_TOOLS) expect(record.conversation.tools, name).not.toContain(name);
    expect(body(fake.sent[0])).toContain(CANNOT);
  });

  it("lays nothing down in a regression run: nobody is there to decide about it", async () => {
    const scenarios = JSON.stringify({ version: 1, scenarios: [{ id: "tidy", message: "Tidy the offer." }] });
    const vault = writeVault({ skills: { [`${TIDY}/SKILL.md`]: skill("allowed-tools: read_note propose_edit create_note\n"), [`${TIDY}/tests/scenarios.json`]: scenarios } });
    await vault.approve(TIDY);
    const { s } = await session([turn({ calls: [{ id: "c1", name: "propose_edit", args: { path: "Projects/Offer.md", append: "Checked." } }, { id: "c2", name: "create_note", args: { title: "Kick-off", content: "Agenda" } }] }), turn({ text: "Nothing could be laid down." })], vault);
    expect(await s.testSkills([TIDY], { maxCostUsd: null })).toMatchObject({ kind: "done", ran: 1 });
    expect(vault.proposed).toEqual([]);
    expect(s.getState().drafts).toEqual({ drafts: [], done: [] });
    expect(vault.files.files.has("vault-a/drafts.json")).toBe(false);
    const [scenario] = [...vault.saved.values()];
    const refusals = results(scenario!);
    expect(refusals).toHaveLength(2);
    for (const refusal of refusals) {
      expect(refusal.isError).toBe(true);
      expect([WRITE_REFUSALS.nobody, EFFECT_DECLINED]).toContain(refusal.content);
    }
    expect(scenario!.runs[0]).not.toHaveProperty("writes");
  });
});

describe("what waits for the user", () => {
  it("names the notes that carry a machine's proposals as the shell lists them — and nothing where it cannot", async () => {
    const waiting: OpenProposal[] = [{ path: "Projects/Offer.md", authorId: "plainva-ai/m-1", changes: 2, at: "2026-10-07T09:05:00.000Z" }];
    const { s } = await session([], writeVault({ proposals: waiting }));
    expect(await s.openProposals()).toEqual(waiting);
    const none = writeVault();
    delete (none.host as { proposals?: unknown }).proposals;
    expect(await (await session([], none)).s.openProposals()).toEqual([]);
    const broken = writeVault();
    broken.host.proposals = async () => {
      throw new Error("comments unreadable");
    };
    expect(await (await session([], broken)).s.openProposals()).toEqual([]);
  });
});
