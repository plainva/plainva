import { describe, it, expect } from "vitest";
import {
  inferType,
  coerceForType,
  defaultValueForType,
  formatDateValue,
  parseLocalDate,
  tagSegments,
  stripWikiLink,
  toWikiLink,
  chipColorIndex,
  chipPaletteIndex,
  filterTagSuggestions,
  normalizeFrontmatterValue,
  chipClass,
  groupOptions,
  baseInputToType,
  inlineOptionsFrom,
  mergeObservedOptions,
  splitMultiValue,
  columnValuesAreWikiLinks,
} from "@plainva/ui";

describe("propertyModel.inferType", () => {
  it("infers primitives", () => {
    expect(inferType(true, "done")).toBe("checkbox");
    expect(inferType(42, "n")).toBe("number");
    expect(inferType("hello", "x")).toBe("text");
  });
  it("infers tags vs list vs link arrays", () => {
    expect(inferType(["a", "b"], "tags")).toBe("tags");
    expect(inferType(["a", "b"], "topics")).toBe("list");
    expect(inferType(["[[A]]", "[[B]]"], "related")).toBe("link");
  });
  it("infers date / datetime / url / email / wikilink strings", () => {
    expect(inferType("2026-03-28", "date")).toBe("date");
    expect(inferType("2026-03-28T21:45", "ts")).toBe("datetime");
    expect(inferType("https://example.com", "site")).toBe("url");
    expect(inferType("me@example.com", "mail")).toBe("email");
    expect(inferType("[[Other Note]]", "rel")).toBe("link");
  });
  it("never infers option types (select/status/multiselect are explicit)", () => {
    expect(inferType("final", "status")).toBe("text");
  });
});

describe("propertyModel.coerceForType", () => {
  it("coerces to list from comma string and array", () => {
    expect(coerceForType("a, b ,c", "list")).toEqual(["a", "b", "c"]);
    expect(coerceForType(["x"], "tags")).toEqual(["x"]);
    expect(coerceForType("", "multiselect")).toEqual([]);
  });
  it("coerces number and checkbox", () => {
    expect(coerceForType("7", "number")).toBe(7);
    expect(coerceForType("nope", "number")).toBe(0);
    expect(coerceForType("true", "checkbox")).toBe(true);
    expect(coerceForType("", "checkbox")).toBe(false);
  });
  it("coerces a list back to a comma string for plain text", () => {
    expect(coerceForType(["a", "b"], "text")).toBe("a, b");
    expect(coerceForType(null, "text")).toBe("");
  });
  it("keeps a valid ISO date and derives one otherwise", () => {
    expect(coerceForType("2026-03-28", "date")).toBe("2026-03-28");
    expect(coerceForType("", "date")).toBe("");
  });
});

describe("propertyModel.defaultValueForType", () => {
  it("returns sensible defaults", () => {
    expect(defaultValueForType("checkbox")).toBe(false);
    expect(defaultValueForType("number")).toBe(0);
    expect(defaultValueForType("tags")).toEqual([]);
    expect(defaultValueForType("link")).toEqual([]);
    expect(defaultValueForType("text")).toBe("");
    expect(defaultValueForType("status")).toBe("");
  });
});

describe("propertyModel.formatDateValue", () => {
  it("formats a date-only value without an off-by-one day shift", () => {
    const out = formatDateValue("2026-03-28", false, "de-DE");
    expect(out).toContain("2026");
    expect(out).toContain("28");
  });
  it("includes the time for datetime values", () => {
    const out = formatDateValue("2026-03-28T21:45", true, "de-DE");
    expect(out).toContain("21");
    expect(out).toContain("45");
  });
  it("returns the raw input when unparseable and empty for empty", () => {
    expect(formatDateValue("not-a-date", false, "de-DE")).toBe("not-a-date");
    expect(formatDateValue("", false, "de-DE")).toBe("");
  });

  it("formats the default (short locale) form", () => {
    expect(formatDateValue("2026-07-03", false, "de-DE", "default")).toBe("03.07.2026");
    expect(formatDateValue("2026-07-03T09:05", true, "de-DE", "default")).toContain("09:05");
  });

  it("formats iso as the canonical ISO string", () => {
    expect(formatDateValue("2026-07-03", false, "de-DE", "iso")).toBe("2026-07-03");
    expect(formatDateValue("2026-07-03T09:05", true, "de-DE", "iso")).toBe("2026-07-03T09:05");
    // date-only display of a datetime value drops the time part
    expect(formatDateValue("2026-07-03T09:05", false, "de-DE", "iso")).toBe("2026-07-03");
  });

  it("formats relative day/month/year distances with numeric:auto", () => {
    const now = new Date(2026, 6, 3, 12, 0); // 2026-07-03
    expect(formatDateValue("2026-07-03", false, "de-DE", "relative", now)).toBe("heute");
    expect(formatDateValue("2026-06-30", false, "de-DE", "relative", now)).toBe("vor 3 Tagen");
    expect(formatDateValue("2026-07-04", false, "de-DE", "relative", now)).toBe("morgen");
    expect(formatDateValue("2026-10-01", false, "de-DE", "relative", now)).toBe("in 3 Monaten");
    expect(formatDateValue("2024-07-03", false, "de-DE", "relative", now)).toBe("vor 2 Jahren");
  });

  it("keeps the verbose long form as the fallback for existing callers", () => {
    const out = formatDateValue("2026-07-03", false, "de-DE");
    expect(out).toContain("Juli");
  });
});

