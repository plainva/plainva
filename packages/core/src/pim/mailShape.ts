import { colourHex, readAttributeColour, readColour, type Rgba } from "./mailColour.js";
import {
  appliedMailStyle, fontSizePx, lengthPx, namedFontSize, readLength, readMailStyle, writeMailStyle, type MailDeclaration,
} from "./mailStyle.js";

/**
 * What the mail reader's sanitizer does to a mail's tree beyond the styles of
 * one element (`mailStyle.ts`): the rules that hang on where an element stands
 * — ONE place, run by the sanitizer over the tree it gives the reader, and the
 * walk that reads what the reader shows (`htmlVisibleText.ts`) reads the result
 * with the same helpers. Review of 2026-11-17:
 *
 *  - **Nothing stands past the frame.** The reader scales a wide mail down to
 *    at most 0.4 and clips what is wider still; margins, paddings and widths
 *    add up from box to box, so each one on its own was harmless and together
 *    they laid words where nobody sees them. A box whose content would begin
 *    past `LEFT_MAX`, or which would reach past `REACH_MAX`, loses its
 *    horizontal lengths; a table row whose cells would, loses its cell widths.
 *    Text always wraps (`white-space: nowrap` is not kept), so what stands in a
 *    box stays in it.
 *  - **A colour is never kept without the background it was set on.** Where a
 *    background is not given to the reader (an image from an address, a value
 *    not read), the text colours set on it and under it fall away too, so the
 *    text reads in the colours around it — white text over a dropped picture
 *    was white on white.
 *  - **A size is never lost into nothing.** Where an element asked for a font
 *    size that is not kept, and inherits one too small to read (a column of
 *    `font-size:0` around cells that set their own), it gets the reader's size.
 *  - **Overflow is kept only where it clips a box to nothing** (`clipsToNothing`):
 *    a preview line or a block for phones only. Any other clip is dropped.
 *  - `hidden` reads the same in every engine (`until-found` is a hidden that
 *    one engine draws as a box of no content), table columns take no style, and
 *    legacy colour attributes are written as the colour they are read as.
 */

/** The reader's text size (its frame's body). */
export const READER_PX = 14;
/** Below this size in pixels a text is not one a person reads. */
export const MIN_TEXT_PX = 4;
/** The largest font size kept: a letter wider than the frame is past it. */
const MAX_FONT_PX = 96;
/**
 * The narrowest frame the reader has (a 320 px phone) scaled down to its least
 * (0.4) shows 800 px of a mail: no box reaches past `REACH_MAX`, and no content
 * begins past `LEFT_MAX`, so a word has room before the edge.
 */
export const REACH_MAX = 760;
export const LEFT_MAX = 560;
/** The frame body's margin. */
const BODY_MARGIN = 12;

/** Elements a browser lays out as blocks. */
const BLOCK = new Set([
  "div", "p", "section", "article", "aside", "header", "footer", "nav", "main", "blockquote", "figure", "address", "center",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dd", "dt", "pre", "form", "fieldset", "details", "summary", "hr",
]);
/** Displays whose box clips its content with `overflow`. */
const CLIPPING_DISPLAY = new Set(["block", "inline-block", "flow-root", "list-item", "flex", "inline-flex", "grid", "inline-grid"]);
/** What a browser's own style sheet indents an element by, at the start and at the end. */
const UA_INDENT: Record<string, [number, number, "margin" | "padding"]> = {
  ul: [40, 0, "padding"], ol: [40, 0, "padding"], menu: [40, 0, "padding"], dir: [40, 0, "padding"],
  blockquote: [40, 40, "margin"], figure: [40, 40, "margin"], dd: [40, 0, "margin"],
};
/** The reader's own pair (the frame's white sheet), set where the mail's pair is not understood. */
export const STANDARD_TEXT = "#222222";
export const STANDARD_BACKGROUND = "#ffffff";
const STANDARD_TEXT_RGBA: Rgba = [0x22, 0x22, 0x22, 1];
/** The properties of a pair of colours. */
const PAIR_PROPERTIES = new Set(["color", "background-color", "background-image"]);
/** Where `bgcolor` paints (HTML: presentational hints of the page and the parts of a table). */
const BGCOLOR_PAINTS = new Set(["body", "table", "thead", "tbody", "tfoot", "tr", "td", "th"]);
/** A table's parts grow to their content, whatever size they are given. */
const TABLE_PARTS = new Set(["table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption"]);
const TABLE_DISPLAY = new Set(["table", "inline-table", "table-row", "table-cell", "table-row-group", "table-header-group", "table-footer-group", "table-caption"]);
/** A painted box narrower than this may be narrower than one of its letters. */
const MIN_PAINTED_WIDTH = 40;

