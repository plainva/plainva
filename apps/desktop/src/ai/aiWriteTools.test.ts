import { beforeAll, describe, expect, it } from "vitest";
import { WRITE_REFUSALS, WRITE_RESULTS, effectivePolicy, notePolicyFrom, parsePolicyFile, toolByName, type AiPolicyDimension, type EgressRecipient, type WriteDraftBody } from "@plainva/core";
import {
  captureVocabularyOf,
  createVaultToolExecutor,
  furtherToolNames,
  noteMovePlan,
  noteNameOf,
  noteRenamePlan,
  writeToolNames,
  type PlanQuestion,
  type ProposalRound,
  type ToolScope,
  type VaultToolDeps,
  type VaultWriteDeps,
  type WriteRun,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * The writing tools of the assistant (plan KI-Harness P5-2), behind the same
 * gate as every read: none of them changes the vault. A change to a note is
 * laid on it as a suggestion round, something new is left as a draft, and a
 * rename, a move and a deletion are a question to the user.
 */

const OFFER = "---\nstatus: draft\n---\n# Offer\n\nThe day rate is 1,800 euros.\n\n## Costs\n\nTravel is extra.\n\n## Notes\n\nlater\n";
const NOTES: Record<string, string> = {
  "Projects/Offer.md": OFFER,
  "Projects/Plan.md": "# Plan\n\nOne line.\n\nOne line.\n",
  "Projects/Board.base": "views: []\n",
  "Private/Client.md": "# Client\n\nsecret\n",
  "Archive/Old.md": "# Old\n",
};
const rules = parsePolicyFile("folders:\n  Private/:\n    cloud: deny\n").rules;
const policyOf = async (path: string) => effectivePolicy(path, notePolicyFrom({}), rules);

const cloud: EgressRecipient = { kind: "cloud", provider: "anthropic", model: "m" };
const local: EgressRecipient = { kind: "local", provider: "ollama", model: "m" };

/** Who links to the offer: two links in the plan, one in an old note, and the offer's own link to itself. */
const BACKLINKS = [
  { source_path: "Archive/Old.md", target_path: "Offer", property_key: null },
  { source_path: "Projects/Offer.md", target_path: "Offer", property_key: null },
  { source_path: "Projects/Plan.md", target_path: "Offer", property_key: null },
  { source_path: "Projects/Plan.md", target_path: "Projects/Offer", property_key: "offer" },
];

function vault(over: Partial<VaultWriteDeps> = {}) {
  const proposed: ProposalRound[] = [];
  const acts: string[] = [];
  const exists = async (path: string) => NOTES[path] !== undefined;
  const writes: VaultWriteDeps = {
    sealed: () => false,
    current: async (path) => NOTES[path] ?? null,
    propose: async (round) => void proposed.push(round),
    folderExists: async (folder) => folder === "" || Object.keys(NOTES).some((path) => path.startsWith(`${folder}/`)),
    taskVocabulary: () => captureVocabularyOf((key) => i18n.t(key), "en"),
    draftPlace: async (kind, day) => (kind === "task" ? "Tasks/task.md" : `Daily/${day}.md`),
    renamePlan: (path, title) => noteRenamePlan({ getBacklinks: async () => (path === "Projects/Offer.md" ? BACKLINKS : []) as never }, exists, path, title),
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
      return true;
    },
    ...over,
  };
  const deps: VaultToolDeps = {
    search: async () => [],
    readNote: async (path) => NOTES[path] ?? null,
    resolveLink: async () => null,
    policyOf,
    taskRows: async () => [],
    todayKey: () => "2026-10-07",
    commands: () => [],
    writes,
  };
  return { deps, proposed, acts };
}

function writer(over: Partial<WriteRun> = {}) {
  const drafts: { title: string; body: WriteDraftBody; defused: number }[] = [];
  const asked: PlanQuestion[] = [];
  const run: WriteRun = {
    author: { id: "plainva-ai/m-1", displayName: "Plainva AI · m-1" },
    userTexts: () => [],
    inherited: async () => [],
    draft: async (input) => {
      drafts.push(input);
      return { ok: true, id: `d-${drafts.length}` };
    },
    ask: async (question) => {
      asked.push(question);
      return "yes";
    },
    writes: { rounds: [], drafts: [], plans: [] },
    today: () => "2026-10-07",
    clock: () => "10:30",
    ...over,
  };
  return { run, drafts, asked };
}

