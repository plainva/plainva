import { describe, expect, it } from "vitest";
import {
  ANCHOR_CONTEXT_CHARS,
  MAX_ANCHOR_QUOTE_BYTES,
  assertWorkspaceCommentAnchor,
  buildCommentAnchor,
  buildPropertyCommentAnchor,
  closeAnchorMarker,
  findAnchorMarker,
  insertAnchorMarkers,
  isAnchorMarkerId,
  isLegacyTableQuote,
  mintAnchorMarkerId,
  parseTablesIn,
  stripWidgetAnchorMarkers,
  openAnchorMarker,
  placeAnchorRange,
  repairAnchorMarkerPlacement,
  propertyAnchorKey,
  removeAnchorMarkers,
  resolveCommentAnchor,
  resolvePropertyAnchor,
  stripAnchorMarkers,
  type WorkspaceCommentAnchor,
} from "../src/index.js";

const SENTENCE = "Der Vertrag laeuft bis Ende des Jahres und wird danach automatisch verlaengert.";

/** Anchors the given phrase in `text` the way the editor would. */
function anchorPhrase(text: string, phrase: string, markerId = "7f3a"): { raw: string; anchor: WorkspaceCommentAnchor } {
  const from = text.indexOf(phrase);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = from + phrase.length;
  return { raw: insertAnchorMarkers(text, from, to, markerId), anchor: buildCommentAnchor(text, from, to, markerId) };
}

describe("comment anchor markers", () => {
  it("wraps the selection in an HTML comment pair", () => {
    const { raw } = anchorPhrase(SENTENCE, "bis Ende des Jahres");
    expect(raw).toBe("Der Vertrag laeuft <!--pv#7f3a-->bis Ende des Jahres<!--/pv#7f3a--> und wird danach automatisch verlaengert.");
  });

  it("hides every marker from the text a reader sees", () => {
    const { raw } = anchorPhrase(SENTENCE, "bis Ende des Jahres");
    expect(stripAnchorMarkers(raw).text).toBe(SENTENCE);
  });

  it("mints an id that does not collide with one already in the note", () => {
    let call = 0;
    // First draw repeats the id already in the note, second draw is free.
    const random = () => new Uint8Array(call++ === 0 ? [0x7f, 0x3a] : [0x0a, 0x11]);
    expect(mintAnchorMarkerId("... <!--pv#7f3a-->x<!--/pv#7f3a--> ...", random)).toBe("0a11");
  });

  it("rejects an id that is not four hex characters", () => {
    expect(isAnchorMarkerId("7f3a")).toBe(true);
    expect(isAnchorMarkerId("7F3A")).toBe(false);
    expect(isAnchorMarkerId("7f3")).toBe(false);
    expect(isAnchorMarkerId("7f3ab")).toBe(false);
  });

  it("removes one comment's markers and leaves the others alone", () => {
    const raw = "a<!--pv#0001-->b<!--pv#0002-->c<!--/pv#0002-->d<!--/pv#0001-->e";
    expect(removeAnchorMarkers(raw, "0002")).toBe("a<!--pv#0001-->bcd<!--/pv#0001-->e");
  });
});

describe("comment anchor: stage 1, the marker is there", () => {
  it("returns the exact range between the markers", () => {
    const { raw, anchor } = anchorPhrase(SENTENCE, "bis Ende des Jahres");
    const resolution = resolveCommentAnchor(raw, anchor);
    expect(resolution).toEqual({ status: "marker", from: raw.indexOf("bis Ende"), to: raw.indexOf("<!--/pv#7f3a-->") });
    if (resolution.status === "orphan") throw new Error("unreachable");
    expect(raw.slice(resolution.from, resolution.to)).toBe("bis Ende des Jahres");
  });

  it("still finds it after the paragraph moved to the end of the note", () => {
    const { raw, anchor } = anchorPhrase(SENTENCE, "bis Ende des Jahres");
    const moved = `Eine ganz neue Ueberschrift\n\nUnd Text davor.\n\n${raw}`;
    const resolution = resolveCommentAnchor(moved, anchor);
    expect(resolution.status).toBe("marker");
    if (resolution.status === "orphan") throw new Error("unreachable");
    expect(moved.slice(resolution.from, resolution.to)).toBe("bis Ende des Jahres");
  });

  it("keeps a nested marker out of the stored quote", () => {
    // Two overlapping comments: the inner pair sits inside the outer selection.
    const inner = insertAnchorMarkers(SENTENCE, SENTENCE.indexOf("Ende"), SENTENCE.indexOf("Ende") + 4, "0002");
    const from = inner.indexOf("bis");
    const to = inner.indexOf(" und wird");
    const anchor = buildCommentAnchor(inner, from, to, "7f3a");
    expect(anchor.quote).toBe("bis Ende des Jahres");
    const raw = insertAnchorMarkers(inner, from, to, "7f3a");
    expect(resolveCommentAnchor(raw, anchor).status).toBe("marker");
  });
});

