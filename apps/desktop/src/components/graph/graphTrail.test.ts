// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { GraphEdgeInfo, GraphNodeInfo, VaultGraph } from "@plainva/core";
import { buildVaultMapScene, consumeGraphTrail, DEFAULT_EDGE_KINDS, GRAPH_TRAIL_EVENT, requestGraphTrail, trailFocus, trailFolders, type VaultMapInput } from "@plainva/ui";

function node(path: string): GraphNodeInfo {
  return { path, title: path.split("/").pop()!.replace(/\.md$/, ""), mode: "obsidian", okfType: null, folder: path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "", mtime: 1000, ctime: 500 };
}

function edge(source: string, target: string): GraphEdgeInfo {
  return { source, target, kind: "wikilink", propertyKey: null, count: 1, lineNumber: null };
}

function inputOf(nodes: GraphNodeInfo[], edges: GraphEdgeInfo[], partial: Partial<VaultMapInput>): VaultMapInput {
  const graph: VaultGraph = { nodes: new Map(nodes.map((n) => [n.path, n])), edges, broken: [] };
  return {
    graph,
    expanded: new Set(),
    pins: {},
    icons: new Map(),
    filters: { query: "", okfType: null, tagPaths: null, edgeKinds: new Set(DEFAULT_EDGE_KINDS) },
    focus: null,
    overlay: { mode: "normal" },
    seed: "test",
    ...partial,
  };
}

const NOTES = [node("Offer.md"), node("Projects/Film/Kickoff.md"), node("Projects/Film/Schedule.md"), node("Garden.md"), node("Recipes/Bread.md")];
const EDGES = [edge("Offer.md", "Projects/Film/Kickoff.md"), edge("Garden.md", "Recipes/Bread.md")];

/** Plan KI-Harness P2b-5: the AI's trail in the vault map. */
describe("the trail in the graph", () => {
  it("unfolds every folder a trail note lies in", () => {
    expect(trailFolders(["Projects/Film/Kickoff.md", "Offer.md"]).sort()).toEqual(["Projects", "Projects/Film"]);
  });

  it("shows the seed and the trail, rings the trail and hides what has nothing to do with it", () => {
    const trail = { seed: "Offer.md", paths: ["Projects/Film/Kickoff.md", "Projects/Film/Schedule.md"] };
    const scene = buildVaultMapScene(inputOf(NOTES, EDGES, { expanded: new Set(trailFolders(trail.paths)), focus: trailFocus(trail) }));
    const visible = scene.nodes.filter((n) => !n.hidden && !n.container).map((n) => n.id).sort();
    expect(visible).toEqual(["Offer.md", "Projects/Film/Kickoff.md", "Projects/Film/Schedule.md"]);
    expect(scene.nodes.filter((n) => n.flag === "trail").map((n) => n.id).sort()).toEqual(["Projects/Film/Kickoff.md", "Projects/Film/Schedule.md"]);
    // The link between the open note and a source stays drawn.
    expect(scene.edges.some((e) => !e.hidden && [e.source, e.target].sort().join() === ["Offer.md", "Projects/Film/Kickoff.md"].sort().join())).toBe(true);
  });

  it("rings a folded folder that holds a trail note", () => {
    const scene = buildVaultMapScene(inputOf(NOTES, EDGES, { focus: trailFocus({ seed: null, paths: ["Projects/Film/Kickoff.md"] }) }));
    const ringed = scene.nodes.filter((n) => n.flag === "trail" && !n.hidden);
    expect(ringed.length).toBe(1);
    expect(ringed[0]!.id.startsWith("folder:Projects")).toBe(true);
  });

  it("is taken once, by whichever graph asks first", () => {
    const heard = vi.fn();
    window.addEventListener(GRAPH_TRAIL_EVENT, heard);
    requestGraphTrail({ seed: null, paths: ["Offer.md"] });
    window.removeEventListener(GRAPH_TRAIL_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(consumeGraphTrail()).toEqual({ seed: null, paths: ["Offer.md"] });
    expect(consumeGraphTrail()).toBeNull();
  });
});
