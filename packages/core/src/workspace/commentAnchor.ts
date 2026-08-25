import { randomBytes } from "../crypto/cryptoPrimitives.js";
import { protocolAssert } from "./errors.js";
import { assertSafeInteger, toHex, utf8Encode } from "./encoding.js";

/**
 * Where a comment sits inside a note.
 *
 * Two anchors, because neither survives alone (plan Stufe D, section 5):
 *
 *   - The HARD anchor is a marker pair written into the Markdown. While it is
 *     there the place is unambiguous, even if the paragraph is moved or
 *     rewritten around it. An HTML comment is the only Markdown mechanism every
 *     conforming renderer hides, and Plainva already uses it for
 *     PLAINVA_INDEX_MARKER.
 *   - The SOFT anchor is the quote plus its surrounding context. It is fuzzy,
 *     but it survives what the hard anchor does not: someone editing the file in
 *     another program that drops the markers.
 *
 * The comment TEXT never enters the Markdown - only this opaque id does. In an
 * encrypted workspace the note lies in the cloud as ciphertext; what people say
 * about it is often the more sensitive half and stays inside the sealed object.
 */
export interface WorkspaceCommentAnchor {
  /** Same id as in the HTML comment pair. Four lowercase hex characters. */
  markerId: string;
  /** The marked text, capped at MAX_ANCHOR_QUOTE_BYTES. */
  quote: string;
  /** Up to ANCHOR_CONTEXT_CHARS characters before the quote. */
  before: string;
  /** Up to ANCHOR_CONTEXT_CHARS characters after the quote. */
  after: string;
  /** Offset of the quote in the marker-free text when the comment was written. */
  approximateOffset: number;
}

/** How a stored anchor was found again - the four stages of section 5. */
export type WorkspaceCommentAnchorResolution =
  /** Stage 1: the marker pair is still there. Exact. */
  | { status: "marker"; from: number; to: number }
  /** Stage 2: marker gone, the quote occurs exactly once. Re-anchoring is safe. */
  | { status: "quote"; from: number; to: number }
  /** Stage 3: marker gone, several candidates - nearest to the stored offset. */
  | { status: "moved"; from: number; to: number }
  /** Stage 4: the text is gone. The comment stays, without a place. */
  | { status: "orphan" };

export const ANCHOR_MARKER_ID_CHARS = 4;
export const ANCHOR_CONTEXT_CHARS = 40;
export const MAX_ANCHOR_QUOTE_BYTES = 512;

const MARKER_ID_RE = /^[0-9a-f]{4}$/;
/** Matches every anchor marker, whichever comment it belongs to. */
const ANY_MARKER_RE = /<!--\/?pv#[0-9a-f]{4}-->/g;

export function openAnchorMarker(markerId: string): string {
  return `<!--pv#${markerId}-->`;
}

export function closeAnchorMarker(markerId: string): string {
  return `<!--/pv#${markerId}-->`;
}

export function isAnchorMarkerId(value: string): boolean {
  return MARKER_ID_RE.test(value);
}

/**
 * A marker id that does not occur in this note yet. Ids only have to be unique
 * within one note: a comment is addressed by its target object, so a paragraph
 * copied into another file carries a marker nothing refers to - invisible, inert.
 */
export function mintAnchorMarkerId(text: string, random: (length: number) => Uint8Array = randomBytes): string {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const candidate = toHex(random(ANCHOR_MARKER_ID_CHARS / 2));
    if (!text.includes(`pv#${candidate}`)) return candidate;
  }
  throw new Error("could not mint a free anchor marker id");
}

export interface StrippedAnchorText {
  /** The text as a reader sees it: every anchor marker removed. */
  text: string;
  /** Marker-free offset to an offset in the raw Markdown. */
  toRaw(offset: number, prefer?: "after" | "before"): number;
  /** Raw Markdown offset to an offset in the marker-free text. */
  toClean(offset: number): number;
}

/**
 * Removes every anchor marker and keeps a map back to the raw offsets.
 *
 * Searching has to happen on the marker-free text: a quote was captured from
 * what the author selected, so it never contains a marker - but the raw text may
 * well have one sitting inside the range when two comments overlap or nest.
 */
export function stripAnchorMarkers(raw: string): StrippedAnchorText {
  const segments: Array<{ clean: number; raw: number; length: number }> = [];
  const pieces: string[] = [];
  let cleanLength = 0;
  let cursor = 0;
  ANY_MARKER_RE.lastIndex = 0;
  for (let match = ANY_MARKER_RE.exec(raw); match; match = ANY_MARKER_RE.exec(raw)) {
    const piece = raw.slice(cursor, match.index);
    segments.push({ clean: cleanLength, raw: cursor, length: piece.length });
    pieces.push(piece);
    cleanLength += piece.length;
    cursor = match.index + match[0].length;
  }
  const tail = raw.slice(cursor);
  segments.push({ clean: cleanLength, raw: cursor, length: tail.length });
  pieces.push(tail);
  return {
    text: pieces.join(""),
    toRaw(offset, prefer = "after") {
      let best = segments[0];
      for (const segment of segments) {
        if (prefer === "before" ? segment.clean < offset : segment.clean <= offset) best = segment;
        else break;
      }
      return best.raw + (offset - best.clean);
    },
    toClean(offset) {
      let best = segments[0];
      for (const segment of segments) {
        if (segment.raw <= offset) best = segment;
        else break;
      }
      return best.clean + Math.min(Math.max(offset - best.raw, 0), best.length);
    },
  };
}

