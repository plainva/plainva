import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_APP_SETTINGS, WRITE_REFUSALS, WRITE_RESULTS, effectivePolicy, notePolicyFrom, parsePolicyFile, toolsFor, type AiEgress } from "@plainva/core";
import {
  AiSession,
  CHAT_TOOL_NAMES,
  captureVocabularyOf,
  createVaultToolExecutor,
  createWriteDraftStore,
  furtherToolNames,
  noteMovePlan,
  noteRenamePlan,
  type AiVaultHost,
  type PlanQuestion,
  type ProposalRound,
  type VaultToolDeps,
  type VaultWriteDeps,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { memoryFiles } from "./mcpTestHost";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { MCP_NOT_WAITING, MCP_OPEN_PROPOSALS_MAX, MCP_PLAN_CHANGED, MCP_TOO_MANY_WAITING, mcpToolSpecs, quietLeft, runMcpCall } = await import("../services/ai/mcpBridge");
const { MCP_PLAN_TTL_MS, McpPlans, samePlan } = await import("../services/ai/mcpPlans");
type Plans = InstanceType<typeof McpPlans>;
type CallRequest = Parameters<typeof runMcpCall>[1];

/**
 * Plainva's MCP server, stage 2 (plan KI-Harness §17.3, P5-5): a program the
 * user allowed to propose changes reaches six tools that write — played here
 * against the real session, the real writing tools and the real list of
 * drafts. None of them changes the vault: a suggestion on a note, a draft, or
 * a plan that is carried out only when the program comes back for it AND the
 * user said yes in Plainva to what they were shown.
 */

const OFFER = "# Offer\n\nThe day rate is 1,800 euros.\n";
const BRIEF = "---\nstage: open\n---\n# Brief\n\nShort.\n";
const rules = parsePolicyFile("folders:\n  Projects/Kept/:\n    cloud: deny\n  Projects/Offline/:\n    web: deny\n").rules;

function mcpVault(options: { sealed?: boolean; deletes?: boolean } = {}) {
  const notes: Record<string, string> = {
    "Projects/Offer.md": OFFER,
    "Projects/Brief.md": BRIEF,
    "Projects/Kept/Salaries.md": "# Salaries\n\nNever to a cloud.\n",
    "Projects/Offline/Diary.md": "# Diary\n\nNever with the internet.\n",
    "Projects/Sub/Other.md": "# Other\n",
    "Archive/Old.md": "# Old\n\nSee [[Offer]].\n",
    "Private/Client.md": "# Client\n",
  };
  /** Who links to the offer — one of them outside the folders the program reads. */
  const links = [
    { source_path: "Archive/Old.md", target_path: "Offer", property_key: null },
    { source_path: "Projects/Brief.md", target_path: "Offer", property_key: null },
  ];
  const proposed: ProposalRound[] = [];
  const acts: string[] = [];
  const files = memoryFiles();
  const exists = async (path: string) => notes[path] !== undefined;
  const policyOf = async (path: string) => effectivePolicy(path, notePolicyFrom({}), rules);
  const writes: VaultWriteDeps = {
    sealed: () => options.sealed === true,
    current: async (path) => notes[path] ?? null,
    propose: async (round) => void proposed.push(round),
    folderExists: async (folder) => folder === "" || Object.keys(notes).some((path) => path.startsWith(`${folder}/`)),
    taskVocabulary: () => captureVocabularyOf((key) => i18n.t(key), "en"),
    draftPlace: async () => null,
    renamePlan: (path, title) => noteRenamePlan({ getBacklinks: async () => (path === "Projects/Offer.md" ? links : []) as never }, exists, path, title),
    rename: async (path, title) => {
      acts.push(`rename ${path} -> ${title}`);
      return `${path.slice(0, path.lastIndexOf("/") + 1)}${title}.md`;
    },
    movePlan: (path, folder) => noteMovePlan(exists, path, folder),
    move: async (path, folder) => {
      acts.push(`move ${path} -> ${folder || "(vault)"}`);
      return `${folder ? `${folder}/` : ""}${path.slice(path.lastIndexOf("/") + 1)}`;
    },
    requestDelete: async (path) => {
      acts.push(`delete dialog ${path}`);
      return options.deletes !== false;
    },
    setRule: async (path, rule, set) => {
      acts.push(`rule ${rule} ${set ? "into" : "out of"} ${path}`);
      return true;
    },
    entryPlace: async () => null,
  };
  const deps: VaultToolDeps = {
    search: async () => [],
    readNote: async (path) => notes[path] ?? null,
    resolveLink: async () => null,
    policyOf,
    taskRows: async () => [],
    todayKey: () => "2026-10-07",
    commands: () => [],
    writes,
  };
  /** How every call reached the gate: an outside program is a cloud that may reach the internet. */
  const gates: { kind: string; web: boolean }[] = [];
  const host = {
    conversations: { list: async () => [], load: async () => null, save: async () => undefined, remove: async () => undefined, removeAll: async () => undefined },
    ledger: { load: async () => [], save: async () => undefined },
    activeNote: async () => null,
    readNote: async () => null,
    candidates: async () => [],
    policy: { policyOf, resolveLink: deps.resolveLink },
    tools(recipient, scope, redact, web, narrowed, foreign, writing) {
      gates.push({ kind: recipient.kind, web: web === true });
      const more = furtherToolNames(deps);
      return { names: CHAT_TOOL_NAMES, more, executor: createVaultToolExecutor(deps, { recipient, webTools: web === true }, scope, redact, { more, ...(narrowed ? { narrowed } : {}), ...(foreign ? { foreign } : {}) }, writing) };
    },
    drafts: createWriteDraftStore(files, "vault-a"),
  } as Partial<AiVaultHost> as AiVaultHost;
  return { host, notes, links, proposed, acts, gates };
}

async function session(host: AiVaultHost) {
  let ids = 0;
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true };
  const egress: AiEgress = { async send() {}, async cancel() {}, async setKey() {}, hasKey: async () => true, async deleteKey() {}, addEndpoint: async () => true, async removeEndpoint() {} };
  const s = new AiSession({
    egress,
    loadSettings: async () => stored,
    saveSettings: async (settings) => void (stored = settings),
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-10-07",
    now: () => new Date("2026-10-07T10:00:00Z"),
    newId: () => `id-${String(++ids).padStart(4, "0")}`,
  });
  await s.load();
  await s.attachVault(host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return s;
}

/** The main window as a paired program sees it: the vault, the session, the plans — and what the user was told. */
async function window(options: Parameters<typeof mcpVault>[0] = {}) {
  const vault = mcpVault(options);
  const s = await session(vault.host);
  const plans = new McpPlans();
  const left: unknown[] = [];
  let n = 0;
  const call = (tool: string, args: unknown, over: Partial<CallRequest> = {}, waitMs = 10) =>
    runMcpCall(vault.host, { requestId: `r${++n}`, clientId: "c1", client: "Test client", tool, args, folders: ["Projects"], writes: true, ...over }, { session: s, plans, left: (what) => void left.push(what), waitMs });
  return { ...vault, s, plans, left, call };
}

const refused = (reason: keyof typeof WRITE_REFUSALS) => ({ content: WRITE_REFUSALS[reason], isError: true, paths: [] as string[] });
const NO_NOTE = { content: WRITE_REFUSALS["no-note"], isError: true, paths: [] as string[] };

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the tools Plainva's MCP server serves", () => {
  it("every tool says what a call can do, and only a deletion takes something away", () => {
    const specs = mcpToolSpecs();
    expect(specs.map((spec) => spec.name)).toEqual(toolsFor("mcp").map((tool) => tool.name));
    const kinds = (kind: string) => specs.filter((spec) => spec.kind === kind).map((spec) => spec.name);
    expect(kinds("propose")).toEqual(["propose_edit", "set_property", "create_note"]);
    expect(kinds("plan")).toEqual(["rename_note", "move_note", "delete_note"]);
    // Whatever is no proposal and no plan reads, or shows a note in the app.
    expect(toolsFor("mcp").filter((tool) => tool.risk !== "read" && tool.risk !== "ui").map((tool) => tool.name)).toEqual([...kinds("propose"), ...kinds("plan")]);
    expect(specs.filter((spec) => spec.destructive).map((spec) => spec.name)).toEqual(["delete_note"]);
    // The places a call names are checked natively before it gets here.
    expect(specs.find((spec) => spec.name === "propose_edit")!.pathArgs).toEqual(["path"]);
    expect(specs.find((spec) => spec.name === "create_note")!.pathArgs).toEqual(["folder"]);
    expect(specs.find((spec) => spec.name === "move_note")!.pathArgs).toEqual(["path", "folder"]);
  });
});

