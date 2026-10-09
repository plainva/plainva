import { describe, expect, it } from "vitest";
import { AI_LEDGER_LIMIT, type LedgerEntry } from "../history.js";
import { addMemoryEntry, parseMemory, type MemoryEntry } from "../memory/memoryFile.js";
import { activeMemoryBudget } from "../memory/memoryUse.js";
import { approveInstruction, countObservedRun, EMPTY_INSTRUCTION_APPROVALS, observeInstruction, switchInstruction, type InstructionApprovals } from "../skills/approvals.js";
import { resolveInstructions } from "../skills/catalog.js";
import { parseSkillFile } from "../skills/skillFile.js";
import { appSkillSource, instructionFileHash, type InstructionSource } from "../skills/sources.js";
import {
  alike,
  dismissUpkeep,
  EMPTY_UPKEEP_PREFS,
  memoryUpkeep,
  readUpkeepPrefs,
  serializeUpkeepPrefs,
  shownUpkeep,
  skillUpkeep,
  UPKEEP,
  type SkillUpkeepInput,
  type UpkeepHint,
  type UpkeepTestResult,
} from "./upkeep.js";

/**
 * Upkeep without a model (plan KI-Harness P6-3): what the device says about
 * skills and a memory that have grown — and, as much, what it does not claim.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-10-09T12:00:00.000Z");
const ago = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString();
const day = (days: number): string => ago(days).slice(0, 10);

const BODY = [
  "1. Read the offer the user names and list its positions.",
  "2. Look up last year's rate for each position in the notes under Projects/.",
  "3. Say which positions differ from last year, by how much, and where the rate was found.",
  "4. End with the positions for which no rate was found.",
].join("\n");

function skill(folder: string, description: string, body = BODY, tools: string | null = "search_vault read_note"): InstructionSource {
  const text = `---\nname: ${folder}\ndescription: ${description}\n${tools === null ? "" : `allowed-tools: ${tools}\n`}---\n\n${body}\n`;
  const parsed = parseSkillFile(text, folder);
  const bytes = new TextEncoder().encode(text);
  return {
    id: `.agent/skills/${folder}`,
    kind: "skill",
    origin: "vault",
    root: `.agent/skills/${folder}`,
    files: [{ path: "SKILL.md", bytes: bytes.length, sha256: instructionFileHash(bytes) }],
    text,
    skill: parsed.skill,
    problems: parsed.problems,
    tooLarge: false,
  };
}

/** Approved on this device at `at`, each as it is. */
const approved = (sources: readonly InstructionSource[], at: string, approvals: InstructionApprovals = EMPTY_INSTRUCTION_APPROVALS): InstructionApprovals =>
  sources.reduce((all, source) => approveInstruction(all, source, at, "created"), approvals);

const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
const run = (at: string, over: Partial<LedgerEntry> = {}): LedgerEntry => ({ at, conversationId: "c-1", providerId: "p", model: "m-1", stop: "answered", steps: 1, tools: [], usage, ...over });
const calls = (...names: string[]) => names.map((name) => ({ name, ok: true, ms: 1 }));

const input = (over: Partial<SkillUpkeepInput> & Pick<SkillUpkeepInput, "entries">): SkillUpkeepInput => ({ ledger: [], tests: [], now: NOW, conversations: new Set(["c-1", "c-2", "c-3", "c-4"]), ...over });
const kinds = (hints: readonly UpkeepHint[]) => hints.map((hint) => hint.kind);
const of = <K extends UpkeepHint["kind"]>(hints: readonly UpkeepHint[], kind: K) => hints.filter((hint): hint is Extract<UpkeepHint, { kind: K }> => hint.kind === kind);

describe("how alike two texts are", () => {
  it("is 1 for the same letters and 0 for none in common, whatever the case and the punctuation", () => {
    expect(alike("Checks an offer.", "checks AN offer")).toBe(1);
    expect(alike("Checks an offer.", "Zzz qqq xxx")).toBe(0);
    expect(alike("", "Checks an offer.")).toBe(0);
    expect(alike("", "")).toBe(0);
  });

  it("sees what two texts are made of, however their words are joined", () => {
    const joined = alike("Kundenbrief", "Brief an Kunden");
    expect(joined).toBeGreaterThan(0.4);
    expect(joined).toBeLessThan(1);
    expect(alike("Kundenbrief", "Wochenzahlen")).toBeLessThan(0.1);
  });

  it("knows no meaning: a sentence and its opposite in the same words are close", () => {
    const close = alike("The user wants every answer to name its sources at the end.", "The user wants no answer to name its sources at the end.");
    expect(close).toBeGreaterThan(UPKEEP.alikeEntry);
  });

  it("reads every script", () => {
    expect(alike("会议纪要模板", "会议纪要模板")).toBe(1);
    expect(alike("会议纪要模板", "每周销售数字")).toBe(0);
  });
});

