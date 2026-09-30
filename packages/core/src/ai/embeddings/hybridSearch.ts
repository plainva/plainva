/**
 * Search by words, by meaning, or by both (plan KI-Harness P2a-4, mockup
 * chapter 10), behind the one paging contract every search surface already
 * uses (`searchOccurrencesPage`, `useSearchPages`).
 *
 * - Words is the full-text search as it was: every occurrence, any order.
 * - Meaning ranks notes by the closest chunk to the question; a hit points
 *   at that chunk.
 * - Both ranks the notes of the two by reciprocal rank fusion — in the spike
 *   88 % of the questions found their note among the first five, against 62 %
 *   by words alone.
 *
 * Meaning and both list each note once, its best place first, and say what
 * found it (`found`). The query's operators — `path:`, `tag:`, excluded words
 * — limit the meaning hits exactly as they limit the words. A chosen order
 * other than relevance is the words' search: meaning is a ranking.
 */
import type { SearchOrder, SearchPage, SearchPageCursor, SearchResult, VaultQueryService } from "../../vault/VaultQueryService.js";
import { findSearchOccurrences } from "../../vault/searchOccurrences.js";
import { parseSearchQuery } from "../../vault/ftsQuery.js";
import { chunkNote } from "./chunks.js";
import type { EmbeddingIndexer } from "./pipeline.js";
import { fuseRankings } from "./search.js";
import type { SearchMode } from "./searchMode.js";


/** Notes each side contributes to a fused list. */
const WORD_NOTES = 100;
const MEANING_NOTES = 50;
/** Meaning hits fetched before the operators thin them out. */
const MEANING_CANDIDATES = 200;
/** Characters of a chunk shown as a meaning hit's excerpt. */
const EXCERPT = 180;

type WordSearch = Pick<VaultQueryService, "searchOccurrencesPage" | "searchFullText" | "filterByOperators" | "fileRecords">;

export interface HybridSearchSource {
  words: WordSearch;
  /** The vault's embedding indexer, or null while no model is active. */
  meaning(): EmbeddingIndexer | null;
  mode(): SearchMode;
  /** A note's text now: the excerpt of a meaning hit is cut from it. */
  readText(path: string): Promise<string | null>;
}

interface RankedNote {
  path: string;
  words: boolean;
  meaning: boolean;
  /** The best chunk, for a note found by meaning. */
  ordinal?: number;
}

/** The text of a query without its operators: what search by meaning compares. */
export function meaningText(query: string): string {
  return parseSearchQuery(query).terms.join(" ").trim();
}

const plainExcerpt = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT)}…` : flat;
};

export class HybridSearchService {
  private cache: { key: string; notes: RankedNote[] } | null = null;

  constructor(private readonly source: HybridSearchSource) {}

  /** The mode in effect: words while no model is active. */
  activeMode(): SearchMode {
    return this.source.meaning() ? this.source.mode() : "words";
  }

  async searchOccurrencesPage(
    query: string,
    options: { cursor?: SearchPageCursor | null; limit?: number; signal?: AbortSignal; order?: SearchOrder | null } = {},
  ): Promise<SearchPage> {
    const indexer = this.source.meaning();
    const mode = this.activeMode();
    if (!indexer || mode === "words" || (options.order && options.order.key !== "relevance") || !meaningText(query)) {
      const page = await this.source.words.searchOccurrencesPage(query, options);
      return mode === "words" ? page : { ...page, hits: page.hits.map((hit) => ({ ...hit, found: "words" as const })) };
    }
    const limit = Math.min(100, Math.max(1, options.limit ?? 40));
    const orderId = `${mode}:${indexer.engineId}`;
    const cursor = options.cursor?.query === query && options.cursor.order === orderId ? options.cursor : null;
    const offset = cursor?.noteOffset ?? 0;
    // A first page ranks afresh (the index may have moved); later pages page through that ranking.
    const notes = await this.ranked(query, mode, indexer, !cursor, options.signal);
    options.signal?.throwIfAborted();
    const slice = notes.slice(offset, offset + limit);
    const records = await this.source.words.fileRecords(slice.map((note) => note.path));
    const hits: SearchResult[] = [];
    for (const note of slice) {
      options.signal?.throwIfAborted();
      const record = records.get(note.path);
      if (!record) continue;
      const found = note.words && note.meaning ? "both" : note.words ? "words" : "meaning";
      const content = await this.source.readText(note.path);
      if (content === null) continue;
      if (note.words) {
        const [first] = findSearchOccurrences(content, query, { limit: 1 });
        hits.push(first ? { ...record, titleHighlighted: null, ...first, found } : { ...record, found });
        continue;
      }
      const chunk = chunkNote(record.title || note.path, content).find((c) => c.ordinal === note.ordinal);
      if (!chunk || chunk.to <= chunk.from) {
        hits.push({ ...record, found });
        continue;
      }
      const body = content.slice(chunk.from, chunk.to);
      const firstLine = body.split("\n", 1)[0]!;
      const line = content.slice(0, chunk.from).split("\n").length;
      hits.push({
        ...record,
        titleHighlighted: null,
        found,
        snippet: plainExcerpt(body),
        occurrence: {
          from: chunk.from,
          to: chunk.from + firstLine.length,
          line,
          quote: firstLine,
          before: content.slice(Math.max(0, chunk.from - 32), chunk.from),
          after: content.slice(chunk.from + firstLine.length, chunk.from + firstLine.length + 32),
          headings: chunk.chain ? chunk.chain.split(" > ") : [],
        },
      });
    }
    const next = offset + limit < notes.length ? { query, order: orderId, noteOffset: offset + limit, from: 0 } : null;
    return { hits, next };
  }

  /** The note ranking of a query, kept for its later pages. */
  private async ranked(query: string, mode: SearchMode, indexer: EmbeddingIndexer, fresh: boolean, signal?: AbortSignal): Promise<RankedNote[]> {
    const key = `${mode}\0${indexer.engineId}\0${query}`;
    if (!fresh && this.cache?.key === key) return this.cache.notes;
    const words = mode === "both" ? (await this.source.words.searchFullText(query, WORD_NOTES, 0)).map((row) => row.path) : [];
    signal?.throwIfAborted();
    const candidates = await indexer.search(meaningText(query), MEANING_CANDIDATES, undefined, signal);
    const allowed = await this.source.words.filterByOperators(query, candidates.map((hit) => hit.path));
    const meaning = candidates.filter((hit) => allowed.has(hit.path)).slice(0, MEANING_NOTES);
    const best = new Map(meaning.map((hit) => [hit.path, hit.ordinal]));
    const fused = fuseRankings({ words, meaning: meaning.map((hit) => hit.path) });
    const notes = fused.map((hit) => ({
      path: hit.path,
      words: hit.ranks.words !== undefined,
      meaning: hit.ranks.meaning !== undefined,
      ordinal: best.get(hit.path),
    }));
    this.cache = { key, notes };
    return notes;
  }
}
