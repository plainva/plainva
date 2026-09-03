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
/**
 * What the range COVERS, when it is not running text.
 *
 * An image, a diagram and a table in the flowing text are not foreign objects:
 * each is a CodeMirror widget laid over an ordinary range of Markdown, so the
 * anchor above carries them unchanged. What the anchor cannot say by itself is
 * that the range is a picture rather than a sentence - and the reader needs
 * that, because a widget shows no text to tint. This field is the display hint
 * that lets the editor draw a frame around the widget instead.
 *
 * It is deliberately SOFT (plan Stufe E, section 3): move a table row and the
 * anchor still points at the right text, but the cell coordinates may no longer
 * fit. Then the whole table is framed and the card says so - the same honesty
 * as an orphaned comment, one step milder.
 */
export interface WorkspaceCommentAnchorDisplay {
  /** What the marked range is. */
  kind: "image" | "diagram" | "tableCell" | "property";
  /** Row inside the rendered table; 0 is the header. Only for `tableCell`. */
  row?: number;
  /** Column inside the rendered table, 0-based. Only for `tableCell`. */
  column?: number;
  /**
   * Frontmatter key the comment hangs on. Only for `property`.
   *
   * Bare key, exactly as it stands in the note's frontmatter - never the
   * `note.`-prefixed id a `.base` file uses for the same column, because the
   * comment belongs to the note and not to any one query over it.
   */
  key?: string;
  /**
   * The marked region inside the picture. Only for `image`, always optional.
   *
   * Deliberately an OPTIONAL FIELD rather than a fifth `kind`: an unknown kind
   * fails validation and takes the whole anchor with it, so a comment written
   * on a newer device could not be opened at all on an older one. An unknown
   * field is ignored instead, and the older reader frames the whole picture -
   * one step less precise, never broken.
   *
   * Never written for a web image: at a foreign URL Plainva can guarantee
   * neither the size nor that the picture is still the same one.
   */
  rect?: WorkspaceCommentAnchorRect;
}

/**
 * A rectangle over a picture, in fractions of the picture's own size.
 *
 * RELATIVE on purpose (plan Stufe E, section 4): the same image is drawn at one
 * width in the sidebar, another in read mode and a third on a phone, so pixels
 * would be wrong the first time anything resizes. A fraction of the picture is
 * the same spot at every size.
 */
export interface WorkspaceCommentAnchorRect {
  /** Left edge, 0..1 of the picture's width. */
  x: number;
  /** Top edge, 0..1 of the picture's height. */
  y: number;
  /** Width, 0..1 of the picture's width. */
  w: number;
  /** Height, 0..1 of the picture's height. */
  h: number;
}

export interface WorkspaceCommentAnchor {
  /** Same id as in the HTML comment pair. Four lowercase hex characters. */
  markerId: string;
  /**
   * The marked text, capped at MAX_ANCHOR_QUOTE_BYTES.
   *
   * Empty for an INSERTION POINT (Vorschlagsmodus, V1): a proposal that adds
   * text has no passage, only a place, and the place is described by the
   * context alone. Such an anchor never carries a marker pair (a pair around
   * nothing would be a marker for nothing) and only ever belongs to a
   * suggestion with a non-empty replacement - the protocol refuses the rest.
   */
  quote: string;
  /** Up to ANCHOR_CONTEXT_CHARS characters before the quote. */
  before: string;
  /** Up to ANCHOR_CONTEXT_CHARS characters after the quote. */
  after: string;
  /** Offset of the quote in the marker-free text when the comment was written. */
  approximateOffset: number;
  /**
   * Present when the range is covered by a widget. Additive: an anchor without
   * it behaves exactly as in Stufe D, and a reader that does not know the field
   * still resolves the range correctly.
   */
  display?: WorkspaceCommentAnchorDisplay;
}

/** How a stored anchor was found again - the four stages of section 5. */
/**
 * Where a cell anchor was found again (Tabellenzelle, V7): the coordinates as
 * they are TODAY, the header the column carries, and whether the cell at the
 * stored coordinates now says something else. A card names the cell with
 * this; a widget draws the corner on it.
 */