describe("two skills that say almost the same", () => {
  const a = skill("client-letter", "Drafts a letter to a client in the tone of the last three letters to this client.", "Write the letter.\n");
  const b = skill("letter-to-client", "Drafts a letter to a client in the tone of the last letters to that client.", "Compose it.\n");
  const c = skill("weekly-numbers", "Sums up the week's sales figures from the notes under Sales/.", "Add them up.\n");

  it("are named once, as a pair, when both are in force", () => {
    const entries = resolveInstructions([a, b, c], approved([a, b, c], ago(3)));
    const hints = of(skillUpkeep(input({ entries })), "skills-alike");
    expect(hints).toHaveLength(1);
    expect([hints[0]!.a, hints[0]!.b]).toEqual([a.id, b.id]);
  });

  it("are not named while one of them is switched off or waits for its approval", () => {
    const off = resolveInstructions([a, b], switchInstruction(approved([a, b], ago(3)), b.id, false));
    expect(of(skillUpkeep(input({ entries: off })), "skills-alike")).toEqual([]);
    const waiting = resolveInstructions([a, b], approved([a], ago(3)));
    expect(of(skillUpkeep(input({ entries: waiting })), "skills-alike")).toEqual([]);
  });

  it("are found by their instructions too, where the descriptions differ", () => {
    const one = skill("offer-check", "Checks an offer against last year's rates.");
    const two = skill("price-audit", "Looks at what a supplier wants this time.", `${BODY}\n5. Thank the user.`);
    const entries = resolveInstructions([one, two], approved([one, two], ago(3)));
    expect(of(skillUpkeep(input({ entries })), "skills-alike")).toHaveLength(1);
  });

  it("a skill of the vault's own that says what one of the app's says is named; two of the app's never are", () => {
    const app = appSkillSource("weekly-review", "---\nname: weekly-review\ndescription: Looks back at the past seven days and ahead at the coming week, from notes, tasks and appointments.\n---\n\nReview the week.\n");
    const twin = appSkillSource("week-in-review", "---\nname: week-in-review\ndescription: Looks back at the past seven days and ahead at the coming week, from notes, tasks and appointments.\n---\n\nReview the week.\n");
    const own = skill("my-week", "Looks back at the past seven days and ahead at the coming week, from my notes, tasks and appointments.", "Review my week.\n");
    expect(of(skillUpkeep(input({ entries: resolveInstructions([app, twin], EMPTY_INSTRUCTION_APPROVALS) })), "skills-alike")).toEqual([]);
    const hints = of(skillUpkeep(input({ entries: resolveInstructions([app, own], approved([own], ago(3))) })), "skills-alike");
    expect(hints).toHaveLength(1);
    expect(new Set([hints[0]!.a, hints[0]!.b])).toEqual(new Set([app.id, own.id]));
  });

  it("the hint's key holds both versions: a dismissed pair is asked about again once one of them changed", () => {
    const before = of(skillUpkeep(input({ entries: resolveInstructions([a, b], approved([a, b], ago(3))) })), "skills-alike")[0]!;
    const changed = skill("letter-to-client", "Drafts a letter to a client in the tone of the last letters to that client.", "Compose it, briefly.\n");
    const after = of(skillUpkeep(input({ entries: resolveInstructions([a, changed], approved([a, changed], ago(1))) })), "skills-alike")[0]!;
    expect(after.key).not.toBe(before.key);
  });
});

