import { parseFragment } from "parse5";
import { mailStyleDeclarations, namedFontSize, PX_PER_UNIT, readLength, readOpacity } from "./mailStyle.js";

/**
 * What the walk reads of a node: the shape of parse5's tree. A caller with a
 * parser of its own hands in a tree of plain objects of this shape (see
 * `htmlToVisibleText`) — never the nodes of a live DOM. What a DOM node answers
 * to a property name is partly up to the markup it was made from: a form
 * answers `form.childNodes` with its control of that name (finding 2026-10-12).
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

function attributeOf(node: MarkupNode, name: string): string | null {
  return node.attrs?.find(attr => attr.name === name)?.value ?? null;
}

function textOf(node: MarkupNode): string {
  return typeof node.value === "string" ? node.value : "";
}

/**
 * The properties of a style the walk judges — what can take words off the
 * screen. The sanitizer keeps no other property that could (`MAIL_STYLE` in
 * `mailStyle.ts`; `mailStyleCoupling.test.ts` holds the two lists together).
 */
export const JUDGED_BY_THE_WALK = ["display", "visibility", "opacity", "font-size", "white-space"] as const;

/** The reader's text size (its frame's body) and the root size `rem` is measured by. */
const READER_PX = 14;
const ROOT_PX = 16;
/** Below this size in pixels a text is not one a person reads; below this opacity, not one a person sees. */
export const MIN_TEXT_PX = 4;
export const MIN_OPACITY = 0.1;

/**
 * The size in pixels a declared font size gives, from the parent's: absolute
 * lengths and the named sizes stand on their own, `em` and `%` are measured
 * against the parent (of a parent of no size, nothing), `rem` against the root.
 */
function fontPx(value: string, parent: number): number {
  const named = namedFontSize(value);
  if (named !== null) return named;
  if (value === "larger") return parent * 1.2;
  if (value === "smaller") return parent / 1.2;
  const length = readLength(value);
  if (!length) return parent;
  if (length.unit in PX_PER_UNIT) return length.amount * PX_PER_UNIT[length.unit];
  switch (length.unit) {
    case "em":
      return length.amount * parent;
    case "rem":
      return length.amount * ROOT_PX;
    case "%":
      return (length.amount / 100) * parent;
    default:
      return parent;
  }
}

/**
 * The declarations of an element's own `style` that the mail sanitizer keeps
 * (`mailStyleDeclarations`), read the way a browser resolves them: a later one
 * replaces an earlier one unless the earlier is `!important` and the later is
 * not. A style that names a `url(` is one the sanitizer removes whole: the
 * element then stands there unstyled, so it is read as having none.
 */
