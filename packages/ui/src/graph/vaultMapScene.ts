import type { FolderOverview, GraphEdgeKind, VaultGraph } from "@plainva/core";
import { computeForceLayout, logRadius, packCircles, resolveCollisions } from "./graphLayout";
import type { SceneEdge, SceneEdgeStyle, SceneNode } from "./graphTypes";

/**
 * Pure scene construction for the vault map (semantic zoom, decision E3):
 * folders are the clusters. A note is represented by itself when its whole
 * folder chain is expanded, else by its topmost UNexpanded ancestor folder.
 * Edges are re-mapped onto representatives and bundled — the hairball cannot
 * exist because collapsed regions are single bubbles by construction.
 */

export interface VaultMapFilters {
  /** Lowercased title/path substring; misses are dimmed. */
  query: string;
  /** OKF type; null = all. */
  okfType: string | null;
  /** Paths carrying the selected tag; null = no tag filter. */
  tagPaths: Set<string> | null;
  /** Edge kinds to show. */
  edgeKinds: Set<GraphEdgeKind>;
}

export interface VaultMapFocus {
  seed: string;
  depth: number;
}

/**
 * Time overlays (P5). Heatmap brightens recently edited notes; replay hides
 * notes whose effective date (frontmatter date > ctime > mtime) is after the
 * cutoff — visibility flags only, the layout never recomputes per frame.
 */
export type VaultMapOverlay =
  | { mode: "normal" }
  | { mode: "heatmap"; now: number }
  | { mode: "replay"; cutoff: number; dates: Map<string, number> };

export interface VaultMapInput {
  graph: VaultGraph;
  overview: FolderOverview;
  expanded: Set<string>;
  pins: Record<string, { x: number; y: number }>;
  icons: Map<string, { icon: string; color?: string }>;
  filters: VaultMapFilters;
  focus: VaultMapFocus | null;
  overlay: VaultMapOverlay;
  seed: string;
}

export interface VaultMapScene {
  nodes: SceneNode[];
  edges: SceneEdge[];
  /** Bundle id -> the original edges behind it (edge popover). */
  bundles: Map<string, { source: string; target: string; kind: GraphEdgeKind; propertyKey: string | null; count: number }[]>;
  stats: { notes: number; links: number };
}

export const DEFAULT_EDGE_KINDS: GraphEdgeKind[] = ["wikilink", "embed", "markdown-link", "property"];

function topSegment(folder: string): string {
  return folder === "" ? "" : folder.split("/")[0];
}

/** Topmost unexpanded ancestor folder of a path, or the path itself. */
export function representativeOf(path: string, folder: string, expanded: Set<string>): string {
  if (folder === "") return path;
  const parts = folder.split("/");
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    if (!expanded.has(acc)) return `folder:${acc}`;
  }
  return path;
}