export interface WorkspaceCellPlace {
  row: number;
  column: number;
  columnLabel: string | null;
  /** The cell is still where it was, but its text is not the quote any more. */
  changed?: boolean;
}

export type WorkspaceCommentAnchorResolution =
  /** Stage 1: the marker pair is still there. Exact. */
  | { status: "marker"; from: number; to: number; cell?: WorkspaceCellPlace }
  /** Stage 2: marker gone, the quote occurs exactly once. Re-anchoring is safe. */
  | { status: "quote"; from: number; to: number; cell?: WorkspaceCellPlace }
  /** Stage 3: marker gone, several candidates - nearest to the stored offset. */
  | { status: "moved"; from: number; to: number; cell?: WorkspaceCellPlace }
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

/**
 * The block prefix of a line: indentation, blockquote markers, a list or task
 * marker, or an ATX heading's hashes - everything Markdown reads as structure
 * before the line's own text begins.
 *
 * A marker must never land in front of it (finding 2026-09-03): CommonMark
 * makes a line that starts with `<!--` an HTML block, and an HTML block is
 * opaque - the `- ` inside it is no list item, the `**bold**` no emphasis, and
 * the read view drops the whole line. A selection made from the line start
 * (triple-click, Home + Shift+End) put the opening marker exactly there, and
 * the list item lost its bullet, its indent and its formatting.
 */
const BLOCK_PREFIX_RE = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|#{1,6}[ \t]+)?/;
const ANCHOR_MARKER_SOURCE = "<!--(\\/?)pv#([0-9a-f]{4})-->";

/** Length of the block prefix of one line's text (0 for a plain line). */
export function blockPrefixLength(lineText: string): number {
  return BLOCK_PREFIX_RE.exec(lineText)?.[0].length ?? 0;
}

function lineBoundsAt(raw: string, at: number): { start: number; end: number } {
  const start = raw.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  const nl = raw.indexOf("\n", start);
  return { start, end: nl < 0 ? raw.length : nl };
}

/**
 * Where an anchor may sit for a raw selection: never inside a line's block
 * prefix, never across the line break at the end, never inside the prefix of
 * a following line. Both callers - the marker pair and the soft anchor's quote -
 * take the same range, so the quote carries no `- ` either.
 */
export function placeAnchorRange(raw: string, from: number, to: number): { from: number; to: number } {
  const clamp = (n: number): number => Math.max(0, Math.min(raw.length, n));
  let start = clamp(Math.min(from, to));
  let end = clamp(Math.max(from, to));
  const line = lineBoundsAt(raw, start);
  const prefixEnd = line.start + blockPrefixLength(raw.slice(line.start, line.end));
  if (start < prefixEnd) start = Math.min(prefixEnd, line.end);
  for (;;) {
    while (end > start && (raw[end - 1] === "\n" || raw[end - 1] === "\r")) end -= 1;
    const endLine = lineBoundsAt(raw, end);
    const endPrefix = endLine.start + blockPrefixLength(raw.slice(endLine.start, endLine.end));
    if (end > start && endLine.start > start && end <= endPrefix) {
      end = endLine.start;
      continue;
    }
    break;
  }
  if (end < start) end = start;
  return { from: start, to: end };
}

export interface AnchorMarkerRepair {
  text: string;
  /** Raw-offset edits that turn the input into `text`, sorted by position. */
  edits: Array<{ from: number; to: number; insert: string }>;
}

/**
 * Moves markers that were written before `placeAnchorRange` existed out of a
 * line's block prefix: an opening marker behind the prefix, a closing marker
 * to the end of the line before. Same rule as `stripWidgetAnchorMarkers`: run
 * once when a note opens, and only what actually moved counts as a change.
 */