describe("a program the user allowed to propose changes", () => {
  it("without the grant a tool that writes is no tool of the program — in the words of one that does not exist", async () => {
    const w = await window();
    const none = { content: "There is no tool called propose_edit.", isError: true, paths: [] };
    const edit = { path: "Projects/Offer.md", edits: [{ find: "1,800 euros", replace: "1,900 euros" }] };
    expect(await w.call("propose_edit", edit, { writes: false })).toEqual(none);
    expect(await w.call("propose_edit", edit, { writes: undefined })).toEqual(none);
    // A window that brings nothing to write with serves none either.
    expect(await runMcpCall(w.host, { requestId: "r", clientId: "c1", client: "Test client", tool: "propose_edit", args: edit, folders: ["Projects"], writes: true })).toEqual(none);
    expect(await w.call("rename_note", { path: "Projects/Offer.md", title: "Offer 2027" }, { writes: false })).toEqual({ ...none, content: "There is no tool called rename_note." });
    expect(w.proposed).toEqual([]);
    expect(w.plans.current()).toBeNull();
  });

  it("a change is a suggestion on the note, signed with the program's id and the name the user paired it under", async () => {
    const w = await window();
    const out = await w.call("propose_edit", { path: "Projects/Offer.md", edits: [{ find: "1,800 euros", replace: "1,900 euros" }], note: "Raise the rate" });
    expect(out).toEqual({ content: WRITE_RESULTS.proposed("Projects/Offer.md", 1, 0), isError: false, paths: ["Projects/Offer.md"] });
    expect(w.proposed).toHaveLength(1);
    expect(w.proposed[0]).toMatchObject({ path: "Projects/Offer.md", base: OFFER, note: "Raise the rate", author: { id: "mcp:c1", displayName: "Test client (AI app)" } });
    // Nothing in the vault changed, and the user hears of it once — the note, never the text.
    expect(w.acts).toEqual([]);
    expect(w.notes["Projects/Offer.md"]).toBe(OFFER);
    expect(w.left).toEqual([{ kind: "proposal", client: "Test client", path: "Projects/Offer.md" }]);
    expect(JSON.stringify(w.left)).not.toContain("1,900");
  });

  it("an address the program brings is written inert: nothing the user typed is known here", async () => {
    const w = await window();
    const out = await w.call("propose_edit", { path: "Projects/Offer.md", append: "More at https://offers.example/rates?x=1,800" });
    expect(out.content).toBe(WRITE_RESULTS.proposed("Projects/Offer.md", 1, 1));
    expect(w.proposed[0]!.chunks.map((chunk) => chunk.replacement).join("")).not.toMatch(/\]\(https?:|<https?:/);
  });

  it("a property's value is a suggestion; one of the note's own AI rules is nobody's to set from outside", async () => {
    const w = await window();
    const value = await w.call("set_property", { path: "Projects/Brief.md", key: "stage", value: "won" });
    expect(value).toEqual({ content: WRITE_RESULTS.proposedProperty("Projects/Brief.md", "stage", false, 0), isError: false, paths: ["Projects/Brief.md"] });
    expect(w.proposed).toHaveLength(1);
    const rule = await w.call("set_property", { path: "Projects/Brief.md", key: "plainva.ai.cloud", value: "deny" });
    expect(rule).toEqual({ ...refused("nobody"), paths: ["Projects/Brief.md"] });
    // Not asked in Plainva either: no program sets, or lifts, a rule about itself.
    expect(w.plans.current()).toBeNull();
    expect(w.acts).toEqual([]);
    expect(w.proposed).toHaveLength(1);
  });

  it("something new is a draft on this device: no conversation, no sources, the program as its author", async () => {
    const w = await window();
    const out = await w.call("create_note", { title: "Follow-up", folder: "Projects", content: "Call on Monday." });
    expect(out).toEqual({ content: WRITE_RESULTS.drafted('a note "Follow-up"', 0), isError: false, paths: [] });
    const drafts = w.s.getState().drafts.drafts;
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      author: { id: "mcp:c1", label: "Test client (AI app)" },
      conversationId: null,
      title: "Follow-up",
      body: { kind: "note", folder: "Projects", content: "Call on Monday." },
      inherited: [],
      sources: [],
    });
    expect(w.left).toEqual([{ kind: "draft", client: "Test client" }]);
    // A folder outside the program's own is no place it can name.
    expect(await w.call("create_note", { title: "Elsewhere", folder: "Private", content: "x" })).toEqual(refused("no-folder"));
    expect(w.s.getState().drafts.drafts).toHaveLength(1);
  });

  it("is at the gate a cloud that may reach the internet: a note under either rule does not exist for it", async () => {
    const w = await window();
    for (const path of ["Projects/Kept/Salaries.md", "Projects/Offline/Diary.md", "Private/Client.md", "Projects/Nowhere.md"]) {
      expect(await w.call("propose_edit", { path, append: "x" }), path).toEqual(NO_NOTE);
      const read = await w.call("read_note", { path, maxChars: 4000 });
      expect(read.isError, path).toBe(true);
      expect(read.paths, path).toEqual([]);
      expect(await w.call("rename_note", { path, title: "Renamed" }), path).toEqual(NO_NOTE);
    }
    expect(w.gates.every((gate) => gate.kind === "cloud" && gate.web)).toBe(true);
    expect(w.proposed).toEqual([]);
    expect(w.plans.current()).toBeNull();
    // What it can read carries no rule, so the place of a proposal can lack none.
    expect((await w.call("read_note", { path: "Projects/Offer.md", maxChars: 4000 })).isError).toBe(false);
  });

  it("an app whose suggestions pile up is told that the user has to decide first — as a full list of drafts tells its writer", async () => {
    const w = await window();
    const at = "2026-10-07T09:00:00.000Z";
    const waiting = [
      { path: "Projects/Brief.md", authorId: "mcp:c1", changes: MCP_OPEN_PROPOSALS_MAX - 1, at },
      // Another writer's suggestions are not this app's.
      { path: "Projects/Brief.md", authorId: "mcp:c2", changes: 5_000, at },
      { path: "Projects/Offer.md", authorId: "plainva-ai/m-1", changes: 5_000, at },
    ];
    w.host.proposals = async () => waiting;
    expect((await w.call("propose_edit", { path: "Projects/Offer.md", append: "one more" })).isError).toBe(false);
    waiting[0]!.changes = MCP_OPEN_PROPOSALS_MAX;
    const full = { content: MCP_TOO_MANY_WAITING, isError: true, paths: [] };
    expect(await w.call("propose_edit", { path: "Projects/Offer.md", append: "too many" })).toEqual(full);
    expect(await w.call("set_property", { path: "Projects/Brief.md", key: "stage", value: "won" })).toEqual(full);
    expect(w.proposed).toHaveLength(1);
    // A draft has its own list, which says when it is full; and reading is never counted.
    expect((await w.call("create_note", { title: "Still fine", content: "x" })).isError).toBe(false);
    expect((await w.call("read_note", { path: "Projects/Offer.md", maxChars: 4000 })).isError).toBe(false);
  });

  it("what an app left is said once per note and minute, not once per call", () => {
    let now = 1_000;
    const said: unknown[] = [];
    const left = quietLeft((what) => void said.push(what), () => now);
    const offer = { kind: "proposal" as const, client: "A", path: "Projects/Offer.md" };
    left(offer);
    left(offer);
    left({ ...offer, path: "Projects/Brief.md" });
    left({ kind: "draft", client: "A" });
    left({ kind: "draft", client: "A" });
    left({ ...offer, client: "B" });
    expect(said).toEqual([offer, { ...offer, path: "Projects/Brief.md" }, { kind: "draft", client: "A" }, { ...offer, client: "B" }]);
    now += 59_000;
    left(offer);
    expect(said).toHaveLength(4);
    now += 2_000;
    left(offer);
    expect(said).toHaveLength(5);
  });

  it("in an encrypted workspace nothing is proposed, drafted or planned", async () => {
    const w = await window({ sealed: true });
    expect(await w.call("propose_edit", { path: "Projects/Offer.md", append: "x" })).toEqual(refused("sealed"));
    expect(await w.call("create_note", { title: "T", content: "x" })).toEqual(refused("sealed"));
    expect(await w.call("rename_note", { path: "Projects/Offer.md", title: "Offer 2027" })).toEqual(refused("sealed"));
    expect(w.plans.current()).toBeNull();
  });
});

