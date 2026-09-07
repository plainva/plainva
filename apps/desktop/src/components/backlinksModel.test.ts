import { describe, expect, it } from "vitest";
import { backlinkContexts, contextChain, groupBacklinks } from "./backlinksModel";

describe("groupBacklinks", () => {
  it("collapses repeated sources and counts their occurrences", () => {
    const grouped = groupBacklinks([
      { source_path: "a.md" },
      { source_path: "b.md" },
      { source_path: "a.md" },
      { source_path: "a.md" },
    ]);
    expect(grouped).toEqual([
      { source_path: "a.md", count: 3, lines: [] },
      { source_path: "b.md", count: 1, lines: [] },
    ]);
  });

  it("keeps the first-seen order of the sources", () => {
    const grouped = groupBacklinks([
      { source_path: "z.md" },
      { source_path: "a.md" },
      { source_path: "z.md" },
    ]);
    expect(grouped.map((g) => g.source_path)).toEqual(["z.md", "a.md"]);
  });

  it("returns an empty list for no links", () => {
    expect(groupBacklinks([])).toEqual([]);
  });

  it("collects the distinct lines of a source, ascending, ignoring unknown ones (P7)", () => {
    const grouped = groupBacklinks([
      { source_path: "a.md", line_number: 12 },
      { source_path: "a.md", line_number: 3 },
      { source_path: "a.md", line_number: 12 },
      { source_path: "a.md", line_number: null },
    ]);
    expect(grouped).toEqual([{ source_path: "a.md", count: 4, lines: [3, 12] }]);
  });
});

describe("backlinkContexts", () => {
  const DOC = [
    "---",
    "tags: [x]",
    "---",
    "# Projekt",
    "Intro with [[Alpha]].",
    "## Aufgaben",
    "- Erster Punkt",
    "  - Unterpunkt mit [[Alpha]]",
    "    - [ ] Tief, siehe [[Alpha]]",
    "Absatz danach [[Alpha]].",
    "### Details",
    "1. Nummer eins",
    "   2. Verschachtelt [[Alpha]]",
  ].join("\n");

  it("gives every occurrence its heading chain, list parents and line text", () => {
    const ctx = backlinkContexts(DOC, [5, 8, 9, 10, 13]);
    expect(ctx[0]).toEqual({ line: 5, headings: ["Projekt"], listParents: [], lineText: "Intro with [[Alpha]]." });
    expect(ctx[1]).toEqual({ line: 8, headings: ["Projekt", "Aufgaben"], listParents: ["Erster Punkt"], lineText: "Unterpunkt mit [[Alpha]]" });
    expect(ctx[2]).toEqual({ line: 9, headings: ["Projekt", "Aufgaben"], listParents: ["Erster Punkt", "Unterpunkt mit [[Alpha]]"], lineText: "Tief, siehe [[Alpha]]" });
    // Prose after the list: no list parents, the chain stays.
    expect(ctx[3]).toEqual({ line: 10, headings: ["Projekt", "Aufgaben"], listParents: [], lineText: "Absatz danach [[Alpha]]." });
    expect(ctx[4]).toEqual({ line: 13, headings: ["Projekt", "Aufgaben", "Details"], listParents: ["Nummer eins"], lineText: "Verschachtelt [[Alpha]]" });
  });

  it("reads as breadcrumbs", () => {
    expect(contextChain(backlinkContexts(DOC, [9])[0])).toBe("Projekt › Aufgaben › Erster Punkt › Unterpunkt mit [[Alpha]]");
    expect(contextChain(backlinkContexts(DOC, [5])[0])).toBe("Projekt");
  });

  it("clamps a line outside the document", () => {
    expect(backlinkContexts(DOC, [99])[0].lineText).toBe("Verschachtelt [[Alpha]]");
    expect(backlinkContexts(DOC, [0])[0].line).toBe(0);
  });
});