export function repairAnchorMarkerPlacement(raw: string): AnchorMarkerRepair {
  const edits: AnchorMarkerRepair["edits"] = [];
  let lineStart = 0;
  for (;;) {
    const nl = raw.indexOf("\n", lineStart);
    const lineEnd = nl < 0 ? raw.length : nl;
    const lineText = raw.slice(lineStart, lineEnd);
    if (lineText.includes("<!--")) {
      const markers = [...lineText.matchAll(new RegExp(ANCHOR_MARKER_SOURCE, "g"))];
      const clean = lineText.replace(new RegExp(ANCHOR_MARKER_SOURCE, "g"), "");
      const prefixLen = markers.length > 0 ? blockPrefixLength(clean) : 0;
      if (prefixLen > 0) {
        // The raw offset where the clean prefix ends, stepping over markers.
        let cleanIndex = 0;
        let rawIndex = 0;
        let next = 0;
        while (cleanIndex < prefixLen) {
          const marker = markers[next];
          if (marker && marker.index === rawIndex) {
            rawIndex += marker[0].length;
            next += 1;
            continue;
          }
          cleanIndex += 1;
          rawIndex += 1;
        }
        const opening: string[] = [];
        const closing: string[] = [];
        for (const marker of markers) {
          if ((marker.index ?? 0) >= rawIndex) break;
          edits.push({ from: lineStart + (marker.index ?? 0), to: lineStart + (marker.index ?? 0) + marker[0].length, insert: "" });
          (marker[1] === "/" ? closing : opening).push(marker[0]);
        }
        if (opening.length > 0) edits.push({ from: lineStart + rawIndex, to: lineStart + rawIndex, insert: opening.join("") });
        if (closing.length > 0) {
          let at = lineStart + rawIndex;
          if (lineStart > 0) {
            at = lineStart - 1;
            if (raw[at - 1] === "\r") at -= 1;
          }
          edits.push({ from: at, to: at, insert: closing.join("") });
        }
      }
    }
    if (nl < 0) break;
    lineStart = nl + 1;
  }
  edits.sort((a, b) => a.from - b.from || a.to - b.to);
  let text = raw;
  for (let i = edits.length - 1; i >= 0; i -= 1) {
    const edit = edits[i];
    text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  }
  return { text, edits };
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
export function buildCommentAnchor(raw: string, from: number, to: number, markerId: string, display?: WorkspaceCommentAnchorDisplay): WorkspaceCommentAnchor {
  protocolAssert(isAnchorMarkerId(markerId), "format", "anchor marker id is invalid");
  const stripped = stripAnchorMarkers(raw);
  const start = stripped.toClean(Math.min(from, to));
  const end = stripped.toClean(Math.max(from, to));
  // A cell anchor quotes the CELL (Tabellenzelle, V7): the range is the whole
  // table's source, but what the writer pointed at is one cell, and a card
  // that quoted the table's Markdown showed the reader nothing they could
  // recognise. The coordinates stay in the display hint; the text is what
  // finds the cell again after a row was inserted above it. An empty cell
  // keeps the table as its quote - an empty quote would read as an
  // insertion point.
  if (display?.kind === "tableCell" && display.row !== undefined && display.column !== undefined) {
    const table = parseTablesIn(stripped.text.slice(start, end))[0];
    const cell = table?.cells.find((candidate) => candidate.row === display.row && candidate.column === display.column);
    if (cell && cell.text.length > 0) {
      const cellStart = start + cell.from;
      const cellEnd = start + cell.to;
      return {
        markerId,
        quote: capBytes(cell.text, MAX_ANCHOR_QUOTE_BYTES),
        before: stripped.text.slice(Math.max(0, cellStart - ANCHOR_CONTEXT_CHARS), cellStart),
        after: stripped.text.slice(cellEnd, cellEnd + ANCHOR_CONTEXT_CHARS),
        approximateOffset: cellStart,
        display,
      };
    }
  }
  const quote = capBytes(stripped.text.slice(start, end), MAX_ANCHOR_QUOTE_BYTES);
  return {
    markerId,
    quote,
    before: stripped.text.slice(Math.max(0, start - ANCHOR_CONTEXT_CHARS), start),
    after: stripped.text.slice(end, end + ANCHOR_CONTEXT_CHARS),
    approximateOffset: start,
    // Only present where the range is covered by a widget: the card then frames
    // the picture, the diagram or the cell instead of quoting text nobody sees.
    ...(display ? { display } : {}),
  };
}

/**
 * Captures the anchor for a comment on a frontmatter property - a database cell
 * in one view, a row in the properties panel in another. The plan (Stufe E,
 * section 5) is explicit that this anchor writes NOTHING into the Markdown:
 * "Kein Textbereich, kein Marker im Markdown - der Schluessel selbst ist der
 * Anker, und der ist stabil, solange die Eigenschaft existiert."
 *
 * The marker id is minted like any other and simply never inserted; a marker
 * that no note contains resolves as absent, which is exactly what an anchor
 * without text should do. The quote carries the value AT COMMENT TIME, which
 * section 5 asks for in its own right ("die Karte zeigt den Wert zum Zeitpunkt
 * des Kommentars als Zitat") and which keeps an orphaned card meaningful. An
 * empty value falls back to the key, because an anchor without a quote would
 * fail validation on the far side.
 */
export function buildPropertyCommentAnchor(key: string, value: string, markerId: string): WorkspaceCommentAnchor {
  protocolAssert(isAnchorMarkerId(markerId), "format", "anchor marker id is invalid");
  protocolAssert(typeof key === "string" && key.length >= 1, "format", "property anchor key is invalid");
  const shown = value.trim();
  return {
    markerId,
    quote: capBytes(shown.length > 0 ? shown : key, MAX_ANCHOR_QUOTE_BYTES),
    before: "",
    after: "",
    approximateOffset: 0,
    display: { kind: "property", key },
  };
}

/** The frontmatter key a property comment hangs on, or null for any other anchor. */
export function propertyAnchorKey(anchor: WorkspaceCommentAnchor | null | undefined): string | null {
  if (!anchor || anchor.display?.kind !== "property") return null;
  return anchor.display.key ?? null;
}

/** Where a property anchor ended up - the four cases of section 5. */
export type WorkspacePropertyAnchorResolution =
  /** The key is still there, untouched. */
  | { status: "key"; key: string }
  /** The property was renamed; the trail in the `.base` column led to it. */
  | { status: "renamed"; key: string }
  /** The property is gone. The comment stays, without a place. */
  | { status: "orphan" };

/**
 * Follows a property anchor to the key the note carries today.
 *
 * A comment is a sealed, immutable object: `prepareWorkspaceComment` is the only
 * writer and there is no edit path, so "der Anker zieht mit" can never mean
 * rewriting the stored anchor. It is resolved on every read instead - the same
 * shape as a text anchor, which is also re-found against the current document
 * rather than migrated.
 *
 * `aliasOf` maps a former key to the key that replaced it. It is fed from the
 * trail the rename leaves in the `.base` column (`previousKeys`), because that
 * trail has to reach every device: a purely local migration would leave a
 * second device showing the same comment as orphaned, which is worse than
 * orphaning it everywhere.
 */
export function resolvePropertyAnchor(
  key: string,
  present: (candidate: string) => boolean,
  aliasOf?: (former: string) => string | null,
): WorkspacePropertyAnchorResolution {
  if (present(key)) return { status: "key", key };
  const seen = new Set<string>([key]);
  let current = key;
  // A property may be renamed more than once; follow the chain, and stop on a
  // cycle rather than spin (a hand-edited `.base` can say anything).
  for (let hop = 0; hop < 16 && aliasOf; hop += 1) {
    const next = aliasOf(current);
    if (!next || seen.has(next)) break;
    if (present(next)) return { status: "renamed", key: next };
    seen.add(next);
    current = next;
  }
  return { status: "orphan" };
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
  if (!anchor.quote) return resolveInsertionPoint(raw, anchor);
  if (anchor.display?.kind === "tableCell" && !isLegacyTableQuote(anchor)) return resolveTableCell(raw, anchor);
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

/**
 * A cell anchor written before V7 quoted the whole table's Markdown. Such an
 * anchor keeps resolving the old way - by its quote - and the card names the
 * cell by the stored coordinates, without the cell's text.
 */
export function isLegacyTableQuote(anchor: Pick<WorkspaceCommentAnchor, "quote" | "display">): boolean {
  if (anchor.display?.kind !== "tableCell") return false;
  return anchor.quote.includes("\n") || anchor.quote.trimStart().startsWith("|");
}

/** One cell of a parsed table, with the offsets of its trimmed text. */
export interface ParsedTableCell {
  /** 0 is the header row, 1 the first body row (the separator line is no row). */
  row: number;
  column: number;
  text: string;
  from: number;
  to: number;
}

export interface ParsedTable {
  from: number;
  to: number;
  headers: string[];
  cells: ParsedTableCell[];
}

const TABLE_SEPARATOR_LINE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** The cells of one table row between unescaped pipes; the edge pipes delimit, they are no cells. */
function splitTableRow(line: string): Array<{ text: string; from: number; to: number }> {
  const cells: Array<{ text: string; from: number; to: number }> = [];
  const push = (start: number, end: number) => {
    let from = start;
    let to = end;
    while (from < to && /\s/.test(line[from])) from += 1;
    while (to > from && /\s/.test(line[to - 1])) to -= 1;
    cells.push({ text: line.slice(from, to), from, to });
  };
  let start = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "|") {
      push(start, index);
      start = index + 1;
    }
  }
  push(start, line.length);
  if (cells.length > 0 && cells[0].text === "" && line.trimStart().startsWith("|")) cells.shift();
  const trimmed = line.trimEnd();
  if (cells.length > 0 && cells[cells.length - 1].text === "" && trimmed.endsWith("|") && !trimmed.endsWith("\\|")) cells.pop();
  return cells;
}