describe("a skill nobody ran for a season", () => {
  const own = skill("weekly-numbers", "Sums up the week's sales figures from the notes under Sales/.");
  const entries = (at: string) => resolveInstructions([own], approved([own], at));

  it("is named with its last run, once it was in force that long", () => {
    const hints = of(skillUpkeep(input({ entries: entries(ago(200)), ledger: [run(ago(120), { skills: [own.id] }), run(ago(2))] })), "skill-unused");
    expect(hints).toEqual([{ kind: "skill-unused", key: `skill-unused:${own.id}:${ago(200)}`, id: own.id, last: ago(120), approved: ago(200) }]);
  });

  it("is named without one where the ledger knows of no run at all", () => {
    expect(of(skillUpkeep(input({ entries: entries(ago(200)) })), "skill-unused")[0]).toMatchObject({ last: null });
  });

  it("is not named while it ran lately, or was approved lately", () => {
    expect(of(skillUpkeep(input({ entries: entries(ago(200)), ledger: [run(ago(30), { skills: [own.id] })] })), "skill-unused")).toEqual([]);
    expect(of(skillUpkeep(input({ entries: entries(ago(20)) })), "skill-unused")).toEqual([]);
  });

  it("a regression run is no use of it", () => {
    const hints = of(skillUpkeep(input({ entries: entries(ago(200)), ledger: [run(ago(5), { skills: [own.id], aside: true })] })), "skill-unused");
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ last: null });
  });

  it("is not claimed where the ledger does not reach back that far", () => {
    // A full ledger whose oldest run is from last month: whether the skill ran before that, nobody knows.
    const full = Array.from({ length: AI_LEDGER_LIMIT }, (_, index) => run(ago(30 - index / AI_LEDGER_LIMIT)));
    expect(of(skillUpkeep(input({ entries: entries(ago(200)), ledger: full })), "skill-unused")).toEqual([]);
    const reaching = [run(ago(100)), ...full.slice(1)];
    expect(of(skillUpkeep(input({ entries: entries(ago(200)), ledger: reaching })), "skill-unused")).toHaveLength(1);
  });

  it("the app's own skills are never named: there would be a dozen of them", () => {
    const app = appSkillSource("weekly-review", "---\nname: weekly-review\ndescription: Looks back at the past seven days.\n---\n\nReview the week.\n");
    expect(of(skillUpkeep(input({ entries: resolveInstructions([app], EMPTY_INSTRUCTION_APPROVALS) })), "skill-unused")).toEqual([]);
  });
});

describe("a skill that names a tool Plainva does not have", () => {
  it("is named with the names, each once", () => {
    const own = skill("fair-follow-up", "Writes the follow-up after a trade fair.", BODY, "search_vault send_mail Bash(git:*) send_mail");
    const hints = of(skillUpkeep(input({ entries: resolveInstructions([own], approved([own], ago(3))) })), "skill-unknown-tool");
    expect(hints).toHaveLength(1);
    expect(hints[0]!.tools).toEqual(["send_mail", "Bash(git:*)"]);
  });

  it("is not named for the tools it has, or without a list", () => {
    const fine = skill("offer-check", "Checks an offer against last year's rates.");
    const open = skill("notes-helper", "Helps with whatever the notes need.", BODY, null);
    expect(of(skillUpkeep(input({ entries: resolveInstructions([fine, open], approved([fine, open], ago(3))) })), "skill-unknown-tool")).toEqual([]);
  });
});

describe("a regression run that fails", () => {
  const own = skill("offer-check", "Checks an offer against last year's rates.");
  const entries = resolveInstructions([own], approved([own], ago(3)));
  const result = (over: Partial<UpkeepTestResult> = {}): UpkeepTestResult => ({ id: own.id, at: ago(1), model: "m-1", failed: 1, ran: 4, ...over });

  it("is named with its numbers and its model", () => {
    expect(of(skillUpkeep(input({ entries, tests: [result()] })), "skill-test-failing")).toEqual([{ kind: "skill-test-failing", key: `skill-test-failing:${own.id}:${ago(1)}`, id: own.id, failed: 1, ran: 4, model: "m-1" }]);
  });

  it("is not named when every scenario passed, or none ran", () => {
    expect(of(skillUpkeep(input({ entries, tests: [result({ failed: 0 })] })), "skill-test-failing")).toEqual([]);
    expect(of(skillUpkeep(input({ entries, tests: [result({ failed: 0, ran: 0 })] })), "skill-test-failing")).toEqual([]);
  });

  it("comes back with the next run that fails, also after it was dismissed", () => {
    const first = of(skillUpkeep(input({ entries, tests: [result()] })), "skill-test-failing")[0]!;
    const next = of(skillUpkeep(input({ entries, tests: [result({ at: ago(0) })] })), "skill-test-failing")[0]!;
    expect(shownUpkeep([next], dismissUpkeep(EMPTY_UPKEEP_PREFS, first.key))).toEqual([next]);
  });
});

