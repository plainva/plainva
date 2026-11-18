// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DIRECT_TOOL_NAMES, readSkillImport, SCRIPT_LIMIT_DEFAULTS, SCRIPT_WRITE_TOOL_NAMES } from "@plainva/core";
import type { ScriptDraft } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { results, turn } from "./mcpSessionHarness";
import { gateSession, gateVault, removeGateVaults } from "./writeGateHarness";

// The journal of comment operations lives in the app's data, behind Tauri; here it is the same file journal over a
// folder of the test's own.
vi.mock("../services/commentOperationJournal", async () => {
  const { gateJournal } = await import("./writeGateJournal");
  return { desktopCommentOperationJournal: gateJournal };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

/**
 * A script the AI starts in a conversation writes as the conversation does (maintainer, 2026-11-16; ADR 0019,
 * addendum of 2026-11-06; ADR 0020, "Two stages"): its calls go through the conversation's own executor, so under
 * "Apply directly", and in a folder with "Change without asking", the six tools that can write directly do — with
 * the version before, the line under the answer that takes it back, and the same fallback to a suggestion where
 * the model's own call falls back. A script started from the workshop never writes directly. Through the real
 * session, the real engine, the real writing tools and a vault on a real disk.
 */

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(async () => {
  await removeGateVaults();
});

const OFFER = "---\nstatus: draft\n---\n# Offer\n\nThe day rate is 1,800 euros.\n";
const RAISED = "---\nstatus: draft\n---\n# Offer\n\nThe day rate is 1,900 euros.\n";
const TODAY = "# Today\n\nWrote the offer.\n";
const CLIENTS_BASE = 'filters:\n  and:\n    - file.inFolder("Clients")\nviews:\n  - type: table\n    name: Clients\n';
const NOTES = { "Projects/Offer.md": OFFER, "Journal/Today.md": TODAY, "Clients.base": CLIENTS_BASE };
const JOURNAL_RULE = 'folders:\n  "Journal/":\n    write: direct\n';

/** One call of one writing tool, whichever the model names: the six, and nothing else. */
const WRITE_ONE: ScriptDraft = {
  name: "write-one",
  description: "Makes one change with one writing tool.",
  tools: [...SCRIPT_WRITE_TOOL_NAMES],
  parameters: [
    { name: "tool", type: "text", description: "The writing tool", required: true },
    { name: "args", type: "text", description: "Its arguments as JSON", required: true },
  ],
  code: "try {\n  return await tools[input.tool](JSON.parse(input.args));\n} catch (error) {\n  return \"failed: \" + String(error && error.message ? error.message : error);\n}\n",
};
/** A program in a loop: a new note per round, as many as it is asked for. */
const MAKE_MANY: ScriptDraft = {
  name: "make-many",
  description: "Makes numbered notes.",
  tools: ["create_note"],
  parameters: [{ name: "count", type: "text", description: "How many", required: true }],
  limits: { ...SCRIPT_LIMIT_DEFAULTS, calls: 3 },
  code: `const made = [];
for (let n = 1; n <= Number(input.count); n++) made.push(await tools.create_note({ title: "Note " + n, content: "Number " + n + "." }));
return made;
`,
};

const find = { id: "c1", name: "find_tools", args: { query: "write" } };
const callScript = (script: string, args: Record<string, unknown>, id = "c2") => ({ id, name: "call_tool", args: { name: script, args } });
const one = (tool: string, args: Record<string, unknown>, id?: string) => callScript("script_write_one", { tool, args: JSON.stringify(args) }, id);

/** What the model does in a run: looks for the tools, calls the script, says it is done. */
const scriptTurns = (call: ReturnType<typeof callScript>) => [turn({ calls: [find] }), turn({ calls: [call] }), turn({ text: "Done." })];

async function run(options: { chip?: boolean; policy?: string; unsaved?: string[]; script?: ScriptDraft; call: ReturnType<typeof callScript>; then?: ReturnType<typeof turn>[] }) {
  const vault = await gateVault(NOTES, { scripts: true, ...(options.policy ? { policy: options.policy } : {}), direct: { unsaved: new Set(options.unsaved ?? []) } });
  const { s, fake } = await gateSession([...scriptTurns(options.call), ...(options.then ?? [])], vault, undefined, { scripts: true });
  expect(await s.saveScript(options.script ?? WRITE_ONE)).toMatchObject({ ok: true, approved: true });
  if (options.chip) s.setDirect(true);
  expect(await s.send("Do it.")).toEqual({ kind: "answered" });
  const active = s.getState().active!;
  const run0 = active.runs[0]!;
  return { vault, s, fake, active, run: run0, writes: run0.writes, said: results(active).map((result) => result.content) };
}

describe("the tools a script can write with", () => {
  it("are exactly the six that can write directly — no plan, no e-mail, no appointment", () => {
    expect([...SCRIPT_WRITE_TOOL_NAMES].sort()).toEqual([...DIRECT_TOOL_NAMES].sort());
  });
});

describe("a script the AI starts in a conversation with “Apply directly”", () => {
  const cases: Array<{ tool: string; args: Record<string, unknown>; path: string; kind: string; holds: (text: string | null) => void }> = [
    { tool: "propose_edit", args: { path: "Projects/Offer.md", edits: [{ find: "1,800 euros", replace: "1,900 euros" }] }, path: "Projects/Offer.md", kind: "edit", holds: (text) => expect(text).toBe(RAISED) },
    { tool: "set_property", args: { path: "Projects/Offer.md", key: "client", value: "Harbour Studio" }, path: "Projects/Offer.md", kind: "edit", holds: (text) => expect(text).toContain("client: Harbour Studio") },
    { tool: "create_note", args: { title: "Rates", content: "The day rate is 1,900 euros." }, path: "Inbox/Rates.md", kind: "note", holds: (text) => expect(text).toContain("The day rate is 1,900 euros.") },
    { tool: "create_entry", args: { base: "Clients.base", title: "Harbour Studio" }, path: "Clients/Harbour Studio.md", kind: "entry", holds: (text) => expect(text).not.toBeNull() },
    { tool: "create_task", args: { text: "Call the roofer" }, path: "Tasks/Call the roofer.md", kind: "task", holds: (text) => expect(text).toContain("Call the roofer") },
    { tool: "add_journal_entry", args: { text: "Raised the rate" }, path: "Daily/2026-10-08.md", kind: "journal", holds: (text) => expect(text).toContain("Raised the rate") },
  ];

  for (const c of cases) {
    it(`writes with ${c.tool} at once, by the conversation's leave, and its line under the answer takes it back`, async () => {
      const { vault, s, writes, run: first } = await run({ chip: true, call: one(c.tool, c.args) });
      const before = c.path === "Projects/Offer.md" ? OFFER : null;
      c.holds(await vault.disk(c.path));
      expect(first.scripts).toEqual({ runs: [{ script: "write-one", outcome: "done", calls: 1 }] });
      expect(writes?.applied).toEqual([expect.objectContaining({ path: c.path, kind: c.kind, by: "chat", created: before === null })]);
      expect(writes?.rounds ?? []).toEqual([]);
      expect(writes?.drafts ?? []).toEqual([]);
      // The version before a change to a note that was there is kept first, as for the model's own call.
      if (before !== null) expect((await vault.versions(c.path)).map((version) => version.text)).toContain(before);
      // "Undo" under the answer: the note as it was, or the new one gone.
      expect(await s.undoDirect(0)).toEqual({ undone: [c.path], changed: [], failed: [] });
      expect(await vault.disk(c.path)).toBe(before);
    });
  }

  it("falls back to a suggestion where the model's own call would: a note open with unsaved keystrokes", async () => {
    const { vault, writes, said } = await run({ chip: true, unsaved: ["Projects/Offer.md"], call: one("propose_edit", { path: "Projects/Offer.md", edits: [{ find: "1,800 euros", replace: "1,900 euros" }] }) });
    expect(await vault.disk("Projects/Offer.md")).toBe(OFFER);
    expect(writes?.applied).toBeUndefined();
    expect(writes?.rounds).toEqual([{ path: "Projects/Offer.md", blocks: 1, properties: 0, fallback: "unsaved" }]);
    expect(await vault.open("Projects/Offer.md")).toHaveLength(1);
    // The script is told what came of its call: a suggestion, not a change; the model reads it as the script's output.
    expect(said[1]).toContain(JSON.stringify({ proposed: true, path: "Projects/Offer.md", passages: 1 }));
  });

  it("is held to the script's limits: a loop ends at its calls, and “Undo all” takes back what it made", async () => {
    const { vault, s, writes, run: first } = await run({ chip: true, script: MAKE_MANY, call: callScript("script_make_many", { count: "10" }) });
    // Three calls are the manifest's limit: the fourth is not carried out, and the run ends there.
    expect(first.scripts?.runs).toEqual([{ script: "make-many", outcome: "calls", calls: 3 }]);
    expect(writes?.applied?.map((applied) => applied.path)).toEqual(["Inbox/Note 1.md", "Inbox/Note 2.md", "Inbox/Note 3.md"]);
    expect(await vault.disk("Inbox/Note 4.md")).toBeNull();
    // "Undo all": every change of the run, the script's as the model's.
    const undone = await s.undoDirect(0);
    expect({ ...undone, undone: [...undone.undone].sort() }).toEqual({ undone: ["Inbox/Note 1.md", "Inbox/Note 2.md", "Inbox/Note 3.md"], changed: [], failed: [] });
    for (const n of [1, 2, 3]) expect(await vault.disk(`Inbox/Note ${n}.md`)).toBeNull();
  });
});

describe("a script the AI starts in a conversation without “Apply directly”", () => {
  it("lays a suggestion on a note that is there, and leaves a draft of a new one", async () => {
    const edit = await run({ call: one("propose_edit", { path: "Projects/Offer.md", edits: [{ find: "1,800 euros", replace: "1,900 euros" }] }) });
    expect(await edit.vault.disk("Projects/Offer.md")).toBe(OFFER);
    expect(edit.writes?.applied).toBeUndefined();
    expect(edit.writes?.rounds).toEqual([{ path: "Projects/Offer.md", blocks: 1, properties: 0 }]);
    await removeGateVaults();
    const note = await run({ call: one("create_note", { title: "Rates", content: "The day rate is 1,900 euros." }) });
    expect(await note.vault.disk("Inbox/Rates.md")).toBeNull();
    expect(note.writes?.applied).toBeUndefined();
    expect(note.writes?.drafts).toHaveLength(1);
  });
});

describe("a script the AI starts in a conversation, in a vault with a folder that changes without asking", () => {
  it("writes directly only to targets in that folder", async () => {
    const inside = await run({ policy: JOURNAL_RULE, call: one("propose_edit", { path: "Journal/Today.md", append: "Raised the rate." }) });
    expect(await inside.vault.disk("Journal/Today.md")).toBe(`${TODAY}\nRaised the rate.\n`);
    expect(inside.writes?.applied).toEqual([expect.objectContaining({ path: "Journal/Today.md", by: "folder" })]);
    await removeGateVaults();
    const outside = await run({ policy: JOURNAL_RULE, call: one("propose_edit", { path: "Projects/Offer.md", edits: [{ find: "1,800 euros", replace: "1,900 euros" }] }) });
    expect(await outside.vault.disk("Projects/Offer.md")).toBe(OFFER);
    expect(outside.writes?.applied).toBeUndefined();
    expect(outside.writes?.rounds).toHaveLength(1);
  });
});

describe("a script started from the workshop", () => {
  it("never writes directly — neither where the open conversation applies directly, nor in a folder that changes without asking", async () => {
    const vault = await gateVault(NOTES, { scripts: true, policy: JOURNAL_RULE, direct: {} });
    const { s } = await gateSession([], vault, undefined, { scripts: true });
    expect(await s.saveScript(WRITE_ONE)).toMatchObject({ ok: true, approved: true });
    s.setDirect(true);
    const root = ".agent/scripts/write-one";
    const outcome = await s.runScript(root, { tool: "propose_edit", args: JSON.stringify({ path: "Journal/Today.md", append: "From the workshop." }) });
    expect(outcome?.kind).toBe("done");
    expect(await vault.disk("Journal/Today.md")).toBe(TODAY);
    expect(await vault.open("Journal/Today.md")).toHaveLength(1);
    const made = await s.runScript(root, { tool: "create_note", args: JSON.stringify({ title: "Rates", content: "From the workshop.", folder: "Journal" }) });
    expect(made?.kind).toBe("done");
    expect(await vault.disk("Journal/Rates.md")).toBeNull();
  });
});

/**
 * Runs started apart from the composer carry no script (`apart` in `runMessage`): a replay, a door — the "@AI" of a
 * comment thread — and a skill's test run. In the first two the model asks for the script as it did in the
 * conversation, and is told there is no such tool here; nothing is written. A skill's test run, like a routine, carries
 * neither `find_tools` nor `call_tool`, the only ways to a script (`aiRoutineGate.test.ts`, "NEVER").
 */
describe("a run started apart from the composer", () => {
  const refusedHere = (said: readonly unknown[]) => said.some((content) => String(content).includes('No tool "script_write_one" can be called here.'));

  it("a conversation started again from an earlier turn (replay) runs no script — what the script made is not made a second time", async () => {
    const again = one("create_note", { title: "Rates", content: "Twice." }, "c9");
    const { vault, s, fake, active } = await run({ chip: true, call: one("create_note", { title: "Rates", content: "Once." }), then: scriptTurns(again) });
    expect(await vault.disk("Inbox/Rates.md")).not.toBeNull();
    expect(await s.undoDirect(0)).toEqual({ undone: ["Inbox/Rates.md"], changed: [], failed: [] });
    const asked = fake.sent.length;
    expect(await s.replay(active.id, 0, { providerId: "anthropic", model: "m-1" })).not.toBeNull();
    // The replay reached the model and asked for the script, as the first run did.
    expect(fake.sent.length).toBeGreaterThan(asked);
    const replayed = s.getState().active!;
    expect(replayed.id).not.toBe(active.id);
    expect(refusedHere(results(replayed).map((result) => result.content))).toBe(true);
    expect(replayed.runs[0]!.scripts).toBeUndefined();
    expect(await vault.disk("Inbox/Rates.md")).toBeNull();
  });

  it("the “@AI” of a comment thread (a door) runs no script", async () => {
    const vault = await gateVault(NOTES, { scripts: true, direct: { unsaved: new Set() } });
    const replies: string[] = [];
    vault.host.reply = async (reply) => void replies.push(reply.body);
    const { s, fake } = await gateSession([...scriptTurns(one("create_note", { title: "Rates", content: "From a thread." })), turn({ text: "Done." })], vault, undefined, { scripts: true });
    expect(await s.saveScript(WRITE_ONE)).toMatchObject({ ok: true, approved: true });
    s.setDirect(true);
    const outcome = await s.replyInThread({ path: "Projects/Offer.md", rootCommentId: "n1", quote: null, thread: [], question: "Note the rates down." });
    expect(fake.sent.length).toBeGreaterThan(0);
    expect(outcome.kind).not.toBe("refused");
    const record = s.getState().summaries.length ? await vault.host.conversations.load(s.getState().summaries[0]!.id) : null;
    if (record) expect(record.runs.every((r) => r.scripts === undefined)).toBe(true);
    expect(await vault.disk("Inbox/Rates.md")).toBeNull();
  });

  it("a skill's test run runs no script — a run bound to a skill has neither find_tools nor call_tool, even where the skill names them", async () => {
    const vault = await gateVault(NOTES, { scripts: true, direct: { unsaved: new Set() } });
    const { s, fake } = await gateSession(scriptTurns(one("create_note", { title: "Rates", content: "From a test." })), vault, undefined, { scripts: true });
    expect(await s.saveScript(WRITE_ONE)).toMatchObject({ ok: true, approved: true });
    s.setDirect(true);
    // A skill of the vault's own that names the two tools that reach further tools, with one scenario. A run bound to a
    // skill carries exactly the tools its grant leaves of the conversation's own (`conversationStart`): the two that
    // reach further tools — and with them every script — are none of them, so the scenario's call_tool is unknown there.
    const skill = "---\nname: tool-check\ndescription: Checks a note with the tools it finds. Use when asked to check a note.\nallowed-tools: find_tools call_tool read_note\n---\n\nFind the tools and use them.\n";
    const scenarios = JSON.stringify({ version: 1, scenarios: [{ id: "write", message: "Note the rates down." }] });
    const encode = (text: string) => new TextEncoder().encode(text);
    const imported = readSkillImport([
      { path: "tool-check/SKILL.md", bytes: encode(skill) },
      { path: "tool-check/tests/scenarios.json", bytes: encode(scenarios) },
    ]);
    expect(imported.blocked).toBeNull();
    expect(await s.importSkill(imported, { label: "test" })).toMatchObject({ ok: true });
    const id = ".agent/skills/tool-check";
    const plan = await s.skillTestPlan([id]);
    expect(plan!.targets).toEqual([expect.objectContaining({ id, scenarios: 1, notApplicable: 0 })]);
    await s.testSkills([id], { maxCostUsd: null });
    // The scenario was asked of the model, with the skill's tools and nothing that reaches further.
    expect(fake.sent.length).toBeGreaterThan(0);
    const records = [];
    for (const summary of s.getState().summaries) {
      const record = await vault.host.conversations.load(summary.id);
      if (record?.instructions?.skill?.id === id) records.push(record);
    }
    expect(records).toHaveLength(1);
    const conversation = records[0]!.conversation;
    expect(conversation.tools).toContain("read_note");
    expect(conversation.tools).not.toContain("find_tools");
    expect(conversation.tools).not.toContain("call_tool");
    expect(conversation.more ?? []).toEqual([]);
    const said = results(records[0]!).map((result) => String(result.content));
    expect(said.some((content) => content.includes('Unknown tool "call_tool"'))).toBe(true);
    expect(await vault.disk("Inbox/Rates.md")).toBeNull();
    expect(Object.keys(await vault.notes()).filter((path) => path.startsWith("Inbox/"))).toEqual([]);
  });

});
