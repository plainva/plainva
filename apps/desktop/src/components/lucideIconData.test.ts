import { describe, it, expect } from "vitest";
import {
  LUCIDE_CATEGORIES,
  LUCIDE_ICONS,
  LUCIDE_ICON_MAP,
  lucideIconsByCategory,
  searchLucideIcons,
} from "@plainva/ui";

describe("lucideIconData", () => {
  it("has unique kebab-case names within the curated size range", () => {
    const names = LUCIDE_ICONS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    // Decision E2: ~400 curated, not all ~1,750. The range guards both
    // directions — a wall of icons and a quietly shrinking set.
    expect(names.length).toBeGreaterThanOrEqual(350);
    expect(names.length).toBeLessThanOrEqual(450);
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

  /**
   * A note's icon is persisted as `lucide:<name>` in its frontmatter. Dropping an
   * entry would leave that note without its icon, so the set the catalogue
   * shipped with before it grew to 400 is pinned here. An upstream rename is
   * fine — it arrives as an ADDITIONAL entry, never as a replacement of a name a
   * file already holds.
   */
  it("never loses a name a note may already carry", () => {
    const shipped = [
      "book", "book-open", "notebook", "notebook-pen", "library", "folder", "folder-open",
      "folder-tree", "file", "file-text", "files", "archive", "newspaper", "sticky-note",
      "clipboard", "clipboard-list", "briefcase", "calendar", "calendar-days", "clock", "timer",
      "target", "flag", "check", "circle-check", "list", "list-todo", "kanban",
      "layout-dashboard", "table", "presentation", "inbox", "send", "code", "terminal", "cpu",
      "database", "server", "hard-drive", "monitor", "laptop", "smartphone", "keyboard", "globe",
      "cloud", "wifi", "bug", "bot", "git-branch", "mail", "message-circle", "message-square",
      "phone", "user", "users", "contact", "at-sign", "megaphone", "rss", "palette", "brush",
      "pen", "pen-tool", "pencil", "camera", "image", "film", "clapperboard", "video", "music",
      "mic", "headphones", "guitar", "sparkles", "house", "heart", "star", "coffee", "utensils",
      "chef-hat", "pizza", "cake", "apple", "wine", "car", "bike", "plane", "train-front", "ship",
      "map", "map-pin", "compass", "mountain", "tent", "sun", "moon", "cloud-rain", "umbrella",
      "tree-pine", "leaf", "flower", "dog", "cat", "bird", "fish", "baby", "shopping-cart",
      "wallet", "credit-card", "banknote", "dollar-sign", "euro", "coins", "piggy-bank",
      "chart-column", "chart-line", "chart-pie", "trending-up", "calculator", "landmark",
      "lightbulb", "rocket", "gift", "party-popper", "bell", "lock", "key", "shield", "settings",
      "wrench", "hammer", "search", "bookmark", "tag", "link", "paperclip", "trash-2",
      "triangle-alert", "info", "circle-question-mark", "smile", "ghost", "zap", "flame", "award",
      "trophy", "crown", "graduation-cap", "stethoscope", "pill", "heart-pulse", "dumbbell",
      "gamepad-2", "puzzle", "eye", "thumbs-up", "brain", "earth", "box", "package", "building",
      "store", "school", "flask-conical", "dna",
    ];
    const missing = shipped.filter((name) => !LUCIDE_ICON_MAP.has(name));
    expect(missing, `these names are persisted in user notes: ${missing.join(", ")}`).toEqual([]);
  });

  describe("categories", () => {
    it("gives every entry one of the declared categories", () => {
      for (const entry of LUCIDE_ICONS) {
        expect(LUCIDE_CATEGORIES).toContain(entry.category);
      }
    });

    it("leaves no category empty — an empty tab is a dead tab", () => {
      const empty = LUCIDE_CATEGORIES.filter((c) => lucideIconsByCategory(c).length === 0);
      expect(empty).toEqual([]);
    });

    it("partitions the catalogue: every entry sits in exactly one category", () => {
      const perCategory = LUCIDE_CATEGORIES.reduce((sum, c) => sum + lucideIconsByCategory(c).length, 0);
      expect(perCategory).toBe(LUCIDE_ICONS.length);
    });

    it("keeps the catalogue order inside a category", () => {
      const knowledge = lucideIconsByCategory("knowledge").map((e) => e.name);
      const inCatalogue = LUCIDE_ICONS.filter((e) => e.category === "knowledge").map((e) => e.name);
      expect(knowledge).toEqual(inCatalogue);
    });
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

    it("finds an added icon by name and by german keyword", () => {
      expect(searchLucideIcons("hourglass").map((e) => e.name)).toContain("hourglass");
      expect(searchLucideIcons("sanduhr").map((e) => e.name)).toContain("hourglass");
    });

    it("dedupes results and caps them at 120", () => {
      for (const query of ["a", "e", "en"]) {
        const results = searchLucideIcons(query);
        expect(results.length).toBeLessThanOrEqual(120);
        const names = results.map((entry) => entry.name);
        expect(new Set(names).size).toBe(names.length);
      }
    });

    it("carries the category through, so search and tabs read one source", () => {
      for (const entry of searchLucideIcons("folder")) {
        expect(LUCIDE_ICON_MAP.get(entry.name)?.category).toBe(entry.category);
      }
    });
  });
});
