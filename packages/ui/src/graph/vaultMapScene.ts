import type { FolderOverview, GraphEdgeKind, VaultGraph } from "@plainva/core";
import { isReservedOkfName } from "@plainva/core";
import { logRadius, packHierarchy, type HybridPackChild, type HybridPackContainer } from "./graphLayout";
import type { SceneEdge, SceneEdgeStyle, SceneNode } from "./graphTypes";

/**
 * Pure scene construction for the vault map (semantic zoom, decision E3):
 * folders are the clusters. A note is represented by itself when its whole
 * folder chain is expanded, else by its topmost UNexpanded ancestor folder.
 * Edges are re-mapped onto representatives and bundled — the hairball cannot
 * exist because collapsed regions are single bubbles by construction.
 *
 * Layout (A4 recursive packing): every unfolded folder becomes a CONTAINER
 * circle that encloses its content — sub-containers, collapsed-folder bubbles
 * and notes nest recursively like a map. Within each container the children
 * arrange by their links (hybrid: packed containers, force-laid notes); the
 * container's center/radius always derive from its (possibly pinned/dragged)
 * children, never the other way around.
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
  /** No longer read by the scene (containers derive from the folder chains);
   *  still accepted so the views' existing call sites stay unchanged. */
  overview?: FolderOverview;
  expanded: Set<string>;
  pins: Record<string, { x: number; y: number }>;
  icons: Map<string, { icon: string; color?: string }>;
  filters: VaultMapFilters;
  focus: VaultMapFocus | null;
  overlay: VaultMapOverlay;
  seed: string;
  /** Show OKF reserved notes (index.md/log.md). Default false — they are
   *  folder-listing infrastructure and link to everything, cluttering the graph. */
  showIndexNotes?: boolean;
}

export interface VaultMapScene {
  nodes: SceneNode[];
  edges: SceneEdge[];
  /** Bundle id -> the original edges behind it (edge popover). */
  bundles: Map<string, { source: string; target: string; kind: GraphEdgeKind; propertyKey: string | null; count: number }[]>;
  stats: { notes: number; links: number };
}