describe("comment anchor: stage 2, the marker is gone", () => {
  it("takes the single occurrence of the quote", () => {
    const { anchor } = anchorPhrase(SENTENCE, "bis Ende des Jahres");
    // Someone edited the note in another program; the markers did not survive.
    const foreign = SENTENCE.replace("Der Vertrag", "Unser Vertrag");
    const resolution = resolveCommentAnchor(foreign, anchor);
    expect(resolution.status).toBe("quote");
    if (resolution.status === "orphan") throw new Error("unreachable");
    expect(foreign.slice(resolution.from, resolution.to)).toBe("bis Ende des Jahres");
  });

  it("uses the surrounding context when the quote alone is ambiguous", () => {
    const text = `Vorbemerkung. ${SENTENCE}\n\nSpaeter: Der Vertrag laeuft bis Ende des Jahres, sagt Jan.`;
    const first = text.indexOf("Der Vertrag laeuft");
    const anchor = buildCommentAnchor(text, first, first + "Der Vertrag laeuft".length, "7f3a");
    // The bare quote occurs twice - only the context tells the two apart.
    expect(text.split("Der Vertrag laeuft").length - 1).toBe(2);
    const resolution = resolveCommentAnchor(text, anchor);
    expect(resolution).toEqual({ status: "quote", from: first, to: first + "Der Vertrag laeuft".length });
  });

  it("stops at the quote when a foreign marker sits flush against its end", () => {
    // Comment 0002 opens exactly where our quote ends. Mapping the end offset
    // must stay before that marker, or the range would swallow it.
    const raw = insertAnchorMarkers(SENTENCE, 27, 38, "0002");
    const anchor = buildCommentAnchor(SENTENCE, 19, 27, "7f3a");
    expect(anchor.quote).toBe("bis Ende");
    expect(findAnchorMarker(raw, "7f3a")).toBeNull();
    const resolution = resolveCommentAnchor(raw, anchor);
    expect(resolution.status).toBe("quote");
    if (resolution.status === "orphan") throw new Error("unreachable");
    expect(raw.slice(resolution.from, resolution.to)).toBe("bis Ende");
  });

  it("stops at the quote when a foreign marker sits flush against its end", () => {
    // Comment 0002 opens exactly where our quote ends. Mapping the end offset
    // must stay before that marker, or the range would swallow it.
    const raw = insertAnchorMarkers(SENTENCE, 27, 38, "0002");
    const anchor = buildCommentAnchor(SENTENCE, 19, 27, "7f3a");
    expect(anchor.quote).toBe("bis Ende");
    expect(findAnchorMarker(raw, "7f3a")).toBeNull();
    const resolution = resolveCommentAnchor(raw, anchor);
    expect(resolution.status).toBe("quote");
    if (resolution.status === "orphan") throw new Error("unreachable");
    expect(raw.slice(resolution.from, resolution.to)).toBe("bis Ende");
  });

  it("falls back to the soft anchor when only half a marker survived", () => {
    // A foreign editor swallowed the closing marker. Without the guard the range
    // would run to the end of the note.
    const raw = SENTENCE.replace("bis", `${openAnchorMarker("7f3a")}bis`);
    const { anchor } = anchorPhrase(SENTENCE, "bis Ende des Jahres");
    expect(findAnchorMarker(raw, "7f3a")).toBeNull();
    const resolution = resolveCommentAnchor(raw, anchor);
    expect(resolution.status).toBe("quote");
    if (resolution.status === "orphan") throw new Error("unreachable");
    expect(raw.slice(resolution.from, resolution.to)).toBe("bis Ende des Jahres");
  });
});

