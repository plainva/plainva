import { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import { buildLinkTargetIndex, resolveLinkTargetIndexed } from "./LinkResolver.js";
import { isReservedOkfName } from "../okf-conversion.js";
import { ftsPhrase } from "./ftsQuery.js";

/**
 * Read-model for the graph views (context graph, vault map, base graph view).
 *
 * Everything here derives from the SQLite index (files/links/properties/tags/
 * fts_notes) — no vault file is ever read. Link targets are resolved with the
 * SAME resolver the backlinks panel uses, so an edge exists exactly where a
 * click in the editor would land. Parallel links between two notes are bundled
 * into one edge with a count.
 *
 * Edge vocabulary (decision E1 of the graph plan): structure/relations/body
 * links only — no new syntax. Frontmatter relation links (property_key set)
 * surface as kind "property" with their key as the label.
 */

export type GraphEdgeKind = "wikilink" | "embed" | "markdown-link" | "property";

export interface GraphNodeInfo {
  path: string;
  title: string;
  /** files.mode: obsidian | okf | attachment */
  mode: string;
  /** Frontmatter `type` (OKF); null when the note has none. */
  okfType: string | null;
  /** Parent folder ("" for vault root). */
  folder: string;
  mtime: number;
  ctime: number | null;
}

export interface GraphEdgeInfo {
  /** Resolved vault path of the link source. */
  source: string;
  /** Resolved vault path of the link target. */
  target: string;
  kind: GraphEdgeKind;
  /** Frontmatter key for kind "property", else null. */
  propertyKey: string | null;
  /** Number of parallel links bundled into this edge. */
  count: number;
  /** Smallest source line number of the bundle (context lookup), if known. */
  lineNumber: number | null;
}

export interface BrokenLinkInfo {
  sourcePath: string;
  /** The raw link target text as written in the note. */
  targetRaw: string;
  lineNumber: number | null;
  propertyKey: string | null;
}

export interface VaultGraph {
  nodes: Map<string, GraphNodeInfo>;
  edges: GraphEdgeInfo[];
  broken: BrokenLinkInfo[];
}

export interface GraphNeighborhood {
  center: string;
  nodes: GraphNodeInfo[];
  edges: GraphEdgeInfo[];
  /** True when the BFS stopped at the node budget before exhausting depth. */
  truncated: boolean;
}

export interface FolderOverviewFolder {
  /** Full folder path (e.g. "Projects/Active"); every level appears once. */
  folder: string;
  /** Notes DIRECTLY in this folder (not recursive). */
  noteCount: number;
  /** True when the folder has an index.md/log.md style reserved note. */
  hasIndexNote: boolean;
}

export interface FolderOverview {
  folders: FolderOverviewFolder[];
  /** Paths of notes directly in the vault root. */
  rootNotes: string[];
  /** Inter-folder edge bundles; "" is the vault root bucket. */
  folderEdges: { source: string; target: string; count: number }[];
}

export interface FolderSubgraph {
  folder: string;
  /** Notes directly in the folder. */
  notes: GraphNodeInfo[];
  /** Direct child folders with their recursive note counts. */
  subfolders: { folder: string; noteCount: number }[];
  /** Edges between the returned notes (verbatim bundles). */
  innerEdges: GraphEdgeInfo[];
  /** Aggregated edges from a returned note to some other folder ("" = root). */
  externalEdges: { source: string; targetFolder: string; count: number }[];
}

export type GraphSuggestionReason = "mention" | "cocitation" | "neighbors" | "tag";

export interface GraphSuggestion {
  source: string;
  target: string;
  reason: GraphSuggestionReason;
  /** Higher is better; only comparable within one reason. */
  score: number;
  /** Mention phrase (reason "mention"). */
  term?: string;
  /** Human hint, e.g. the shared tag (reason "tag"). */
  detail?: string;
}

/**
 * Pluggable suggestion source (decision E2): the built-in providers are pure
 * index algorithms; an embedding-based provider can implement this interface
 * later without touching the graph views.
 */
export interface GraphSuggestionProvider {
  readonly id: string;
  suggest(forPath: string | null, limit: number, signal?: AbortSignal): Promise<GraphSuggestion[]>;
}

export interface UnlinkedMentionScanOptions {
  /** Restrict the scan to mentions of/inside this note (context graph). */
  forPath?: string | null;
  onProgress?: (current: number, total: number, term: string) => void;
  signal?: AbortSignal;
  /** Stop after this many results (vault-wide scans). */
  maxResults?: number;
}

/** Neighbor lists larger than this are skipped by the pairing algorithms —
 *  hub pages (MOCs, indexes) would otherwise flood the suggestions. */
const HUB_NEIGHBOR_CAP = 50;
/** BFS budget for neighborhoods before `truncated` is set. */
const NEIGHBORHOOD_NODE_BUDGET = 400;
/** Minimum title/alias length considered for mention scanning. */
const MENTION_MIN_TERM_LENGTH = 3;

function folderOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.substring(0, idx);
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export class GraphService {
  constructor(public readonly db: IDatabaseAdapter) {}

  /**
   * Loads the full resolved vault graph. Attachments only become nodes when
   * `includeAttachments` is set AND they are actually linked/embedded; edges
   * pointing at attachments are dropped otherwise. `.base` files are never
   * graph nodes (databases are views over notes, not notes).
   */
  async loadGraph(opts: { includeAttachments?: boolean } = {}): Promise<VaultGraph> {
    const includeAttachments = opts.includeAttachments === true;

    const fileRows = await this.db.query<{
      path: string;
      title: string | null;
      mode: string | null;
      mtime_local: number | null;
      ctime: number | null;
    }>(`SELECT path, title, mode, mtime_local, ctime FROM files WHERE is_deleted = 0`);

    const typeRows = await this.db.query<{ path: string; value: string | null }>(
      `SELECT f.path AS path, p.value AS value
       FROM properties p JOIN files f ON f.id = p.file_id
       WHERE p.key = 'type'`
    );
    const typeByPath = new Map<string, string>();
    for (const row of typeRows) {
      const p = String((row as any).path ?? (row as any).PATH ?? "");
      const v = (row as any).value ?? (row as any).VALUE;
      if (p && typeof v === "string" && v) typeByPath.set(p, v);
    }

    const nodes = new Map<string, GraphNodeInfo>();
    const attachmentPaths: string[] = [];
    const attachmentInfo = new Map<string, GraphNodeInfo>();
    // .base files are never nodes, but they must stay resolvable: a link to an
    // EXISTING database is silently dropped, not reported as broken.
    const basePaths: string[] = [];
    for (const row of fileRows) {
      const path = String((row as any).path ?? (row as any).PATH ?? "");
      if (!path) continue;
      if (path.endsWith(".base")) {
        basePaths.push(path);
        continue;
      }
      const mode = String((row as any).mode ?? (row as any).MODE ?? "obsidian");
      const info: GraphNodeInfo = {
        path,
        title: ((row as any).title ?? (row as any).TITLE) || path.split(/[/\\]/).pop()?.replace(/\.md$/i, "") || path,
        mode,
        okfType: typeByPath.get(path) ?? null,
        folder: folderOf(path),
        mtime: Number((row as any).mtime_local ?? (row as any).MTIME_LOCAL ?? 0),
        ctime: (row as any).ctime ?? (row as any).CTIME ?? null,
      };
      if (mode === "attachment") {
        attachmentPaths.push(path);
        attachmentInfo.set(path, info);
      } else {
        nodes.set(path, info);
      }
    }

    const linkRows = await this.db.query<{
      source_path: string;
      target_path: string;
      target_raw: string;
      link_type: string;
      property_key: string | null;
      line_number: number | null;
    }>(
      `SELECT f.path AS source_path, l.target_path, l.target_raw, l.link_type, l.property_key, l.line_number
       FROM links l JOIN files f ON f.id = l.source_id`
    );

    // Resolution corpus: notes + attachments (embeds resolve onto attachments)
    // + .base files (resolvable but dropped as edges). Built ONCE per load
    // (P2.3) — resolving per link would rebuild it for every row.
    const corpusIndex = buildLinkTargetIndex([...nodes.keys(), ...attachmentPaths, ...basePaths]);

    const bundles = new Map<string, GraphEdgeInfo>();
    const broken: BrokenLinkInfo[] = [];
    const linkedAttachments = new Set<string>();

    for (const row of linkRows) {
      const source = String((row as any).source_path ?? "");
      if (!source || !nodes.has(source)) continue; // links out of .base/attachments do not exist
      const targetPath = String((row as any).target_path ?? "");
      // Neither an edge nor "broken": anchor-only links to the same note
      // ([[#heading]]) and external targets (https:, mailto:, tel:, …) — a
      // YouTube link is not a broken vault link (maintainer report #9).
      if (!targetPath.trim()) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(targetPath)) continue;
      const lineRaw = (row as any).line_number;
      const lineNumber = lineRaw == null ? null : Number(lineRaw);
      const propertyKey = ((row as any).property_key ?? null) as string | null;
      const resolved = resolveLinkTargetIndexed(source, targetPath, corpusIndex);
      if (!resolved) {
        broken.push({
          sourcePath: source,
          targetRaw: String((row as any).target_raw ?? (row as any).target_path ?? ""),
          lineNumber,
          propertyKey,
        });
        continue;
      }
      if (resolved === source) continue; // self links (anchors) are not edges
      if (resolved.endsWith(".base")) continue;
      const targetIsAttachment = !nodes.has(resolved);
      if (targetIsAttachment) {
        if (!includeAttachments) continue;
        linkedAttachments.add(resolved);
      }
      const kind: GraphEdgeKind = propertyKey
        ? "property"
        : (String((row as any).link_type ?? "wikilink") as GraphEdgeKind);
      const key = `${source}\u0000${resolved}\u0000${kind}\u0000${propertyKey ?? ""}`;
      const existing = bundles.get(key);
      if (existing) {
        existing.count += 1;
        if (lineNumber != null && (existing.lineNumber == null || lineNumber < existing.lineNumber)) {
          existing.lineNumber = lineNumber;
        }
      } else {
        bundles.set(key, { source, target: resolved, kind, propertyKey, count: 1, lineNumber });
      }
    }

    for (const path of linkedAttachments) {
      const info = attachmentInfo.get(path);
      if (info) nodes.set(path, info);
    }

    return { nodes, edges: [...bundles.values()], broken };
  }

  /** Undirected adjacency over the graph's edges (bundles count once). */
  private adjacency(graph: VaultGraph): Map<string, Set<string>> {
    const adj = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      let set = adj.get(a);
      if (!set) adj.set(a, (set = new Set()));
      set.add(b);
    };
    for (const e of graph.edges) {
      add(e.source, e.target);
      add(e.target, e.source);
    }
    return adj;
  }

  /**
   * BFS neighborhood around `path` up to `depth` hops (default 1), including
   * every edge between reached nodes. Stops at a node budget (truncated=true).
   */
  async getNeighborhood(path: string, depth: number = 1, graph?: VaultGraph): Promise<GraphNeighborhood> {
    const g = graph ?? (await this.loadGraph({ includeAttachments: true }));
    const adj = this.adjacency(g);
    const reached = new Set<string>([path]);
    let frontier = [path];
    let truncated = false;

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const neighbor of adj.get(node) ?? []) {
          if (reached.has(neighbor)) continue;
          if (reached.size >= NEIGHBORHOOD_NODE_BUDGET) {
            truncated = true;
            break;
          }
          reached.add(neighbor);
          next.push(neighbor);
        }
        if (truncated) break;
      }
      if (truncated) break;
      frontier = next;
    }

    const nodes: GraphNodeInfo[] = [];
    for (const p of reached) {
      const info = g.nodes.get(p);
      if (info) nodes.push(info);
    }
    const edges = g.edges.filter((e) => reached.has(e.source) && reached.has(e.target));
    return { center: path, nodes, edges, truncated };
  }

  /** Zoom level 0 of the vault map: folder bubbles + inter-folder bundles. */
  async getFolderOverview(graph?: VaultGraph): Promise<FolderOverview> {
    const g = graph ?? (await this.loadGraph());
    const folders = new Map<string, FolderOverviewFolder>();
    const rootNotes: string[] = [];

    const ensureFolder = (folder: string) => {
      let entry = folders.get(folder);
      if (!entry) folders.set(folder, (entry = { folder, noteCount: 0, hasIndexNote: false }));
      return entry;
    };

    for (const node of g.nodes.values()) {
      if (node.mode === "attachment") continue;
      // Every ancestor level exists as a bubble even when it only holds folders.
      const parts = node.folder === "" ? [] : node.folder.split("/");
      let acc = "";
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        ensureFolder(acc);
      }
      if (node.folder === "") {
        rootNotes.push(node.path);
      } else {
        const entry = ensureFolder(node.folder);
        entry.noteCount += 1;
        if (isReservedOkfName(node.path)) entry.hasIndexNote = true;
      }
    }

    const bundleMap = new Map<string, { source: string; target: string; count: number }>();
    for (const e of g.edges) {
      const sf = folderOf(e.source);
      const tf = folderOf(e.target);
      if (sf === tf) continue;
      const key = `${sf}\u0000${tf}`;
      const existing = bundleMap.get(key);
      if (existing) existing.count += e.count;
      else bundleMap.set(key, { source: sf, target: tf, count: e.count });
    }

    return {
      folders: [...folders.values()].sort((a, b) => a.folder.localeCompare(b.folder)),
      rootNotes: rootNotes.sort(),
      folderEdges: [...bundleMap.values()],
    };
  }

  /** Unfolding one bubble: direct notes, child folders, inner + external edges. */
  async getFolderSubgraph(folder: string, graph?: VaultGraph): Promise<FolderSubgraph> {
    const g = graph ?? (await this.loadGraph());
    const prefix = folder === "" ? "" : `${folder}/`;

    const notes: GraphNodeInfo[] = [];
    const childCounts = new Map<string, number>();
    for (const node of g.nodes.values()) {
      if (node.mode === "attachment") continue;
      if (node.folder === folder) {
        notes.push(node);
      } else if (node.path.startsWith(prefix) && prefix !== "") {
        const rest = node.folder.substring(prefix.length);
        const child = `${prefix}${rest.split("/")[0]}`;
        childCounts.set(child, (childCounts.get(child) ?? 0) + 1);
      } else if (prefix === "" && node.folder !== "") {
        const child = node.folder.split("/")[0];
        childCounts.set(child, (childCounts.get(child) ?? 0) + 1);
      }
    }
    const notePaths = new Set(notes.map((n) => n.path));

    const innerEdges: GraphEdgeInfo[] = [];
    const externalMap = new Map<string, { source: string; targetFolder: string; count: number }>();
    for (const e of g.edges) {
      const sIn = notePaths.has(e.source);
      const tIn = notePaths.has(e.target);
      if (sIn && tIn) {
        innerEdges.push(e);
      } else if (sIn || tIn) {
        const source = sIn ? e.source : e.target;
        const other = sIn ? e.target : e.source;
        const targetFolder = folderOf(other);
        const key = `${source}\u0000${targetFolder}`;
        const existing = externalMap.get(key);
        if (existing) existing.count += e.count;
        else externalMap.set(key, { source, targetFolder, count: e.count });
      }
    }

    return {
      folder,
      notes: notes.sort((a, b) => a.title.localeCompare(b.title)),
      subfolders: [...childCounts.entries()]
        .map(([f, noteCount]) => ({ folder: f, noteCount }))
        .sort((a, b) => a.folder.localeCompare(b.folder)),
      innerEdges,
      externalEdges: [...externalMap.values()],
    };
  }

  /** Notes without a single resolved edge in either direction. Reserved OKF
   *  notes (index.md/log.md) are folder infrastructure, never cleanup work. */
  async getOrphans(graph?: VaultGraph): Promise<GraphNodeInfo[]> {
    const g = graph ?? (await this.loadGraph());
    const adj = this.adjacency(g);
    const orphans: GraphNodeInfo[] = [];
    for (const node of g.nodes.values()) {
      if (node.mode === "attachment") continue;
      if (isReservedOkfName(node.path)) continue;
      if ((adj.get(node.path)?.size ?? 0) > 0) continue;
      orphans.push(node);
    }
    return orphans.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Links whose target resolves to nothing (targets renamed away/never created). */
  async getBrokenLinks(graph?: VaultGraph): Promise<BrokenLinkInfo[]> {
    const g = graph ?? (await this.loadGraph({ includeAttachments: true }));
    return [...g.broken].sort(
      (a, b) => a.sourcePath.localeCompare(b.sourcePath) || (a.lineNumber ?? 0) - (b.lineNumber ?? 0)
    );
  }

  /**
   * Note pairs frequently linked FROM the same sources but not linked to each
   * other. Sources linking more than HUB_NEIGHBOR_CAP notes are skipped.
   */
  async suggestCoCitations(limit: number = 50, graph?: VaultGraph): Promise<GraphSuggestion[]> {
    const g = graph ?? (await this.loadGraph());
    const adj = this.adjacency(g);
    const targetsBySource = new Map<string, Set<string>>();
    for (const e of g.edges) {
      if (!g.nodes.get(e.target) || g.nodes.get(e.target)!.mode === "attachment") continue;
      let set = targetsBySource.get(e.source);
      if (!set) targetsBySource.set(e.source, (set = new Set()));
      set.add(e.target);
    }

    const pairCounts = new Map<string, { a: string; b: string; count: number }>();
    for (const targets of targetsBySource.values()) {
      if (targets.size < 2 || targets.size > HUB_NEIGHBOR_CAP) continue;
      const list = [...targets];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const key = pairKey(list[i], list[j]);
          const entry = pairCounts.get(key);
          if (entry) entry.count += 1;
          else pairCounts.set(key, { a: list[i], b: list[j], count: 1 });
        }
      }
    }

    const out: GraphSuggestion[] = [];
    for (const { a, b, count } of pairCounts.values()) {
      if (count < 2) continue; // one shared citer is noise
      if (adj.get(a)?.has(b)) continue;
      out.push({ source: a, target: b, reason: "cocitation", score: count, detail: String(count) });
    }
    return out.sort((x, y) => y.score - x.score).slice(0, limit);
  }

  /**
   * Note pairs with strongly overlapping link neighborhoods (Jaccard >= 0.25,
   * at least 2 shared neighbors) that are not directly linked.
   */
  async suggestByNeighbors(limit: number = 50, graph?: VaultGraph): Promise<GraphSuggestion[]> {
    const g = graph ?? (await this.loadGraph());
    const adj = this.adjacency(g);

    const shared = new Map<string, { a: string; b: string; count: number }>();
    for (const [, neighbors] of adj) {
      if (neighbors.size < 2 || neighbors.size > HUB_NEIGHBOR_CAP) continue;
      const list = [...neighbors].filter((p) => g.nodes.get(p) && g.nodes.get(p)!.mode !== "attachment");
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const key = pairKey(list[i], list[j]);
          const entry = shared.get(key);
          if (entry) entry.count += 1;
          else shared.set(key, { a: list[i], b: list[j], count: 1 });
        }
      }
    }

    const out: GraphSuggestion[] = [];
    for (const { a, b, count } of shared.values()) {
      if (count < 2) continue;
      if (adj.get(a)?.has(b)) continue;
      const sizeA = adj.get(a)?.size ?? 0;
      const sizeB = adj.get(b)?.size ?? 0;
      const union = sizeA + sizeB - count;
      const jaccard = union > 0 ? count / union : 0;
      if (jaccard < 0.25) continue;
      out.push({ source: a, target: b, reason: "neighbors", score: jaccard });
    }
    return out.sort((x, y) => y.score - x.score).slice(0, limit);
  }

  /** Note pairs sharing a RARE tag (2..rareMax uses) without a direct link. */
  async suggestBySharedTags(rareMax: number = 5, limit: number = 50, graph?: VaultGraph): Promise<GraphSuggestion[]> {
    const g = graph ?? (await this.loadGraph());
    const adj = this.adjacency(g);

    const tagRows = await this.db.query<{ tag: string }>(
      `SELECT tag FROM tags GROUP BY tag HAVING COUNT(DISTINCT file_id) BETWEEN 2 AND ?`,
      [rareMax]
    );

    const out: GraphSuggestion[] = [];
    const seen = new Set<string>();
    for (const tagRow of tagRows) {
      const tag = String((tagRow as any).tag ?? (tagRow as any).TAG ?? "");
      if (!tag) continue;
      const fileRows = await this.db.query<{ path: string }>(
        `SELECT f.path AS path FROM tags t JOIN files f ON f.id = t.file_id WHERE t.tag = ?`,
        [tag]
      );
      const paths = fileRows
        .map((r) => String((r as any).path ?? (r as any).PATH ?? ""))
        .filter((p) => p && g.nodes.has(p) && g.nodes.get(p)!.mode !== "attachment");
      for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
          const key = pairKey(paths[i], paths[j]);
          if (seen.has(key)) continue;
          if (adj.get(paths[i])?.has(paths[j])) continue;
          seen.add(key);
          out.push({
            source: paths[i],
            target: paths[j],
            reason: "tag",
            score: 1 / Math.max(1, paths.length - 1),
            detail: tag,
          });
        }
      }
    }
    return out.sort((x, y) => y.score - x.score).slice(0, limit);
  }

  /**
   * Finds notes that MENTION another note's title/alias in their text without
   * linking to it. Vault-wide scans run one exact-phrase FTS query per term
   * (abortable, progress-reporting); with `forPath` the scan is scoped to
   * mentions OF that note plus foreign titles inside that note's own text.
   * Sources that are reserved OKF notes (index.md listings mention everything)
   * are skipped.
   */
  async findUnlinkedMentions(opts: UnlinkedMentionScanOptions = {}, graph?: VaultGraph): Promise<GraphSuggestion[]> {
    const g = graph ?? (await this.loadGraph());
    const adj = this.adjacency(g);
    const maxResults = opts.maxResults ?? 500;

    // Candidate terms: title + aliases per note.
    const aliasRows = await this.db.query<{ path: string; value: string | null }>(
      `SELECT f.path AS path, p.value AS value
       FROM properties p JOIN files f ON f.id = p.file_id
       WHERE p.key = 'aliases'`
    );
    const aliasesByPath = new Map<string, string[]>();
    for (const row of aliasRows) {
      const p = String((row as any).path ?? (row as any).PATH ?? "");
      const raw = (row as any).value ?? (row as any).VALUE;
      if (!p || typeof raw !== "string") continue;
      try {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        aliasesByPath.set(
          p,
          list.map((a) => String(a)).filter((a) => a.trim().length >= MENTION_MIN_TERM_LENGTH)
        );
      } catch {
        if (raw.trim().length >= MENTION_MIN_TERM_LENGTH) aliasesByPath.set(p, [raw.trim()]);
      }
    }

    const termsFor = (node: GraphNodeInfo): string[] => {
      const terms: string[] = [];
      const title = node.title.trim();
      if (title.length >= MENTION_MIN_TERM_LENGTH && /[\p{L}\p{N}]/u.test(title) && !/^\d+$/.test(title)) {
        terms.push(title);
      }
      for (const alias of aliasesByPath.get(node.path) ?? []) terms.push(alias);
      return terms;
    };

    const eligibleTarget = (node: GraphNodeInfo) =>
      node.mode !== "attachment" && !isReservedOkfName(node.path);

    const results: GraphSuggestion[] = [];
    const seen = new Set<string>();
    const push = (source: string, target: string, term: string) => {
      if (source === target) return;
      const sourceNode = g.nodes.get(source);
      if (!sourceNode || sourceNode.mode === "attachment" || isReservedOkfName(source)) return;
      if (adj.get(source)?.has(target)) return; // already linked in some direction
      const key = `${source}\u0000${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ source, target, reason: "mention", score: 1, term });
    };

    if (opts.forPath) {
      const centerNode = g.nodes.get(opts.forPath);
      if (!centerNode) return [];

      // (a) Who mentions the focused note? One FTS query per own term.
      const ownTerms = termsFor(centerNode);
      for (const term of ownTerms) {
        if (opts.signal?.aborted) return results;
        const rows = await this.db.query<{ path: string }>(
          `SELECT path FROM fts_notes WHERE fts_notes MATCH ?`,
          [ftsPhrase(term)]
        );
        for (const r of rows) {
          const p = String((r as any).path ?? (r as any).PATH ?? "");
          if (p) push(p, opts.forPath, term);
        }
      }

      // (b) Which foreign titles appear inside the focused note's own text?
      const contentRow = await this.db.queryOne<{ content: string | null }>(
        `SELECT content FROM fts_notes WHERE path = ?`,
        [opts.forPath]
      );
      const content = ((contentRow as any)?.content ?? (contentRow as any)?.CONTENT ?? "") as string;
      if (content) {
        const lower = content.toLowerCase();
        for (const node of g.nodes.values()) {
          if (node.path === opts.forPath || !eligibleTarget(node)) continue;
          for (const term of termsFor(node)) {
            if (!lower.includes(term.toLowerCase())) continue;
            const boundary = new RegExp(
              `(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
              "iu"
            );
            if (boundary.test(content)) {
              push(opts.forPath, node.path, term);
              break;
            }
          }
        }
      }
      return results.slice(0, maxResults);
    }

    // Vault-wide scan: one FTS phrase query per candidate term.
    const candidates: { node: GraphNodeInfo; term: string }[] = [];
    for (const node of g.nodes.values()) {
      if (!eligibleTarget(node)) continue;
      for (const term of termsFor(node)) candidates.push({ node, term });
    }

    for (let i = 0; i < candidates.length; i++) {
      if (opts.signal?.aborted || results.length >= maxResults) break;
      const { node, term } = candidates[i];
      opts.onProgress?.(i + 1, candidates.length, term);
      const rows = await this.db.query<{ path: string }>(
        `SELECT path FROM fts_notes WHERE fts_notes MATCH ?`,
        [ftsPhrase(term)]
      );
      for (const r of rows) {
        const p = String((r as any).path ?? (r as any).PATH ?? "");
        if (p) push(p, node.path, term);
      }
    }
    return results.slice(0, maxResults);
  }

  /**
   * Frontmatter dates for the replay overlay: `date`/`datum`/`created`
   * property values parsed to epoch ms (first parseable in that priority).
   * Consumers fall back to files.ctime, then mtime.
   */
  async getEffectiveDates(): Promise<Map<string, number>> {
    const rows = await this.db.query<{ path: string; key: string; value: string | null }>(
      `SELECT f.path AS path, p.key AS key, p.value AS value
       FROM properties p JOIN files f ON f.id = p.file_id
       WHERE p.key IN ('date', 'datum', 'created')`
    );
    const priority: Record<string, number> = { date: 0, datum: 1, created: 2 };
    const best = new Map<string, { prio: number; ms: number }>();
    for (const row of rows) {
      const path = String((row as any).path ?? (row as any).PATH ?? "");
      const key = String((row as any).key ?? (row as any).KEY ?? "");
      const raw = (row as any).value ?? (row as any).VALUE;
      if (!path || typeof raw !== "string") continue;
      const ms = Date.parse(raw);
      if (Number.isNaN(ms)) continue;
      const prio = priority[key] ?? 9;
      const existing = best.get(path);
      if (!existing || prio < existing.prio) best.set(path, { prio, ms });
    }
    const out = new Map<string, number>();
    for (const [path, { ms }] of best) out.set(path, ms);
    return out;
  }

  /** Built-in suggestion providers (E2); order = display order. */
  getSuggestionProviders(): GraphSuggestionProvider[] {
    const scope = (list: GraphSuggestion[], forPath: string | null, limit: number) => {
      const scoped = forPath ? list.filter((s) => s.source === forPath || s.target === forPath) : list;
      return scoped.slice(0, limit);
    };
    return [
      {
        id: "mention",
        suggest: async (forPath, limit, signal) =>
          (await this.findUnlinkedMentions({ forPath, signal, maxResults: forPath ? limit * 4 : limit })).slice(0, limit),
      },
      {
        id: "cocitation",
        suggest: async (forPath, limit) => scope(await this.suggestCoCitations(forPath ? 200 : limit), forPath, limit),
      },
      {
        id: "neighbors",
        suggest: async (forPath, limit) => scope(await this.suggestByNeighbors(forPath ? 200 : limit), forPath, limit),
      },
      {
        id: "tag",
        suggest: async (forPath, limit) => scope(await this.suggestBySharedTags(5, forPath ? 200 : limit), forPath, limit),
      },
    ];
  }
}
