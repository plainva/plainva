import { describe, it, expect } from "vitest";
import { within } from "../../../../packages/core/test/helpers/timeBudget";
import {
  applyPin,
  applyUnpin,
  captureFileName,
  captureTimestampName,
  distributeCards,
  dropSlotAt,
  filterCardPaths,
  filterCardPathsByText,
  pinboardTextMatches,
  orderCards,
  pinboardColumnCount,
  retargetPinboardPaths,
  reorderShown,
  spliceIntoSequence,
} from "@plainva/ui";

const row = (path: string, ctime: number | null, mtime = 0) => ({ path, ctime, mtime });

it("composes text and label filters without losing the hidden order during a drag", () => {
  const sequence = ["a", "b", "c", "d"];
  const labels = new Map(sequence.map(path => [path, [path === "b" ? "other" : "topic"]]));
  expect(filterCardPathsByText(filterCardPaths(sequence, labels, ["topic"]), new Set(["b", "c"]))).toEqual(["c"]);
  expect(filterCardPathsByText(sequence, null)).toBe(sequence);
  expect(pinboardTextMatches(["Status: Offen", "#MÜLLER"], "müller")).toBe(true);
  expect(spliceIntoSequence(sequence, sequence, ["d"], { kind: "before", path: "a" })).toEqual(["d", "a", "b", "c"]);
});

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
    expect(spliceIntoSequence(seq, seq, ["d.md"], { kind: "before", path: "b.md" })).toEqual(["a.md", "d.md", "b.md", "c.md"]);
  });
  it("moves to the end for the end slot and for unknown targets", () => {
    expect(spliceIntoSequence(seq, seq, ["a.md"], { kind: "end" })).toEqual(["b.md", "c.md", "d.md", "a.md"]);
    expect(spliceIntoSequence(seq, seq, ["a.md"], { kind: "before", path: "zz.md" })).toEqual(["b.md", "c.md", "d.md", "a.md"]);
  });
  it("materializes the unarranged cards it shows on the first drag, in the order drawn", () => {
    const out = spliceIntoSequence(undefined, ["u1.md", "u2.md", "a.md"], ["a.md"], { kind: "before", path: "u1.md" });
    expect(out).toEqual(["a.md", "u1.md", "u2.md"]);
  });
  it("leaves a card dropped onto itself where it is", () => {
    expect(spliceIntoSequence(seq, seq, ["b.md"], { kind: "before", path: "b.md" })).toEqual(seq);
  });
  it("writes each entry once, also where the stored list held one twice", () => {
    expect(spliceIntoSequence(["a.md", "b.md", "a.md"], ["a.md", "b.md"], ["b.md"], { kind: "before", path: "a.md" })).toEqual(["b.md", "a.md"]);
  });
  it("drops at the end after the last card shown, also where a list holds a card twice and so draws it twice", () => {
    const pinned = ["n0.md", "n3.md", "n9.md", "n0.md"];
    const drawn = orderCards(["n0.md", "n3.md", "n9.md"].map((p) => row(p, 1)), [], pinned).pinned;
    expect(drawn).toEqual(pinned);
    expect(spliceIntoSequence(pinned, drawn, ["n3.md"], { kind: "end" })).toEqual(["n0.md", "n9.md", "n3.md"]);
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

describe("captureTimestampName (title popup 2026-07-17)", () => {
  it("formats a sortable, Windows-safe timestamp with zero padding", () => {
    const name = captureTimestampName(new Date(2026, 6, 5, 9, 3, 7));
    expect(name).toBe("2026-07-05 09.03.07");
    expect(name).not.toMatch(/[<>:"/\\|?*]/);
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

describe("the search in a database's head narrows what is shown, never what the arrangement heals against (0.8.4 to 0.8.7)", () => {
  // The board draws what the search lets through; the .base holds every
  // card. A pin, an unpin and a drag healed their lists against the cards on
  // screen: one pin while searching took every other card's place out of the
  // file, and the sync carried it on. They heal against every card of the
  // VIEW now, before the search narrows it — a path whose file is gone still goes.
  const storedOrder = ["B/a.md", "B/b.md", "B/c.md", "B/d.md", "B/gone.md"];
  const storedPinned = ["B/p1.md", "B/p2.md"];
  const view = new Set(["B/a.md", "B/b.md", "B/c.md", "B/d.md", "B/p1.md", "B/p2.md", "B/x.md"]);
  const shown = ["B/a.md", "B/p1.md", "B/x.md"]; // "groceries" typed into the head's search

  it("a pin while searching keeps every card of the view, and drops a dead path as before", () => {
    const r = applyPin(storedOrder, storedPinned, "B/x.md", view);
    expect(r.order).toEqual(["B/a.md", "B/b.md", "B/c.md", "B/d.md"]);
    expect(r.pinned).toEqual(["B/x.md", "B/p1.md", "B/p2.md"]);
  });

  it("an unpin while searching", () => {
    const r = applyUnpin(storedOrder, storedPinned, "B/p1.md", view);
    expect(r.order).toEqual(["B/p1.md", "B/a.md", "B/b.md", "B/c.md", "B/d.md"]);
    expect(r.pinned).toEqual(["B/p2.md"]);
  });

  it("a drag while searching moves the card among the shown ones; the hidden ones keep their places", () => {
    const drawn = orderCards(shown.map((p, i) => row(p, 100 - i)), storedOrder, storedPinned).unpinned;
    expect(drawn).toEqual(["B/x.md", "B/a.md"]);
    // Dragged to the end of what the person saw: right after the last card shown.
    expect(spliceIntoSequence(storedOrder, drawn, ["B/x.md"], { kind: "end" }, view)).toEqual(["B/a.md", "B/x.md", "B/b.md", "B/c.md", "B/d.md"]);
  });

  it("a board's columns reordered while searching keep the place of every column not shown", () => {
    // Shown: Doing and Done (Todo has no card that matches); Done is dragged before Doing.
    expect(reorderShown(["Todo", "Doing", "Done", "Later"], ["Done", "Doing"])).toEqual(["Todo", "Done", "Doing", "Later"]);
  });

  it("a column new to the stored order goes where it was dropped", () => {
    expect(reorderShown(["Alpha", "Beta"], ["Gamma", "Alpha", "Beta"])).toEqual(["Gamma", "Alpha", "Beta"]);
    expect(reorderShown(["Alpha", "Beta"], ["Alpha", "Gamma", "Beta"])).toEqual(["Alpha", "Gamma", "Beta"]);
    expect(reorderShown(["Alpha", "Beta"], ["Alpha", "Beta", "Gamma"])).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(reorderShown(["Todo", "Doing", "Done"], ["N1", "N2", "Done", "Todo"])).toEqual(["N1", "N2", "Done", "Doing", "Todo"]);
  });

  it("a stored order that holds a key twice writes each key once, never an empty place", () => {
    const out = reorderShown(["A", "B", "A"], ["B", "A"]);
    expect(out).toEqual(["B", "A"]);
    expect(out.every((k) => typeof k === "string")).toBe(true);
  });

  it("orders thousands of new columns in one pass (a first drag on a board with many groups)", () => {
    const keys = Array.from({ length: 5000 }, (_, i) => `g${i}`);
    // One pass takes a few milliseconds; searching the order again for every new key took tens of seconds.
    const fresh = within(1_000, () => reorderShown([], keys));
    const half = within(1_000, () => reorderShown(keys.filter((_, i) => i % 2 === 1), [...keys].reverse()));
    expect(fresh).toEqual(keys);
    expect(half).toHaveLength(5000);
    expect(new Set(half).size).toBe(5000);
  });
});
