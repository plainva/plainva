/**
 * The inline styles a mail may keep — ONE list for the mail reader's sanitizer
 * and for the walk that reads what the reader shows (`htmlVisibleText.ts`).
 *
 * The walk is a model of what a browser shows, and the reader is a browser:
 * whatever the browser can do with a style that the model does not judge is a
 * place to hide words that only the assistant would find (review of
 * 2026-11-16: `font:0/0 a`, `display:n\one`, `opacity:calc(0)`, a box moved
 * 9999 px to the left, `transform:scale(0)`, `clip-path`, `content-visibility`
 * …). Naming those one by one never ends. So the sanitizer keeps a
 * declaration only where this list knows its property AND reads its value, and
 * writes the style anew from what it kept; everything else falls away and the
 * reader shows the element unstyled in that respect. The walk reads the same
 * declarations with the same parser, so what it judges is exactly what the
 * browser is given.
 *
 * Each property is one of three kinds:
 *  - `judged`: it can take words off the screen, and the walk judges it
 *    (`JUDGED_BY_THE_WALK` there; a test holds the two lists together);
 *  - `layout`: with the values allowed here it moves or shapes text but cannot
 *    take it off the screen — no negative lengths, no positions, no clipping
 *    (overflow is not kept at all), lengths capped;
 *  - `contrast`: a colour. Text in the colour of its background is the one
 *    limit that stays named: the walk does not compare colours, so words
 *    written white on white are read by the assistant as the reader shows
 *    them, unseen. A transparent text colour is not kept.
 */

export type MailStyleKind = "judged" | "layout" | "contrast";

interface PropertyRule {
  kind: MailStyleKind;
  /** The value, in lower case and split at blanks, as the property may keep it. */
  accepts: (tokens: string[], value: string) => boolean;
}

/** A length: a non-negative amount in a unit this list reads, with a cap per unit. */
const LENGTH = /^(\d+(?:\.\d+)?|\.\d+)(px|pt|pc|cm|mm|in|em|rem|ex|ch|%)?$/;
/** The largest amount kept per unit — about 2000 px each: no box is pushed far off the page. */
const LENGTH_CAP: Record<string, number> = { px: 2000, pt: 1500, pc: 125, cm: 53, mm: 530, in: 21, em: 100, rem: 100, ex: 200, ch: 200, "%": 500 };
/** Pixels per unit, for the absolute units (CSS: 96 px to the inch). */
export const PX_PER_UNIT: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, cm: 96 / 2.54, mm: 96 / 25.4, in: 96 };

export function readLength(token: string): { amount: number; unit: string } | null {
  const m = LENGTH.exec(token);
  if (!m) return null;
  const amount = parseFloat(m[1]);
  const unit = m[2] ?? "";
  if (unit === "") return amount === 0 ? { amount, unit: "px" } : null;
  if (amount > LENGTH_CAP[unit]) return null;
  return { amount, unit };
}

const isLength = (token: string): boolean => readLength(token) !== null;
/**
 * A font size the walk can work out: `ex` and `ch` hang on the letters of a
 * typeface the walk does not know (Gmail sets margins in them, never a size),
 * so a size in them is not kept.
 */
const isFontLength = (token: string): boolean => {
  const length = readLength(token);
  return length !== null && length.unit !== "ex" && length.unit !== "ch";
};
const oneOf = (...words: string[]) => {
  const set = new Set(words);
  return (tokens: string[]) => tokens.length === 1 && set.has(tokens[0]);
};
const lengthOr = (...words: string[]) => {
  const set = new Set(words);
  return (tokens: string[]) => tokens.length === 1 && (set.has(tokens[0]) || isLength(tokens[0]));
};
/** One to four lengths (or the words given), as margin and padding take them. */
const boxSides = (...words: string[]) => {
  const set = new Set(words);
  return (tokens: string[]) => tokens.length >= 1 && tokens.length <= 4 && tokens.every((t) => set.has(t) || isLength(t));
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;
const HEX_ALPHA = /^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/;
const NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)%?$/;
/** A colour function and what stands between its brackets. */
const COLOUR_FUNCTION = /^([a-z]+)\(([^()]*)\)$/;