/** A colour as a style writes it. */
function colourCss(colour: Rgba): string {
  return colour[3] >= 1 ? colourHex(colour) : `rgba(${colour.slice(0, 3).map(Math.round).join(",")},${Number(colour[3].toFixed(3))})`;
}

/** How far a width attribute reaches; a share of the box up to all of it stays inside. */
function attributeReach(value: string | null): number {
  const size = value === null ? null : attributeWidth(value);
  return !size ? 0 : "px" in size ? size.px : size.percent <= 100 ? 0 : ((size.percent - 100) / 100) * REACH_MAX;
}

/** Elements the shaper looks at whatever the mail wrote on them. */
const SHAPES_ITSELF = new Set([
  "col", "colgroup", "body", "html", "font", "mark", "tr", "td", "th", "ul", "ol", "menu", "dir", "blockquote", "figure", "dd",
  "small", "sub", "sup", "big", "h1", "h2", "h3", "h5", "h6",
]);
/** `<font size>` 1 to 7. */
const FONT_SIZE_ATTRIBUTE = [10, 13, 16, 18, 24, 32, 48];

/** A font size, and whether it stands on a size named by a word (`small`, `<font size>`). */
export interface Font {
  px: number;
  keyword: boolean;
}

/** A browser never draws a size relative to a size named by a word smaller than this (Chromium's least logical size). */
const KEYWORD_MIN_PX = 6;

/**
 * The font size of an element, from its parent's: its own declared size
 * (`fontSizePx`) or, without one, what a browser's own style sheet gives it —
 * `<small>`, `<sub>` and `<sup>` a size smaller, `<big>` one larger, headings
 * their share, `<font size>` its step.
 *
 * A size named by a word (`x-small`, `<font size="1">`) is one a browser
 * keeps readable: a share of it (`35%`, `0.1em`) is never drawn smaller than
 * 6 px, however small the share (read off Chromium, 2026-11-17). A size in
 * pixels, or one a step smaller or larger, is drawn as it comes out.
 */
export function elementFont(name: string, attribute: (name: string) => string | null, declared: string | undefined, parent: Font): Font {
  const share = (px: number): Font => ({ px: parent.keyword && px > 0 ? Math.max(KEYWORD_MIN_PX, px) : px, keyword: parent.keyword });
  if (declared !== undefined) {
    if (namedFontSize(declared) !== null) return { px: namedFontSize(declared)!, keyword: true };
    if (declared === "larger" || declared === "smaller") return { px: fontSizePx(declared, parent.px)!, keyword: false };
    if (declared === "inherit" || declared === "unset") return parent;
    const own = fontSizePx(declared, parent.px);
    if (own !== null) return /^(?:\d|\.)[\d.]*(?:px|pt|pc|cm|mm|in|rem)$|^0$/.test(declared) ? { px: own, keyword: false } : share(own);
  }
  switch (name) {
    case "small":
    case "sub":
    case "sup":
      return { px: parent.px / 1.2, keyword: false };
    case "big":
      return { px: parent.px * 1.2, keyword: false };
    case "h1":
      return share(parent.px * 2);
    case "h2":
      return share(parent.px * 1.5);
    case "h3":
      return share(parent.px * 1.17);
    case "h5":
      return share(parent.px * 0.83);
    case "h6":
      return share(parent.px * 0.67);
    case "font": {
      const size = attribute("size")?.trim() ?? "";
      const m = /^([+-]?)(\d+)$/.exec(size);
      if (!m) return parent;
      const step = m[1] ? 3 + (m[1] === "+" ? 1 : -1) * parseInt(m[2], 10) : parseInt(m[2], 10);
      return { px: FONT_SIZE_ATTRIBUTE[Math.min(7, Math.max(1, step)) - 1], keyword: true };
    }
    default:
      return parent;
  }
}