type Vault = ReturnType<typeof vault>;
const call = (v: Vault, run: WriteRun | undefined, name: string, args: unknown, recipient: EgressRecipient = cloud, scope?: ToolScope) =>
  createVaultToolExecutor(v.deps, { recipient, webTools: false }, scope, undefined, undefined, run).execute(toolByName(name)!, args, { type: "tool_call", id: "c1", name, args });

/** A round as the note would read once every block of it was accepted. */
function accepted(round: ProposalRound): string {
  let text = round.base;
  for (const chunk of [...round.chunks].sort((a, b) => b.fromA - a.fromA)) text = text.slice(0, chunk.fromA) + chunk.replacement + text.slice(chunk.toA);
  return text;
}

/** A refusal in Plainva's own sentence; a no of the user is marked as one, so it is no failure of the tool. */
const refused = (reason: keyof typeof WRITE_REFUSALS) => ({ content: WRITE_REFUSALS[reason], isError: true, ...(reason === "declined" ? { declined: true } : {}) });

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("a change to a note is a suggestion round", () => {
  it("lays the change on the note and changes nothing — the answer names the count, never the words", async () => {
    const v = vault();
    const w = writer();
    const out = await call(v, w.run, "propose_edit", { path: "Projects/Offer.md", edits: [{ find: "1,800 euros", replace: "1,900 euros" }], note: "Raise the\nrate" });
    expect(out).toEqual({ content: WRITE_RESULTS.proposed("Projects/Offer.md", 1, 0) });
    expect(out.content).not.toContain("1,900");
    expect(v.proposed).toHaveLength(1);
    const round = v.proposed[0]!;
    expect(round).toMatchObject({ path: "Projects/Offer.md", base: OFFER, note: "Raise the rate", author: { id: "plainva-ai/m-1", displayName: "Plainva AI · m-1" } });
    expect(accepted(round)).toBe(OFFER.replace("1,800 euros", "1,900 euros"));
    expect(w.run.writes).toEqual({ rounds: [{ path: "Projects/Offer.md", blocks: 1, properties: 0 }], drafts: [], plans: [] });
    // The note itself is what it was: nothing but the round was handed to the shell.
    expect(v.acts).toEqual([]);
  });

  it("adds a paragraph at the end of a section, and counts a second round on the same note with the first", async () => {
    const v = vault();
    const w = writer();
    expect((await call(v, w.run, "propose_edit", { path: "Projects/Offer.md", append: "Lodging is extra.", section: "Costs" })).isError).toBeUndefined();
    expect(accepted(v.proposed[0]!)).toBe(OFFER.replace("Travel is extra.\n\n", "Travel is extra.\n\nLodging is extra.\n\n"));
    await call(v, w.run, "propose_edit", { path: "Projects/Offer.md", append: "See you." });
    expect(accepted(v.proposed[1]!)).toBe(`${OFFER}\nSee you.\n`);
    expect(w.run.writes.rounds).toEqual([{ path: "Projects/Offer.md", blocks: 2, properties: 0 }]);
  });

  it("says in one of its own sentences why a change cannot be laid down", async () => {
    const v = vault();
    const w = writer();
    const edit = (args: Record<string, unknown>) => call(v, w.run, "propose_edit", args);
    expect(await edit({ path: "Projects/Offer.md" })).toEqual(refused("edits-or-append"));
    expect(await edit({ path: "Projects/Offer.md", edits: [{ find: "a", replace: "b" }], append: "c" })).toEqual(refused("edits-or-append"));
    expect(await edit({ path: "Projects/Plan.md", edits: [{ find: "One line.", replace: "Two." }] })).toEqual({ content: `Edit 1: ${WRITE_REFUSALS.ambiguous}`, isError: true });
    // A note's properties are not its text: a passage of them is "not in the text of the note".
    expect(await edit({ path: "Projects/Offer.md", edits: [{ find: "status: draft", replace: "status: sent" }] })).toEqual({ content: `Edit 1: ${WRITE_REFUSALS["not-found"]}`, isError: true });
    expect(await edit({ path: "Projects/Offer.md", edits: [{ find: "later", replace: "later" }] })).toEqual(refused("unchanged"));
    expect(await edit({ path: "Projects/Offer.md", append: "More.", section: "Nowhere" })).toEqual(refused("no-section"));
    expect(await edit({ path: "Projects/Board.base", append: "x" })).toEqual(refused("not-a-note"));
    expect(v.proposed).toEqual([]);
    expect(w.run.writes.rounds).toEqual([]);
  });

  it("answers a note the rules keep from this recipient exactly like one that is not there", async () => {
    const v = vault();
    const w = writer();
    const args = (path: string) => ({ path, edits: [{ find: "secret", replace: "open" }] });
    const denied = await call(v, w.run, "propose_edit", args("Private/Client.md"));
    expect(denied).toEqual(refused("no-note"));
    expect(denied).toEqual(await call(v, w.run, "propose_edit", args("Nowhere.md")));
    expect(denied).toEqual(await call(v, w.run, "propose_edit", args("../outside.md")));
    expect(v.proposed).toEqual([]);
    // A model on this device reads the note, so it may propose on it.
    expect((await call(v, w.run, "propose_edit", args("Private/Client.md"), local)).isError).toBeUndefined();
    expect(v.proposed.map((round) => round.path)).toEqual(["Private/Client.md"]);
  });

  it("stays inside the folders a skill was given", async () => {
    const v = vault();
    const w = writer();
    const scope: ToolScope = { inside: (path) => path.startsWith("Archive/") };
    expect(await call(v, w.run, "propose_edit", { path: "Projects/Offer.md", append: "x" }, cloud, scope)).toEqual(refused("no-note"));
    expect(await call(v, w.run, "create_note", { title: "Kick-off", folder: "Projects", content: "Agenda" }, cloud, scope)).toEqual(refused("no-folder"));
    expect((await call(v, w.run, "propose_edit", { path: "Archive/Old.md", append: "x" }, cloud, scope)).isError).toBeUndefined();
  });

  it("makes an address the model brought inert, and leaves the user's own alone", async () => {
    const v = vault();
    const w = writer({ userTexts: () => ["Add https://example.org/rates to the offer."] });
    const out = await call(v, w.run, "propose_edit", { path: "Projects/Offer.md", append: "Rates: https://example.org/rates — and https://evil.example/collect?d=1800" });
    expect(out).toEqual({ content: WRITE_RESULTS.proposed("Projects/Offer.md", 1, 1) });
    const text = accepted(v.proposed[0]!);
    expect(text).toContain("https://example.org/rates");
    expect(text).toContain("https[://]evil.example/collect?d=1800");
    expect(text).not.toContain("https://evil.example");
    // The properties are no part of the round, whatever the lint would make of them.
    expect(text.startsWith("---\nstatus: draft\n---\n")).toBe(true);
  });

  it("lays nothing where the rules of what the conversation read do not hold", async () => {
    const v = vault();
    const w = writer({ inherited: async (): Promise<AiPolicyDimension[]> => ["cloud"] });
    // The conversation read a note kept from the cloud. A round on a note without that rule would carry it out.
    expect(await call(v, w.run, "propose_edit", { path: "Projects/Offer.md", append: "The client pays 1,800." }, local)).toEqual(refused("restricted"));
    expect(v.proposed).toEqual([]);
    // Where the rule holds anyway, the round is laid.
    expect((await call(v, w.run, "propose_edit", { path: "Private/Client.md", append: "Pays 1,800." }, local)).isError).toBeUndefined();
    // A task and a journal line cannot carry a rule either: their place has to have it.
    expect(await call(v, w.run, "create_task", { text: "Call the client" }, local)).toEqual(refused("restricted"));
    expect(await call(v, w.run, "add_journal_entry", { text: "Met the client" }, local)).toEqual(refused("restricted"));
    expect(w.drafts).toEqual([]);
    const inside = vault({ draftPlace: async () => "Private/task.md" });
    expect((await call(inside, w.run, "create_task", { text: "Call the client" }, local)).isError).toBeUndefined();
    // A place nobody can name takes nothing of such a conversation — and everything of one that read nothing restricted.
    const nowhere = vault({ draftPlace: async () => null });
    expect(await call(nowhere, w.run, "add_journal_entry", { text: "Met the client" }, local)).toEqual(refused("restricted"));
    expect((await call(nowhere, writer().run, "add_journal_entry", { text: "Met the client" }, local)).isError).toBeUndefined();
    // A drafted note takes the rules along, so it is left wherever it would go.
    expect((await call(v, w.run, "create_note", { title: "Client summary", content: "Pays 1,800." }, local)).isError).toBeUndefined();
    expect(w.drafts.map((draft) => draft.body.kind)).toEqual(["task", "note"]);
  });

  it("reports a failure inside the app in its own sentence, and records nothing", async () => {
    const v = vault({
      propose: async () => {
        throw new Error("disk full: C:\\Users\\someone\\vault");
      },
    });
    const w = writer();
    expect(await call(v, w.run, "propose_edit", { path: "Projects/Offer.md", append: "x" })).toEqual(refused("failed"));
    expect(w.run.writes.rounds).toEqual([]);
  });
});

