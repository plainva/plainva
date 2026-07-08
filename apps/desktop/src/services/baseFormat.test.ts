import { describe, it, expect } from "vitest";
import * as yaml from "yaml";
import {
  parseBaseConfig,
  serializeBaseConfig,
  toPropId,
  fromPropId,
  toObsidianViewType,
  fromObsidianViewType,
} from "./baseFormat";

describe("baseFormat id mapping", () => {
  it("prefixes frontmatter props with note. and keeps file./formula.", () => {
    expect(toPropId("status")).toBe("note.status");
    expect(toPropId("file.name")).toBe("file.name");
    expect(toPropId("formula.x")).toBe("formula.x");
    expect(fromPropId("note.status")).toBe("status");
    expect(fromPropId("file.name")).toBe("file.name");
  });
});

describe("baseFormat view type mapping", () => {
  it("maps Plainva render types to native Obsidian types", () => {
    expect(toObsidianViewType("table")).toBe("table");
    expect(toObsidianViewType("list")).toBe("list");
    expect(toObsidianViewType("gallery")).toBe("cards");
    expect(toObsidianViewType("board")).toBe("table");
    expect(toObsidianViewType("calendar")).toBe("table");
    expect(toObsidianViewType("timeline")).toBe("table");
  });
  it("maps native types back, preserving legacy Plainva render types", () => {
    expect(fromObsidianViewType("cards")).toBe("gallery");
    expect(fromObsidianViewType("table")).toBe("table");
    expect(fromObsidianViewType("board")).toBe("board");
    expect(fromObsidianViewType(undefined)).toBe("table");
  });
});

