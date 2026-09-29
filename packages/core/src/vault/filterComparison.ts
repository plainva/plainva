/**
 * A `.base` comparison filter — `column op "value"` — read by hand (plan
 * Befunde 24.09., E6). The core evaluates it (`buildPropertyPredicate`), the
 * config panel edits it (`parsePropertyFilter`); both read it here, so they
 * cannot disagree on the grammar.
 *
 * Both carried `^(.+?)\s*(==|!=|>=|<=|>|<)\s*"((?:[^"\\]|\\.)*)"$`, where the
 * column and the blanks before the operator shared every blank: a filter with
 * a long run of blanks and no operator after it made the engine retry the
 * rest from each of them — quadratic on a filter from a synced `.base` file.
 *
 * The reading is the old one:
 *
 * - The column is the SHORTEST start of the filter (at least one character,
 *   no line break) that the rest completes: whitespace, an operator,
 *   whitespace, the quoted value.
 * - The operator is the first of `==`, `!=`, `>=`, `<=`, `>`, `<` that fits.
 * - The value is double-quoted, with `\` escaping any character but a line
 *   break, and its closing quote is the last character of the filter.
 *
 * Every start is decided in constant time from two tables built once from the
 * end of the filter.
 */

export type FilterComparisonOp = "==" | "!=" | ">=" | "<=" | ">" | "<";

export interface FilterComparison {
  /** The column as written, blanks around it included. */
  column: string;
  op: FilterComparisonOp;
  /** The value between the quotes, escapes still in place. */
  value: string;
}

const OPERATORS: readonly FilterComparisonOp[] = ["==", "!=", ">=", "<=", ">", "<"];
const WHITESPACE = /\s/;
/** What `.` does not match. */
const isLineBreak = (ch: string | undefined): boolean => ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029";

/** Reads a comparison filter, or null when the filter is none. */
export function readFilterComparison(filter: string): FilterComparison | null {
  const n = filter.length;
  if (filter[n - 1] !== "\"") return null;
  // spaceEnd[i]: the first index at or after i that is no whitespace.
  // stringEnd[i]: where the escaped string body starting at i stops — at a
  // quote, a backslash with nothing it may escape, or the end.
  const spaceEnd = new Int32Array(n + 1), stringEnd = new Int32Array(n + 1);
  spaceEnd[n] = n;
  stringEnd[n] = n;
  for (let i = n - 1; i >= 0; i--) {
    const ch = filter[i];
    spaceEnd[i] = WHITESPACE.test(ch) ? spaceEnd[i + 1] : i;
    if (ch === "\"") stringEnd[i] = i;
    else if (ch !== "\\") stringEnd[i] = stringEnd[i + 1];
    else stringEnd[i] = i + 1 < n && !isLineBreak(filter[i + 1]) ? stringEnd[i + 2] : i;
  }

  for (let columnEnd = 1; columnEnd <= n && !isLineBreak(filter[columnEnd - 1]); columnEnd++) {
    const opAt = spaceEnd[columnEnd];
    for (const op of OPERATORS) {
      if (!filter.startsWith(op, opAt)) continue;
      const open = spaceEnd[opAt + op.length];
      if (filter[open] === "\"" && open + 1 < n && stringEnd[open + 1] === n - 1) {
        return { column: filter.slice(0, columnEnd), op, value: filter.slice(open + 1, n - 1) };
      }
    }
  }
  return null;
}