/**
 * Every GFM table in a text, with its cells and their offsets (Tabellenzelle,
 * V7). Deliberately the small grammar Plainva writes - a header line, a
 * separator line, body lines, each starting with a pipe - so the core does
 * not grow a Markdown parser for one question.
 */
export function parseTablesIn(text: string): ParsedTable[] {
  const lines = text.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const tables: ParsedTable[] = [];
  let index = 0;
  while (index < lines.length) {
    const isHead = /^\s*\|/.test(lines[index]) && index + 1 < lines.length && lines[index + 1].includes("|") && TABLE_SEPARATOR_LINE.test(lines[index + 1]);
    if (!isHead) {
      index += 1;
      continue;
    }
    const first = index;
    let last = index + 1;
    while (last + 1 < lines.length && /^\s*\|/.test(lines[last + 1])) last += 1;
    const headerCells = splitTableRow(lines[first]);
    const cells: ParsedTableCell[] = headerCells.map((cell, column) => ({ row: 0, column, text: cell.text, from: starts[first] + cell.from, to: starts[first] + cell.to }));
    for (let line = first + 2; line <= last; line += 1) {
      const row = line - first - 1;
      for (const [column, cell] of splitTableRow(lines[line]).entries()) {
        cells.push({ row, column, text: cell.text, from: starts[line] + cell.from, to: starts[line] + cell.to });
      }
    }
    tables.push({ from: starts[first], to: starts[last] + lines[last].length, headers: headerCells.map((cell) => cell.text), cells });
    index = last + 1;
  }
  return tables;
}

