import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import {
  addMemoryEntry,
  approveInstruction,
  EMPTY_INSTRUCTION_APPROVALS,
  instructionFileHash,
  parseMemory,
  parseSkillFile,
  resolveInstructions,
  switchInstruction,
  type InstructionSource,
  type MemoryEntry,
  type UpkeepHint,
} from "@plainva/core";
import { APP_SKILL_SOURCES, skillCompareFacts, upkeepRowActions, upkeepRows, upkeepTitle } from "@plainva/ui";

/**
 * Upkeep hints as both shells show them (plan KI-Harness P6-3): each hint as
 * a sentence of the app's own, why it counts, and the one step it offers —
 * and the comparison of two skills. One model for the desktop's card and the
 * phone's rows.
 */

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);

function skill(folder: string, description: string, body: string, tools = "search_vault read_note"): InstructionSource {
  const text = `---\nname: ${folder}\ndescription: ${description}\nallowed-tools: ${tools}\n---\n\n${body}\n`;
  const parsed = parseSkillFile(text, folder);
  const bytes = new TextEncoder().encode(text);
  return { id: `.agent/skills/${folder}`, kind: "skill", origin: "vault", root: `.agent/skills/${folder}`, files: [{ path: "SKILL.md", bytes: bytes.length, sha256: instructionFileHash(bytes) }], text, skill: parsed.skill, problems: parsed.problems, tooLarge: false };
}
const LETTER = skill("client-letter", "Drafts a letter to a client in the tone of the last three letters.", "1. Read the last three letters.\n2. Write the letter.");
const TWIN = skill("letter-to-client", "Drafts a letter to a client in the tone of the last letters.", "1. Read the last letters.\n2. Compose it.");
const sources = [...APP_SKILL_SOURCES, LETTER, TWIN];
const approvals = [LETTER, TWIN].reduce((all, source) => approveInstruction(all, source, "2026-03-01T09:00:00.000Z", "created"), EMPTY_INSTRUCTION_APPROVALS);
const entries = resolveInstructions(sources, approvals);
const A = LETTER.id;
const B = TWIN.id;

const memoryOf = (place: "active" | "long", ...lines: [string, string][]): MemoryEntry[] => {
  let text: string | null = null;
  for (const [entry, added] of lines) {
    const next = addMemoryEntry(text, place, entry, { added, by: "user" });
    if (!next.ok) throw new Error(next.problem);
    text = next.text;
  }
  return parseMemory(text, place).entries;
};
const active = memoryOf("active", ["Harbour Studio bills per episode.", "2026-09-01"]);
const long = memoryOf("long", ["Harbour Studio bills per episode, not per hour.", "2026-10-01"], ["Ms Petersen is my tax adviser.", "2025-03-04"]);
const context = { entries, memory: { active, long }, language: "en" };
const rowsOf = (hints: UpkeepHint[]) => upkeepRows(t, hints, context);

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("a hint as a row", () => {
  it("two skills that say almost the same: both by name, why it counts, and “Compare”", () => {
    expect(rowsOf([{ kind: "skills-alike", key: "k1", a: A, b: B }])).toEqual([
      {
        key: "k1",
        kind: "skills-alike",
        label: "“client-letter” and “letter-to-client” say almost the same",
        desc: "Two skills for the same job: the AI picks one or the other.",
        step: { label: "Compare", what: { do: "compare-skills", a: A, b: B } },
      },
    ]);
  });

  it("a skill nobody ran: its last run, or since when it has not run here — and “Switch off”", () => {
    const [ran, never] = rowsOf([
      { kind: "skill-unused", key: "k1", id: A, last: "2026-07-02T08:00:00.000Z", approved: "2026-03-01T09:00:00.000Z" },
      { kind: "skill-unused", key: "k2", id: A, last: null, approved: "2026-03-01T09:00:00.000Z" },
    ]);
    expect(ran!.label).toBe("“client-letter” last ran on Jul 2, 2026");
    expect(never!.label).toBe("“client-letter” has not run here since Mar 1, 2026");
    expect(ran!.desc).toBe("Not used for more than 90 days. Switched off, it is no longer in the catalog, but it stays in the vault.");
    expect(ran!.step).toEqual({ label: "Switch off", what: { do: "switch-off", id: A, name: "client-letter" } });
  });

  it("a tool that does not exist, a test that failed: what was found, in the app's own words", () => {
    const [tool, test] = rowsOf([
      { kind: "skill-unknown-tool", key: "k1", id: A, tools: ["send_mail", "Bash(git:*)"] },
      { kind: "skill-test-failing", key: "k2", id: B, failed: 1, ran: 4, model: "m-1" },
    ]);
    expect(tool).toMatchObject({ label: "“client-letter”: not every tool on its list exists", desc: "Not a tool of Plainva's: send_mail · Bash(git:*). The skill runs without.", step: { label: "Open file", what: { do: "open-skill", id: A } } });
    expect(test).toMatchObject({ label: "“letter-to-client” did not pass its test: 1 of 4 failed", desc: "Tested as it is now, with m-1.", step: { label: "Test again", what: { do: "test", id: B } } });
  });

  it("runs that end without an answer: a review where one could teach, the file where none can", () => {
    const [learn, open] = rowsOf([
      { kind: "skill-failing", key: "k1", id: A, failed: 2, runs: 5, conversationId: "c-9" },
      { kind: "skill-failing", key: "k2", id: A, failed: 2, runs: 2, conversationId: null },
    ]);
    expect(learn).toMatchObject({
      label: "“client-letter”: 2 of its last 5 runs ended without an answer",
      desc: "A review of the last such run can suggest other instructions. It costs one request and asks first.",
      step: { label: "Review the run", what: { do: "learn", conversationId: "c-9" } },
    });
    expect(open).toMatchObject({ desc: "Its instructions may ask for more than one run can do.", step: { label: "Open file", what: { do: "open-skill", id: A } } });
  });

  it("a way gone by hand: the tools in the reader's words, and a review that asks first", () => {
    const [row] = rowsOf([{ kind: "steps-repeated", key: "k1", tools: ["search_vault", "read_note", "get_tasks"], times: 3, conversationId: "c-3" }]);
    expect(row!.label).toBe("You went the same way in 3 conversations");
    expect(row!.desc).toBe(`${t("ai.tool.search_vault")} → ${t("ai.tool.read_note")} → ${t("ai.tool.get_tasks")}. A review of the last one can suggest a skill for it. It costs one request and asks first.`);
    expect(row!.step).toEqual({ label: "Suggest a skill", what: { do: "learn", conversationId: "c-3" } });
  });

  it("the memory: two entries with their words, an old one with its day, and what no longer fits — which has no step", () => {
    const [alike, old, over] = rowsOf([
      { kind: "entries-alike", key: "k1", a: active[0]!.id, b: long[0]!.id },
      { kind: "entry-old", key: "k2", id: long[1]!.id, added: "2025-03-04" },
      { kind: "active-overflow", key: "k3", left: 2 },
    ]);
    expect(alike).toMatchObject({
      label: "Two entries say almost the same",
      desc: "“Harbour Studio bills per episode.” · “Harbour Studio bills per episode, not per hour.”",
      step: { label: "Compare", what: { do: "compare-entries", a: active[0]!.id, b: long[0]!.id } },
    });
    expect(old).toMatchObject({ label: "“Ms Petersen is my tax adviser.”", desc: "Added on Mar 4, 2025 — more than a year ago. Is it still true?", step: { label: "Edit", what: { do: "edit-entry", id: long[1]!.id } } });
    expect(over).toMatchObject({ label: "“Always included” is full", desc: "Entries that no longer fit: 2. They go along with no conversation. Shorten an entry, or move one to “On demand”.", step: null });
  });

  it("a hint about something that is gone in the meantime is no row", () => {
    expect(rowsOf([{ kind: "skills-alike", key: "k1", a: A, b: ".agent/skills/gone" }, { kind: "entry-old", key: "k2", id: "long:gone:0", added: "2025-03-04" }, { kind: "skill-unused", key: "k3", id: ".agent/skills/gone", last: null, approved: "2026-03-01T09:00:00.000Z" }])).toEqual([]);
  });

  it("a card's name counts its hints, and a row can do two things: its step, and be put away", () => {
    expect(upkeepTitle(t, 3)).toBe("Tidy up · 3");
    expect(upkeepTitle(t, 0)).toBe("Tidy up");
    const noop = () => undefined;
    expect(upkeepRowActions(t, { step: noop, stepLabel: "Compare", dismiss: noop }).map((action) => [action.id, action.label])).toEqual([
      ["step", "Compare"],
      ["dismiss", "Don't show again"],
    ]);
    // A hint without a step can still be put away.
    expect(upkeepRowActions(t, { dismiss: noop }).map((action) => action.id)).toEqual(["dismiss"]);
  });
});