/** Whether a length is given and is no length at all. */
function zero(value: string | undefined, px: number): boolean {
  return value !== undefined && lengthPx(value, px, 0) === 0;
}
/** Whether a length is given and is more than nothing (a percentage always counts). */
function some(value: string | undefined, px: number): boolean {
  if (value === undefined || value === "auto" || value === "none") return false;
  return (lengthPx(value, px, 1) ?? 1) > 0;
}
type Sides = [string | undefined, string | undefined, string | undefined, string | undefined];
const NO_SIDES: Sides = [undefined, undefined, undefined, undefined];
const SIDES = new WeakMap<Map<string, string>, { margin: Sides; padding: Sides }>();

/** The four sides of a box property, from its shorthand and its longhands — read once per style. */
function sides(applied: Map<string, string>, property: "margin" | "padding"): Sides {
  let known = SIDES.get(applied);
  if (!known) SIDES.set(applied, (known = { margin: readSides(applied, "margin"), padding: readSides(applied, "padding") }));
  return known[property];
}

function readSides(applied: Map<string, string>, property: string): Sides {
  if (!applied.has(property) && !applied.has(`${property}-top`) && !applied.has(`${property}-right`) && !applied.has(`${property}-bottom`) && !applied.has(`${property}-left`)) return NO_SIDES;
  const short = applied.get(property)?.split(" ");
  const fromShort = (index: number): string | undefined => {
    if (!short) return undefined;
    const pick = [[0, 0, 0, 0], [0, 1, 0, 1], [0, 1, 2, 1], [0, 1, 2, 3]][short.length - 1];
    return pick ? short[pick[index]] : undefined;
  };
  return [
    applied.get(`${property}-top`) ?? fromShort(0),
    applied.get(`${property}-right`) ?? fromShort(1),
    applied.get(`${property}-bottom`) ?? fromShort(2),
    applied.get(`${property}-left`) ?? fromShort(3),
  ];
}

/**
 * Whether the element clips itself to nothing: `overflow: hidden` on a box of
 * no height (or no width) that holds no padding in that direction and is not
 * given a least size — a preview line, a block for phones only. Inline
 * elements and table cells do not clip that way. The sanitizer keeps
 * `overflow` only where this holds, and the walk reads such a box as hidden.
 */
export function clipsToNothing(name: string, applied: Map<string, string>, px: number): boolean {
  if (applied.get("overflow") !== "hidden") return false;
  const display = applied.get("display") ?? (BLOCK.has(name) ? "block" : "inline");
  if (!CLIPPING_DISPLAY.has(display)) return false;
  const [top, right, bottom, left] = sides(applied, "padding");
  const vertical = (zero(applied.get("height"), px) || zero(applied.get("max-height"), px)) && !some(applied.get("min-height"), px) && !some(top, px) && !some(bottom, px);
  const horizontal = (zero(applied.get("width"), px) || zero(applied.get("max-width"), px)) && !some(applied.get("min-width"), px) && !some(left, px) && !some(right, px);
  return vertical || horizontal;
}

const APPLIED = new WeakMap<MailDeclaration[], Map<string, string>>();
/** `appliedMailStyle`, once per list of declarations. */
function applyOnce(declarations: MailDeclaration[]): Map<string, string> {
  let applied = APPLIED.get(declarations);
  if (!applied) APPLIED.set(declarations, (applied = appliedMailStyle(declarations)));
  return applied;
}

/** A table row being shaped: where its cells begin, how far they reach, and how to take their widths back. */
interface Row {
  left: number;
  used: number;
  takeBack: Array<() => void>;
}

/** What an element hands down to the elements inside it. */
export interface ShapeState {
  /** Its font size. */
  readonly font: Font;
  /** Where its content begins, in pixels from the frame's left edge. */
  readonly left: number;
  /** Whether text colours under it fall away: a background they were set on is not kept. */
  readonly dropColours: boolean;
  /** The row, for a table row. */
  readonly row: Row | null;
  /** The colour the mail gives its letters here, where it is understood. */
  readonly intended: Rgba | null;
  /** Makes the nearest painted box above hold the floats inside it. */
  readonly holdFloats?: () => void;
}

/**
 * How the shaper reads and writes an element: the attributes it reads as the
 * mail wrote them, and the value given to the reader. Until the shaper gives
 * another, the reader has the style as the list keeps it (`keptMailStyle`) and
 * none of the other attributes it reads.
 */
export interface ShapeAccess<N> {
  /** The attributes the shaper reads, as the mail wrote them; none where it wrote none of them. */
  written(node: N): ReadonlyMap<string, string> | undefined;
  /** Gives the reader this value of the attribute; `null` takes it away. */
  give(node: N, name: string, value: string | null): void;
}