/**
 * The numbers of `rgb(…)`/`hsl(…)` (three) or `rgba(…)`/`hsla(…)` (four), with
 * commas or blanks between and a hue in `deg`; false for anything else.
 */
function colourArguments(token: string, names: readonly string[], count: number): boolean {
  const fn = COLOUR_FUNCTION.exec(token);
  if (!fn || !names.includes(fn[1])) return false;
  const args = fn[2].split(/[\s,]+/).filter(Boolean);
  if (args.length !== count) return false;
  args[0] = args[0].replace(/deg$/, "");
  return args.every((n) => NUMBER.test(n));
}
const NAMED = /^[a-z]{3,20}$/;

/** A colour that paints: no alpha, never `transparent`. */
function opaqueColour(token: string): boolean {
  if (HEX.test(token)) return true;
  if (colourArguments(token, ["rgb", "hsl"], 3)) return true;
  return NAMED.test(token) && token !== "transparent";
}

/** Any colour a background may have. */
function anyColour(token: string): boolean {
  if (opaqueColour(token) || HEX_ALPHA.test(token) || token === "transparent") return true;
  return colourArguments(token, ["rgba", "hsla"], 4);
}

const BORDER_STYLE = new Set(["none", "hidden", "solid", "dotted", "dashed", "double", "groove", "ridge", "inset", "outset"]);
const BORDER_WIDTH = new Set(["thin", "medium", "thick"]);
const borderPart = (t: string) => BORDER_STYLE.has(t) || BORDER_WIDTH.has(t) || isLength(t) || anyColour(t);
const border = (tokens: string[]) => tokens.length >= 1 && tokens.length <= 3 && tokens.every(borderPart);

