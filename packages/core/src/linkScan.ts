/**
 * Linear scanners for the bracket grammars of wiki and Markdown links (plan
 * Befunde 24.09., E6).
 *
 * The patterns these replace searched for the closing bracket again from every
 * `[`: a note with a long run of `[` and no `]` behind it cost quadratic time
 * per scan — in the editor on every keystroke, in an import once per file.
 * Here every start asks a cursor for its next stop, and a cursor keeps its
 * answer while that still lies ahead, so one pass reads each character once
 * however many starts ask.
 *
 * Each matcher decides a position the way the old pattern did, decision for
 * decision; the call sites name the pattern they stand for.
 */

const SPACE = /\s/;
const LINE_TERMINATORS = "\n\r\u2028\u2029";

/**
 * The first index at or after `from` where `hit` holds, or `length` when there
 * is none. Asked with a `from` that never decreases, it reuses its last answer
 * while that still lies ahead, so a whole pass costs one test per index; an
 * earlier `from` scans again and is still answered correctly.
 */
export function nextWhere(length: number, hit: (at: number) => boolean): (from: number) => number {
  let asked = 0;
  let answer = -1;
  return (from) => {
    if (from >= asked && from <= answer) return answer;
    let at = from;
    while (at < length && !hit(at)) at++;
    asked = from;
    answer = at < length ? at : length;
    return answer;
  };
}

/** `(!?)\[label\]\(destination\)` — which characters each part may hold. */
export interface BracketLinkGrammar {
  /** `!?` in front: a `!` right before the `[` belongs to the match. */
  bang?: boolean;
  /** Characters besides `]` the label may not hold (`[^\]\n]*` → "\n"). */
  labelStops?: string;
  /** A literal the destination has to start with; it is part of `destination`. */
  destinationPrefix?: string;
  /** Characters besides `)` the destination may not hold. */
  destinationStops?: string;
  /** Whitespace (`\s`) may not stand in the destination either. */
  destinationStopsAtSpace?: boolean;
  /** Characters the destination needs after its prefix: 0 for `*`, 1 for `+`. */
  destinationMin: 0 | 1;
}

export interface BracketLinkMatch {
  index: number;
  end: number;
  raw: string;
  /** `"!"` when the match took the `!` in front, else `""` — what `(!?)` captures. */
  bang: string;
  label: string;
  destination: string;
}

/**
 * The link starting at a position, or null. A label that cannot hold `]` ends
 * at the first `]` or stop, lazy and greedy alike, and a destination that
 * cannot hold `)` ends at the first `)` or stop — so no position needs a
 * second reading. Ask with rising positions (see `nextWhere`).
 */
export function bracketLinkMatcher(text: string, grammar: BracketLinkGrammar): (at: number) => BracketLinkMatch | null {
  const { bang = false, labelStops = "", destinationPrefix = "", destinationStops = "", destinationStopsAtSpace = false, destinationMin } = grammar;
  const n = text.length;
  const labelEnd = nextWhere(n, (i) => text[i] === "]" || labelStops.includes(text[i]));
  const destinationEnd = nextWhere(n, (i) => {
    const ch = text[i];
    return ch === ")" || destinationStops.includes(ch) || (destinationStopsAtSpace && SPACE.test(ch));
  });
  return (at) => {
    // With the `!` taken the link has to follow it; without it, a `!` is no `[`.
    const open = bang && text[at] === "!" ? at + 1 : at;
    if (text[open] !== "[") return null;
    const close = labelEnd(open + 1);
    if (text[close] !== "]" || text[close + 1] !== "(") return null;
    const from = close + 2;
    if (!text.startsWith(destinationPrefix, from)) return null;
    const run = from + destinationPrefix.length;
    const end = destinationEnd(run);
    if (text[end] !== ")" || end - run < destinationMin) return null;
    return {
      index: at,
      end: end + 1,
      raw: text.slice(at, end + 1),
      bang: open > at ? "!" : "",
      label: text.slice(open + 1, close),
      destination: text.slice(from, end),
    };
  };
}

/** Every link of the grammar, left to right, as a global pattern finds them. */
export function* bracketLinks(text: string, grammar: BracketLinkGrammar): Generator<BracketLinkMatch> {
  const matchAt = bracketLinkMatcher(text, grammar);
  for (let at = 0; at < text.length; ) {
    const match = matchAt(at);
    if (match) {
      yield match;
      at = match.end;
    } else at++;
  }
}

/** `text.replace(pattern, fn)` for a global link pattern of the grammar. */
export function replaceBracketLinks(text: string, grammar: BracketLinkGrammar, replace: (match: BracketLinkMatch) => string): string {
  const pieces: string[] = [];
  let cursor = 0;
  for (const match of bracketLinks(text, grammar)) {
    pieces.push(text.slice(cursor, match.index), replace(match));
    cursor = match.end;
  }
  pieces.push(text.slice(cursor));
  return pieces.join("");
}

/** `(!?)\[\[inner\]\]` — which characters the inner text may hold. */
export interface WikiLinkGrammar {
  /** `!?` in front: a `!` right before the `[[` belongs to the match. */
  bang?: boolean;
  /** `[^\]…]+`: one character or more, none of them `]` or one of these. */
  innerStops?: string;
  /**
   * `.*?` instead: anything but a line terminator — a single `]` included —
   * up to the FIRST `]]`, and empty is allowed.
   */
  anyInLine?: boolean;
}

export interface WikiLinkMatch {
  index: number;
  end: number;
  raw: string;
  /** `"!"` when the match took the `!` in front, else `""`. */
  bang: string;
  inner: string;
}

/** The wiki link starting at a position, or null. Ask with rising positions. */
export function wikiLinkMatcher(text: string, grammar: WikiLinkGrammar): (at: number) => WikiLinkMatch | null {
  const { bang = false, innerStops = "", anyInLine = false } = grammar;
  const n = text.length;
  const close = anyInLine
    ? nextWhere(n, (i) => text[i] === "]" && text[i + 1] === "]")
    : nextWhere(n, (i) => text[i] === "]" || innerStops.includes(text[i]));
  const lineEnd = nextWhere(n, (i) => LINE_TERMINATORS.includes(text[i]));
  return (at) => {
    const open = bang && text[at] === "!" ? at + 1 : at;
    if (text[open] !== "[" || text[open + 1] !== "[") return null;
    const from = open + 2;
    const end = close(from);
    if (anyInLine) {
      // The first `]]` closes it, unless a line ends before it (or none comes).
      if (end >= lineEnd(from)) return null;
    } else if (end === from || text[end] !== "]" || text[end + 1] !== "]") return null;
    return { index: at, end: end + 2, raw: text.slice(at, end + 2), bang: open > at ? "!" : "", inner: text.slice(from, end) };
  };
}

/** Every wiki link of the grammar, left to right, as a global pattern finds them. */
export function* wikiLinks(text: string, grammar: WikiLinkGrammar): Generator<WikiLinkMatch> {
  const matchAt = wikiLinkMatcher(text, grammar);
  for (let at = 0; at < text.length; ) {
    const match = matchAt(at);
    if (match) {
      yield match;
      at = match.end;
    } else at++;
  }
}