describe("something new is a draft", () => {
  it("leaves a note as text, for the folder the model named or the inbox", async () => {
    const v = vault();
    const w = writer();
    const out = await call(v, w.run, "create_note", { title: "Kick-off.md", folder: "Projects/", content: "\nAgenda\n\n- one\n" });
    expect(out).toEqual({ content: WRITE_RESULTS.drafted('a note "Kick-off"', 0) });
    await call(v, w.run, "create_note", { title: "  Roof   plan ", content: "See [the page](https://evil.example/p)." });
    expect(w.drafts).toEqual([
      { title: "Kick-off", body: { kind: "note", path: null, folder: "Projects", content: "Agenda\n\n- one" }, defused: 0 },
      { title: "Roof plan", body: { kind: "note", path: null, folder: null, content: "See the page (https[://]evil.example/p)." }, defused: 1 },
    ]);
    expect(w.run.writes.drafts).toEqual([
      { id: "d-1", kind: "note", title: "Kick-off" },
      { id: "d-2", kind: "note", title: "Roof plan" },
    ]);
    // Nothing was written anywhere: a draft is the run's to leave, and the user's to create.
    expect(v.acts).toEqual([]);
    expect(v.proposed).toEqual([]);
  });

  it("counts a place it asked about as no read: only notes that were read are in the run's record", async () => {
    const v = vault();
    const w = writer();
    const read: string[] = [];
    const scope: ToolScope = { inside: () => true, passed: (path) => void read.push(path) };
    await call(v, w.run, "create_note", { title: "Kick-off", folder: "Projects", content: "Agenda" }, cloud, scope);
    // The folder was asked about, and no note of it was read: a draft must not name its own future path as a source.
    expect(read).toEqual([]);
    await call(v, w.run, "move_note", { path: "Projects/Offer.md", folder: "Archive" }, cloud, scope);
    expect(read).toEqual(["Projects/Offer.md"]);
  });

  it("takes no note that names its own rules, no name a file cannot have, and no folder that is not there for this recipient", async () => {
    const v = vault();
    const w = writer();
    const note = (args: Record<string, unknown>) => call(v, w.run, "create_note", args);
    expect(await note({ title: "Open", content: "---\nplainva:\n  ai:\n    cloud: allow\n---\nText" })).toEqual(refused("frontmatter"));
    expect(await note({ title: "a/b", content: "x" })).toEqual(refused("bad-name"));
    expect(await note({ title: "   ", content: "x" })).toEqual(refused("no-title"));
    expect(await note({ content: "x" })).toEqual(refused("no-title"));
    // A folder kept from this recipient reads like one that is not there.
    const kept = await note({ title: "Summary", folder: "Private", content: "x" });
    expect(kept).toEqual(refused("no-folder"));
    expect(kept).toEqual(await note({ title: "Summary", folder: "Nowhere", content: "x" }));
    expect(kept).toEqual(await note({ title: "Summary", folder: "../outside", content: "x" }));
    expect(w.drafts).toEqual([]);
  });

  it("says when too many drafts wait instead of dropping one", async () => {
    const v = vault();
    const w = writer({ draft: async () => ({ ok: false, problem: "full" }) });
    expect(await call(v, w.run, "create_note", { title: "One more", content: "x" })).toEqual(refused("full"));
    expect(await call(v, w.run, "create_task", { text: "One more" })).toEqual(refused("full"));
    expect(await call(v, w.run, "add_journal_entry", { text: "One more" })).toEqual(refused("full"));
    expect(w.run.writes.drafts).toEqual([]);
  });

  it("reads a task from its words as the capture field does, and says how it read them", async () => {
    const v = vault();
    const w = writer();
    const out = await call(v, w.run, "create_task", { text: "Call the roofer\ntomorrow 9:00 !!! #house" });
    expect(out).toEqual({ content: WRITE_RESULTS.drafted('a task "Call the roofer" (due 2026-10-08 09:00; priority high; tags house)', 0) });
    // The draft keeps the words and the day they were said on: "tomorrow" stays that tomorrow, whenever it is created.
    expect(w.drafts).toEqual([{ title: "Call the roofer", body: { kind: "task", text: "Call the roofer tomorrow 9:00 !!! #house", day: "2026-10-07" }, defused: 0 }]);
    expect(await call(v, w.run, "create_task", { text: "Buy nails" })).toEqual({ content: WRITE_RESULTS.drafted('a task "Buy nails"', 0) });
    expect(await call(v, w.run, "create_task", { text: "  " })).toEqual(refused("empty"));
  });

  it("drafts a journal line with the day and the time of the run", async () => {
    const v = vault();
    const w = writer();
    const out = await call(v, w.run, "add_journal_entry", { text: " Met Anna. See https://evil.example/x ", task: true });
    expect(out).toEqual({ content: WRITE_RESULTS.drafted("a journal entry", 1) });
    expect(w.drafts).toEqual([{ title: "Met Anna. See https[://]evil.example/x", body: { kind: "journal", text: "Met Anna. See https[://]evil.example/x", day: "2026-10-07", time: "10:30", task: true }, defused: 1 }]);
    expect(await call(v, w.run, "add_journal_entry", { text: "" })).toEqual(refused("empty"));
  });
});

