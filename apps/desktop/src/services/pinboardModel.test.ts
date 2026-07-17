import { describe, it, expect } from "vitest";
import {
  applyPin,
  applyUnpin,
  captureFileName,
  distributeCards,
  dropSlotAt,
  filterCardPaths,
  orderCards,
  pinboardColumnCount,
  retargetPinboardPaths,
  spliceIntoSequence,
} from "@plainva/ui";
import { buildCaptureContent } from "./newItemFlow";

const row = (path: string, ctime: number | null, mtime = 0) => ({ path, ctime, mtime });

describe("orderCards (§3 order semantics)", () => {
  it("floats unarranged cards on top by ctime desc, then the listed order", () => {
    const rows = [row("alt.md", 10), row("neu.md", 30), row("a.md", 5), row("b.md", 5)];
    const s = orderCards(rows, ["a.md", "b.md"], undefined);
    expect(s.unpinned).toEqual(["neu.md", "alt.md", "a.md", "b.md"]);
    expect(s.pinned).toEqual([]);
  });

  it("falls back to mtime for legacy rows without ctime and breaks ties by path", () => {
    const rows = [row("b.md", null, 20), row("a.md", null, 20), row("c.md", null, 50)];
    expect(orderCards(rows, [], undefined).unpinned).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("renders the pinned section in pinboardPinned order and never repeats those cards below", () => {
    const rows = [row("a.md", 1), row("b.md", 2), row("c.md", 3)];
    const s = orderCards(rows, ["a.md", "b.md", "c.md"], ["c.md", "a.md"]);
    expect(s.pinned).toEqual(["c.md", "a.md"]);
    expect(s.unpinned).toEqual(["b.md"]);
  });

  it("self-heals: entries whose file left the source set are ignored", () => {
    const rows = [row("a.md", 1)];
    const s = orderCards(rows, ["weg.md", "a.md"], ["auch-weg.md"]);
    expect(s.pinned).toEqual([]);
    expect(s.unpinned).toEqual(["a.md"]);
  });
});

describe("spliceIntoSequence (D3 splice semantics)", () => {
  const seq = ["a.md", "b.md", "c.md", "d.md"];
  it("moves the dragged card before the target and keeps everything else stable", () => {
    expect(spliceIntoSequence(seq, ["d.md"], { kind: "before", path: "b.md" })).toEqual(["a.md", "d.md", "b.md", "c.md"]);
  });
  it("moves to the end for the end slot and for unknown targets", () => {
    expect(spliceIntoSequence(seq, ["a.md"], { kind: "end" })).toEqual(["b.md", "c.md", "d.md", "a.md"]);
    expect(spliceIntoSequence(seq, ["a.md"], { kind: "before", path: "zz.md" })).toEqual(["b.md", "c.md", "d.md", "a.md"]);
  });
  it("materializes the full sequence — a chip-filtered view never loses hidden positions", () => {
    // The caller always passes the FULL unfiltered sequence; the result lists it completely.
    const out = spliceIntoSequence(["u1.md", "u2.md", "a.md"], ["a.md"], { kind: "before", path: "u1.md" });
    expect(out).toEqual(["a.md", "u1.md", "u2.md"]);
  });
});

describe("pin/unpin mutators", () => {
  const present = new Set(["a.md", "b.md", "c.md"]);
  it("pin puts the card on top of the pinned section and removes it from the order", () => {
    const r = applyPin(["a.md", "b.md"], ["c.md"], "a.md", present);
    expect(r.pinned).toEqual(["a.md", "c.md"]);
    expect(r.order).toEqual(["b.md"]);
  });
  it("unpin returns the card to the top of the unpinned section", () => {
    const r = applyUnpin(["b.md"], ["a.md", "c.md"], "a.md", present);
    expect(r.pinned).toEqual(["c.md"]);
    expect(r.order).toEqual(["a.md", "b.md"]);
  });
  it("both mutators self-heal stale entries while writing", () => {
    const r = applyPin(["weg.md", "b.md"], ["auch-weg.md"], "a.md", present);
    expect(r.order).toEqual(["b.md"]);
    expect(r.pinned).toEqual(["a.md"]);
  });
});

describe("retargetPinboardPaths (P5 sweep)", () => {
  it("rewrites moved paths and reports whether anything changed", () => {
    const moves = new Map([["alt/Zettel.md", "neu/Zettel.md"]]);
    expect(retargetPinboardPaths(["alt/Zettel.md", "x.md"], moves)).toEqual({ list: ["neu/Zettel.md", "x.md"], changed: true });
    expect(retargetPinboardPaths(["x.md"], moves).changed).toBe(false);
  });
});

describe("masonry layout", () => {
  it("distributes cards into the shortest column deterministically", () => {
    const heights = new Map([["a", 100], ["b", 300], ["c", 100], ["d", 100]]);
    // a->col0, b->col1, c->col0 (100+12 < 300+12), d->col0? col0=224, col1=312 -> col0
    expect(distributeCards(["a", "b", "c", "d"], heights, 2)).toEqual([["a", "c", "d"], ["b"]]);
  });
  it("computes the column count from the container width and never returns 0", () => {
    expect(pinboardColumnCount(1000, 256, 12)).toBe(3);
    expect(pinboardColumnCount(200, 256, 12)).toBe(1);
    expect(pinboardColumnCount(0)).toBe(1);
  });
});

describe("dropSlotAt", () => {
  const rects = [
    { path: "a", top: 0, bottom: 100, left: 0, right: 100 },
    { path: "b", top: 110, bottom: 210, left: 0, right: 100 },
  ];
  it("targets before the hovered card in its upper half, after it below", () => {
    expect(dropSlotAt(rects, ["a", "b"], 50, 20)).toEqual({ kind: "before", path: "a" });
    expect(dropSlotAt(rects, ["a", "b"], 50, 90)).toEqual({ kind: "before", path: "b" });
    expect(dropSlotAt(rects, ["a", "b"], 50, 200)).toEqual({ kind: "end" });
  });
  it("returns end when the pointer misses every card", () => {
    expect(dropSlotAt(rects, ["a", "b"], 500, 500)).toEqual({ kind: "end" });
  });
});

describe("filterCardPaths (P4 chip filter)", () => {
  const labels = new Map<string, string[]>([
    ["a.md", ["einkauf", "privat/haus"]],
    ["b.md", ["einkauf"]],
    ["c.md", []],
  ]);
  it("keeps every card without a selection and AND-combines selected chips", () => {
    expect(filterCardPaths(["a.md", "b.md", "c.md"], labels, [])).toEqual(["a.md", "b.md", "c.md"]);
    expect(filterCardPaths(["a.md", "b.md", "c.md"], labels, ["einkauf"])).toEqual(["a.md", "b.md"]);
    expect(filterCardPaths(["a.md", "b.md", "c.md"], labels, ["einkauf", "privat/haus"])).toEqual(["a.md"]);
  });
  it("matches tag labels hierarchically (privat also matches privat/haus)", () => {
    expect(filterCardPaths(["a.md", "b.md"], labels, ["privat"])).toEqual(["a.md"]);
  });
});

describe("buildCaptureContent (P4 quick capture)", () => {
  it("keeps the typed text as the body — no auto-H1, OKF frontmatter added", () => {
    const c = buildCaptureContent({ text: "Milch kaufen\n- [ ] Brot", noteType: "Note", inheritTags: [] });
    expect(c).toMatch(/^---\n/); // OKF frontmatter
    expect(c).toContain("type: Note");
    expect(c).toContain("Milch kaufen\n- [ ] Brot");
    expect(c).not.toContain("# Milch"); // deliberately no heading
  });
  it("merges inherited source tags into the frontmatter", () => {
    const c = buildCaptureContent({ text: "Text", noteType: "Note", inheritTags: ["zettel"] });
    expect(c).toContain("zettel");
  });
});

describe("captureFileName (P4 naming)", () => {
  it("takes the cleaned first words and strips markers and invalid characters", () => {
    expect(captureFileName("- [ ] Milch **kaufen** und Brot")).toBe("Milch kaufen und Brot");
    expect(captureFileName('# Titel: mit "Zeichen"? ja/nein')).toBe("Titel mit Zeichen ja nein");
  });
  it("caps at a word boundary and never ends with dots or spaces", () => {
    const name = captureFileName("Ein sehr langer Erfassungstext der deutlich mehr als achtundvierzig Zeichen hat");
    expect(name!.length).toBeLessThanOrEqual(48);
    expect(name!.endsWith(" ")).toBe(false);
    expect(name!.includes(" ")).toBe(true);
    expect(captureFileName("Name endet mit Punkt.")).toBe("Name endet mit Punkt");
  });
  it("returns null when nothing usable remains", () => {
    expect(captureFileName("   \n\n")).toBeNull();
    expect(captureFileName("###")).toBeNull();
  });
});