describe("a skill whose runs end without an answer", () => {
  const own = skill("offer-check", "Checks an offer against last year's rates.");
  const approvals = approved([own], ago(40));
  const entries = resolveInstructions([own], approvals);
  const used = (at: string, stop: string, conversationId = "c-1", over: Partial<LedgerEntry> = {}) => run(at, { skills: [own.id], stop, conversationId, ...over });

  it("is named once two of its newest five runs failed, with the newest of them to learn from", () => {
    const ledger = [used(ago(9), "limit", "c-1"), used(ago(8), "answered"), used(ago(7), "answered"), used(ago(6), "loop", "c-2"), used(ago(5), "answered")];
    expect(of(skillUpkeep(input({ entries, ledger })), "skill-failing")).toEqual([{ kind: "skill-failing", key: `skill-failing:${own.id}:${ago(6)}`, id: own.id, failed: 2, runs: 5, conversationId: "c-2" }]);
  });

  it("is not named for one failure, nor for failures that lie behind five newer runs", () => {
    expect(of(skillUpkeep(input({ entries, ledger: [used(ago(9), "limit"), used(ago(8), "answered")] })), "skill-failing")).toEqual([]);
    const old = [used(ago(20), "limit"), used(ago(19), "loop"), ...[5, 4, 3, 2, 1].map((days) => used(ago(days), "answered"))];
    expect(of(skillUpkeep(input({ entries, ledger: old })), "skill-failing")).toEqual([]);
  });

  it("counts neither a run the user stopped nor one the provider did not answer", () => {
    const ledger = [used(ago(4), "cancelled"), used(ago(3), "failed"), used(ago(2), "limit"), used(ago(1), "answered")];
    expect(of(skillUpkeep(input({ entries, ledger })), "skill-failing")).toEqual([]);
  });

  it("counts neither a regression run nor a run of the version before", () => {
    const tests = [used(ago(4), "limit", "c-1", { aside: true }), used(ago(3), "loop", "c-2", { aside: true })];
    expect(of(skillUpkeep(input({ entries, ledger: tests })), "skill-failing")).toEqual([]);
    const earlier = [used(ago(60), "limit"), used(ago(50), "loop")];
    expect(of(skillUpkeep(input({ entries, ledger: earlier })), "skill-failing")).toEqual([]);
  });

  it("offers no conversation that is gone, and none that read a stranger's text", () => {
    const ledger = [used(ago(4), "limit", "c-1"), used(ago(3), "loop", "gone"), used(ago(2), "max_tokens", "c-3", { web: { pages: 1, searches: 0, inputTokens: 5, outputTokens: 5 } })];
    expect(of(skillUpkeep(input({ entries, ledger })), "skill-failing")[0]).toMatchObject({ failed: 3, conversationId: "c-1" });
    const none = [used(ago(3), "loop", "gone"), used(ago(2), "limit", "gone")];
    expect(of(skillUpkeep(input({ entries, ledger: none })), "skill-failing")[0]).toMatchObject({ conversationId: null });
  });

  it("is left to the watch where the version is watched and failed: one thing is said once", () => {
    const watched = countObservedRun(observeInstruction(approvals, own.id, ago(40), "old text"), own.id, "failed");
    const ledger = [used(ago(4), "limit"), used(ago(3), "loop")];
    expect(of(skillUpkeep(input({ entries: resolveInstructions([own], watched), ledger })), "skill-failing")).toEqual([]);
  });
});