/**
 * Finds a cell again (Tabellenzelle, V7): first at the stored coordinates in
 * the table the writer looked at, then by its text - a row inserted above
 * moves the cell and the card names the new row; a cell that is still where
 * it was but says something else is reported as such instead of being lost.
 */
function resolveTableCell(raw: string, anchor: WorkspaceCommentAnchor): WorkspaceCommentAnchorResolution {
  const stripped = stripAnchorMarkers(raw);
  const tables = parseTablesIn(stripped.text);
  if (tables.length === 0) return { status: "orphan" };
  const row = anchor.display?.row;
  const column = anchor.display?.column;
  const place = (table: ParsedTable, cell: ParsedTableCell, status: "quote" | "moved", changed = false): WorkspaceCommentAnchorResolution => ({
    status,
    from: stripped.toRaw(cell.from),
    to: stripped.toRaw(cell.to, "before"),
    cell: { row: cell.row, column: cell.column, columnLabel: table.headers[cell.column] ?? null, ...(changed ? { changed: true } : {}) },
  });
  const home =
    tables.find((table) => anchor.approximateOffset >= table.from && anchor.approximateOffset <= table.to) ??
    tables.reduce((best, table) => (Math.abs(table.from - anchor.approximateOffset) < Math.abs(best.from - anchor.approximateOffset) ? table : best), tables[0]);
  const atCoordinates = row !== undefined && column !== undefined ? home.cells.find((cell) => cell.row === row && cell.column === column) : undefined;
  if (atCoordinates && atCoordinates.text === anchor.quote) return place(home, atCoordinates, "quote");
  const inHome = home.cells.filter((cell) => cell.text === anchor.quote);
  if (inHome.length === 1) return place(home, inHome[0], "moved");
  const elsewhere = tables.flatMap((table) => table.cells.filter((cell) => cell.text === anchor.quote).map((cell) => ({ table, cell })));
  if (elsewhere.length === 1) return place(elsewhere[0].table, elsewhere[0].cell, "moved");
  if (atCoordinates) return place(home, atCoordinates, "moved", true);
  return { status: "orphan" };
}

