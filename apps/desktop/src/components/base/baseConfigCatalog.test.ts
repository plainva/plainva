import { describe, it, expect } from "vitest";
import {
  BASE_CONFIG_AREAS,
  BASE_VIEW_TYPES,
  baseConfigArea,
  baseViewTypeMeta,
  firstBaseConfigArea,
} from "@plainva/ui";

describe("baseConfigCatalog — areas", () => {
  it("carries the five config areas in tab order", () => {
    expect(BASE_CONFIG_AREAS.map((a) => a.id)).toEqual(["view", "columns", "filter", "sort", "source"]);
  });

  it("marks only the data source as database-wide (the rest are per-view)", () => {
    const byScope = Object.fromEntries(BASE_CONFIG_AREAS.map((a) => [a.id, a.scope]));
    expect(byScope).toEqual({ view: "view", columns: "view", filter: "view", sort: "view", source: "database" });
  });

  it("looks areas up by id and falls back to undefined", () => {
    expect(baseConfigArea("filter")?.labelKey).toBe("database.filter");
    expect(baseConfigArea("nope")).toBeUndefined();
  });

  it("lands on 'view' as the first area", () => {
    expect(firstBaseConfigArea().id).toBe("view");
  });

  it("gives every area a distinct icon and a database.* label key", () => {
    const icons = new Set(BASE_CONFIG_AREAS.map((a) => a.icon));
    expect(icons.size).toBe(BASE_CONFIG_AREAS.length);
    for (const a of BASE_CONFIG_AREAS) expect(a.labelKey.startsWith("database.")).toBe(true);
  });
});

describe("baseConfigCatalog — view types", () => {
  it("lists all eight render types, native ones first", () => {
    expect(BASE_VIEW_TYPES.map((v) => v.type)).toEqual([
      "table", "list", "gallery", "board", "calendar", "timeline", "graph", "pinboard",
    ]);
  });

  it("gates exactly the Plainva-only types as extended", () => {
    const extended = BASE_VIEW_TYPES.filter((v) => v.extended).map((v) => v.type);
    expect(extended).toEqual(["board", "calendar", "timeline", "graph", "pinboard"]);
  });

  it("gives each type a distinct icon and the matching database.view* label", () => {
    const icons = new Set(BASE_VIEW_TYPES.map((v) => v.icon));
    expect(icons.size).toBe(BASE_VIEW_TYPES.length);
    expect(baseViewTypeMeta("board").labelKey).toBe("database.viewBoard");
  });

  it("falls back to the table meta for an unknown type", () => {
    expect(baseViewTypeMeta("mystery").type).toBe("table");
  });
});