describe("a way the user went by hand", () => {
  const way = calls("search_vault", "read_note", "read_note", "get_tasks", "propose_edit");
  const went = (at: string, conversationId: string, over: Partial<LedgerEntry> = {}) => run(at, { conversationId, tools: way, ...over });

  it("is named after three conversations, with its tools in the order each was first used", () => {
    const ledger = [went(ago(9), "c-1"), went(ago(5), "c-2"), went(ago(2), "c-3", { tools: calls("search_vault", "read_note", "get_tasks", "read_note", "propose_edit") })];
    expect(of(skillUpkeep(input({ entries: [], ledger })), "steps-repeated")).toEqual([
      { kind: "steps-repeated", key: "steps-repeated:search_vault>read_note>get_tasks>propose_edit", tools: ["search_vault", "read_note", "get_tasks", "propose_edit"], times: 3, conversationId: "c-3" },
    ]);
  });

  it("one conversation counts once, however many of its messages went that way", () => {
    const ledger = [went(ago(9), "c-1"), went(ago(8), "c-1"), went(ago(7), "c-1"), went(ago(5), "c-2")];
    expect(of(skillUpkeep(input({ entries: [], ledger })), "steps-repeated")).toEqual([]);
  });

  it("is not a way: too few steps, a step that failed, a run with a skill, a door's answer, a run without an answer, one from long ago", () => {
    const three = (over: Partial<LedgerEntry>) => [went(ago(9), "c-1", over), went(ago(5), "c-2", over), went(ago(2), "c-3", over)];
    const none = (ledger: LedgerEntry[]) => expect(of(skillUpkeep(input({ entries: [], ledger })), "steps-repeated")).toEqual([]);
    none(three({ tools: calls("search_vault", "read_note", "read_note", "read_note") }));
    none(three({ tools: calls("search_vault", "read_note", "get_tasks") }));
    none(three({ tools: [...way.slice(0, 4), { name: "propose_edit", ok: false, ms: 1 }] }));
    none(three({ skills: ["plainva:weekly-review"] }));
    none(three({ aside: true }));
    none(three({ stop: "limit" }));
    none([went(ago(80), "c-1"), went(ago(70), "c-2"), went(ago(60), "c-3")]);
  });

  it("is not offered where a review could teach no skill: the internet, mail, a foreign server", () => {
    const three = (over: Partial<LedgerEntry>) => [went(ago(9), "c-1", over), went(ago(5), "c-2", over), went(ago(2), "c-3", over)];
    const none = (ledger: LedgerEntry[]) => expect(of(skillUpkeep(input({ entries: [], ledger })), "steps-repeated")).toEqual([]);
    none(three({ web: { pages: 0, searches: 1, inputTokens: 5, outputTokens: 5 } }));
    none(three({ reading: { mailSearches: 0, messages: 1, descriptions: 0, onDevice: false, inputTokens: 5, outputTokens: 5 } }));
  });

  it("leads only to a conversation the history still holds", () => {
    const ledger = [went(ago(9), "c-1"), went(ago(5), "c-2"), went(ago(2), "gone")];
    expect(of(skillUpkeep(input({ entries: [], ledger })), "steps-repeated")).toEqual([]);
    expect(of(skillUpkeep(input({ entries: [], ledger: [...ledger, went(ago(1), "c-4")] })), "steps-repeated")[0]).toMatchObject({ times: 3, conversationId: "c-4" });
  });
});

describe("the order of what is said about skills", () => {
  it("is what fails first and what only grew last", () => {
    const failing = skill("offer-check", "Checks an offer against last year's rates.", BODY, "search_vault read_note send_mail");
    const twin = skill("offer-audit", "Checks an offer against last year's rates and prices.", "Audit it.\n");
    const stale = skill("weekly-numbers", "Sums up the week's sales figures from the notes under Sales/.", "Add them up.\n");
    const approvals = approved([failing, twin, stale], ago(200));
    const ledger = [
      run(ago(4), { skills: [failing.id], stop: "limit" }),
      run(ago(3), { skills: [failing.id], stop: "loop" }),
      run(ago(2), { skills: [twin.id] }),
      ...["c-1", "c-2", "c-3"].map((conversationId, index) => run(ago(index + 1), { conversationId, tools: calls("search_vault", "read_note", "get_tasks", "propose_edit") })),
    ];
    const hints = skillUpkeep(input({ entries: resolveInstructions([failing, twin, stale], approvals), ledger, tests: [{ id: twin.id, at: ago(1), model: "m-1", failed: 2, ran: 3 }] }));
    expect(kinds(hints)).toEqual(["skill-failing", "skill-test-failing", "skill-unknown-tool", "skills-alike", "skill-unused", "steps-repeated"]);
  });
});