describe("baseFormat serialize: Obsidian-native output", () => {
  it("never emits a top-level columns key; richness goes under properties[x].plainva", () => {
    const config = {
      columns: { status: { input: "select", options: [{ value: "draft", color: "amber" }] } },
      views: [{ type: "table", order: ["file.name", "status"], sort: [{ property: "status", direction: "ASC" }] }],
      filters: { and: ['file.folder == "Cal"'] },
      _obsidian: {},
    };
    const out = yaml.parse(serializeBaseConfig(config));
    expect(out.columns).toBeUndefined();
    expect(out.properties["note.status"].plainva.input).toBe("select");
    expect(out.properties["note.status"].plainva.options[0].value).toBe("draft");
    expect(out.properties["note.status"].plainva.options[0].color).toBe("amber");
    expect(out.views[0].type).toBe("table");
    expect(out.views[0].order).toEqual(["file.name", "note.status"]);
    expect(out.views[0].sort[0].property).toBe("note.status");
    expect(out.views[0].plainva).toBeUndefined(); // table is native -> no render hint
    expect(out.filters.and[0]).toBe('file.folder == "Cal"');
  });

  it("degrades Plainva-only views to a native table plus a plainva.render hint", () => {
    const out = yaml.parse(
      serializeBaseConfig({ columns: {}, views: [{ type: "calendar", dateField: "date" }], _obsidian: {} }),
    );
    expect(out.views[0].type).toBe("table");
    expect(out.views[0].plainva.render).toBe("calendar");
    expect(out.views[0].plainva.dateField).toBe("date");
  });

  it("maps gallery to the native cards type without a render hint", () => {
    const out = yaml.parse(serializeBaseConfig({ columns: {}, views: [{ type: "gallery" }], _obsidian: {} }));
    expect(out.views[0].type).toBe("cards");
    expect(out.views[0].plainva).toBeUndefined();
  });

  it("stamps newItemFolder/newItemTemplate onto views[0].plainva only and round-trips them (plan Base-Neu P1)", () => {
    const out = yaml.parse(
      serializeBaseConfig({
        columns: {},
        views: [{ type: "table" }, { type: "board" }],
        newItemFolder: "Projekte/Aktiv",
        newItemTemplate: "Templates/Projekt.md",
        _obsidian: {},
      }),
    );
    expect(out.views[0].plainva.newItemFolder).toBe("Projekte/Aktiv");
    expect(out.views[0].plainva.newItemTemplate).toBe("Templates/Projekt.md");
    expect(out.views[1].plainva?.newItemFolder).toBeUndefined();

    const parsed = parseBaseConfig(yaml.stringify(out));
    expect(parsed.newItemFolder).toBe("Projekte/Aktiv");
    expect(parsed.newItemTemplate).toBe("Templates/Projekt.md");

    // Cleared in memory -> scrubbed from the file on the next save.
    delete parsed.newItemTemplate;
    const out2 = yaml.parse(serializeBaseConfig(parsed));
    expect(out2.views[0].plainva?.newItemTemplate).toBeUndefined();
    expect(out2.views[0].plainva.newItemFolder).toBe("Projekte/Aktiv");
  });

  it("round-trips contextFilters (self-reference) under views[0].plainva only, ignored by Obsidian's filters", () => {
    const out = yaml.parse(
      serializeBaseConfig({
        columns: { project: { input: "relation", relationBase: "Projects.base" } },
        views: [{ type: "table" }, { type: "board" }],
        contextFilters: ["project"],
        filters: { and: ['file.folder == "Tasks"'] },
        _obsidian: {},
      }),
    );
    expect(out.views[0].plainva.contextFilters).toEqual(["project"]);
    expect(out.views[1].plainva?.contextFilters).toBeUndefined();
    // Never written into the native filters — Obsidian shows all rows.
    expect(out.filters.and).toEqual(['file.folder == "Tasks"']);

    const parsed = parseBaseConfig(yaml.stringify(out));
    expect(parsed.contextFilters).toEqual(["project"]);

    // Cleared in memory -> scrubbed on next save.
    delete parsed.contextFilters;
    const out2 = yaml.parse(serializeBaseConfig(parsed));
    expect(out2.views[0].plainva?.contextFilters).toBeUndefined();
  });

  it("round-trips native per-view filters (views[i].filters) independently per view", () => {
    const out = yaml.parse(
      serializeBaseConfig({
        columns: {},
        views: [
          { type: "table", filters: { and: ['status == "open"'] } },
          // A top rule plus an any-group — the shape the panel writes.
          { type: "board", filters: { and: ['status == "done"', { or: ['prio == "hi"'] }] } },
        ],
        filters: { and: ['file.folder == "Tasks"'] },
        _obsidian: {},
      }),
    );
    // Each view carries its own single-rooted filters; sources stay file-level.
    expect(out.views[0].filters).toEqual({ and: ['status == "open"'] });
    expect(out.views[1].filters).toEqual({ and: ['status == "done"', { or: ['prio == "hi"'] }] });
    expect(out.filters).toEqual({ and: ['file.folder == "Tasks"'] });

    const parsed = parseBaseConfig(yaml.stringify(out));
    expect(parsed.views[0].filters).toEqual({ and: ['status == "open"'] });
    // The property-only or-group stays nested (no pure-source side to lift it out).
    expect(parsed.views[1].filters).toEqual({ and: ['status == "done"', { or: ['prio == "hi"'] }] });
    expect(parsed.filters).toEqual({ and: ['file.folder == "Tasks"'] });

    // Cleared in memory -> scrubbed from that view on the next save.
    delete parsed.views[0].filters;
    const out2 = yaml.parse(serializeBaseConfig(parsed));
    expect(out2.views[0].filters).toBeUndefined();
    expect(out2.views[1].filters).toEqual({ and: ['status == "done"', { or: ['prio == "hi"'] }] });
  });

  it("keeps files without per-view filters free of a filters key on the views", () => {
    const out = yaml.parse(
      serializeBaseConfig({ columns: {}, views: [{ type: "table" }, { type: "board" }], _obsidian: {} }),
    );
    expect(out.views[0].filters).toBeUndefined();
    expect(out.views[1].filters).toBeUndefined();
  });

  it("round-trips the per-view dateFormat under plainva and omits the default", () => {
    const out = yaml.parse(
      serializeBaseConfig({ columns: {}, views: [{ type: "table", dateFormat: "relative" }, { type: "table", dateFormat: "default" }], _obsidian: {} }),
    );
    expect(out.views[0].plainva.dateFormat).toBe("relative");
    expect(out.views[1].plainva).toBeUndefined();

    const parsed = parseBaseConfig(serializeBaseConfig({ columns: {}, views: [{ type: "board", groupBy: "status", dateFormat: "iso" }], _obsidian: {} }));
    expect(parsed.views[0].type).toBe("board");
    expect(parsed.views[0].dateFormat).toBe("iso");
    expect(parsed.views[0].groupBy).toBe("status");
  });
});

