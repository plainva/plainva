import { describe, it, expect } from "vitest";
import { deletePropertyFromConfig } from "@plainva/ui";

const config = (): any => ({
  columns: {
    status: { input: "select", options: [{ value: "offen" }] },
    projekt: { input: "relation", relationBase: "DB/Projekte.base" },
  },
  views: [
    {
      type: "table",
      name: "Alle",
      order: ["file.name", "status", "projekt"],
      sort: [{ property: "status", direction: "ASC" }, { property: "file.name", direction: "ASC" }],
      widths: { status: 120, projekt: 160 },
      subItemsProperty: "projekt",
    },
    { type: "board", name: "Board", groupBy: "status", dateField: "status", endField: "status", coverImage: "status" },
  ],
  filters: {
    and: [
      'file.folder == "P"',
      'status == "offen"',
      { or: ['status == "x"', 'prio == "1"'] },
      { or: ['status == "y"'] },
    ],
    or: [],
  },
  _obsidian: {
    properties: {
      "note.status": { displayName: "Status", plainva: { input: "select" } },
      "note.projekt": { plainva: { input: "relation" } },
    },
  },
});

describe("deletePropertyFromConfig (plan Base-Neu P11)", () => {
  it("removes the column from schema, order, sort, widths and by-name view fields", () => {
    const next = deletePropertyFromConfig(config(), "status");
    expect(next.columns.status).toBeUndefined();
    expect(next.columns.projekt).toBeDefined();
    expect(next.views[0].order).toEqual(["file.name", "projekt"]);
    expect(next.views[0].sort).toEqual([{ property: "file.name", direction: "ASC" }]);
    expect("status" in next.views[0].widths).toBe(false);
    expect(next.views[1].groupBy).toBeUndefined();
    expect(next.views[1].dateField).toBeUndefined();
    expect(next.views[1].endField).toBeUndefined();
    expect(next.views[1].coverImage).toBeUndefined();
  });

  it("clears the sub-items parent reference when its property is deleted", () => {
    const next = deletePropertyFromConfig(config(), "projekt");
    expect(next.views[0].subItemsProperty).toBeUndefined();
    // unrelated fields survive
    expect(next.views[1].groupBy).toBe("status");
  });

  it("drops filter rules on the property, inside groups too; an emptied group vanishes", () => {
    const next = deletePropertyFromConfig(config(), "status");
    expect(next.filters.and).toEqual(['file.folder == "P"', { or: ['prio == "1"'] }]);
  });

  it("also matches note.-prefixed order/sort/filter references", () => {
    const cfg: any = {
      columns: { status: {} },
      views: [{ type: "table", name: "T", order: ["note.status"], sort: [{ property: "note.status", direction: "ASC" }] }],
      filters: { and: ['note.status == "x"'] },
    };
    const next = deletePropertyFromConfig(cfg, "status");
    expect(next.views[0].order).toEqual([]);
    expect(next.views[0].sort).toEqual([]);
    expect(next.filters.and).toEqual([]);
  });

  it("scrubs the raw _obsidian entry so serialize cannot resurrect the column", () => {
    const next = deletePropertyFromConfig(config(), "status");
    expect(next._obsidian.properties["note.status"]).toBeUndefined();
    expect(next._obsidian.properties["note.projekt"]).toBeDefined();
  });

  it("leaves the input untouched and survives empty configs", () => {
    const cfg = config();
    deletePropertyFromConfig(cfg, "status");
    expect(cfg.columns.status).toBeDefined();
    expect(deletePropertyFromConfig({}, "x").columns).toEqual({});
    expect(deletePropertyFromConfig(null, "x").columns).toEqual({});
  });

  it("drops the property rules from per-view filters (views[i].filters)", () => {
    const cfg = {
      columns: { status: { input: "select" }, prio: {} },
      views: [
        {
          type: "table",
          name: "T",
          filters: { and: ['status == "open"', 'prio == "1"', { or: ['note.status != "done"'] }] },
        },
      ],
    };
    const out = deletePropertyFromConfig(cfg, "status");
    expect(out.views[0].filters.and).toEqual(['prio == "1"']); // emptied group vanished too
  });
});