describe("the memory", () => {
  const file = (place: "active" | "long", ...lines: [text: string, added: string | null][]): MemoryEntry[] => {
    let text: string | null = null;
    for (const [entry, added] of lines) {
      const next = addMemoryEntry(text, place, entry, added ? { added, by: "user" } : { by: "user" });
      if (!next.ok) throw new Error(`fixture: ${next.problem}`);
      text = next.text;
    }
    return parseMemory(text, place).entries;
  };

  it("two entries that say almost the same are named as a pair, across both places", () => {
    const active = file("active", ["Harbour Studio bills per episode.", day(10)]);
    const long = file("long", ["Harbour Studio bills per episode, not per hour.", day(5)], ["Ms Petersen is my tax adviser.", day(5)]);
    const hints = of(memoryUpkeep({ active, long, over: [], now: NOW }), "entries-alike");
    expect(hints).toHaveLength(1);
    expect(new Set([hints[0]!.a, hints[0]!.b])).toEqual(new Set([active[0]!.id, long[0]!.id]));
  });

  it("short entries are not compared: two words say too little", () => {
    const long = file("long", ["Likes tea.", day(5)], ["Likes tea!", day(4)]);
    expect(of(memoryUpkeep({ active: [], long, over: [], now: NOW }), "entries-alike")).toEqual([]);
  });

  it("an entry older than a year is named, one without a day is not", () => {
    const long = file("long", ["Ms Petersen is my tax adviser.", day(400)], ["Yard 7 wants invoices as PDF.", day(100)], ["Written by hand in the file, without a day.", null]);
    const hints = of(memoryUpkeep({ active: [], long, over: [], now: NOW }), "entry-old");
    expect(hints).toEqual([{ kind: "entry-old", key: `entry-old:${long[0]!.id}`, id: long[0]!.id, added: day(400) }]);
  });

  it("says how many entries of “always included” no longer fit", () => {
    const active = file("active", ...Array.from({ length: 30 }, (_, index): [string, string] => [`Entry number ${index + 1}: ${"a fact about the user's work that takes its room. ".repeat(2)}`, day(3)]));
    const budget = activeMemoryBudget(active);
    expect(budget.over.length).toBeGreaterThan(0);
    const hints = of(memoryUpkeep({ active, long: [], over: budget.over, now: NOW }), "active-overflow");
    expect(hints).toEqual([{ kind: "active-overflow", key: `active-overflow:${budget.over.length}`, left: budget.over.length }]);
    expect(of(memoryUpkeep({ active, long: [], over: [], now: NOW }), "active-overflow")).toEqual([]);
  });

  it("names what goes into every conversation first", () => {
    const active = file("active", ["Harbour Studio bills per episode.", day(400)]);
    const long = file("long", ["Ms Petersen is my tax adviser.", day(500)]);
    expect(of(memoryUpkeep({ active, long, over: [], now: NOW }), "entry-old").map((hint) => hint.id)).toEqual([active[0]!.id, long[0]!.id]);
  });
});

describe("what a device was told not to show again", () => {
  const hints: UpkeepHint[] = [
    { kind: "entry-old", key: "entry-old:a", id: "a", added: "2025-01-01" },
    { kind: "entry-old", key: "entry-old:b", id: "b", added: "2025-01-02" },
    { kind: "entry-old", key: "entry-old:c", id: "c", added: "2025-01-03" },
    { kind: "entry-old", key: "entry-old:d", id: "d", added: "2025-01-04" },
    { kind: "active-overflow", key: "active-overflow:2", left: 2 },
  ];

  it("shows the first few of a kind, and the next one once one is settled", () => {
    expect(shownUpkeep(hints, EMPTY_UPKEEP_PREFS).map((hint) => hint.key)).toEqual(["entry-old:a", "entry-old:b", "entry-old:c", "active-overflow:2"]);
    expect(shownUpkeep(hints, dismissUpkeep(EMPTY_UPKEEP_PREFS, "entry-old:b")).map((hint) => hint.key)).toEqual(["entry-old:a", "entry-old:c", "entry-old:d", "active-overflow:2"]);
  });

  it("is kept as a list that survives its file, and a file that does not read dismisses nothing", () => {
    const prefs = dismissUpkeep(dismissUpkeep(EMPTY_UPKEEP_PREFS, "entry-old:a"), "entry-old:a");
    expect(prefs.dismissed).toEqual(["entry-old:a"]);
    expect(readUpkeepPrefs(serializeUpkeepPrefs(prefs))).toEqual(prefs);
    expect(readUpkeepPrefs("{ no json")).toEqual(EMPTY_UPKEEP_PREFS);
    expect(readUpkeepPrefs(JSON.stringify({ version: 1, dismissed: ["a", 3, "", "a"] }))).toEqual({ dismissed: ["a"] });
    expect(readUpkeepPrefs(null)).toEqual(EMPTY_UPKEEP_PREFS);
  });

  it("forgets the oldest past its bound", () => {
    let prefs = EMPTY_UPKEEP_PREFS;
    for (let index = 0; index < UPKEEP.dismissedMax + 5; index++) prefs = dismissUpkeep(prefs, `k-${index}`);
    expect(prefs.dismissed).toHaveLength(UPKEEP.dismissedMax);
    expect(prefs.dismissed[0]).toBe("k-5");
  });
});
