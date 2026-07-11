import { describe, it, expect } from "vitest";
import { orderBoardGroups, reorderBoardKeys, UNGROUPED_KEY } from "@plainva/ui";

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