describe("a rename, a move and a deletion are a question", () => {
  it("asks with what a rename would do, and the app renames after a yes", async () => {
    const v = vault();
    const w = writer();
    const out = await call(v, w.run, "rename_note", { path: "Projects/Offer.md", title: "Offer 2027" });
    expect(w.asked).toEqual([
      {
        plan: "rename",
        path: "Projects/Offer.md",
        title: "Offer 2027",
        target: "Projects/Offer 2027.md",
        // Links as they stand, by note — in the text and in the properties; the note's link to itself is nobody else's.
        files: [
          { path: "Archive/Old.md", links: 1 },
          { path: "Projects/Plan.md", links: 2 },
        ],
        links: 3,
      },
    ]);
    expect(v.acts).toEqual(["rename Projects/Offer.md -> Offer 2027"]);
    expect(out).toEqual({ content: WRITE_RESULTS.renamed("Projects/Offer 2027.md") });
    expect(w.run.writes.plans).toEqual([{ kind: "rename", path: "Projects/Offer.md", outcome: "done" }]);
  });

  it("does nothing after a no, and nothing where nobody is there to ask", async () => {
    for (const [answer, reason] of [["no", "declined"], ["nobody", "nobody"]] as const) {
      const v = vault();
      const w = writer({ ask: async () => answer });
      expect(await call(v, w.run, "rename_note", { path: "Projects/Offer.md", title: "Offer 2027" })).toEqual(refused(reason));
      expect(await call(v, w.run, "move_note", { path: "Projects/Offer.md", folder: "Archive" })).toEqual(refused(reason));
      expect(await call(v, w.run, "delete_note", { path: "Projects/Offer.md" })).toEqual(refused(reason));
      expect(v.acts).toEqual([]);
      expect(w.run.writes.plans.map((plan) => plan.outcome)).toEqual(["declined", "declined", "declined"]);
    }
  });

  it("asks about nothing that cannot be done, and about no note this recipient does not get", async () => {
    const v = vault();
    const w = writer();
    expect(await call(v, w.run, "rename_note", { path: "Projects/Offer.md", title: "a:b" })).toEqual(refused("bad-name"));
    expect(await call(v, w.run, "rename_note", { path: "Projects/Offer.md", title: "Offer" })).toEqual(refused("same-place"));
    expect(await call(v, w.run, "rename_note", { path: "Projects/Offer.md", title: "Plan" })).toEqual(refused("exists"));
    expect(await call(v, w.run, "move_note", { path: "Projects/Offer.md", folder: "Projects" })).toEqual(refused("same-place"));
    expect(await call(v, w.run, "move_note", { path: "Projects/Offer.md", folder: "Nowhere" })).toEqual(refused("no-folder"));
    // A folder kept from this recipient is no place it can name — answered like one that is not there.
    expect(await call(v, w.run, "move_note", { path: "Projects/Offer.md", folder: "Private" })).toEqual(refused("no-folder"));
    for (const tool of ["rename_note", "move_note", "delete_note"]) {
      expect(await call(v, w.run, tool, { path: "Private/Client.md", title: "Customer", folder: "Archive" })).toEqual(refused("no-note"));
    }
    expect(w.asked).toEqual([]);
    expect(v.acts).toEqual([]);
    expect(w.run.writes.plans).toEqual([]);
  });

  it("tells the user before the yes when a move takes a note out from under its folder's rule", async () => {
    const v = vault();
    const w = writer();
    expect(await call(v, w.run, "move_note", { path: "Private/Client.md", folder: "Archive/" }, local)).toEqual({ content: WRITE_RESULTS.moved("Archive/Client.md") });
    expect(await call(v, w.run, "move_note", { path: "Projects/Offer.md" }, local)).toEqual({ content: WRITE_RESULTS.moved("Offer.md") });
    expect(w.asked).toEqual([
      { plan: "move", path: "Private/Client.md", folder: "Archive", target: "Archive/Client.md", loosens: ["cloud"] },
      { plan: "move", path: "Projects/Offer.md", folder: "", target: "Offer.md", loosens: [] },
    ]);
    expect(v.acts).toEqual(["move Private/Client.md -> Archive", "move Projects/Offer.md -> (vault)"]);
  });

  it("never deletes: after the yes the app's own dialog decides — and closing it is a no, not a failure", async () => {
    const v = vault();
    const w = writer();
    expect(await call(v, w.run, "delete_note", { path: "Projects/Offer.md" })).toEqual({ content: WRITE_RESULTS.deleted });
    expect(w.asked).toEqual([{ plan: "delete", path: "Projects/Offer.md" }]);
    expect(v.acts).toEqual(["delete dialog Projects/Offer.md"]);
    const closed = vault({ requestDelete: async () => false });
    const again = writer();
    expect(await call(closed, again.run, "delete_note", { path: "Projects/Offer.md" })).toEqual(refused("declined"));
    expect(again.run.writes.plans).toEqual([{ kind: "delete", path: "Projects/Offer.md", outcome: "declined" }]);
  });

  it("says that it could not be done when the app's own operation fails, whatever went wrong", async () => {
    const v = vault({
      rename: async () => null,
      move: async () => {
        throw new Error("EACCES: C:\\Users\\someone\\vault");
      },
    });
    const w = writer();
    expect(await call(v, w.run, "rename_note", { path: "Projects/Offer.md", title: "Offer 2027" })).toEqual(refused("failed"));
    expect(await call(v, w.run, "move_note", { path: "Projects/Offer.md", folder: "Archive" })).toEqual(refused("failed"));
    expect(w.run.writes.plans.map((plan) => plan.outcome)).toEqual(["failed", "failed"]);
    // A lookup of the links that fails is no "nobody links here": the user is not asked on a guess.
    const blind = vault({
      renamePlan: (path, title) =>
        noteRenamePlan(
          {
            getBacklinks: async () => {
              throw new Error("index closed");
            },
          },
          async () => false,
          path,
          title,
        ),
    });
    const third = writer();
    expect(await call(blind, third.run, "rename_note", { path: "Projects/Offer.md", title: "Offer 2027" })).toEqual(refused("failed"));
    expect(third.asked).toEqual([]);
  });
});

