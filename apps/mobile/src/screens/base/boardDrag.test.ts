import { describe, expect, it } from "vitest";
import { UNGROUPED_KEY } from "@plainva/ui";
import { boardDropValue } from "./boardDrag";

describe("boardDropValue (E1 board card drag)", () => {
  it("moves a scalar value to the target column", () => {
    expect(boardDropValue("Offen", "Offen", "Erledigt")).toBe("Erledigt");
  });

  it("clears a scalar value when dropped on the ungrouped column", () => {
    expect(boardDropValue("Offen", "Offen", UNGROUPED_KEY)).toBe("");
  });

  it("swaps only the dragged entry inside a multi-value cell", () => {
    expect(boardDropValue(["Offen", "dringend"], "Offen", "Erledigt")).toEqual([
      "Erledigt",
      "dringend",
    ]);
  });

  it("removes the dragged entry when a multi-value cell drops on ungrouped", () => {
    expect(boardDropValue(["Offen", "dringend"], "Offen", UNGROUPED_KEY)).toEqual(["dringend"]);
  });

  it("matches wiki-link entries by their display text", () => {
    expect(boardDropValue(["[[Projekt A]]", "[[Projekt B]]"], "Projekt A", "Projekt C")).toEqual([
      "Projekt C",
      "[[Projekt B]]",
    ]);
  });

  it("writes the target even when the source value was empty", () => {
    expect(boardDropValue(undefined, UNGROUPED_KEY, "Offen")).toBe("Offen");
  });
});
