import { describe, expect, it } from "vitest";
import {
  ANCHOR_CONTEXT_CHARS,
  MAX_ANCHOR_QUOTE_BYTES,
  assertWorkspaceCommentAnchor,
  buildCommentAnchor,
  closeAnchorMarker,
  findAnchorMarker,
  insertAnchorMarkers,
  isAnchorMarkerId,
  mintAnchorMarkerId,
  openAnchorMarker,
  removeAnchorMarkers,
  resolveCommentAnchor,
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