describe("propertyModel.parseLocalDate", () => {
  it("parses date-only at local midnight (no UTC shift)", () => {
    const d = parseLocalDate("2026-03-28")!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // March (0-based)
    expect(d.getDate()).toBe(28);
  });
  it("returns null for garbage", () => {
    expect(parseLocalDate("garbage")).toBeNull();
  });
});

describe("propertyModel tag/link helpers", () => {
  it("splits nested tags into parent + leaf", () => {
    expect(tagSegments("thema/wissen/ki")).toEqual({ parent: "thema/wissen/", leaf: "ki" });
    expect(tagSegments("flat")).toEqual({ parent: "", leaf: "flat" });
  });
  it("strips and wraps wikilinks", () => {
    expect(stripWikiLink("[[Note A]]")).toBe("Note A");
    expect(stripWikiLink("plain")).toBe("plain");
    expect(toWikiLink("Note A")).toBe("[[Note A]]");
    expect(toWikiLink("[[Already]]")).toBe("[[Already]]");
    expect(toWikiLink("")).toBe("");
  });
});

describe("propertyModel.normalizeFrontmatterValue", () => {
  it("converts a UTC-midnight Date to a date-only string without day shift", () => {
    expect(normalizeFrontmatterValue(new Date(Date.UTC(2026, 2, 28)))).toBe("2026-03-28");
  });
  it("passes non-Date values through unchanged", () => {
    expect(normalizeFrontmatterValue("final")).toBe("final");
    expect(normalizeFrontmatterValue(["a", "b"])).toEqual(["a", "b"]);
    expect(normalizeFrontmatterValue(42)).toBe(42);
  });
});

describe("propertyModel.chipColorIndex", () => {
  it("is deterministic and within range", () => {
    const a = chipColorIndex("final");
    const b = chipColorIndex("final");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(8);
  });
});

describe("propertyModel.chipClass", () => {
  it("uses the curated palette color when valid", () => {
    expect(chipClass("anything", "teal")).toBe("pv-chip pv-chip-1");
    expect(chipClass("anything", "pink")).toBe("pv-chip pv-chip-7");
  });
  it("falls back to a deterministic color for unknown/missing colors", () => {
    expect(chipClass("final")).toBe(chipClass("final", "not-a-color"));
    expect(chipClass("final")).toMatch(/^pv-chip pv-chip-[0-7]$/);
  });
});

describe("propertyModel.chipPaletteIndex (WP3 board tint)", () => {
  it("maps a curated palette name to its slot", () => {
    expect(chipPaletteIndex("x", "teal")).toBe(1);
    expect(chipPaletteIndex("x", "pink")).toBe(7);
  });
  it("falls back to the value hash for unknown/missing colors and matches chipClass", () => {
    expect(chipPaletteIndex("final")).toBe(chipColorIndex("final"));
    expect(`pv-chip pv-chip-${chipPaletteIndex("final", "gray")}`).toBe(chipClass("final", "gray"));
  });
});

describe("propertyModel.groupOptions", () => {
  it("groups options by stage, preserving first-seen order", () => {
    const grouped = groupOptions([
      { value: "todo", group: "Offen" },
      { value: "doing", group: "Aktiv" },
      { value: "done", group: "Fertig" },
      { value: "blocked", group: "Aktiv" },
      { value: "loose" },
    ]);
    expect(grouped.map((g) => g.group)).toEqual(["Offen", "Aktiv", "Fertig", null]);
    expect(grouped[1].options.map((o) => o.value)).toEqual(["doing", "blocked"]);
  });
});

describe("propertyModel.baseInputToType", () => {
  it("maps .base input strings to PropertyType", () => {
    expect(baseInputToType("select")).toBe("select");
    expect(baseInputToType("status")).toBe("status");
    expect(baseInputToType("multiselect")).toBe("multiselect");
    expect(baseInputToType("relation")).toBe("link");
    expect(baseInputToType("datetime")).toBe("datetime");
    expect(baseInputToType(undefined)).toBeUndefined();
    expect(baseInputToType("weird")).toBeUndefined();
  });
});

