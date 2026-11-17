import { parseFragment } from "parse5";
import { contrast, MIN_CONTRAST, over, readAttributeColour, readColour, type Rgba } from "./mailColour.js";
import { clipsToNothing, elementFont, MIN_TEXT_PX, READER_PX, type Font } from "./mailShape.js";
import { appliedMailStyle, backgroundImageColours, lengthPx, mailStyleDeclarations, readOpacity } from "./mailStyle.js";

/**
 * What the walk reads of a node: the shape of parse5's tree. A caller with a
 * DOM of its own hands in a `MarkupReader` that asks each node through the
 * platform's prototypes, never through the node's properties: what a DOM node
 * answers to a property name is partly up to the markup it was made from — a
 * form answers `form.childNodes` with its control of that name (finding
 * 2026-10-12).
 */
export interface MarkupNode {
  readonly nodeName: string;
  readonly childNodes?: ArrayLike<MarkupNode>;
  /** A text node's text. */
  readonly value?: unknown;
  /** An element's attributes. */
  readonly attrs?: ReadonlyArray<{ readonly name: string; readonly value: string }>;
}

/** Never text on screen: scripts and styles, the document head, embedded
 * content whose inner text is only a fallback for a reader that cannot show it,
 * what a browser's own style sheet hides, and what the mail reader's sanitizer
 * removes together with its content. */
const NOT_SHOWN = new Set([
  "script", "style", "head", "title", "template", "noscript", "noembed", "noframes", "iframe", "svg", "math",
  "audio", "video", "canvas", "meter", "progress", "datalist", "rp", "xmp", "plaintext",
]);
/** Set apart by an empty line, the way their margins set them apart on screen. */
const PARAGRAPH = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "table", "dl", "hr", "figure", "address"]);
/** Begin and end on a line of their own. */
const LINE = new Set(["div", "li", "dt", "dd", "tr", "caption", "section", "article", "aside", "header", "footer", "nav", "main", "figcaption", "center", "form", "fieldset", "details", "summary", "dialog"]);
/** `white-space` values under which a line break in the source is one on screen. */
const KEEPS_LINES = new Set(["pre", "pre-wrap", "pre-line", "break-spaces"]);
/** Quote marks written per line at most: a mail nested deeper than anybody
 * quotes would otherwise grow the text with the square of its depth. */
const QUOTE_LEVELS = 32;

/** Characters that take up no room: a line made of them and blanks is an empty
 * line. Senders pad a preview text with runs of these. Code points, not a
 * pattern — several are combining marks, which a character class misreads. */
const NO_WIDTH = new Set([0x00ad, 0x034f, 0x061c, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2800, 0x3164, 0xfeff]);

/** The blank that does not break a line — built here, never typed. */
const NO_BREAK_BLANK = String.fromCharCode(0xa0);

/** A plain text has no use for a blank that does not break: it is a blank. */
function plainBlanks(text: string): string {
  return text.includes(NO_BREAK_BLANK) ? text.split(NO_BREAK_BLANK).join(" ") : text;
}

function isBlank(text: string): boolean {
  for (const char of text) {
    if (char.trim() !== "" && !NO_WIDTH.has(char.codePointAt(0)!)) return false;
  }
  return true;
}

/** An element's name in lower case; "" for text, comments and the like. */
function elementName(node: MarkupNode): string {
  return node.nodeName.startsWith("#") ? "" : node.nodeName.toLowerCase();
}

/**
 * How the walk reads a tree: the few things it asks of a node. For a tree of
 * `MarkupNode`s that is `MARKUP_NODES`; the mail reader hands in one that reads
 * the nodes of the tree its sanitizer made through the platform's prototypes,
 * so the walk reads that tree itself, not a copy and not a second parse.
 */
export interface MarkupReader<N> {
  /** "#text" for a text node, an element's name in lower case, "" for anything else. */
  kind(node: N): string;
  children(node: N): ArrayLike<N> | undefined;
  /** A text node's text. */
  text(node: N): string;
  attribute(node: N, name: string): string | null;
  /** An image whose picture the sanitizer held back (an address): the reader shows a place for it. */
  heldBack?(node: N): boolean;
}

export const MARKUP_NODES: MarkupReader<MarkupNode> = {
  kind: (node) => (node.nodeName === "#text" ? "#text" : elementName(node)),
  children: (node) => node.childNodes,
  text: (node) => (typeof node.value === "string" ? node.value : ""),
  attribute: (node, name) => node.attrs?.find(attr => attr.name === name)?.value ?? null,
};