/**
 * Drops the marker pairs that widget anchors wrote before 2026-09-03 (finding
 * of that day: a pair around a table kept the parser from seeing a table).
 * A picture, a diagram, a cell or a property is found by its display hint,
 * never by the pair, so removing it loses nothing. Returns the ids removed,
 * so a caller can tell a note that changed from one that did not.
 */
export function stripWidgetAnchorMarkers(
  raw: string,
  anchors: ReadonlyArray<Pick<WorkspaceCommentAnchor, "markerId" | "display"> | null | undefined>,
): { text: string; removed: string[] } {
  let text = raw;
  const removed: string[] = [];
  for (const anchor of anchors) {
    if (!anchor?.display || !isAnchorMarkerId(anchor.markerId) || removed.includes(anchor.markerId)) continue;
    if (!text.includes(openAnchorMarker(anchor.markerId)) && !text.includes(closeAnchorMarker(anchor.markerId))) continue;
    text = removeAnchorMarkers(text, anchor.markerId);
    removed.push(anchor.markerId);
  }
  return { text, removed };
}

/**
 * Where an insertion goes (Vorschlagsmodus, V1): the place between `before`
 * and `after`. Both together first - that is the exact spot; then either
 * alone, which is a guess and says so ("moved"); nothing found is an orphan,
 * like a passage that is gone. The result is an EMPTY range at the point.
 */
function resolveInsertionPoint(raw: string, anchor: WorkspaceCommentAnchor): WorkspaceCommentAnchorResolution {
  if (!anchor.before && !anchor.after) return { status: "orphan" };
  const stripped = stripAnchorMarkers(raw);
  const point = (start: number, status: "quote" | "moved"): WorkspaceCommentAnchorResolution => {
    const at = stripped.toRaw(start);
    return { status, from: at, to: at };
  };
  const both = occurrences(stripped.text, anchor.before + anchor.after);
  if (both.length === 1) return point(both[0] + anchor.before.length, "quote");
  if (both.length > 1) return point(nearest(both, Math.max(0, anchor.approximateOffset - anchor.before.length)) + anchor.before.length, "moved");
  const befores = anchor.before ? occurrences(stripped.text, anchor.before) : [];
  if (befores.length === 1) return point(befores[0] + anchor.before.length, "moved");
  const afters = anchor.after ? occurrences(stripped.text, anchor.after) : [];
  if (afters.length === 1) return point(afters[0], "moved");
  return { status: "orphan" };
}

/** True for an anchor that names a place, not a passage (Vorschlagsmodus, V1). */
export function isInsertionAnchor(anchor: WorkspaceCommentAnchor | null | undefined): boolean {
  return !!anchor && anchor.quote.length === 0;
}

