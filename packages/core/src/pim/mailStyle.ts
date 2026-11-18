import { readColour, type Rgba } from "./mailColour.js";

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
 * writes the style anew from what it kept; everything else falls away. The
 * walk reads the same declarations with the same parser, so what it judges is
 * exactly what the browser is given.
 *
 * What a newsletter lays out with is READ here, not dropped (review of
 * 2026-11-17: a reader that drops what it cannot judge makes ordinary mails
 * unreadable — light text on a dark cell lost its alpha colour, white text lost
 * the gradient behind it, a column lost its font size to a `font` shorthand or
 * a `calc()`). The shorthands `font` and `background` are written out as the
 * longhands they set; colours with alpha, gradients and sizes worked out with
 * `calc()`, `min()`, `max()` and `clamp()` are kept and judged.
 *
 * Each property is one of two kinds:
 *  - `judged`: it can take words off the screen, and the walk judges it
 *    (`JUDGED_BY_THE_WALK` there; a test holds the two lists together) —
 *    display, visibility, opacity, the font size, the text colour against
 *    the background, and overflow, which is kept only where it clips a box to
 *    nothing (`clipsToNothing` in `mailShape.ts`);
 *  - `layout`: with the values allowed here it moves or shapes text but cannot
 *    take it off the screen — no negative lengths, no positions, no
 *    transforms, lengths capped, and no box reaching past the narrowest frame
 *    (`mailShape.ts`).
 */

export type MailStyleKind = "judged" | "layout";

interface PropertyRule {
  kind: MailStyleKind;
  /** The value, in lower case and split at blanks, as the property may keep it. */
  accepts: (tokens: string[], value: string) => boolean;
  /** The value as the reader is given it, where that is not the value as written; null drops it. */
  write?: (tokens: string[]) => string | null;
}

/** A length: a non-negative amount in a unit this list reads, with a cap per unit. */
const LENGTH = /^(\d+(?:\.\d+)?|\.\d+)(px|pt|pc|cm|mm|in|em|rem|ex|ch|%)?$/;
/** The largest amount kept per unit — about 2000 px each: no box is pushed far off the page. */
const LENGTH_CAP: Record<string, number> = { px: 2000, pt: 1500, pc: 125, cm: 53, mm: 530, in: 21, em: 100, rem: 100, ex: 200, ch: 200, "%": 500 };
/** Pixels per unit, for the absolute units (CSS: 96 px to the inch). */
export const PX_PER_UNIT: Record<string, number> = { px: 1, pt: 4 / 3, pc: 16, cm: 96 / 2.54, mm: 96 / 25.4, in: 96 };
/** The root size `rem` is measured by. */
export const ROOT_PX = 16;
/** How much of a letter's size an `ex` or a `ch` is at least: it hangs on a typeface the walk does not know. */
const EX_LOW = 0.4;

export function readLength(token: string): { amount: number; unit: string } | null {
  const m = LENGTH.exec(token);
  if (!m) return null;
  const amount = parseFloat(m[1]);
  const unit = m[2] ?? "";
  if (unit === "") return amount === 0 ? { amount, unit: "px" } : null;
  if (amount > LENGTH_CAP[unit]) return null;
  return { amount, unit };
}

/**
 * A length in pixels: `em`, `ex` and `ch` from the element's font size, `%`
 * from `percentOf`. An `ex` and a `ch` count at their smallest.
 */
export function lengthPx(token: string, fontPx: number, percentOf: number): number | null {
  const length = readLength(token);
  if (!length) return null;
  if (length.unit in PX_PER_UNIT) return length.amount * PX_PER_UNIT[length.unit];
  switch (length.unit) {
    case "em":
      return length.amount * fontPx;
    case "rem":
      return length.amount * ROOT_PX;
    case "ex":
    case "ch":
      return length.amount * fontPx * EX_LOW;
    case "%":
      return (length.amount / 100) * percentOf;
    default:
      return null;
  }
}