const NONE: ReadonlyMap<string, string> = new Map();

/** Horizontal properties, and what a box keeps of its sides when it reaches too far. */
const HORIZONTAL = new Set(["margin-left", "margin-right", "padding-left", "padding-right", "width", "min-width", "text-indent"]);

/** A table attribute of a number of pixels, kept up to a cap. */
const CAPPED_ATTRIBUTES: Record<string, number> = { cellpadding: 40, cellspacing: 40, hspace: 40, vspace: 40, border: 10 };

/** A width as an attribute writes it: pixels, or a percentage. */
function attributeWidth(value: string): { px: number } | { percent: number } | null {
  const m = /^(\d+(?:\.\d+)?)(%|px)?$/i.exec(value.trim());
  if (!m) return null;
  return m[2] === "%" ? { percent: parseFloat(m[1]) } : { px: parseFloat(m[1]) };
}

/** How far a width reaches past where its box begins; a percentage up to 100 stays inside its container. */
function widthReach(value: string | undefined, px: number): number {
  if (value === undefined) return 0;
  const length = readLength(value);
  if (!length) return 0;
  if (length.unit === "%") return length.amount <= 100 ? 0 : ((length.amount - 100) / 100) * REACH_MAX;
  return lengthPx(value, px, REACH_MAX) ?? 0;
}

/**
 * Shapes a mail's tree for the reader, one element at a time from the top
 * down — the sanitizer calls `element` for each element in document order,
 * with the state of its parent (`root` for the top).
 */
export class MailShaper<N> {
  constructor(private readonly access: ShapeAccess<N>) {}

  root(): ShapeState {
    return { font: { px: READER_PX, keyword: false }, left: BODY_MARGIN, dropColours: false, row: null, intended: STANDARD_TEXT_RGBA };
  }