function inlineStyle(node: MarkupNode): Map<string, string> {
  const declared = new Map<string, string>();
  const written = attributeOf(node, "style") ?? "";
  if (!written || /url\s*\(/i.test(written)) return declared;
  const weighty = new Set<string>();
  for (const { name, value, important } of mailStyleDeclarations(written)) {
    if (weighty.has(name) && !important) continue;
    declared.set(name, value);
    if (important) weighty.add(name);
  }
  return declared;
}

/**
 * Whether the element is off the screen with everything inside it, whatever
 * that may declare for itself: `display: none` — the `hidden` attribute is
 * that, and so is a dialog nobody opened or a popover, unless the element's
 * own style gives another display; of a closed `details` the walk reads the
 * summary only. A font too small to read, a text too faint to see and
 * `visibility: hidden` are carried along the walk instead, see below: a child
 * can set the first and the last again, and layouts do (a table cell of size 0
 * around a column of size 13).
 *
 * A style sheet is not consulted (the mail reader drops `<style>` altogether),
 * nor are colours; positions, transforms, clipping and overflow never reach
 * the reader (`MAIL_STYLE`).
 */
function takenOffScreen(name: string, node: MarkupNode, declared: Map<string, string>): boolean {
  const display = declared.get("display");
  // A popover is shown only on request, like a dialog nobody opened (§ 3.84).
  const hiddenAsItStands = attributeOf(node, "hidden") !== null || attributeOf(node, "popover") !== null || (name === "dialog" && attributeOf(node, "open") === null);
  return display === undefined ? hiddenAsItStands : display === "none";
}

/** Whether an image shows: it has something to show and is not drawn at a size of nothing. */
function imageShows(node: MarkupNode, declared: Map<string, string>, faint: boolean, small: boolean): boolean {
  if (faint) return false;
  const src = attributeOf(node, "src")?.trim() ?? "";
  const alt = attributeOf(node, "alt")?.trim() ?? "";
  if (!src && (alt === "" || small)) return false;
  for (const side of ["width", "height"]) {
    const attribute = attributeOf(node, side);
    if (attribute !== null && /^[01](?:\.0*)?(?:px)?$/i.test(attribute.trim())) return false;
    const length = readLength(declared.get(side) ?? "");
    if (length && length.unit in PX_PER_UNIT && length.amount * PX_PER_UNIT[length.unit] <= 1) return false;
    if (length && length.amount === 0) return false;
  }
  return true;
}

interface Line {
  /** How many quotes deep the line stands. */
  depth: number;
  /** Empty for the empty line between two paragraphs. */
  text: string;
}

/** On the walk's stack: an element whose content has been read, with what
 * stood before it of the things an element hands down to its content. A class
 * of its own, so that no node of anybody's tree can be mistaken for one. */
class Closing {
  readonly name: string;
  readonly px: number;
  readonly opacity: number;
  readonly unseen: boolean;
  readonly pre: number;
  constructor(name: string, px: number, opacity: number, unseen: boolean, pre: number) {
    this.name = name;
    this.px = px;
    this.opacity = opacity;
    this.unseen = unseen;
    this.pre = pre;
  }
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
 * browser's own parser stops nesting at a depth a page can have: a caller that
 * runs in a browser hands in a copy of the tree that parser made
 * (`mailMessageText` does) — a copy in plain objects, see `MarkupNode`.
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

/**
 * The text of an HTML body as `htmlToVisibleText` reads it, together with the
 * links that stand on screen in it, in their order: an `<a href>` whose element
 * is shown and that shows something — a visible word or an image. A link the
 * markup hides, or one inside what is hidden, is not one the reader can see or
 * follow, and is not in the list (finding 2026-11-16: the assistant read a
 * mail's text and links on a way of its own, from the raw markup).
 */
export function htmlToVisibleDocument(html: string, parse: (html: string) => MarkupNode = markup => parseFragment(markup)): VisibleDocument {
  const links: VisibleLink[] = [];
  /** The links being read, innermost last, each with whether it shows anything yet. */
  const anchors: Array<{ href: string; text: string; shows: boolean }> = [];
  const lines: Line[] = [];
  let line = "";
  /** Whether `line` ends in a blank. Kept beside it: asking the line itself
   * flattens a string that is still growing, once per text — on one long line
   * that is the square of its length (finding 2026-10-12). */
  let lineEndsBlank = false;
  let marker = "";
  let quote = 0;
  /** Handed down from an element to its content: the font size in pixels and
   * the opacity (an element's multiplies its parent's), whether it is
   * `visibility: hidden` (until one inside says otherwise). */
  let px = READER_PX;
  let opacity = 1;
  let unseen = false;
  /** Whether an image the reader shows stands anywhere in the body. */
  let picture = false;
  const hidden = (): boolean => unseen || px < MIN_TEXT_PX || opacity < MIN_OPACITY;
  let pre = 0;
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

  const open = (name: string, node: MarkupNode): void => {
    if (name === "blockquote") {
      paragraph();
      quote++;
    } else if (name === "ul" || name === "ol") {
      if (lists.length > 0) endLine();
      else paragraph();
      const start = parseInt(attributeOf(node, "start") ?? "1", 10);
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

  /** Nodes still to be read, and elements whose content has been. The root is
   * a container, whatever it is — its own attributes are not the message's. */
  const stack: Array<MarkupNode | Closing> = [];
  const push = (nodes: ArrayLike<MarkupNode> | undefined): void => {
    if (nodes) for (let index = nodes.length - 1; index >= 0; index--) stack.push(nodes[index]);
  };
  push(parse(html).childNodes);
  while (stack.length > 0) {
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
      px = step.px;
      opacity = step.opacity;
      unseen = step.unseen;
      pre = step.pre;
      continue;
    }
    if (step.nodeName === "#text") {
      if (hidden()) continue;
      if (pre > 0) addKept(textOf(step));
      else addText(textOf(step));
      continue;
    }
    const name = elementName(step);
    if (name === "") continue;
    const declared = inlineStyle(step);
    if (NOT_SHOWN.has(name) || takenOffScreen(name, step, declared)) continue;
    if (name === "br") {
      endLine(true);
      continue;
    }
    if (name === "img") {
      const anchor = anchors[anchors.length - 1];
      const ownOpacity = readOpacity(declared.get("opacity") ?? "1") ?? 1;
      const ownUnseen = declared.get("visibility") === "hidden" || declared.get("visibility") === "collapse" ? true : declared.get("visibility") === "visible" ? false : unseen;
      if (!ownUnseen && imageShows(step, declared, opacity * ownOpacity < MIN_OPACITY, px < MIN_TEXT_PX)) {
        picture = true;
        if (anchor) anchor.shows = true;
      }
    }
    stack.push(new Closing(name, px, opacity, unseen, pre));
    const size = declared.get("font-size");
    if (size !== undefined && size !== "inherit" && size !== "unset") px = fontPx(size, px);
    opacity *= readOpacity(declared.get("opacity") ?? "1") ?? 1;
    const visibility = declared.get("visibility");
    if (visibility === "hidden" || visibility === "collapse") unseen = true;
    else if (visibility === "visible") unseen = false;
    open(name, step);
    if (name === "a") {
      const href = attributeOf(step, "href")?.trim() ?? "";
      anchors.push({ href, text: "", shows: false });
    }
    const space = declared.get("white-space");
    if (name === "pre" || (space !== undefined && KEEPS_LINES.has(space))) pre++;
    else if (space === "normal" || space === "nowrap") pre = 0;
    if (name === "details" && attributeOf(step, "open") === null) {
      // Closed, a details shows its summary and nothing else, as the reader
      // first shows it (Sammelplan § 3.84): what is folded away is not what
      // somebody read and quotes.
      const summary = Array.from(step.childNodes ?? []).find(child => elementName(child) === "summary");
      if (summary) stack.push(summary);
    } else push(step.childNodes);
  }
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
