/**
 * A note's text as a reader with a narrower view may see it — an app over MCP, a cloud model — and where each part
 * of that view stands in the text itself (review of R19, wave 2, decision A of 2026-11-13: one view per reader).
 *
 * A view is a run of pieces that together cover the raw text: a piece either shows its part of the raw text as it is
 * (`kept`), or shows a placeholder in place of it (a withheld link, a place stamp, a redacted number). Every tool that
 * shows, searches or changes a note's text for such a reader works on the view: it reads `text`, and a change it makes
 * there goes back to the raw text through `toRaw`, which refuses any range that touches a withheld piece. So what is
 * withheld can neither be read, nor found, nor told apart by an answer that says "already there" or "not there".
 */

export interface ViewPiece {
  /** The part of the raw text this piece stands for. */
  readonly rawFrom: number;
  readonly rawTo: number;
  /** What the reader sees in its place. */
  readonly text: string;
  /** True where `text` is the raw text itself; false for a placeholder. */
  readonly kept: boolean;
}

/** One replacement in the view's coordinates. */
export interface ViewReplacement {
  from: number;
  to: number;
  with: string;
}

export class ReaderView {
  private joined: string | null = null;

  private constructor(
    readonly raw: string,
    readonly pieces: readonly ViewPiece[],
  ) {}

  /** The raw text, nothing withheld. */
  static of(raw: string): ReaderView {
    return new ReaderView(raw, raw.length ? [{ rawFrom: 0, rawTo: raw.length, text: raw, kept: true }] : []);
  }

  /** What the reader sees. */
  get text(): string {
    this.joined ??= this.pieces.map((piece) => piece.text).join("");
    return this.joined;
  }

  /** Whether anything of the raw text is withheld. */
  get withholds(): boolean {
    return this.pieces.some((piece) => !piece.kept);
  }

  /** How many parts are withheld. */
  get withheldCount(): number {
    return this.pieces.filter((piece) => !piece.kept).length;
  }

  /**
   * `String.prototype.replace` with a global pattern and a callback, on the view: each match the callback answers
   * with another text becomes a withheld piece. `pattern` must carry the `g` flag.
   */
  replace(pattern: RegExp, replacer: (match: string, ...rest: any[]) => string): ReaderView {
    if (!pattern.global) throw new Error("ReaderView.replace needs a global pattern");
    const text = this.text;
    const ranges: ViewReplacement[] = [];
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      const out = replacer(match[0], ...match.slice(1), at, text);
      if (out !== match[0]) ranges.push({ from: at, to: at + match[0].length, with: out });
    }
    return this.replaceRanges(ranges);
  }

  /** Each piece with where it starts and ends in the view. */
  private spans(): { piece: ViewPiece; start: number; end: number }[] {
    let at = 0;
    return this.pieces.map((piece) => {
      const span = { piece, start: at, end: at + piece.text.length };
      at = span.end;
      return span;
    });
  }

  /**
   * Where a position of the view lies in the raw text. A position inside a withheld piece has none (null). The pieces
   * cover the raw text without a gap, so a position between two pieces is the end of one and the start of the next.
   */
  private rawAt(position: number, spans = this.spans()): number | null {
    for (const span of spans) {
      if (position < span.start || position > span.end) continue;
      if (position === span.start) return span.piece.rawFrom;
      if (position === span.end) return span.piece.rawTo;
      return span.piece.kept ? span.piece.rawFrom + (position - span.start) : null;
    }
    return spans.length === 0 && position === 0 ? 0 : null;
  }

  /**
   * Replaces ranges of the view (sorted, not overlapping) with placeholders. A range that reaches into a withheld
   * piece takes that piece whole: a placeholder is never cut, and two ranges that meet that way become one.
   */
  replaceRanges(ranges: readonly ViewReplacement[]): ReaderView {
    if (ranges.length === 0) return this;
    const spans = this.spans();
    // 1. Each range widened to the whole of every withheld piece it reaches into.
    const wide: ViewReplacement[] = [];
    for (const range of ranges) {
      let from = range.from;
      let to = range.to;
      for (const span of spans) {
        if (span.piece.kept) continue;
        const inside = (p: number) => p > span.start && p < span.end;
        if ((from < span.end && to > span.start) || inside(from) || inside(to)) {
          from = Math.min(from, span.start);
          to = Math.max(to, span.end);
        }
      }
      const last = wide[wide.length - 1];
      if (last && from < last.to) {
        last.to = Math.max(last.to, to);
        last.with += range.with;
      } else wide.push({ from, to, with: range.with });
    }
    // 2. The view cut at the ranges: what lies between them keeps its pieces, each range becomes one withheld piece.
    const out: ViewPiece[] = [];
    const keepBetween = (from: number, to: number) => {
      for (const span of spans) {
        const a = Math.max(from, span.start);
        const b = Math.min(to, span.end);
        if (a >= b) continue;
        if (!span.piece.kept) out.push(span.piece);
        else out.push({ rawFrom: span.piece.rawFrom + (a - span.start), rawTo: span.piece.rawFrom + (b - span.start), text: span.piece.text.slice(a - span.start, b - span.start), kept: true });
      }
    };
    let at = 0;
    for (const range of wide) {
      keepBetween(at, range.from);
      const rawFrom = this.rawAt(range.from, spans);
      const rawTo = this.rawAt(range.to, spans);
      if (rawFrom === null || rawTo === null) throw new Error("A range of the view ends inside a withheld piece");
      out.push({ rawFrom, rawTo, text: range.with, kept: false });
      at = range.to;
    }
    keepBetween(at, Number.POSITIVE_INFINITY);
    return new ReaderView(this.raw, merged(out));
  }

  /**
   * Where a range of the view lies in the raw text, or null where it touches a withheld piece (an empty range at a
   * piece's edge touches nothing). The one way a change made on the view reaches the raw text.
   */
  toRaw(from: number, to: number): { from: number; to: number } | null {
    const spans = this.spans();
    if (spans.some((span) => !span.piece.kept && from < span.end && to > span.start)) return null;
    const rawFrom = this.rawAt(from, spans);
    const rawTo = this.rawAt(to, spans);
    return rawFrom !== null && rawTo !== null && rawFrom <= rawTo ? { from: rawFrom, to: rawTo } : null;
  }
}

