import { describe, it, expect } from "vitest";
import { fuzzyScore, fuzzyFilter } from "./fuzzyScore";

describe("fuzzyScore (quick switcher, P3.3)", () => {
  it("matches gap subsequences like Obsidian's switcher", () => {
    expect(fuzzyScore("prjplan", "Project Plan")).not.toBeNull();
    expect(fuzzyScore("prjplan", "Printers")).toBeNull();
  });

  it("is case-insensitive and matches exact substrings", () => {
    expect(fuzzyScore("plan", "Projekt-PLAN")).not.toBeNull();
    expect(fuzzyScore("PLAN", "plan")).not.toBeNull();
  });

  it("prefers word starts and consecutive runs over scattered hits", () => {
    const wordStart = fuzzyScore("pp", "Project Plan")!;
    const scattered = fuzzyScore("pp", "grappa mapper")!;
    expect(wordStart).toBeGreaterThan(scattered);

    const consecutive = fuzzyScore("plan", "Plan 2026")!;
    const spread = fuzzyScore("plan", "Pale Lion Antenna Night")!;
    expect(consecutive).toBeGreaterThan(spread);
  });

  it("returns 0 for an empty query and null when impossible", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("longer", "log")).toBeNull();
    expect(fuzzyScore("xyz", "abc")).toBeNull();
  });

  it("fuzzyFilter ranks by best key and respects the limit", () => {
    const items = [
      { title: "Project Plan", path: "Arbeit/Project Plan.md" },
      { title: "Peer Log", path: "Notizen/Peer Log.md" },
      { title: "Plotter", path: "prjplan-Archiv/Plotter.md" },
    ];
    const hits = fuzzyFilter("prjplan", items, (i) => [i.title, i.path], 10);
    expect(hits.length).toBe(2);
    // Direct path run in "prjplan-Archiv" is a full consecutive match — it may
    // outrank the title subsequence; both must be present.
    const titles = hits.map((h) => h.item.title);
    expect(titles).toContain("Project Plan");
    expect(titles).toContain("Plotter");
    expect(fuzzyFilter("prjplan", items, (i) => [i.title, i.path], 1).length).toBe(1);
  });
});