const isLength = (token: string): boolean => readLength(token) !== null;
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
/** A length up to a cap — the spacing between letters and words never lays a word past the frame. */
const spacing = (capPx: number, capEm: number) => (tokens: string[]) => {
  if (tokens.length !== 1) return false;
  if (tokens[0] === "normal") return true;
  const length = readLength(tokens[0]);
  if (!length) return false;
  if (length.unit in PX_PER_UNIT) return length.amount * PX_PER_UNIT[length.unit] <= capPx;
  return (length.unit === "em" || length.unit === "rem" || length.unit === "ex" || length.unit === "ch") && length.amount <= capEm;
};

const anyColour = (token: string): boolean => readColour(token) !== null;
/** Values of `color` that take the colour of the letters around: `currentColor` is that colour, `unset` inherits it. */
export const INHERITED_COLOUR = new Set(["inherit", "currentcolor", "unset"]);

/** The words of the first argument of a gradient: a direction, an angle, a shape and where it stands. */
const GRADIENT = /^(?:repeating-)?(?:linear|radial)-gradient\((.*)\)$/;
const GRADIENT_WORDS = new Set([
  "to", "left", "right", "top", "bottom", "center", "at", "circle", "ellipse",
  "closest-side", "closest-corner", "farthest-side", "farthest-corner",
]);
const ANGLE = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|grad|rad|turn)$/;
const STOP_POSITION = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|%)$/;

/**
 * The colours of a gradient, or null where it is not one this list reads: a
 * `linear-`, `radial-` or `repeating-` gradient whose stops are colours this
 * list reads, with lengths, angles and the words of a direction or a shape
 * between them — nothing that fetches, nothing that refers elsewhere.
 */
export function gradientColours(token: string): Rgba[] | null {
  const m = GRADIENT.exec(token);
  if (!m) return null;
  const colours: Rgba[] = [];
  const parts = splitTopLevel(m[1], ",");
  for (let index = 0; index < parts.length; index++) {
    const words = splitTokens(parts[index].trim());
    if (words.length === 0) return null;
    const colour = readColour(words[0]);
    if (colour) {
      if (words.length > 3 || !words.slice(1).every((w) => isLength(w) || STOP_POSITION.test(w))) return null;
      colours.push(colour);
    } else if (index === 0) {
      if (!words.every((w) => GRADIENT_WORDS.has(w) || ANGLE.test(w) || isLength(w))) return null;
    } else if (!(words.length === 1 && isLength(words[0]))) return null;
  }
  return colours.length >= 1 ? colours : null;
}

/** A background image this list keeps: one to four gradients, never an address. */
function gradients(value: string): boolean {
  const layers = splitTopLevel(value, ",").map((layer) => layer.trim());
  return layers.length >= 1 && layers.length <= 4 && layers.every((layer) => gradientColours(layer) !== null);
}

/** The colours of every gradient in a kept `background-image`. */
export function backgroundImageColours(value: string): Rgba[] {
  return splitTopLevel(value, ",").flatMap((layer) => gradientColours(layer.trim()) ?? []);
}

const BORDER_STYLE = new Set(["none", "hidden", "solid", "dotted", "dashed", "double", "groove", "ridge", "inset", "outset"]);
const BORDER_WIDTH = new Set(["thin", "medium", "thick"]);
/** A border never wider than a thick line: a frame, not a way to push a box off the page. */
const borderLength = (t: string): boolean => {
  const length = readLength(t);
  return length !== null && length.unit !== "%" && (lengthPx(t, 16, 0) ?? Infinity) <= 20;
};
const borderPart = (t: string) => BORDER_STYLE.has(t) || BORDER_WIDTH.has(t) || borderLength(t) || anyColour(t);
const border = (tokens: string[]) => tokens.length >= 1 && tokens.length <= 3 && tokens.every(borderPart);