describe("baseFormat parse", () => {
  it("returns empty shape for empty/garbage input", () => {
    expect(parseBaseConfig("")).toEqual({ columns: {}, views: [], _obsidian: {} });
    const c = parseBaseConfig("- just\n- a\n- list\n");
    expect(c.columns).toEqual({});
    expect(c.views).toEqual([]);
  });

  it("reads the legacy top-level columns map (auto-migrated on next save)", () => {
    const text = yaml.stringify({
      columns: { status: { input: "select", options: [{ value: "draft" }] } },
      views: [{ type: "board", order: ["status"] }],
      filters: { and: ['file.hasTag("x")'] },
    });
    const config = parseBaseConfig(text);
    expect(config.columns.status.input).toBe("select");
    expect(config.columns.status.options[0].value).toBe("draft");
    expect(config.views[0].type).toBe("board"); // legacy type preserved
    expect(config.filters.and[0]).toBe('file.hasTag("x")');

    // Re-serialize -> Obsidian-native, no legacy columns, board degraded.
    const out = yaml.parse(serializeBaseConfig(config));
    expect(out.columns).toBeUndefined();
    expect(out.properties["note.status"].plainva.input).toBe("select");
    expect(out.views[0].type).toBe("table");
    expect(out.views[0].plainva.render).toBe("board");
  });

  it("reads the new namespaced properties[x].plainva format", () => {
    const text = yaml.stringify({
      properties: { "note.status": { displayName: "Status", plainva: { input: "status", options: [{ value: "done", group: "Closed" }] } } },
      views: [{ type: "table", plainva: { render: "calendar", dateField: "date" } }],
    });
    const config = parseBaseConfig(text);
    expect(config.columns.status.input).toBe("status");
    expect(config.columns.status.options[0].group).toBe("Closed");
    expect(config.views[0].type).toBe("calendar");
    expect(config.views[0].dateField).toBe("date");
  });
});

describe("baseFormat round-trip", () => {
  it("preserves columns, views and filters across parse(serialize(...))", () => {
    const original = {
      columns: {
        status: { input: "status", options: [{ value: "open", color: "teal", group: "Active" }] },
        ref: { input: "relation", relationBase: "DB/Other.base" },
      },
      views: [
        { type: "table", name: "Tabelle", order: ["file.name", "status"], sort: [{ property: "status", direction: "DESC" }], widths: { "file.name": 200, status: 120 } },
        { type: "timeline", name: "Zeitachse", dateField: "start", endField: "end" },
        { type: "board", name: "Board", groupBy: "status" },
        { type: "gallery", name: "Galerie", coverImage: "cover" },
      ],
      filters: { and: ['file.folder == "X"'], or: ['file.hasTag("y")'] },
      _obsidian: {},
    };
    const round = parseBaseConfig(serializeBaseConfig(original));
    expect(round.columns).toEqual(original.columns);
    expect(round.views).toEqual(original.views);
    expect(round.filters).toEqual(original.filters);
  });

  it("preserves unknown Obsidian keys (formulas, displayName) verbatim", () => {
    const text = yaml.stringify({
      formulas: { ppu: "price / age" },
      properties: { "note.status": { displayName: "Status", plainva: { input: "select", options: [{ value: "a" }] } } },
      views: [{ type: "table" }],
    });
    const out = yaml.parse(serializeBaseConfig(parseBaseConfig(text)));
    expect(out.formulas.ppu).toBe("price / age");
    expect(out.properties["note.status"].displayName).toBe("Status");
    expect(out.properties["note.status"].plainva.input).toBe("select");
  });
});