describe("comment anchor: stage 3, several candidates", () => {
  it("takes the one nearest to the stored position and flags it as moved", () => {
    const phrase = "die Zahlen pruefen";
    const text = `Erstens ${phrase} bitte.\n\nZweitens ${phrase} nochmal.`;
    const second = text.lastIndexOf(phrase);
    const anchor: WorkspaceCommentAnchor = {
      markerId: "7f3a",
      quote: phrase,
      // The surroundings were rewritten, so the context no longer matches anywhere.
      before: "voellig anderer Text davor ",
      after: " und danach",
      approximateOffset: second,
    };
    const resolution = resolveCommentAnchor(text, anchor);
    expect(resolution).toEqual({ status: "moved", from: second, to: second + phrase.length });
  });
});

describe("comment anchor: stage 4, the text is gone", () => {
  it("orphans the comment instead of dropping it", () => {
    const { anchor } = anchorPhrase(SENTENCE, "bis Ende des Jahres");
    expect(resolveCommentAnchor("Der Vertrag wurde gekuendigt.", anchor)).toEqual({ status: "orphan" });
  });

  it("orphans an anchor without a quote rather than matching everything", () => {
    const anchor: WorkspaceCommentAnchor = { markerId: "7f3a", quote: "", before: "", after: "", approximateOffset: 0 };
    expect(resolveCommentAnchor(SENTENCE, anchor)).toEqual({ status: "orphan" });
  });
});

describe("comment anchor bounds", () => {
  it("caps a long quote without splitting a character", () => {
    const long = "\u{1F600}".repeat(200); // four bytes each - the cap must land on a boundary
    const anchor = buildCommentAnchor(long, 0, long.length, "7f3a");
    expect(new TextEncoder().encode(anchor.quote).length).toBeLessThanOrEqual(MAX_ANCHOR_QUOTE_BYTES);
    expect([...anchor.quote].every((character) => character === "\u{1F600}")).toBe(true);
    // A split character would have become a replacement character on the way out.
    expect(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(anchor.quote))).toBe(anchor.quote);
  });

  it("keeps the context within its limit", () => {
    const text = `${"x".repeat(200)}ZIEL${"y".repeat(200)}`;
    const anchor = buildCommentAnchor(text, 200, 204, "7f3a");
    expect(anchor.before).toHaveLength(ANCHOR_CONTEXT_CHARS);
    expect(anchor.after).toHaveLength(ANCHOR_CONTEXT_CHARS);
    expect(anchor.quote).toBe("ZIEL");
    expect(anchor.approximateOffset).toBe(200);
  });

  it("rejects an anchor that arrives malformed from another device", () => {
    const good: WorkspaceCommentAnchor = { markerId: "7f3a", quote: "x", before: "", after: "", approximateOffset: 0 };
    expect(() => assertWorkspaceCommentAnchor(good)).not.toThrow();
    expect(() => assertWorkspaceCommentAnchor({ ...good, markerId: "zzzz" })).toThrow(/marker id/);
    expect(() => assertWorkspaceCommentAnchor({ ...good, quote: "" })).toThrow(/quote/);
    expect(() => assertWorkspaceCommentAnchor({ ...good, quote: "x".repeat(MAX_ANCHOR_QUOTE_BYTES + 1) })).toThrow(/quote/);
    expect(() => assertWorkspaceCommentAnchor({ ...good, before: "x".repeat(ANCHOR_CONTEXT_CHARS + 1) })).toThrow(/context/);
    expect(() => assertWorkspaceCommentAnchor({ ...good, approximateOffset: -1 })).toThrow(/out of range/);
  });
});

