import { describe, it, expect } from "vitest";
import {
  addReverseColumnToConfig,
  enableSubItemsConfig,
  findReverseColumn,
  isValidReverseColumnName,
  removeReverseColumnFromConfig,
  resolveNewItemTarget,
  retargetReverseColumns,
  setColumnDisplayName,
  sourceFolderOfConfig,
  sourceTagOfConfig,
  writeReverseColumnChange,
  type BaseFileAdapter,
} from "./baseRelations";
import { parseBaseConfig, serializeBaseConfig } from "./baseFormat";
import { parse as parseYaml } from "yaml";

const baseConfig = () => ({
  columns: {
    projekt: { input: "relation", relationBase: "DB/Projekte.base" },
    aufgaben: { reverseOf: { base: "DB/Aufgaben.base", property: "projekt" } },
  },
  views: [
    { type: "table", name: "Alle", order: ["file.name", "projekt"], sort: [], widths: { projekt: 120 } },
    { type: "board", name: "Board" },
  ],
  filters: { and: ['file.folder == "DB/Projekte"'], or: ['file.hasTag("projekt")'] },
});

describe("baseRelations config mutators", () => {
  it("finds a reverse column by source base + property (path normalized)", () => {
    const cfg = baseConfig();
    expect(findReverseColumn(cfg, "DB/Aufgaben.base", "projekt")).toBe("aufgaben");
    expect(findReverseColumn(cfg, "DB\\Aufgaben.base", "projekt")).toBe("aufgaben");
    expect(findReverseColumn(cfg, "DB/Aufgaben.base", "anderes")).toBeNull();
    expect(findReverseColumn({}, "x.base", "y")).toBeNull();
  });

  it("adds a reverse column and appends it to non-empty view orders only", () => {
    const next = addReverseColumnToConfig(baseConfig(), {
      name: "unterelemente",
      sourceBasePath: "Self.base",
      sourceProperty: "parent",
    });
    expect(next.columns.unterelemente).toEqual({
      reverseOf: { base: "Self.base", property: "parent" },
    });
    expect(next.views[0].order).toEqual(["file.name", "projekt", "unterelemente"]);
    expect(next.views[1].order).toBeUndefined();
    // input stays untouched
    expect(baseConfig().views[0].order).toEqual(["file.name", "projekt"]);
  });

  it("removes a reverse column from columns, order, sort and widths", () => {
    const cfg = baseConfig();
    const view = cfg.views[0]!;
    view.order!.push("aufgaben");
    (view.sort as any[]).push({ property: "aufgaben", direction: "ASC" });
    (view.widths as any).aufgaben = 200;
    const next = removeReverseColumnFromConfig(cfg, "aufgaben");
    expect(next.columns.aufgaben).toBeUndefined();
    expect(next.views[0].order).toEqual(["file.name", "projekt"]);
    expect(next.views[0].sort).toEqual([]);
    expect("aufgaben" in next.views[0].widths).toBe(false);
  });

  it("scrubs the raw _obsidian property entry on remove (no ghost column after serialize)", () => {
    const cfg: any = baseConfig();
    cfg._obsidian = {
      properties: {
        "note.aufgaben": { plainva: { reverseOf: { base: "DB/Aufgaben.base", property: "projekt" } } },
        "note.projekt": { displayName: "Projekt", plainva: { input: "relation" } },
      },
    };
    const next = removeReverseColumnFromConfig(cfg, "aufgaben");
    expect(next._obsidian.properties["note.aufgaben"]).toBeUndefined();
    // Other raw entries (Obsidian extras) stay untouched.
    expect(next._obsidian.properties["note.projekt"].displayName).toBe("Projekt");
  });

  it("retargets reverseOf pointers after a source-property rename, null when unaffected", () => {
    const hit = retargetReverseColumns(baseConfig(), "DB/Aufgaben.base", "projekt", "vorhaben");
    expect(hit.columns.aufgaben.reverseOf).toEqual({ base: "DB/Aufgaben.base", property: "vorhaben" });
    expect(retargetReverseColumns(baseConfig(), "DB/Aufgaben.base", "anderes", "x")).toBeNull();
    expect(retargetReverseColumns(baseConfig(), "Fremd.base", "projekt", "x")).toBeNull();
  });

  it("validates reverse-column names against the target's columns and reserved prefixes", () => {
    const cfg = baseConfig();
    expect(isValidReverseColumnName("neu", cfg)).toBe(true);
    expect(isValidReverseColumnName("projekt", cfg)).toBe(false); // taken
    expect(isValidReverseColumnName("", cfg)).toBe(false);
    expect(isValidReverseColumnName("file.x", cfg)).toBe(false);
    expect(isValidReverseColumnName("note.x", cfg)).toBe(false);
  });

  it("extracts the first folder/tag source condition", () => {
    const cfg = baseConfig();
    expect(sourceFolderOfConfig(cfg)).toBe("DB/Projekte");
    expect(sourceTagOfConfig(cfg)).toBe("projekt");
    expect(sourceFolderOfConfig({})).toBeNull();
    expect(sourceTagOfConfig({ filters: { and: ['status == "x"'] } })).toBeNull();
  });
});