// The two failure modes Obsidian actually rejects whole files over (report
// 2026-07-03: "'Name' in Sicht 1 fehlt oder ist ungültig" / "'Filter' dürfen
// nur eines der folgenden Schlüsselwörter enthalten: and, or, not"): a view
// without a string name, and a filters object with more than one of
// and/or/not side by side.
describe("baseFormat: Obsidian hard requirements (view names, single-rooted filters)", () => {
  const soleKey = (o: any) => o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === 1 && ["and", "or", "not"].some((k) => k in o);
  /** Recursive Obsidian validity: every filter node is a string or a sole and/or/not group over valid nodes. */
  const validFilterNode = (n: any): boolean => {
    if (typeof n === "string") return true;
    if (!soleKey(n)) return false;
    const items = n.and ?? n.or ?? n.not;
    return Array.isArray(items) && items.every(validFilterNode);
  };
  const serializeWith = (extra: any) => yaml.parse(serializeBaseConfig({ columns: {}, views: [{ type: "table", name: "T" }], _obsidian: {}, ...extra }));

  it("synthesizes unique names for unnamed views", () => {
    const out = yaml.parse(serializeBaseConfig({ columns: {}, views: [{ type: "table" }, { type: "table" }, { type: "board" }], _obsidian: {} }));
    expect(out.views.map((v: any) => v.name)).toEqual(["Table", "Table 2", "Board"]);
  });

  it("keeps user-given names and coerces non-string names to strings", () => {
    const out = yaml.parse(serializeBaseConfig({ columns: {}, views: [{ type: "table", name: "Meine Sicht" }, { type: "table", name: 2024 }], _obsidian: {} }));
    expect(out.views[0].name).toBe("Meine Sicht");
    expect(out.views[1].name).toBe("2024");
  });

  it("never writes an empty views list", () => {
    const out = yaml.parse(serializeBaseConfig({ columns: {}, views: [], _obsidian: {} }));
    expect(out.views).toHaveLength(1);
    expect(out.views[0].type).toBe("table");
    expect(out.views[0].name).toBe("Table");
  });

  it("serializes the flat and+or lists as one single-rooted nested group", () => {
    const out = serializeWith({ filters: { and: ["a", "b"], or: ["c", "d"] } });
    expect(out.filters).toEqual({ and: ["a", "b", { or: ["c", "d"] }] });
    expect(validFilterNode(out.filters)).toBe(true);
  });

  it("keeps single-list filters flat, passes strings through, drops empty ones", () => {
    expect(serializeWith({ filters: { and: ["a"] } }).filters).toEqual({ and: ["a"] });
    expect(serializeWith({ filters: { or: ["a"] } }).filters).toEqual({ or: ["a"] });
    expect(serializeWith({ filters: { not: ["a"] } }).filters).toEqual({ not: ["a"] });
    expect(serializeWith({ filters: { and: [], or: [] } }).filters).toBeUndefined();
    expect(serializeWith({ filters: 'file.hasTag("x")' }).filters).toBe('file.hasTag("x")');
  });

  it("lifts the legacy trailing or-group only when it provably encodes the old flat or-list (P8)", () => {
    // Rest of `and` is pure source -> this is the serialized old "any" form: lift.
    const legacy = parseBaseConfig(yaml.stringify({
      views: [{ type: "table", name: "T" }],
      filters: { and: ['file.folder == "X"', { or: ["c", "d"] }] },
    }));
    expect(legacy.filters).toEqual({ and: ['file.folder == "X"'], or: ["c", "d"] });

    // Group of pure sources next to property rules -> old or-SOURCES: lift too.
    const orSources = parseBaseConfig(yaml.stringify({
      views: [{ type: "table", name: "T" }],
      filters: { and: ["a", { or: ['file.hasTag("x")'] }] },
    }));
    expect(orSources.filters).toEqual({ and: ["a"], or: ['file.hasTag("x")'] });

    // Property rules AND a property group -> a REAL Notion-style group: keep it.
    const grouped = parseBaseConfig(yaml.stringify({
      views: [{ type: "table", name: "T" }],
      filters: { and: ["a", { or: ["c", "d"] }] },
    }));
    expect(grouped.filters).toEqual({ and: ["a", { or: ["c", "d"] }] });
  });

  it("round-trips group entries verbatim and drops empty group shells (P8)", () => {
    const config = {
      columns: {},
      views: [{ type: "table", name: "T" }],
      filters: { and: ['file.folder == "X"', "a", { or: ["c", "d"] }, { and: [] }] },
      _obsidian: {},
    };
    const out = yaml.parse(serializeBaseConfig(config));
    expect(out.filters).toEqual({ and: ['file.folder == "X"', "a", { or: ["c", "d"] }] });
    expect(validFilterNode(out.filters)).toBe(true);
    const round = parseBaseConfig(serializeBaseConfig(config));
    expect(round.filters).toEqual({ and: ['file.folder == "X"', "a", { or: ["c", "d"] }] });
  });

  it("keeps a group inside the or-list (top-level ANY with a group)", () => {
    const config = {
      columns: {},
      views: [{ type: "table", name: "T" }],
      filters: { or: ["a", { and: ["b", "c"] }] },
      _obsidian: {},
    };
    const out = yaml.parse(serializeBaseConfig(config));
    expect(out.filters).toEqual({ or: ["a", { and: ["b", "c"] }] });
    expect(validFilterNode(out.filters)).toBe(true);
    const round = parseBaseConfig(serializeBaseConfig(config));
    expect(round.filters).toEqual({ or: ["a", { and: ["b", "c"] }] });
  });

  it("parses a bare condition string into the and-list (Obsidian-authored files)", () => {
    const config = parseBaseConfig(yaml.stringify({ views: [{ type: "table", name: "T" }], filters: 'file.hasTag("x")' }));
    expect(config.filters).toEqual({ and: ['file.hasTag("x")'] });
  });

  it("heals the invalid two-key form older builds wrote on the next save", () => {
    const broken = yaml.stringify({ views: [{ type: "table" }], filters: { and: ["a"], or: ["b"] } });
    const healed = yaml.parse(serializeBaseConfig(parseBaseConfig(broken)));
    expect(healed.filters).toEqual({ and: ["a", { or: ["b"] }] });
    expect(validFilterNode(healed.filters)).toBe(true);
    expect(healed.views[0].name).toBe("Table");
  });

  it("round-trips the flat and+or lists stably across two disk cycles", () => {
    // Realistic "any" config: and holds the sources, or the property rules
    // (the UI never mixes property strings into both lists).
    const original = { columns: {}, views: [{ type: "table", name: "T" }], filters: { and: ['file.folder == "X"'], or: ["b"] }, _obsidian: {} };
    const once = parseBaseConfig(serializeBaseConfig(original));
    expect(once.filters).toEqual(original.filters);
    const twice = parseBaseConfig(serializeBaseConfig(once));
    expect(twice.filters).toEqual(original.filters);
    expect(twice.views).toEqual(once.views);
  });

  it("round-trips a grouped config stably across two disk cycles (P8)", () => {
    const original = {
      columns: {},
      views: [{ type: "table", name: "T" }],
      filters: { and: ['file.folder == "X"', "a", { or: ["c", "d"] }] },
      _obsidian: {},
    };
    const once = parseBaseConfig(serializeBaseConfig(original));
    expect(once.filters).toEqual(original.filters);
    const twice = parseBaseConfig(serializeBaseConfig(once));
    expect(twice.filters).toEqual(original.filters);
  });
});