describe("comment anchor display hint (Stufe E)", () => {
  const base: WorkspaceCommentAnchor = { markerId: "7f3a", quote: "x", before: "", after: "", approximateOffset: 0 };

  it("accepts an anchor without a hint - the field is additive", () => {
    expect(() => assertWorkspaceCommentAnchor(base)).not.toThrow();
    expect(base.display).toBeUndefined();
  });

  it("accepts the widget kinds", () => {
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image" } })).not.toThrow();
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "diagram" } })).not.toThrow();
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "tableCell", row: 2, column: 1 } })).not.toThrow();
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "property", key: "status" } })).not.toThrow();
  });

  it("rejects a hint that arrives malformed from another device", () => {
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "photo" } as never })).toThrow(/display kind/);
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "tableCell", row: -1 } })).toThrow(/out of range/);
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "tableCell", column: 1.5 } })).toThrow(/column/);
  });

  it("refuses cell coordinates on something that is not a cell", () => {
    // An image with a column number is a contradiction: the renderer would have
    // to guess which half of the hint to believe.
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image", column: 0 } })).toThrow(/without a cell/);
  });
});

describe("image region (Stufe E, E3)", () => {
  const base: WorkspaceCommentAnchor = { markerId: "7f3a", quote: "x", before: "", after: "", approximateOffset: 0 };
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

  it("accepts a rectangle on an image, and an image without one", () => {
    // The field is additive: a comment on the whole picture stays exactly what
    // it was in E1, and an older writer never sends a rect at all.
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image", rect } })).not.toThrow();
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image" } })).not.toThrow();
    // The corners may sit on the edge - a marking around the whole picture is
    // still a marking somebody drew.
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image", rect: { x: 0, y: 0, w: 1, h: 1 } } })).not.toThrow();
  });

  it("refuses a rectangle on anything that is not a picture", () => {
    // Same contradiction as a column on an image: a diagram has no picture to
    // measure fractions against.
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "diagram", rect } })).toThrow(/rect without an image/);
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "tableCell", row: 1, column: 0, rect } })).toThrow(/rect without an image/);
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "property", key: "status", rect } })).toThrow(/rect without an image/);
  });

  it("refuses a rectangle that could not be drawn", () => {
    // Out of the unit square, empty, or leaving the picture: each of those would
    // put the marking somewhere the reader never pointed.
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image", rect: { ...rect, x: -0.1 } } })).toThrow(/rect x is out of range/);
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image", rect: { ...rect, h: 1.5 } } })).toThrow(/rect height is out of range/);
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image", rect: { ...rect, w: 0 } } })).toThrow(/rect is empty/);
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image", rect: { x: 0.8, y: 0.1, w: 0.3, h: 0.2 } } })).toThrow(/leaves the image/);
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image", rect: { x: 0.1, y: 0.8, w: 0.2, h: 0.3 } } })).toThrow(/leaves the image/);
  });

  it("refuses a rectangle that arrives malformed from another device", () => {
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image", rect: null } as never })).toThrow(/rect is invalid/);
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image", rect: { ...rect, y: Number.NaN } } })).toThrow(/rect y is out of range/);
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image", rect: { ...rect, w: "0.3" } } as never })).toThrow(/rect width is out of range/);
  });

  it("keeps the rectangle through the sealed record", () => {
    // The anchor travels as canonical JSON; a field that fell out on the way
    // would leave the reader with a comment on the whole picture instead.
    const anchor: WorkspaceCommentAnchor = { ...base, display: { kind: "image", rect } };
    const round = JSON.parse(JSON.stringify(anchor)) as WorkspaceCommentAnchor;
    expect(round.display).toEqual({ kind: "image", rect });
    expect(() => assertWorkspaceCommentAnchor(round)).not.toThrow();
  });
});

describe("comment anchor round trip", () => {
  it("survives markers, stripping and resolution unchanged", () => {
    const { raw, anchor } = anchorPhrase(SENTENCE, "bis Ende des Jahres");
    expect(stripAnchorMarkers(raw).text).toBe(SENTENCE);
    expect(removeAnchorMarkers(raw, anchor.markerId)).toBe(SENTENCE);
    expect(raw.includes(closeAnchorMarker("7f3a"))).toBe(true);
    const resolution = resolveCommentAnchor(raw, anchor);
    if (resolution.status === "orphan") throw new Error("unreachable");
    expect(raw.slice(resolution.from, resolution.to)).toBe(anchor.quote);
  });
});