const FONT_NAME = /^[a-z0-9 ,'"_-]+$/i;
/** A family list whose quotes all close: nothing in it can run into the next declaration. */
function fontFamily(_tokens: string[], value: string): boolean {
  if (!FONT_NAME.test(value)) return false;
  return (value.match(/"/g) ?? []).length % 2 === 0 && (value.match(/'/g) ?? []).length % 2 === 0;
}

/** Display values that show their content. `table-column` and its group never do. */
const DISPLAY = oneOf(
  "none", "block", "inline", "inline-block", "flow-root", "list-item",
  "table", "inline-table", "table-row", "table-cell", "table-row-group", "table-header-group", "table-footer-group", "table-caption",
  "flex", "inline-flex", "grid", "inline-grid",
);
/**
 * Displays a browser reads that the walk reads as the one it names: the
 * makers' old spellings of flex and box, and `contents`, whose box would paint
 * nothing behind its words — given as a block, its words stand on its
 * background. Dropping them would let a `hidden` beside them win, and words a
 * browser shows would be gone (review of 2026-11-17).
 */
const DISPLAY_AS: Readonly<Record<string, string>> = {
  "-webkit-box": "block", "-moz-box": "block", "-webkit-flex": "flex", "-ms-flexbox": "flex",
  "-webkit-inline-box": "inline-block", "-moz-inline-box": "inline-block", "-webkit-inline-flex": "inline-flex", "-ms-inline-flexbox": "inline-flex",
  contents: "block",
};

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

/** A size worked out by a function, as the range it can come to. */
type Range = readonly [number, number];
/** One viewport unit in pixels, over the frames of the narrowest phone to a wide screen. */
const VIEWPORT_UNIT: Range = [2.8, 25.6];
const MATH_FUNCTION = /^(calc|min|max|clamp)\(/;
const MATH_NUMBER = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|pt|pc|cm|mm|in|em|rem|ex|ch|%|vw|vh|vmin|vmax)?/;

/**
 * A size worked out by `calc()`, `min()`, `max()` or `clamp()`, as the range
 * it can come to: `em`, `ex`, `ch` and `%` from the parent's size, viewport
 * units over every frame the reader can have. `null` where the expression is
 * not one this reads, or not a length.
 */
function mathRange(text: string, parentPx: number): Range | null {
  let at = 0;
  /** Whether the value last read is a plain number: only a number multiplies or divides a length. */
  let plain = false;
  const blank = () => {
    while (at < text.length && /\s/.test(text[at])) at++;
  };
  const unitScale = (unit: string): Range => {
    if (unit in PX_PER_UNIT) return [PX_PER_UNIT[unit], PX_PER_UNIT[unit]];
    if (unit === "em") return [parentPx, parentPx];
    if (unit === "%") return [parentPx / 100, parentPx / 100];
    if (unit === "rem") return [ROOT_PX, ROOT_PX];
    if (unit === "ex" || unit === "ch") return [parentPx * EX_LOW, parentPx * 0.6];
    return VIEWPORT_UNIT;
  };
  const factor = (): Range | null => {
    blank();
    if (text[at] === "(") {
      at++;
      const inner = sum();
      blank();
      if (!inner || text[at] !== ")") return null;
      at++;
      return inner;
    }
    const fn = MATH_FUNCTION.exec(text.slice(at));
    if (fn) {
      at += fn[0].length;
      const args: Range[] = [];
      for (;;) {
        const arg = sum();
        if (!arg || plain) return null;
        args.push(arg);
        blank();
        if (text[at] === "," && args.length < 8) {
          at++;
          continue;
        }
        if (text[at] !== ")") return null;
        at++;
        break;
      }
      plain = false;
      if (fn[1] === "calc") return args.length === 1 ? args[0] : null;
      if (fn[1] === "clamp") {
        if (args.length !== 3) return null;
        const [low, middle, high] = args;
        return [Math.max(low[0], Math.min(middle[0], high[0])), Math.max(low[1], Math.min(middle[1], high[1]))];
      }
      const lows = args.map((arg) => arg[0]);
      const highs = args.map((arg) => arg[1]);
      return fn[1] === "min" ? [Math.min(...lows), Math.min(...highs)] : [Math.max(...lows), Math.max(...highs)];
    }
    const m = MATH_NUMBER.exec(text.slice(at));
    if (!m) return null;
    at += m[0].length;
    const n = parseFloat(m[1]);
    const unit = m[2] ?? "";
    plain = unit === "";
    if (plain) return [n, n];
    const scale = unitScale(unit);
    return [Math.min(n * scale[0], n * scale[1]), Math.max(n * scale[0], n * scale[1])];
  };
  const product = (): Range | null => {
    let left = factor();
    if (!left) return null;
    let leftPlain = plain;
    for (;;) {
      blank();
      const op = text[at];
      if (op !== "*" && op !== "/") {
        plain = leftPlain;
        return left;
      }
      at++;
      const right = factor();
      if (!right) return null;
      if (op === "*") {
        if (!leftPlain && !plain) return null;
        const products: number[] = [left[0] * right[0], left[0] * right[1], left[1] * right[0], left[1] * right[1]];
        left = [Math.min(...products), Math.max(...products)];
        leftPlain = leftPlain && plain;
      } else {
        if (!plain || right[0] <= 0) return null;
        left = [left[0] / right[1], left[1] / right[0]];
      }
    }
  };
  function sum(): Range | null {
    let left = product();
    if (!left) return null;
    let leftPlain = plain;
    for (;;) {
      blank();
      const op = text[at];
      if (op !== "+" && op !== "-") {
        plain = leftPlain;
        return left;
      }
      at++;
      const right = product();
      if (!right || plain !== leftPlain) return null;
      left = op === "+" ? [left[0] + right[0], left[1] + right[1]] : [left[0] - right[1], left[1] - right[0]];
      leftPlain = plain;
    }
  }
  const range = factor();
  blank();
  if (!range || at !== text.length || plain) return null;
  return range;
}

/**
 * The size in pixels a declared font size gives, from the parent's — the
 * smallest it can come to: absolute lengths and the named sizes stand on their
 * own, `em` and `%` are measured against the parent (of a parent of no size,
 * nothing), `rem` against the root, `ex` and `ch` at their smallest, a size
 * worked out by `calc()` and its kin at the least it can be. `null` for a
 * value this list does not keep.
 */
export function fontSizePx(value: string, parentPx: number): number | null {
  const named = namedFontSize(value);
  if (named !== null) return named;
  if (value === "larger") return parentPx * 1.2;
  if (value === "smaller") return parentPx / 1.2;
  if (value === "inherit" || value === "unset") return parentPx;
  if (MATH_FUNCTION.test(value)) {
    const range = mathRange(value, parentPx);
    return range ? Math.max(0, range[0]) : null;
  }
  return lengthPx(value, parentPx, parentPx);
}

function fontSizeToken(token: string): boolean {
  return namedFontSize(token) !== null || FONT_SIZE_WORDS.includes(token) || isLength(token) || (MATH_FUNCTION.test(token) && fontSizePx(token, 16) !== null);
}

function lineHeight(tokens: string[]): boolean {
  if (tokens.length !== 1) return false;
  if (tokens[0] === "normal") return true;
  if (/^(\d+(?:\.\d+)?|\.\d+)$/.test(tokens[0])) return parseFloat(tokens[0]) <= 10;
  const length = readLength(tokens[0]);
  return length !== null;
}

/**
 * A line height that lays lines on top of each other: below half the font,
 * below 4 px. The shaper takes it from an element only where a word of it
 * takes its line from it (`MailShaper`, review of 2026-11-18): a wrapper of
 * pictures with `line-height:0` keeps it, as at main, where every word inside
 * stands in a box with a line height of its own.
 */
export function tinyLineHeight(value: string): boolean {
  if (value === "normal" || value === "inherit" || value === "unset" || value === "initial") return false;
  if (/^(\d+(?:\.\d+)?|\.\d+)$/.test(value)) return parseFloat(value) < 0.5;
  const length = readLength(value);
  if (!length) return false;
  if (length.unit in PX_PER_UNIT) return length.amount * PX_PER_UNIT[length.unit] < 4;
  if (length.unit === "%") return length.amount < 50;
  // An ex or a ch is about half a letter's height.
  return length.unit === "ex" || length.unit === "ch" ? length.amount < 1 : length.amount < 0.5;
}

/** Whether a `style` attribute gives its element a line height of its own that it keeps (not one `tinyLineHeight` takes away). */
export function ownsLineHeight(style: string): boolean {
  return readMailStyle(style).declarations.some((d) => d.name === "line-height" && !tinyLineHeight(d.value));
}

const FONT_WEIGHT = oneOf("normal", "bold", "bolder", "lighter", "100", "200", "300", "400", "500", "600", "700", "800", "900");
const FONT_STYLE = oneOf("normal", "italic", "oblique");

const LAYOUT_SIZE = lengthOr("auto", "none");

export const MAIL_STYLE: Readonly<Record<string, PropertyRule>> = {
  // What can take words off the screen — the walk judges each of these.
  display: {
    kind: "judged",
    accepts: (t) => DISPLAY(t) || (t.length === 1 && Object.prototype.hasOwnProperty.call(DISPLAY_AS, t[0])),
    write: (t) => (Object.prototype.hasOwnProperty.call(DISPLAY_AS, t[0]) ? DISPLAY_AS[t[0]] : t[0]),
  },
  visibility: { kind: "judged", accepts: oneOf("visible", "hidden", "collapse") },
  opacity: { kind: "judged", accepts: (t) => t.length === 1 && readOpacity(t[0]) !== null },
  "font-size": { kind: "judged", accepts: (t) => t.length === 1 && fontSizeToken(t[0]) },
  // Text that does not wrap may run past the frame: the frame scrolls there
  // (`frameFit.ts`), so a line is kept as the mail sets it, as at main.
  "white-space": { kind: "judged", accepts: oneOf("normal", "nowrap", "pre", "pre-wrap", "pre-line", "break-spaces") },
  // The colour of the letters around it (`inherit`, `currentColor`, `unset`) is a colour understood.
  color: {
    kind: "judged",
    accepts: (t) => t.length === 1 && (anyColour(t[0]) || INHERITED_COLOUR.has(t[0])),
    write: (t) => (INHERITED_COLOUR.has(t[0]) ? "inherit" : t[0]),
  },
  "background-color": { kind: "judged", accepts: (t) => t.length === 1 && anyColour(t[0]) },
  "background-image": { kind: "judged", accepts: (_t, value) => gradients(value.toLowerCase()) },
  overflow: { kind: "judged", accepts: oneOf("hidden") },

  // Type and lines.
  "font-family": { kind: "layout", accepts: fontFamily },
  "font-weight": { kind: "layout", accepts: FONT_WEIGHT },
  "font-style": { kind: "layout", accepts: FONT_STYLE },
  "line-height": { kind: "layout", accepts: lineHeight },
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
      if (spacing(20, 1)(t)) return true;
      const tight = t[0].startsWith("-") ? readLength(t[0].slice(1)) : null;
      if (!tight) return false;
      return tight.unit === "em" || tight.unit === "rem" ? tight.amount <= 0.1 : tight.unit === "px" ? tight.amount <= 2 : tight.unit === "pt" ? tight.amount <= 1.5 : false;
    },
  },
  "word-spacing": { kind: "layout", accepts: spacing(40, 2) },
  "text-indent": { kind: "layout", accepts: lengthOr() },
  // Lines break as the mail asks (Korean keeps its words whole with `keep-all`); what runs past the frame, the frame scrolls to.
  "word-break": { kind: "layout", accepts: oneOf("normal", "keep-all", "break-all", "break-word") },
  "overflow-wrap": { kind: "layout", accepts: oneOf("break-word", "anywhere") },
  "word-wrap": { kind: "layout", accepts: oneOf("break-word", "anywhere") },
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
  "border-width": { kind: "layout", accepts: (t) => t.length >= 1 && t.length <= 4 && t.every((w) => BORDER_WIDTH.has(w) || borderLength(w)) },
  "border-style": { kind: "layout", accepts: (t) => t.length >= 1 && t.length <= 4 && t.every((w) => BORDER_STYLE.has(w)) },
  "border-color": { kind: "layout", accepts: (t) => t.length >= 1 && t.length <= 4 && t.every(anyColour) },
  "border-radius": { kind: "layout", accepts: boxSides() },
  "border-collapse": { kind: "layout", accepts: oneOf("collapse", "separate") },
  "border-spacing": { kind: "layout", accepts: (t) => t.length >= 1 && t.length <= 2 && t.every((w) => spacing(40, 2)([w])) },
  "table-layout": { kind: "layout", accepts: oneOf("auto", "fixed") },
  "box-sizing": { kind: "layout", accepts: oneOf("content-box", "border-box") },
  float: { kind: "layout", accepts: oneOf("left", "right", "none") },
  clear: { kind: "layout", accepts: oneOf("left", "right", "both", "none") },
  "list-style-type": { kind: "layout", accepts: (t) => t.length === 1 && /^[a-z-]{1,24}$/.test(t[0]) },
  "list-style": { kind: "layout", accepts: (t) => t.length >= 1 && t.length <= 2 && t.every((w) => /^[a-z-]{1,24}$/.test(w)) },
};

/** Words of the `font` shorthand before its size. */
const FONT_PREFIX = new Set([
  "normal", "italic", "oblique", "small-caps", "bold", "bolder", "lighter", "100", "200", "300", "400", "500", "600", "700", "800", "900",
  "ultra-condensed", "extra-condensed", "condensed", "semi-condensed", "semi-expanded", "expanded", "extra-expanded", "ultra-expanded",
]);

/**
 * The longhands the `font` shorthand sets, as a browser reads it: the style
 * and weight words, a size with an optional line height after a slash, and a
 * family — without a family the shorthand is no declaration at all. What the
 * shorthand does not name it sets back to normal. `null` where it is not one
 * this list reads.
 */
function fontLonghands(value: string): Array<[string, string]> | null {
  const words = splitTokens(value);
  let index = 0;
  let style = "normal";
  let weight = "normal";
  while (index < words.length && FONT_PREFIX.has(words[index].toLowerCase())) {
    const word = words[index].toLowerCase();
    if (word === "italic" || word === "oblique") style = word;
    else if (FONT_WEIGHT([word])) weight = word;
    index++;
  }
  if (index >= words.length) return null;
  let size = words[index++].toLowerCase();
  let height: string | null = null;
  const slash = size.indexOf("/");
  if (slash >= 0) {
    height = size.slice(slash + 1);
    size = size.slice(0, slash);
    if (!height && index < words.length) height = words[index++].toLowerCase();
  } else if (index < words.length && words[index].startsWith("/")) {
    height = words[index++].slice(1).toLowerCase();
    if (!height && index < words.length) height = words[index++].toLowerCase();
  }
  if (!fontSizeToken(size)) return null;
  const family = words.slice(index).join(" ");
  if (!family || !fontFamily([], family)) return null;
  // A line height of no height is not kept: the lines then stand at their normal height.
  const line = height && lineHeight([height]) ? height : "normal";
  return [["font-style", style], ["font-weight", weight], ["font-size", size], ["line-height", line], ["font-family", family]];
}

/** Words of the `background` shorthand that only place an image. */
const BACKGROUND_WORDS = new Set([
  "none", "repeat", "no-repeat", "repeat-x", "repeat-y", "space", "round", "scroll", "fixed", "local",
  "left", "right", "top", "bottom", "center", "cover", "contain", "auto", "border-box", "padding-box", "content-box",
]);
const backgroundWord = (word: string): boolean => BACKGROUND_WORDS.has(word) || isLength(word) || /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|%)$/.test(word);

