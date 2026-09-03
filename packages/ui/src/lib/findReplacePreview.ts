import { buildSearchRegex, type FindReplaceOptions } from "@plainva/core";

/**
 * What a line looks like before and after the replacement (finding 2026-09-01,
 * D1 / P6). The old preview showed only WHERE a match sat; with a regex and
 * `$1` in the replacement that is the difference between a change one can
 * check and one that is guessed. Both shells render the two rows from this.
 */
export interface PreviewSegment {
  text: string;
  /** `hit` = the matched text (before row), `new` = what replaces it (after row). */
  kind: "plain" | "hit" | "new";
}

export interface LinePreview {
  before: PreviewSegment[];
  after: PreviewSegment[];
}

/**
 * Why the query is not a usable regular expression — the engine's own reason,
 * without its "Invalid regular expression: /…/:" preamble — or null when the
 * query is fine (or not a regex at all). The old dialog answered an invalid
 * expression with the same empty list as a word that does not exist.
 */
export function regexProblem(query: string, opts: FindReplaceOptions): string | null {
  if (!opts.regex || !query) return null;
  try {
    new RegExp(query, opts.matchCase ? "gu" : "giu");
    return null;
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return raw.replace(/^Invalid regular expression:\s*\/.*\/[a-z]*:\s*/i, "");
  }
}

/** Expands `$&`, `$1`…`$99`, `$<name>` and `$$` the way String.replace does. */
function expandReplacement(repl: string, match: string, groups: string[], named: Record<string, string> | undefined): string {
  return repl.replace(/\$(\$|&|<([^>]+)>|(\d{1,2}))/g, (whole, kind: string, name: string | undefined, num: string | undefined) => {
    if (kind === "$") return "$";
    if (kind === "&") return match;
    if (name !== undefined) return named?.[name] ?? "";
    const i = Number(num);
    if (i >= 1 && i <= groups.length) return groups[i - 1] ?? "";
    // `$12` with only one group means group 1 followed by a literal "2".
    if (i >= 10 && Math.floor(i / 10) <= groups.length) return (groups[Math.floor(i / 10) - 1] ?? "") + String(i % 10);
    return whole;
  });
}

export function previewLine(lineText: string, query: string, replacement: string, opts: FindReplaceOptions = {}): LinePreview {
  const re = buildSearchRegex(query, opts);
  const before: PreviewSegment[] = [];
  const after: PreviewSegment[] = [];
  if (!re) {
    if (lineText) {
      before.push({ text: lineText, kind: "plain" });
      after.push({ text: lineText, kind: "plain" });
    }
    return { before, after };
  }
  let cursor = 0;
  // The replacer sees every match with its groups and offset — the one place
  // where the expansion of `$1` is known exactly as the real replace will do it.
  lineText.replace(re, (...args: unknown[]) => {
    const match = args[0] as string;
    const hasNamed = typeof args[args.length - 1] === "object" && args[args.length - 1] !== null;
    const named = hasNamed ? (args[args.length - 1] as Record<string, string>) : undefined;
    const offset = args[hasNamed ? args.length - 3 : args.length - 2] as number;
    const groups = args.slice(1, hasNamed ? args.length - 3 : args.length - 2) as string[];
    const plain = lineText.slice(cursor, offset);
    if (plain) {
      before.push({ text: plain, kind: "plain" });
      after.push({ text: plain, kind: "plain" });
    }
    before.push({ text: match, kind: "hit" });
    const expanded = opts.regex ? expandReplacement(replacement, match, groups, named) : replacement;
    if (expanded) after.push({ text: expanded, kind: "new" });
    cursor = offset + match.length;
    // An empty match must not loop forever: the engine advances by itself,
    // the returned text only matters for the string we throw away.
    return match;
  });
  const rest = lineText.slice(cursor);
  if (rest) {
    before.push({ text: rest, kind: "plain" });
    after.push({ text: rest, kind: "plain" });
  }
  return { before, after };
}
