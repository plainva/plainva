/**
 * Vault-wide find & replace (B6) — pure text side. The per-note flow lives in
 * CodeMirror's own panel; this covers the whole vault: preview matches with
 * line context, then replace, writing back through the app's atomic + backup
 * chain (the caller's job). Literal by default; optional case / whole-word /
 * regex, mirroring the in-editor panel's options.
 */

export interface FindReplaceOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

export interface TextMatch {
  /** 1-based line number of the match. */
  line: number;
  /** Match start/end offset within the whole content. */
  start: number;
  end: number;
  /** The full text of the line the match starts on (preview context). */
  lineText: string;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Global RegExp for the query + options, or null if the query is empty or an
 *  invalid regex (regex mode). */
export function buildSearchRegex(query: string, opts: FindReplaceOptions = {}): RegExp | null {
  if (!query) return null;
  let source = opts.regex ? query : escapeRegExp(query);
  if (opts.wholeWord) source = `\\b(?:${source})\\b`;
  const flags = "g" + (opts.matchCase ? "" : "i");
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/** All matches of the query in the content, each with its 1-based line number
 *  and the text of that line for a preview. Zero-width matches are skipped. */
export function findMatchesInText(content: string, query: string, opts: FindReplaceOptions = {}): TextMatch[] {
  const re = buildSearchRegex(query, opts);
  if (!re) return [];
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") lineStarts.push(i + 1);
  const lineIndexOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const matches: TextMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[0] === "") {
      re.lastIndex++; // never loop forever on a zero-width match
      continue;
    }
    const li = lineIndexOf(m.index);
    const lineEnd = li + 1 < lineStarts.length ? lineStarts[li + 1] - 1 : content.length;
    matches.push({ line: li + 1, start: m.index, end: m.index + m[0].length, lineText: content.slice(lineStarts[li], lineEnd) });
  }
  return matches;
}

/** Replaces every match and returns the new content plus the number of matches
 *  replaced. In regex mode the replacement supports `$1`/`$&` backreferences; in
 *  literal mode a `$` in the replacement stays literal. */
export function replaceAllInText(
  content: string,
  query: string,
  replacement: string,
  opts: FindReplaceOptions = {}
): { content: string; count: number } {
  const re = buildSearchRegex(query, opts);
  if (!re) return { content, count: 0 };
  const count = findMatchesInText(content, query, opts).length;
  if (count === 0) return { content, count: 0 };
  const repl = opts.regex ? replacement : replacement.replace(/\$/g, "$$$$");
  return { content: content.replace(re, repl), count };
}
