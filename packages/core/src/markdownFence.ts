/**
 * Fenced code, line by line — the ONE rule for every scanner that has to know
 * whether a line of a note is code: the task scanner and its ordinals, every
 * writer that finds a checkbox by those ordinals, the note cards, the HTML
 * checkboxes and the inline tags.
 *
 * The reading view and the editor parse the note with a CommonMark parser
 * (remark, Lezer), and a checkbox in the reading view is matched back to the
 * file by counting. So the scanners must see code exactly where the renderer
 * does, or a tick lands on the wrong line. Each of them used to carry a
 * pattern that knew no block quote: a fence written inside a quote or a
 * callout (`> ```) was no fence to them, the `- [ ]` lines in it became tasks
 * and every real task after it was counted one too far (finding 2026-10-25).
 *
 * What CommonMark says, and this reads:
 *
 * - A fence is a run of at least three backticks or tildes, behind any block
 *   quote markers (`>`, each with at most one blank after it) and blanks. A
 *   backtick fence's info string may not contain a backtick — "```x```" at the
 *   start of a line is inline code, no fence.
 * - The fence belongs to the quote level it was opened at. It closes on a run
 *   of the SAME character, at least as long, with nothing but blanks behind
 *   it, at that same level. A line at a deeper level is code (its `>` are the
 *   code's text); a line at a shallower level — a blank line without `>`
 *   included — ends the quote, and with it the fence, and is read as any
 *   other line (it may open a new fence).
 * - A fence that is never closed runs to the end of its quote, or of the note.
 *
 * Indentation is read leniently, as before: a fence may stand at any depth
 * (inside list items it stands deeper than three blanks), and a line that
 * ends a list item does not end a fence opened in it. Those two are the known
 * differences to a full parser; they need list containers, which a line
 * scanner does not have.
 *
 * Written by hand, without patterns that can backtrack (plan Befunde 24.09.).
 */

/** What a line is to fenced code: its opening line, a line in it, its closing line. */
export type FenceLineKind = "open" | "code" | "close";

export interface FenceTracker {
  /** Feeds the next line of the note, in order; `null` for a line that is not code. */
  step(line: string): FenceLineKind | null;
  /** Whether a fence is open after the lines fed so far. */
  readonly inFence: boolean;
}

const WHITESPACE = /\s/;
const isBlank = (ch: string | undefined): boolean => ch !== undefined && ch !== "\n" && WHITESPACE.test(ch);

/** The block quote markers in front of a line: how many, and the text behind them. */
export function readQuoteDepth(line: string): { depth: number; rest: string } {
  let at = 0;
  let depth = 0;
  for (;;) {
    let k = at;
    while (isBlank(line[k])) k++;
    if (line[k] !== ">") break;
    k++;
    if (line[k] === " " || line[k] === "\t") k++;
    at = k;
    depth++;
  }
  return { depth, rest: at === 0 ? line : line.slice(at) };
}

/**
 * The line without its first `depth` block quote markers: the text of a code
 * line in a fence that stands in a quote, as the renderer shows it.
 */
export function stripQuoteMarkers(line: string, depth: number): string {
  let at = 0;
  for (let d = 0; d < depth; d++) {
    let k = at;
    while (isBlank(line[k])) k++;
    if (line[k] !== ">") break;
    k++;
    if (line[k] === " " || line[k] === "\t") k++;
    at = k;
  }
  return at === 0 ? line : line.slice(at);
}

interface FenceRun {
  marker: "`" | "~";
  length: number;
  /** What stands behind the run on its line. */
  after: string;
}

function readFenceRun(rest: string): FenceRun | null {
  let k = 0;
  while (isBlank(rest[k])) k++;
  const marker = rest[k];
  if (marker !== "`" && marker !== "~") return null;
  let end = k;
  while (rest[end] === marker) end++;
  if (end - k < 3) return null;
  return { marker, length: end - k, after: rest.slice(end) };
}

const onlyBlanks = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) if (!WHITESPACE.test(text[i])) return false;
  return true;
};

export function createFenceTracker(): FenceTracker {
  let open: { marker: "`" | "~"; length: number; depth: number } | null = null;
  return {
    get inFence() {
      return open !== null;
    },
    step(line: string): FenceLineKind | null {
      const { depth, rest } = readQuoteDepth(line);
      if (open) {
        if (depth >= open.depth) {
          if (depth === open.depth) {
            const run = readFenceRun(rest);
            if (run && run.marker === open.marker && run.length >= open.length && onlyBlanks(run.after)) {
              open = null;
              return "close";
            }
          }
          return "code";
        }
        // The quote the fence stood in has ended, and the fence with it.
        open = null;
      }
      const run = readFenceRun(rest);
      if (!run || (run.marker === "`" && run.after.includes("`"))) return null;
      open = { marker: run.marker, length: run.length, depth };
      return "open";
    },
  };
}

/** For each line: whether it belongs to fenced code (its opening, body or closing line). */
export function fencedCodeLines(lines: readonly string[]): boolean[] {
  const fence = createFenceTracker();
  return lines.map((line) => fence.step(line) !== null);
}