describe("where nothing is written at all", () => {
  const every: [string, Record<string, unknown>][] = [
    ["propose_edit", { path: "Projects/Offer.md", append: "x" }],
    ["create_note", { title: "Kick-off", content: "x" }],
    ["create_task", { text: "Buy nails" }],
    ["add_journal_entry", { text: "Met Anna" }],
    ["rename_note", { path: "Projects/Offer.md", title: "Offer 2027" }],
    ["move_note", { path: "Projects/Offer.md", folder: "Archive" }],
    ["delete_note", { path: "Projects/Offer.md" }],
  ];

  it("inside an encrypted workspace nothing is proposed, drafted or planned", async () => {
    const v = vault({ sealed: () => true });
    const w = writer();
    for (const [tool, args] of every) expect(await call(v, w.run, tool, args), tool).toEqual(refused("sealed"));
    expect([v.proposed, v.acts, w.drafts, w.asked]).toEqual([[], [], [], []]);
    // A conversation started there is not handed tools that all answer no: none is offered.
    expect(writeToolNames(v.deps.writes)).toEqual([]);
    expect(furtherToolNames(v.deps)).toEqual([]);
    // Nor does a run without a writer learn more than that the vault is sealed.
    expect(await call(v, undefined, "propose_edit", { path: "Projects/Offer.md", append: "x" })).toEqual(refused("sealed"));
  });

  it("a run that brought nobody to decide lays nothing down — a door, a regression run", async () => {
    const v = vault();
    for (const [tool, args] of every) expect(await call(v, undefined, tool, args), tool).toEqual(refused("nobody"));
    expect([v.proposed, v.acts]).toEqual([[], []]);
  });

  it("a shell without the writing tools takes no changes, and offers none", async () => {
    const v = vault();
    const bare: Vault = { ...v, deps: { ...v.deps, writes: undefined } };
    const w = writer();
    for (const [tool, args] of every) expect(await call(bare, w.run, tool, args), tool).toEqual(refused("unavailable"));
    expect(furtherToolNames(bare.deps)).toEqual([]);
    // The tools of later packages have a name and a risk already, and no hands yet.
    expect(await call(v, w.run, "set_property", { path: "Projects/Offer.md", key: "status", value: "sent" })).toEqual(refused("unavailable"));
    expect(await call(v, w.run, "create_entry", { base: "Projects/Board.base", properties: {} })).toEqual(refused("unavailable"));
  });

  it("offers the writing tools before the mail tools, through the tool search", () => {
    const v = vault();
    expect(writeToolNames(v.deps.writes)).toEqual(["propose_edit", "create_note", "create_task", "add_journal_entry", "rename_note", "move_note", "delete_note"]);
    const mail = { accounts: async () => [], folders: async () => [], newest: async () => ({ messages: [], offline: false }), search: async () => [], message: async () => null };
    expect(furtherToolNames({ ...v.deps, mail })).toEqual([...writeToolNames(v.deps.writes), "search_mail", "read_mail"]);
  });
});

