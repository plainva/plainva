import { parseFragment } from "parse5";

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

/** A CSS length of nothing, or of a single pixel or point at most. */
function noSize(value: string): boolean {
  const amount = parseFloat(value);
  if (Number.isNaN(amount) || amount < 0) return false;
  if (amount === 0) return true;
  const unit = value.replace(/^[+\d.]+/, "").trim();
  return amount <= 1 && (unit === "px" || unit === "pt");
}

/** Font sizes that say "as the parent's". */
const SIZE_OF_PARENT = new Set(["inherit", "unset", "revert", "revert-layer", "larger", "smaller"]);

/**
 * Whether a font size leaves nothing to read — `undefined` where the parent's
 * answer stands: the size is measured against the parent's, or the value is a
 * number without a unit, which is no font size and so no declaration at all.
 */
function unreadableSize(value: string): boolean | undefined {
  const amount = parseFloat(value);
  if (amount === 0) return true;
  const relative = SIZE_OF_PARENT.has(value) || value.endsWith("%") || (value.endsWith("em") && !value.endsWith("rem"));
  const unitless = !Number.isNaN(amount) && /^[+\d.]+$/.test(value);
  return relative || unitless ? undefined : noSize(value);
}

/**
 * The declarations of an element's own `style`, in lower case. As in a
 * browser, a later one replaces an earlier one unless the earlier is
 * `!important` and the later is not. Plain declarations only — this is not a
 * style engine. A style that names a `url(` is one the mail reader removes
 * whole (`sanitizeEmailHtml`): the element then stands there unstyled, so it is
 * read as having none.
 */
function inlineStyle(node: MarkupNode): Map<string, string> {
  const declared = new Map<string, string>();
  const style = attributeOf(node, "style") ?? "";
  if (!style || /url\s*\(/i.test(style)) return declared;
  const weighty = new Set<string>();
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    let value = declaration.slice(colon + 1).trim().toLowerCase();
    const bang = value.lastIndexOf("!");
    const important = bang >= 0 && value.slice(bang + 1).trim() === "important";
    if (important) value = value.slice(0, bang).trimEnd();
    if (weighty.has(name) && !important) continue;
    declared.set(name, value);
    if (important) weighty.add(name);
  }
  return declared;
}

/**
 * Whether the element is off the screen with everything inside it, whatever
 * that may declare for itself: `display: none` (the `hidden` attribute is that,
 * and so is a dialog nobody opened — unless the element's own style gives
 * another display), `opacity: 0`, or a box of no size that clips what
 * overflows. That is how a sender hides a preview line or a tracking text from
 * the reader, and what is hidden from the reader is not part of what the
 * reader can quote.
 *
 * A font of no size and `visibility: hidden` hide text, too — but a child can
 * set both again, and layouts do (a table cell of size 0 around a column of
 * size 13): those two are carried along the walk instead, see below.
 *
 * A style sheet is not consulted (the mail reader drops `<style>` altogether),
 * nor are colours or positions.
 */
function takenOffScreen(name: string, node: MarkupNode, declared: Map<string, string>): boolean {
  const display = declared.get("display");
  const hiddenAsItStands = attributeOf(node, "hidden") !== null || (name === "dialog" && attributeOf(node, "open") === null);
  if (display === undefined ? hiddenAsItStands : display === "none") return true;
  if (parseFloat(declared.get("opacity") ?? "1") === 0) return true;
  const clips = ["overflow", "overflow-x", "overflow-y"].some(name => declared.get(name) === "hidden" || declared.get(name) === "clip");
  return clips && ["height", "max-height", "width", "max-width"].some(name => noSize(declared.get(name) ?? ""));
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
  readonly tiny: boolean;
  readonly unseen: boolean;
  readonly pre: number;
  constructor(name: string, tiny: boolean, unseen: boolean, pre: number) {
    this.name = name;
    this.tiny = tiny;
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
  const lines: Line[] = [];
  let line = "";
  /** Whether `line` ends in a blank. Kept beside it: asking the line itself
   * flattens a string that is still growing, once per text — on one long line
   * that is the square of its length (finding 2026-10-12). */
  let lineEndsBlank = false;
  let marker = "";
  let quote = 0;
  /** Handed down from an element to its content, until one inside says otherwise. */
  let tiny = false;
  let unseen = false;
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
      close(step.name);
      tiny = step.tiny;
      unseen = step.unseen;
      pre = step.pre;
      continue;
    }
    if (step.nodeName === "#text") {
      if (tiny || unseen) continue;
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
    stack.push(new Closing(name, tiny, unseen, pre));
    const size = declared.get("font-size");
    if (size !== undefined) tiny = unreadableSize(size) ?? tiny;
    const visibility = declared.get("visibility");
    if (visibility === "hidden" || visibility === "collapse") unseen = true;
    else if (visibility === "visible") unseen = false;
    open(name, step);
    const space = declared.get("white-space");
    if (name === "pre" || (space !== undefined && KEEPS_LINES.has(space))) pre++;
    else if (space === "normal" || space === "nowrap") pre = 0;
    push(step.childNodes);
  }
  endLine();

  while (lines.length > 0 && lines[lines.length - 1].text === "") lines.pop();
  return lines
    .map(({ depth, text }) => {
      const marks = "> ".repeat(Math.min(depth, QUOTE_LEVELS));
      return text ? marks + text : marks.trimEnd();
    })
    .join("\n");
}