// Plan D6: the Plainva-only extras (option color/group, relationBase) must live
// ONLY under the namespaced `plainva` sub-key so Obsidian's Bases plugin ignores
// them (graceful degradation) instead of choking on unknown native keys.
describe("baseFormat: plainva-namespaced extras never leak to the native level", () => {
  const config = {
    columns: {
      status: { input: "status", options: [{ value: "open", color: "teal", group: "Active" }] },
      ref: { input: "relation", relationBase: "DB/Other.base" },
    },
    views: [{ type: "board", groupBy: "status" }],
    _obsidian: {},
  };
  const out = yaml.parse(serializeBaseConfig(config));

  it("keeps color/group/relationBase under properties[x].plainva", () => {
    expect(out.properties["note.status"].plainva.options[0].color).toBe("teal");
    expect(out.properties["note.status"].plainva.options[0].group).toBe("Active");
    expect(out.properties["note.ref"].plainva.relationBase).toBe("DB/Other.base");
  });

  it("never emits those keys at the native property level or top level", () => {
    for (const id of Object.keys(out.properties)) {
      const native = out.properties[id];
      expect(Object.keys(native)).not.toContain("color");
      expect(Object.keys(native)).not.toContain("group");
      expect(Object.keys(native)).not.toContain("relationBase");
      expect(Object.keys(native)).not.toContain("options");
      expect(Object.keys(native)).not.toContain("input");
    }
    expect(Object.keys(out)).not.toContain("color");
    expect(Object.keys(out)).not.toContain("relationBase");
    expect(Object.keys(out)).not.toContain("columns");
  });

  it("keeps the board render hint under views[i].plainva (native type stays table)", () => {
    expect(out.views[0].type).toBe("table");
    expect(out.views[0].plainva.render).toBe("board");
    expect(out.views[0].plainva.groupBy).toBe("status");
    expect(Object.keys(out.views[0])).not.toContain("groupBy");
  });
});