describe("a rename, a move or a deletion goes by the round trip", () => {
  const RENAME = { path: "Projects/Offer.md", title: "Offer 2027" };
  const renamed = { content: WRITE_RESULTS.renamed("Projects/Offer 2027.md"), isError: false, paths: ["Projects/Offer.md", "Projects/Offer 2027.md"] };

  it("the first call only lays the plan before the user, and tells the program what it named itself", async () => {
    const w = await window();
    const first = await w.call("rename_note", RENAME);
    expect(first.isError).toBe(false);
    expect(first.content).toBe("");
    expect(first.paths).toEqual(["Projects/Offer.md"]);
    const plan = w.plans.current()!;
    expect(first.pending).toEqual({ handle: plan.handle, message: "Plainva is asking in its window whether to rename “Projects/Offer” to “Offer 2027”. Answer there, then continue here." });
    expect(plan.handle).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    // The user reads who links here — also from outside the program's folders. The program does not.
    expect(plan).toMatchObject({ clientId: "c1", client: "Test client", tool: "rename_note", decision: null });
    expect(plan.question).toMatchObject({ plan: "rename", path: "Projects/Offer.md", title: "Offer 2027", target: "Projects/Offer 2027.md", links: 2 });
    expect((plan.question as Extract<PlanQuestion, { plan: "rename" }>).files.map((file) => file.path).sort()).toEqual(["Archive/Old.md", "Projects/Brief.md"]);
    expect(JSON.stringify(first)).not.toMatch(/Archive|Brief|links/);
    expect(w.acts).toEqual([]);
  });

  it("is carried out when the program comes back with its user's yes after a yes in Plainva — once", async () => {
    const w = await window();
    const handle = (await w.call("rename_note", RENAME)).pending!.handle;
    w.plans.decide(handle, "yes");
    expect(w.plans.current()).toBeNull();
    expect(w.acts).toEqual([]);
    expect(await w.call("rename_note", RENAME, { handle, answer: "accept" })).toEqual(renamed);
    expect(w.acts).toEqual(["rename Projects/Offer.md -> Offer 2027"]);
    // The handle is used up.
    expect(await w.call("rename_note", RENAME, { handle, answer: "accept" })).toEqual({ content: MCP_NOT_WAITING, isError: true, paths: [] });
    expect(w.acts).toHaveLength(1);
  });

  it("a program that comes back before the user answered is told again, and nothing is done", async () => {
    const w = await window();
    const handle = (await w.call("rename_note", RENAME)).pending!.handle;
    const again = await w.call("rename_note", RENAME, { handle, answer: "accept" });
    expect(again).toEqual({ content: "", isError: false, paths: [], pending: { handle, message: expect.stringMatching(/^Plainva is still waiting for your answer\. Plainva is asking/) } });
    expect(w.acts).toEqual([]);
    expect(w.plans.current()!.handle).toBe(handle);
    // The answer arrives while the program waits: the same call carries the plan out.
    const waiting = w.call("rename_note", RENAME, { handle, answer: "accept" }, 2_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    w.plans.decide(handle, "yes");
    expect(await waiting).toEqual(renamed);
    expect(w.acts).toEqual(["rename Projects/Offer.md -> Offer 2027"]);
  });

  it("a no — in Plainva or in the program — ends the plan, and the record says declined", async () => {
    const declined = { content: WRITE_REFUSALS.declined, isError: true, paths: [], declined: true };
    const w = await window();
    const first = (await w.call("rename_note", RENAME)).pending!.handle;
    w.plans.decide(first, "no");
    expect(await w.call("rename_note", RENAME, { handle: first, answer: "accept" })).toEqual(declined);
    // The program's own user said no: the question in Plainva goes away with it.
    const second = (await w.call("rename_note", RENAME)).pending!.handle;
    expect(w.plans.current()!.handle).toBe(second);
    expect(await w.call("rename_note", RENAME, { handle: second, answer: "decline" })).toEqual(declined);
    expect(w.plans.current()).toBeNull();
    // A yes that comes after the program gave up carries nothing out.
    w.plans.decide(second, "yes");
    expect(await w.call("rename_note", RENAME, { handle: second, answer: "accept" })).toEqual({ content: MCP_NOT_WAITING, isError: true, paths: [] });
    expect(w.acts).toEqual([]);
  });

  it("a handle is a pass for the very call it was given for, and for no other", async () => {
    const w = await window();
    const handle = (await w.call("rename_note", RENAME)).pending!.handle;
    w.plans.decide(handle, "yes");
    const gone = { content: MCP_NOT_WAITING, isError: true, paths: [] };
    expect(await w.call("rename_note", { ...RENAME, title: "Something else" }, { handle, answer: "accept" })).toEqual(gone);
    expect(await w.call("rename_note", { path: "Projects/Brief.md", title: "Offer 2027" }, { handle, answer: "accept" })).toEqual(gone);
    expect(await w.call("delete_note", { path: "Projects/Offer.md" }, { handle, answer: "accept" })).toEqual(gone);
    expect(await w.call("rename_note", RENAME, { handle, answer: "accept", clientId: "c2" })).toEqual(gone);
    expect(await w.call("rename_note", RENAME, { handle: "0000000000000000", answer: "accept" })).toEqual(gone);
    expect(w.acts).toEqual([]);
    // The right call still finds its plan.
    expect(await w.call("rename_note", RENAME, { handle, answer: "accept" })).toEqual(renamed);
  });

  it("a yes holds for what the user was shown: a plan that would do more now is not carried out", async () => {
    const w = await window();
    const handle = (await w.call("rename_note", RENAME)).pending!.handle;
    w.plans.decide(handle, "yes");
    // Another note links to the offer since: the rename would change one note more than the user saw.
    w.links.push({ source_path: "Projects/Sub/Other.md", target_path: "Offer", property_key: null });
    expect(await w.call("rename_note", RENAME, { handle, answer: "accept" })).toEqual({ content: MCP_PLAN_CHANGED, isError: true, paths: [] });
    expect(w.acts).toEqual([]);
    expect(w.plans.current()).toBeNull();
  });

  it("a program has one plan waiting: a newer one takes the older one's place", async () => {
    const w = await window();
    const older = (await w.call("rename_note", RENAME)).pending!.handle;
    const newer = (await w.call("move_note", { path: "Projects/Offer.md", folder: "Projects/Sub" })).pending!;
    expect(newer.message).toBe("Plainva is asking in its window whether to move “Projects/Offer” to the folder “Projects/Sub”. Answer there, then continue here.");
    expect(w.plans.current()!.handle).toBe(newer.handle);
    w.plans.decide(older, "yes");
    expect(await w.call("rename_note", RENAME, { handle: older, answer: "accept" })).toEqual({ content: MCP_NOT_WAITING, isError: true, paths: [] });
    w.plans.decide(newer.handle, "yes");
    expect(await w.call("move_note", { path: "Projects/Offer.md", folder: "Projects/Sub" }, { handle: newer.handle, answer: "accept" })).toEqual({
      content: WRITE_RESULTS.moved("Projects/Sub/Offer.md"),
      isError: false,
      paths: ["Projects/Offer.md", "Projects/Sub/Offer.md"],
    });
    expect(w.acts).toEqual(["move Projects/Offer.md -> Projects/Sub"]);
  });

  it("a place outside the program's folders is no place a note can be moved to", async () => {
    const w = await window();
    expect(await w.call("move_note", { path: "Projects/Offer.md", folder: "Private" })).toEqual({ ...refused("no-folder"), paths: ["Projects/Offer.md"] });
    // The vault itself is a place only for a program that was given all of it.
    expect(await w.call("move_note", { path: "Projects/Offer.md", folder: "" })).toEqual({ ...refused("no-folder"), paths: ["Projects/Offer.md"] });
    const whole = await w.call("move_note", { path: "Projects/Offer.md", folder: "" }, { folders: [""] });
    expect(whole.pending!.message).toBe("Plainva is asking in its window whether to move “Projects/Offer” to the top level of the vault. Answer there, then continue here.");
    // And what the tool refuses before it has anything to ask is its own answer: nothing waits.
    expect(await w.call("rename_note", { path: "Projects/Offer.md", title: "Brief" })).toEqual({ ...refused("exists"), paths: ["Projects/Offer.md"] });
    expect(w.plans.current()!.tool).toBe("move_note");
    expect(w.acts).toEqual([]);
  });

  it("a deletion is the app's own dialog: after both yeses it opens, and it decides", async () => {
    const w = await window();
    const first = await w.call("delete_note", { path: "Projects/Offer.md" });
    expect(first.pending!.message).toBe("Plainva is asking in its window whether to delete “Projects/Offer”. Answer there, then continue here.");
    expect(w.acts).toEqual([]);
    w.plans.decide(first.pending!.handle, "yes");
    expect(w.acts).toEqual([]);
    expect(await w.call("delete_note", { path: "Projects/Offer.md" }, { handle: first.pending!.handle, answer: "accept" })).toEqual({ content: WRITE_RESULTS.deleted, isError: false, paths: ["Projects/Offer.md"] });
    expect(w.acts).toEqual(["delete dialog Projects/Offer.md"]);
    // The user closed that dialog: a no, and nothing is gone.
    const kept = await window({ deletes: false });
    const handle = (await kept.call("delete_note", { path: "Projects/Offer.md" })).pending!.handle;
    kept.plans.decide(handle, "yes");
    expect(await kept.call("delete_note", { path: "Projects/Offer.md" }, { handle, answer: "accept" })).toEqual({ content: WRITE_REFUSALS.declined, isError: true, paths: ["Projects/Offer.md"], declined: true });
  });
});

describe("the plans that wait", () => {
  const question: PlanQuestion = { plan: "delete", path: "a.md" };
  const entry = (owner: object, clientId = "c1") => ({ clientId, client: "Test client", tool: "delete_note", args: "{}", question, owner }) as Parameters<Plans["open"]>[0];

  it("the dialog shows the oldest plan the user has not answered, and tells its listeners", () => {
    const plans = new McpPlans();
    const owner = {};
    let told = 0;
    const stop = plans.subscribe(() => void told++);
    const a = plans.open(entry(owner, "c1"));
    const b = plans.open(entry(owner, "c2"));
    expect(plans.current()!.handle).toBe(a);
    expect(told).toBe(1);
    plans.decide(a, "yes");
    expect(plans.current()!.handle).toBe(b);
    // An answer stays what it was.
    plans.decide(a, "no");
    expect(plans.find(a, "c1", owner)!.decision).toBe("yes");
    plans.drop(b);
    expect(plans.current()).toBeNull();
    expect(told).toBe(3);
    stop();
    plans.clear();
    expect(plans.find(a, "c1", owner)).toBeNull();
  });

  it("a plan belongs to its program and to the vault it was made in", () => {
    const plans = new McpPlans();
    const owner = {};
    const handle = plans.open(entry(owner));
    expect(plans.find(handle, "c1", owner)).not.toBeNull();
    expect(plans.find(handle, "c2", owner)).toBeNull();
    expect(plans.find(handle, "c1", {})).toBeNull();
    plans.clear();
  });

  it("does not wait for ever: after ten minutes the question closes, and a yes nobody came back for is void", async () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    let n = 0;
    const plans = new McpPlans({ now: () => now, newHandle: () => `handle-${String(++n).padStart(12, "0")}` });
    const owner = {};
    const open = plans.open(entry(owner, "c1"));
    const allowed = plans.open(entry(owner, "c2"));
    plans.decide(allowed, "yes");
    const waiting = plans.wait(open, MCP_PLAN_TTL_MS * 2);
    now += MCP_PLAN_TTL_MS;
    await vi.advanceTimersByTimeAsync(MCP_PLAN_TTL_MS + 10);
    expect(plans.current()).toBeNull();
    expect(await waiting).toBeNull();
    expect(plans.find(open, "c1", owner)).toBeNull();
    expect(plans.find(allowed, "c2", owner)).toBeNull();
    // Waiting for a plan that is not there ends at once.
    expect(await plans.wait(open, 1_000)).toBeNull();
  });

  it("two plans are the same where every part the user read is", () => {
    const rename: PlanQuestion = { plan: "rename", path: "a.md", title: "b", target: "b.md", links: 3, files: [{ path: "x.md", links: 1 }, { path: "y.md", links: 2 }] };
    expect(samePlan(rename, { ...rename, files: [...rename.files].reverse() })).toBe(true);
    expect(samePlan(rename, { ...rename, files: [{ path: "x.md", links: 1 }, { path: "z.md", links: 2 }] })).toBe(false);
    expect(samePlan(rename, { ...rename, links: 4 })).toBe(false);
    expect(samePlan(rename, { ...rename, target: "c/b.md" })).toBe(false);
    const move: PlanQuestion = { plan: "move", path: "a.md", folder: "f", target: "f/a.md", loosens: ["cloud", "web"] };
    expect(samePlan(move, { ...move, loosens: ["web", "cloud"] })).toBe(true);
    expect(samePlan(move, { ...move, loosens: ["cloud"] })).toBe(false);
    expect(samePlan(question, { plan: "delete", path: "b.md" })).toBe(false);
    expect(samePlan(question, rename)).toBe(false);
  });
});