describe("property anchors (Stufe E, E2)", () => {
  const base: WorkspaceCommentAnchor = { markerId: "7f3a", quote: "x", before: "", after: "", approximateOffset: 0 };

  it("anchors on the key and quotes the value at comment time", () => {
    const anchor = buildPropertyCommentAnchor("status", "In Arbeit", "7f3a");
    expect(anchor.display).toEqual({ kind: "property", key: "status" });
    expect(anchor.quote).toBe("In Arbeit");
    // No text range, so no context and no offset - the key IS the anchor.
    expect(anchor.before).toBe("");
    expect(anchor.after).toBe("");
    expect(anchor.approximateOffset).toBe(0);
    expect(() => assertWorkspaceCommentAnchor(anchor)).not.toThrow();
    expect(propertyAnchorKey(anchor)).toBe("status");
  });

  it("falls back to the key when the property has no value yet", () => {
    // An empty quote would fail validation on the receiving device, and a card
    // reading "" would tell the reader nothing.
    const anchor = buildPropertyCommentAnchor("faelligkeit", "   ", "7f3a");
    expect(anchor.quote).toBe("faelligkeit");
    expect(() => assertWorkspaceCommentAnchor(anchor)).not.toThrow();
  });

  it("keeps a marker id that no note ever contains", () => {
    // The id stays minted so the anchor shape is uniform; nothing inserts it, so
    // findAnchorMarker simply reports it as absent.
    const anchor = buildPropertyCommentAnchor("status", "offen", "7f3a");
    expect(isAnchorMarkerId(anchor.markerId)).toBe(true);
    expect(findAnchorMarker("Ein Satz ohne Marker.", anchor.markerId)).toBeNull();
  });

  it("refuses a property hint without a key and a key without a property", () => {
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "property" } })).toThrow(/property key is invalid/);
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "property", key: "" } })).toThrow(/property key is invalid/);
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "image", key: "status" } })).toThrow(/without a property/);
  });

  it("refuses cell coordinates on a property", () => {
    expect(() => assertWorkspaceCommentAnchor({ ...base, display: { kind: "property", key: "status", column: 0 } })).toThrow(/without a cell/);
  });

  it("resolves to the key while the property exists", () => {
    const present = (k: string) => k === "status";
    expect(resolvePropertyAnchor("status", present)).toEqual({ status: "key", key: "status" });
  });

  it("follows a rename through the trail the .base column carries", () => {
    // Section 5: "Der Anker zieht mit." He cannot move - a comment is sealed -
    // so the trail is followed on every read instead.
    const present = (k: string) => k === "zustand";
    const aliasOf = (former: string) => (former === "status" ? "zustand" : null);
    expect(resolvePropertyAnchor("status", present, aliasOf)).toEqual({ status: "renamed", key: "zustand" });
  });

  it("follows a property renamed twice", () => {
    const present = (k: string) => k === "phase";
    const chain: Record<string, string> = { status: "zustand", zustand: "phase" };
    expect(resolvePropertyAnchor("status", present, (f) => chain[f] ?? null)).toEqual({ status: "renamed", key: "phase" });
  });

  it("orphans instead of guessing when the property is gone", () => {
    // SD3's rule: the card stays, it just has no place any more.
    expect(resolvePropertyAnchor("status", () => false)).toEqual({ status: "orphan" });
  });

  it("does not spin on a rename trail that points at itself", () => {
    const chain: Record<string, string> = { a: "b", b: "a" };
    expect(resolvePropertyAnchor("a", () => false, (f) => chain[f] ?? null)).toEqual({ status: "orphan" });
  });

  it("reports no key for anchors that are not property anchors", () => {
    const { anchor } = anchorPhrase(SENTENCE, "bis Ende des Jahres");
    expect(propertyAnchorKey(anchor)).toBeNull();
    expect(propertyAnchorKey(null)).toBeNull();
  });
});