/**
 * The longhands of the `background` shorthand the reader is given: its colour
 * and its gradients. An image from an address is not kept (it is a fetch);
 * how an image is placed does not matter without one. `null` where a word is
 * not one this list reads — then nothing of it is kept.
 */
function backgroundLonghands(value: string): Array<[string, string]> | null {
  const layers = splitTopLevel(value, ",");
  let colour: string | null = null;
  const images: string[] = [];
  for (let layer = 0; layer < layers.length; layer++) {
    for (const word of splitTokens(layers[layer].trim())) {
      if (/^url\(/.test(word)) continue;
      if (gradientColours(word)) images.push(word);
      else if (layer === layers.length - 1 && colour === null && anyColour(word)) colour = word;
      else if (!word.split("/").every((part) => part === "" || backgroundWord(part))) return null;
    }
  }
  const longhands: Array<[string, string]> = [];
  if (colour !== null) longhands.push(["background-color", colour]);
  if (images.length > 0 && images.length <= 4) longhands.push(["background-image", images.join(", ")]);
  return longhands;
}

/** Shorthands read as the longhands they set. */
const SHORTHANDS: Readonly<Record<string, (value: string) => Array<[string, string]> | null>> = {
  font: (value) => fontLonghands(value),
  background: (value) => backgroundLonghands(value.toLowerCase()),
};

/** The properties that paint a background; the text colour hangs on them. */
const BACKGROUND_PROPERTIES = new Set(["background", "background-color", "background-image"]);
/** The properties that colour the letters. */
const COLOUR_PROPERTIES = new Set(["color", "-webkit-text-fill-color"]);
/** Values of a background that paint nothing — not a background lost. */
const PAINTS_NOTHING = new Set(["none", "transparent", "initial", "unset", "inherit", "revert"]);

/** One kept declaration: its property, its value as it is written out, and whether it is `!important`. */
export interface MailDeclaration {
  name: string;
  value: string;
  important: boolean;
}

/** What a style keeps, and what it asked for that it does not keep. */
export interface MailStyle {
  declarations: MailDeclaration[];
  /** It set a background and none of it is kept (an image from an address, a value not read) — `none` is no background lost. */
  lostBackground: boolean;
  /** It set a colour of its letters that is not kept (a value not read, `-webkit-text-fill-color`). */
  lostColour: boolean;
  /** It set a font size and none is kept. */
  lostFontSize: boolean;
}

/** `value` split at `separator`, except inside a function's brackets or quotes. */
function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let part = "";
  let depth = 0;
  let quote = "";
  for (const c of value) {
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === separator && depth === 0) {
      parts.push(part);
      part = "";
      continue;
    }
    part += c;
  }
  parts.push(part);
  return parts;
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
 * A style with its `var()` read as a browser reads it in the reader: no
 * custom property is ever given (none is on the list), so `var(--x, value)` is
 * its fallback and `var(--x)` is `bare` — `unset`, as a browser has it (a
 * colour then inherits, a background is none); `null` leaves it unread.
 * Innermost first, so a fallback may itself hold a `var()`.
 */