/** The colours of the reader's canvas where a mail paints itself (the white sheet), or none where it does not. */
export interface ReaderCanvas {
  text: Rgba;
  background: Rgba;
}

/** The white sheet a mail that sets colours of its own is shown on (`buildMailFrameDoc`). */
export const WHITE_SHEET: ReaderCanvas = { text: [0x22, 0x22, 0x22, 1], background: [255, 255, 255, 1] };
/** A browser's colour for a link nobody set one for. */
const LINK_COLOUR: Rgba = [0, 0, 0xee, 1];
/** A `<mark>`, as a browser's own style sheet paints it. */
const MARK: { text: Rgba; background: Rgba } = { text: [0, 0, 0, 1], background: [255, 255, 0, 1] };
/** Backgrounds tracked at most: gradients over gradients multiply. */
const BACKGROUNDS_MAX = 16;

export interface VisibleOptions {
  /** The canvas the reader paints this mail on; without one, colours are not compared (they are the theme's). */
  canvas?: ReaderCanvas | null;
  /** Only whether the body shows anything: the walk stops at the first word or picture. */
  untilShown?: boolean;
}

/**
 * The properties of a style the walk judges — what can take words off the
 * screen. The sanitizer keeps no other property that could (`MAIL_STYLE` in
 * `mailStyle.ts`; `mailStyleCoupling.test.ts` holds the two lists together).
 */
export const JUDGED_BY_THE_WALK = ["display", "visibility", "opacity", "font-size", "white-space", "color", "background-color", "background-image", "overflow"] as const;

export { MIN_TEXT_PX };
/** Below this opacity a text is not one a person sees. */
export const MIN_OPACITY = 0.1;

/**
 * The declarations of an element's own `style` that the mail sanitizer keeps
 * (`mailStyleDeclarations`), read the way a browser resolves them
 * (`appliedMailStyle`).
 */
function inlineStyle<N>(reader: MarkupReader<N>, node: N): Map<string, string> {
  const written = reader.attribute(node, "style") ?? "";
  return written ? appliedMailStyle(mailStyleDeclarations(written)) : new Map();
}

/**
 * Whether the element is off the screen with everything inside it, whatever
 * that may declare for itself: `display: none` — the `hidden` attribute is
 * that, and so is a dialog nobody opened or a popover, unless the element's
 * own style gives another display; a box that clips itself to nothing
 * (`clipsToNothing`); of a closed `details` the walk reads the summary only.
 * A font too small to read, a text too faint to see or in the colour of what
 * lies behind it, and `visibility: hidden` are carried along the walk
 * instead, see below: a child can set them again, and layouts do (a table cell
 * of size 0 around a column of size 13).
 *
 * A style sheet is not consulted (the mail reader drops `<style>` altogether);
 * positions, transforms and clipping paths never reach the reader
 * (`MAIL_STYLE`), and no box reaches past the frame (`mailShape.ts`).
 */
function takenOffScreen<N>(reader: MarkupReader<N>, name: string, node: N, declared: Map<string, string>, px: number): boolean {
  const display = declared.get("display");
  // A popover is shown only on request, like a dialog nobody opened (§ 3.84).
  const hiddenAsItStands = reader.attribute(node, "hidden") !== null || reader.attribute(node, "popover") !== null || (name === "dialog" && reader.attribute(node, "open") === null);
  if (display === undefined ? hiddenAsItStands : display === "none") return true;
  return clipsToNothing(name, declared, px);
}

/** Whether a size the markup gives an image is one of nothing: at most a pixel, or no share of its box. */
function noSize(value: string | null | undefined, px: number): boolean {
  if (value === null || value === undefined) return false;
  const trimmed = value.trim().toLowerCase();
  const attribute = /^(\d+(?:\.\d+)?|\.\d+)(px|%)?$/.exec(trimmed);
  if (attribute) return attribute[2] === "%" ? parseFloat(attribute[1]) === 0 : parseFloat(attribute[1]) <= 1;
  const length = lengthPx(trimmed, px, 100);
  return length !== null && length <= 1;
}

/** Whether an image shows: it has something to show and is not drawn at a size of nothing. */
function imageShows<N>(reader: MarkupReader<N>, node: N, declared: Map<string, string>, faint: boolean, small: boolean, px: number): boolean {
  if (faint) return false;
  const src = reader.attribute(node, "src")?.trim() ?? "";
  const alt = reader.attribute(node, "alt")?.trim() ?? "";
  if (!src && (alt === "" || small)) return false;
  for (const side of ["width", "height"]) {
    if (noSize(reader.attribute(node, side), px)) return false;
    if (noSize(declared.get(side), px) || noSize(declared.get(`max-${side}`), px)) return false;
  }
  return true;
}

