import { describe, it, expect } from "vitest";
import { ListChecks, Waypoints } from "lucide-react";
import { GRAPH_TAB_PATH, TASKS_TAB_PATH, isVirtualPath, virtualTabMeta } from "./virtualPaths";

describe("isVirtualPath", () => {
  it("recognizes plainva:// pseudo paths and nothing else", () => {
    expect(isVirtualPath(GRAPH_TAB_PATH)).toBe(true);
    expect(isVirtualPath(TASKS_TAB_PATH)).toBe(true);
    expect(isVirtualPath("Notes/Hello.md")).toBe(false);
    expect(isVirtualPath(null)).toBe(false);
    expect(isVirtualPath(undefined)).toBe(false);
  });
});

describe("virtualTabMeta", () => {
  it("maps the vault map tab to its localized label key and the ribbon icon", () => {
    const meta = virtualTabMeta(GRAPH_TAB_PATH);
    expect(meta?.labelKey).toBe("rightPanel.graph");
    expect(meta?.icon).toBe(Waypoints);
  });

  it("maps the tasks tab to its localized label key and the ribbon icon", () => {
    const meta = virtualTabMeta(TASKS_TAB_PATH);
    expect(meta?.labelKey).toBe("tasks.title");
    expect(meta?.icon).toBe(ListChecks);
  });

  it("returns null for real vault paths and nullish input", () => {
    expect(virtualTabMeta("Notes/Hello.md")).toBeNull();
    expect(virtualTabMeta("graph")).toBeNull();
    expect(virtualTabMeta(null)).toBeNull();
    expect(virtualTabMeta(undefined)).toBeNull();
  });
});