/**
 * An insertion point (Vorschlagsmodus, V1): an anchor with an empty quote that
 * names a PLACE by its context. It resolves to an empty range, says "moved"
 * when only one side of the context still matches, and is an orphan when the
 * place is gone. It never carries a marker pair or a display hint, and the
 * protocol refuses it on anything but a proposal that adds text.
 */
describe("insertion point anchors (V1)", () => {
  const TEXT = "The contract runs until the end of the year. It renews automatically.";
  const AT = TEXT.indexOf(" It renews");

  it("captures the place with an empty quote and context on both sides", () => {
    const anchor = buildCommentAnchor(TEXT, AT, AT, "7f3a");
    expect(anchor.quote).toBe("");
    expect(anchor.before.endsWith("end of the year.")).toBe(true);
    expect(anchor.after.startsWith(" It renews")).toBe(true);
    expect(() => assertWorkspaceCommentAnchor(anchor)).not.toThrow();
    expect(resolveCommentAnchor(TEXT, anchor)).toEqual({ status: "quote", from: AT, to: AT });
  });

  it("finds the place again after edits elsewhere, and says 'moved' when one side is gone", () => {
    const anchor = buildCommentAnchor(TEXT, AT, AT, "7f3a");
    const edited = "PREAMBLE. " + TEXT;
    expect(resolveCommentAnchor(edited, anchor)).toEqual({ status: "quote", from: AT + 10, to: AT + 10 });
    const afterGone = "The contract runs until the end of the year. Something else.";
    const moved = resolveCommentAnchor(afterGone, anchor);
    expect(moved.status).toBe("moved");
    if (moved.status === "moved") expect(moved.from).toBe("The contract runs until the end of the year.".length);
    expect(resolveCommentAnchor("Nothing of it remains.", anchor)).toEqual({ status: "orphan" });
  });

  it("refuses an insertion point without context or with a display hint", () => {
    expect(() => assertWorkspaceCommentAnchor({ markerId: "7f3a", quote: "", before: "", after: "", approximateOffset: 0 })).toThrow(/quote is invalid/);
    expect(() => assertWorkspaceCommentAnchor({ markerId: "7f3a", quote: "", before: "x", after: "", approximateOffset: 0, display: { kind: "image" } })).toThrow(/insertion point cannot carry/);
  });
});