const FONT_NAME = /^[a-z0-9 ,'"_-]+$/i;
/** A family list whose quotes all close: nothing in it can run into the next declaration. */
function fontFamily(_tokens: string[], value: string): boolean {
  if (!FONT_NAME.test(value)) return false;
  return (value.match(/"/g) ?? []).length % 2 === 0 && (value.match(/'/g) ?? []).length % 2 === 0;
}

/** Display values that show their content. `table-column` and its group never do. */
const DISPLAY = oneOf(
  "none", "block", "inline", "inline-block", "flow-root", "list-item", "contents",
  "table", "inline-table", "table-row", "table-cell", "table-row-group", "table-header-group", "table-footer-group", "table-caption",
  "flex", "inline-flex", "grid", "inline-grid",
);

/** Opacity as a number from 0 to 1 or a percentage up to 100. */
export function readOpacity(token: string): number | null {
  const m = /^(\d+(?:\.\d+)?|\.\d+)(%?)$/.exec(token);
  if (!m) return null;
  const amount = parseFloat(m[1]) / (m[2] ? 100 : 1);
  return amount <= 1 ? amount : null;
}

/** Font sizes named by a word, in pixels at the reader's default. */
export const NAMED_FONT_SIZE: Record<string, number> = {
  "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32, "xxx-large": 48, initial: 16,
};
const FONT_SIZE_WORDS = ["larger", "smaller", "inherit", "unset"];
/** A named font size, read off the table itself — never off what every object inherits. */
export function namedFontSize(word: string): number | null {
  return Object.prototype.hasOwnProperty.call(NAMED_FONT_SIZE, word) ? NAMED_FONT_SIZE[word] : null;
}

const LAYOUT_SIZE = lengthOr("auto", "none");

export const MAIL_STYLE: Readonly<Record<string, PropertyRule>> = {
  // What can take words off the screen — the walk judges each of these.
  display: { kind: "judged", accepts: DISPLAY },
  visibility: { kind: "judged", accepts: oneOf("visible", "hidden", "collapse") },
  opacity: { kind: "judged", accepts: (t) => t.length === 1 && readOpacity(t[0]) !== null },
  "font-size": { kind: "judged", accepts: (t) => t.length === 1 && (namedFontSize(t[0]) !== null || FONT_SIZE_WORDS.includes(t[0]) || isFontLength(t[0])) },
  "white-space": { kind: "judged", accepts: oneOf("normal", "nowrap", "pre", "pre-wrap", "pre-line", "break-spaces") },

  // Colours: the named limit.
  color: { kind: "contrast", accepts: (t) => t.length === 1 && opaqueColour(t[0]) },
  "background-color": { kind: "contrast", accepts: (t) => t.length === 1 && anyColour(t[0]) },
  background: { kind: "contrast", accepts: (t) => t.length === 1 && anyColour(t[0]) },

  // Type and lines.
  "font-family": { kind: "layout", accepts: fontFamily },
  "font-weight": { kind: "layout", accepts: oneOf("normal", "bold", "bolder", "lighter", "100", "200", "300", "400", "500", "600", "700", "800", "900") },
  "font-style": { kind: "layout", accepts: oneOf("normal", "italic", "oblique") },
  "line-height": {
    kind: "layout",
    accepts: (t) => {
      if (t.length !== 1) return false;
      if (t[0] === "normal") return true;
      // Lines laid on top of each other are no way to read them either.
      if (/^(\d+(?:\.\d+)?|\.\d+)$/.test(t[0])) return parseFloat(t[0]) >= 0.5 && parseFloat(t[0]) <= 10;
      const length = readLength(t[0]);
      if (!length) return false;
      if (length.unit in PX_PER_UNIT) return length.amount * PX_PER_UNIT[length.unit] >= 4;
      if (length.unit === "%") return length.amount >= 50;
      // An ex or a ch is about half a letter's height.
      return length.unit === "ex" || length.unit === "ch" ? length.amount >= 1 : length.amount >= 0.5;
    },
  },
  "text-align": { kind: "layout", accepts: oneOf("left", "right", "center", "justify", "start", "end") },
  "vertical-align": { kind: "layout", accepts: oneOf("baseline", "top", "middle", "bottom", "text-top", "text-bottom", "sub", "super") },
  "text-decoration": { kind: "layout", accepts: (t) => t.length >= 1 && t.every((w) => ["none", "underline", "overline", "line-through"].includes(w)) },
  "text-decoration-line": { kind: "layout", accepts: (t) => t.length >= 1 && t.every((w) => ["none", "underline", "overline", "line-through"].includes(w)) },
  "text-transform": { kind: "layout", accepts: oneOf("none", "uppercase", "lowercase", "capitalize") },
  // Headings are often set a little tight; no further than letters touching.
  "letter-spacing": {
    kind: "layout",
    accepts: (t) => {
      if (t.length !== 1) return false;
      if (t[0] === "normal" || isLength(t[0])) return true;
      const tight = t[0].startsWith("-") ? readLength(t[0].slice(1)) : null;
      if (!tight) return false;
      return tight.unit === "em" || tight.unit === "rem" ? tight.amount <= 0.1 : tight.unit === "px" ? tight.amount <= 2 : tight.unit === "pt" ? tight.amount <= 1.5 : false;
    },
  },
  "word-spacing": { kind: "layout", accepts: lengthOr("normal") },
  "text-indent": { kind: "layout", accepts: lengthOr() },
  "word-break": { kind: "layout", accepts: oneOf("normal", "break-all", "keep-all", "break-word") },
  "overflow-wrap": { kind: "layout", accepts: oneOf("normal", "break-word", "anywhere") },
  "word-wrap": { kind: "layout", accepts: oneOf("normal", "break-word", "anywhere") },
  direction: { kind: "layout", accepts: oneOf("ltr", "rtl") },

  // Boxes: sizes, spacing and borders, never negative.
  width: { kind: "layout", accepts: LAYOUT_SIZE },
  "min-width": { kind: "layout", accepts: LAYOUT_SIZE },
  "max-width": { kind: "layout", accepts: LAYOUT_SIZE },
  height: { kind: "layout", accepts: LAYOUT_SIZE },
  "min-height": { kind: "layout", accepts: LAYOUT_SIZE },
  "max-height": { kind: "layout", accepts: LAYOUT_SIZE },
  margin: { kind: "layout", accepts: boxSides("auto") },
  "margin-top": { kind: "layout", accepts: lengthOr("auto") },
  "margin-right": { kind: "layout", accepts: lengthOr("auto") },
  "margin-bottom": { kind: "layout", accepts: lengthOr("auto") },
  "margin-left": { kind: "layout", accepts: lengthOr("auto") },
  padding: { kind: "layout", accepts: boxSides() },
  "padding-top": { kind: "layout", accepts: lengthOr() },
  "padding-right": { kind: "layout", accepts: lengthOr() },
  "padding-bottom": { kind: "layout", accepts: lengthOr() },
  "padding-left": { kind: "layout", accepts: lengthOr() },
  border: { kind: "layout", accepts: border },
  "border-top": { kind: "layout", accepts: border },
  "border-right": { kind: "layout", accepts: border },
  "border-bottom": { kind: "layout", accepts: border },
  "border-left": { kind: "layout", accepts: border },
  "border-width": { kind: "layout", accepts: (t) => t.length >= 1 && t.length <= 4 && t.every((w) => BORDER_WIDTH.has(w) || isLength(w)) },
  "border-style": { kind: "layout", accepts: (t) => t.length >= 1 && t.length <= 4 && t.every((w) => BORDER_STYLE.has(w)) },
  "border-color": { kind: "layout", accepts: (t) => t.length >= 1 && t.length <= 4 && t.every(anyColour) },
  "border-radius": { kind: "layout", accepts: boxSides() },
  "border-collapse": { kind: "layout", accepts: oneOf("collapse", "separate") },
  "border-spacing": { kind: "layout", accepts: (t) => t.length >= 1 && t.length <= 2 && t.every(isLength) },
  "table-layout": { kind: "layout", accepts: oneOf("auto", "fixed") },
  "box-sizing": { kind: "layout", accepts: oneOf("content-box", "border-box") },
  float: { kind: "layout", accepts: oneOf("left", "right", "none") },
  clear: { kind: "layout", accepts: oneOf("left", "right", "both", "none") },
  "list-style-type": { kind: "layout", accepts: (t) => t.length === 1 && /^[a-z-]{1,24}$/.test(t[0]) },
  "list-style": { kind: "layout", accepts: (t) => t.length >= 1 && t.length <= 2 && t.every((w) => /^[a-z-]{1,24}$/.test(w)) },
};

/** One kept declaration: its property, its value as it is written out, and whether it is `!important`. */
export interface MailDeclaration {
  name: string;
  value: string;
  important: boolean;
}

/** The words of a value: split at blanks, except inside a function's brackets. */
function splitTokens(value: string): string[] {
  const tokens: string[] = [];
  let word = "";
  let depth = 0;
  for (const c of value) {
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /\s/.test(c)) {
      if (word) tokens.push(word);
      word = "";
    } else word += c;
  }
  if (word) tokens.push(word);
  return tokens;
}

/**
 * The declarations of a `style` attribute that the list keeps, in their order.
 * A comment is nothing to a browser, so it is nothing here (a comment between
 * `display:` and `none` still says `display: none`); a declaration
 * with a backslash — an escape, which the browser reads and this does not — is
 * not kept, nor one whose property or value the list does not know.
 */
export function mailStyleDeclarations(style: string): MailDeclaration[] {
  const kept: MailDeclaration[] = [];
  const text = style.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, " ");
  for (const declaration of text.split(";")) {
    if (declaration.includes("\\")) continue;
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const rule = Object.prototype.hasOwnProperty.call(MAIL_STYLE, name) ? MAIL_STYLE[name] : undefined;
    if (!rule) continue;
    let value = declaration.slice(colon + 1).trim();
    const bang = value.lastIndexOf("!");
    const important = bang >= 0 && value.slice(bang + 1).trim().toLowerCase() === "important";
    if (important) value = value.slice(0, bang).trim();
    if (bang >= 0 && !important) continue;
    const lower = value.toLowerCase();
    // Blanks inside a function are part of its one token.
    const tokens = splitTokens(lower);
    if (tokens.length === 0 || !rule.accepts(tokens, value)) continue;
    kept.push({ name, value: name === "font-family" ? value.replace(/\s+/g, " ") : tokens.join(" "), important });
  }
  return kept;
}

/** The `style` attribute the reader is given: the kept declarations written anew, "" for none. */
export function keptMailStyle(style: string): string {
  return mailStyleDeclarations(style)
    .map((d) => `${d.name}:${d.value}${d.important ? " !important" : ""}`)
    .join(";");
}
