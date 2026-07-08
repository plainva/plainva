import type { GraphNeighborhood, GraphSuggestion, VaultGraph } from "@plainva/core";
import { arcPositions } from "./graphLayout";
import type { SceneEdge, SceneNode } from "./graphTypes";

/**
 * Pure scene construction for the context graph (no React, no VaultContext —
 * unit-testable without the Tauri runtime).
 */

export interface ContextData {
  neighborhood: GraphNeighborhood;
  graph: VaultGraph;
  suggestions: GraphSuggestion[];
}

const MAX_PER_ZONE = 8;

/** Scene ids are the vault paths, except zone overflow markers. */
export function scenePathOf(id: string): string | null {
  return id.startsWith("overflow:") ? null : id;
}

export function sceneHasContent(model: { nodes: SceneNode[] } | null): boolean {
  return !!model && model.nodes.length > 1;
}

export function buildContextScene(data: ContextData, activePath: string): { nodes: SceneNode[]; edges: SceneEdge[] } {
  const { neighborhood, graph } = data;
  const centerInfo = graph.nodes.get(activePath);
  const nodes: SceneNode[] = [];
  const edges: SceneEdge[] = [];

  const typeColor = (path: string): number | null => {
    const okfType = graph.nodes.get(path)?.okfType;
    if (!okfType) return null;
    let h = 0;
    for (let i = 0; i < okfType.length; i++) h = (h * 31 + okfType.charCodeAt(i)) | 0;
    return Math.abs(h) % 8;
  };

  nodes.push({
    id: activePath,
    label: centerInfo?.title ?? activePath,
    shape: "note",
    size: 15,
    colorToken: typeColor(activePath),
    x: 0,
    y: 0,
  });

  // Structure above: the folder chain (deepest last). Clicking opens the
  // folder's index note when one exists.
  const folder = centerInfo?.folder ?? "";
  const chain: string[] = [];
  if (folder) {
    let acc = "";
    for (const part of folder.split("/")) {
      acc = acc ? `${acc}/${part}` : part;
      chain.push(acc);
    }
  }
  const shownChain = chain.slice(-2);
  shownChain.forEach((f, i) => {
    const indexPath = `${f}/index.md`;
    const hasIndex = graph.nodes.has(indexPath);
    const id = hasIndex ? indexPath : `overflow:folder:${f}`;
    nodes.push({
      id,
      label: f.split("/").pop() ?? f,
      shape: "folder",
      size: 10,
      x: (i - (shownChain.length - 1) / 2) * 90,
      y: -110,
      dimmed: !hasIndex,
    });
    edges.push({ id: `structure:${f}`, source: id, target: activePath, style: "structure", width: 1 });
  });

  // Children below: for an index note, the folder's directly contained notes.
  const isIndexNote = /(^|\/)index\.md$/i.test(activePath);
  if (isIndexNote) {
    const ownFolder = folder;
    const children = [...graph.nodes.values()]
      .filter((n) => n.folder === ownFolder && n.path !== activePath && n.mode !== "attachment")
      .slice(0, MAX_PER_ZONE);
    const positions = arcPositions(children.length, {
      centerX: 0,
      centerY: 0,
      radius: 115,
      startAngle: Math.PI * 0.3,
      endAngle: Math.PI * 0.7,
    });
    children.forEach((child, i) => {
      nodes.push({
        id: child.path,
        label: child.title,
        shape: "note",
        size: 9,
        icon: undefined,
        colorToken: typeColor(child.path),
        x: positions[i].x,
        y: positions[i].y,
      });
      edges.push({ id: `child:${child.path}`, source: activePath, target: child.path, style: "structure", width: 1 });
    });
  }

  // Associations: incoming (left), outgoing (right) — deduped against nodes
  // already placed by the structure zones.
  const placed = new Set(nodes.map((n) => n.id));
  const incoming: { path: string; label?: string; style: SceneEdge["style"]; width: number }[] = [];
  const outgoing: { path: string; label?: string; style: SceneEdge["style"]; width: number }[] = [];
  for (const e of neighborhood.edges) {
    const style: SceneEdge["style"] = e.kind === "property" ? "property" : e.kind === "embed" ? "embed" : "link";
    if (e.target === activePath && e.source !== activePath) {
      incoming.push({ path: e.source, label: e.propertyKey ?? undefined, style, width: e.count });
    } else if (e.source === activePath && e.target !== activePath) {
      outgoing.push({ path: e.target, label: e.propertyKey ?? undefined, style, width: e.count });
    }
  }

  const placeZone = (
    items: { path: string; label?: string; style: SceneEdge["style"]; width: number }[],
    side: "left" | "right"
  ) => {
    const unique = items.filter((it, i) => items.findIndex((o) => o.path === it.path) === i && !placed.has(it.path));
    const shown = unique.slice(0, MAX_PER_ZONE);
    const overflow = unique.length - shown.length;
    const center = side === "left" ? Math.PI : 0;
    const positions = arcPositions(shown.length + (overflow > 0 ? 1 : 0), {
      centerX: 0,
      centerY: 0,
      radius: 125,
      startAngle: center - Math.PI * 0.38,
      endAngle: center + Math.PI * 0.38,
    });
    shown.forEach((item, i) => {
      placed.add(item.path);
      const info = graph.nodes.get(item.path);
      nodes.push({
        id: item.path,
        label: info?.title ?? item.path,
        shape: info?.mode === "attachment" ? "attachment" : "note",
        size: 9,
        colorToken: typeColor(item.path),
        x: positions[i].x,
        y: positions[i].y,
      });
      const edge: SceneEdge =
        side === "left"
          ? { id: `in:${item.path}`, source: item.path, target: activePath, style: item.style, width: item.width, label: item.label }
          : { id: `out:${item.path}`, source: activePath, target: item.path, style: item.style, width: item.width, label: item.label };
      edges.push(edge);
    });
    if (overflow > 0) {
      const p = positions[positions.length - 1];
      nodes.push({
        id: `overflow:${side}`,
        label: `+${overflow}`,
        shape: "note",
        size: 8,
        x: p.x,
        y: p.y,
        dimmed: true,
      });
    }
  };

  placeZone(incoming, "left");
  placeZone(outgoing, "right");

  return { nodes, edges };
}
