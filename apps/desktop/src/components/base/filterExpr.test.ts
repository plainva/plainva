import { describe, it, expect } from "vitest";
import {
  addGroupWithRule,
  addRuleToGroup,
  addTopFilterRule,
  buildUIFilterModel,
  isEditableGroup,
  isSourceCondition,
  moveTopFilterEntries,
  parsePropertyFilter,
  removeFilterEntry,
  removeGroupRule,
  serializePropertyFilter,
  setGroupLogic,
  stripPropertyFilters,
  updateGroupRule,
  combineFilters,
  migrateFiltersToPerView,
  type PropertyFilterRule,
} from "@plainva/ui";

describe("filterExpr", () => {
  it("classifies folder/tag source conditions", () => {
    expect(isSourceCondition('file.folder == "Efforts"')).toBe(true);
    expect(isSourceCondition('file.hasTag("typ/projekt")')).toBe(true);
    expect(isSourceCondition('status == "active"')).toBe(false);
    expect(isSourceCondition({ and: [] })).toBe(false);
  });

  it("parses every supported operator", () => {
    expect(parsePropertyFilter('status == "active"')).toEqual({ column: "status", op: "==", value: "active" });
    expect(parsePropertyFilter('status != "done"')).toEqual({ column: "status", op: "!=", value: "done" });
    expect(parsePropertyFilter('contains(tags, "haus")')).toEqual({ column: "tags", op: "contains", value: "haus" });
    expect(parsePropertyFilter('prio > "3"')).toEqual({ column: "prio", op: ">", value: "3" });
    expect(parsePropertyFilter('review_date <= "2026-08-01"')).toEqual({ column: "review_date", op: "<=", value: "2026-08-01" });
  });

  it("returns null for source conditions, nested objects and unknown grammar", () => {
    expect(parsePropertyFilter('file.folder == "/"')).toBeNull();
    expect(parsePropertyFilter({ or: ['a == "b"'] })).toBeNull();
    expect(parsePropertyFilter("status.containsAny('a','b')")).toBeNull();
  });

  it("round-trips rules including quotes and backslashes in values", () => {
    const rules: PropertyFilterRule[] = [
      { column: "status", op: "==", value: 'say "hi"' },
      { column: "path col", op: "contains", value: "C:\\vault" },
      { column: "prio", op: ">=", value: "10" },
    ];
    for (const rule of rules) {
      expect(parsePropertyFilter(serializePropertyFilter(rule))).toEqual(rule);
    }
  });
});

describe("stripPropertyFilters", () => {
  it("keeps source conditions, drops property filters and nested objects in both lists", () => {
    const cfg = {
      filters: {
        and: ['file.folder == "P"', 'status == "x"', { or: ['a == "b"'] }],
        or: ['file.hasTag("t")', 'contains(tags, "y")'],
      },
      views: [{ type: "table", name: "T" }],
    };
    const out = stripPropertyFilters(cfg);
    expect(out.filters.and).toEqual(['file.folder == "P"']);
    expect(out.filters.or).toEqual(['file.hasTag("t")']);
    expect(out.views).toEqual(cfg.views);
    // Deep clone: the input config is untouched.
    expect(cfg.filters.and).toHaveLength(3);
    expect(cfg.filters.or).toHaveLength(2);
  });

  it("passes configs without filters through unchanged", () => {
    expect(stripPropertyFilters({ views: [] }).views).toEqual([]);
    expect(stripPropertyFilters(null as any)).toBeNull();
  });
});