describe("table cell anchors (Tabellenzelle, V7)", () => {
  const TABLE = ["| Key | Does |", "| --- | --- |", "| Mod+P | Palette |", "| Mod+O | Opener |"].join("\n");
  const NOTE = `# Sheet\n\n${TABLE}\n\nAfter.\n`;
  const tableFrom = NOTE.indexOf("| Key");
  const tableTo = tableFrom + TABLE.length;
  const cellAnchor = (row: number, column: number) => buildCommentAnchor(NOTE, tableFrom, tableTo, "7a7a", { kind: "tableCell", row, column });

  it("quotes the cell, not the table, and keeps the coordinates in the hint", () => {
    const anchor = cellAnchor(1, 1);
    expect(anchor.quote).toBe("Palette");
    expect(anchor.display).toEqual({ kind: "tableCell", row: 1, column: 1 });
    expect(anchor.approximateOffset).toBe(NOTE.indexOf("Palette"));
    // An empty cell keeps the table as its quote - an empty quote would read as an insertion point.
    const withEmpty = NOTE.replace("| Mod+O | Opener |", "| Mod+O |  |");
    const empty = buildCommentAnchor(withEmpty, tableFrom, tableFrom + withEmpty.indexOf("|  |") + 4 - tableFrom, "7a7b", { kind: "tableCell", row: 2, column: 1 });
    expect(empty.quote.startsWith("| Key")).toBe(true);
  });

  it("finds the cell at its coordinates and names the column", () => {
    const anchor = cellAnchor(1, 1);
    const found = resolveCommentAnchor(NOTE, anchor);
    expect(found.status).toBe("quote");
    if (found.status === "orphan") throw new Error("unreachable");
    expect(NOTE.slice(found.from, found.to)).toBe("Palette");
    expect(found.cell).toEqual({ row: 1, column: 1, columnLabel: "Does" });
  });

  it("follows the cell when a row is inserted above it", () => {
    const anchor = cellAnchor(2, 1);
    const grown = NOTE.replace("| Mod+P | Palette |", "| Mod+K | Search |\n| Mod+P | Palette |");
    const found = resolveCommentAnchor(grown, anchor);
    expect(found.status).toBe("moved");
    if (found.status === "orphan") throw new Error("unreachable");
    expect(grown.slice(found.from, found.to)).toBe("Opener");
    expect(found.cell).toEqual({ row: 3, column: 1, columnLabel: "Does" });
  });

  it("keeps a cell that changed its text, and says so", () => {
    const anchor = cellAnchor(1, 1);
    const edited = NOTE.replace("Palette", "Command palette");
    const found = resolveCommentAnchor(edited, anchor);
    expect(found.status).toBe("moved");
    if (found.status === "orphan") throw new Error("unreachable");
    expect(edited.slice(found.from, found.to)).toBe("Command palette");
    expect(found.cell).toEqual({ row: 1, column: 1, columnLabel: "Does", changed: true });
  });

  it("orphans only when the whole table is gone", () => {
    expect(resolveCommentAnchor("# Sheet\n\nNo table.\n", cellAnchor(1, 1)).status).toBe("orphan");
  });

  it("resolves an anchor from before V7 - the table as quote - the old way", () => {
    const legacy = buildCommentAnchor(NOTE, tableFrom, tableTo, "7a7c");
    const asCell = { ...legacy, display: { kind: "tableCell" as const, row: 1, column: 1 } };
    expect(isLegacyTableQuote(asCell)).toBe(true);
    const found = resolveCommentAnchor(NOTE, asCell);
    expect(found.status).toBe("quote");
    if (found.status === "orphan") throw new Error("unreachable");
    expect(found.from).toBe(tableFrom);
    expect("cell" in found).toBe(false);
  });

  it("parses escaped pipes and edge pipes without inventing cells", () => {
    const tables = parseTablesIn("| a \\| b | c |\n|---|---|\n| | x |\n");
    expect(tables).toHaveLength(1);
    expect(tables[0].headers).toEqual(["a \\| b", "c"]);
    expect(tables[0].cells.filter((cell) => cell.row === 1).map((cell) => cell.text)).toEqual(["", "x"]);
  });

  it("drops the marker pairs widget anchors wrote before the fix, and nothing else", () => {
    const raw = `Intro <!--pv#1111-->word<!--/pv#1111--> and\n<!--pv#2222-->${TABLE}<!--/pv#2222-->\n`;
    const { text, removed } = stripWidgetAnchorMarkers(raw, [
      { markerId: "1111" },
      { markerId: "2222", display: { kind: "tableCell", row: 1, column: 1 } },
      { markerId: "3333", display: { kind: "image" } },
      null,
    ]);
    expect(removed).toEqual(["2222"]);
    expect(text).toBe(`Intro <!--pv#1111-->word<!--/pv#1111--> and\n${TABLE}\n`);
  });
});

/**
 * A marker never starts a block (finding 2026-09-03): CommonMark reads a line
 * that begins with `<!--` as an HTML block, and the list item behind it lost
 * its bullet, its indent and its formatting in every view.
 */
