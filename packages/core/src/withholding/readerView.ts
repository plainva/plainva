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
   * Where a position of the raw text stands in the view: where it stands in a part the view shows, the start of the
   * placeholder for one inside a withheld part. What a place in the raw text — the line a link stands on — is in the
   * view, so a tool can cut its line out of the view of the whole note (review of R19, wave 2).
   */
  toView(position: number): number {
    for (const span of this.spans()) {
      if (position < span.piece.rawFrom || position > span.piece.rawTo) continue;
      if (span.piece.kept) return span.start + (position - span.piece.rawFrom);
      return position === span.piece.rawTo && position > span.piece.rawFrom ? span.end : span.start;
    }
    return this.text.length;
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

/**
 * Placeholders a view writes — `⟦withheld …⟧` (anything but a line end inside) and `⟦place withheld⟧`: a text that
 * carries one of them was made from a view, and is never written to a file.
 *
 * Found by a scan rather than the expression `/⟦(?:withheld [^⟧\n]*|place withheld)⟧/u` it matches exactly: that
 * expression, tried at every `⟦withheld ` of a line that never closes one, read the rest of the line again from each
 * — quadratic in a text a model or an app wrote (code scanning, js/polynomial-redos). Here a line that closes no
 * placeholder is read once.
 */
const WITHHELD_OPEN = "⟦withheld ";
const PLACE_WITHHELD = "⟦place withheld⟧";

/** The next placeholder at or after `from`, as `[start, end)`, or null; the matches the expression above finds, in order. */
function nextPlaceholder(text: string, from: number): [number, number] | null {
  let at = text.indexOf("⟦", from);
  while (at >= 0) {
    if (text.startsWith(PLACE_WITHHELD, at)) return [at, at + PLACE_WITHHELD.length];
    if (text.startsWith(WITHHELD_OPEN, at)) {
      let end = at + WITHHELD_OPEN.length;
      while (end < text.length && text[end] !== "⟧" && text[end] !== "\n") end++;
      if (text[end] === "⟧") return [at, end + 1];
      // No `⟧` before the line ends: no placeholder starts before that point either, since every one holds a `⟧`.
      at = text.indexOf("⟦", end);
      continue;
    }
    at = text.indexOf("⟦", at + 1);
  }
  return null;
}

/** Whether a text carries a placeholder of a view. */
export function carriesViewPlaceholder(text: string): boolean {
  return nextPlaceholder(text, 0) !== null;
}

/** What `rawChangeOf` makes of a change on the view. */
export type RawChange = { ok: true; raw: string } | { ok: false; problem: "withheld-part" | "too-long" };

/**
 * How many lines a change may add and remove together at most for `rawChangeOf` to compare it (the edit distance of
 * the Myers comparison): an edit of passages, however long the note; beyond it a change rewrites the note.
 */
export const VIEW_DIFF_EDITS_MAX = 2_000;

/**
 * Applies a change made on the view's text to the raw text: the changed ranges (from a diff of the two view texts)
 * go back through `toRaw`. Refused where a change touches a withheld piece, or where the text that would be written
 * holds more placeholders than the raw text did — what is withheld is never changed, and a placeholder is never
 * written, also not one completed from a piece the reader sees ("note⟧" made "⟦withheld note⟧", review of R19,
 * wave 2). A view that withholds nothing is the raw text: the change is taken as it is, without a comparison. The
 * comparison costs what the change costs, not what the note does (Myers, bounded by `VIEW_DIFF_EDITS_MAX`).
 */
export function rawChangeOf(view: ReaderView, changed: string): RawChange {
  const before = view.text;
  if (changed === before) return { ok: true, raw: view.raw };
  if (!view.withholds) {
    // Nothing withheld: only a placeholder brought in is refused.
    return placeholders(changed) > placeholders(view.raw) ? { ok: false, problem: "withheld-part" } : { ok: true, raw: changed };
  }
  const hunks = diffHunks(before, changed);
  if (!hunks) return { ok: false, problem: "too-long" };
  let out = "";
  let at = 0;
  for (const hunk of hunks) {
    if (carriesViewPlaceholder(hunk.with)) return { ok: false, problem: "withheld-part" };
    const raw = view.toRaw(hunk.from, hunk.to);
    if (!raw) return { ok: false, problem: "withheld-part" };
    out += view.raw.slice(at, raw.from) + hunk.with;
    at = raw.to;
  }
  const raw = out + view.raw.slice(at);
  // A placeholder put together from what stood beside a change (the check above sees each change alone).
  if (placeholders(raw) > placeholders(view.raw)) return { ok: false, problem: "withheld-part" };
  return { ok: true, raw };
}

/** How many placeholders a text carries. */
function placeholders(text: string): number {
  let count = 0;
  for (let found = nextPlaceholder(text, 0); found; found = nextPlaceholder(text, found[1])) count++;
  return count;
}

/**
 * The lines both texts keep, as pairs of line numbers in order (Myers' O(ND) comparison): null where more than
 * `maxEdits` lines would have to be added or removed. The memory it takes grows with the square of that number, never
 * with the length of the texts.
 */
function keptLines(a: readonly string[], b: readonly string[], maxEdits: number): [number, number][] | null {
  const n = a.length;
  const m = b.length;
  const most = Math.min(n + m, maxEdits);
  // v[k] for the diagonals k = x - y, kept for every step so the path can be walked back.
  const width = 2 * (n + m) + 4;
  const centre = n + m + 1;
  const v = new Int32Array(width);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= most && found < 0; d++) {
    trace.push(v.slice(centre - d - 1, centre + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[centre + k - 1]! < v[centre + k + 1]!) ? v[centre + k + 1]! : v[centre + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[centre + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d--) {
    const prev = trace[d]!;
    const at = (k: number) => prev[k + d + 1]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : at(prevK);
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      pairs.push([x - 1, y - 1]);
      x--;
      y--;
    }
    x = prevX;
    y = prevY;
  }
  return pairs.reverse();
}

/**
 * The changes from `before` to `after` as ranges of `before` and their new text, line by line: the common start
 * and end lines aside, the lines both keep (`keptLines`), then the common start and end of each changed block — so
 * that changes far apart stay apart and a withheld piece between them is not taken for touched. Null where the
 * change is larger than `VIEW_DIFF_EDITS_MAX` lines.
 */
export function diffHunks(before: string, after: string): ViewReplacement[] | null {
  const all = splitKeep(before);
  const bAll = splitKeep(after);
  let head = 0;
  while (head < all.length && head < bAll.length && all[head] === bAll[head]) head++;
  let tail = 0;
  while (tail < all.length - head && tail < bAll.length - head && all[all.length - 1 - tail] === bAll[bAll.length - 1 - tail]) tail++;
  const a = all.slice(head, all.length - tail);
  const b = bAll.slice(head, bAll.length - tail);
  const kept = keptLines(a, b, VIEW_DIFF_EDITS_MAX);
  if (!kept) return null;
  const hunks: ViewReplacement[] = [];
  const startOf = [all.slice(0, head).reduce((sum, line) => sum + line.length, 0)];
  for (const line of a) startOf.push(startOf[startOf.length - 1]! + line.length);
  const block = (fromA: number, toA: number, fromB: number, toB: number) => {
    if (fromA === toA && fromB === toB) return;
    const from = startOf[fromA]!;
    const to = startOf[toA]!;
    const neu = b.slice(fromB, toB).join("");
    // Narrow the block to what really differs inside it.
    const old = before.slice(from, to);
    let s = 0;
    while (s < old.length && s < neu.length && old[s] === neu[s]) s++;
    let e = 0;
    while (e < old.length - s && e < neu.length - s && old[old.length - 1 - e] === neu[neu.length - 1 - e]) e++;
    hunks.push({ from: from + s, to: to - e, with: neu.slice(s, neu.length - e) });
  };
  let i = 0;
  let j = 0;
  for (const [ka, kb] of kept) {
    block(i, ka, j, kb);
    i = ka + 1;
    j = kb + 1;
  }
  block(i, a.length, j, b.length);
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