describe("two skills side by side", () => {
  const find = (id: string) => entries.find((entry) => entry.source.id === id) ?? null;

  it("says what each is for and may do, and holds the second's instructions against the first's", () => {
    const facts = skillCompareFacts(t, find(A), find(B), "en")!;
    expect(facts.title).toBe("“client-letter” and “letter-to-client”");
    expect(facts.sides.map((side) => [side.id, side.title, side.description])).toEqual([
      [A, "client-letter", "Drafts a letter to a client in the tone of the last three letters."],
      [B, "letter-to-client", "Drafts a letter to a client in the tone of the last letters."],
    ]);
    expect(facts.sides[0].may.length).toBeGreaterThan(0);
    expect(facts.same).toBe(false);
    expect(facts.lines!.filter((line) => line.type !== "skip").map((line) => line.type)).toContain("add");
  });

  it("says so where the instructions are the same, and is nothing once one of the two is no longer in force", () => {
    const copy = skill("letter-copy", "Another description altogether, for the same steps.", "1. Read the last three letters.\n2. Write the letter.");
    const both = resolveInstructions([LETTER, copy], [LETTER, copy].reduce((all, source) => approveInstruction(all, source, "2026-03-01T09:00:00.000Z", "created"), EMPTY_INSTRUCTION_APPROVALS));
    expect(skillCompareFacts(t, both[0]!, both[1]!, "en")).toMatchObject({ same: true, lines: null });
    const off = resolveInstructions(sources, switchInstruction(approvals, B, false));
    expect(skillCompareFacts(t, off.find((entry) => entry.source.id === A)!, off.find((entry) => entry.source.id === B)!, "en")).toBeNull();
    expect(skillCompareFacts(t, find(A), null, "en")).toBeNull();
  });

  it("names an app skill by the reader's words for it", () => {
    const app = find("plainva:memory-care");
    const facts = skillCompareFacts(t, app, find(A), "en")!;
    expect(facts.sides[0]).toMatchObject({ id: "plainva:memory-care", title: "Memory care", description: "Find entries of the memory that say the same, contradict each other or are out of date." });
  });
});
