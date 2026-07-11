import { describe, expect, it } from "vitest";
import { isValidNewPropertyName, renamePropertyInConfig } from "@plainva/ui";
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
    expect(out.columns.zustand).toEqual({ input: "select", options: [{ value: "a" }] });
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
    expect(out.columns.zustand).toEqual({ input: "multiselect" });
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