describe("propertyModel.inlineOptionsFrom", () => {
  it("returns curated options unchanged when present", () => {
    const curated = [{ value: "draft" }, { value: "final", color: "teal" }];
    expect(inlineOptionsFrom(curated, [{ status: "x" }], "status")).toBe(curated);
  });
  it("discovers distinct non-empty values from rows when no curated options", () => {
    const rows = [{ status: "draft" }, { status: "final" }, { status: "draft" }, { status: "" }, {}];
    expect(inlineOptionsFrom([], rows, "status").map((o) => o.value)).toEqual(["draft", "final"]);
  });
  it("flattens list values and falls back from note.-prefixed to bare keys", () => {
    const rows = [{ tags: ["a", "b"] }, { tags: ["b", "c"] }];
    expect(inlineOptionsFrom([], rows, "note.tags").map((o) => o.value)).toEqual(["a", "b", "c"]);
  });
});

describe("propertyModel.mergeObservedOptions (WP2)", () => {
  it("seeds observed values when the schema has no curated options", () => {
    const rows = [{ status: "draft" }, { status: "final" }, { status: "draft" }];
    expect(mergeObservedOptions([], rows, "status")).toEqual([{ value: "draft" }, { value: "final" }]);
  });
  it("keeps curated options (with color/group/order) and appends only new values", () => {
    const curated = [{ value: "final", color: "green", group: "Done" }];
    const rows = [{ status: "final" }, { status: "draft" }, { status: "review" }];
    expect(mergeObservedOptions(curated, rows, "status")).toEqual([
      { value: "final", color: "green", group: "Done" },
      { value: "draft" },
      { value: "review" },
    ]);
  });
  it("does not mutate the curated array and flattens multiselect list values", () => {
    const curated = [{ value: "a", color: "teal" }];
    const rows = [{ tags: ["a", "b"] }, { tags: ["c"] }];
    const out = mergeObservedOptions(curated, rows, "note.tags");
    expect(out).toEqual([{ value: "a", color: "teal" }, { value: "b" }, { value: "c" }]);
    expect(curated).toEqual([{ value: "a", color: "teal" }]); // untouched
  });
});

describe("propertyModel.filterTagSuggestions", () => {
  const all = [
    { tag: "thema/gesundheit", count: 12 },
    { tag: "thema/wissen/tech", count: 8 },
    { tag: "typ/tagebuch", count: 23 },
  ];
  it("filters by query and excludes already-applied tags", () => {
    const out = filterTagSuggestions(all, "thema/", ["thema/gesundheit"]);
    expect(out.map((t) => t.tag)).toEqual(["thema/wissen/tech"]);
  });
  it("returns all (minus existing) for an empty query", () => {
    const out = filterTagSuggestions(all, "", []);
    expect(out.length).toBe(3);
  });
});

describe("splitMultiValue (Base-UX2 P1)", () => {
  it("keeps arrays as string lists", () => {
    expect(splitMultiValue(["a", "b"])).toEqual(["a", "b"]);
    expect(splitMultiValue([1, 2])).toEqual(["1", "2"]);
  });
  it("splits comma-joined strings and trims entries", () => {
    expect(splitMultiValue("tag1, tag2,tag3 ")).toEqual(["tag1", "tag2", "tag3"]);
  });
  it("wraps plain scalars into a single entry", () => {
    expect(splitMultiValue("done")).toEqual(["done"]);
    expect(splitMultiValue(3)).toEqual(["3"]);
  });
  it("returns empty for null/undefined/empty and drops empty parts", () => {
    expect(splitMultiValue(null)).toEqual([]);
    expect(splitMultiValue(undefined)).toEqual([]);
    expect(splitMultiValue("")).toEqual([]);
    expect(splitMultiValue("a, ,b,")).toEqual(["a", "b"]);
  });
});

describe("propertyModel.columnValuesAreWikiLinks", () => {
  it("is true when every non-empty value is a wiki-link", () => {
    const rows = [{ project: "[[Alpha]]" }, { project: "[[Beta|B]]" }, { project: "" }, {}];
    expect(columnValuesAreWikiLinks(rows, "project")).toBe(true);
  });
  it("reads the bare key when the column is note.-prefixed, and flattens lists", () => {
    const rows = [{ project: ["[[A]]", "[[B]]"] }];
    expect(columnValuesAreWikiLinks(rows, "note.project")).toBe(true);
  });
  it("is false for a mixed column (a plain value among links)", () => {
    const rows = [{ project: "[[Alpha]]" }, { project: "Beta" }];
    expect(columnValuesAreWikiLinks(rows, "project")).toBe(false);
  });
  it("is false when the column has no values at all", () => {
    expect(columnValuesAreWikiLinks([{ status: "open" }, {}], "project")).toBe(false);
  });
});