/** Neighbouring kept pieces that continue each other become one. */
function merged(pieces: readonly ViewPiece[]): ViewPiece[] {
  const out: ViewPiece[] = [];
  for (const piece of pieces) {
    if (piece.kept && piece.text.length === 0) continue;
    const last = out[out.length - 1];
    if (last && last.kept && piece.kept && last.rawTo === piece.rawFrom) out[out.length - 1] = { ...last, rawTo: piece.rawTo, text: last.text + piece.text };
    else out.push(piece);
  }
  return out;
}

/** Placeholders a view writes: a text that carries one of them was made from a view, and is never written to a file. */
export const VIEW_PLACEHOLDER = /⟦(?:withheld [^⟧\n]*|place withheld)⟧/u;

/**
 * Applies a change made on the view's text to the raw text: the changed ranges (from a diff of the two view texts)
 * go back through `toRaw`. Null where a change touches a withheld piece, or where the new text carries a placeholder
 * — what is withheld is never changed, and never written, from a view.
 */
export function rawChangeOf(view: ReaderView, changed: string): string | null {
  const before = view.text;
  if (changed === before) return view.raw;
  const hunks = diffHunks(before, changed);
  let out = "";
  let at = 0;
  for (const hunk of hunks) {
    if (VIEW_PLACEHOLDER.test(hunk.with)) return null;
    const raw = view.toRaw(hunk.from, hunk.to);
    if (!raw) return null;
    out += view.raw.slice(at, raw.from) + hunk.with;
    at = raw.to;
  }
  return out + view.raw.slice(at);
}

/**
 * The changes from `before` to `after` as ranges of `before` and their new text, line by line (an LCS over lines,
 * then the common start and end of each changed block), so that changes far apart stay apart and a withheld piece
 * between them is not taken for touched.
 */
export function diffHunks(before: string, after: string): ViewReplacement[] {
  const a = splitKeep(before);
  const b = splitKeep(after);
  const n = a.length;
  const m = b.length;
  // LCS table over lines; notes are small enough, and a view is compared once per change.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const hunks: ViewReplacement[] = [];
  let i = 0;
  let j = 0;
  let offA = 0;
  let pending: { from: number; to: number; with: string } | null = null;
  const close = () => {
    if (!pending) return;
    // Narrow the block to what really differs inside it.
    const old = before.slice(pending.from, pending.to);
    const neu = pending.with;
    let s = 0;
    while (s < old.length && s < neu.length && old[s] === neu[s]) s++;
    let e = 0;
    while (e < old.length - s && e < neu.length - s && old[old.length - 1 - e] === neu[neu.length - 1 - e]) e++;
    hunks.push({ from: pending.from + s, to: pending.to - e, with: neu.slice(s, neu.length - e) });
    pending = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      close();
      offA += a[i]!.length;
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      pending ??= { from: offA, to: offA, with: "" };
      pending.with += b[j]!;
      j++;
    } else {
      pending ??= { from: offA, to: offA, with: "" };
      offA += a[i]!.length;
      pending.to = offA;
      i++;
    }
  }
  close();
  return hunks;
}

/** Lines with their line ends. */
function splitKeep(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    const end = text.indexOf("\n", at);
    const next = end < 0 ? text.length : end + 1;
    out.push(text.slice(at, next));
    at = next;
  }
  return out;
}
