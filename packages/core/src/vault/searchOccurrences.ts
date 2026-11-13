import { analyzeNoteSource } from "../noteSource.js";
import { stripAnchorMarkers } from "../workspace/commentAnchor.js";
import { excludedSearchTermSpecs, searchTermSpecs, SNIPPET_MARK_END, SNIPPET_MARK_START } from "./ftsQuery.js";
import { matchTerm, piecedTerm, piecedWord, SEARCH_WORD, type PiecedTerm } from "./spacelessText.js";

export interface SearchOccurrence {
  from: number;
  to: number;
  line: number;
  /** The exact original spelling, used to detect a stale indexed address. */
  quote: string;
  before: string;
  after: string;
  headings: string[];
}

function searchTerms(query: string): PiecedTerm[] {
  return searchTermSpecs(query).map((term) => piecedTerm(term.text, term.prefix)).filter((term) => term.words.length);
}

/**
 * The matches of `terms` in `text`, in order and without overlap: words match
 * as the index finds them (`spacelessText.ts`) — Latin and other spaced
 * scripts from the word start, Chinese, Japanese, Thai and the like anywhere
 * inside a run. Several matches can start in one word (a term twice in one
 * Japanese run); where two overlap, the earlier and longer one stands.
 */
function matchRanges(text: string, terms: PiecedTerm[], limit: number, accept: (from: number) => boolean = () => true): { from: number; to: number }[] {
  const words = Array.from(text.matchAll(SEARCH_WORD), (match) => piecedWord(match[0], match.index));
  const ranges: { from: number; to: number }[] = [];
  for (let i = 0; i < words.length && ranges.length < limit; i++) {
    const found = terms.flatMap((term) => matchTerm(term, words, i)).sort((a, b) => a.from - b.from || b.to - a.to);
    for (const range of found) {
      if (ranges.length >= limit) break;
      if (!accept(range.from)) continue;
      const previous = ranges[ranges.length - 1];
      if (previous && range.from < previous.to) continue;
      ranges.push(range);
    }
  }
  return ranges;
}

/**
 * `text` with every match of the query wrapped in the snippet marks, or null
 * without one — the title highlight for matches FTS5 found in the pair
 * columns, where its own `highlight()` has nothing to mark.
 */
export function markSearchMatches(text: string, query: string): string | null {
  const terms = searchTerms(query);
  if (!text || !terms.length) return null;
  const ranges = matchRanges(text, terms, 100);
  if (!ranges.length) return null;
  let out = "";
  let at = 0;
  for (const range of ranges) {
    out += `${text.slice(at, range.from)}${SNIPPET_MARK_START}${text.slice(range.from, range.to)}${SNIPPET_MARK_END}`;
    at = range.to;
  }
  return out + text.slice(at);
}

/** Bounded output, resumable within a note; all positions refer to original bytes. */
export function findSearchOccurrences(raw: string, query: string, options: { from?: number; limit?: number } = {}): { occurrence: SearchOccurrence; snippet: string }[] {
  const limit = Math.min(101, Math.max(1, options.limit ?? 41));
  const start = Math.max(0, options.from ?? 0);
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const clean = stripAnchorMarkers(raw);
  const positions = matchRanges(clean.text, terms, limit, (from) => clean.toRaw(from) >= start);
  if (!positions.length) return [];
  const headings = analyzeNoteSource(raw).headings;
  let line = 1, previous = 0, headingIndex = 0;
  const chain: typeof headings = [];
  return positions.map((position) => {
    const from = clean.toRaw(position.from), to = clean.toRaw(position.to, "before");
    for (let i = previous; i < from; i++) if (raw[i] === "\n") line++;
    previous = from;
    while (headingIndex < headings.length && headings[headingIndex].from <= from) {
      const heading = headings[headingIndex++];
      while (chain.length && chain[chain.length - 1].level >= heading.level) chain.pop();
      chain.push(heading);
    }
    const before = clean.text.slice(Math.max(0, position.from - 60), position.from).replace(/\s+/g, " ");
    const after = clean.text.slice(position.to, position.to + 100).replace(/\s+/g, " ");
    return { occurrence: { from, to, line, quote: raw.slice(from, to), before: raw.slice(Math.max(0, from - 32), from), after: raw.slice(to, to + 32), headings: chain.map((h) => h.text) }, snippet: `${position.from > 60 ? "…" : ""}${before}${SNIPPET_MARK_START}${clean.text.slice(position.from, position.to)}${SNIPPET_MARK_END}${after}${position.to + 100 < clean.text.length ? "…" : ""}` };
  });
}

/** One term of a query as a query of its own. */
const termQuery = (term: { text: string; prefix: boolean }) => (term.prefix ? term.text : `"${term.text}"`);

/**
 * Whether a text answers a query as the index would — every term it asks for found in it, none it excludes — with
 * the words of the full-text search (`spacelessText.ts`). For a reader that sees a note through a view: a hit the
 * index found in the raw text stays only where its view answers too, and is left out in doubt (review of R19,
 * wave 2). `text` is what the reader may see of the note: its title, its path and its view.
 */
export function viewMatchesSearch(text: string, input: string): boolean {
  for (const term of searchTermSpecs(input)) if (findSearchOccurrences(text, termQuery(term), { limit: 1 }).length === 0) return false;
  for (const term of excludedSearchTermSpecs(input)) if (findSearchOccurrences(text, termQuery(term), { limit: 1 }).length > 0) return false;
  return true;
}

/**
 * The first place a text answers a query, as a snippet with the search's marks: the line it stands in, cut to at
 * most 60 characters before and 100 after the match. Null where the text answers nowhere.
 */
export function viewSearchSnippet(text: string, input: string): string | null {
  const first = findSearchOccurrences(text, searchTermSpecs(input).map(termQuery).join(" "), { limit: 1 })[0];
  if (!first) return null;
  const { from, to } = first.occurrence;
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const lineEnd = text.indexOf("\n", to) < 0 ? text.length : text.indexOf("\n", to);
  const start = Math.max(lineStart, from - 60);
  const end = Math.min(lineEnd, to + 100);
  return `${start > lineStart ? "…" : ""}${text.slice(start, from)}${SNIPPET_MARK_START}${text.slice(from, to)}${SNIPPET_MARK_END}${text.slice(to, end)}${end < lineEnd ? "…" : ""}`.trim();
}

/** What a reader with a view sends to the index, and tests against the view itself. */
export { excludedSearchTermSpecs, withoutExcludedSearchTerms } from "./ftsQuery.js";
