import { trimEndChars } from "../textScan.js";
import { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import { applySortRules, buildFilterNodePredicate, filterNeedsTags, isSourceFilter, normalizeSortRules, parseDatabaseSourceFilter } from "./databaseQueryHelpers.js";
import { normalizeDatabaseMetadata } from "./databaseMetadata.js";
import { getPlainvaMeta, PLAINVA_NAMESPACE_KEY } from "../metadata.js";
import { isReservedOkfName } from "../okf-conversion.js";
import { escapeLikePrefix } from "./VaultIndexer.js";
import { ftsPhrase, isEmptySearchQuery, parseSearchQuery, SNIPPET_MARK_END, SNIPPET_MARK_START, type ParsedSearchQuery } from "./ftsQuery.js";
import { formatTaskProgress, scanTasks, taskProgressOf, type ScannedTask } from "./taskScan.js";

/** Whether any view of the config renders `file.tasks`: a board (its cards
 * carry the checklist progress) or a view whose column order names it. */
function needsTaskProgress(config: any): boolean {
  const views: any[] = Array.isArray(config?.views) ? config.views : [];
  return views.some((v) => v?.type === "board" || (Array.isArray(v?.order) && v.order.includes("file.tasks")));
}
import { findMatchesInText, type FindReplaceOptions, type TextMatch } from "./findReplace.js";
import { contentHasTag } from "./renameTag.js";
import { readFrontmatterPath } from "../frontmatter-surgical.js";
import { likeAnySpelling } from "../db/likeEscape.js";
import { buildLinkTargetIndex, linkTargetName, resolveLinkRow, resolveLinkTargetIndexed, resolveMarkdownLinkIndexed, type LinkTargetIndex, type MarkdownLinkAnswer } from "./LinkResolver.js";
import { aggregateRollup, normalizeRollup, wikiLinkTarget, type RollupSpec } from "./rollup.js";
import { findSearchOccurrences, markSearchMatches, type SearchOccurrence } from "./searchOccurrences.js";
import { hasSpacelessText, spacelessRetrievalTerms } from "./spacelessText.js";
import { decodeIndexedProperty } from "./indexedProperty.js";

export interface FileRecord {
  id: string;
  path: string;
  title: string;
  mtime_local: number;
  size_bytes: number;
}

export interface SearchResult extends FileRecord {
  occurrence?: SearchOccurrence;
  /** Requested only by the bounded occurrence reader, never returned to a UI. */
  sourceContent?: string;
  /** Content excerpt with SNIPPET_MARK sentinels around matches; null when
   *  the query had no text terms (pure path:/tag: search). */
  snippet?: string | null;
  /** Title with SNIPPET_MARK sentinels when the match hit the title — the UI
   *  uses this both for highlighting and to group "file name" hits. */
  titleHighlighted?: string | null;
  /** What found the hit when search by meaning takes part (plan KI-Harness P2a-4): the badge on the row. */
  found?: "words" | "meaning" | "both";
}

/**
 * The order of search hits (finding 2026-09-19). Relevance was the only one;
 * a reader looking for "the note I changed yesterday" had no way to say so.
 * The order is part of the QUERY, not a client-side shuffle: hits arrive page
 * by page, and a page sorted after the fact would reorder under the reader's
 * eyes with every "load more".
 */
export type SearchOrderKey = "relevance" | "modified" | "title" | "path";
export interface SearchOrder {
  key: SearchOrderKey;
  dir: "asc" | "desc";
}

/** The cursor's word for an order — a page belongs to the order it was cut from. */
export function searchOrderId(order: SearchOrder | null | undefined): string {
  return !order || order.key === "relevance" ? "relevance" : `${order.key}:${order.dir}`;
}

export interface SearchPageCursor {
  query: string;
  noteOffset: number;
  from: number;
  path?: string;
  mtime?: number;
  /** `searchOrderId` of the order this cursor continues; absent = relevance (cursors from before the option). */
  order?: string;
}
export interface SearchPage { hits: SearchResult[]; next: SearchPageCursor | null }

/**
 * The SQL of a query's operators on `files f`: excluded words, `path:` and
 * `-path:`, `tag:` and `-tag:` (nested tags count). One definition for the
 * full-text search and for the filter search by meaning goes through.
 */
function operatorClauses(parsed: ParsedSearchQuery): { where: string[]; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (parsed.notMatch !== null) {
    where.push(`f.path NOT IN (SELECT path FROM fts_notes WHERE fts_notes MATCH ?)`);
    params.push(parsed.notMatch);
  }
  for (const p of parsed.paths) {
    where.push(`instr(lower(f.path), ?) > 0`);
    params.push(p);
  }
  for (const p of parsed.notPaths) {
    where.push(`instr(lower(f.path), ?) = 0`);
    params.push(p);
  }
  for (const tag of parsed.tags) {
    where.push(`EXISTS (SELECT 1 FROM tags t WHERE t.file_id = f.id AND (t.tag = ? OR t.tag LIKE ?))`);
    params.push(tag, `${tag}/%`);
  }
  for (const tag of parsed.notTags) {
    where.push(`NOT EXISTS (SELECT 1 FROM tags t WHERE t.file_id = f.id AND (t.tag = ? OR t.tag LIKE ?))`);
    params.push(tag, `${tag}/%`);
  }
  return { where, params };
}

/**
 * A note's provider-task anchor as the index knows it.
 *
 * `account` is the LOCAL account id and only present on anchors written before
 * the reconnect fix — it changes on every reconnect and must never decide a
 * match. `provider` and `identity` are the stable pair that replaced it; both
 * stay optional because CalDAV has no profile to verify an identity against.
 */
export interface TaskAnchorRecord {
  path: string;
  uid: string;
  list: string;
  /** Legacy, tolerated on read, never compared. */
  account?: string;
  provider?: string;
  identity?: string;
  ctime: number | null;
}

// The pre-filter of the backlinks; the pickers above the core narrow a list of names with it too.
export { likeAnySpelling };

/** A file as the link rule reads it from the index (`VaultQueryService.linkTargets`). */
export interface LinkTargetRow {
  path: string;
  /** For a note the `title` of its properties, else its file's name without `.md`; for any other file its name. */
  title: string | null;
  /** `attachment` for everything that is no note — a `.base` database among them. */
  mode: string | null;
}

export interface LinkRecord {
  source_path: string;
  /** The linking note's indexed title and modification time — what a backlink list names and sorts its rows by. */
  source_title?: string | null;
  source_mtime?: number | null;
  target_path: string;
  link_type: string;
  anchor?: string | null;
  line_number?: number | null;
  /** Frontmatter key the link came from; null/undefined = body link. */
  property_key?: string | null;
}

export interface RelationSource {
  path: string;
  title: string;
}

/** One incoming frontmatter-property link onto a target note (any key). */
export interface IncomingRelationRef {
  path: string;
  title: string;
  propertyKey: string;
}

/** One task checkbox found anywhere in the vault, with the note it lives in. */
export interface TaskRecord extends ScannedTask {
  path: string;
  title: string;
  /** True when the note opts out of task aggregation (`plainva.tasks: false`
   * in its frontmatter) — the view hides these by default. */
  excluded: boolean;
}

/** Body/tags/ctime of one note, for content-rendering views (plan Pinboard P2). */
export interface NoteCardData {
  /** A file row without indexed text is not an empty note. */
  indexStatus?: "ready" | "missing";
  /** Full note text from the FTS index (frontmatter included; callers strip it). */
  content: string;
  tags: string[];
  /** files.ctime (index v3); null for legacy rows — fall back to mtime. */
  ctime: number | null;
}

/** One note that contains matches for a vault-wide find (B6). */
export interface VaultFindResult {
  path: string;
  title: string;
  matchCount: number;
  /** Up to `limitPerNote` matches with line context, for the preview. */
  matches: TextMatch[];
}

/** The index stores the file time as the adapter reports it; older rows may be seconds. */
function epochMs(value: unknown): number {
  const n = Number(value) || 0;
  return n > 0 && n < 100_000_000_000 ? n * 1000 : n;
}

/** The same in SQL: a row's file time as milliseconds, for a comparison and an order the unit of an old row does not upset. */
const MTIME_MS = "(CASE WHEN mtime_local > 0 AND mtime_local < 100000000000 THEN mtime_local * 1000 ELSE mtime_local END)";

export class VaultQueryService {
  /** Sentinels wrapping matches in `snippet`/`titleHighlighted` (see ftsQuery.ts).
   *  Exposed here so UI code can consume them without a package-root export. */
  static readonly SNIPPET_MARK_START = SNIPPET_MARK_START;
  static readonly SNIPPET_MARK_END = SNIPPET_MARK_END;

  constructor(public readonly db: IDatabaseAdapter) {}

  /** Parses the search-box grammar (prefix terms, "phrases", -exclusions,
   *  path:/tag: filters); UI code uses `terms` for highlighting and the
   *  jump-to-match target. */
  static parseSearchQuery(input: string): ParsedSearchQuery {
    return parseSearchQuery(input);
  }

  /**
   * Searches the vault using SQLite FTS5. The user input goes through
   * parseSearchQuery — every text term becomes a quoted prefix token, so
   * results appear while typing and no input can raise FTS5 syntax errors.
   */
  async searchFullText(query: string, limit: number = 50, offset = 0, includeSource = false, order?: SearchOrder | null): Promise<SearchResult[]> {
    const parsed = parseSearchQuery(query);
    if (isEmptySearchQuery(parsed)) return [];

    const where: string[] = [];
    const params: unknown[] = [];
    let select: string;
    let from: string;
    let orderBy: string;

    if (parsed.match !== null) {
      // char(1)/char(2) are the SNIPPET_MARK sentinels — the UI splits on
      // them and renders <mark> nodes itself (never raw HTML from content).
      select = `f.id, f.path, f.title, f.mtime_local, f.size_bytes,
        snippet(fts_notes, 0, char(1), char(2), '…', 12) AS snippet,
        highlight(fts_notes, 1, char(1), char(2)) AS titleHighlighted`;
      from = `fts_notes fn JOIN files f ON f.path = fn.path`;
      where.push(`fts_notes MATCH ?`);
      params.push(parsed.match);
      // Title hits outrank body hits (fts_notes column order: content, title,
      // path, then the pair form of content and title for text written
      // without spaces — weighed like the text it stands for).
      orderBy = `bm25(fts_notes, 1.0, 4.0, 0.0, 1.0, 4.0)`;
    } else {
      // Pure operator query (path:/tag:/-term only) — no FTS ranking source.
      select = `f.id, f.path, f.title, f.mtime_local, f.size_bytes,
        NULL AS snippet, NULL AS titleHighlighted`;
      from = `files f`;
      orderBy = `f.mtime_local DESC`;
    }
    // A chosen order replaces the ranking (finding 2026-09-19). Only literals
    // from this table reach the statement — never the caller's strings.
    if (order && order.key !== "relevance") {
      const column = order.key === "modified" ? "f.mtime_local" : order.key === "title" ? "f.title COLLATE NOCASE" : "f.path COLLATE NOCASE";
      orderBy = `${column} ${order.dir === "asc" ? "ASC" : "DESC"}`;
    }

    const operators = operatorClauses(parsed);
    where.push(...operators.where);
    params.push(...operators.params);

    const sql = `
      SELECT ${select}${includeSource ? ", (SELECT content FROM fts_notes WHERE path = f.path LIMIT 1) AS sourceContent" : ""}
      FROM ${from}
      WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy}, f.path ASC
      LIMIT ?${offset > 0 ? " OFFSET ?" : ""}
    `;
    params.push(limit);
    if (offset > 0) params.push(offset);
    const rows: SearchResult[] = await this.db.query(sql, params);
    // A match in the pair columns leaves FTS5's title highlight without a
    // mark; the title is marked from the text itself then.
    if (parsed.match !== null && parsed.terms.some(hasSpacelessText)) {
      for (const row of rows) {
        if (!row.titleHighlighted?.includes(SNIPPET_MARK_START)) row.titleHighlighted = markSearchMatches(row.title ?? "", query) ?? row.titleHighlighted;
      }
    }
    return rows;
  }

  /**
   * Of `paths`, the notes the query's operators admit — `path:`, `tag:` and
   * excluded words, whatever its other words. Search by meaning ranks by what
   * the words mean and keeps the operators' limits this way (plan KI-Harness
   * P2a-4).
   */
  async filterByOperators(query: string, paths: readonly string[]): Promise<Set<string>> {
    const { where, params } = operatorClauses(parseSearchQuery(query));
    if (!where.length || !paths.length) return new Set(paths);
    const out = new Set<string>();
    for (let i = 0; i < paths.length; i += 200) {
      const group = paths.slice(i, i + 200);
      const rows = await this.db.query<{ path: string }>(
        `SELECT f.path AS path FROM files f WHERE f.path IN (${group.map(() => "?").join(", ")}) AND ${where.join(" AND ")}`,
        [...group, ...params],
      );
      for (const row of rows) out.add(row.path);
    }
    return out;
  }

  /** The size of all notes together, in bytes: a vault's measure for estimates (search by meaning's load dialog). */
  async noteBytes(): Promise<number> {
    const row = await this.db.queryOne<{ bytes: number | null }>(
      `SELECT SUM(size_bytes) AS bytes FROM files WHERE mode != 'attachment' AND path NOT LIKE '%.base'`,
    );
    return Number(row?.bytes ?? 0) || 0;
  }

  /** File records by path; a path the index does not know is left out. */
  async fileRecords(paths: readonly string[]): Promise<Map<string, FileRecord>> {
    const out = new Map<string, FileRecord>();
    for (let i = 0; i < paths.length; i += 200) {
      const group = paths.slice(i, i + 200);
      const rows = await this.db.query<FileRecord>(
        `SELECT id, path, title, mtime_local, size_bytes FROM files WHERE path IN (${group.map(() => "?").join(", ")})`,
        group,
      );
      for (const row of rows) out.set(row.path, row);
    }
    return out;
  }

  /** At most sixteen notes and one display page per call; no invented total. */
  async searchOccurrencesPage(query: string, options: { cursor?: SearchPageCursor | null; limit?: number; signal?: AbortSignal; order?: SearchOrder | null } = {}): Promise<SearchPage> {
    // A cursor continues ONE query in ONE order. A page cut from another order
    // would resume at an offset that means something else there, so it is
    // dropped like a cursor of another query and the list starts over.
    const order = searchOrderId(options.order);
    const cursor = options.cursor?.query === query && (options.cursor.order ?? "relevance") === order ? options.cursor : null;
    const limit = Math.min(100, Math.max(1, options.limit ?? 40));
    const offset = Math.max(0, cursor?.noteOffset ?? 0);
    options.signal?.throwIfAborted();
    const rows = await this.searchFullText(query, 17, offset, true, options.order ?? null);
    options.signal?.throwIfAborted();
    const hits: SearchResult[] = [];
    for (let index = 0; index < Math.min(16, rows.length); index++) {
      options.signal?.throwIfAborted();
      const { sourceContent, ...record } = rows[index];
      const from = index === 0 && cursor?.path === record.path && cursor.mtime === record.mtime_local ? cursor.from : 0;
      const occurrences = findSearchOccurrences(sourceContent ?? "", query, { from, limit: limit - hits.length + 1 });
      const visible = occurrences.slice(0, limit - hits.length);
      hits.push(...visible.map((hit) => ({ ...record, titleHighlighted: null, ...hit })));
      // Operator-only/title-only matches remain navigable even without a body address.
      if (!occurrences.length && from === 0) hits.push(record);
      if (occurrences.length > visible.length) return { hits, next: { query, order, noteOffset: offset + index, from: visible[visible.length - 1]?.occurrence.to ?? from, path: record.path, mtime: record.mtime_local } };
      if (hits.length >= limit) return { hits, next: index + 1 < rows.length ? { query, order, noteOffset: offset + index + 1, from: 0 } : null };
    }
    return { hits, next: rows.length > 16 ? { query, order, noteOffset: offset + 16, from: 0 } : null };
  }

  /**
   * Searches for files by title or path using substring match.
   */
  async searchFilesByTitle(query: string, limit: number = 20): Promise<FileRecord[]> {
    const likeQuery = `%${query}%`;
    const sql = `
      SELECT id, path, title, mtime_local, size_bytes
      FROM files
      WHERE title LIKE ? OR path LIKE ?
      ORDER BY 
        CASE 
          WHEN title LIKE ? THEN 1
          ELSE 2
        END,
        mtime_local DESC
      LIMIT ?
    `;
    return await this.db.query(sql, [likeQuery, likeQuery, `${query}%`, limit]);
  }

  /**
   * Retrieves the most recently modified files.
   */
  async getRecentFiles(limit: number = 10): Promise<FileRecord[]> {
    const sql = `
      SELECT id, path, title, mtime_local, size_bytes
      FROM files
      ORDER BY mtime_local DESC
      LIMIT ?
    `;
    return await this.db.query(sql, [limit]);
  }

  /**
   * Candidates for the AI's context package (plan KI-Harness §8.1): notes
   * matching ANY of the terms, best first, with their BM25 score (sign turned,
   * so higher is better) and an excerpt. The search box joins its terms with
   * AND, which is right for a query someone types and wrong for a question in
   * a sentence — that would find nothing.
   */
  async searchCandidates(terms: readonly string[], limit = 30): Promise<{ path: string; title: string; score: number; snippet: string | null; mtime: number }[]> {
    const usable = terms.filter((term) => /[\p{L}\p{N}]/u.test(term)).slice(0, 12);
    if (usable.length === 0) return [];
    // Chinese, Japanese and Thai terms go to the pair columns as their pairs
    // (spacelessText.ts); a whole run would only find the exact phrase.
    const conditions = new Set<string>();
    for (const term of usable) {
      if (hasSpacelessText(term)) for (const condition of spacelessRetrievalTerms(term)) conditions.add(condition);
      else conditions.add(`${ftsPhrase(term)}*`);
    }
    const match = [...conditions].slice(0, 48).join(" OR ");
    const rows = await this.db.query<{ path: string; title: string; score: number; snippet: string | null; mtime_local: number }>(
      `SELECT f.path AS path, f.title AS title, f.mtime_local AS mtime_local,
         -bm25(fts_notes, 1.0, 4.0, 0.0, 1.0, 4.0) AS score,
         snippet(fts_notes, 0, char(1), char(2), '…', 16) AS snippet
       FROM fts_notes fn JOIN files f ON f.path = fn.path
       WHERE fts_notes MATCH ? AND (f.is_deleted IS NULL OR f.is_deleted = 0)
       ORDER BY bm25(fts_notes, 1.0, 4.0, 0.0, 1.0, 4.0), f.path ASC
       LIMIT ?`,
      [match, limit],
    );
    return rows.map((row) => ({ path: row.path, title: row.title, score: Number(row.score) || 0, snippet: row.snippet ?? null, mtime: epochMs(row.mtime_local) }));
  }

  /** Notes by their last change on disk, newest first (a sync counts as a change). */
  async getRecentlyChangedNotes(limit = 20): Promise<{ path: string; title: string; mtime: number }[]> {
    const rows = await this.db.query<{ path: string; title: string; mtime_local: number }>(
      `SELECT path, title, mtime_local FROM files
       WHERE path LIKE '%.md' AND (is_deleted IS NULL OR is_deleted = 0)
       ORDER BY mtime_local DESC LIMIT ?`,
      [limit],
    );
    return rows.map((row) => ({ path: row.path, title: row.title, mtime: epochMs(row.mtime_local) }));
  }

  /**
   * The notes in a folder and below it whose file changed after `since`
   * (epoch milliseconds), newest first, at most `limit` — each with the
   * instant its file was made on this device, where the index knows it
   * (`files.ctime`, index v3). A sync counts as a change, and a note another
   * device made arrives here as made now. `""` is the whole vault. The log of
   * a folder (plan KI-Harness P8-2) asks this; it sorts out what it may name.
   *
   * The time is compared as milliseconds, whatever unit an older row kept it
   * in; the folder by both spellings of its letters, a wildcard in its name
   * taken literally.
   */
  async getNotesChangedIn(folder: string, since: number, limit = 100): Promise<{ path: string; title: string; mtime: number; created: number | null }[]> {
    const conditions = ["path LIKE '%.md'", "(is_deleted IS NULL OR is_deleted = 0)", `${MTIME_MS} > ?`];
    const params: unknown[] = [since];
    if (folder) {
      const variants = [...new Set([folder.normalize("NFC"), folder.normalize("NFD")])];
      conditions.push(`(${variants.map(() => "path LIKE ? ESCAPE '\\'").join(" OR ")})`);
      params.push(...variants.map((variant) => `${escapeLikePrefix(variant)}/%`));
    }
    const rows = await this.db.query<{ path: string; title: string; mtime_local: number; ctime: number | null }>(
      `SELECT path, title, mtime_local, ctime FROM files WHERE ${conditions.join(" AND ")} ORDER BY ${MTIME_MS} DESC LIMIT ?`,
      [...params, Math.max(1, Math.min(500, Math.floor(limit) || 100))],
    );
    return rows.map((row) => ({ path: row.path, title: row.title, mtime: epochMs(row.mtime_local), created: row.ctime == null ? null : epochMs(row.ctime) }));
  }

  /**
   * When a note was made, as the index knows it (`files.ctime`, index v3:
   * the time it first saw the file, which a save never changes), in epoch
   * milliseconds; null for a note it does not know and for a row from before
   * v3. Where the history of a note begins (AI harness P9-1).
   */
  async getNoteCreated(path: string): Promise<number | null> {
    const variants = [...new Set([path.normalize("NFC"), path.normalize("NFD")])];
    const rows = await this.db.query<{ ctime: number | null }>(
      `SELECT ctime FROM files WHERE path IN (${variants.map(() => "?").join(", ")}) AND (is_deleted IS NULL OR is_deleted = 0) LIMIT 1`,
      variants,
    );
    const ctime = rows[0]?.ctime;
    const created = ctime == null ? 0 : epochMs(ctime);
    return created > 0 ? created : null;
  }

  /**
   * The notes linked with one note, both ways — who links here and where it
   * links, resolved as the graph resolves them. One entry per note with both
   * counts, the busiest first. The graph source of the AI's context package.
   */
  async getLinkNeighbors(path: string, limit = 30): Promise<{ path: string; title: string; incoming: number; outgoing: number }[]> {
    const counts = new Map<string, { incoming: number; outgoing: number }>();
    const bump = (other: string, key: "incoming" | "outgoing") => {
      if (other === path) return;
      const entry = counts.get(other) ?? { incoming: 0, outgoing: 0 };
      entry[key] += 1;
      counts.set(other, entry);
    };
    for (const link of await this.getBacklinks(path)) bump(link.source_path, "incoming");
    const outgoing = await this.db.query<{ target_path: string; link_type: string | null }>(
      `SELECT l.target_path AS target_path, l.link_type AS link_type FROM links l JOIN files f ON f.id = l.source_id WHERE f.path = ?`,
      [path],
    );
    if (outgoing.length) {
      // The one rule over its one corpus (ADR 0027), each link by the way it is written — as the backlinks
      // above read theirs, so a link is a neighbour in both directions or in neither.
      const corpus = await this.linkLookup();
      for (const row of outgoing) {
        const resolved = resolveLinkRow(path, row.target_path, row.link_type, corpus);
        if (resolved && /\.md$/i.test(resolved)) bump(resolved, "outgoing");
      }
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1].incoming + b[1].outgoing - (a[1].incoming + a[1].outgoing) || a[0].localeCompare(b[0])).slice(0, limit);
    const titles = new Map<string, string>();
    for (let i = 0; i < ranked.length; i += 400) {
      const chunk = ranked.slice(i, i + 400).map(([p]) => p);
      const rows = await this.db.query<{ path: string; title: string }>(
        `SELECT path, title FROM files WHERE path IN (${chunk.map(() => "?").join(",")})`,
        chunk,
      );
      for (const row of rows) titles.set(row.path, row.title);
    }
    return ranked.map(([other, c]) => ({ path: other, title: titles.get(other) ?? other.replace(/^.*\//, "").replace(/\.md$/i, ""), incoming: c.incoming, outgoing: c.outgoing }));
  }

  /**
   * Lists the paths of all `.base` database files in the vault.
   */
  async listBaseFilePaths(): Promise<string[]> {
    const rows = await this.db.query<{ path: string }>(
      `SELECT path FROM files WHERE path LIKE '%.base'`,
    );
    return rows.map((r) => r.path).filter(Boolean);
  }

  /**
   * Lists all notes (non-attachment, non-`.base`) as path/title pairs ordered by
   * title. Powers note pickers such as relation editors and link suggestions;
   * `title` falls back to the path so every entry is displayable.
   */
  async listNotes(limit?: number): Promise<{ path: string; title: string }[]> {
    const sql =
      `SELECT path, title FROM files WHERE mode != 'attachment' AND path NOT LIKE '%.base' ORDER BY title` +
      (limit !== undefined ? ` LIMIT ?` : ``);
    const rows = await this.db.query<{ path: string; title: string | null }>(
      sql,
      limit !== undefined ? [limit] : [],
    );
    return rows.filter((r) => !!r.path).map((r) => ({ path: r.path, title: r.title || r.path }));
  }

  /**
   * Notes touched inside a time window (mtime_local, [from, to) in ms) —
   * the mobile Today tab's "edited on this day" list (R3.5). Attachments
   * and .base files never appear; newest first.
   */
  async listNotesModifiedBetween(
    fromMs: number,
    toMs: number,
  ): Promise<{ path: string; title: string; mtime_local: number }[]> {
    const rows = await this.db.query<{ path: string; title: string | null; mtime_local: number }>(
      `SELECT path, title, mtime_local FROM files
       WHERE mode != 'attachment' AND path NOT LIKE '%.base'
         AND mtime_local >= ? AND mtime_local < ?
       ORDER BY mtime_local DESC`,
      [fromMs, toMs],
    );
    return rows
      .filter((r) => !!r.path)
      .map((r) => ({ path: r.path, title: r.title || r.path, mtime_local: r.mtime_local }));
  }

  /** Every .base database in the vault (mobile databases hub, R2.4). */
  /**
   * What the vault holds: notes vs. attachments (settings → maintenance).
   *
   * The split is the `mode` column — everything that is not an attachment is a
   * note, so a new mode counts as a note rather than vanishing from both sums.
   * It lives here because BOTH shells ask the question and the answer is a
   * decision about the index, not about a screen; the desktop carried this
   * query inline until S39, which is how a second, differently-rounded answer
   * would have appeared on the phone.
   */
  /**
   * How many notes live under each subfolder of `folder`, RECURSIVELY.
   *
   * The phone's folder rows counted one level with a directory listing, so a
   * folder holding nothing but subfolders reported "0 notes" beside a chevron
   * that leads to hundreds of them (S21). Recursing with listings would mean a
   * call per level on every browse; the index already knows every path, so one
   * query answers the whole listing.
   *
   * "Note" is the same predicate as `listNotes` on purpose: a second, differently
   * rounded definition of what counts is exactly how two screens come to disagree.
   * Only entries that live BELOW a subfolder are counted — a direct child of
   * `folder` has no slash left in its remainder and belongs to no subfolder.
   */
  async countNotesPerSubfolder(folder: string): Promise<Map<string, number>> {
    const prefix = folder ? `${trimEndChars(folder, "/")}/` : "";
    const rows = await this.db.query<{ folder: string; n: number }>(
      `SELECT substr(rest, 1, instr(rest, '/') - 1) AS folder, COUNT(*) AS n
       FROM (SELECT substr(path, ?) AS rest FROM files
             WHERE mode != 'attachment' AND path NOT LIKE '%.base' AND path LIKE ? ESCAPE '\\')
       WHERE instr(rest, '/') > 0
       GROUP BY folder`,
      [prefix.length + 1, `${escapeLikePrefix(prefix)}%`],
    );
    const out = new Map<string, number>();
    for (const r of rows) if (r.folder) out.set(String(r.folder), Number(r.n));
    return out;
  }

  async getVaultStats(): Promise<{ notes: number; attachments: number }> {
    const rows = await this.db.query<{ mode: string; n: number }>(
      `SELECT mode, COUNT(*) AS n FROM files GROUP BY mode`,
      [],
    );
    let notes = 0;
    let attachments = 0;
    for (const row of rows) {
      if (String(row.mode) === "attachment") attachments += Number(row.n);
      else notes += Number(row.n);
    }
    return { notes, attachments };
  }

  async listBases(): Promise<{ path: string; title: string }[]> {
    const rows = await this.db.query<{ path: string; title: string | null }>(
      `SELECT path, title FROM files WHERE path LIKE '%.base' ORDER BY path`,
      [],
    );
    return rows
      .filter((r) => !!r.path)
      .map((r) => ({ path: r.path, title: r.title || r.path.split("/").pop()!.replace(/\.base$/i, "") }));
  }

  /**
   * Every GFM task checkbox in the vault (B4 vault-wide Tasks view). Reads the
   * note text straight from the FTS index (no extra file I/O) and extracts task
   * lines with {@link scanTasks}; each task keeps its note path/title and the
   * document-order ordinal that toggleTaskAtIndex needs to flip it back.
   */
  async listTasks(): Promise<TaskRecord[]> {
    const rows = await this.db.query<{ path: string; title: string | null; content: string | null }>(
      `SELECT path, title, content FROM fts_notes`,
      [],
    );
    const out: TaskRecord[] = [];
    for (const r of rows) {
      if (!r.path) continue;
      const content = r.content ?? "";
      const scanned = scanTasks(content);
      if (scanned.length === 0) continue;
      const title = r.title || r.path.split("/").pop()!.replace(/\.md$/i, "");
      // Truth stays in the file: a note opts out of task aggregation by carrying
      // `plainva.tasks: false` in its frontmatter (templates, drafts, …). The
      // frontmatter parse only runs for notes that actually contain tasks.
      const excluded = readFrontmatterPath(content, ["plainva", "tasks"]) === false;
      for (const task of scanned) {
        out.push({ path: r.path, title, excluded, ...task });
      }
    }
    return out;
  }

  /**
   * Sets `file.tasks` on every row: "done/total" of the note's GFM checkboxes
   * (`taskProgressOf`), "" when it has none. A board card renders the value as
   * a progress bar; any view can show it as a column. Rows whose note is not
   * in the FTS index (a `.base`, a non-note file) get "".
   */
  private async attachTaskProgress(rows: Record<string, any>[]): Promise<void> {
    const paths = rows.map((r) => String(r["file.path"] ?? "")).filter(Boolean);
    const progress = new Map<string, string>();
    const chunkSize = 500;
    for (let i = 0; i < paths.length; i += chunkSize) {
      const chunk = paths.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(",");
      const contentRows = await this.db.query<{ path: string; content: string | null }>(
        `SELECT path, content FROM fts_notes WHERE path IN (${placeholders})`,
        chunk,
      );
      for (const r of contentRows) {
        if (r?.path) progress.set(r.path, formatTaskProgress(taskProgressOf(r.content ?? "")));
      }
    }
    for (const row of rows) row["file.tasks"] = progress.get(String(row["file.path"] ?? "")) ?? "";
  }

  /**
   * Card data for content-rendering views (plan Pinboard P2): the note BODY
   * from the FTS index (no file I/O — the listTasks/findInVault pattern), the
   * note's tags and its creation time (`files.ctime`, index v3; null for rows
   * indexed before v3 — callers fall back to mtime). Chunked IN queries respect
   * SQLite's bound-variable limit; paths missing from the index are simply
   * absent from the result.
   */
  /** Board-local substring search, Unicode case folding, bounded reads and path-only results.
   * Search the note body, not hidden YAML properties. Metadata matches use the visible row fields.
   *
   * The pattern is deliberately wider than `frontmatterSpan`: a card hides what
   * merely looks like a block as well (one closed by the YAML document end
   * `...`), so the search over cards does. Like the definition it lets the
   * closing line follow the opening one directly — an empty block ends there,
   * not at a rule further down in the text.
   */
  async searchCardContent(paths: string[], query: string, signal?: AbortSignal): Promise<string[]> {
    const needle = query.trim().normalize("NFC").toLocaleLowerCase();
    if (!needle || paths.length === 0) return [];
    const found: string[] = [];
    const unique = [...new Set(paths)];
    for (let i = 0; i < unique.length; i += 200) {
      if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
      const chunk = unique.slice(i, i + 200);
      const rows = await this.db.query<{ path: string; content: string | null }>(
        `SELECT path, content FROM fts_notes WHERE path IN (${chunk.map(() => "?").join(",")})`, chunk,
      );
      for (const row of rows) {
        const body = (row.content ?? "").replace(/^\uFEFF?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)??(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, "");
        if (body.normalize("NFC").toLocaleLowerCase().includes(needle)) found.push(row.path);
      }
    }
    return found;
  }

  async getCardData(paths: string[]): Promise<Record<string, NoteCardData>> {
    const out: Record<string, NoteCardData> = {};
    if (paths.length === 0) return out;
    const chunkSize = 500;
    for (let i = 0; i < paths.length; i += chunkSize) {
      const chunk = paths.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => "?").join(",");
      const contentRows = await this.db.query<{ path: string; content: string | null }>(
        `SELECT path, content FROM fts_notes WHERE path IN (${placeholders})`,
        chunk,
      );
      for (const r of contentRows) {
        if (!r.path) continue;
        out[r.path] = { content: r.content ?? "", tags: [], ctime: null };
      }
      const fileRows = await this.db.query<{ path: string; ctime: number | null }>(
        `SELECT path, ctime FROM files WHERE path IN (${placeholders})`,
        chunk,
      );
      for (const r of fileRows) {
        if (!r.path) continue;
        if (!out[r.path]) out[r.path] = { content: "", tags: [], ctime: null, indexStatus: "missing" };
        out[r.path].ctime = r.ctime ?? null;
      }
      const tagRows = await this.db.query<{ path: string; tag: string }>(
        `SELECT f.path AS path, t.tag AS tag FROM tags t JOIN files f ON f.id = t.file_id WHERE f.path IN (${placeholders})`,
        chunk,
      );
      for (const r of tagRows) {
        if (r.path && r.tag && out[r.path]) out[r.path].tags.push(r.tag);
      }
    }
    return out;
  }

  /**
   * Vault-wide find (B6 preview): every note whose text matches, with a capped
   * set of matches (line context) each. Reads note text from the FTS index (no
   * extra file I/O); the actual replace re-reads each file so the write is always
   * against the current on-disk content.
   */
  async findInVault(query: string, opts: FindReplaceOptions = {}, limitPerNote = 100): Promise<VaultFindResult[]> {
    if (!query) return [];
    const rows = await this.db.query<{ path: string; title: string | null; content: string | null }>(
      `SELECT path, title, content FROM fts_notes`,
      [],
    );
    const out: VaultFindResult[] = [];
    for (const r of rows) {
      if (!r.path) continue;
      const matches = findMatchesInText(r.content ?? "", query, opts);
      if (matches.length === 0) continue;
      out.push({
        path: r.path,
        title: r.title || r.path.split("/").pop()!.replace(/\.md$/i, ""),
        matchCount: matches.length,
        matches: matches.slice(0, limitPerNote),
      });
    }
    return out;
  }

  /**
   * Paths of every note carrying the tag (exact or a `tag/sub` child), in the
   * body or the frontmatter (B6 tag rename). Reads text from the FTS index; the
   * caller re-reads each candidate before rewriting it.
   */
  async findNotesWithTag(tag: string): Promise<string[]> {
    const rows = await this.db.query<{ path: string; content: string | null }>(
      `SELECT path, content FROM fts_notes`,
      [],
    );
    const out: string[] = [];
    for (const r of rows) {
      if (r.path && contentHasTag(r.content ?? "", tag)) out.push(r.path);
    }
    return out;
  }

  /**
   * Every file a link can lead to, as the link rule reads the vault
   * (`LinkResolver.ts`): the path, the title the index holds — for a note the
   * `title` of its properties where it has one, otherwise its file's name —
   * and the mode, which tells a note from an attachment. A file queued for
   * deletion is no target any more. One corpus for every question about a
   * link: a different one per caller is how a link came to lead somewhere in
   * the graph and nowhere in the editor (finding 2026-10-08). The assistant's
   * privacy gate reads it too, for every file a link could mean
   * (`buildLinkNameIndex`): one read for a whole text's links.
   */
  async linkTargets(): Promise<LinkTargetRow[]> {
    return this.db.query<LinkTargetRow>(`SELECT path, title, mode FROM files WHERE is_deleted IS NULL OR is_deleted = 0`);
  }

  /**
   * Where a link leads: the vault path of the file `target` names, read from
   * the note at `sourcePath`, or null where it names none (a click then offers
   * to create the note). THE answer of both shells — the editor and the
   * reading view, a database cell, the journal, a relation chip and an embed
   * ask it — by the one rule the graph and the backlinks follow
   * (`resolveLinkTargetIndexed`). An alias or an anchor left on the target is
   * ignored. Without a source the answer is the same unless two files share
   * the name: the note beside the linking one can then not come first.
   */
  async resolveNotePath(target: string, sourcePath?: string): Promise<string | null> {
    const name = linkTargetName(target);
    if (!name) return null;
    return resolveLinkTargetIndexed(sourcePath ?? "", name, await this.linkLookup());
  }

  /**
   * Where a MARKDOWN link leads — `[text](target)`, `target` being what
   * `markdownLinkTarget` reads from its URL: the file, or the folder with the
   * `index.md` in it, or null. By the Markdown rule (`resolveMarkdownLinkIndexed`:
   * read from the folder of the note at `sourcePath` first, then where the wiki
   * link of the same text leads) over the same corpus `resolveNotePath` reads,
   * so a click, the graph and the backlinks give one answer.
   */
  async resolveMarkdownLink(target: string, sourcePath?: string): Promise<MarkdownLinkAnswer> {
    if (!target.trim()) return null;
    return resolveMarkdownLinkIndexed(sourcePath ?? "", target, await this.linkLookup());
  }

  /**
   * The lookup over `linkTargets()` for one answer. Callers that ask in one
   * turn share a read — a note full of embeds asks once, not once per embed.
   * The read begins only after they have all asked, and whoever asks once it
   * has begun gets a read of its own: an answer is never older than the
   * question, so a note the indexer has just taken in is found by the very
   * next question (a shared read that was already under way answered "no such
   * note" for it). Nothing is kept once it has answered.
   */
  private linkLookup(): Promise<LinkTargetIndex> {
    this.linkLookupAhead ??= Promise.resolve().then(async () => {
      this.linkLookupAhead = null;
      return buildLinkTargetIndex(await this.linkTargets());
    });
    return this.linkLookupAhead;
  }
  private linkLookupAhead: Promise<LinkTargetIndex> | null = null;

  /**
   * A file by its bare basename, anywhere in the vault — how Obsidian writes
   * and finds attachments (`![[foto.png]]`, the file in its attachments
   * folder). Notes and attachments alike, by the link rule
   * (`resolveLinkTargetIndexed`), read from the note at `nearPath`: of several
   * files of one name the one beside that note comes first, then the shorter
   * path, then the alphabet. A query of its own stood here until 2026-10-09 —
   * it folded A to Z only (`![[übersicht.png]]` did not find `Übersicht.png`,
   * which the phone and the graph did), looked at fifty rows at most and left
   * two paths of one length to the order the database handed them out.
   */
  async findByFileName(basename: string, nearPath?: string): Promise<string | null> {
    const name = basename.trim();
    if (!name || name.includes("/") || name.includes("\\")) return null;
    return resolveLinkTargetIndexed(nearPath ?? "", name, await this.linkLookup());
  }

  /**
   * The notes whose text contains one of `needles` literally — a scan of the
   * stored note texts, not a search: no tokens, no operators, punctuation as
   * it stands; ASCII letters in either case, as LIKE compares them. For
   * questions the link table cannot answer, such as "which notes name this
   * file": a Markdown image (`![](a.png)`) is no link there, and an
   * attachment is no link target (see `getBacklinks`). `truncated` says that
   * there were more than `limit` — the answer is then incomplete, and a
   * caller that must not miss a note has to treat it as "cannot tell".
   */
  async notesContaining(needles: readonly string[], limit = 200): Promise<{ paths: string[]; truncated: boolean }> {
    const wanted = [...new Set(needles.filter((needle) => needle.length > 0))].slice(0, 8);
    if (wanted.length === 0) return { paths: [], truncated: false };
    const rows = await this.db.query<{ path: string }>(
      `SELECT path FROM fts_notes WHERE ${wanted.map(() => "content LIKE ? ESCAPE '\\'").join(" OR ")} ORDER BY path LIMIT ?`,
      [...wanted.map((needle) => `%${needle.replace(/[\\%_]/g, "\\$&")}%`), limit + 1],
    );
    const paths = [...new Set(rows.map((row) => row.path))];
    return { paths: paths.slice(0, limit), truncated: paths.length > limit };
  }

  /**
   * Finds all files that link to the given path (Backlinks).
   */
  async getBacklinks(targetPath: string): Promise<LinkRecord[]> {
    // 1. The files a link can lead to — the one corpus of the link rule
    // (`linkTargets`). `.base` files are indexed as attachments but ARE
    // legitimate link targets (embeds, template assignments): without them a
    // link onto a .base could never resolve, so backlinks stayed empty and
    // renames silently broke every reference.
    const files = await this.linkTargets();

    // 2. Fetch the links that COULD mean this file. A link the rule leads here
    // names the file at its END — the file's name alone or behind folders, for
    // a note with or without `.md` — or is, as a whole, the title a note's
    // properties carry (step 5 of the rule). Each in any spelling the rule
    // reads as the same name (`likeAnySpelling`); the resolution below decides.
    // The patterns are anchored at the end of the target: "contains the name"
    // fetched every link onto `Briefkasten` and `Briefe/…` for the note
    // `Brief`, and for a name written in letters beyond ASCII every link row
    // of the vault.
    // Ordered (finding 2026-09-19): the statement had no ORDER BY, so the rows
    // came in whatever order the link table held them and the same note could
    // list its backlinks differently from one open to the next. Path and line
    // make the base order definite; the panels sort by the reader's choice on
    // top of it, using the title and the time that ride along here.
    const fileName = targetPath.split(/[/\\]/).pop() ?? "";
    const isNote = /\.md$/i.test(fileName);
    const patterns = new Set<string>();
    for (const spelling of likeAnySpelling(isNote ? fileName.replace(/\.md$/i, "") : fileName)) {
      for (const tail of isNote ? [spelling, `${spelling}.md`] : [spelling]) {
        patterns.add(tail);
        patterns.add(`%/${tail}`);
      }
    }
    const ownTitle = isNote ? files.find((f) => f.path === targetPath)?.title : null;
    if (typeof ownTitle === "string" && ownTitle.trim()) for (const spelling of likeAnySpelling(ownTitle.trim())) patterns.add(spelling);
    // A Markdown link that names a FOLDER leads to the `index.md` in it: its
    // target ends in a slash or in a dot segment (`Folder/`, `../`, `..`), not
    // in the file's name.
    if (/^index\.md$/i.test(fileName)) for (const tail of ["%/", ".", "..", "%/.", "%/.."]) patterns.add(tail);
    const sql = `
      SELECT f.path as source_path, f.title as source_title, f.mtime_local as source_mtime,
        l.target_path, l.link_type, l.anchor, l.line_number, l.property_key
      FROM links l
      JOIN files f ON f.id = l.source_id
      WHERE ${[...patterns].map(() => `l.target_path LIKE ? ESCAPE '\\'`).join(" OR ")}
      ORDER BY f.path COLLATE NOCASE ASC, l.line_number ASC
    `;
    const candidateLinks = await this.db.query<LinkRecord>(sql, [...patterns]);

    // 3. Resolve each link and filter by exact match to targetPath. The corpus
    // index is built ONCE (P2.3) — resolving per candidate against the raw
    // array was O(candidates × files) and ran on every file switch.
    const resolvedLinks: LinkRecord[] = [];
    const corpus = buildLinkTargetIndex(files);

    for (const link of candidateLinks) {
      // By the way the link was written (`link_type`): a Markdown link is read
      // from the linking note's folder first. Resolved by the wiki rule alone,
      // the entry `[Letter](Letter.md)` of a listing was a backlink of the note
      // `Letter.md` at the vault's ROOT instead of the one beside the listing.
      const resolvedPath = resolveLinkRow(link.source_path, link.target_path, link.link_type, corpus);
      if (resolvedPath === targetPath) {
        resolvedLinks.push(link);
      }
    }

    return resolvedLinks;
  }

  /**
   * All notes whose frontmatter property `propertyKey` links to one of
   * `targetPaths` (link-target resolution identical to getBacklinks). Powers
   * computed reverse-relation columns. Self-links are excluded, sources are
   * deduped per target and sorted by title. Map keys are the requested target
   * paths; targets without sources are absent.
   */
  async getRelationSources(
    targetPaths: string[],
    propertyKey: string
  ): Promise<Map<string, RelationSource[]>> {
    return this._getRelationSources(targetPaths, propertyKey, await this.linkTargets());
  }

  /** Variant sharing the resolver corpus across several reverse columns of one query. */
  private async _getRelationSources(
    targetPaths: string[],
    propertyKey: string,
    files: readonly LinkTargetRow[]
  ): Promise<Map<string, RelationSource[]>> {
    const result = new Map<string, RelationSource[]>();
    if (targetPaths.length === 0 || !propertyKey) return result;

    const rows = await this.db.query<{ source_path: string; source_title: string | null; target_path: string }>(
      `SELECT f.path AS source_path, f.title AS source_title, l.target_path AS target_path
       FROM links l
       JOIN files f ON f.id = l.source_id
       WHERE l.property_key = ?`,
      [propertyKey]
    );

    const targets = new Set(targetPaths);
    const { buildLinkTargetIndex, resolveLinkTargetIndexed } = await import("./LinkResolver.js");
    const corpus = buildLinkTargetIndex(files);
    const seen = new Set<string>();
    for (const row of rows) {
      const resolved = resolveLinkTargetIndexed(row.source_path, row.target_path, corpus);
      if (!resolved || !targets.has(resolved)) continue;
      if (resolved === row.source_path) continue; // a note never appears in its own reverse list
      const dedupeKey = `${resolved}\n${row.source_path}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const bucket = result.get(resolved) ?? [];
      bucket.push({ path: row.source_path, title: row.source_title || row.source_path });
      result.set(resolved, bucket);
    }
    for (const bucket of result.values()) {
      bucket.sort((a, b) => a.title.localeCompare(b.title));
    }
    return result;
  }

  /**
   * Fill the rollup columns of one result set.
   *
   * A rollup reaches through a link column of THIS base (a stored relation or a
   * computed reverse column — both hold wiki-link strings by the time we get
   * here) and aggregates one property of the notes on the other side.
   *
   * Deliberately NOT supported: a rollup whose `through` is itself a rollup.
   * Chaining derivations would make the order of enrichment part of the file
   * format, and a cycle would be a hang rather than a wrong number. Such a
   * column simply stays empty.
   */
  private async _enrichRollups(config: any, result: any[]): Promise<void> {
    const columns = (config?.columns ?? {}) as Record<string, any>;
    const specs: Array<[string, RollupSpec]> = [];
    for (const [name, col] of Object.entries(columns)) {
      const spec = normalizeRollup((col as any)?.rollup);
      if (!spec) continue;
      if (columns[spec.through]?.rollup) continue; // no rollup over a rollup
      specs.push([name, spec]);
    }
    if (specs.length === 0 || result.length === 0) return;

    // Every link value that any rollup needs to follow, resolved once — by
    // the link rule over the one corpus. A rollup reaches through to NOTES
    // only: an attachment or a database carries no properties.
    const { noteLinkResolver } = await import("./LinkResolver.js");
    const linkedNote = noteLinkResolver(await this.linkTargets());

    const linkedPaths = new Set<string>();
    const perRow = new Map<any, Map<string, string[]>>();
    for (const row of result) {
      const byThrough = new Map<string, string[]>();
      for (const [, spec] of specs) {
        if (byThrough.has(spec.through)) continue;
        let raw = row[spec.through];
        if (raw === undefined) {
          // A hidden through-property need not be a visible/configured column.
          // Apply the same case fallback as for the linked value itself.
          const key = Object.keys(row).find(key => key.toLowerCase() === spec.through.toLowerCase());
          if (key !== undefined) raw = row[key];
        }
        const targets: string[] = [];
        for (const one of Array.isArray(raw) ? raw : raw == null ? [] : [raw]) {
          const target = wikiLinkTarget(one);
          if (!target) continue;
          const resolved = linkedNote(row["file.path"] || "", target);
          if (!resolved) continue;
          targets.push(resolved);
          linkedPaths.add(resolved);
        }
        byThrough.set(spec.through, targets);
      }
      perRow.set(row, byThrough);
    }
    if (linkedPaths.size === 0) {
      for (const row of result) for (const [name, spec] of specs) row[name] = aggregateRollup(spec, []);
      return;
    }

    // One bulk load of the linked notes' properties, chunked like the main query.
    const paths = [...linkedPaths];
    const byPath = new Map<string, Record<string, any>>();
    const chunk = 500;
    for (let i = 0; i < paths.length; i += chunk) {
      const slice = paths.slice(i, i + chunk);
      const placeholders = slice.map(() => "?").join(",");
      const rows = await this.db.query<any>(
        `SELECT f.path AS path, f.title AS title, f.mtime_local AS mtime_local, f.size_bytes AS size_bytes,
                p.key AS key, p.value AS value, p.type AS type
         FROM files f LEFT JOIN properties p ON p.file_id = f.id
         WHERE f.path IN (${placeholders})`,
        slice
      );
      for (const r of rows) {
        let bucket = byPath.get(r.path);
        if (!bucket) {
          bucket = {
            "file.name": r.title || r.path.split(/[/\\]/).pop()?.replace(/\.md$/i, "") || "",
            "file.path": r.path,
            "file.mtime": r.mtime_local,
            "file.size": r.size_bytes,
          };
          byPath.set(r.path, bucket);
        }
        if (r.key == null) continue;
        bucket[r.key] = decodeIndexedProperty(r.type, r.value);
      }
    }

    for (const row of result) {
      const byThrough = perRow.get(row)!;
      for (const [name, spec] of specs) {
        const targets = byThrough.get(spec.through) ?? [];
        const values = targets.map((t) => {
          const props = byPath.get(t);
          if (!props || !spec.of) return undefined;
          if (props[spec.of] !== undefined) return props[spec.of];
          // Same case-insensitive fallback the main query applies: a note may
          // spell its key "Frist" while the column is "frist".
          const lower = spec.of.toLowerCase();
          for (const k of Object.keys(props)) if (k.toLowerCase() === lower) return props[k];
          return undefined;
        });
        row[name] = aggregateRollup(spec, values);
      }
    }
  }


  /**
   * Incoming FRONTMATTER property links (any property key) that resolve to one
   * of `targetPaths` — the "assigned elements" edge set of the cascade-deletion
   * plan. Body links never count as an assignment (property_key IS NOT NULL),
   * self-links are excluded, and each (target, source, propertyKey) pair
   * appears once. Map keys are the requested target paths; targets without
   * incoming property links are absent.
   */
  async getIncomingRelationRefs(targetPaths: string[]): Promise<Map<string, IncomingRelationRef[]>> {
    const result = new Map<string, IncomingRelationRef[]>();
    if (targetPaths.length === 0) return result;

    const files = await this.linkTargets();
    const rows = await this.db.query<{
      source_path: string;
      source_title: string | null;
      target_path: string;
      property_key: string;
    }>(
      `SELECT f.path AS source_path, f.title AS source_title, l.target_path AS target_path, l.property_key AS property_key
       FROM links l
       JOIN files f ON f.id = l.source_id
       WHERE l.property_key IS NOT NULL`
    );

    const targets = new Set(targetPaths);
    const { buildLinkTargetIndex, resolveLinkTargetIndexed } = await import("./LinkResolver.js");
    const corpus = buildLinkTargetIndex(files);
    const seen = new Set<string>();
    for (const row of rows) {
      const resolved = resolveLinkTargetIndexed(row.source_path, row.target_path, corpus);
      if (!resolved || !targets.has(resolved)) continue;
      if (resolved === row.source_path) continue; // a note is never its own sub-element
      const dedupeKey = `${resolved}\n${row.source_path}\n${row.property_key}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const bucket = result.get(resolved) ?? [];
      bucket.push({
        path: row.source_path,
        title: row.source_title || row.source_path,
        propertyKey: row.property_key,
      });
      result.set(resolved, bucket);
    }
    for (const bucket of result.values()) {
      bucket.sort((a, b) => a.title.localeCompare(b.title) || a.propertyKey.localeCompare(b.propertyKey));
    }
    return result;
  }

  /**
   * Finds all files that have a specific tag.
   */
  async getFilesByTag(tag: string): Promise<FileRecord[]> {
    const sql = `
      SELECT DISTINCT f.id AS id, f.path AS path, f.title AS title, f.mtime_local AS mtime_local, f.size_bytes AS size_bytes
      FROM tags t
      JOIN files f ON f.id = t.file_id
      WHERE t.tag = ? OR t.tag LIKE ?
    `;
    return await this.db.query(sql, [tag, `${tag}/%`]);
  }

  /**
   * Retrieves all unique tags and their file counts.
   */
  async getAllTags(): Promise<{tag: string, count: number}[]> {
    const sql = `
      SELECT tag, COUNT(DISTINCT file_id) as count
      FROM tags
      GROUP BY tag
      ORDER BY tag ASC
    `;
    return await this.db.query(sql, []);
  }

  /**
   * Retrieves all unique folders in the vault.
   */
  async getAllFolders(): Promise<string[]> {
    const sql = `SELECT DISTINCT path FROM files`;
    const files = await this.db.query<{path: string}>(sql, []);
    const folders = new Set<string>();
    for (const f of files) {
      if (f.path.includes("/")) {
        const parts = f.path.split("/");
        parts.pop(); // remove filename
        let current = "";
        for (const p of parts) {
          current = current ? current + "/" + p : p;
          folders.add(current);
        }
      }
    }
    return Array.from(folders).sort();
  }

  /**
   * Retrieves frontmatter/properties for a specific file.
   */
  async getFileProperties(path: string): Promise<Record<string, any>> {
    const sql = `
      SELECT p.key AS key, p.value AS value, p.type AS type
      FROM properties p
      JOIN files f ON f.id = p.file_id
      WHERE f.path = ?
    `;
    const rows = await this.db.query(sql, [path]);
    
    const props: Record<string, any> = {};
    for (const row of rows) {
      const type = row.type || row.TYPE;
      const key = row.key || row.KEY;
      const value = row.value !== undefined ? row.value : row.VALUE;
      
      if (!key) continue;

      props[key] = decodeIndexedProperty(type, value);
    }
    return props;
  }

  /**
   * Every note that carries a provider-task anchor (`plainva.pim`), grouped by
   * the provider's task uid.
   *
   * This exists for the task reconciler's ADOPTION step, and its shape is
   * driven by what that step must not do: read the vault. The reconciler used
   * to locate an anchored note by reading EVERY note from disk, once per task —
   * on a fresh device that is one pass over the vault per remote task (200
   * tasks over 5000 notes is a million reads). The whole `plainva` namespace
   * lives in a single indexed row as JSON, so one query answers it.
   *
   * `ctime` rides along because the choice between several notes with the same
   * uid is partly an age question; malformed rows are skipped rather than
   * throwing, exactly like getDocumentIcons.
   */
  async getTaskAnchors(): Promise<Map<string, TaskAnchorRecord[]>> {
    const rows = await this.db.query(
      `SELECT f.path AS path, f.ctime AS ctime, p.value AS value
       FROM properties p
       JOIN files f ON f.id = p.file_id
       WHERE p.key = ?`,
      [PLAINVA_NAMESPACE_KEY],
    );
    const byUid = new Map<string, TaskAnchorRecord[]>();
    for (const row of rows as any[]) {
      const path = String(row.path ?? row.PATH ?? "");
      const raw = row.value ?? row.VALUE;
      if (!path || typeof raw !== "string") continue;
      let pim: any;
      try {
        pim = JSON.parse(raw)?.pim;
      } catch {
        continue; // malformed namespace JSON — no anchor for this file
      }
      if (!pim || typeof pim !== "object" || pim.kind !== "task") continue;
      const uid = typeof pim.uid === "string" ? pim.uid : "";
      const list = typeof pim.list === "string" ? pim.list : "";
      if (!uid || !list) continue;
      const rawCtime = row.ctime ?? row.CTIME;
      const rec: TaskAnchorRecord = {
        path,
        uid,
        list,
        ctime: rawCtime == null ? null : Number(rawCtime),
        ...(typeof pim.account === "string" && pim.account ? { account: pim.account } : {}),
        ...(typeof pim.provider === "string" && pim.provider ? { provider: pim.provider } : {}),
        ...(typeof pim.identity === "string" && pim.identity ? { identity: pim.identity } : {}),
      };
      const list_ = byUid.get(uid);
      if (list_) list_.push(rec);
      else byUid.set(uid, [rec]);
    }
    return byUid;
  }

  /**
   * Path -> the `plainva` namespace of every note that carries an AI rule of
   * its own (`plainva.ai`), straight from the index — the whole namespace is
   * one row of JSON, so one query answers it.
   *
   * For a caller that has to decide the privacy gate for MANY notes at once
   * and cannot read each of them: the list of titles the system's assistant
   * may know (AI harness P4.7). A note without an entry here has no rule of
   * its own; its folder's rules and the default decide. The index follows a
   * file by one pass — a caller that must not be wrong about ONE note reads
   * that note, as every other door of the assistant does.
   *
   * Malformed rows are skipped rather than throwing, like getDocumentIcons;
   * `ai` that is no object is returned as it is, for the policy's parser to
   * ignore.
   */
  async getOwnAiRules(): Promise<Map<string, { ai: unknown }>> {
    const rows = await this.db.query(
      `SELECT f.path AS path, p.value AS value
       FROM properties p
       JOIN files f ON f.id = p.file_id
       WHERE p.key = ?`,
      [PLAINVA_NAMESPACE_KEY],
    );
    const rules = new Map<string, { ai: unknown }>();
    for (const row of rows as any[]) {
      const path = String(row.path ?? row.PATH ?? "");
      const raw = row.value ?? row.VALUE;
      if (!path || typeof raw !== "string") continue;
      try {
        const namespace = JSON.parse(raw);
        if (namespace && typeof namespace === "object" && "ai" in namespace) rules.set(path, { ai: (namespace as Record<string, unknown>).ai });
      } catch {
        /* malformed namespace JSON — no rule of its own for this file */
      }
    }
    return rules;
  }

  /**
   * Path -> document icon (value + optional tint) from the `plainva`
   * frontmatter namespace. Powers icon display in tabs and the file tree
   * straight from the index (no file reads). The namespace is stored as a
   * JSON string (type "object") by the indexer; malformed rows are skipped.
   */
  async getDocumentIcons(): Promise<Map<string, { icon: string; color?: string }>> {
    const sql = `
      SELECT f.path AS path, p.value AS value
      FROM properties p
      JOIN files f ON f.id = p.file_id
      WHERE p.key = ?
    `;
    const rows = await this.db.query(sql, [PLAINVA_NAMESPACE_KEY]);
    const icons = new Map<string, { icon: string; color?: string }>();
    for (const row of rows) {
      const path = String(row.path ?? row.PATH ?? "");
      const raw = row.value ?? row.VALUE;
      if (!path || typeof raw !== "string") continue;
      try {
        const meta = getPlainvaMeta({ [PLAINVA_NAMESPACE_KEY]: JSON.parse(raw) });
        if (meta.icon) icons.set(path, { icon: meta.icon, color: meta.iconColor });
      } catch {
        /* malformed namespace JSON — no icon for this file */
      }
    }
    return icons;
  }

  /**
   * Path -> title + mode for every indexed file, straight from the index (no
   * file reads). Powers the bookmarks list, which only stores paths yet must
   * show the same display name as the file tree: `title` is the frontmatter
   * `title` or, by default, the file name, and `mode` distinguishes
   * attachments so they keep their extension. The rows are those of
   * `linkTargets()` — a file queued for deletion is none of them: both shells
   * draw their links from this map, and a link is drawn as "not created yet"
   * exactly where a click would create the note.
   */
  async getDocumentTitles(): Promise<Map<string, { title: string; mode: string }>> {
    const rows = await this.db.query<{ path: string; title: string | null; mode: string | null }>(
      `SELECT path, title, mode FROM files WHERE is_deleted IS NULL OR is_deleted = 0`,
      [],
    );
    const titles = new Map<string, { title: string; mode: string }>();
    for (const row of rows) {
      if (!row.path) continue;
      titles.set(row.path, { title: row.title ?? "", mode: row.mode ?? "" });
    }
    return titles;
  }

  /**
   * Retrieves the distinct values used for a given frontmatter property, most-used
   * first. Powers select/status suggestions in the Properties panel: when no `.base`
   * schema curates a property's options, Plainva discovers them from actual usage
   * (Obsidian-safe — only the active scalar lives in each note).
   *
   * `folderPrefix` (e.g. "Calendar/Tagebuch/") scopes discovery to notes under that
   * folder, so a generic key like `status` reused across unrelated note types does
   * not mix vocabularies. An empty/omitted prefix keeps the vault-global behaviour.
   */
  async getKnownProperties(query = "", limit = 80): Promise<{ name: string; type: string; count: number }[]> {
    const rows = await this.db.query<{ name: string; type: string; count: number }>(
      `WITH used AS (
        SELECT key, type, COUNT(DISTINCT file_id) AS uses FROM properties
        WHERE key LIKE ? ESCAPE '\\' GROUP BY key, type
      ), ranked AS (
        SELECT key AS name, type, SUM(uses) OVER (PARTITION BY key) AS count,
          ROW_NUMBER() OVER (PARTITION BY key ORDER BY uses DESC, type ASC) AS rank
        FROM used
      ) SELECT name, type, count FROM ranked WHERE rank = 1
      ORDER BY count DESC, name ASC LIMIT ?`,
      [`%${escapeLikePrefix(query.trim().normalize("NFC"))}%`, Math.max(1, Math.min(200, Math.floor(limit) || 80))],
    );
    return rows;
  }

  async getDistinctPropertyValues(
    key: string, folderPrefix?: string, types?: readonly string[],
  ): Promise<{ value: string; count: number }[]> {
    // Expand only valid indexed arrays. Never offer a serialized list/object as
    // a value; repeated elements in one note still count as one occurrence.
    const conditions = ["p.key = ?"];
    const params: (string | number)[] = [key];
    if (folderPrefix === "/") conditions.push("instr(f.path, '/') = 0");
    else if (folderPrefix) {
      const variants = [...new Set([folderPrefix.normalize("NFC"), folderPrefix.normalize("NFD")])];
      conditions.push(`(${variants.map(() => "f.path LIKE ? ESCAPE '\\'").join(" OR ")})`);
      params.push(...variants.map((v) => `${escapeLikePrefix(v)}%`));
    }
    if (types) {
      if (!types.length) return [];
      conditions.push(`p.type IN (${types.map(() => "?").join(",")})`);
      params.push(...types);
    }
    const rows = await this.db.query<{ value: string; count: number }>(
      `WITH scoped AS (
        SELECT p.file_id, p.type, p.value FROM properties p JOIN files f ON f.id = p.file_id
        WHERE ${conditions.join(" AND ")}
      ), items AS (
        SELECT file_id, value FROM scoped WHERE type IN ('string', 'number', 'boolean')
        UNION ALL
        SELECT p.file_id, CAST(j.value AS TEXT) AS value FROM scoped p,
          json_each(CASE WHEN p.type = 'list' AND json_valid(p.value)
            THEN CASE WHEN json_type(p.value) = 'array' THEN p.value ELSE '[]' END ELSE '[]' END) j
        WHERE j.type = 'text'
      ) SELECT value, COUNT(DISTINCT file_id) AS count FROM items
      WHERE value IS NOT NULL AND value != '' GROUP BY value
      ORDER BY count DESC, value ASC LIMIT 100`, params,
    );
    return rows.map((r) => ({ value: String(r.value ?? ""), count: Number(r.count ?? 0) })).filter((r) => r.value !== "");
  }

  /**
   * How a note's PATH becomes the day its file name stands for (plan
   * Journal-Erweiterungen, X8). Set once per vault by the shell, because the
   * naming is a vault setting and every query wants the same answer; a single
   * query may still override it through its options.
   */
  private dayOfPath: ((path: string) => string | null) | null = null;

  setDayOfPath(resolver: ((path: string) => string | null) | null): void {
    this.dayOfPath = resolver;
  }

  /**
   * Executes a dynamic query based on a Database Folder (.base) configuration.
   */
  async queryDatabaseFiles(
    config: any,
    options: {
      includeFilterMetadata?: boolean;
      /**
       * Turns a note's PATH into the day its file name stands for, or null
       * (plan Journal-Erweiterungen, X8). Injected by the shell: the naming is
       * a Moment-style format whose translation needs date-fns, and this
       * package's dependency list is curated on purpose. Absent = no row
       * carries `file.day`, and no picker offers it.
       */
      dayOfPath?: (path: string) => string | null;
    } = {},
  ): Promise<any[]> {
    let sql = `
      SELECT f.id, f.path AS path, f.title, f.mtime_local, f.size_bytes, f.sha256, f.ctime
      FROM files f
      WHERE 1=1 AND f.mode != 'attachment'
    `;
    const params: any[] = [];

    // APFS commonly reports decomposed (NFD) paths while Base files usually
    // contain composed (NFC) folder names. SQLite compares both byte-for-byte,
    // so query both canonical Unicode forms to keep folder sources portable.
    // A folder name may itself contain LIKE wildcards. Without escaping, a
    // source "A_B" also matches "AxB/" and notes from an unrelated folder show
    // up as rows of this database.
    const folderPathClause = (folder: string, contains = false): string => {
      if (!folder.endsWith("/")) folder += "/";
      const variants = [...new Set([folder.normalize("NFC"), folder.normalize("NFD")])];
      for (const variant of variants) {
        const literal = escapeLikePrefix(variant);
        params.push(contains ? `%${literal}%` : `${literal}%`);
      }
      const one = `f.path LIKE ? ESCAPE '\\'`;
      return variants.length === 1 ? one : `(${variants.map(() => one).join(" OR ")})`;
    };

    // 1. Process filters
    const parseFilter = (filter: any): string | null => {
      if (typeof filter === "string") {
        const source = parseDatabaseSourceFilter(filter);
        if (source?.kind === "folder") {
          const folder = source.value;
          if (folder === "/") return "1=1";
          return folderPathClause(folder);
        }
        
        if (source?.kind === "tag") {
          params.push(source.value);
          return `EXISTS (SELECT 1 FROM tags t WHERE t.file_id = f.id AND t.tag = ?)`;
        }
      } else if (typeof filter === "object" && filter !== null) {
        if (filter.field === 'file.folder' && filter.value) {
          const folder = String(filter.value);
          if (folder === "/") return "1=1";
          return folderPathClause(folder, true);
        }
      }
      
      return null;
    };

    // SQL pushdown of source conditions — only where provably correct (plan
    // Base-Filtergruppen P7): and-list SOURCE STRINGS always (independent
    // conjuncts; groups and property rules stay residual), the or-list only
    // when EVERY entry is a source string. A mixed or-list must evaluate in
    // memory — the old code cut it down to its source clauses and dropped
    // rows that only matched a property alternative.
    const pinboard = (config.views?.[0]?.plainva?.render ?? config.views?.[0]?.type) === "pinboard";
    const andList: any[] = Array.isArray(config.filters?.and) ? config.filters.and : [];
    const orList: any[] = Array.isArray(config.filters?.or) ? config.filters.or : [];
    const residualAnd: any[] = [];
    {
      const andClauses: string[] = [];
      for (const filter of andList) {
        const clause = parseFilter(filter);
        if (clause) andClauses.push(clause);
        else residualAnd.push(filter);
      }
      if (andClauses.length > 0) {
        sql += ` AND (${andClauses.join(" AND ")})`;
      }
    }
    let residualOr: any[] = [];
    if (orList.length > 0) {
      if (orList.every((f) => typeof f === "string" && isSourceFilter(f))) {
        const orClauses = orList.map((f) => parseFilter(f)).filter((c): c is string => !!c);
        if (orClauses.length > 0) {
          sql += ` AND (${orClauses.join(" OR ")})`;
        }
      } else {
        residualOr = orList;
      }
    }

    // Sort rules of the active view (views[0]; the caller passes the active view
    // there). ALL rules apply as a stable multi-level sort — in memory, over the
    // assembled rows, so note properties and file.* fields sort alike. The SQL
    // ORDER BY only provides the default when no rule is configured.
    const sortRules = normalizeSortRules(config.views?.[0]?.sort);
    const sortSql = " ORDER BY f.mtime_local DESC"; // default fallback

    const rawRows = await this.db.query(sql + (sortRules.length === 0 ? sortSql : ""), params);
    // OKF reserved files (index.md/log.md) are folder-listing infrastructure,
    // never database rows. A folder source matches recursively, so a folder's
    // managed index.md would otherwise appear as a row — exclude reserved names
    // from every base view here, in one place (no per-`.base` filter needed;
    // that also keeps the files Obsidian-openable, since Obsidian's Bases has no
    // global `contains()` function to express the exclusion in the filter).
    const rows = rawRows.filter((r) => !isReservedOkfName(String((r as { path?: unknown }).path ?? "")));

    // Fetch properties for these files in bulk to avoid N+1 queries
    const propsByFileId: Record<string, Record<string, any>> = {};
    const fileIds = rows.map(r => r.id);
    
    // Chunking to respect SQLite variable limits (usually 999 or 32766, 500 is safe)
    const chunkSize = 500;
    for (let i = 0; i < fileIds.length; i += chunkSize) {
      const chunk = fileIds.slice(i, i + chunkSize);
      if (chunk.length === 0) break;
      
      const placeholders = chunk.map(() => "?").join(",");
      const propsSql = `
        SELECT file_id, key, value, type
        FROM properties
        WHERE file_id IN (${placeholders})
      `;
      
      const propRows = await this.db.query(propsSql, chunk);
      for (const pr of propRows) {
        const fileId = pr.file_id;
        if (!propsByFileId[fileId]) propsByFileId[fileId] = {};
        
        const type = pr.type || pr.TYPE;
        const key = pr.key || pr.KEY;
        const value = pr.value !== undefined ? pr.value : pr.VALUE;
        
        if (!key) continue;

        propsByFileId[fileId][key] = decodeIndexedProperty(type, value);
      }
    }

    // Column keys of the base's schema (bare, without the note. prefix) — used
    // for the case-insensitive fallback below.
    const schemaColumnKeys = Object.keys((config.columns ?? {}) as Record<string, unknown>);

    const result: any[] = [];
    for (const row of rows) {
      const props = propsByFileId[row.id] || {};
      const fileData: Record<string, any> = {
        "file.name": row.title || (row.path ? row.path.split(/[/\\]/).pop()?.replace(/\.md$/i, '') : ""),
        "file.path": row.path || "",
        "file.mtime": row.mtime_local,
        "file.size": row.size_bytes,
        ...props,
        "file.revision": row.sha256 ?? `${row.mtime_local}:${row.size_bytes}`,
        "file.ctime": row.ctime ?? null
      };
      // The day a daily note's NAME stands for - computed, never stored, and
      // absent entirely when the shell hands in no naming (X8).
      const dayOf = options.dayOfPath ?? this.dayOfPath;
      if (dayOf) fileData["file.day"] = dayOf(String(row.path ?? "")) ?? null;
      // Case-insensitive fallback onto the schema's column keys: frontmatter
      // keys keep the exact casing of the note ("Frist"), but every view reads
      // the COLUMN key ("frist"). Without this, a note whose key casing differs
      // from the column shows "no value" although the properties panel (which
      // capitalizes bare keys for DISPLAY only) looks perfectly fine — a real
      // maintainer trap (2026-07-17). Exact matches always win; the fallback
      // only fills a column key that is absent from the row.
      for (const colKey of schemaColumnKeys) {
        if (fileData[colKey] !== undefined) continue;
        const lower = colKey.toLowerCase();
        for (const propKey of Object.keys(props)) {
          if (propKey.toLowerCase() === lower) {
            fileData[colKey] = props[propKey];
            break;
          }
        }
      }
      normalizeDatabaseMetadata(fileData);
      result.push(fileData);
    }

    // `file.tasks` (issue #83): the note's checkbox progress, read from the FTS
    // index like listTasks — no file I/O, one chunked query per result set.
    // Only when a view can show it (a board card, or a column that asks for
    // it): a plain table must not pay a content read it never renders.
    if (needsTaskProgress(config)) await this.attachTaskProgress(result);

    // Computed reverse-relation columns (schema `reverseOf`): enriched BEFORE
    // the in-memory filters/sort so filtering and sorting on reverse columns
    // work. Values share the stored-relation shape — a list of wiki-link
    // strings — and override a same-named real frontmatter key (schema wins).
    const reverseCols = Object.entries((config.columns ?? {}) as Record<string, any>).filter(
      ([, c]) =>
        c && typeof c === "object" && c.reverseOf && typeof c.reverseOf.property === "string" && c.reverseOf.property
    );
    if (reverseCols.length > 0 && result.length > 0) {
      const files = await this.linkTargets();
      const allFilePaths = files.filter((f) => f.mode !== "attachment").map((f) => f.path);
      const targetPaths = result.map((r) => r["file.path"]);
      const { wikiTargetForPath } = await import("./LinkResolver.js");
      for (const [name, col] of reverseCols) {
        const map = await this._getRelationSources(targetPaths, col.reverseOf.property, files);
        for (const row of result) {
          const sources = map.get(row["file.path"]) ?? [];
          row[name] = sources.map((s) => {
            const target = wikiTargetForPath(s.path, allFilePaths);
            return s.title && s.title !== target ? `[[${target}|${s.title}]]` : `[[${target}]]`;
          });
        }
      }
    }

    // Computed rollup columns (schema `rollup`): enriched AFTER the reverse
    // columns, because a rollup almost always runs over one — "how many of the
    // tasks that point at me are still open". Like the reverse column the value
    // is computed here and stored in no note.
    await this._enrichRollups(config, result);

    let finalResult = result;

    // In-memory evaluation of everything NOT pushed to SQL: property rules,
    // nested filter groups (recursive — previously preserved but ignored) and
    // any source condition inside a mixed or-list. `file.hasTag` outside SQL
    // needs the tag table. Filter pickers request the same bulk data over the
    // unfiltered source, so values remain selectable when the view is empty.
    if (residualAnd.length > 0 || residualOr.length > 0 || options.includeFilterMetadata || pinboard) {
      const rootNode = {
        and: [...residualAnd, ...(residualOr.length > 0 ? [{ or: residualOr }] : [])],
      };
      let tagsByPath: Map<string, Set<string>> | null = null;
      if ((filterNeedsTags(rootNode) || options.includeFilterMetadata || pinboard) && finalResult.length > 0) {
        tagsByPath = new Map();
        for (let i = 0; i < fileIds.length; i += chunkSize) {
          const chunk = fileIds.slice(i, i + chunkSize);
          if (chunk.length === 0) break;
          const placeholders = chunk.map(() => "?").join(",");
          const tagRows = await this.db.query(
            `SELECT f.path AS path, t.tag AS tag FROM tags t JOIN files f ON f.id = t.file_id WHERE t.file_id IN (${placeholders})`,
            chunk
          );
          for (const tr of tagRows) {
            const p = String(tr.path ?? tr.PATH ?? "");
            const tag = String(tr.tag ?? tr.TAG ?? "").replace(/^#/, "");
            if (!p || !tag) continue;
            if (!tagsByPath.has(p)) tagsByPath.set(p, new Set());
            tagsByPath.get(p)!.add(tag);
          }
        }
        for (const row of finalResult) {
          row["file.tags"] = [...(tagsByPath.get(String(row["file.path"] ?? "")) ?? [])].map((tag) => `#${tag}`);
        }
      }
      const predicate = buildFilterNodePredicate(rootNode, {
        hasTag: (row, tag) => {
          const set = tagsByPath?.get(String(row["file.path"] ?? ""));
          return !!set && set.has(tag);
        },
      });
      if (predicate) {
        finalResult = finalResult.filter(predicate);
      }
    }

    if (sortRules.length > 0) {
      finalResult = applySortRules(finalResult, sortRules);
    }

    return finalResult;
  }
}