  /**
   * An element without any attribute the shaper reads, and of a kind a browser
   * gives no size or indent of its own, stands where its parent's content does.
   */
  element(node: N, name: string, parent: ShapeState): ShapeState {
    const attributes = this.access.written(node) ?? NONE;
    if (attributes.size === 0 && !SHAPES_ITSELF.has(name)) return parent.row === null ? parent : { ...parent, row: null };
    const written = (attr: string): string | null => attributes.get(attr) ?? null;
    const give = (attr: string, value: string | null) => this.access.give(node, attr, value);
    if (name === "col" || name === "colgroup") {
      // A column's style and width act on cells that carry their own (Chromium
      // collapses a column by `visibility`): a column is given neither.
      give("style", null);
      give("width", null);
      return parent;
    }

    const read = readMailStyle(written("style") ?? "");
    if (name === "body" || name === "html") {
      // The page itself is not given to the reader, only what it holds: a
      // background it set is lost, and the colours set on it go with it.
      const lost = read.lostBackground || read.declarations.some((d) => d.name === "background-color" || d.name === "background-image") || written("bgcolor") !== null || written("background") !== null;
      return { ...parent, dropColours: parent.dropColours || lost };
    }
    // The list as read, until a rule below changes it (then a copy).
    let declarations: MailDeclaration[] = read.declarations;

    // Plain attributes, written as they are read.
    for (const [attr, value] of attributes) {
      if (attr === "hidden") give("hidden", "");
      else if (attr === "width" || attr === "height") {
        const size = attributeWidth(value);
        give(attr, size ? ("px" in size ? String(size.px) : `${size.percent}%`) : null);
      } else if (Object.prototype.hasOwnProperty.call(CAPPED_ATTRIBUTES, attr)) {
        const n = /^\s*(\d+)\s*$/.exec(value);
        give(attr, n && parseInt(n[1], 10) <= CAPPED_ATTRIBUTES[attr] ? String(parseInt(n[1], 10)) : null);
      }
    }

    // One pair of colours, never half of one (review of 2026-11-17): the
    // letters stand in the colours the mail gave them on the background that
    // really lies behind them, as far as both are understood — or in the
    // reader's own pair, both set. Never a colour kept beside a background that
    // fell away, or a background kept beside a colour that fell away.
    const bgcolor = written("bgcolor");
    // `bgcolor` paints on a page and on the parts of a table only; elsewhere a browser ignores it.
    const attributeBackground = bgcolor !== null && BGCOLOR_PAINTS.has(name) ? readAttributeColour(bgcolor) : null;
    // Given as a style, which every engine paints alike (Chromium ignores it on a row group).
    if (bgcolor !== null) give("bgcolor", null);
    if (attributeBackground && !declarations.some((d) => d.name === "background-color")) {
      declarations = [{ name: "background-color", value: colourHex(attributeBackground), important: false }, ...declarations];
    }
    const applied0 = applyOnce(declarations);
    const fill = applied0.get("background-color");
    const paintsOwn =
      (fill !== undefined && (readColour(fill)?.[3] ?? 0) > 0) || applied0.has("background-image") || name === "mark";
    const lostPicture = (read.lostBackground || written("background") !== null) && !paintsOwn;
    const ownColour = applied0.get("color");
    const fontColour = name === "font" ? written("color") : null;
    let intended: Rgba | null = read.lostColour ? null : ownColour !== undefined ? readColour(ownColour) : fontColour !== null ? (readAttributeColour(fontColour) ?? parent.intended) : parent.intended;
    let dropColours: boolean;
    let standardPair = lostPicture || read.lostColour;
    if (!standardPair && paintsOwn && parent.dropColours && ownColour === undefined && fontColour === null) {
      // A background of its own under a colour that fell away above: the
      // letters take the colour the mail meant for them, or the reader's pair.
      if (parent.intended) declarations = [...declarations, { name: "color", value: colourCss(parent.intended), important: false }];
      else standardPair = true;
    }
    if (standardPair) {
      declarations = [
        ...declarations.filter((d) => !PAIR_PROPERTIES.has(d.name)),
        { name: "color", value: STANDARD_TEXT, important: true },
        { name: "background-color", value: STANDARD_BACKGROUND, important: true },
      ];
      if (fontColour !== null) give("color", null);
      // What is set under it was set against a background that is not shown;
      // `intended` stays the colour the mail meant, for a background of its own below.
      dropColours = true;
    } else {
      dropColours = paintsOwn ? false : parent.dropColours;
      if (dropColours && declarations.some((d) => d.name === "color")) declarations = declarations.filter((d) => d.name !== "color");
      if (fontColour !== null) {
        const value = dropColours ? null : readAttributeColour(fontColour);
        give("color", value ? colourHex(value) : null);
      }
    }
    const paints = paintsOwn || standardPair;

    // The font size: never lost into nothing, never wider than the frame.
    let applied = applyOnce(declarations);
    let font = elementFont(name, written, applied.get("font-size"), parent.font);
    if (read.lostFontSize && !applied.has("font-size") && font.px < MIN_TEXT_PX) {
      declarations = [...declarations, { name: "font-size", value: `${READER_PX}px`, important: false }];
      font = { px: READER_PX, keyword: false };
    }
    if (font.px > MAX_FONT_PX) {
      declarations = [...declarations.filter((d) => d.name !== "font-size"), { name: "font-size", value: `${MAX_FONT_PX}px`, important: false }];
      font = { px: MAX_FONT_PX, keyword: false };
    }
    const px = font.px;
    applied = applyOnce(declarations);

    // A background lies behind every word of its box: a painted box keeps no
    // size it could be smaller than its words (a table's parts grow to theirs).
    const block = BLOCK.has(name) || (applied.has("display") && applied.get("display") !== "inline");
    if (paints && !TABLE_PARTS.has(name) && !TABLE_DISPLAY.has(applied.get("display") ?? "")) {
      const narrow = (value: string | undefined) => value !== undefined && value !== "auto" && value !== "none" && (lengthPx(value, px, REACH_MAX) ?? 0) < MIN_PAINTED_WIDTH;
      const before = declarations;
      declarations = declarations.filter((d) => !(d.name === "height" || d.name === "max-height" || ((d.name === "width" || d.name === "max-width") && narrow(d.value))));
      if (declarations.length !== before.length) applied = applyOnce(declarations);
    }
    // A float in a painted box stands on that box's background: the box holds it.
    if (applied.get("float") === "left" || applied.get("float") === "right") parent.holdFloats?.();
    // A picture never wider than its box (the frame sets that; `max-width:none` would undo it) nor than the frame.
    if (name === "img") {
      const before = declarations;
      declarations = declarations.filter((d) => !(d.name === "max-width" && (d.value === "none" || widthReach(d.value, px) > 0)));
      const pictureWidth = Math.max(widthReach(applied.get("width"), px), widthReach(applied.get("min-width"), px), attributeReach(written("width")));
      if (parent.left + pictureWidth > REACH_MAX) {
        declarations = declarations.filter((d) => d.name !== "width" && d.name !== "min-width" && d.name !== "height");
        give("width", null);
        give("height", null);
      }
      if (declarations !== before) applied = applyOnce(declarations);
    }

    // Where the box stands and how far it reaches.
    const row = parent.row;
    const cell = (name === "td" || name === "th") && row !== null;
    let start = cell ? row.left + row.used : parent.left;
    if (cell && start > LEFT_MAX) {
      // The cells before it reach too far together: they lose their widths.
      for (const takeBack of row.takeBack) takeBack();
      row.takeBack.length = 0;
      row.used = 0;
      start = row.left;
    }
    const length = (value: string | undefined) => (value === undefined ? 0 : (lengthPx(value, px, REACH_MAX) ?? 0));
    const [, marginRight, , marginLeft] = sides(applied, "margin");
    const [, paddingRight, , paddingLeft] = sides(applied, "padding");
    const ua = UA_INDENT[name];
    const attrWidth = name === "img" ? null : written("width");
    const attrSize = attrWidth === null ? null : attributeWidth(attrWidth);
    const attrReach = !attrSize ? 0 : "px" in attrSize ? attrSize.px : attrSize.percent <= 100 ? 0 : ((attrSize.percent - 100) / 100) * REACH_MAX;
    const startSide = length(marginLeft) + length(paddingLeft) + (ua && !(marginLeft || paddingLeft) ? ua[0] : 0);
    const endSide = length(marginRight) + length(paddingRight) + (ua && !(marginRight || paddingRight) ? ua[1] : 0);
    const widthOf = name === "img" ? 0 : Math.max(widthReach(applied.get("width"), px), widthReach(applied.get("min-width"), px), attrReach);
    let contentLeft = start + startSide;
    const reach = contentLeft + widthOf + endSide;
    const indent = contentLeft + length(applied.get("text-indent"));
    const reachesTooFar = contentLeft > LEFT_MAX || reach > REACH_MAX || indent > LEFT_MAX;
    if (reachesTooFar) {
      declarations = this.withoutHorizontal(declarations);
      if (ua) declarations = [...declarations, { name: `${ua[2]}-left`, value: "0", important: true }, { name: `${ua[2]}-right`, value: "0", important: true }];
      if (attrWidth !== null) give("width", null);
      contentLeft = start;
    }

    // Overflow only where it clips the box to nothing.
    applied = applyOnce(declarations);
    if (applied.has("overflow") && !clipsToNothing(name, applied, px)) declarations = declarations.filter((d) => d.name !== "overflow");

    if (cell) {
      row.used += reachesTooFar ? 0 : reach - start;
      if (!reachesTooFar) {
        const final = declarations;
        const hadWidth = attrWidth !== null;
        row.takeBack.push(() => {
          const without = final.filter((d) => d.name !== "width" && d.name !== "min-width");
          give("style", without.length > 0 ? writeMailStyle(without) : null);
          if (hadWidth) give("width", null);
        });
      }
    }

    if (declarations !== read.declarations) give("style", declarations.length === 0 ? null : writeMailStyle(declarations));
    const final = declarations;
    let holding = false;
    const holdFloats =
      paints && block && !TABLE_PARTS.has(name) && !applied.has("display")
        ? () => {
            if (holding) return;
            holding = true;
            give("style", writeMailStyle([...final, { name: "display", value: "flow-root", important: false }]));
          }
        : paints
          ? undefined
          : parent.holdFloats;
    return {
      font,
      left: contentLeft,
      dropColours,
      intended,
      holdFloats,
      row: name === "tr" ? { left: contentLeft, used: 0, takeBack: [] } : null,
    };
  }

  /** The declarations without the horizontal lengths; a margin or padding shorthand keeps its top and bottom. */
  private withoutHorizontal(declarations: MailDeclaration[]): MailDeclaration[] {
    const out: MailDeclaration[] = [];
    for (const d of declarations) {
      if (HORIZONTAL.has(d.name)) continue;
      if (d.name === "margin" || d.name === "padding") {
        const parts = d.value.split(" ");
        const top = parts[0];
        const bottom = parts.length >= 3 ? parts[2] : parts[0];
        out.push({ name: `${d.name}-top`, value: top, important: d.important }, { name: `${d.name}-bottom`, value: bottom, important: d.important });
        continue;
      }
      out.push(d);
    }
    return out;
  }
}