describe("filter groups: UI model (plan Base-Filtergruppen P9)", () => {
  it("classifies rules, editable groups, raw strings and opaque objects; sources never appear", () => {
    const cfg = {
      filters: {
        and: [
          'file.folder == "P"',
          'status == "x"',
          { or: ['a == "1"', 'b == "2"'] },
          { or: ['file.hasTag("t")'] }, // group holding a source -> opaque
          { and: ["x", { or: ["y"] }] }, // nested deeper -> opaque
          "formula.magic(x)", // unparseable string -> rawString
        ],
      },
    };
    const model = buildUIFilterModel(cfg);
    expect(model.topLogic).toBe("all");
    expect(model.entries.map((e) => e.kind)).toEqual(["rule", "group", "opaque", "opaque", "rawString"]);
    const group = model.entries[1] as any;
    expect(group.logic).toBe("any");
    expect(group.items.map((i: any) => i.rule?.value)).toEqual(["1", "2"]);
  });

  it("derives topLogic any from entries in the or-list", () => {
    expect(buildUIFilterModel({ filters: { or: ['a == "1"'] } }).topLogic).toBe("any");
    expect(buildUIFilterModel({ filters: { or: ['file.hasTag("t")'] } }).topLogic).toBe("all"); // sources do not count
    expect(buildUIFilterModel({ filters: {} }).hasEntries).toBe(false);
  });

  it("isEditableGroup accepts only one-level all-string non-source groups", () => {
    expect(isEditableGroup({ or: ['a == "1"'] })).toBe(true);
    expect(isEditableGroup({ and: ['a == "1"', 'b == "2"'] })).toBe(true);
    expect(isEditableGroup({ or: ['file.folder == "X"'] })).toBe(false);
    expect(isEditableGroup({ or: [{ and: [] }] })).toBe(false);
    expect(isEditableGroup({ not: ["a"] })).toBe(false);
    expect(isEditableGroup({ and: [], or: [] })).toBe(false);
  });
});

describe("filter groups: pure mutators (plan Base-Filtergruppen P9)", () => {
  const base = (): any => ({ filters: { and: ['file.folder == "P"', 'status == "x"', { or: ['a == "1"'] }] } });

  it("adds rules and groups respecting the top logic", () => {
    const all = addTopFilterRule({ filters: {} }, 'p == "1"', "all");
    expect(all.filters.and).toEqual(['p == "1"']);
    const any = addTopFilterRule({ filters: {} }, 'p == "1"', "any");
    expect(any.filters.or).toEqual(['p == "1"']);
    const grouped = addGroupWithRule({ filters: {} }, "any", 'p == "1"', "all");
    expect(grouped.filters.and).toEqual([{ or: ['p == "1"'] }]);
  });

  it("adds, updates and removes rules inside a group; the empty group vanishes", () => {
    const cfg = base();
    addRuleToGroup(cfg, { list: "and", idx: 2 }, 'b == "2"');
    expect(cfg.filters.and[2]).toEqual({ or: ['a == "1"', 'b == "2"'] });
    updateGroupRule(cfg, { list: "and", idx: 2 }, 0, 'a == "9"');
    expect(cfg.filters.and[2]).toEqual({ or: ['a == "9"', 'b == "2"'] });
    removeGroupRule(cfg, { list: "and", idx: 2 }, 0);
    removeGroupRule(cfg, { list: "and", idx: 2 }, 0);
    expect(cfg.filters.and).toEqual(['file.folder == "P"', 'status == "x"']);
  });

  it("switches a group's logic keeping its rules", () => {
    const cfg = base();
    setGroupLogic(cfg, { list: "and", idx: 2 }, "all");
    expect(cfg.filters.and[2]).toEqual({ and: ['a == "1"'] });
  });

  it("removes whole entries by ref", () => {
    const cfg = base();
    removeFilterEntry(cfg, { list: "and", idx: 2 });
    expect(cfg.filters.and).toEqual(['file.folder == "P"', 'status == "x"']);
  });

  it("moves rules AND groups across the top-logic toggle, sources stay", () => {
    const cfg = base();
    moveTopFilterEntries(cfg, "any");
    expect(cfg.filters.and).toEqual(['file.folder == "P"']);
    expect(cfg.filters.or).toEqual(['status == "x"', { or: ['a == "1"'] }]);
    moveTopFilterEntries(cfg, "all");
    expect(cfg.filters.or).toEqual([]);
    expect(cfg.filters.and).toEqual(['file.folder == "P"', 'status == "x"', { or: ['a == "1"'] }]);
  });
});

