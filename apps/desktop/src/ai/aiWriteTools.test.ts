import { beforeAll, describe, expect, it } from "vitest";
import {
  WRITE_REFUSALS,
  WRITE_RESULTS,
  deleteFrontmatterPath,
  effectivePolicy,
  notePolicyFrom,
  parsePolicyFile,
  readFrontmatterPath,
  setFrontmatterPath,
  toolByName,
  type AiPolicyDimension,
  type EgressRecipient,
  type WriteDraftBody,
} from "@plainva/core";
import {
  captureVocabularyOf,
  createVaultToolExecutor,
  entryPlaceOf,
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
 * The writing tools of the assistant (plan KI-Harness P5-2, P5-3), behind the
 * same gate as every read: none of them changes the vault. A change to a note
 * — its text or one of its properties — is laid on it as a suggestion round,
 * something new is left as a draft, and a rename, a move, a deletion and one
 * of the note's own AI rules are a question to the user.
 */

const OFFER = "---\nstatus: draft\n---\n# Offer\n\nThe day rate is 1,800 euros.\n\n## Costs\n\nTravel is extra.\n\n## Notes\n\nlater\n";
const BRIEF = "---\nstage: open\nowner: Anna\n---\n# Brief\n\nShort.\n";
const KEPT = "---\nplainva:\n  ai:\n    cloud: deny\n---\n# Kept\n\nStays here.\n";
const NOTES: Record<string, string> = {
  "Projects/Offer.md": OFFER,
  "Projects/Brief.md": BRIEF,
  "Projects/Kept.md": KEPT,
  "Projects/Plan.md": "# Plan\n\nOne line.\n\nOne line.\n",
  // A database that has no folder for new entries yet: nothing says where one would go.
  "Projects/Board.base": "views: []\n",
  // One that keeps its entries in a folder, and asks for a tag.
  "Projects/Books.base": 'filters:\n  and:\n    - file.folder == "Books/"\n    - file.hasTag("book")\nviews:\n  - type: table\n    name: All\n',
  // One whose entries lie in a folder the rules keep from the cloud, and one that is kept from it itself.
  "Projects/Clients.base": 'filters:\n  and:\n    - file.folder == "Private"\n',
  "Private/Ledger.base": 'filters:\n  and:\n    - file.folder == "Books"\n',
  "Books/Dune.md": "# Dune\n",
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
    setRule: async (path, rule, set) => {
      acts.push(`rule ${rule} ${set ? "into" : "out of"} ${path}`);
      return true;
    },
    // Read from the database's own file, as both shells do.
    entryPlace: async (base) => entryPlaceOf(NOTES[base] ?? null, "Note"),
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

describe("a value of a property is a suggestion — or a question, or nobody's to write", () => {
  const brief = "Projects/Brief.md";
  const set = (v: Vault, run: WriteRun, args: Record<string, unknown>, recipient: EgressRecipient = cloud) => call(v, run, "set_property", args, recipient);

  it("lays the property's entry and the entry as it would read on the note, and says at the anchor which property", async () => {
    const v = vault();
    const w = writer();
    const out = await set(v, w.run, { path: brief, key: " stage ", value: "sent", note: "Sent on\nMonday" });
    expect(out).toEqual({ content: WRITE_RESULTS.proposedProperty(brief, "stage", false, 0) });
    expect(out.content).not.toContain("sent");
    // One block: the entry as it stands, with the hint that makes the card and the property row read it as a property.
    expect(v.proposed).toEqual([
      {
        path: brief,
        base: BRIEF,
        chunks: [{ fromA: 4, toA: 15, replacement: "stage: sent", property: "stage" }],
        note: "Sent on Monday",
        author: { id: "plainva-ai/m-1", displayName: "Plainva AI · m-1" },
        batch: { id: expect.stringMatching(/^[0-9a-f]{32}$/), index: 0 },
      },
    ]);
    expect(accepted(v.proposed[0]!)).toBe(BRIEF.replace("stage: open", "stage: sent"));
    expect(w.run.writes).toEqual({ rounds: [{ path: brief, blocks: 0, properties: 1 }], drafts: [], plans: [] });
    // Nothing but the round was handed to the shell, and nobody was asked: it waits in the margin like a passage.
    expect([v.acts, w.asked]).toEqual([[], []]);
  });

  it("adds a property in front of the line that closes the properties, a list as its items — and counts with a round on the text", async () => {
    const v = vault();
    const w = writer();
    await call(v, w.run, "propose_edit", { path: brief, append: "More." });
    expect((await set(v, w.run, { path: brief, key: "effort", value: 3 })).isError).toBeUndefined();
    expect((await set(v, w.run, { path: brief, key: "tags", value: ["roof", "2026"] })).isError).toBeUndefined();
    expect((await set(v, w.run, { path: brief, key: "done", value: false })).isError).toBeUndefined();
    // An insertion carries no hint: an anchor can only say which property where it quotes that property's entry.
    expect(v.proposed.slice(1).map((round) => round.chunks)).toEqual([
      [{ fromA: 28, toA: 28, replacement: "effort: 3\n" }],
      [{ fromA: 28, toA: 28, replacement: 'tags:\n  - roof\n  - "2026"\n' }],
      [{ fromA: 28, toA: 28, replacement: "done: false\n" }],
    ]);
    expect(accepted(v.proposed[2]!)).toBe('---\nstage: open\nowner: Anna\ntags:\n  - roof\n  - "2026"\n---\n# Brief\n\nShort.\n');
    expect(readFrontmatterPath(accepted(v.proposed[2]!), ["tags"])).toEqual(["roof", "2026"]);
    expect(w.run.writes.rounds).toEqual([{ path: brief, blocks: 1, properties: 3 }]);
  });

  it("lays everything one run proposes on one note into ONE round — a passage and a value are accepted with one “accept all”", async () => {
    const v = vault();
    const w = writer();
    await call(v, w.run, "propose_edit", { path: brief, edits: [{ find: "Short.", replace: "Short and sweet." }, { find: "# Brief", replace: "# The brief" }], note: "Tighter" });
    await set(v, w.run, { path: brief, key: "stage", value: "sent", note: "Sent on Monday" });
    await set(v, w.run, { path: brief, key: "effort", value: 3 });
    await call(v, w.run, "propose_edit", { path: "Projects/Offer.md", append: "See you." });
    const [first, second, third, other] = v.proposed.map((round) => round.batch);
    // The blocks continue the round where the step before left it; another note is another round.
    const passages = v.proposed[0]!.chunks.length;
    expect(passages).toBeGreaterThan(1);
    expect([first!.index, second!.index, third!.index, other!.index]).toEqual([0, passages, passages + 1, 0]);
    expect(new Set([first!.id, second!.id, third!.id]).size).toBe(1);
    expect(other!.id).not.toBe(first!.id);
    // Another run — the next question of the same conversation — begins a round of its own on the same note.
    const next = writer();
    await set(v, next.run, { path: brief, key: "owner", value: "Ben" });
    expect(v.proposed[4]!.batch).toEqual({ id: expect.stringMatching(/^[0-9a-f]{32}$/), index: 0 });
    expect(v.proposed[4]!.batch.id).not.toBe(first!.id);
    // A step that could not be laid down leaves no gap in the round.
    const laid: ProposalRound[] = [];
    const flaky = vault({
      propose: async (round) => {
        if (round.note === "fails") throw new Error("disk full");
        laid.push(round);
      },
    });
    const again = writer();
    await set(flaky, again.run, { path: brief, key: "stage", value: "sent" });
    expect(await set(flaky, again.run, { path: brief, key: "owner", value: "Ben", note: "fails" })).toEqual(refused("failed"));
    await set(flaky, again.run, { path: brief, key: "effort", value: 3 });
    expect(laid.map((round) => round.batch.index)).toEqual([0, 1]);
  });

  it("gives a note that has no properties its first, at the very top", async () => {
    const v = vault();
    const w = writer();
    expect(await set(v, w.run, { path: "Archive/Old.md", key: "stage", value: "kept" })).toEqual({ content: WRITE_RESULTS.proposedProperty("Archive/Old.md", "stage", false, 0) });
    expect(v.proposed[0]!.chunks).toEqual([{ fromA: 0, toA: 0, replacement: "---\nstage: kept\n---\n" }]);
    expect(accepted(v.proposed[0]!)).toBe(setFrontmatterPath("# Old\n", ["stage"], "kept"));
  });

  it("removes a property with `null`: its entry goes, with the one line break that was its own", async () => {
    const v = vault();
    const w = writer();
    expect(await set(v, w.run, { path: brief, key: "owner", value: null })).toEqual({ content: WRITE_RESULTS.proposedProperty(brief, "owner", true, 0) });
    await set(v, w.run, { path: brief, key: "stage", value: null });
    expect(v.proposed.map((round) => round.chunks)).toEqual([
      // The last property goes with the break in front of it, any other with the one behind it.
      [{ fromA: 15, toA: 27, replacement: "", property: "owner" }],
      [{ fromA: 4, toA: 16, replacement: "", property: "stage" }],
    ]);
    expect(v.proposed.map(accepted)).toEqual(["---\nstage: open\n---\n# Brief\n\nShort.\n", "---\nowner: Anna\n---\n# Brief\n\nShort.\n"]);
    // The only property of a note: what is left is the app's own way of writing no properties, found by comparing.
    const single = vault({ current: async () => "---\nstage: open\n---\n# Single\n" });
    await set(single, writer().run, { path: brief, key: "stage", value: null });
    expect(accepted(single.proposed[0]!)).toBe(deleteFrontmatterPath("---\nstage: open\n---\n# Single\n", ["stage"]));
    expect(readFrontmatterPath(accepted(single.proposed[0]!), ["stage"])).toBeUndefined();
  });

  it("proposes against the note as it is now, the editor's pending keystrokes included", async () => {
    const typed = BRIEF.replace("owner: Anna", "owner: Anna Roofer");
    const v = vault({ current: async (path) => (path === brief ? typed : null) });
    const w = writer();
    await set(v, w.run, { path: brief, key: "owner", value: "Ben" });
    expect(v.proposed[0]!.base).toBe(typed);
    expect(accepted(v.proposed[0]!)).toBe(typed.replace("owner: Anna Roofer", "owner: Ben"));
  });

  it("says in one of its own sentences why a value cannot be proposed", async () => {
    const v = vault();
    const w = writer();
    expect(await set(v, w.run, { path: brief, key: "stage", value: "open" })).toEqual(refused("unchanged"));
    expect(await set(v, w.run, { path: brief, key: "missing", value: null })).toEqual(refused("unchanged"));
    for (const args of [
      { path: brief, value: "x" },
      { path: brief, key: "   ", value: "x" },
      { path: brief, key: "stage" },
      { path: brief, key: "stage", value: { deep: 1 } },
      { path: brief, key: "stage", value: ["a", { deep: 1 }] },
      { path: brief, key: "stage", value: "x".repeat(2001) },
      { path: brief, key: "two\nlines", value: "x" },
      { path: brief, key: "k".repeat(121), value: "x" },
    ]) {
      expect(await set(v, w.run, args), JSON.stringify(args).slice(0, 80)).toEqual(refused("bad-property"));
    }
    expect(await set(v, w.run, { path: "Projects/Board.base", key: "stage", value: "x" })).toEqual(refused("not-a-note"));
    // Properties nobody can read as they stand are not rewritten on a guess.
    const broken = vault({ current: async () => "---\nstage: [open\n---\n# Brief\n" });
    expect(await set(broken, w.run, { path: brief, key: "owner", value: "Ben" })).toEqual(refused("unreadable"));
    // A note the rules keep from this recipient is answered like one that is not there.
    const kept = await set(v, w.run, { path: "Private/Client.md", key: "stage", value: "x" });
    expect(kept).toEqual(refused("no-note"));
    expect(kept).toEqual(await set(v, w.run, { path: "Nowhere.md", key: "stage", value: "x" }));
    // A file with nothing in it has no words a suggestion could be attached to — for a value as for a passage.
    const blank = vault({ current: async () => "" });
    expect(await set(blank, w.run, { path: brief, key: "stage", value: "x" })).toEqual(refused("empty-note"));
    expect(await call(blank, w.run, "propose_edit", { path: brief, append: "A first line." })).toEqual(refused("empty-note"));
    expect([v.proposed, broken.proposed, blank.proposed, w.asked, w.run.writes.rounds]).toEqual([[], [], [], [], []]);
    // A rule is the app's own write, so an empty note takes one.
    expect(await set(blank, w.run, { path: brief, key: "plainva.ai.web", value: "deny" })).toEqual({ content: WRITE_RESULTS.ruleSet(brief, true) });
  });

  it("writes neither who made a note nor who vouches for it, and nothing of Plainva's own settings", async () => {
    const v = vault();
    const w = writer();
    // A trust field is one by its form: where the note uses the key as one now, or would after the write.
    expect(await set(v, w.run, { path: "Projects/Offer.md", key: "status", value: "sent" })).toEqual(refused("trust"));
    expect(await set(v, w.run, { path: "Projects/Offer.md", key: "status", value: null })).toEqual(refused("trust"));
    expect(await set(v, w.run, { path: brief, key: "status", value: "stable" })).toEqual(refused("trust"));
    expect(await set(v, w.run, { path: brief, key: "stale_after", value: "2027-01-01" })).toEqual(refused("trust"));
    expect(await set(v, w.run, { path: brief, key: "verified", value: [] })).toEqual(refused("trust"));
    for (const key of ["plainva", "plainva.theme", "plainva.ai", "plainva.ai.everything"]) {
      expect(await set(v, w.run, { path: brief, key, value: "deny" }), key).toEqual(refused("reserved"));
    }
    expect([v.proposed, w.asked, v.acts]).toEqual([[], [], []]);
    // The same key with a value that claims nothing is a property like any other: a task's status, a book's.
    expect((await set(v, w.run, { path: brief, key: "status", value: "Done" })).isError).toBeUndefined();
    expect(v.proposed[0]!.chunks).toEqual([{ fromA: 28, toA: 28, replacement: "status: Done\n" }]);
  });

  it("makes an address the model brought inert in a value too, and leaves the user's own alone", async () => {
    const v = vault();
    const w = writer({ userTexts: () => ["Link https://example.org/brief there."] });
    const out = await set(v, w.run, { path: brief, key: "links", value: ["https://example.org/brief", "https://evil.example/collect?stage=open"] });
    expect(out).toEqual({ content: WRITE_RESULTS.proposedProperty(brief, "links", false, 1) });
    expect(readFrontmatterPath(accepted(v.proposed[0]!), ["links"])).toEqual(["https://example.org/brief", "https[://]evil.example/collect?stage=open"]);
  });

  it("lays no value where the rules of what the conversation read do not hold", async () => {
    const v = vault();
    const w = writer({ inherited: async (): Promise<AiPolicyDimension[]> => ["cloud"] });
    expect(await set(v, w.run, { path: brief, key: "client", value: "pays 1,800" }, local)).toEqual(refused("restricted"));
    expect(v.proposed).toEqual([]);
    expect((await set(v, w.run, { path: "Private/Client.md", key: "client", value: "pays 1,800" }, local)).isError).toBeUndefined();
  });

  it("asks before one of the note's own rules is written or taken out — the app writes it, and only after a yes", async () => {
    const v = vault();
    const w = writer();
    expect(await set(v, w.run, { path: brief, key: "plainva.ai.cloud", value: "deny" })).toEqual({ content: WRITE_RESULTS.ruleSet(brief, true) });
    // Taking a rule out lets the note go where it could not: a model on this device asks the same way.
    expect(await set(v, w.run, { path: "Projects/Kept.md", key: "plainva.ai.cloud", value: null }, local)).toEqual({ content: WRITE_RESULTS.ruleSet("Projects/Kept.md", false) });
    expect(w.asked).toEqual([
      { plan: "rule", path: brief, rule: "cloud", set: true },
      { plan: "rule", path: "Projects/Kept.md", rule: "cloud", set: false },
    ]);
    expect(v.acts).toEqual([`rule cloud into ${brief}`, "rule cloud out of Projects/Kept.md"]);
    expect(w.run.writes).toEqual({ rounds: [], drafts: [], plans: [{ kind: "rule", path: brief, outcome: "done" }, { kind: "rule", path: "Projects/Kept.md", outcome: "done" }] });
    // A rule is never a suggestion: nothing waits in the margin that an "accept all" could take along.
    expect(v.proposed).toEqual([]);
  });

  it("asks about no rule that is so already, takes nothing but deny for one, and does nothing after a no", async () => {
    const v = vault();
    const w = writer();
    expect(await set(v, w.run, { path: "Projects/Kept.md", key: "plainva.ai.cloud", value: "deny" }, local)).toEqual(refused("unchanged"));
    expect(await set(v, w.run, { path: brief, key: "plainva.ai.web", value: null })).toEqual(refused("unchanged"));
    expect(await set(v, w.run, { path: brief, key: "plainva.ai.cloud", value: "allow" })).toEqual(refused("bad-property"));
    expect(await set(v, w.run, { path: brief, key: "plainva.ai.cloud", value: true })).toEqual(refused("bad-property"));
    expect(w.asked).toEqual([]);
    for (const [answer, reason] of [["no", "declined"], ["nobody", "nobody"]] as const) {
      const again = writer({ ask: async () => answer });
      expect(await set(v, again.run, { path: brief, key: "plainva.ai.web", value: "deny" })).toEqual(refused(reason));
      expect(again.run.writes.plans).toEqual([{ kind: "rule", path: brief, outcome: "declined" }]);
    }
    expect(v.acts).toEqual([]);
    // The app's own write can fail: then the answer says so, whatever went wrong.
    for (const setRule of [async () => false, async () => Promise.reject(new Error("EACCES: C:\\Users\\someone\\vault"))]) {
      const failing = vault({ setRule });
      const third = writer();
      expect(await set(failing, third.run, { path: brief, key: "plainva.ai.web", value: "deny" })).toEqual(refused("failed"));
      expect(third.run.writes.plans).toEqual([{ kind: "rule", path: brief, outcome: "failed" }]);
    }
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

describe("a new entry of a database is a draft", () => {
  const books = "Projects/Books.base";
  const entry = (v: Vault, run: WriteRun, args: Record<string, unknown>, recipient: EgressRecipient = cloud, scope?: ToolScope) => call(v, run, "create_entry", args, recipient, scope);

  it("leaves the entry with the properties the model named — nothing is created, and the answer repeats no value", async () => {
    const v = vault();
    const w = writer({ userTexts: () => ["The page is https://example.org/dune"] });
    const properties = { author: "Frank Herbert", pages: 412, read: false, genres: ["sci-fi", "classic"], page: "https://example.org/dune", shop: "https://evil.example/buy?b=dune" };
    const out = await entry(v, w.run, { base: books, title: " Dune.md ", properties, content: "\nA desert planet. See [the shop](https://evil.example/buy).\n" });
    expect(out).toEqual({ content: WRITE_RESULTS.drafted('an entry "Dune" of the database Projects/Books.base', 2) });
    expect(out.content).not.toContain("Herbert");
    expect(w.drafts).toEqual([
      {
        title: "Dune",
        body: {
          kind: "entry",
          base: books,
          // An address the model brought is as inert in a property as in the text; the user's own stays one.
          properties: { ...properties, shop: "https[://]evil.example/buy?b=dune" },
          content: "A desert planet. See the shop (https[://]evil.example/buy).",
        },
        defused: 2,
      },
    ]);
    expect(w.run.writes.drafts).toEqual([{ id: "d-1", kind: "entry", title: "Dune" }]);
    // An entry without a word of text and without a property is one too: a row to fill in.
    expect((await entry(v, w.run, { base: books, title: "Emma" })).isError).toBeUndefined();
    expect(w.drafts[1]).toEqual({ title: "Emma", body: { kind: "entry", base: books, properties: {}, content: "" }, defused: 0 });
    expect([v.acts, v.proposed, w.asked]).toEqual([[], [], []]);
  });

  it("answers a database the rules keep from this recipient — or whose entries they keep from it — like one that is not there", async () => {
    const v = vault();
    const w = writer();
    const none = await entry(v, w.run, { base: "Nowhere.base", title: "x" });
    expect(none).toEqual(refused("no-base"));
    // The database itself is kept from the cloud; another keeps its entries in a folder that is.
    expect(await entry(v, w.run, { base: "Private/Ledger.base", title: "x" })).toEqual(none);
    expect(await entry(v, w.run, { base: "Projects/Clients.base", title: "x" })).toEqual(none);
    // A note is no database, and neither is a path outside the vault.
    expect(await entry(v, w.run, { base: "Projects/Offer.md", title: "x" })).toEqual(none);
    expect(await entry(v, w.run, { base: "../outside.base", title: "x" })).toEqual(none);
    expect(await entry(v, w.run, { title: "x" })).toEqual(none);
    expect(w.drafts).toEqual([]);
    // A model on this device reads both, so it may draft an entry of both.
    expect((await entry(v, w.run, { base: "Private/Ledger.base", title: "x" }, local)).isError).toBeUndefined();
    expect((await entry(v, w.run, { base: "Projects/Clients.base", title: "x" }, local)).isError).toBeUndefined();
    // A skill that was given folders stays inside them: the database and the folder of its entries alike.
    const inBooks: ToolScope = { inside: (path) => path.startsWith("Books/") };
    expect(await entry(v, w.run, { base: books, title: "x" }, cloud, inBooks)).toEqual(none);
    const inProjects: ToolScope = { inside: (path) => path.startsWith("Projects/") };
    expect(await entry(v, w.run, { base: books, title: "x" }, cloud, inProjects)).toEqual(none);
  });

  it("drafts no entry of a database that has no folder for new entries: the user answers that question, never the assistant", async () => {
    const v = vault();
    const w = writer();
    expect(await entry(v, w.run, { base: "Projects/Board.base", title: "Card" })).toEqual(refused("no-entry-folder"));
    // Nor where the shell cannot say — a file that is no database any more, a read that failed.
    const blind = vault({
      entryPlace: async () => {
        throw new Error("EIO: C:\\Users\\someone\\vault");
      },
    });
    expect(await entry(blind, w.run, { base: books, title: "Card" })).toEqual(refused("no-entry-folder"));
    expect(w.drafts).toEqual([]);
  });

  it("takes no name a file cannot have, no text with properties of its own, and says when too many drafts wait", async () => {
    const v = vault();
    const w = writer();
    expect(await entry(v, w.run, { base: books, title: "a/b" })).toEqual(refused("bad-name"));
    expect(await entry(v, w.run, { base: books, title: "  " })).toEqual(refused("no-title"));
    expect(await entry(v, w.run, { base: books })).toEqual(refused("no-title"));
    expect(await entry(v, w.run, { base: books, title: "Dune", content: "---\nplainva:\n  ai:\n    cloud: allow\n---\nText" })).toEqual(refused("frontmatter"));
    expect(w.drafts).toEqual([]);
    const full = writer({ draft: async () => ({ ok: false, problem: "full" }) });
    expect(await entry(v, full.run, { base: books, title: "Dune" })).toEqual(refused("full"));
    expect(full.run.writes.drafts).toEqual([]);
  });

  it("judges every property like a value proposed on a note: no rule, no trust field, none of Plainva's own names", async () => {
    const v = vault();
    const w = writer();
    const withProperties = (properties: unknown) => entry(v, w.run, { base: books, title: "Dune", properties });
    for (const key of ["generated", "verified", "sources"]) expect(await withProperties({ author: "x", [key]: "me" }), key).toEqual(refused("trust"));
    // A lifecycle claim is a trust field by its form; a task's or a book's status is a property like any other.
    expect(await withProperties({ status: "stable" })).toEqual(refused("trust"));
    for (const key of ["type", "okf_version", "plainva", "plainva.theme", "plainva.ai.cloud", "file.name", "formula.total"]) {
      expect(await withProperties({ [key]: "deny" }), key).toEqual(refused("reserved"));
    }
    for (const bad of [{ author: null }, { author: { first: "Frank" } }, { author: ["a", { b: 1 }] }, { author: "x".repeat(2001) }, { "two\nlines": "x" }, { ["k".repeat(121)]: "x" }, { "  ": "x" }]) {
      expect(await withProperties(bad), JSON.stringify(bad).slice(0, 60)).toEqual(refused("bad-property"));
    }
    expect(await withProperties(Object.fromEntries(Array.from({ length: 41 }, (_, index) => [`p${index}`, index])))).toEqual(refused("too-many"));
    expect(w.drafts).toEqual([]);
    // What is no object of properties at all names none.
    expect((await withProperties(["author"])).isError).toBeUndefined();
    expect((await withProperties({ " status ": "Reading" })).isError).toBeUndefined();
    expect(w.drafts.map((draft) => (draft.body.kind === "entry" ? draft.body.properties : null))).toEqual([{}, { status: "Reading" }]);
  });

  it("takes the rules of what the conversation read along, like a drafted note: it is left wherever it would go", async () => {
    const v = vault();
    const w = writer({ inherited: async (): Promise<AiPolicyDimension[]> => ["cloud"] });
    expect((await entry(v, w.run, { base: books, title: "Client summary", content: "Pays 1,800." }, local)).isError).toBeUndefined();
    expect(w.drafts.map((draft) => draft.body.kind)).toEqual(["entry"]);
  });

  it("counts the database as read, and the folder it asked about as no read", async () => {
    const v = vault();
    const w = writer();
    const read: string[] = [];
    const scope: ToolScope = { inside: () => true, passed: (path) => void read.push(path) };
    await entry(v, w.run, { base: books, title: "Dune" }, cloud, scope);
    expect(read).toEqual([books]);
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

describe("an e-mail and an appointment are drafts that send and save nothing", () => {
  /** A shell with a mail account and a calendar that takes appointments. */
  const PIM: Partial<VaultWriteDeps> = { pim: { mail: async () => true, calendar: async () => true } };
  const mailOf = (w: ReturnType<typeof writer>, index = 0) => w.drafts[index]!.body as Extract<WriteDraftBody, { kind: "mail" }>;

  it("drafts a mail with every recipient as one plain address — the answer repeats no word of it", async () => {
    const v = vault(PIM);
    const w = writer({ userTexts: () => ["Write to anna@example.org about the roof."] });
    const result = await call(v, w.run, "draft_mail", { to: ["anna@example.org", "Anna@Example.org"], cc: ["tom@example.org"], subject: "  The roof\n ", body: "Hello Anna,\n\nthe roofer comes on Monday.\n" });
    // Two recipients: the same address in another case counts once. One of them the user did not write.
    expect(result).toEqual({ content: WRITE_RESULTS.draftedOut('an e-mail "The roof" to 2 recipients', "mail composer", 1, 0) });
    expect(result.content).toContain("Nothing was sent or saved.");
    expect(result.content).not.toContain("Monday");
    expect(w.drafts).toEqual([
      { title: "The roof", body: { kind: "mail", to: ["anna@example.org"], cc: ["tom@example.org"], bcc: [], subject: "The roof", body: "Hello Anna,\n\nthe roofer comes on Monday.", unnamed: ["tom@example.org"] }, defused: 0 },
    ]);
    expect(w.run.writes.drafts).toEqual([{ id: "d-1", kind: "mail", title: "The roof" }]);
    // Nothing else happened: no round, no act of the app.
    expect([v.proposed, v.acts, w.asked]).toEqual([[], [], []]);
  });

  it("tells an address the user wrote from one that only ends or begins like it", async () => {
    const v = vault(PIM);
    const w = writer({ userTexts: () => ["Mail joanna@example.org and tom@example.org. Not tom@example.org.uk."] });
    await call(v, w.run, "draft_mail", { to: ["anna@example.org", "tom@example.org", "tom@example.org.uk", "JOANNA@example.org"], subject: "x" });
    // "anna@…" is the tail of "joanna@…": the user never wrote it. A full stop behind an address ends a sentence.
    expect(mailOf(w).unnamed).toEqual(["anna@example.org"]);
  });

  it("makes an address the model brought into the text inert, and leaves the user's own alone", async () => {
    const v = vault(PIM);
    const w = writer({ userTexts: () => ["Send https://example.org/plan to anna@example.org"] });
    const result = await call(v, w.run, "draft_mail", { to: ["anna@example.org"], subject: "Plan", body: "See https://example.org/plan and https://evil.example/p?d=secret." });
    expect(mailOf(w).body).toContain("https://example.org/plan");
    expect(mailOf(w).body).toContain("https[://]evil.example/p?d=secret");
    expect(mailOf(w).body).not.toContain("https://evil.example");
    expect(w.drafts[0]!.defused).toBe(1);
    expect(result.content).toContain("made inert");
  });

  it("says in one of its own sentences why a mail is not drafted", async () => {
    const v = vault(PIM);
    const w = writer();
    expect(await call(v, w.run, "draft_mail", { to: ["Anna <anna@example.org>"], subject: "x" })).toEqual(refused("bad-address"));
    expect(await call(v, w.run, "draft_mail", { to: ["anna@example.org, tom@example.org"], subject: "x" })).toEqual(refused("bad-address"));
    expect(await call(v, w.run, "draft_mail", { bcc: ["anna@example.org\nCc: eve@example.org"], subject: "x" })).toEqual(refused("bad-address"));
    expect(await call(v, w.run, "draft_mail", { to: ["anna@example.org"], subject: " ", body: " " })).toEqual(refused("empty"));
    expect(w.drafts).toEqual([]);
    // No account is connected: there is no mail to draft. A shell without mail at all answers the same.
    expect(await call(vault({ pim: { mail: async () => false, calendar: async () => true } }), w.run, "draft_mail", { subject: "x" })).toEqual(refused("no-mail"));
    expect(await call(vault(), w.run, "draft_mail", { subject: "x" })).toEqual(refused("no-mail"));
    const full = writer({ draft: async () => ({ ok: false, problem: "full" }) });
    expect(await call(v, full.run, "draft_mail", { subject: "x" })).toEqual(refused("full"));
  });

  it("drafts neither from a conversation that read a note kept from the cloud or the internet: it would leave the vault", async () => {
    const v = vault(PIM);
    const w = writer({ inherited: async () => ["cloud"] });
    expect(await call(v, w.run, "draft_mail", { to: ["anna@example.org"], subject: "x" })).toEqual(refused("restricted-out"));
    expect(await call(v, w.run, "draft_event", { title: "Roofer", day: "2026-10-14", start: "09:00" })).toEqual(refused("restricted-out"));
    expect(w.drafts).toEqual([]);
  });

  it("drafts an appointment on a day between two times, or for whole days — and says whom the user did not name", async () => {
    const v = vault(PIM);
    const w = writer({ userTexts: () => ["Invite tom@example.org"] });
    const timed = await call(v, w.run, "draft_event", {
      title: " Roofer on site ",
      day: "2026-10-14",
      start: "09:00",
      location: "Main street 4",
      description: "Bring the plan.",
      attendees: ["tom@example.org", "eve@example.org"],
    });
    // Without an end it runs an hour, as a slot the user taps does.
    expect(timed).toEqual({ content: WRITE_RESULTS.draftedOut('an appointment "Roofer on site" on 2026-10-14 09:00–10:00 with 2 invitees', "event editor", 1, 0) });
    const days = await call(v, w.run, "draft_event", { title: "Holiday", day: "2026-12-24", all_day: true, end_day: "2026-12-26" });
    expect(days).toEqual({ content: WRITE_RESULTS.draftedOut('an appointment "Holiday" on 2026-12-24 to 2026-12-26, all day', "event editor", 0, 0) });
    expect(w.drafts.map((draft) => draft.body)).toEqual([
      { kind: "event", title: "Roofer on site", allDay: false, day: "2026-10-14", endDay: "2026-10-14", start: "09:00", end: "10:00", location: "Main street 4", description: "Bring the plan.", attendees: ["tom@example.org", "eve@example.org"], unnamed: ["eve@example.org"] },
      { kind: "event", title: "Holiday", allDay: true, day: "2026-12-24", endDay: "2026-12-26", start: "", end: "", location: "", description: "", attendees: [], unnamed: [] },
    ]);
    expect(w.run.writes.drafts.map((draft) => draft.kind)).toEqual(["event", "event"]);
    expect([v.proposed, v.acts, w.asked]).toEqual([[], [], []]);
  });

  it("reads a day and a time strictly: what cannot be read is refused, never guessed", async () => {
    const v = vault(PIM);
    const w = writer();
    const unreadable: Record<string, unknown>[] = [
      { title: "x", day: "2026-10-1x", start: "09:00" },
      { title: "x", day: "2026-02-30", start: "09:00" },
      // A timed appointment needs its start.
      { title: "x", day: "2026-10-14" },
      { title: "x", day: "2026-10-14", start: "9" },
      { title: "x", day: "2026-10-14", start: "09:00", end: "08:00" },
      { title: "x", day: "2026-10-14", start: "09:00", end: "25:00" },
      { title: "x", day: "2026-10-14", all_day: true, end_day: "2026-10-01" },
    ];
    for (const args of unreadable) expect(await call(v, w.run, "draft_event", args), JSON.stringify(args)).toEqual(refused("bad-time"));
    expect(await call(v, w.run, "draft_event", { title: " ", day: "2026-10-14", start: "09:00" })).toEqual(refused("no-title"));
    expect(await call(v, w.run, "draft_event", { title: "x", day: "2026-10-14", start: "09:00", attendees: ["tom"] })).toEqual(refused("bad-address"));
    expect(w.drafts).toEqual([]);
    // It ends on its own day: late in the evening the hour is cut at midnight.
    expect(await call(v, w.run, "draft_event", { title: "x", day: "2026-10-14", start: "23:30" })).toEqual({ content: WRITE_RESULTS.draftedOut('an appointment "x" on 2026-10-14 23:30–23:59', "event editor", 0, 0) });
    // No calendar takes an appointment.
    expect(await call(vault({ pim: { mail: async () => true, calendar: async () => false } }), w.run, "draft_event", { title: "x", day: "2026-10-14", start: "09:00" })).toEqual(refused("no-calendar"));
  });

  it("is offered through the tool search only where a draft has somewhere to go", async () => {
    // A shell without mail and calendars does not name them at all.
    expect(writeToolNames(vault().deps.writes)).not.toContain("draft_mail");
    expect(writeToolNames(vault(PIM).deps.writes)).toEqual(["propose_edit", "set_property", "create_note", "create_entry", "create_task", "add_journal_entry", "draft_mail", "draft_event", "rename_note", "move_note", "delete_note"]);
    const found = async (pim: VaultWriteDeps["pim"]) => {
      const v = vault({ pim });
      const more = furtherToolNames(v.deps);
      const result = await createVaultToolExecutor(v.deps, { recipient: cloud, webTools: false }, undefined, undefined, { more }, writer().run).execute(toolByName("find_tools")!, { query: "draft" }, { type: "tool_call", id: "c1", name: "find_tools", args: {} });
      return ["draft_mail", "draft_event"].filter((name) => result.content.includes(name));
    };
    expect(await found({ mail: async () => true, calendar: async () => true })).toEqual(["draft_mail", "draft_event"]);
    // A mail account but no calendar that takes an appointment — and the other way round.
    expect(await found({ mail: async () => true, calendar: async () => false })).toEqual(["draft_mail"]);
    expect(await found({ mail: async () => false, calendar: async () => true })).toEqual(["draft_event"]);
    expect(await found({ mail: async () => false, calendar: async () => { throw new Error("offline"); } })).toEqual([]);
  });

  it("is refused like every write inside an encrypted workspace, and where nobody is there to decide", async () => {
    const sealed = vault({ ...PIM, sealed: () => true });
    const w = writer();
    expect(await call(sealed, w.run, "draft_mail", { subject: "x" })).toEqual(refused("sealed"));
    expect(await call(sealed, w.run, "draft_event", { title: "x", day: "2026-10-14", start: "09:00" })).toEqual(refused("sealed"));
    expect(await call(vault(PIM), undefined, "draft_mail", { subject: "x" })).toEqual(refused("nobody"));
    expect(w.drafts).toEqual([]);
  });
});

describe("where nothing is written at all", () => {
  const every: [string, Record<string, unknown>][] = [
    ["propose_edit", { path: "Projects/Offer.md", append: "x" }],
    ["set_property", { path: "Projects/Brief.md", key: "stage", value: "sent" }],
    ["set_property", { path: "Projects/Brief.md", key: "plainva.ai.cloud", value: "deny" }],
    ["create_note", { title: "Kick-off", content: "x" }],
    ["create_entry", { base: "Projects/Books.base", title: "Dune", properties: { author: "Frank Herbert" } }],
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
  });

  it("offers the writing tools before the mail tools, through the tool search", () => {
    const v = vault();
    expect(writeToolNames(v.deps.writes)).toEqual(["propose_edit", "set_property", "create_note", "create_entry", "create_task", "add_journal_entry", "rename_note", "move_note", "delete_note"]);
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