// Graph incoming toggle + board column order (report 2026-07-07): both live
// ONLY under views[i].plainva so Obsidian keeps opening the file.
describe("baseFormat graph/board view keys (report 2026-07-07)", () => {
  it("round-trips graphShowIncoming and boardColumnOrder through views[i].plainva only", () => {
    const cfg = {
      columns: { status: { input: "status", options: [{ value: "Open" }] } },
      views: [
        { type: "graph", name: "Net", graphShowExternal: true, graphShowIncoming: true },
        { type: "board", name: "Board", groupBy: "status", boardColumnOrder: ["Open", "__UNGROUPED__"] },
      ],
      _obsidian: {},
    };
    const out = yaml.parse(serializeBaseConfig(cfg));
    expect(out.views[0].plainva.graphShowIncoming).toBe(true);
    expect(Object.keys(out.views[0])).not.toContain("graphShowIncoming");
    expect(out.views[1].plainva.boardColumnOrder).toEqual(["Open", "__UNGROUPED__"]);
    expect(Object.keys(out.views[1])).not.toContain("boardColumnOrder");

    const back = parseBaseConfig(serializeBaseConfig(cfg));
    expect(back.views[0].graphShowIncoming).toBe(true);
    expect(back.views[1].boardColumnOrder).toEqual(["Open", "__UNGROUPED__"]);
  });

  it("omits both keys when unset so unrelated views stay byte-identical", () => {
    const out = yaml.parse(serializeBaseConfig({ columns: {}, views: [{ type: "table", name: "V" }], _obsidian: {} }));
    expect(out.views[0].plainva?.graphShowIncoming).toBeUndefined();
    expect(out.views[0].plainva?.boardColumnOrder).toBeUndefined();
  });
});