function withoutVariables(value: string, bare: string | null): string {
  let out = value;
  for (let round = 0; round < 8; round++) {
    const at = out.toLowerCase().lastIndexOf("var(");
    if (at < 0) return out;
    let depth = 0;
    let comma = -1;
    let end = -1;
    for (let index = at + 3; index < out.length; index++) {
      const c = out[index];
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) {
        end = index;
        break;
      } else if (c === "," && depth === 1 && comma < 0) comma = index;
    }
    if (end < 0) return out;
    const fallback = comma < 0 ? bare : out.slice(comma + 1, end).trim() || bare;
    if (fallback === null) return out;
    out = out.slice(0, at) + fallback + out.slice(end + 1);
  }
  return out;
}

/** A style read once is read again unchanged: a newsletter writes the same few hundred times. */
const READ = new Map<string, MailStyle>();
const READ_MAX = 4096;

/**
 * What a `style` attribute keeps, in its order, with the shorthands written
 * out. A comment is nothing to a browser, so it is nothing here (a comment
 * between `display:` and `none` still says `display: none`); a declaration
 * with a backslash — an escape, which the browser reads and this does not — is
 * not kept, nor one whose property or value the list does not know.
 */
export function readMailStyle(style: string): MailStyle {
  const known = READ.get(style);
  if (known) return known;
  const kept: MailDeclaration[] = [];
  let lostBackground = false;
  let lostColour = false;
  let askedFontSize = false;
  const text = style.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, " ");
  for (const written of text.split(";")) {
    let colon = written.indexOf(":");
    if (colon < 0) continue;
    const name = written.slice(0, colon).trim().toLowerCase();
    // A size from a variable without a fallback stays unread, and the reader gives its own size where that leaves none.
    const declaration = name + ":" + withoutVariables(written.slice(colon + 1), name === "font-size" || name === "font" ? null : "unset");
    colon = name.length;
    if (name === "font-size" || name === "font") askedFontSize = true;
    let keptBefore = kept.length;
    const lose = (): void => {
      if (BACKGROUND_PROPERTIES.has(name)) {
        const words = declaration.slice(colon + 1).replace(/!\s*important\s*$/i, "").trim().toLowerCase().split(/\s+/);
        if (!words.every((word) => PAINTS_NOTHING.has(word) || BACKGROUND_WORDS.has(word))) lostBackground = true;
      }
      // A colour the letters are given and the reader is not: their colour is not known.
      if (COLOUR_PROPERTIES.has(name)) lostColour = true;
    };
    if (declaration.includes("\\")) {
      lose();
      continue;
    }
    let value = declaration.slice(colon + 1).trim();
    const bang = value.lastIndexOf("!");
    const important = bang >= 0 && value.slice(bang + 1).trim().toLowerCase() === "important";
    if (important) value = value.slice(0, bang).trim();
    if (bang >= 0 && !important) {
      lose();
      continue;
    }
    const shorthand = Object.prototype.hasOwnProperty.call(SHORTHANDS, name) ? SHORTHANDS[name] : undefined;
    if (name === "background") {
      // The shorthand sets the whole background anew: what was set before it is gone, as in a browser.
      for (let index = kept.length - 1; index >= 0; index--) {
        const d = kept[index];
        if ((d.name === "background-color" || d.name === "background-image") && (important || !d.important)) kept.splice(index, 1);
      }
      keptBefore = kept.length;
    }
    const pairs: Array<[string, string]> = shorthand ? (shorthand(value) ?? []) : [[name, value]];
    for (const [property, written] of pairs) {
      const rule = Object.prototype.hasOwnProperty.call(MAIL_STYLE, property) ? MAIL_STYLE[property] : undefined;
      if (!rule) continue;
      // Blanks inside a function are part of its one token.
      const tokens = splitTokens(written.toLowerCase());
      if (tokens.length === 0 || !rule.accepts(tokens, written)) continue;
      const out = rule.write ? rule.write(tokens) : property === "font-family" ? written.replace(/\s+/g, " ") : tokens.join(" ");
      if (out !== null) kept.push({ name: property, value: out, important });
    }
    if (kept.length === keptBefore || name === "-webkit-text-fill-color") lose();
  }
  const result: MailStyle = {
    declarations: kept,
    lostBackground: lostBackground && !kept.some((d) => d.name === "background-color" || d.name === "background-image"),
    lostColour,
    lostFontSize: askedFontSize && !kept.some((d) => d.name === "font-size"),
  };
  if (READ.size >= READ_MAX) READ.clear();
  READ.set(style, result);
  return result;
}

