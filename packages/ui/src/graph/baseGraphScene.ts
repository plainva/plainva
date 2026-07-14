import type { VaultGraph } from "@plainva/core";
import { isReservedOkfName } from "@plainva/core";
import { computeForceLayout, logRadius } from "@plainva/ui";
import type { SceneEdge, SceneNode } from "@plainva/ui";

/**
 * Pure scene construction for the `.base` graph view (no React, no
 * VaultContext - unit-testable without the Tauri runtime).
 */

const PALETTE_SIZE = 8;

export interface BaseGraphSceneInput {
  rows: any[];
  graph: VaultGraph;
  edgeKeys: string[];
  showWikiLinks: boolean;
  showExternal: boolean;
  /** Also draw relations that point INTO the view's rows from outside (e.g. a
   * project's tasks), materializing those external notes as dimmed nodes. */
  showIncoming: boolean;
  colorBy: string | null;
  sizeBy: string | null;
  pins: Record<string, { x: number; y: number }>;
  seed: string;
  /** Localized edge label for a relation property key (defaults to the raw key). */
  labelForKey?: (key: string) => string;
  /** When not true, OKF-reserved notes (index.md, log.md) are hidden as row/external nodes. */
  showIndexNotes?: boolean;
}

/** Pure scene construction for the base graph view (unit-tested). */
export function buildBaseGraphScene(input: BaseGraphSceneInput): { nodes: SceneNode[]; edges: SceneEdge[] } {
  const { rows, graph, edgeKeys, showWikiLinks, showExternal, showIncoming, colorBy, sizeBy, pins, seed, showIndexNotes } = input;
  const relLabel = input.labelForKey ?? ((k: string) => k);
  const rowPaths = new Set<string>(
    rows
      .map((r) => String(r["file.path"] ?? ""))
      .filter((path) => path && (showIndexNotes || !isReservedOkfName(path)))
  );

  // Color mapping: distinct select values -> chip indices in first-seen order.
  const colorIndex = new Map<string, number>();
  const colorOf = (row: any): number | null => {
    if (!colorBy) return null;
    const value = row[colorBy];
    if (value == null || value === "") return null;
    const key = String(value);
    if (!colorIndex.has(key)) colorIndex.set(key, colorIndex.size % PALETTE_SIZE);
    return colorIndex.get(key)!;
  };

  // Size mapping: WITH an explicit number property, sqrt-scaled 8..20 over its
  // range; WITHOUT one, fall back to the in-view connection degree (filled by the
  // edge loop below) so every base graph is differentiated out of the box instead
  // of drawing every row at the same radius (maintainer report 2026-07-14).
  const viewDegree = new Map<string, number>();
  let sizeMin = Infinity;
  let sizeMax = -Infinity;
  if (sizeBy) {
    for (const row of rows) {
      const v = Number(row[sizeBy]);
      if (Number.isFinite(v)) {
        sizeMin = Math.min(sizeMin, v);
        sizeMax = Math.max(sizeMax, v);
      }
    }
  }
  const sizeOf = (row: any): number => {
    if (!sizeBy || !Number.isFinite(sizeMin) || sizeMax <= sizeMin) {
      const path = String(row["file.path"] ?? "");
      return logRadius(viewDegree.get(path) ?? 0, { min: 8, max: 20, k: 1.6 });
    }
    const v = Number(row[sizeBy]);
    if (!Number.isFinite(v)) return 8;
    return 8 + Math.sqrt((v - sizeMin) / (sizeMax - sizeMin)) * 12;
  };

  // Edges from the resolved link index: relation properties + optional wiki
  // links (outgoing), and — when enabled — relations pointing INTO the rows
  // from outside (incoming, e.g. a project's tasks).
  const keySet = new Set(edgeKeys);
  const edges: SceneEdge[] = [];
  const externalNodes = new Set<string>();
  const bundle = new Map<string, SceneEdge>();
  const addEdge = (source: string, target: string, style: "property" | "link", rawKey: string, label: string | undefined, count: number) => {
    viewDegree.set(source, (viewDegree.get(source) ?? 0) + count);
    viewDegree.set(target, (viewDegree.get(target) ?? 0) + count);
    const key = `${source} ${target} ${rawKey}`;
    const existing = bundle.get(key);
    if (existing) {
      existing.width += count;
      return;
    }
    const edge: SceneEdge = { id: key, source, target, style, label, width: count };
    bundle.set(key, edge);
    edges.push(edge);
  };
  for (const e of graph.edges) {
    if (!showIndexNotes && (isReservedOkfName(e.source) || isReservedOkfName(e.target))) continue;
    const sourceInRows = rowPaths.has(e.source);
    const targetInRows = rowPaths.has(e.target);
    if (sourceInRows) {
      // Outgoing / same-view relation or wiki link.
      const isRelation = e.kind === "property" && e.propertyKey != null && keySet.has(e.propertyKey);
      const isWiki = showWikiLinks && e.kind !== "property";
      if (!isRelation && !isWiki) continue;
      if (!targetInRows) {
        if (!showExternal) continue;
        externalNodes.add(e.target);
      }
      addEdge(e.source, e.target, isRelation ? "property" : "link", isRelation ? e.propertyKey! : "@wiki", isRelation ? relLabel(e.propertyKey!) : undefined, e.count);
    } else if (targetInRows && showIncoming && e.kind === "property" && e.propertyKey != null) {
      // Incoming relation: an external note's relation points into a row. The
      // property key belongs to the foreign base, so it is never in keySet —
      // one toggle shows them all (the cross-DB counterparts).
      externalNodes.add(e.source);
      addEdge(e.source, e.target, "property", e.propertyKey, relLabel(e.propertyKey), e.count);
    }
  }

  // Layout: seeded force over rows + external neighbours, pins override.
  const nodeIds = [...rowPaths, ...externalNodes];
  const rowByPath = new Map(rows.map((r) => [String(r["file.path"] ?? ""), r]));
  const layout = computeForceLayout(
    nodeIds.map((id) => ({
      id,
      size: rowByPath.has(id) ? sizeOf(rowByPath.get(id)) : 8,
      fx: pins[id]?.x,
      fy: pins[id]?.y,
    })),
    edges.map((e) => ({ source: e.source, target: e.target })),
    { seed }
  );

  const nodes: SceneNode[] = nodeIds.map((id) => {
    const row = rowByPath.get(id);
    const pos = layout.positions.get(id) ?? { x: 0, y: 0 };
    const info = graph.nodes.get(id);
    return {
      id,
      label: row ? String(row["file.name"] ?? id) : (info?.title ?? id),
      shape: "note",
      size: row ? sizeOf(row) : 8,
      colorToken: row ? colorOf(row) : null,
      x: pins[id]?.x ?? pos.x,
      y: pins[id]?.y ?? pos.y,
      pinned: !!pins[id],
      dimmed: !row,
      icon: undefined,
    };
  });

  return { nodes, edges };
}