describe("filterExpr relation operators (P11)", () => {
  it("round-trips !contains as notContains", () => {
    expect(parsePropertyFilter('!contains(aufgaben, "[[A1]]")')).toEqual({
      column: "aufgaben",
      op: "notContains",
      value: "[[A1]]",
    });
    expect(serializePropertyFilter({ column: "aufgaben", op: "notContains", value: '[[A1]]' })).toBe(
      '!contains(aufgaben, "[[A1]]")'
    );
  });

  it("maps empty comparisons to the is-empty operators and back", () => {
    expect(parsePropertyFilter('projekt == ""')).toEqual({ column: "projekt", op: "empty", value: "" });
    expect(parsePropertyFilter('projekt != ""')).toEqual({ column: "projekt", op: "notEmpty", value: "" });
    expect(serializePropertyFilter({ column: "projekt", op: "empty", value: "" })).toBe('projekt == ""');
    expect(serializePropertyFilter({ column: "projekt", op: "notEmpty", value: "" })).toBe('projekt != ""');
  });
});

describe("per-view filters (combineFilters / migrateFiltersToPerView)", () => {
  it("AND-combines two filter objects, or-lists become nested groups", () => {
    expect(combineFilters({ and: ['a == "1"'] }, { and: ['b == "2"'] })).toEqual({
      and: ['a == "1"', 'b == "2"'],
    });
    expect(combineFilters({ and: ['a == "1"'], or: ['x == "9"'] }, undefined)).toEqual({
      and: ['a == "1"', { or: ['x == "9"'] }],
    });
    // Empty / non-object inputs contribute nothing.
    expect(combineFilters(undefined, null)).toEqual({ and: [] });
    expect(combineFilters({ or: [] }, {})).toEqual({ and: [] });
  });

  it("moves file-level PROPERTY rules into every view, sources stay global", () => {
    const config = {
      filters: { and: ['file.folder == "Tasks"', 'status == "open"'] },
      views: [{ name: "Table" }, { name: "Board" }],
    };
    const nc = migrateFiltersToPerView(config);
    // Sources stay at the file level; the property rule left it.
    expect(nc.filters).toEqual({ and: ['file.folder == "Tasks"'] });
    // Every view now carries the property rule.
    expect(nc.views[0].filters).toEqual({ and: ['status == "open"'] });
    expect(nc.views[1].filters).toEqual({ and: ['status == "open"'] });
    // Pure: the input is untouched.
    expect(config.filters.and).toEqual(['file.folder == "Tasks"', 'status == "open"']);
  });

  it("keeps groups and or-list property rules as view filters", () => {
    const config = {
      filters: {
        and: ['file.hasTag("t")', { and: ['a == "1"'] }],
        or: ['b == "2"'],
      },
      views: [{ name: "V" }],
    };
    const nc = migrateFiltersToPerView(config);
    expect(nc.filters).toEqual({ and: ['file.hasTag("t")'] });
    // The and-group and the or-rule both moved to the view (AND-combined).
    expect(nc.views[0].filters).toEqual({ and: [{ and: ['a == "1"'] }, { or: ['b == "2"'] }] });
  });

  it("is idempotent: a sources-only file-level filter comes back unchanged", () => {
    const config = {
      filters: { and: ['file.folder == "Tasks"'] },
      views: [{ name: "V", filters: { and: ['status == "open"'] } }],
    };
    const nc = migrateFiltersToPerView(config);
    expect(nc.filters).toEqual({ and: ['file.folder == "Tasks"'] });
    expect(nc.views[0].filters).toEqual({ and: ['status == "open"'] });
    // Running it again changes nothing.
    expect(migrateFiltersToPerView(nc)).toEqual(nc);
  });

  it("leaves a config without file-level filters alone", () => {
    const config = { views: [{ name: "V" }] };
    expect(migrateFiltersToPerView(config)).toEqual({ views: [{ name: "V" }] });
  });
});
