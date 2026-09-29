/**
 * One Markdown list item line, read by hand (plan Befunde 24.09., E6).
 *
 * The editor's list continuation, the plain-text copy and the HTML copy each
 * carried their own pattern for the same line. Every one of them was a run of
 * separators followed by a greedy rest that had to reach the end of the line,
 * so a line of blanks with a break at its end made the engine retry the rest
 * from every start of the run — quadratic time on text from anywhere. One
 * reader serves all three now, in one pass.
 *
 * The two grammars those patterns spoke stay exactly as they were:
 *
 * - `MARKDOWN_LIST_ITEM` (the copies): spaces and tabs separate marker, box
 *   and text; a number has one to nine digits; a numbered item can be a task.
 * - `EDITOR_LIST_ITEM` (Enter and Tab in the editor): any whitespace
 *   separates; a number has any length; only a bullet item is read as a task.
 *
 * Both: the indent is the leading whitespace, the text is what follows the
 * marker (and box) after ALL its separators, and a line whose text holds a line
 * break is no list item.
 */

export interface ListItemGrammar {
  /** What separates marker, box and text. */
  gap: "spaceTab" | "whitespace";
  /** The longest number an ordered item may carry. */
  maxDigits: number;
  /** Whether a numbered item can carry a task box. */
  orderedTasks: boolean;
}

export const MARKDOWN_LIST_ITEM: ListItemGrammar = { gap: "spaceTab", maxDigits: 9, orderedTasks: true };
export const EDITOR_LIST_ITEM: ListItemGrammar = { gap: "whitespace", maxDigits: Number.POSITIVE_INFINITY, orderedTasks: false };

export interface MarkdownListItem {
  /** The whitespace before the marker. */
  indent: string;
  /** `-`, `*` or `+` — or the number with its delimiter, `1.` / `1)`. */
  marker: string;
  ordered: boolean;
  /** What the task box holds — ` `, `x`, `X`, `/` or `-` — or null for a plain item. */
  box: string | null;
  /** The text after the marker and box, without the separators before it. */
  text: string;
}

const WHITESPACE = /\s/;
/** What `.` does not match: an item is one line. */
const LINE_BREAK = /[\n\r\u2028\u2029]/;
const BOX_CHARS = " xX/-";

const isWhitespace = (ch: string | undefined): boolean => ch !== undefined && WHITESPACE.test(ch);
const isSpaceOrTab = (ch: string | undefined): boolean => ch === " " || ch === "\t";
const isDigit = (code: number): boolean => code >= 48 && code <= 57;

/** Reads one line as a list item, or null when it is none. */
export function readMarkdownListItem(line: string, grammar: ListItemGrammar = MARKDOWN_LIST_ITEM): MarkdownListItem | null {
  const isGap = grammar.gap === "spaceTab" ? isSpaceOrTab : isWhitespace;
  const skipGap = (from: number) => { while (from < line.length && isGap(line[from])) from++; return from; };

  let at = 0;
  while (at < line.length && isWhitespace(line[at])) at++;
  const indent = line.slice(0, at);

  let marker: string, ordered = false;
  const first = line[at];
  if (first === "-" || first === "*" || first === "+") {
    marker = first;
    at++;
  } else {
    let end = at;
    while (end < line.length && isDigit(line.charCodeAt(end))) end++;
    const delimiter = line[end];
    if (end === at || end - at > grammar.maxDigits || (delimiter !== "." && delimiter !== ")")) return null;
    marker = line.slice(at, end + 1);
    at = end + 1;
    ordered = true;
  }

  const gapEnd = skipGap(at);
  if (gapEnd === at) return null;
  at = gapEnd;

  let box: string | null = null;
  const boxChar = line[at + 1];
  if ((!ordered || grammar.orderedTasks) && line[at] === "[" && boxChar !== undefined && BOX_CHARS.includes(boxChar)
    && line[at + 2] === "]" && isGap(line[at + 3])) {
    box = boxChar;
    at = skipGap(at + 3);
  }

  const text = line.slice(at);
  return LINE_BREAK.test(text) ? null : { indent, marker, ordered, box, text };
}