// Gesamtplan Base-Relationen (2026-07-03): relation cardinality, computed
// reverse columns and the sub-items view key live ONLY in the plainva slots —
// Obsidian must keep opening these files (empty reverse column is the accepted
// degradation).
describe("baseFormat relation keys (relationLimit, reverseOf, subItemsProperty)", () => {
  it("round-trips all three keys through the plainva slots", () => {
    const text = yaml.stringify({
      properties: {
        "note.projekt": {
          plainva: { input: "relation", relationBase: "DB/Projekte.base", relationLimit: "one" },
        },
        "note.aufgaben": {
          plainva: { reverseOf: { base: "DB/Aufgaben.base", property: "projekt" } },
        },
      },
      views: [{ type: "table", name: "Alle", plainva: { subItemsProperty: "parent" } }],
    });
    const cfg = parseBaseConfig(text);
    expect(cfg.columns.projekt.relationLimit).toBe("one");
    expect(cfg.columns.aufgaben.reverseOf).toEqual({ base: "DB/Aufgaben.base", property: "projekt" });
    expect(cfg.views[0].subItemsProperty).toBe("parent");

    const out = yaml.parse(serializeBaseConfig(cfg));
    expect(out.properties["note.projekt"].plainva.relationLimit).toBe("one");
    expect(out.properties["note.aufgaben"].plainva.reverseOf).toEqual({
      base: "DB/Aufgaben.base",
      property: "projekt",
    });
    expect(out.views[0].plainva.subItemsProperty).toBe("parent");
  });

  it("drops garbage relationLimit and incomplete reverseOf on parse (self-healing)", () => {
    const text = yaml.stringify({
      properties: {
        "note.a": { plainva: { input: "relation", relationLimit: "many" } },
        "note.b": { plainva: { reverseOf: { base: "X.base" } } },
        "note.c": { plainva: { reverseOf: "nonsense" } },
      },
      views: [{ type: "table", name: "V", plainva: { subItemsProperty: "" } }],
    });
    const cfg = parseBaseConfig(text);
    expect(cfg.columns.a.relationLimit).toBeUndefined();
    expect(cfg.columns.b.reverseOf).toBeUndefined();
    expect(cfg.columns.c.reverseOf).toBeUndefined();
    expect(cfg.views[0].subItemsProperty).toBeUndefined();
  });

  it("never writes an implicit 'many' and never leaks the keys outside plainva", () => {
    const config = {
      columns: {
        projekt: { input: "relation", relationBase: "DB/Projekte.base" }, // no limit = unlimited
        aufgaben: { reverseOf: { base: "DB/Aufgaben.base", property: "projekt" } },
      },
      views: [{ type: "table", name: "Alle", subItemsProperty: "parent" }],
      _obsidian: {},
    };
    const out = yaml.parse(serializeBaseConfig(config));
    expect(out.properties["note.projekt"].plainva.relationLimit).toBeUndefined();
    for (const id of Object.keys(out.properties)) {
      expect(Object.keys(out.properties[id])).not.toContain("relationLimit");
      expect(Object.keys(out.properties[id])).not.toContain("reverseOf");
    }
    expect(Object.keys(out.views[0])).not.toContain("subItemsProperty");
    expect(out.views[0].plainva.subItemsProperty).toBe("parent");
    expect(Object.keys(out)).not.toContain("reverseOf");
  });
});

