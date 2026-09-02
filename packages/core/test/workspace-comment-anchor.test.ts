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
  mintAnchorMarkerId,
  openAnchorMarker,
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
