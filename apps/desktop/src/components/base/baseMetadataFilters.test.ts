import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { baseFilterCatalog, baseFilterValues, buildUIFilterModel, parseBaseConfig, serializeBaseConfig, parsePropertyFilter, serializePropertyFilter, stripPropertyFilters } from "@plainva/ui";

describe("metadata filter authoring", () => {
  it("round-trips tags as view rules and retains unrelated source and custom data", () => {
    const expression = serializePropertyFilter({ column: "file.tags", op: "contains", value: "work" });
    expect(expression).toBe('file.tags.contains("#work")');
    const config = parseBaseConfig(`filters:\n  and:\n    - file.folder == "Notes"\nviews:\n  - type: table\n    name: Tagged\n    order: [file.name]\n    filters:\n      and:\n        - '${expression}'\n        - 'note.plainva.icon == "🍃"'\n        - 'unrecognized()'\n`);
    const reread = parseBaseConfig(serializeBaseConfig(config));
    expect(reread.views[0].filters).toEqual(config.views[0].filters);
    expect(buildUIFilterModel(reread.views[0]).entries.map((entry) => entry.kind)).toEqual(["rule", "rule", "rawString"]);
    expect(stripPropertyFilters(reread).filters).toEqual(config.filters);
    expect(parsePropertyFilter('!file.tags.isEmpty()')).toEqual({ column: "file.tags", op: "notEmpty", value: "" });
  });

  it("normalizes colours and retains unknown selected values", () => {
    expect(serializePropertyFilter({ column: "note.plainva.header_color", op: "==", value: "#ABC" }))
      .toBe('note.plainva.header_color == "#aabbcc"');
    expect(baseFilterValues([{ plainva: { header_color: "#ABC" } }, { plainva: '{"header_color":"#aabbcc"}' }], "note.plainva.header_color"))
      .toEqual(["#aabbcc"]);
    expect(baseFilterValues([], "note.plainva.icon", "lucide:unknown")).toEqual(["lucide:unknown"]);
  });

  it("offers a single whole-note tag filter and names custom pinboard label sources", () => {
    const t = ((key: string, values?: { property?: string }) => `${key}${values?.property ?? ""}`) as TFunction;
    const defaultFields = baseFilterCatalog(["tags", "plainva", "status"], (column) => column, t, "tags");
    expect(defaultFields.filter((field) => field.kind === "tags")).toHaveLength(1);
    expect(defaultFields.some((field) => field.column === "plainva")).toBe(false);
    const labels = baseFilterCatalog(["status"], (column) => column, t, "status");
    expect(labels.find((field) => field.column === "status")).toMatchObject({ kind: "labels", label: "database.filterLabelsFromstatus" });
  });
});