describe("placeAnchorRange", () => {
  const LIST = "Intro\n- Vorlagen sind Notiz-Vorlagen\n- Zweiter Punkt\n";

  it("moves a start inside the list marker behind it and keeps the end off the line break", () => {
    const from = LIST.indexOf("- Vorlagen");
    const to = LIST.indexOf("- Zweiter");
    const placed = placeAnchorRange(LIST, from, to);
    expect(LIST.slice(placed.from, placed.to)).toBe("Vorlagen sind Notiz-Vorlagen");
  });

  it("steps over a task box, a blockquote and a heading prefix", () => {
    const text = "- [ ] Kartons bestellen\n> Ein Zitat\n## Titel der Woche\n";
    const task = placeAnchorRange(text, 0, text.indexOf("\n"));
    expect(text.slice(task.from, task.to)).toBe("Kartons bestellen");
    const quoteFrom = text.indexOf("> Ein");
    const quote = placeAnchorRange(text, quoteFrom, text.indexOf("\n", quoteFrom));
    expect(text.slice(quote.from, quote.to)).toBe("Ein Zitat");
    const headFrom = text.indexOf("## ");
    const head = placeAnchorRange(text, headFrom, text.length);
    expect(text.slice(head.from, head.to)).toBe("Titel der Woche");
  });

  it("never covers the prefix of the following line", () => {
    const text = "- eins\n- zwei\n";
    const placed = placeAnchorRange(text, 0, text.indexOf("- zwei") + 2);
    expect(text.slice(placed.from, placed.to)).toBe("eins");
  });

  it("leaves a range inside running text alone, including an insertion point", () => {
    const text = "Ein Satz mit Wort darin.\n";
    expect(placeAnchorRange(text, 4, 8)).toEqual({ from: 4, to: 8 });
    expect(placeAnchorRange(text, 4, 4)).toEqual({ from: 4, to: 4 });
    expect(placeAnchorRange(text, 8, 4)).toEqual({ from: 4, to: 8 });
  });

  it("a selection that only covers the marker collapses to an insertion point behind it", () => {
    expect(placeAnchorRange("- item\n", 0, 2)).toEqual({ from: 2, to: 2 });
  });
});

describe("repairAnchorMarkerPlacement", () => {
  it("moves an opening marker written before the list marker behind it", () => {
    const raw = "Intro\n<!--pv#7f3a-->- Vorlagen<!--/pv#7f3a-->\n";
    const { text, edits } = repairAnchorMarkerPlacement(raw);
    expect(text).toBe("Intro\n- <!--pv#7f3a-->Vorlagen<!--/pv#7f3a-->\n");
    expect(edits.length).toBe(2);
  });

  it("moves a closing marker at the next line's start to the end of the line before", () => {
    const raw = "- <!--pv#7f3a-->eins\n<!--/pv#7f3a-->- zwei\n";
    expect(repairAnchorMarkerPlacement(raw).text).toBe("- <!--pv#7f3a-->eins<!--/pv#7f3a-->\n- zwei\n");
  });

  it("handles a task box, a quote and both markers on one line", () => {
    expect(repairAnchorMarkerPlacement("<!--pv#1111-->- [ ] Kartons<!--/pv#1111-->\n").text).toBe("- [ ] <!--pv#1111-->Kartons<!--/pv#1111-->\n");
    expect(repairAnchorMarkerPlacement("> <!--pv#2222-->Zitat<!--/pv#2222-->").text).toBe("> <!--pv#2222-->Zitat<!--/pv#2222-->");
    expect(repairAnchorMarkerPlacement("<!--/pv#3333-->-<!--pv#4444--> Punkt<!--/pv#4444-->").text).toBe("- <!--pv#4444--><!--/pv#3333-->Punkt<!--/pv#4444-->");
  });

  it("changes nothing on a note whose markers already sit behind the prefix or in running text", () => {
    const raw = "- <!--pv#7f3a-->eins<!--/pv#7f3a-->\nEin <!--pv#1111-->Wort<!--/pv#1111--> im Satz.\n<!-- -->\n";
    const { text, edits } = repairAnchorMarkerPlacement(raw);
    expect(text).toBe(raw);
    expect(edits).toEqual([]);
  });

  it("returns edits that reproduce the text when applied back to front", () => {
    const raw = "<!--pv#7f3a-->- a<!--/pv#7f3a-->\n<!--pv#1111-->1. b<!--/pv#1111-->\n";
    const { text, edits } = repairAnchorMarkerPlacement(raw);
    let applied = raw;
    for (let i = edits.length - 1; i >= 0; i -= 1) applied = applied.slice(0, edits[i].from) + edits[i].insert + applied.slice(edits[i].to);
    expect(applied).toBe(text);
    expect(text).toBe("- <!--pv#7f3a-->a<!--/pv#7f3a-->\n1. <!--pv#1111-->b<!--/pv#1111-->\n");
  });
});
