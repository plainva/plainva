import { describe, it, expect } from "vitest";
import {
  applySortRules,
  buildFilterNodePredicate,
  buildPropertyPredicate,
  filterNeedsTags,
  isSourceFilter,
  normalizeSortRules,
} from "../src/vault/databaseQueryHelpers.js";

describe("buildPropertyPredicate", () => {
  const rows = [
    { "file.name": "A", status: "active", prio: 2, review_date: "2026-07-01", tags: ["x", "y"] },
    { "file.name": "B", status: "paused", prio: 10, review_date: "2026-10-01" },
    { "file.name": "C", prio: "3" },
  ];

  const matchNames = (filter: string): string[] => {
    const p = buildPropertyPredicate(filter);
    if (!p) return ["<null>"];
    return rows.filter(p).map((r) => r["file.name"] as string);
  };

  it("returns null for source conditions and non-strings", () => {
    expect(buildPropertyPredicate('file.folder == "Efforts"')).toBeNull();
    expect(buildPropertyPredicate('file.hasTag("typ/projekt")')).toBeNull();
    expect(buildPropertyPredicate({ and: [] } as any)).toBeNull();
  });

  it("evaluates equality and inequality", () => {
    expect(matchNames('status == "active"')).toEqual(["A"]);
    expect(matchNames('status != "active"')).toEqual(["B", "C"]);
  });

  // Maintainer report 2026-07-03: `tags == "typ/tagebuch"` filtered EVERY row out
  // because the list was stringified ("x,y" never equals "x"). Lists match by
  // membership now.
  it("matches list values (tags, multiselect) by membership for == and !=", () => {
    expect(matchNames('tags == "x"')).toEqual(["A"]);
    expect(matchNames('tags == "y"')).toEqual(["A"]);
    expect(matchNames('note.tags == "x"')).toEqual(["A"]);
    expect(matchNames('tags == "x,y"')).toEqual([]); // no stringified-array matching
    expect(matchNames('tags != "x"')).toEqual(["B", "C"]); // rows without the tag (incl. missing lists)
  });

  it("treats a missing value as no match for == and as a match for !=", () => {
    expect(matchNames('status == "undefined"')).toEqual([]); // no literal-"undefined" artifact
    expect(matchNames('status != "whatever"')).toEqual(["A", "B", "C"]);
  });

  it("evaluates contains over strings and lists", () => {
    expect(matchNames('tags contains "x"'.replace(/(.*) contains "(.*)"/, 'contains($1, "$2")'))).toEqual(["A"]);
    expect(matchNames('contains(status, "aus")')).toEqual(["B"]);
  });

  it("unescapes quoted values", () => {
    const p = buildPropertyPredicate('status == "say \\"hi\\""');
    expect(p).not.toBeNull();
    expect(p!({ status: 'say "hi"' })).toBe(true);
  });

  it("compares numerically when both sides are numbers (including numeric strings)", () => {
    expect(matchNames('prio > "2"')).toEqual(["B", "C"]);
    expect(matchNames('prio >= "10"')).toEqual(["B"]);
    expect(matchNames('prio < "3"')).toEqual(["A"]);
    expect(matchNames('prio <= "2"')).toEqual(["A"]);
  });

  it("compares ISO dates lexicographically", () => {
    expect(matchNames('review_date < "2026-08-01"')).toEqual(["A"]);
    expect(matchNames('review_date >= "2026-08-01"')).toEqual(["B"]);
  });

  it("treats missing values as no match for ordered comparisons", () => {
    expect(matchNames('review_date > "2000-01-01"')).toEqual(["A", "B"]);
  });

  it("resolves note.-prefixed columns against bare row keys", () => {
    expect(matchNames('note.status == "active"')).toEqual(["A"]);
  });
});

describe("isSourceFilter", () => {
  it("recognizes folder and tag conditions", () => {
    expect(isSourceFilter('file.folder == "/"')).toBe(true);
    expect(isSourceFilter('file.hasTag("a")')).toBe(true);
    expect(isSourceFilter('status == "a"')).toBe(false);
  });
});

