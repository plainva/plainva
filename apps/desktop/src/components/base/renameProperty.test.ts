import { describe, expect, it } from "vitest";
import { isValidNewPropertyName, propertyAliasResolver, renamePropertyInConfig } from "@plainva/ui";
import { retargetReverseColumns } from "@plainva/ui";

describe("renamePropertyInConfig (Base-UX2 follow-up)", () => {
  const config = {
    columns: { status: { input: "select", options: [{ value: "a" }] }, prio: { input: "number" } },
    views: [
      {
        type: "board",
        name: "Board",
        order: ["file.name", "status", "prio"],
        sort: [{ property: "status", direction: "ASC" }],
        groupBy: "status",
        widths: { status: 120 },
      },
      { type: "calendar", name: "Kal", dateField: "status", endField: "status", coverImage: "status" },
    ],
    filters: { and: ['file.folder == "P"', 'status == "a"'], or: ['note.status != "b"'] },
    _obsidian: { properties: { "note.status": { displayName: "Status" } } },
  };

  it("moves the schema, view references and widths to the new name", () => {
    const out = renamePropertyInConfig(config, "status", "zustand");
    expect(out.columns.zustand).toEqual({ input: "select", options: [{ value: "a" }], previousKeys: ["status"] });
    expect(out.columns.status).toBeUndefined();
    expect(out.views[0].order).toEqual(["file.name", "zustand", "prio"]);
    expect(out.views[0].sort[0].property).toBe("zustand");
    expect(out.views[0].groupBy).toBe("zustand");
    expect(out.views[0].widths).toEqual({ zustand: 120 });
    expect(out.views[1].dateField).toBe("zustand");
    expect(out.views[1].endField).toBe("zustand");
    expect(out.views[1].coverImage).toBe("zustand");
  });

  it("rewrites editable property filters, keeping the prefix style", () => {
    const out = renamePropertyInConfig(config, "status", "zustand");
    expect(out.filters.and).toEqual(['file.folder == "P"', 'zustand == "a"']);
    expect(out.filters.or).toEqual(['note.zustand != "b"']);
  });

  it("renames the raw _obsidian.properties entry so no ghost column survives", () => {
    const out = renamePropertyInConfig(config, "status", "zustand");
    expect(out._obsidian.properties["note.zustand"]).toEqual({ displayName: "Status" });
    expect(out._obsidian.properties["note.status"]).toBeUndefined();
  });

  it("prefers an explicitly passed schema over the stored one", () => {
    const out = renamePropertyInConfig(config, "status", "zustand", { input: "multiselect" });
    expect(out.columns.zustand).toEqual({ input: "multiselect", previousKeys: ["status"] });
  });

  it("does not mutate the input and leaves unrelated entries alone", () => {
    const before = JSON.stringify(config);
    const out = renamePropertyInConfig(config, "status", "zustand");
    expect(JSON.stringify(config)).toBe(before);
    expect(out.columns.prio).toEqual({ input: "number" });
    expect(out.views[0].order[2]).toBe("prio");
  });

  it("carries a view's subItemsProperty to the new name (parent-column rename keeps nesting)", () => {
    const cfg = { columns: { parent: { input: "relation", relationBase: "S.base" } }, views: [{ type: "table", subItemsProperty: "parent" }] };
    expect(renamePropertyInConfig(cfg, "parent", "oberelement").views[0].subItemsProperty).toBe("oberelement");
  });
});

describe("renaming a self-relation parent column preserves the sub-items function", () => {
  const selfRel = {
    columns: {
      parent: { input: "relation", relationBase: "DB/Tasks.base", relationLimit: "one" },
      subitems: { reverseOf: { base: "DB/Tasks.base", property: "parent" } },
      title: { input: "text" },
    },
    views: [{ type: "table", name: "All", order: ["file.name", "parent", "subitems"], subItemsProperty: "parent" }],
  };

  it("moves the column, the view's subItemsProperty AND the reverse pointer", () => {
    // Same composition the rename handler runs: config rename + same-base retarget.
    let out = renamePropertyInConfig(selfRel, "parent", "oberelement");
    out = retargetReverseColumns(out, "DB/Tasks.base", "parent", "oberelement") ?? out;

    expect(out.columns.oberelement.input).toBe("relation");
    expect(out.columns.parent).toBeUndefined();
    expect(out.views[0].subItemsProperty).toBe("oberelement"); // nesting still points at the column
    expect(out.views[0].order).toEqual(["file.name", "oberelement", "subitems"]);
    expect(out.columns.subitems.reverseOf.property).toBe("oberelement"); // reverse column stays fed
  });

  it("renames rules inside per-view filters (views[i].filters)", () => {
    const cfg = {
      columns: { status: { input: "select" } },
      views: [
        { type: "table", name: "T", filters: { and: ['status == "open"', { or: ['note.status != "done"'] }] } },
      ],
    };
    const out = renamePropertyInConfig(cfg, "status", "zustand");
    expect(out.views[0].filters.and[0]).toBe('zustand == "open"');
    expect(out.views[0].filters.and[1].or[0]).toBe('note.zustand != "done"');
  });
});