describe("baseFormat file icon color (Base-UX2 P7)", () => {
  it("parses the tint from the first view carrying views[i].plainva.fileIconColor", () => {
    const text = yaml.stringify({
      views: [
        { type: "table", name: "A" },
        { type: "table", name: "B", plainva: { fileIconColor: "#c94f4f" } },
      ],
    });
    expect(parseBaseConfig(text).iconColor).toBe("#c94f4f");
  });

  it("ignores invalid hex values on parse", () => {
    const text = yaml.stringify({
      views: [{ type: "table", name: "A", plainva: { fileIconColor: "red" } }],
    });
    expect(parseBaseConfig(text).iconColor).toBeUndefined();
  });

  it("stamps the tint onto view 0 only and scrubs stale duplicates", () => {
    const config = {
      iconColor: "#2f6f6f",
      columns: {},
      views: [{ type: "table", name: "A" }, { type: "board", name: "B" }],
      _obsidian: {
        views: [
          { type: "table", name: "A" },
          { type: "table", name: "B", plainva: { render: "board", fileIconColor: "#c94f4f" } },
        ],
      },
    };
    const out = yaml.parse(serializeBaseConfig(config));
    expect(out.views[0].plainva.fileIconColor).toBe("#2f6f6f");
    expect(out.views[1].plainva.fileIconColor).toBeUndefined();
    // No new top-level key — Obsidian only tolerates the four canonical ones.
    expect(Object.keys(out).sort()).toEqual(["views"]);
  });

  it("drops the key entirely when the color is removed or invalid", () => {
    const config = {
      columns: {},
      views: [{ type: "table", name: "A" }],
      _obsidian: { views: [{ type: "table", name: "A", plainva: { fileIconColor: "#c94f4f" } }] },
    };
    const out = yaml.parse(serializeBaseConfig(config));
    expect(out.views[0].plainva).toBeUndefined();

    const invalid = yaml.parse(serializeBaseConfig({ ...config, iconColor: "not-a-color" }));
    expect(invalid.views[0].plainva).toBeUndefined();
  });

  it("round-trips through parse -> serialize", () => {
    const text = yaml.stringify({
      views: [{ type: "table", name: "A", plainva: { fileIconColor: "#5a5fd0" } }],
    });
    const roundtripped = yaml.parse(serializeBaseConfig(parseBaseConfig(text)));
    expect(roundtripped.views[0].plainva.fileIconColor).toBe("#5a5fd0");
  });

  it("round-trips the graph view options under views[i].plainva (plan Graph P8)", () => {
    const config = {
      columns: { projekt: { input: "relation", relationBase: "Projekte" } },
      views: [
        {
          type: "graph",
          name: "Netz",
          graphEdges: ["projekt"],
          graphColorBy: "status",
          graphSizeBy: "prio",
          graphShowExternal: true,
        },
        { type: "table", name: "Tabelle" },
      ],
    };
    const onDisk = yaml.parse(serializeBaseConfig(config));
    // Obsidian sees a plain table; the render hint + options live in the namespace.
    expect(onDisk.views[0].type).toBe("table");
    expect(onDisk.views[0].plainva.render).toBe("graph");
    expect(onDisk.views[0].plainva.graphEdges).toEqual(["projekt"]);
    expect(onDisk.views[0].plainva.graphColorBy).toBe("status");
    expect(onDisk.views[0].plainva.graphSizeBy).toBe("prio");
    expect(onDisk.views[0].plainva.graphShowExternal).toBe(true);
    // Other views stay free of graph keys.
    expect(onDisk.views[1].plainva?.graphEdges).toBeUndefined();
    // Only the four canonical top-level keys.
    expect(Object.keys(onDisk).every((k) => ["views", "columns", "filters", "properties"].includes(k))).toBe(true);

    const back = parseBaseConfig(serializeBaseConfig(config));
    expect(back.views[0].type).toBe("graph");
    expect(back.views[0].graphEdges).toEqual(["projekt"]);
    expect(back.views[0].graphColorBy).toBe("status");
    expect(back.views[0].graphSizeBy).toBe("prio");
    expect(back.views[0].graphShowExternal).toBe(true);
    // Serialize is idempotent for the graph keys.
    expect(serializeBaseConfig(back)).toBe(serializeBaseConfig(config));
  });
});