describe("normalizeSortRules / applySortRules", () => {
  it("normalizes property/field keys and directions", () => {
    expect(normalizeSortRules([{ property: "note.status", direction: "desc" }, { field: "prio" }, "junk", {}])).toEqual([
      { property: "note.status", direction: "DESC" },
      { property: "prio", direction: "ASC" },
    ]);
  });

  it("applies all rules as a stable multi-level sort", () => {
    const rows = [
      { name: "a", status: "active", prio: 2 },
      { name: "b", status: "paused", prio: 1 },
      { name: "c", status: "active", prio: 1 },
      { name: "d", status: "paused", prio: 2 },
    ];
    const sorted = applySortRules(rows, [
      { property: "status", direction: "ASC" },
      { property: "prio", direction: "DESC" },
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["a", "c", "d", "b"]);
  });

  it("sorts missing values last regardless of direction", () => {
    const rows = [{ name: "a" }, { name: "b", d: "2026-01-01" }, { name: "c", d: "2025-01-01" }];
    expect(applySortRules(rows, [{ property: "d", direction: "ASC" }]).map((r) => r.name)).toEqual(["c", "b", "a"]);
    expect(applySortRules(rows, [{ property: "d", direction: "DESC" }]).map((r) => r.name)).toEqual(["b", "c", "a"]);
  });

  it("keeps input order for ties (stable) and strips note. prefixes", () => {
    const rows = [
      { name: "x", status: "same" },
      { name: "y", status: "same" },
    ];
    expect(applySortRules(rows, [{ property: "note.status", direction: "ASC" }]).map((r) => r.name)).toEqual(["x", "y"]);
  });
});

describe("relation filter predicates (P11)", () => {
  it("negates contains via !contains (missing values count as not containing)", () => {
    const p = buildPropertyPredicate('!contains(aufgaben, "[[A1]]")')!;
    expect(p({ aufgaben: ["[[A1]]", "[[B2]]"] })).toBe(false);
    expect(p({ aufgaben: ["[[B2]]"] })).toBe(true);
    expect(p({})).toBe(true);
  });

  it("treats == \"\" as is-empty across scalars and lists", () => {
    const p = buildPropertyPredicate('projekt == ""')!;
    expect(p({})).toBe(true);
    expect(p({ projekt: null })).toBe(true);
    expect(p({ projekt: "" })).toBe(true);
    expect(p({ projekt: [] })).toBe(true);
    expect(p({ projekt: "[[P1]]" })).toBe(false);
    expect(p({ projekt: ["[[P1]]"] })).toBe(false);
  });

  it("treats != \"\" as is-not-empty (empty lists no longer match)", () => {
    const p = buildPropertyPredicate('projekt != ""')!;
    expect(p({ projekt: "[[P1]]" })).toBe(true);
    expect(p({ projekt: [] })).toBe(false);
    expect(p({})).toBe(false);
  });
});

describe("buildFilterNodePredicate (plan Base-Filtergruppen P7)", () => {
  const ctx = {
    hasTag: (row: any, tag: string) => Array.isArray(row.__tags) && row.__tags.includes(tag),
  };
  const rows = [
    { "file.name": "A", "file.path": "Projekte/a.md", status: "offen", prio: 1, __tags: ["intern"] },
    { "file.name": "B", "file.path": "Projekte/b.md", status: "fertig", prio: 2 },
    { "file.name": "C", "file.path": "Archiv/c.md", status: "offen", prio: 3 },
  ];
  const matchNames = (node: any): string[] => {
    const p = buildFilterNodePredicate(node, ctx);
    if (!p) return ["<null>"];
    return rows.filter(p).map((r) => r["file.name"] as string);
  };

  it("evaluates one nested or-group inside and (the canonical Plainva form)", () => {
    expect(matchNames({ and: ['status == "offen"', { or: ['prio == "1"', 'prio == "3"'] }] })).toEqual(["A", "C"]);
  });

  it("evaluates deeper nesting (groups in groups) instead of ignoring it", () => {
    const node = { or: ['status == "fertig"', { and: ['status == "offen"', { or: ['prio == "3"'] }] }] };
    expect(matchNames(node)).toEqual(["B", "C"]);
  });

  it("applies not with Obsidian semantics (none of the children match)", () => {
    expect(matchNames({ not: ['status == "offen"'] })).toEqual(["B"]);
    expect(matchNames({ not: ['status == "offen"', 'prio == "2"'] })).toEqual([]);
  });

  it("evaluates folder and tag source conditions in memory", () => {
    expect(matchNames('file.folder == "Projekte"')).toEqual(["A", "B"]);
    expect(matchNames('file.folder == "/"')).toEqual(["A", "B", "C"]);
    expect(matchNames('file.hasTag("intern")')).toEqual(["A"]);
    expect(matchNames('file.hasTag("#intern")')).toEqual(["A"]);
  });

  it("treats unparseable children as neutral and empty groups as null", () => {
    expect(matchNames({ and: ["formula.magic(x)", 'status == "offen"'] })).toEqual(["A", "C"]);
    expect(buildFilterNodePredicate({ and: [] }, ctx)).toBeNull();
    expect(buildFilterNodePredicate({ or: ["formula.magic(x)"] }, ctx)).toBeNull();
    expect(buildFilterNodePredicate(42 as any, ctx)).toBeNull();
  });
});

describe("filterNeedsTags", () => {
  it("finds hasTag conditions at any depth", () => {
    expect(filterNeedsTags({ and: ['status == "x"'] })).toBe(false);
    expect(filterNeedsTags({ and: ['file.hasTag("t")'] })).toBe(true);
    expect(filterNeedsTags({ and: [{ or: [{ not: ['file.hasTag("t")'] }] }] })).toBe(true);
    expect(filterNeedsTags('file.hasTag("t")')).toBe(true);
    expect(filterNeedsTags(null)).toBe(false);
  });
});