describe("the name of a note, and where it would go", () => {
  it("takes a title as a file is called, or not at all", () => {
    expect(noteNameOf("Kick-off.md")).toBe("Kick-off");
    expect(noteNameOf("  Roof   plan ")).toBe("Roof plan");
    for (const bad of ["", "   ", "a/b", "a\\b", "a:b", 'say "x"', "what?", ".hidden", "ends.", "..", "x".repeat(201), `bell${String.fromCharCode(7)}`]) expect(noteNameOf(bad), JSON.stringify(bad)).toBeNull();
  });

  it("plans a rename without doing it — a change of letter case is the same file, not another note's", async () => {
    const none = { getBacklinks: async () => [] as never };
    const all = async () => true;
    expect(await noteRenamePlan(none, all, "Projects/offer.md", "offer")).toBe("same-place");
    expect(await noteRenamePlan(none, all, "Projects/offer.md", "Offer")).toEqual({ target: "Projects/Offer.md", files: [], links: 0 });
    expect(await noteRenamePlan(none, all, "Projects/offer.md", "Plan")).toBe("exists");
    expect(await noteRenamePlan(none, async () => false, "offer.md", "Plan")).toEqual({ target: "Plan.md", files: [], links: 0 });
  });

  it("plans a move without doing it", async () => {
    expect(await noteMovePlan(async () => false, "Projects/Offer.md", "Archive")).toEqual({ target: "Archive/Offer.md" });
    expect(await noteMovePlan(async () => false, "Projects/Offer.md", "")).toEqual({ target: "Offer.md" });
    expect(await noteMovePlan(async () => false, "Offer.md", "")).toBe("same-place");
    expect(await noteMovePlan(async () => true, "Projects/Offer.md", "Archive")).toBe("exists");
  });
});
