import { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import { applySortRules, buildFilterNodePredicate, filterNeedsTags, isSourceFilter, normalizeSortRules } from "./databaseQueryHelpers.js";
import { getPlainvaMeta, PLAINVA_NAMESPACE_KEY } from "../metadata.js";
import { isReservedOkfName } from "../okf-conversion.js";
import { escapeLikePrefix } from "./VaultIndexer.js";
import { isEmptySearchQuery, parseSearchQuery, SNIPPET_MARK_END, SNIPPET_MARK_START, type ParsedSearchQuery } from "./ftsQuery.js";
import { scanTasks, type ScannedTask } from "./taskScan.js";
import { findMatchesInText, type FindReplaceOptions, type TextMatch } from "./findReplace.js";
import { contentHasTag } from "./renameTag.js";
import { readFrontmatterPath } from "../frontmatter-surgical.js";
import { aggregateRollup, normalizeRollup, wikiLinkTarget, type RollupSpec } from "./rollup.js";

export interface FileRecord {
  id: string;
  path: string;
  title: string;
  mtime_local: number;
  size_bytes: number;
}

export interface SearchResult extends FileRecord {
  /** Content excerpt with SNIPPET_MARK sentinels around matches; null when
   *  the query had no text terms (pure path:/tag: search). */
  snippet?: string | null;
  /** Title with SNIPPET_MARK sentinels when the match hit the title — the UI
   *  uses this both for highlighting and to group "file name" hits. */
  titleHighlighted?: string | null;
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

export interface LinkRecord {
  source_path: string;
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
  async searchFullText(query: string, limit: number = 50): Promise<SearchResult[]> {
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
      // Title hits outrank body hits (fts_notes column order: content, title).
      orderBy = `bm25(fts_notes, 1.0, 4.0)`;
    } else {
      // Pure operator query (path:/tag:/-term only) — no FTS ranking source.
      select = `f.id, f.path, f.title, f.mtime_local, f.size_bytes,
        NULL AS snippet, NULL AS titleHighlighted`;
      from = `files f`;
      orderBy = `f.mtime_local DESC`;
    }

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

    const sql = `
      SELECT ${select}
      FROM ${from}
      WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT ?
    `;
    params.push(limit);
    return await this.db.query(sql, params);
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
    const prefix = folder ? `${folder.replace(/\/+$/, "")}/` : "";
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
   * Card data for content-rendering views (plan Pinboard P2): the note BODY
   * from the FTS index (no file I/O — the listTasks/findInVault pattern), the
   * note's tags and its creation time (`files.ctime`, index v3; null for rows
   * indexed before v3 — callers fall back to mtime). Chunked IN queries respect
   * SQLite's bound-variable limit; paths missing from the index are simply
   * absent from the result.
   */
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
        if (!out[r.path]) out[r.path] = { content: "", tags: [], ctime: null };
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
   * Resolves a wikilink-style target (note title or vault path, case-insensitive)
   * to a vault path the way the editor resolves links. Returns null on no match.
   */
  async resolveNotePath(target: string): Promise<string | null> {
    const row = await this.db.queryOne<{ path: string }>(
      `SELECT path FROM files WHERE title = ? COLLATE NOCASE OR path = ? COLLATE NOCASE OR path = ? COLLATE NOCASE LIMIT 1`,
      [target, target, target + ".md"],
    );
    return row?.path ?? null;
  }

  /**
   * Finds all files that link to the given path (Backlinks).
   */
  async getBacklinks(targetPath: string): Promise<LinkRecord[]> {
    const targetBasename = targetPath.split(/[/\\]/).pop()?.replace(/\.md$/, "");

    // 1. Fetch all candidate links matching the basename
    let sql = `
      SELECT f.path as source_path, l.target_path, l.link_type, l.anchor, l.line_number, l.property_key
      FROM links l
      JOIN files f ON f.id = l.source_id
      WHERE l.target_path LIKE ? ESCAPE '\\'
    `;
    const likeQuery = `%${targetBasename?.replace(/[\\%_]/g, '\\$&')}%`;
    const candidateLinks = await this.db.query<LinkRecord>(sql, [likeQuery]);

    // 2. Fetch all file paths to resolve links correctly. `.base` files are
    // indexed as attachments but ARE legitimate link targets (embeds, template
    // assignments) — without them in the corpus a link onto a .base could
    // never resolve, so backlinks stayed empty and renames silently broke
    // every reference.
    const allFilesRows = await this.db.query<{path: string}>(`SELECT path FROM files WHERE mode != 'attachment' OR path LIKE '%.base'`);
    const allFilePaths = allFilesRows.map(r => r.path);

    // 3. Resolve each link and filter by exact match to targetPath. The corpus
    // index is built ONCE (P2.3) — resolving per candidate against the raw
    // array was O(candidates × files) and ran on every file switch.
    const resolvedLinks: LinkRecord[] = [];

    // Dynamically import resolveLinkTarget to avoid circular deps or complex setup
    const { buildLinkTargetIndex, resolveLinkTargetIndexed } = await import("./LinkResolver.js");
    const corpus = buildLinkTargetIndex(allFilePaths);

    for (const link of candidateLinks) {
      const resolvedPath = resolveLinkTargetIndexed(link.source_path, link.target_path, corpus);
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
    const allFilesRows = await this.db.query<{ path: string }>(
      `SELECT path FROM files WHERE mode != 'attachment'`
    );
    return this._getRelationSources(targetPaths, propertyKey, allFilesRows.map((r) => r.path));
  }

  /** Variant sharing the resolver corpus across several reverse columns of one query. */
  private async _getRelationSources(
    targetPaths: string[],
    propertyKey: string,
    allFilePaths: string[]
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
    const corpus = buildLinkTargetIndex(allFilePaths);
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

    // Every link value that any rollup needs to follow, resolved once.
    const allFilesRows = await this.db.query<{ path: string }>(
      `SELECT path FROM files WHERE mode != 'attachment'`
    );
    const { buildLinkTargetIndex, resolveLinkTargetIndexed } = await import("./LinkResolver.js");
    const corpus = buildLinkTargetIndex(allFilesRows.map((r) => r.path));

    const linkedPaths = new Set<string>();
    const perRow = new Map<any, Map<string, string[]>>();
    for (const row of result) {
      const byThrough = new Map<string, string[]>();
      for (const [, spec] of specs) {
        if (byThrough.has(spec.through)) continue;
        const raw = row[spec.through];
        const targets: string[] = [];
        for (const one of Array.isArray(raw) ? raw : raw == null ? [] : [raw]) {
          const target = wikiLinkTarget(one);
          if (!target) continue;
          const resolved = resolveLinkTargetIndexed(row["file.path"] || "", target, corpus);
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
        if (r.type === "number") bucket[r.key] = Number(r.value);
        else if (r.type === "boolean") bucket[r.key] = r.value === "true";
        else if (r.type === "list") {
          try { bucket[r.key] = JSON.parse(r.value); } catch { bucket[r.key] = r.value; }
        } else bucket[r.key] = r.value;
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

    const allFilesRows = await this.db.query<{ path: string }>(
      `SELECT path FROM files WHERE mode != 'attachment'`
    );
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
    const corpus = buildLinkTargetIndex(allFilesRows.map((r) => r.path));
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
      const value = row.value || row.VALUE;
      
      if (!key) continue;

      if (type === "number") props[key] = Number(value);
      else if (type === "boolean") props[key] = value === "true";
      else if (type === "list") {
        try { props[key] = JSON.parse(value); } catch { props[key] = value; }
      }
      else props[key] = value;
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
   * attachments so they keep their extension.
   */
  async getDocumentTitles(): Promise<Map<string, { title: string; mode: string }>> {
    const rows = await this.db.query<{ path: string; title: string | null; mode: string | null }>(
      `SELECT path, title, mode FROM files`,
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
  async getDistinctPropertyValues(key: string, folderPrefix?: string): Promise<{ value: string; count: number }[]> {
    const scoped = folderPrefix !== undefined && folderPrefix !== "";
    const sql = scoped
      ? `SELECT p.value AS value, COUNT(DISTINCT p.file_id) AS count
         FROM properties p JOIN files f ON f.id = p.file_id
         WHERE p.key = ? AND p.value IS NOT NULL AND p.value != '' AND f.path LIKE ?
         GROUP BY p.value
         ORDER BY count DESC, value ASC`
      : `SELECT value AS value, COUNT(DISTINCT file_id) AS count
         FROM properties
         WHERE key = ? AND value IS NOT NULL AND value != ''
         GROUP BY value
         ORDER BY count DESC, value ASC`;
    const params = scoped ? [key, `${folderPrefix}%`] : [key];
    const rows = await this.db.query(sql, params);
    return rows
      .map((row: any) => ({
        value: String(row.value ?? row.VALUE ?? ""),
        count: Number(row.count ?? row.COUNT ?? 0),
      }))
      .filter((r) => r.value !== "");
  }

  /**
   * Executes a dynamic query based on a Database Folder (.base) configuration.
   */
  async queryDatabaseFiles(config: any): Promise<any[]> {
    let sql = `
      SELECT f.id, f.path AS path, f.title, f.mtime_local, f.size_bytes
      FROM files f
      WHERE 1=1 AND f.mode != 'attachment'
    `;
    const params: any[] = [];

    // 1. Process filters
    const parseFilter = (filter: any): string | null => {
      if (typeof filter === "string") {
        const folderMatch = filter.match(/file\.folder\s*==\s*"([^"]+)"/);
        if (folderMatch) {
          let folder = folderMatch[1];
          if (folder === "/") return "1=1";
          if (!folder.endsWith("/")) folder += "/";
          params.push(`${folder}%`);
          return `f.path LIKE ?`;
        }
        
        const tagMatch = filter.match(/file\.hasTag\("([^"]+)"\)/);
        if (tagMatch) {
          let tag = tagMatch[1];
          if (tag.startsWith("#")) tag = tag.substring(1);
          params.push(tag);
          return `EXISTS (SELECT 1 FROM tags t WHERE t.file_id = f.id AND t.tag = ?)`;
        }
      } else if (typeof filter === "object" && filter !== null) {
        if (filter.field === 'file.folder' && filter.value) {
          let folder = String(filter.value);
          if (folder === "/") return "1=1";
          if (!folder.endsWith("/")) folder += "/";
          params.push(`%${folder}%`);
          return `f.path LIKE ?`;
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
        const value = pr.value || pr.VALUE;
        
        if (!key) continue;

        if (type === "number") propsByFileId[fileId][key] = Number(value);
        else if (type === "boolean") propsByFileId[fileId][key] = value === "true";
        else if (type === "list") {
          try { propsByFileId[fileId][key] = JSON.parse(value); } catch { propsByFileId[fileId][key] = value; }
        }
        else propsByFileId[fileId][key] = value;
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
        ...props
      };
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
      result.push(fileData);
    }

    // Computed reverse-relation columns (schema `reverseOf`): enriched BEFORE
    // the in-memory filters/sort so filtering and sorting on reverse columns
    // work. Values share the stored-relation shape — a list of wiki-link
    // strings — and override a same-named real frontmatter key (schema wins).
    const reverseCols = Object.entries((config.columns ?? {}) as Record<string, any>).filter(
      ([, c]) =>
        c && typeof c === "object" && c.reverseOf && typeof c.reverseOf.property === "string" && c.reverseOf.property
    );
    if (reverseCols.length > 0 && result.length > 0) {
      const allFilesRows = await this.db.query<{ path: string }>(
        `SELECT path FROM files WHERE mode != 'attachment'`
      );
      const allFilePaths = allFilesRows.map((r) => r.path);
      const targetPaths = result.map((r) => r["file.path"]);
      const { wikiTargetForPath } = await import("./LinkResolver.js");
      for (const [name, col] of reverseCols) {
        const map = await this._getRelationSources(targetPaths, col.reverseOf.property, allFilePaths);
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
    // needs the tag table: loaded in bulk only when such a condition remains.
    if (residualAnd.length > 0 || residualOr.length > 0) {
      const rootNode = {
        and: [...residualAnd, ...(residualOr.length > 0 ? [{ or: residualOr }] : [])],
      };
      let tagsByPath: Map<string, Set<string>> | null = null;
      if (filterNeedsTags(rootNode) && finalResult.length > 0) {
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
            const tag = String(tr.tag ?? tr.TAG ?? "");
            if (!p || !tag) continue;
            if (!tagsByPath.has(p)) tagsByPath.set(p, new Set());
            tagsByPath.get(p)!.add(tag);
          }
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