interface Line {
  /** How many quotes deep the line stands. */
  depth: number;
  /** Empty for the empty line between two paragraphs. */
  text: string;
}

/** What an element hands down to its content: the walk keeps it while it reads what is inside. */
interface Inherited {
  font: Font;
  opacity: number;
  unseen: boolean;
  pre: number;
  /** The text colour, where colours are compared. */
  colour: Rgba | null;
  /** What lies behind the text: one colour, or the stops of a gradient. */
  backgrounds: readonly Rgba[];
}

/** On the walk's stack: an element whose content has been read, with what
 * stood before it of the things an element hands down to its content. A class
 * of its own, so that no node of anybody's tree can be mistaken for one. */
class Closing {
  readonly name: string;
  readonly before: Inherited;
  constructor(name: string, before: Inherited) {
    this.name = name;
    this.before = before;
  }
}

/** Whether a text in `colour` stands out from every colour behind it. */
function stands(colour: Rgba, backgrounds: readonly Rgba[]): boolean {
  for (const background of backgrounds) if (contrast(over(colour, background), background) < MIN_CONTRAST) return false;
  return true;
}

/** `layers` painted over each of `beneath`, opaque. */
function paint(layers: readonly Rgba[], beneath: readonly Rgba[]): Rgba[] {
  const painted: Rgba[] = [];
  for (const below of beneath) for (const layer of layers) if (painted.length < BACKGROUNDS_MAX) painted.push(over(layer, below));
  return painted;
}

/**
 * The text of an HTML body the way a reader has it on screen — the words a
 * person could select and copy there, in the lines they stand in.
 *
 * `htmlToPlainText` returns every text node; this leaves out what is not shown
 * (see `takenOffScreen` and `NOT_SHOWN`), folds a run of blanks into one (a
 * line break in the source is a blank, an empty line is a paragraph), and keeps
 * the three structures a plain text has a form for: a quoted passage (`> `, one
 * per level), a list (`- `, `1. `) and preformatted lines. Link targets and
 * images are not text and are not in it.
 *
 * `parse` makes the tree; by default that is parse5, the parser for a place
 * without a DOM. Its work grows with the square of the nesting depth, and a
 * browser's own parser stops nesting at a depth a page can have: the mail
 * reader walks the tree its sanitizer made (`visibleDocumentOf`).
 *
 * The walk itself does not recurse, and its work and what it writes grow with
 * the input, not faster: the markup is a stranger's.
 */
export function htmlToVisibleText(html: string, parse: (html: string) => MarkupNode = markup => parseFragment(markup)): string {
  return htmlToVisibleDocument(html, parse).text;
}

/** A link as the reader shows it: its visible words and its target as the markup wrote it. */
export interface VisibleLink {
  text: string;
  href: string;
}

/** What the reader shows of an HTML body: its text, its links, and whether it shows anything at all — a word or an image. */
export interface VisibleDocument {
  text: string;
  links: VisibleLink[];
  shows: boolean;
}

/** Links read at most, and the words of one kept: a stranger's markup decides how many there are. */
const VISIBLE_LINKS_MAX = 500;
const VISIBLE_LINK_TEXT_MAX = 160;

/** `visibleDocumentOf` over the tree `parse` makes of `html`. */
export function htmlToVisibleDocument(html: string, parse: (html: string) => MarkupNode = markup => parseFragment(markup), options: VisibleOptions = {}): VisibleDocument {
  return visibleDocumentOf(parse(html), MARKUP_NODES, options);
}

/**
 * The text of an HTML body as `htmlToVisibleText` reads it, together with the
 * links that stand on screen in it, in their order: an `<a href>` whose element
 * is shown and that shows something — a visible word or an image. A link the
 * markup hides, or one inside what is hidden, is not one the reader can see or
 * follow, and is not in the list (finding 2026-11-16: the assistant read a
 * mail's text and links on a way of its own, from the raw markup).
 *
 * The root is a container, whatever it is — its own attributes are not the
 * message's.
 */