describe("isValidNewPropertyName", () => {
  const existing = ["prio", "tags"];
  it("accepts a fresh non-reserved name", () => {
    expect(isValidNewPropertyName("zustand", existing, "status")).toBe(true);
  });
  it("rejects empty, unchanged, colliding and reserved names", () => {
    expect(isValidNewPropertyName("  ", existing, "status")).toBe(false);
    expect(isValidNewPropertyName("status", existing, "status")).toBe(false);
    expect(isValidNewPropertyName("prio", existing, "status")).toBe(false);
    expect(isValidNewPropertyName("file.name", existing, "status")).toBe(false);
    expect(isValidNewPropertyName("note.x", existing, "status")).toBe(false);
    expect(isValidNewPropertyName("formula.x", existing, "status")).toBe(false);
  });
});

describe("rename trail on the column (plan Stufe E, E2)", () => {
  const cfg = { columns: { status: { input: "select" } }, views: [{ type: "table", name: "T", order: ["status"] }] };

  it("records the former name so a property comment can follow", () => {
    const out = renamePropertyInConfig(cfg, "status", "zustand");
    expect(out.columns.zustand.previousKeys).toEqual(["status"]);
    expect(out.columns.status).toBeUndefined();
  });

  it("appends on a second rename, oldest first", () => {
    const once = renamePropertyInConfig(cfg, "status", "zustand");
    const twice = renamePropertyInConfig(once, "zustand", "state");
    expect(twice.columns.state.previousKeys).toEqual(["status", "zustand"]);
  });

  it("drops the self-alias when renamed back to a former name", () => {
    const once = renamePropertyInConfig(cfg, "status", "zustand");
    const back = renamePropertyInConfig(once, "zustand", "status");
    // "status" would otherwise alias to itself and the resolver would spin.
    expect(back.columns.status.previousKeys).toEqual(["zustand"]);
  });

  it("keeps the trail bounded, oldest name falling off first", () => {
    let cur: any = cfg;
    let name = "status";
    for (let i = 0; i < 12; i += 1) {
      const next = `n${i}`;
      cur = renamePropertyInConfig(cur, name, next);
      name = next;
    }
    const keys = cur.columns[name].previousKeys;
    expect(keys.length).toBe(8);
    expect(keys).not.toContain("status");
    expect(keys[keys.length - 1]).toBe("n10");
  });

  it("also records the trail when the caller passes an explicit schema (the mobile path passes none)", () => {
    const out = renamePropertyInConfig(cfg, "status", "zustand", { input: "text" });
    expect(out.columns.zustand).toEqual({ input: "text", previousKeys: ["status"] });
  });
});

describe("propertyAliasResolver (Stufe E, E2 - reading the rename trail back)", () => {
  const base = { columns: { status: { input: "text" } } };

  it("leads a former key to the column that carries it today", () => {
    const renamed = renamePropertyInConfig(base, "status", "zustand");
    const aliasOf = propertyAliasResolver([renamed]);
    expect(aliasOf("status")).toBe("zustand");
    expect(aliasOf("never-existed")).toBe(null);
  });

  it("looks across every base the note belongs to", () => {
    const a = renamePropertyInConfig({ columns: { prio: {} } }, "prio", "priority");
    const b = renamePropertyInConfig(base, "status", "zustand");
    const aliasOf = propertyAliasResolver([a, b]);
    expect(aliasOf("prio")).toBe("priority");
    expect(aliasOf("status")).toBe("zustand");
  });

  it("answers nothing when two columns claim the same former key", () => {
    // Pointing the comment at an arbitrary one would attach it to a property
    // its author never saw.
    const a = renamePropertyInConfig(base, "status", "zustand");
    const b = renamePropertyInConfig(base, "status", "state");
    expect(propertyAliasResolver([a, b])("status")).toBe(null);
  });

  it("ignores a hand-written trail that points a column at itself", () => {
    const cfg = { columns: { status: { previousKeys: ["status"] } } };
    expect(propertyAliasResolver([cfg])("status")).toBe(null);
  });

  it("survives a base with no columns at all", () => {
    expect(propertyAliasResolver([{}, null, { columns: [] }])("status")).toBe(null);
  });
});
