import { describe, it, expect } from "vitest";
import { defineBase, serializeBaseConfig, parseBaseConfig } from "@plainva/ui";

/**
 * `defineBase` capabilities added for the showcase template (plan
 * "Vorlagen-Überarbeitung + Plainva-Tour", step P1.2).
 *
 * Every new capability is checked on the ROUND TRIP — in-memory spec → on-disk
 * YAML → parsed back — because that is the only place the two-layer contract is
 * visible: Obsidian sees `filters`/`properties`/`views` and nothing else, while
 * Plainva's richness lives under the `plainva` namespace. A key written to the
 * wrong layer would still "work" in memory and be silently dropped on disk.
 */

const roundTrip = (config: unknown) => parseBaseConfig(serializeBaseConfig(config));
const yamlOf = (config: unknown) => serializeBaseConfig(config);

describe("defineBase — pinboard views", () => {
  const base = defineBase({
    path: "Notizzettel.base",
    sourceFolder: "Notizzettel",
    columns: [{ key: "kategorie", input: "multiselect", options: ["Idee", "Zitat"] }],
    views: [
      {
        name: "Pinnwand",
        type: "pinboard",
        pinboardPinned: ["Notizzettel/Willkommen.md"],
        pinboardOrder: ["Notizzettel/Idee.md", "Notizzettel/Zitat.md"],
        pinboardFilterBy: "kategorie",
      },
      { name: "Liste", type: "list" },
    ],
  });

  it("degrades to a table on disk and keeps the render mode in the namespace", () => {
    const yaml = yamlOf(base.config);
    // Obsidian must see a type it knows, or it rejects the whole file.
    expect(yaml).toContain("type: table");
    expect(yaml).not.toMatch(/type: pinboard/);
    expect(yaml).toContain("render: pinboard");
  });

  it("round-trips the pinned set, the manual order and the label source", () => {
    const back = roundTrip(base.config);
    const view = back.views[0];
    expect(view.type).toBe("pinboard");
    expect(view.pinboardPinned).toEqual(["Notizzettel/Willkommen.md"]);
    expect(view.pinboardOrder).toEqual(["Notizzettel/Idee.md", "Notizzettel/Zitat.md"]);
    expect(view.pinboardFilterBy).toBe("kategorie");
    // A second view stays untouched by the first view's pinboard keys.
    expect(back.views[1].type).toBe("list");
    expect(back.views[1].pinboardPinned).toBeUndefined();
  });

  it("omits pinboard keys that were not set", () => {
    const plain = defineBase({
      path: "P.base",
      sourceFolder: "P",
      columns: [],
      views: [{ name: "Pinnwand", type: "pinboard" }],
    });
    const yaml = yamlOf(plain.config);
    expect(yaml).not.toContain("pinboardPinned");
    expect(yaml).not.toContain("pinboardOrder");
    // "tags" is the default label source and must stay unwritten.
    expect(yaml).not.toContain("pinboardFilterBy");
  });
});

describe("defineBase — option colours", () => {
  const base = defineBase({
    path: "Projekte.base",
    sourceFolder: "Projekte",
    columns: [
      {
        key: "status",
        input: "status",
        options: [{ value: "Geplant", color: "blue" }, "Aktiv", { value: "Fertig", color: "green" }],
      },
    ],
    views: [{ name: "Tabelle", type: "table" }],
  });

  it("round-trips palette names and leaves uncoloured options bare", () => {
    const back = roundTrip(base.config);
    expect(back.columns.status.options).toEqual([
      { value: "Geplant", color: "blue" },
      { value: "Aktiv" },
      { value: "Fertig", color: "green" },
    ]);
  });

  it("writes the options inside the property's plainva namespace", () => {
    const yaml = yamlOf(base.config);
    expect(yaml).toContain("note.status:");
    expect(yaml).toContain("plainva:");
    expect(yaml).toContain("color: blue");
  });
});

describe("defineBase — board tint, gallery cover, sub-items, new-item folder", () => {
  const base = defineBase({
    path: "Aufgaben.base",
    sourceFolder: "Aufgaben",
    columns: [
      { key: "status", input: "status", options: ["Offen", "Erledigt"] },
      { key: "cover", input: "text" },
      { key: "parent", input: "relation", relationBase: "Aufgaben.base", relationLimit: "one", displayName: "Übergeordnet" },
      { key: "subitems", reverseOf: { base: "Aufgaben.base", property: "parent" }, displayName: "Unterelemente" },
    ],
    views: [
      { name: "Tafel", type: "board", groupBy: "status", boardColorMode: "column" },
      { name: "Galerie", type: "gallery", coverImage: "cover" },
      { name: "Baum", type: "table", subItemsProperty: "parent" },
    ],
    newItemTemplate: "Vorlagen/Aufgabe.md",
    newItemFolder: "Aufgaben",
  });

  it("round-trips every view extra", () => {
    const back = roundTrip(base.config);
    expect(back.views[0]).toMatchObject({ type: "board", groupBy: "status", boardColorMode: "column" });
    expect(back.views[1]).toMatchObject({ type: "gallery", coverImage: "cover" });
    expect(back.views[2]).toMatchObject({ subItemsProperty: "parent" });
  });

  it("round-trips the new-item folder and template (first view only)", () => {
    const back = roundTrip(base.config);
    expect(back.newItemFolder).toBe("Aufgaben");
    expect(back.newItemTemplate).toBe("Vorlagen/Aufgabe.md");
    const yaml = yamlOf(base.config);
    // Both belong to the FIRST view's namespace — a duplicate on a later view
    // would make reorders leave stale copies behind.
    expect(yaml.match(/newItemFolder/g) ?? []).toHaveLength(1);
  });

  it("carries localized headers as Obsidian's native displayName", () => {
    const yaml = yamlOf(base.config);
    expect(yaml).toContain("displayName: Übergeordnet");
    expect(yaml).toContain("displayName: Unterelemente");
    const back = roundTrip(base.config);
    // The KEYS stay stable and portable — only the header is localized.
    expect(back.columns.parent).toMatchObject({ input: "relation", relationLimit: "one" });
    expect(back.columns.subitems).toMatchObject({ reverseOf: { base: "Aufgaben.base", property: "parent" } });
    expect(back._obsidian.properties["note.parent"].displayName).toBe("Übergeordnet");
  });
});

describe("defineBase — unchanged behaviour for existing templates", () => {
  it("still produces the plain shape when no new field is used", () => {
    const base = defineBase({
      path: "Bereiche.base",
      sourceFolder: "Bereiche",
      columns: [{ key: "projekte", reverseOf: { base: "Projekte.base", property: "bereich" } }],
      views: [{ name: "Tabelle", type: "table" }],
    });
    expect(base.config).toEqual({
      filters: { and: ['file.folder == "Bereiche"'] },
      columns: { projekte: { reverseOf: { base: "Projekte.base", property: "bereich" } } },
      views: [{ type: "table", name: "Tabelle", order: ["file.name", "projekte"] }],
    });
    // No _obsidian block is introduced when no column carries a displayName.
    expect(base.config).not.toHaveProperty("_obsidian");
  });
});