export function visibleDocumentOf<N>(root: N, reader: MarkupReader<N>, options: VisibleOptions = {}): VisibleDocument {
  const canvas = options.canvas ?? null;
  const links: VisibleLink[] = [];
  /** The links being read, innermost last, each with whether it shows anything yet. */
  const anchors: Array<{ href: string; text: string; shows: boolean }> = [];
  const lines: Line[] = [];
  let line = "";
  /** Whether `line` ends in a blank. Kept beside it: asking the line itself
   * flattens a string that is still growing, once per text — on one long line
   * that is the square of its length (finding 2026-10-12). */
  let lineEndsBlank = false;
  /** Whether a word stands anywhere yet, for `untilShown`. */
  let worded = false;
  let marker = "";
  let quote = 0;
  /** Handed down from an element to its content (see `Inherited`). */
  let state: Inherited = { font: { px: READER_PX, keyword: false }, opacity: 1, unseen: false, pre: 0, colour: canvas?.text ?? null, backgrounds: canvas ? [canvas.background] : [] };
  /** Whether the text in the current state is not one a person sees. */
  let hidden = false;
  const judge = (): void => {
    hidden = state.unseen || state.font.px < MIN_TEXT_PX || state.opacity < MIN_OPACITY || (state.colour !== null && !stands(state.colour, state.backgrounds));
  };
  /** Whether an image the reader shows stands anywhere in the body. */
  let picture = false;
  /** One entry per open list: the next number of an ordered one, 0 for bullets. */
  const lists: number[] = [];

  const emptyLine = (): void => {
    const last = lines[lines.length - 1];
    if (!last) return;
    // An empty line where a quote begins or ends belongs to the shallower side.
    if (last.text === "") last.depth = Math.min(last.depth, quote);
    else lines.push({ depth: quote, text: "" });
  };
  /** Ends the line being written; `kept` when the markup asked for the break itself. */
  const endLine = (kept = false): void => {
    const text = line.trimEnd();
    line = "";
    lineEndsBlank = false;
    if (isBlank(text)) {
      if (kept) emptyLine();
      return;
    }
    lines.push({ depth: quote, text: marker + text });
    marker = "";
  };
  const paragraph = (): void => {
    endLine();
    emptyLine();
  };
  const append = (piece: string): void => {
    if (piece === "") return;
    line += piece;
    lineEndsBlank = piece.endsWith(" ");
    if (!worded && !isBlank(piece)) worded = true;
    const anchor = anchors[anchors.length - 1];
    if (anchor && anchor.text.length < VISIBLE_LINK_TEXT_MAX) anchor.text += piece;
  };
  /** Running text: a run of the blanks HTML folds — blank, tab, line break — is
   * one blank, and none opens a line or follows another. Other spaces are
   * characters of the text (the wide one of a Japanese mail) and stay. */
  const addText = (text: string): void => {
    let folded = text.replace(/[ \t\n\f\r]+/g, " ");
    if (folded.startsWith(" ") && (line === "" || lineEndsBlank)) folded = folded.slice(1);
    append(plainBlanks(folded));
  };
  /** Text whose blanks and line breaks stand as written. */
  const addKept = (text: string): void => {
    const rows = text.replace(/\r\n?/g, "\n").split("\n");
    for (let index = 0; index < rows.length; index++) {
      if (index > 0) endLine(true);
      append(plainBlanks(rows[index]));
    }
  };

  const open = (name: string, node: N): void => {
    if (name === "blockquote") {
      paragraph();
      quote++;
    } else if (name === "ul" || name === "ol") {
      if (lists.length > 0) endLine();
      else paragraph();
      const start = parseInt(reader.attribute(node, "start") ?? "1", 10);
      lists.push(name === "ol" ? (start > 0 ? start : 1) : 0);
    } else if (name === "li") {
      endLine();
      const numbered = lists.length > 0 && lists[lists.length - 1] > 0;
      marker = numbered ? `${lists[lists.length - 1]++}. ` : "- ";
    } else if (name === "td" || name === "th") {
      addText(" ");
    } else if (PARAGRAPH.has(name)) {
      paragraph();
    } else if (LINE.has(name)) {
      endLine();
    }
  };
  const close = (name: string): void => {
    if (name === "blockquote") {
      endLine();
      quote = Math.max(0, quote - 1);
      emptyLine();
    } else if (name === "ul" || name === "ol") {
      lists.pop();
      if (lists.length > 0) endLine();
      else paragraph();
    } else if (name === "li") {
      endLine();
      marker = "";
    } else if (PARAGRAPH.has(name)) {
      paragraph();
    } else if (LINE.has(name)) {
      endLine();
    }
  };

  /** The colours an element sets for its content, over what it stands on. */
  const coloured = (name: string, node: N, declared: Map<string, string>, before: Inherited): Pick<Inherited, "colour" | "backgrounds"> => {
    if (before.colour === null) return { colour: null, backgrounds: before.backgrounds };
    let backgrounds = before.backgrounds;
    const fill = readColour(declared.get("background-color") ?? "") ?? readAttributeColour(reader.attribute(node, "bgcolor") ?? "") ?? (name === "mark" ? MARK.background : null);
    if (fill && fill[3] > 0) backgrounds = paint([fill], backgrounds);
    const image = declared.get("background-image");
    if (image) {
      const stops = backgroundImageColours(image);
      if (stops.length > 0) backgrounds = paint(stops, backgrounds);
    }
    const own =
      readColour(declared.get("color") ?? "") ??
      (name === "font" ? readAttributeColour(reader.attribute(node, "color") ?? "") : null) ??
      (name === "a" ? LINK_COLOUR : name === "mark" ? MARK.text : null);
    return { colour: own ?? before.colour, backgrounds };
  };

  /** Nodes still to be read, and elements whose content has been. */
  const stack: Array<N | Closing> = [];
  const push = (nodes: ArrayLike<N> | undefined): void => {
    if (nodes) for (let index = nodes.length - 1; index >= 0; index--) stack.push(nodes[index]);
  };
  judge();
  push(reader.children(root));
  while (stack.length > 0) {
    if (options.untilShown && (worded || picture)) break;
    const step = stack.pop()!;
    if (step instanceof Closing) {
      if (step.name === "a") {
        const anchor = anchors.pop();
        const text = anchor ? anchor.text.replace(/\s+/g, " ").trim() : "";
        if (anchor && anchor.href && (anchor.shows || !isBlank(text)) && links.length < VISIBLE_LINKS_MAX) {
          links.push({ text: text.slice(0, VISIBLE_LINK_TEXT_MAX), href: anchor.href });
        }
      }
      close(step.name);
      state = step.before;
      judge();
      continue;
    }
    const name = reader.kind(step);
    if (name === "#text") {
      if (hidden) continue;
      if (state.pre > 0) addKept(reader.text(step));
      else addText(reader.text(step));
      continue;
    }
    if (name === "") continue;
    const declared = inlineStyle(reader, step);
    const font = elementFont(name, (attr) => reader.attribute(step, attr), declared.get("font-size"), state.font);
    const px = font.px;
    if (NOT_SHOWN.has(name) || takenOffScreen(reader, name, step, declared, px)) continue;
    if (name === "br") {
      endLine(true);
      continue;
    }
    const ownOpacity = readOpacity(declared.get("opacity") ?? "1") ?? 1;
    const visibility = declared.get("visibility");
    const unseen = visibility === "hidden" || visibility === "collapse" ? true : visibility === "visible" ? false : state.unseen;
    if (name === "img") {
      const anchor = anchors[anchors.length - 1];
      if (!unseen && imageShows(reader, step, declared, state.opacity * ownOpacity < MIN_OPACITY, state.font.px < MIN_TEXT_PX, px)) {
        picture = true;
        if (anchor) anchor.shows = true;
      } else if (!unseen && reader.heldBack?.(step) && state.opacity * ownOpacity >= MIN_OPACITY) {
        // A picture held back is a place in the body the reader offers to load:
        // something it shows — but nothing a link can be seen by.
        picture = true;
      }
    }
    stack.push(new Closing(name, state));
    const space = declared.get("white-space");
    const pre = name === "pre" || (space !== undefined && KEEPS_LINES.has(space)) ? state.pre + 1 : space === "normal" ? 0 : state.pre;
    state = { font, opacity: state.opacity * ownOpacity, unseen, pre, ...coloured(name, step, declared, state) };
    judge();
    open(name, step);
    if (name === "a") {
      const href = reader.attribute(step, "href")?.trim() ?? "";
      anchors.push({ href, text: "", shows: false });
    }
    if (name === "details" && reader.attribute(step, "open") === null) {
      // Closed, a details shows its summary and nothing else, as the reader
      // first shows it (Sammelplan § 3.84): what is folded away is not what
      // somebody read and quotes.
      const children = reader.children(step);
      let summary: N | undefined;
      if (children) for (let index = 0; index < children.length && !summary; index++) if (reader.kind(children[index]) === "summary") summary = children[index];
      if (summary) stack.push(summary);
    } else push(reader.children(step));
  }
  if (options.untilShown) return { text: "", links: [], shows: worded || picture };
  endLine();

  while (lines.length > 0 && lines[lines.length - 1].text === "") lines.pop();
  const text = lines
    .map(({ depth, text }) => {
      const marks = "> ".repeat(Math.min(depth, QUOTE_LEVELS));
      return text ? marks + text : marks.trimEnd();
    })
    .join("\n");
  return { text, links, shows: text.trim() !== "" || picture };
}
