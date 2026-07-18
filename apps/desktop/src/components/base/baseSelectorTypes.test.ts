import { describe, it, expect } from "vitest";
import { baseSelectorAcceptsInput, columnsForBaseSelector } from "@plainva/ui";

describe("baseSelectorAcceptsInput", () => {
  it("date field accepts only date / datetime", () => {
    expect(baseSelectorAcceptsInput("dateField", "date")).toBe(true);
    expect(baseSelectorAcceptsInput("dateField", "datetime")).toBe(true);
    expect(baseSelectorAcceptsInput("dateField", "text")).toBe(false);
    expect(baseSelectorAcceptsInput("dateField", undefined)).toBe(false);
  });

  it("board grouping accepts curated-option and relation types (and reverse columns)", () => {
    for (const t of ["select", "status", "multiselect", "relation", "link"]) {
      expect(baseSelectorAcceptsInput("boardGroup", t)).toBe(true);
    }
    expect(baseSelectorAcceptsInput("boardGroup", "text")).toBe(false);
    expect(baseSelectorAcceptsInput("boardGroup", "date")).toBe(false);
    // A computed reverse column has no own input but is a relation.
    expect(baseSelectorAcceptsInput("boardGroup", undefined, true)).toBe(true);
    expect(baseSelectorAcceptsInput("boardGroup", undefined, false)).toBe(false);
  });

  it("gallery cover accepts text/url and untyped (image references live in text)", () => {
    expect(baseSelectorAcceptsInput("galleryCover", "text")).toBe(true);
    expect(baseSelectorAcceptsInput("galleryCover", "url")).toBe(true);
    expect(baseSelectorAcceptsInput("galleryCover", undefined)).toBe(true);
    expect(baseSelectorAcceptsInput("galleryCover", "")).toBe(true);
    expect(baseSelectorAcceptsInput("galleryCover", "number")).toBe(false);
    expect(baseSelectorAcceptsInput("galleryCover", "relation")).toBe(false);
  });
});

describe("columnsForBaseSelector", () => {
  const inputs: Record<string, string | undefined> = {
    due: "date",
    when: "datetime",
    status: "status",
    tags: "multiselect",
    title: "text",
    link: "url",
    count: "number",
    project: "relation",
    untyped: undefined,
  };
  const getInput = (c: string) => inputs[c];
  const cols = Object.keys(inputs);

  it("date field keeps only date/datetime columns", () => {
    expect(columnsForBaseSelector("dateField", cols, getInput)).toEqual(["due", "when"]);
  });

  it("board grouping keeps curated/relation columns (+ reverse via isReverse)", () => {
    expect(columnsForBaseSelector("boardGroup", cols, getInput)).toEqual(["status", "tags", "project"]);
    expect(
      columnsForBaseSelector("boardGroup", ["rev", "status"], getInput, { isReverse: (c) => c === "rev" }),
    ).toEqual(["rev", "status"]);
  });

  it("gallery cover keeps text/url/untyped columns", () => {
    expect(columnsForBaseSelector("galleryCover", cols, getInput)).toEqual(["title", "link", "untyped"]);
  });

  it("always keeps the current value, even when its type is incompatible", () => {
    // An existing board grouped by a free-text column must not silently drop.
    expect(columnsForBaseSelector("boardGroup", cols, getInput, { current: "title" })).toEqual([
      "title",
      "status",
      "tags",
      "project",
    ]);
    // A current value already in the compatible set is not duplicated.
    expect(columnsForBaseSelector("dateField", cols, getInput, { current: "due" })).toEqual(["due", "when"]);
    // A current value that isn't a column at all is ignored.
    expect(columnsForBaseSelector("dateField", cols, getInput, { current: "ghost" })).toEqual(["due", "when"]);
  });
});
