import { describe, it, expect } from "vitest";
import { buildWizardConfig, collectWizardColumns } from "./createWizardModel";
import { serializeBaseConfig, parseBaseConfig } from "../../services/baseFormat";

describe("collectWizardColumns", () => {
  const rows = [
    { "file.name": "A", "file.path": "a.md", status: "active", tags: ["x"] },
    { "file.name": "B", "file.path": "b.md", status: "paused" },
  ];

  it("collects the property union with coverage, excluding file.*", () => {
    expect(collectWizardColumns(rows)).toEqual([
      { name: "status", coverage: 2, selected: true },
      { name: "tags", coverage: 1, selected: true },
    ]);
  });

  it("keeps a previous deselection when the source changes", () => {
    const prev = collectWizardColumns(rows).map((c) => (c.name === "tags" ? { ...c, selected: false } : c));
    expect(collectWizardColumns(rows, prev).find((c) => c.name === "tags")?.selected).toBe(false);
  });
});

describe("buildWizardConfig", () => {
  it("builds source filters, view order and schema for typed new columns", () => {
    const config = buildWizardConfig(
      ['file.folder == "Efforts"', 'file.hasTag("typ/projekt")'],
      [
        { name: "status", coverage: 2, selected: true },
        { name: "aliases", coverage: 1, selected: false },
      ],
      [{ name: "prio", input: "number" }, { name: "notiz", input: "text" }],
    );
    expect(config.filters.and).toEqual(['file.folder == "Efforts"', 'file.hasTag("typ/projekt")']);
    expect(config.views[0].order).toEqual(["file.name", "status", "prio", "notiz"]);
    expect(config.columns).toEqual({ prio: { input: "number" } });
  });

  it("produces a config that survives the Obsidian round-trip", () => {
    const config = buildWizardConfig(['file.folder == "P"'], [{ name: "status", coverage: 1, selected: true }], []);
    const parsed = parseBaseConfig(serializeBaseConfig(config));
    expect(parsed.filters.and).toEqual(['file.folder == "P"']);
    expect(parsed.views[0].order).toEqual(["file.name", "status"]);
    expect(parsed.views[0].type).toBe("table");
    expect(parsed.views[0].name).toBe("Table"); // Obsidian requires a view name
  });

  it("names the initial view with the localized label when given", () => {
    const config = buildWizardConfig(['file.folder == "P"'], [], [], "Tabelle");
    expect(config.views[0].name).toBe("Tabelle");
  });
});