/** The declarations of a `style` attribute that the list keeps, in their order (`readMailStyle`). */
export function mailStyleDeclarations(style: string): MailDeclaration[] {
  return readMailStyle(style).declarations;
}

/** Declarations written out as a `style` attribute, "" for none. */
export function writeMailStyle(declarations: readonly MailDeclaration[]): string {
  return declarations.map((d) => `${d.name}:${d.value}${d.important ? " !important" : ""}`).join(";");
}

const WRITTEN = new WeakMap<MailDeclaration[], string>();

/** The `style` attribute the reader is given: the kept declarations written anew, "" for none. */
export function keptMailStyle(style: string): string {
  const declarations = mailStyleDeclarations(style);
  let written = WRITTEN.get(declarations);
  if (written === undefined) WRITTEN.set(declarations, (written = writeMailStyle(declarations)));
  return written;
}

/**
 * The declarations a browser applies: a later one replaces an earlier one
 * unless the earlier is `!important` and the later is not.
 */
export function appliedMailStyle(declarations: readonly MailDeclaration[]): Map<string, string> {
  const applied = new Map<string, string>();
  const weighty = new Set<string>();
  for (const { name, value, important } of declarations) {
    if (weighty.has(name) && !important) continue;
    applied.set(name, value);
    if (important) weighty.add(name);
  }
  return applied;
}