export const DEFAULT_EDGE_KINDS: GraphEdgeKind[] = ["wikilink", "embed", "markdown-link", "property"];

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
  const { graph, expanded, pins, icons, filters, focus, overlay, seed } = input;
  const hideReserved = input.showIndexNotes !== true;

  // ---- representatives -------------------------------------------------------
  const noteReps = new Map<string, string>(); // note path -> rep id
  const repMembers = new Map<string, string[]>(); // folder rep -> member note paths
  // Unfolded folders on the way to a visible leaf become container circles;
  // collect their transitive note members while walking each note's chain.
  const containerNotes = new Map<string, string[]>(); // "folder:F" -> note paths
  let noteCount = 0;
  for (const node of graph.nodes.values()) {
    if (node.mode === "attachment") continue;
    if (hideReserved && isReservedOkfName(node.path)) continue;
    noteCount++;
    const rep = representativeOf(node.path, node.folder, expanded);
    noteReps.set(node.path, rep);
    if (rep !== node.path) {
      const list = repMembers.get(rep) ?? [];
      list.push(node.path);
      repMembers.set(rep, list);
    }
    if (node.folder !== "") {
      let acc = "";
      for (const part of node.folder.split("/")) {
        acc = acc ? `${acc}/${part}` : part;
        if (!expanded.has(acc)) break;
        const key = `folder:${acc}`;
        const list = containerNotes.get(key) ?? [];
        list.push(node.path);
        containerNotes.set(key, list);
      }
    }
  }

  // Connection degree per note — log2-compressed node size for self-represented
  // notes. Summed once (O(E)); the same sizes feed the collision relaxation.
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    if (hideReserved && (isReservedOkfName(e.source) || isReservedOkfName(e.target))) continue;
    degree.set(e.source, (degree.get(e.source) ?? 0) + (e.count ?? 1));
    degree.set(e.target, (degree.get(e.target) ?? 0) + (e.count ?? 1));
  }
  // Folder bubbles scale RELATIVE to the biggest folder in view (sqrt for
  // area-like perception) so folders differ visibly even when every count is
  // large (e.g. 233 vs 73). The biggest maps to the cap, so a giant vault never
  // produces a runaway circle (maintainer report 2026-07-14).
  let folderMax = 1;
  for (const members of repMembers.values()) folderMax = Math.max(folderMax, members.length);
  const sizeOf = (id: string): number =>
    id.startsWith("folder:")
      ? 10 + 34 * Math.sqrt(Math.min(1, (repMembers.get(id) ?? []).length / folderMax))
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

  const entityIds: string[] = [];
  for (const rep of new Set([...noteReps.values()])) entityIds.push(rep);

  // ---- layout (A4 recursive packing) -------------------------------------------
  // Tree: unfolded folders are containers, leaves are self-represented notes
  // and collapsed-folder bubbles. packHierarchy force-lays each level by its
  // links, encloses every container around its children (bottom-up) and lets
  // pinned leaves win — the container circle then reflows around them.
  const parentFolderOf = (folder: string): string =>
    folder.includes("/") ? folder.substring(0, folder.lastIndexOf("/")) : "";
  const containerIds = [...containerNotes.keys()].sort(); // parents sort before children
  const treeContainers = new Map<string, HybridPackContainer>();
  const topChildren: HybridPackChild[] = [];
  const parentIdOf = new Map<string, string | undefined>(); // node id -> enclosing container id
  for (const cid of containerIds) treeContainers.set(cid, { id: cid, children: [] });
  for (const cid of containerIds) {
    const parent = parentFolderOf(cid.slice(7));
    const host = parent === "" ? undefined : treeContainers.get(`folder:${parent}`);
    if (host) host.children.push(treeContainers.get(cid)!);
    else topChildren.push(treeContainers.get(cid)!);
    parentIdOf.set(cid, host?.id);
  }
  for (const id of entityIds) {
    const folder = id.startsWith("folder:") ? parentFolderOf(id.slice(7)) : (graph.nodes.get(id)?.folder ?? "");
    const leaf: HybridPackChild = { id, size: sizeOf(id), pin: pins[id] };
    const host = folder === "" ? undefined : treeContainers.get(`folder:${folder}`);
    if (host) host.children.push(leaf);
    else topChildren.push(leaf);
    parentIdOf.set(id, host?.id);
  }
  const packed = packHierarchy(
    topChildren,
    graph.edges
      .map((e) => ({ source: noteReps.get(e.source) ?? e.source, target: noteReps.get(e.target) ?? e.target }))
      .filter((e) => e.source !== e.target),
    { seed: `${seed}:pack` }
  );
  const positions = packed.positions;

  // ---- edges (bundled on representatives) -------------------------------------
  const bundleMap = new Map<string, { source: string; target: string; styles: Map<SceneEdgeStyle, number>; width: number; label?: string }>();
  const bundles: VaultMapScene["bundles"] = new Map();
  let linkTotal = 0;
  for (const e of graph.edges) {
    if (!filters.edgeKinds.has(e.kind)) continue;
    if (hideReserved && (isReservedOkfName(e.source) || isReservedOkfName(e.target))) continue;
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
    // Resolve the focus seed to its currently visible representative(s). A folder
    // seed whose folder is now EXPANDED has no node of its own, so the focus
    // follows INTO the folder: seed from the reps of its now-visible members
    // instead of losing the seed (report 2026-07-14: focus + expand = empty graph).
    const entitySet = new Set(entityIds);
    let seedReps: string[];
    if (focus.seed.startsWith("folder:") && expanded.has(focus.seed.slice(7))) {
      const folder = focus.seed.slice(7);
      const inside = new Set<string>();
      for (const [path, rep] of noteReps) {
        const f = graph.nodes.get(path)?.folder ?? "";
        if (f === folder || f.startsWith(`${folder}/`)) inside.add(rep);
      }
      seedReps = [...inside];
    } else {
      seedReps = [noteReps.get(focus.seed) ?? focus.seed];
    }
    const adj = new Map<string, Set<string>>();
    for (const b of bundleMap.values()) {
      if (!adj.has(b.source)) adj.set(b.source, new Set());
      if (!adj.has(b.target)) adj.set(b.target, new Set());
      adj.get(b.source)!.add(b.target);
      adj.get(b.target)!.add(b.source);
    }
    const seen = new Set(seedReps);
    let frontier = [...seedReps];
    for (let d = 0; d < focus.depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const n of adj.get(id) ?? []) {
          if (!seen.has(n)) {
            seen.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    // Guard: never apply a focus that would hide EVERY visible node.
    visibleSet = [...seen].some((id) => entitySet.has(id)) ? seen : null;
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
        parent: parentIdOf.get(id),
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
        parent: parentIdOf.get(id),
        pinned: !!pins[id],
        dimmed: anyFilter && !matches(id),
        hidden: focusHidden || !replayVisible(id),
        heat: overlay.mode === "heatmap" ? heatOf(info.mtime, overlay.now) : null,
      });
    }
  }

  // Container circles for unfolded folders: enclose their content, painted
  // behind the edges; visibility/heat/dimming derive from the transitive note
  // members. Never pinned — the circle always follows its children.
  for (const cid of containerIds) {
    const folder = cid.slice(7);
    const members = containerNotes.get(cid) ?? [];
    const memberMatch = !anyFilter || members.some((m) => matches(m));
    const visibleMembers = overlay.mode === "replay" ? members.filter((m) => replayVisible(m)) : members;
    const heat =
      overlay.mode === "heatmap" && visibleMembers.length > 0
        ? Math.max(...visibleMembers.map((m) => heatOf(graph.nodes.get(m)?.mtime ?? 0, overlay.now)))
        : null;
    const focusHidden = visibleSet
      ? !members.some((m) => {
          const rep = noteReps.get(m);
          return rep ? visibleSet.has(rep) : false;
        })
      : false;
    const pos = positions.get(cid) ?? { x: 0, y: 0 };
    nodes.push({
      id: cid,
      label: folder.split("/").pop() ?? folder,
      shape: "folder",
      container: true,
      size: packed.radii.get(cid) ?? 40,
      badge: visibleMembers.length,
      x: pos.x,
      y: pos.y,
      parent: parentIdOf.get(cid),
      dimmed: anyFilter && !memberMatch,
      hidden: focusHidden || (overlay.mode === "replay" && visibleMembers.length === 0),
      heat,
    });
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
