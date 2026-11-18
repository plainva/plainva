import { describe, it, expect } from "vitest";
import { boardOrderAfterMove, orderBoardGroups, reorderBoardKeys, reorderShown, UNGROUPED_KEY } from "@plainva/ui";

describe("orderBoardGroups", () => {
  it("defaults to alphabetical with the no-value column last", () => {
    expect(orderBoardGroups(["Beta", UNGROUPED_KEY, "Alpha"])).toEqual(["Alpha", "Beta", UNGROUPED_KEY]);
  });

  it("follows the option order for select/status boards, ad-hoc values appended alphabetically", () => {
    expect(
      orderBoardGroups(["Done", "Zeta", "Open", "In progress", UNGROUPED_KEY], {
        optionOrder: ["Open", "In progress", "Done"],
      })
    ).toEqual(["Open", "In progress", "Done", "Zeta", UNGROUPED_KEY]);
  });

  it("follows the per-view saved order for relation/text boards", () => {
    expect(
      orderBoardGroups(["[[B]]", "[[A]]", "[[C]]"], { savedOrder: ["[[C]]", "[[A]]", "[[B]]"] })
    ).toEqual(["[[C]]", "[[A]]", "[[B]]"]);
  });

  it("gives the option order precedence and positions the rest by saved order", () => {
    expect(
      orderBoardGroups(["Open", "Done", "adhoc", UNGROUPED_KEY], {
        optionOrder: ["Open", "Done"],
        savedOrder: [UNGROUPED_KEY, "adhoc"],
      })
    ).toEqual(["Open", "Done", UNGROUPED_KEY, "adhoc"]);
  });

  it("ignores keys that are absent and de-duplicates repeats", () => {
    expect(orderBoardGroups(["A"], { optionOrder: ["A", "A", "Ghost"] })).toEqual(["A"]);
  });
});

describe("reorderBoardKeys", () => {
  it("moves a key so it sits directly before the target", () => {
    expect(reorderBoardKeys(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(reorderBoardKeys(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"]);
  });

  it("is a no-op when the keys are equal or absent", () => {
    expect(reorderBoardKeys(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    expect(reorderBoardKeys(["a", "b"], "x", "a")).toEqual(["a", "b"]);
  });
});

describe("boardOrderAfterMove (B17)", () => {
  it("keeps a hidden column that was never saved where it stood, before No value", () => {
    const stored = ["active", "paused"];
    const whole = orderBoardGroups(["active", "paused", "done", UNGROUPED_KEY], { savedOrder: stored });
    expect(whole).toEqual(["active", "paused", "done", UNGROUPED_KEY]);
    // The search hides "done"; "paused" is dragged before "active".
    const saved = boardOrderAfterMove(stored, ["paused", "active", UNGROUPED_KEY], whole);
    expect(saved).toEqual(["paused", "active", "done", UNGROUPED_KEY]);
    expect(orderBoardGroups(["active", "paused", "done", UNGROUPED_KEY], { savedOrder: saved })).toEqual(["paused", "active", "done", UNGROUPED_KEY]);
  });

  it("keeps a saved column that is gone (its place waits for it)", () => {
    expect(boardOrderAfterMove(["gone", "a", "b"], ["b", "a", UNGROUPED_KEY], ["a", "b", "c", UNGROUPED_KEY])).toEqual(["gone", "b", "a", "c", UNGROUPED_KEY]);
  });

  it("is the old reorder where the board shows every column", () => {
    const r = (() => { let s = 42; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); })();
    const keys = ["a", "b", "c", "d", "e", UNGROUPED_KEY];
    for (let n = 0; n < 2000; n++) {
      const stored = keys.filter(() => r() < 0.5).sort(() => r() - 0.5);
      const shown = [...keys].sort(() => r() - 0.5);
      expect(boardOrderAfterMove(stored, shown, [...keys].sort(() => r() - 0.5))).toEqual(reorderShown(stored, shown));
      expect(boardOrderAfterMove(stored, shown)).toEqual(reorderShown(stored, shown));
    }
  });
});
