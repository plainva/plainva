import { describe, it, expect } from "vitest";
import { LUCIDE_ICONS, LUCIDE_ICON_MAP, searchLucideIcons } from "@plainva/ui";

describe("lucideIconData", () => {
  it("has unique kebab-case names within the curated size range", () => {
    const names = LUCIDE_ICONS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    expect(names.length).toBeGreaterThanOrEqual(100);
    expect(names.length).toBeLessThanOrEqual(200);
  });

  it("has a non-empty icon node for every entry", () => {
    for (const entry of LUCIDE_ICONS) {
      expect(Array.isArray(entry.node)).toBe(true);
      expect(entry.node.length).toBeGreaterThan(0);
    }
  });

  it("resolves entries by name via LUCIDE_ICON_MAP", () => {
    expect(LUCIDE_ICON_MAP.get("rocket")).toBeDefined();
    expect(LUCIDE_ICON_MAP.get("rocket")?.name).toBe("rocket");
    expect(LUCIDE_ICON_MAP.size).toBe(LUCIDE_ICONS.length);
  });

  describe("searchLucideIcons", () => {
    it("returns all icons for an empty query", () => {
      expect(searchLucideIcons("")).toEqual(LUCIDE_ICONS);
    });

    it("matches names case-insensitively", () => {
      const names = searchLucideIcons("BOOK").map((entry) => entry.name);
      expect(names).toContain("book-open");
    });

    it("matches german keywords", () => {
      const names = searchLucideIcons("ordner").map((entry) => entry.name);
      expect(names).toContain("folder");
    });

    it("dedupes results and caps them at 60", () => {
      for (const query of ["a", "e", "en"]) {
        const results = searchLucideIcons(query);
        expect(results.length).toBeLessThanOrEqual(60);
        const names = results.map((entry) => entry.name);
        expect(new Set(names).size).toBe(names.length);
      }
    });
  });
});
