import { describe, it, expect } from "vitest";
import { buildSubItemsTree } from "@plainva/ui";

interface Row {
  path: string;
  title: string;
  parent?: unknown;
}

const opts = (expanded: string[] = [], maxDepth?: number) => ({
  keyOf: (r: Row) => r.path,
  titleOf: (r: Row) => r.title,
  parentRefOf: (r: Row) => r.parent,
  expandedKeys: new Set(expanded),
  maxDepth,
});

const row = (path: string, title: string, parent?: unknown): Row => ({ path, title, parent });

describe("buildSubItemsTree", () => {
  it("nests children under expanded parents, preserving sibling order", () => {
    const rows = [
      row("a.md", "A"),
      row("b.md", "B"),
      row("a1.md", "A1", "[[A]]"),
      row("a2.md", "A2", "[[A]]"),
    ];
    const out = buildSubItemsTree(rows, opts(["a.md"]));
    expect(out.map((n) => [n.row.title, n.depth])).toEqual([
      ["A", 0],
      ["A1", 1],
      ["A2", 1],
      ["B", 0],
    ]);
    expect(out[0]).toMatchObject({ hasChildren: true, childCount: 2, isExpanded: true });
    expect(out[3]).toMatchObject({ hasChildren: false, childCount: 0, isExpanded: false });
  });

  it("hides collapsed subtrees but keeps their child count", () => {
    const rows = [row("a.md", "A"), row("a1.md", "A1", "[[A]]"), row("a1a.md", "A1a", "[[A1]]")];
    const out = buildSubItemsTree(rows, opts([]));
    expect(out.map((n) => n.row.title)).toEqual(["A"]);
    expect(out[0]).toMatchObject({ hasChildren: true, childCount: 1, isExpanded: false });
  });

  it("promotes rows to top level when the parent is outside the result set or self", () => {
    const rows = [
      row("kind.md", "Kind", "[[Nicht Im Ergebnis]]"),
      row("selbst.md", "Selbst", "[[Selbst]]"),
      row("leer.md", "Leer", ""),
      row("liste.md", "Liste", ["[[Nicht Da]]", "[[Auch Nicht]]"]),
    ];
    const out = buildSubItemsTree(rows, opts([]));
    expect(out.map((n) => [n.row.title, n.depth, n.hasChildren])).toEqual([
      ["Kind", 0, false],
      ["Selbst", 0, false],
      ["Leer", 0, false],
      ["Liste", 0, false],
    ]);
  });

  it("resolves parent refs by title, path and path without .md (aliases/anchors stripped)", () => {
    const rows = [
      row("Ordner/Parent.md", "Titelname"),
      row("t.md", "T", "[[Titelname]]"),
      row("p.md", "P", "[[Ordner/Parent]]"),
      row("pm.md", "PM", "[[Ordner/Parent.md]]"),
      row("al.md", "AL", "[[Titelname#Abschnitt|Anzeige]]"),
    ];
    const out = buildSubItemsTree(rows, opts(["Ordner/Parent.md"]));
    expect(out.map((n) => [n.row.title, n.depth])).toEqual([
      ["Titelname", 0],
      ["T", 1],
      ["P", 1],
      ["PM", 1],
      ["AL", 1],
    ]);
  });

  it("emits cycle members exactly once, as top-level roots in input order", () => {
    const rows = [row("x.md", "X"), row("a.md", "A", "[[B]]"), row("b.md", "B", "[[A]]")];
    const out = buildSubItemsTree(rows, opts(["a.md", "b.md"]));
    expect(out.map((n) => [n.row.title, n.depth])).toEqual([
      ["X", 0],
      ["A", 0],
      ["B", 1],
    ]);
    // B's child A is already covered — the cycle is cut, nothing repeats.
    expect(out.filter((n) => n.row.title === "A").length).toBe(1);
  });

  it("stops descending at maxDepth", () => {
    const rows = [row("a.md", "A"), row("b.md", "B", "[[A]]"), row("c.md", "C", "[[B]]")];
    const out = buildSubItemsTree(rows, opts(["a.md", "b.md"], 1));
    expect(out.map((n) => n.row.title)).toEqual(["A", "B"]);
  });

  it("keeps the first occurrence on duplicate keys", () => {
    const rows = [row("a.md", "Erste"), row("a.md", "Zweite")];
    const out = buildSubItemsTree(rows, opts([]));
    expect(out.length).toBe(1);
    expect(out[0]!.row.title).toBe("Erste");
  });

  // One rule for where a link leads (finding 2026-10-08): the table nests a
  // row under the note its parent link LEADS to — the answer a click on the
  // chip gives —, not under whichever row of the result happens to carry the
  // name. The shells hand in the vault's lookup; the rows of the result only
  // stand in for it until it is loaded.
  describe("with the vault's link lookup", () => {
    const rows = [row("Aufgaben/Planung.md", "Planung"), row("Aufgaben/Teil.md", "Teil", "[[Planung]]"), row("Aufgaben/Rest.md", "Rest", "[[Planung]]")];
    const nested = [["Planung", 0], ["Teil", 1], ["Rest", 1]];
    const flat = [["Planung", 0], ["Teil", 0], ["Rest", 0]];
    const shape = (resolveRef?: (fromPath: string, target: string) => string | null) =>
      buildSubItemsTree(rows, { ...opts(["Aufgaben/Planung.md"]), resolveRef }).map((n) => [n.row.title, n.depth]);

    it("nests under the row the link leads to", () => {
      expect(shape((_from, target) => (target === "Planung" ? "Aufgaben/Planung.md" : null))).toEqual(nested);
    });

    it("leaves a row at the top where its parent link leads to a note outside the result", () => {
      // A `Planung.md` at the vault's root, not part of this view: the link
      // leads there (the chip opens it), so the row in the view is no parent.
      const asked: string[][] = [];
      expect(shape((from, target) => { asked.push([from, target]); return "Planung.md"; })).toEqual(flat);
      // Read from the child's own note, with the target as the rule takes it.
      expect(asked).toContainEqual(["Aufgaben/Teil.md", "Planung"]);
    });

    it("leaves a row at the top where its parent link leads nowhere, and falls back to the rows without a lookup", () => {
      expect(shape(() => null)).toEqual(flat);
      expect(shape(undefined)).toEqual(nested);
    });
  });
});