/** Protocol-side validation of an anchor arriving from another device. */
export function assertWorkspaceCommentAnchor(anchor: WorkspaceCommentAnchor): void {
  protocolAssert(isAnchorMarkerId(anchor.markerId), "format", "comment anchor marker id is invalid");
  protocolAssert(typeof anchor.quote === "string" && utf8Encode(anchor.quote).length <= MAX_ANCHOR_QUOTE_BYTES, "bounds", "comment anchor quote is invalid");
  // An insertion point (empty quote) needs context on at least one side and
  // cannot sit on a widget - a picture has no "between".
  if (anchor.quote.length === 0) {
    protocolAssert((typeof anchor.before === "string" && anchor.before.length >= 1) || (typeof anchor.after === "string" && anchor.after.length >= 1), "bounds", "comment anchor quote is invalid");
    protocolAssert(anchor.display === undefined, "format", "an insertion point cannot carry a display hint");
  }
  protocolAssert(typeof anchor.before === "string" && [...anchor.before].length <= ANCHOR_CONTEXT_CHARS, "bounds", "comment anchor context is too large");
  protocolAssert(typeof anchor.after === "string" && [...anchor.after].length <= ANCHOR_CONTEXT_CHARS, "bounds", "comment anchor context is too large");
  assertSafeInteger(anchor.approximateOffset, 0, Number.MAX_SAFE_INTEGER, "comment anchor offset");
  if (anchor.display !== undefined) assertWorkspaceCommentAnchorDisplay(anchor.display);
}

/**
 * The display hint arrives from another device like the rest of the anchor, so
 * it is validated like the rest of the anchor. A hint that fails here is not
 * worth guessing at: the range still resolves, only the frame is lost.
 */
function assertWorkspaceCommentAnchorDisplay(display: WorkspaceCommentAnchorDisplay): void {
  protocolAssert(
    display.kind === "image" || display.kind === "diagram" || display.kind === "tableCell" || display.kind === "property",
    "format",
    "comment anchor display kind is invalid",
  );
  const cell = display.kind === "tableCell";
  // Row and column belong to a cell and nowhere else - an image with a column
  // number would be a contradiction the renderer could not act on.
  protocolAssert(cell || (display.row === undefined && display.column === undefined), "format", "comment anchor display carries cell coordinates without a cell");
  if (display.row !== undefined) assertSafeInteger(display.row, 0, 100000, "comment anchor display row");
  if (display.column !== undefined) assertSafeInteger(display.column, 0, 100000, "comment anchor display column");
  // The key IS the anchor for a property comment (plan Stufe E, section 5), so
  // an empty one would leave the comment pointing at nothing. On every other
  // kind it is a contradiction, the same way a column number is on an image.
  const property = display.kind === "property";
  protocolAssert(
    !property || (typeof display.key === "string" && display.key.length >= 1 && utf8Encode(display.key).length <= MAX_ANCHOR_QUOTE_BYTES),
    "format",
    "comment anchor display property key is invalid",
  );
  protocolAssert(property || display.key === undefined, "format", "comment anchor display carries a property key without a property");
  // A region belongs to a picture and nowhere else, and it has to describe a
  // rectangle that can exist: inside the picture, with a real extent. Anything
  // else would be drawn somewhere the reader never marked.
  protocolAssert(display.kind === "image" || display.rect === undefined, "format", "comment anchor display carries a rect without an image");
  if (display.rect !== undefined) assertWorkspaceCommentAnchorRect(display.rect);
}

function assertUnitFraction(value: number, label: string): void {
  protocolAssert(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1, "bounds", label + " is out of range");
}

function assertWorkspaceCommentAnchorRect(rect: WorkspaceCommentAnchorRect): void {
  protocolAssert(typeof rect === "object" && rect !== null, "format", "comment anchor display rect is invalid");
  assertUnitFraction(rect.x, "comment anchor display rect x");
  assertUnitFraction(rect.y, "comment anchor display rect y");
  assertUnitFraction(rect.w, "comment anchor display rect width");
  assertUnitFraction(rect.h, "comment anchor display rect height");
  // A zero-width marking is a stray click, not a region; the UI refuses to make
  // one, and a device that sends one anyway should not have it drawn.
  protocolAssert(rect.w > 0 && rect.h > 0, "bounds", "comment anchor display rect is empty");
  protocolAssert(rect.x + rect.w <= 1 && rect.y + rect.h <= 1, "bounds", "comment anchor display rect leaves the image");
}