describe("resolveNewItemTarget (plan Base-Neu P2)", () => {
  it("uses the single folder source automatically", () => {
    const target = resolveNewItemTarget({ filters: { and: ['file.folder == "Projekte"', 'status == "x"'] } });
    expect(target.folder).toBe("Projekte");
    expect(target.pending).toBeNull();
    expect(target.folderSources).toEqual(["Projekte"]);
  });

  it("prefers a persisted newItemFolder that is still a source", () => {
    const filters = { or: ['file.folder == "A"', 'file.folder == "B"'] };
    expect(resolveNewItemTarget({ filters, newItemFolder: "B" }).folder).toBe("B");
    // stale preference (source removed) -> back to the choice dialog
    const stale = resolveNewItemTarget({ filters, newItemFolder: "C" });
    expect(stale.folder).toBeNull();
    expect(stale.pending).toBe("choice");
  });

  it("asks for setup when no folder source exists", () => {
    const target = resolveNewItemTarget({ filters: { and: ['status == "x"'] } });
    expect(target.folder).toBeNull();
    expect(target.pending).toBe("setup");
  });

  it("accepts any persisted folder on a tag-only base and inherits the tag", () => {
    const target = resolveNewItemTarget({
      filters: { and: ['file.hasTag("projekt")'] },
      newItemFolder: "Ablage",
    });
    expect(target.folder).toBe("Ablage");
    expect(target.inheritTags).toEqual(["projekt"]);
  });

  it("inherits every and-tag, or the first or-tag only without folder sources", () => {
    expect(
      resolveNewItemTarget({ filters: { and: ['file.hasTag("a")', 'file.hasTag("b")', 'file.folder == "F"'] } }).inheritTags
    ).toEqual(["a", "b"]);
    expect(
      resolveNewItemTarget({ filters: { or: ['file.hasTag("x")', 'file.hasTag("y")'] } }).inheritTags
    ).toEqual(["x"]);
    // folder sources make membership — or-tags are not required then
    expect(
      resolveNewItemTarget({ filters: { and: ['file.folder == "F"'], or: ['file.hasTag("x")'] } }).inheritTags
    ).toEqual([]);
  });
});

describe("writeReverseColumnChange", () => {
  it("round-trips the target file through parse → mutate → serialize", async () => {
    const files = new Map<string, string>();
    files.set(
      "DB/Projekte.base",
      [
        "filters:",
        "  and:",
        '    - file.folder == "DB/Projekte"',
        "views:",
        "  - type: table",
        "    name: Alle",
        "    order:",
        "      - file.name",
        "",
      ].join("\n")
    );
    const adapter: BaseFileAdapter = {
      readTextFile: async (p) => files.get(p)!,
      writeTextFile: async (p, c) => {
        files.set(p, c);
      },
    };

    await writeReverseColumnChange(adapter, "DB/Projekte.base", (cfg) =>
      addReverseColumnToConfig(cfg, {
        name: "aufgaben",
        sourceBasePath: "DB/Aufgaben.base",
        sourceProperty: "projekt",
      })
    );

    const out = parseYaml(files.get("DB/Projekte.base")!);
    expect(out.properties["note.aufgaben"].plainva.reverseOf).toEqual({
      base: "DB/Aufgaben.base",
      property: "projekt",
    });
    expect(out.views[0].order).toContain("note.aufgaben");
    // Obsidian hard requirements survive the cross-file write
    expect(out.views[0].name).toBe("Alle");
    expect(Object.keys(out.filters)).toEqual(["and"]);
  });
});

describe("setColumnDisplayName (naming fix)", () => {
  it("stores a localized displayName and keeps it plus the plainva block through a round-trip", () => {
    const cfg: any = {
      columns: { parent: { input: "relation", relationBase: "Self.base", relationLimit: "one" } },
      views: [{ type: "table", name: "All" }],
    };
    const withName = setColumnDisplayName(cfg, "parent", "Übergeordnetes Element");
    expect(withName._obsidian.properties["note.parent"].displayName).toBe("Übergeordnetes Element");
    const round = parseBaseConfig(serializeBaseConfig(withName));
    expect(round._obsidian.properties["note.parent"].displayName).toBe("Übergeordnetes Element");
    expect(round.columns.parent).toMatchObject({ input: "relation", relationBase: "Self.base", relationLimit: "one" });
  });

  it("is a no-op for an empty label", () => {
    expect(setColumnDisplayName({ columns: {} }, "parent", "   ")._obsidian).toBeUndefined();
  });
});

describe("enableSubItemsConfig (naming fix)", () => {
  const labels = { parentItem: "Parent item", subItems: "Sub-items" };

  it("creates stable `parent` + `subitems` keys, each with a localized displayName", () => {
    const { config, parentProperty } = enableSubItemsConfig(
      { columns: {}, views: [{ type: "table", name: "All" }] },
      "Self.base",
      labels
    );
    expect(parentProperty).toBe("parent");
    expect(config.columns.parent).toEqual({ input: "relation", relationBase: "Self.base", relationLimit: "one" });
    expect(config.columns.subitems).toEqual({ reverseOf: { base: "Self.base", property: "parent" } });
    // headers are the localized labels, keys stay stable/portable
    const round = parseBaseConfig(serializeBaseConfig(config));
    expect(round._obsidian.properties["note.parent"].displayName).toBe("Parent item");
    expect(round._obsidian.properties["note.subitems"].displayName).toBe("Sub-items");
    expect(round.columns.parent.relationBase).toBe("Self.base");
  });

  it("reuses an existing self-relation column without renaming it or forcing a displayName", () => {
    const cfg: any = {
      columns: { übergeordnet: { input: "relation", relationBase: "./Self.base", relationLimit: "one" } },
      views: [{ type: "table", name: "All" }],
    };
    const { config, parentProperty } = enableSubItemsConfig(cfg, "Self.base", labels);
    expect(parentProperty).toBe("übergeordnet"); // path-normalized match, ./ prefix tolerated
    expect(config.columns.parent).toBeUndefined(); // no second parent column
    expect(config._obsidian?.properties?.["note.übergeordnet"]?.displayName).toBeUndefined();
    expect(findReverseColumn(config, "Self.base", "übergeordnet")).not.toBeNull();
  });
});
