import type { VaultMapFocus } from "./vaultMapScene";

/**
 * The AI's trail in the graph (plan KI-Harness P2b-5, "View context"): the
 * notes a context was built from, shown in the vault map and ringed — the open
 * note as the seed, the sources beside it, the links among them. A surface
 * asks for it, the shell opens the graph, the graph takes it; one at a time,
 * like a search jump, because the graph may not be mounted when it is asked.
 */
export interface GraphTrail {
  /** Where the trail starts (the open note), or null to start at the first source. */
  seed: string | null;
  paths: string[];
}

export const GRAPH_TRAIL_EVENT = "plainva-graph-trail";

let pending: GraphTrail | null = null;

export function requestGraphTrail(trail: GraphTrail): void {
  pending = trail;
  window.dispatchEvent(new CustomEvent(GRAPH_TRAIL_EVENT));
}

/** Hands the parked trail to the graph that takes it; clears it. */
export function consumeGraphTrail(): GraphTrail | null {
  const trail = pending;
  pending = null;
  return trail;
}

/** Every folder a trail note lies in: unfolded, the map shows the note itself instead of its folder. */
export function trailFolders(paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"));
  }
  return [...out];
}

/** The focus that shows a trail: the seed, the sources, nothing around them. */
export function trailFocus(trail: GraphTrail): VaultMapFocus {
  return { seed: trail.seed ?? trail.paths[0] ?? "", depth: 0, trail: trail.paths };
}