function styleOf(kind: GraphEdgeKind): SceneEdgeStyle {
  if (kind === "property") return "property";
  if (kind === "embed") return "embed";
  return "link";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function heatOf(mtime: number, now: number): number {
  const age = now - mtime;
  if (age < 7 * DAY_MS) return 1;
  if (age < 30 * DAY_MS) return 0.6;
  if (age < 90 * DAY_MS) return 0.25;
  return 0;
}

export function effectiveDate(path: string, graph: VaultGraph, dates: Map<string, number>): number {
  const fm = dates.get(path);
  if (fm !== undefined) return fm;
  const info = graph.nodes.get(path);
  return info?.ctime ?? info?.mtime ?? 0;
}

export function buildVaultMapScene(input: VaultMapInput): VaultMapScene {
  const { graph, overview, expanded, pins, icons, filters, focus, overlay, seed } = input;

  // ---- representatives -------------------------------------------------------
  const noteReps = new Map<string, string>(); // note path -> rep id
  const repMembers = new Map<string, string[]>(); // folder rep -> member note paths
  let noteCount = 0;
  for (const node of graph.nodes.values()) {
    if (node.mode === "attachment") continue;
    noteCount++;
    const rep = representativeOf(node.path, node.folder, expanded);
    noteReps.set(node.path, rep);
    if (rep !== node.path) {
      const list = repMembers.get(rep) ?? [];
      list.push(node.path);
      repMembers.set(rep, list);
    }
  }

  // Connection degree per note — log2-compressed node size (self-represented
  // notes size by degree, folder bubbles by their recursive member count).
  // Summed once (O(E)); the same sizes feed the collision relaxation below.
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + (e.count ?? 1));
    degree.set(e.target, (degree.get(e.target) ?? 0) + (e.count ?? 1));
  }
  const sizeOf = (id: string): number =>
    id.startsWith("folder:")
      ? logRadius((repMembers.get(id) ?? []).length, { min: 12, max: 42, k: 2.2 })
      : logRadius(degree.get(id) ?? 0, { min: 4.5, max: 15, k: 1.6 });

  // Visible entities: folder reps + self-represented notes; plus EXPANDED
  // folders whose direct children are visible (they render as ring-less
  // anchors only through their children, so no node for them).
  const matches = (path: string): boolean => {
    const info = graph.nodes.get(path);
    if (!info) return false;
    if (filters.okfType && info.okfType !== filters.okfType) return false;
    if (filters.tagPaths && !filters.tagPaths.has(path)) return false;
    if (filters.query) {
      const q = filters.query;
      if (!info.title.toLowerCase().includes(q) && !info.path.toLowerCase().includes(q)) return false;
    }
    return true;
  };
  const anyFilter = filters.query !== "" || filters.okfType !== null || filters.tagPaths !== null;

  const folderCounts = new Map<string, number>();
  for (const f of overview.folders) {
    // Recursive count: sum of direct counts of the folder and its subfolders.
    for (const g of overview.folders) {
      if (g.folder === f.folder || g.folder.startsWith(`${f.folder}/`)) {
        folderCounts.set(f.folder, (folderCounts.get(f.folder) ?? 0) + g.noteCount);
      }
    }
  }

  const entityIds: string[] = [];
  for (const rep of new Set([...noteReps.values()])) entityIds.push(rep);

  // ---- layout ----------------------------------------------------------------
  // Top groups: first path segment ("" = root bucket). Pack the groups, then
  // force-lay the group members inside their circle.
  const groupOf = (id: string): string =>
    id.startsWith("folder:") ? topSegment(id.slice(7)) : topSegment(graph.nodes.get(id)?.folder ?? "");
  const groups = new Map<string, string[]>();
  for (const id of entityIds) {
    const g = groupOf(id);
    const list = groups.get(g) ?? [];
    list.push(id);
    groups.set(g, list);
  }
  const groupWeight = (g: string): number => (g === "" ? Math.max(1, overview.rootNotes.length) : (folderCounts.get(g) ?? 1));
  const packed = packCircles(
    [...groups.keys()].sort().map((g) => ({ id: g === "" ? "@root" : g, count: groupWeight(g) })),
    { radius: 90 * Math.sqrt(Math.max(4, noteCount)) }
  );
  const groupCircle = new Map<string, { x: number; y: number; r: number }>();
  for (const c of packed) groupCircle.set(c.id === "@root" ? "" : c.id, c);

  const positions = new Map<string, { x: number; y: number }>();
  for (const [g, members] of groups) {
    const circle = groupCircle.get(g) ?? { x: 0, y: 0, r: 200 };
    if (members.length === 1) {
      positions.set(members[0], { x: circle.x, y: circle.y });
      continue;
    }
    const layout = computeForceLayout(
      members.map((id) => ({ id, size: sizeOf(id) })),
      graph.edges
        .map((e) => ({ source: noteReps.get(e.source) ?? e.source, target: noteReps.get(e.target) ?? e.target }))
        .filter((e) => groups.get(g)!.includes(e.source) && groups.get(g)!.includes(e.target)),
      { seed: `${seed}:${g}`, spread: Math.min(70, 22 + circle.r / Math.max(2, Math.sqrt(members.length))) }
    );
    // Scale into the circle.
    let maxDist = 1;
    for (const p of layout.positions.values()) maxDist = Math.max(maxDist, Math.hypot(p.x, p.y));
    const scale = (circle.r * 0.85) / maxDist;
    for (const [id, p] of layout.positions) {
      positions.set(id, { x: circle.x + p.x * scale, y: circle.y + p.y * scale });
    }
  }
  for (const [id, pin] of Object.entries(pins)) {
    if (positions.has(id)) positions.set(id, { x: pin.x, y: pin.y });
  }

  // Collision relaxation per group (report 2026-07-14): the "scale into circle"
  // step scales positions but not radii, so forceCollide's separation can come
  // back as overlap. Re-separate each group with the real render sizes; pinned
  // nodes stay fixed. Per-group so clusters don't bleed into each other.
  for (const [g, members] of groups) {
    if (members.length < 2) continue;
    const resolved = resolveCollisions(
      members.map((id) => {
        const p = positions.get(id) ?? { x: 0, y: 0 };
        return { id, x: p.x, y: p.y, size: sizeOf(id), fixed: !!pins[id] };
      }),
      { seed: `${seed}:collide:${g}`, padding: 4, iterations: 30 }
    );
    for (const [id, p] of resolved) positions.set(id, p);
  }

  // ---- edges (bundled on representatives) -------------------------------------
  const bundleMap = new Map<string, { source: string; target: string; styles: Map<SceneEdgeStyle, number>; width: number; label?: string }>();
  const bundles: VaultMapScene["bundles"] = new Map();
  let linkTotal = 0;
  for (const e of graph.edges) {
    if (!filters.edgeKinds.has(e.kind)) continue;
    linkTotal += e.count;
    const s = noteReps.get(e.source) ?? e.source;
    const t = noteReps.get(e.target) ?? e.target;
    if (s === t) continue;
    const key = s < t ? `${s}\u0000${t}` : `${t}\u0000${s}`;
    let bundle = bundleMap.get(key);
    if (!bundle) {
      bundle = { source: s, target: t, styles: new Map(), width: 0 };
      bundleMap.set(key, bundle);
      bundles.set(key, []);
    }
    const isFolderBundle = s.startsWith("folder:") || t.startsWith("folder:");
    const style = isFolderBundle ? "structure" : styleOf(e.kind);
    bundle.styles.set(style, (bundle.styles.get(style) ?? 0) + e.count);
    bundle.width += e.count;
    if (!isFolderBundle && e.kind === "property" && e.propertyKey) bundle.label = e.propertyKey;
    bundles.get(key)!.push({ source: e.source, target: e.target, kind: e.kind, propertyKey: e.propertyKey, count: e.count });
  }

  // ---- focus (hide everything outside seed + depth hops) ----------------------
  let visibleSet: Set<string> | null = null;
  if (focus) {
    const seedRep = noteReps.get(focus.seed) ?? focus.seed;
    const adj = new Map<string, Set<string>>();
    for (const b of bundleMap.values()) {
      if (!adj.has(b.source)) adj.set(b.source, new Set());
      if (!adj.has(b.target)) adj.set(b.target, new Set());
      adj.get(b.source)!.add(b.target);
      adj.get(b.target)!.add(b.source);
    }
    visibleSet = new Set([seedRep]);
    let frontier = [seedRep];
    for (let d = 0; d < focus.depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const n of adj.get(id) ?? []) {
          if (!visibleSet.has(n)) {
            visibleSet.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
  }

  // ---- nodes -------------------------------------------------------------------
  const nodes: SceneNode[] = [];
  const typeColorCache = new Map<string, number>();
  const typeColor = (okfType: string | null): number | null => {
    if (!okfType) return null;
    let cached = typeColorCache.get(okfType);
    if (cached === undefined) {
      let h = 0;
      for (let i = 0; i < okfType.length; i++) h = (h * 31 + okfType.charCodeAt(i)) | 0;
      cached = Math.abs(h) % 8;
      typeColorCache.set(okfType, cached);
    }
    return cached;
  };

  const replayVisible = (path: string): boolean =>
    overlay.mode !== "replay" || effectiveDate(path, graph, overlay.dates) <= overlay.cutoff;

  for (const id of entityIds) {
    const pos = positions.get(id) ?? { x: 0, y: 0 };
    const focusHidden = visibleSet ? !visibleSet.has(id) : false;
    if (id.startsWith("folder:")) {
      const folder = id.slice(7);
      const members = repMembers.get(id) ?? [];
      const memberMatch = !anyFilter || members.some((m) => matches(m));
      const visibleMembers = overlay.mode === "replay" ? members.filter((m) => replayVisible(m)) : members;
      const heat =
        overlay.mode === "heatmap" && visibleMembers.length > 0
          ? Math.max(...visibleMembers.map((m) => heatOf(graph.nodes.get(m)?.mtime ?? 0, overlay.now)))
          : null;
      nodes.push({
        id,
        label: folder.split("/").pop() ?? folder,
        shape: "folder",
        size: sizeOf(id),
        badge: visibleMembers.length,
        x: pos.x,
        y: pos.y,
        pinned: !!pins[id],
        dimmed: anyFilter && !memberMatch,
        hidden: focusHidden || (overlay.mode === "replay" && visibleMembers.length === 0),
        heat,
      });
    } else {
      const info = graph.nodes.get(id);
      if (!info) continue;
      nodes.push({
        id,
        label: info.title,
        shape: info.mode === "attachment" ? "attachment" : "note",
        size: sizeOf(id),
        icon: icons.get(id)?.icon,
        color: icons.get(id)?.color,
        colorToken: typeColor(info.okfType),
        x: pos.x,
        y: pos.y,
        pinned: !!pins[id],
        dimmed: anyFilter && !matches(id),
        hidden: focusHidden || !replayVisible(id),
        heat: overlay.mode === "heatmap" ? heatOf(info.mtime, overlay.now) : null,
      });
    }
  }

  const edges: SceneEdge[] = [];
  for (const [key, b] of bundleMap) {
    let style: SceneEdgeStyle = "link";
    let max = 0;
    for (const [s, n] of b.styles) {
      if (n > max) {
        max = n;
        style = s;
      }
    }
    const hidden = visibleSet ? !(visibleSet.has(b.source) && visibleSet.has(b.target)) : false;
    edges.push({ id: key, source: b.source, target: b.target, style, width: b.width, label: style === "property" ? b.label : undefined, hidden });
  }

  // Overlay/replay visibility propagates onto edges: an edge with a hidden
  // endpoint is hidden (the engine also guards, but stats/tests read this).
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    if (nodeById.get(e.source)?.hidden || nodeById.get(e.target)?.hidden) e.hidden = true;
  }

  return { nodes, edges, bundles, stats: { notes: noteCount, links: linkTotal } };
}
