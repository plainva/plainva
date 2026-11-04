import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import { MEMORY_LIMITS, activeMemoryBudget, parseMemory } from "@plainva/core";
import { EMPTY_MEMORY_STATE, MEMORY_SEARCH_FROM, filterMemoryRows, memoryDescription, memoryGroups, memoryProblemText, memoryRowActions, memorySummary, type AiMemoryState } from "@plainva/ui";

/** The memory's one model for both shells (plan KI-Harness P6, mockup chapter 22). */

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars);

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

function state(active: string, long = "", over: Partial<AiMemoryState> = {}): AiMemoryState {
  const entries = parseMemory(active, "active").entries;
  return { ...EMPTY_MEMORY_STATE, loaded: true, available: true, writable: true, on: true, active: entries, long: parseMemory(long, "long").entries, budget: activeMemoryBudget(entries), ...over };
}

describe("the memory as both shells show it", () => {
  it("a row is the entry's text, who added it and when — and the conversation it came from", () => {
    const groups = memoryGroups(
      t,
      state(
        [
          "- I write offers for film studios. <!-- plainva: added=2026-10-01; by=user -->",
          "- I prefer short offers. <!-- plainva: added=2026-10-08; by=assistant; source=Offer for Harbour Studio -->",
          "- Written by hand in the editor.",
        ].join("\n"),
      ),
      "en",
    );
    expect(groups.active.map((row) => `${row.text} | ${row.description}`)).toEqual([
      "I write offers for film studios. | Added by you on Oct 1, 2026",
      "I prefer short offers. | Suggested by the AI, accepted on Oct 8, 2026 · Conversation: Offer for Harbour Studio",
      "Written by hand in the editor. | Written in the file",
    ]);
    expect(groups.active.every((row) => !row.blocked && row.marks.length === 0)).toBe(true);
  });

  it("the day is written in the reader's language", () => {
    const entry = parseMemory("- A. <!-- plainva: added=2026-10-01; by=user -->", "active").entries[0]!;
    expect(memoryDescription((key, vars) => `${key} ${String(vars?.day ?? "")}`.trim(), entry, "de")).toBe("ai.memory.by.userOn 1. Okt. 2026");
  });

  it("a rule an entry carries is a mark in words; an entry that reaches no model says why", () => {
    const long = "x".repeat(MEMORY_LIMITS.entryChars + 1);
    const groups = memoryGroups(
      t,
      state(["- Day rate 950. <!-- plainva: deny=cloud,web -->", "- Broken. <!-- plainva: deny=clod -->", `- ${long}`, "- Seen <!-- a note to a model --> by nobody."].join("\n")),
      "en",
    );
    expect(groups.active.map((row) => [row.blocked, ...row.marks.map((mark) => `${mark.kind}: ${mark.text}`)])).toEqual([
      [false, "rule: Not to cloud models", "rule: Not in conversations with the internet"],
      [true, "problem: Rules unreadable — goes to no model"],
      [true, "problem: Longer than 500 characters — not used"],
      [false, "problem: 1 hidden part left out"],
    ]);
  });

  it("“always included” says how full it is, and marks what no longer fits", () => {
    const entry = (n: number) => `- Entry ${n} ${"x".repeat(440)}.`;
    const groups = memoryGroups(t, state([1, 2, 3, 4, 5].map(entry).join("\n")), "en");
    expect(groups.budget).toBe("1,796 of 2,000 characters");
    expect(groups.fill).toBeCloseTo(0.898, 3);
    expect(groups.left).toBe(204);
    expect(groups.active.map((row) => row.blocked)).toEqual([false, false, false, false, true]);
    expect(groups.active[4]!.marks).toEqual([{ kind: "problem", text: "No room left — not included" }]);
    // The budget is "always included"'s alone: an entry of "on demand" is never over it.
    expect(memoryGroups(t, state("", [1, 2, 3, 4, 5].map(entry).join("\n")), "en").long.every((row) => !row.blocked)).toBe(true);
  });

  it("the search over “on demand” keeps the rows that hold every word, in the file's order", () => {
    const groups = memoryGroups(t, state("", ["- Harbour Studio pays within 14 days.", "- Yard 7 wants invoices as PDF.", "- Harbour Studio bills per episode."].join("\n")), "en");
    expect(filterMemoryRows(groups.long, "harbour  studio").map((row) => row.text)).toEqual(["Harbour Studio pays within 14 days.", "Harbour Studio bills per episode."]);
    expect(filterMemoryRows(groups.long, "studio pdf")).toEqual([]);
    expect(filterMemoryRows(groups.long, "  ")).toHaveLength(3);
    // What a row says of itself is searched too.
    expect(filterMemoryRows(groups.long, "written in the file")).toHaveLength(3);
    expect(MEMORY_SEARCH_FROM).toBeGreaterThan(3);
  });

  it("the settings say it in one line", () => {
    expect(memorySummary(t, state("- One.\n- Two.", "- Three."))).toBe("2 always included · 1 on demand");
    expect(memorySummary(t, state(""))).toBe("Nothing in it yet");
    expect(memorySummary(t, state("- One.", "", { on: false }))).toBe("Off on this device");
    expect(memorySummary(t, EMPTY_MEMORY_STATE)).toBe(t("ai.memory.unavailable"));
  });

  it("says in the reader's words why an entry was not written", () => {
    expect(memoryProblemText(t, "empty")).toBe("The entry is empty.");
    expect(memoryProblemText(t, "too-long")).toBe("An entry holds at most 500 characters.");
    expect(memoryProblemText(t, "lines")).toContain("single line");
    expect(memoryProblemText(t, "duplicate")).toContain("word for word");
    expect(memoryProblemText(t, "gone")).toContain("no longer in the file");
    for (const problem of ["no-vault", "unavailable", "write-failed"] as const) expect(memoryProblemText(t, problem)).toBe("The memory could not be changed.");
  });
});

describe("what can be done with an entry", () => {
  it("is one list for the desktop's menu and the phone's sheet: edit, move, delete — only what the row offers", () => {
    const run = () => {};
    expect(memoryRowActions(t, { edit: run, toLong: run, delete: run }).map((action) => `${action.id}: ${action.label}${action.danger ? " (danger)" : ""}`)).toEqual(["edit: Edit", "toLong: Only on demand", "delete: Delete (danger)"]);
    expect(memoryRowActions(t, { toActive: run }).map((action) => action.label)).toEqual(["Always include"]);
    expect(memoryRowActions(t, {})).toEqual([]);
  });
});
