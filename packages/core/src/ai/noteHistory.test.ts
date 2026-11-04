import { describe, expect, it } from "vitest";
import { daysBetween, dayChanges, endOfLocalDay, lastKeptWithin, localDay, NOTE_HISTORY_DAY_CHARS, stateBefore, stateHolding, startOfLocalDay, type KeptState } from "./noteHistory.js";
import { toolByName } from "./tools.js";

/** Plan KI-Harness P9-1: how notes developed, from the version history this device keeps. */

const at = (day: number, hours = 12) => new Date(2026, 9, day, hours).getTime();
// Each kept state is the text before the write it was taken for: before the write of the 3rd, of the 5th, of the 9th.
const KEPT: KeptState[] = [
  { id: "v9", at: at(9) },
  { id: "v3", at: at(3) },
  { id: "v5", at: at(5) },
];

describe("a note's state at a moment", () => {
  it("is the first state kept after it, and the text now where none was kept after it", () => {
    expect(stateHolding(KEPT, at(1))?.id).toBe("v3");
    expect(stateHolding(KEPT, at(3))?.id).toBe("v5");
    expect(stateHolding(KEPT, at(4))?.id).toBe("v5");
    expect(stateHolding(KEPT, at(9))).toBeNull();
    expect(stateHolding([], at(1))).toBeNull();
  });

  it("a period starts at the state kept after its beginning, else at the newest kept before it — as a folder's log does", () => {
    expect(stateBefore(KEPT, at(4))?.id).toBe("v5");
    expect(stateBefore(KEPT, at(10))?.id).toBe("v9");
    expect(stateBefore([], at(10))).toBeNull();
  });

  it("knows the last write within a span by the last state kept in it", () => {
    expect(lastKeptWithin(KEPT, at(2), at(6))).toBe(at(5));
    expect(lastKeptWithin(KEPT, at(10), at(20))).toBeNull();
  });
});

describe("days", () => {
  it("are local days, read back exactly; a day that does not exist is none", () => {
    expect(localDay(new Date(2026, 9, 5, 23, 59))).toBe("2026-10-05");
    expect(startOfLocalDay("2026-10-05")?.getTime()).toBe(new Date(2026, 9, 5).getTime());
    expect(startOfLocalDay("2026-02-30")).toBeNull();
    expect(startOfLocalDay("5.10.2026")).toBeNull();
    expect(endOfLocalDay(new Date(2026, 9, 31)).getTime()).toBe(new Date(2026, 10, 1).getTime());
  });

  it("a span lists its days, both ends included, and refuses one that runs backwards or longer than allowed", () => {
    expect(daysBetween(new Date(2026, 9, 30), new Date(2026, 10, 2))).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(daysBetween(new Date(2026, 9, 5), new Date(2026, 9, 4))).toBeNull();
    expect(daysBetween(new Date(2026, 9, 1), new Date(2026, 9, 31))).toHaveLength(31);
    expect(daysBetween(new Date(2026, 8, 30), new Date(2026, 9, 31))).toBeNull();
  });
});

describe("what a note gained day by day", () => {
  it("names the lines each day added and counts the ones it lost — never their text — and leaves quiet days out", () => {
    const start = "# Plan\n\nBudget: open.\nKick-off on Monday.\n";
    const days = [
      { day: "2026-10-01", text: start },
      { day: "2026-10-02", text: "# Plan\n\nBudget: 12,000 € agreed with Tom.\nKick-off on Monday.\n" },
      { day: "2026-10-03", text: "# Plan\n\nBudget: 12,000 € agreed with Tom.\nKick-off on Monday.\n" },
      { day: "2026-10-04", text: "# Plan\n\nBudget: 12,000 € agreed with Tom.\nKick-off on Monday.\nDecision: hosting at the studio.\n" },
    ];
    const changes = dayChanges(start, days);
    expect(changes).toEqual([
      { day: "2026-10-02", shown: "Budget: 12,000 € agreed with Tom.", added: 1, removed: 1 },
      { day: "2026-10-04", shown: "Decision: hosting at the studio.", added: 1, removed: 0 },
    ]);
    expect(JSON.stringify(changes)).not.toContain("Budget: open.");
  });

  it("compares what the note says — a day on which only its properties changed is a quiet day", () => {
    const head = (mood: number) => `---\nmood: ${mood}\nplainva:\n  tasks: false\n---\n`;
    const changes = dayChanges(`${head(4)}# Day\n\nCalled the studio.\n`, [
      { day: "2026-10-01", text: `${head(1)}# Day\n\nCalled the studio.\n` },
      { day: "2026-10-02", text: `${head(2)}# Day\n\nCalled the studio.\nThe offer went out.\n` },
    ]);
    expect(changes).toEqual([{ day: "2026-10-02", shown: "The offer went out.", added: 1, removed: 0 }]);
  });

  it("cuts a day's gained lines at a line end", () => {
    const many = Array.from({ length: 60 }, (_, i) => `Line ${i} of a long day's work`).join("\n");
    const [change] = dayChanges("", [{ day: "2026-10-01", text: many }]);
    expect(change!.added).toBe(60);
    expect(change!.shown.length).toBeLessThanOrEqual(NOTE_HISTORY_DAY_CHARS);
    expect(change!.shown.endsWith("work")).toBe(true);
  });
});

describe("the two tools", () => {
  it("read notes, are found rather than loaded, and are Plainva's own — no other app reads a note's history", () => {
    for (const name of ["get_changes", "get_note_history"]) {
      expect(toolByName(name), name).toMatchObject({ risk: "read", core: false, untrustedResult: true, dataClasses: ["notes"], surfaces: ["harness"] });
    }
  });
});