/**
 * The raw range between a marker pair, or null.
 *
 * A lone opening marker counts as absent: a foreign editor that mangled half the
 * pair must not produce a range that runs to the end of the note. The soft
 * anchor then decides.
 */
export function findAnchorMarker(raw: string, markerId: string): { from: number; to: number } | null {
  if (!isAnchorMarkerId(markerId)) return null;
  const open = openAnchorMarker(markerId);
  const start = raw.indexOf(open);
  if (start < 0) return null;
  const from = start + open.length;
  const to = raw.indexOf(closeAnchorMarker(markerId), from);
  return to < 0 ? null : { from, to };
}

/** Writes the marker pair around a raw range. */
export function insertAnchorMarkers(raw: string, from: number, to: number, markerId: string): string {
  protocolAssert(isAnchorMarkerId(markerId), "format", "anchor marker id is invalid");
  protocolAssert(from >= 0 && to >= from && to <= raw.length, "bounds", "anchor range is invalid");
  return raw.slice(0, from) + openAnchorMarker(markerId) + raw.slice(from, to) + closeAnchorMarker(markerId) + raw.slice(to);
}

/** Removes one comment's marker pair, leaving the text between them. */
export function removeAnchorMarkers(raw: string, markerId: string): string {
  if (!isAnchorMarkerId(markerId)) return raw;
  return raw.split(openAnchorMarker(markerId)).join("").split(closeAnchorMarker(markerId)).join("");
}

function capBytes(value: string, limit: number): string {
  if (utf8Encode(value).length <= limit) return value;
  let result = "";
  for (const character of [...value]) {
    if (utf8Encode(result + character).length > limit) break;
    result += character;
  }
  return result;
}

/**
 * Captures the soft anchor for a raw selection. Quote and context come from the
 * marker-free text so a nested marker never lands inside the stored quote.
 */
export function buildCommentAnchor(raw: string, from: number, to: number, markerId: string): WorkspaceCommentAnchor {
  protocolAssert(isAnchorMarkerId(markerId), "format", "anchor marker id is invalid");
  const stripped = stripAnchorMarkers(raw);
  const start = stripped.toClean(Math.min(from, to));
  const end = stripped.toClean(Math.max(from, to));
  const quote = capBytes(stripped.text.slice(start, end), MAX_ANCHOR_QUOTE_BYTES);
  return {
    markerId,
    quote,
    before: stripped.text.slice(Math.max(0, start - ANCHOR_CONTEXT_CHARS), start),
    after: stripped.text.slice(end, end + ANCHOR_CONTEXT_CHARS),
    approximateOffset: start,
  };
}

function occurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const found: number[] = [];
  for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + 1)) found.push(index);
  return found;
}

function nearest(candidates: number[], target: number): number {
  return candidates.reduce((best, candidate) => (Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best), candidates[0]);
}

/**
 * Finds the anchored place again, in the order of section 5.
 *
 * Stage 2 searches the context first (before + quote + after - that IS the soft
 * anchor as the plan defines it) and only then the bare quote, so a sentence
 * that occurs twice still resolves exactly when its surroundings survived.
 *
 * Offsets are raw Markdown offsets, ready for a decoration.
 */
export function resolveCommentAnchor(raw: string, anchor: WorkspaceCommentAnchor): WorkspaceCommentAnchorResolution {
  const marker = findAnchorMarker(raw, anchor.markerId);
  if (marker) return { status: "marker", from: marker.from, to: marker.to };
  if (!anchor.quote) return { status: "orphan" };
  const stripped = stripAnchorMarkers(raw);
  const toRange = (start: number, status: "quote" | "moved"): WorkspaceCommentAnchorResolution => ({
    status,
    from: stripped.toRaw(start),
    to: stripped.toRaw(start + anchor.quote.length, "before"),
  });
  const withContext = occurrences(stripped.text, anchor.before + anchor.quote + anchor.after);
  if (withContext.length === 1) return toRange(withContext[0] + anchor.before.length, "quote");
  const bare = occurrences(stripped.text, anchor.quote);
  if (bare.length === 1) return toRange(bare[0], "quote");
  if (bare.length > 1) return toRange(nearest(bare, anchor.approximateOffset), "moved");
  return { status: "orphan" };
}

/** Protocol-side validation of an anchor arriving from another device. */
export function assertWorkspaceCommentAnchor(anchor: WorkspaceCommentAnchor): void {
  protocolAssert(isAnchorMarkerId(anchor.markerId), "format", "comment anchor marker id is invalid");
  protocolAssert(typeof anchor.quote === "string" && anchor.quote.length >= 1 && utf8Encode(anchor.quote).length <= MAX_ANCHOR_QUOTE_BYTES, "bounds", "comment anchor quote is invalid");
  protocolAssert(typeof anchor.before === "string" && [...anchor.before].length <= ANCHOR_CONTEXT_CHARS, "bounds", "comment anchor context is too large");
  protocolAssert(typeof anchor.after === "string" && [...anchor.after].length <= ANCHOR_CONTEXT_CHARS, "bounds", "comment anchor context is too large");
  assertSafeInteger(anchor.approximateOffset, 0, Number.MAX_SAFE_INTEGER, "comment anchor offset");
}
