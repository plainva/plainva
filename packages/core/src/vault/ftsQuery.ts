/**
 * Safe FTS5 query construction for the vault full-text search.
 *
 * User input must NEVER reach `MATCH` verbatim: FTS5 treats the string as
 * query syntax, so partial words match nothing ("Projek" finds no "Projekt")
 * and characters like `- ( ) " :` raise syntax errors that leave the UI with
 * stale results. This module tokenizes the input and emits every term as a
 * quoted (double-quote-escaped) token, plus a small operator grammar:
 *
 *   term          -> prefix match while typing:   "term"*
 *   "a phrase"    -> exact phrase (whole words):  "a phrase"
 *   "unclosed…    -> phrase in progress:          "unclosed…"*
 *   -term         -> exclusion (files matching it are dropped)
 *   path:sub      -> path substring filter (case-insensitive), negatable
 *   tag:x / tag:#x-> tag filter (exact or nested `x/…`), negatable
 *
 * Excluded terms are kept OUT of the main MATCH expression (no FTS5 `NOT`
 * precedence pitfalls); the caller applies them as a `NOT IN (… MATCH ?)`
 * subquery instead.
 */

/** Sentinel markers used by snippet()/highlight() so the UI can render
 *  matches safely (split on markers -> <mark>), never via raw HTML. The SQL
 *  side emits them as char(1)/char(2); control characters are practically
 *  impossible in markdown text. */
export const SNIPPET_MARK_START = "\u0001";
export const SNIPPET_MARK_END = "\u0002";

export interface ParsedSearchQuery {
  /** AND-joined positive FTS5 expression, or null when no text terms remain. */
  match: string | null;
  /** OR-joined excluded FTS5 expression (for a NOT IN subquery), or null. */
  notMatch: string | null;
  /** Raw positive term texts in input order (UI highlighting / jump target). */
  terms: string[];
  /** Lowercased path substrings that must appear in the file path. */
  paths: string[];
  /** Lowercased path substrings that must NOT appear in the file path. */
  notPaths: string[];
  /** Tags (without leading '#') the file must carry (exact or nested). */
  tags: string[];
  /** Tags the file must NOT carry. */
  notTags: string[];
}

/** True when the parse produced no usable condition at all. */
export function isEmptySearchQuery(q: ParsedSearchQuery): boolean {
  return (
    q.match === null &&
    q.notMatch === null &&
    q.paths.length === 0 &&
    q.notPaths.length === 0 &&
    q.tags.length === 0 &&
    q.notTags.length === 0
  );
}

/** Quotes a text as an exact FTS5 phrase (no prefix star). Shared with the
 *  graph's unlinked-mention scan so note titles containing quotes or FTS5
 *  operators can never raise MATCH syntax errors. */
export function ftsPhrase(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

/** Quotes a term for FTS5; the optional `*` turns the last token of the
 *  quoted phrase into a prefix query. */
function ftsTerm(text: string, prefix: boolean): string {
  return `${ftsPhrase(text)}${prefix ? "*" : ""}`;
}

// One token per iteration: optional `-`, optional `path:`/`tag:` operator,
// then either a quoted chunk (possibly unclosed at end of input) or a bare
// word. Bare words stop at whitespace and quotes.
const TOKEN_RE = /(-)?(path:|tag:)?(?:"([^"]*)("|$)|([^\s"]+))/gi;

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const positives: string[] = [];
  const negatives: string[] = [];
  const terms: string[] = [];
  const paths: string[] = [];
  const notPaths: string[] = [];
  const tags: string[] = [];
  const notTags: string[] = [];

  for (const m of (input ?? "").matchAll(TOKEN_RE)) {
    const negated = m[1] === "-";
    const op = m[2]?.toLowerCase();
    const quoted = m[3] !== undefined;
    const closed = m[4] === '"';
    const raw = (quoted ? m[3] : m[5])?.trim() ?? "";
    if (!raw) continue;

    if (op === "path:") {
      (negated ? notPaths : paths).push(raw.toLowerCase());
      continue;
    }
    if (op === "tag:") {
      const tag = raw.replace(/^#+/, "");
      if (tag) (negated ? notTags : tags).push(tag);
      continue;
    }

    // Terms without a single letter/digit tokenize to nothing in unicode61;
    // an empty quoted phrase would be an FTS5 syntax error, so drop them.
    if (!/[\p{L}\p{N}]/u.test(raw)) continue;

    // Closed phrases stay exact (the whole-word escape hatch); bare tokens
    // and a trailing unclosed phrase match as prefixes so results appear
    // while the user is still typing.
    const prefix = !quoted || !closed;
    (negated ? negatives : positives).push(ftsTerm(raw, prefix));
    if (!negated) terms.push(raw);
  }

  return {
    match: positives.length > 0 ? positives.join(" AND ") : null,
    notMatch: negatives.length > 0 ? negatives.join(" OR ") : null,
    terms,
    paths,
    notPaths,
    tags,
    notTags,
  };
}
