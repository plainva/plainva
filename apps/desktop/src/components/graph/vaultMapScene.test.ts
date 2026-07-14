import { describe, expect, it } from "vitest";
import type { FolderOverview, GraphEdgeInfo, GraphNodeInfo, VaultGraph } from "@plainva/core";
import {
  buildVaultMapScene,
  DEFAULT_EDGE_KINDS,
  effectiveDate,
  representativeOf,
  type VaultMapInput,
} from "@plainva/ui";

function node(path: string, extra: Partial<GraphNodeInfo> = {}): GraphNodeInfo {
  return {
    path,
    title: path.split("/").pop()!.replace(/\.md$/, ""),
    mode: "obsidian",
    okfType: null,
    folder: path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "",
    mtime: 1000,
    ctime: 500,
    ...extra,
  };
}

function edge(source: string, target: string, extra: Partial<GraphEdgeInfo> = {}): GraphEdgeInfo {
  return { source, target, kind: "wikilink", propertyKey: null, count: 1, lineNumber: null, ...extra };
}

function overviewOf(graph: VaultGraph): FolderOverview {
  const folders = new Map<string, { folder: string; noteCount: number; hasIndexNote: boolean }>();
  const rootNotes: string[] = [];
  for (const n of graph.nodes.values()) {
    if (n.folder === "") {
      rootNotes.push(n.path);
      continue;
    }
    let acc = "";
    for (const part of n.folder.split("/")) {
      acc = acc ? `${acc}/${part}` : part;
      if (!folders.has(acc)) folders.set(acc, { folder: acc, noteCount: 0, hasIndexNote: false });
    }
    folders.get(n.folder)!.noteCount++;
  }
  return { folders: [...folders.values()], rootNotes, folderEdges: [] };
}

function inputOf(nodes: GraphNodeInfo[], edges: GraphEdgeInfo[], partial: Partial<VaultMapInput> = {}): VaultMapInput {
  const graph: VaultGraph = { nodes: new Map(nodes.map((n) => [n.path, n])), edges, broken: [] };
  return {
    graph,
    overview: overviewOf(graph),
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

const NODES = [node("root.md"), node("P/a.md"), node("P/b.md"), node("P/Sub/deep.md"), node("Q/x.md")];
const EDGES = [edge("P/a.md", "P/b.md"), edge("P/a.md", "Q/x.md"), edge("root.md", "P/Sub/deep.md")];

describe("representativeOf", () => {
  it("maps a note to its topmost unexpanded ancestor", () => {
    expect(representativeOf("P/Sub/deep.md", "P/Sub", new Set())).toBe("folder:P");
    expect(representativeOf("P/Sub/deep.md", "P/Sub", new Set(["P"]))).toBe("folder:P/Sub");
    expect(representativeOf("P/Sub/deep.md", "P/Sub", new Set(["P", "P/Sub"]))).toBe("P/Sub/deep.md");
    expect(representativeOf("root.md", "", new Set())).toBe("root.md");
  });
});

describe("buildVaultMapScene", () => {
  it("collapses folders to bubbles with counts and bundles cross-bubble edges as structure", () => {
    const scene = buildVaultMapScene(inputOf(NODES, EDGES));
    const ids = scene.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["folder:P", "folder:Q", "root.md"]);
    const p = scene.nodes.find((n) => n.id === "folder:P")!;
    expect(p.shape).toBe("folder");
    expect(p.badge).toBe(3); // a, b, deep
    // a->x becomes P<->Q, root->deep becomes root<->P; a->b is internal (dropped).
    expect(scene.edges.length).toBe(2);
    expect(scene.edges.every((e) => e.style === "structure")).toBe(true);
    const pq = scene.edges.find((e) => [e.source, e.target].sort().join() === "folder:P,folder:Q")!;
    expect(scene.bundles.get(pq.id)![0]).toMatchObject({ source: "P/a.md", target: "Q/x.md" });
    expect(scene.stats).toEqual({ notes: 5, links: 3 });
  });

  it("unfolds an expanded folder into its notes and keeps deeper levels bundled", () => {
    const scene = buildVaultMapScene(inputOf(NODES, EDGES, { expanded: new Set(["P"]) }));
    const ids = new Set(scene.nodes.map((n) => n.id));
    expect(ids.has("P/a.md")).toBe(true);
    expect(ids.has("P/b.md")).toBe(true);
    expect(ids.has("folder:P/Sub")).toBe(true); // one level only
    expect(ids.has("folder:P")).toBe(false);
    const ab = scene.edges.find((e) => [e.source, e.target].sort().join() === "P/a.md,P/b.md")!;
    expect(ab.style).toBe("link"); // note-to-note keeps its kind
  });

  it("is deterministic and honors pins", () => {
    const one = buildVaultMapScene(inputOf(NODES, EDGES, { expanded: new Set(["P"]) }));
    const two = buildVaultMapScene(inputOf(NODES, EDGES, { expanded: new Set(["P"]) }));
    expect(one.nodes).toEqual(two.nodes);

    const pinned = buildVaultMapScene(
      inputOf(NODES, EDGES, { expanded: new Set(["P"]), pins: { "P/a.md": { x: 777, y: -5 } } })
    );
    const a = pinned.nodes.find((n) => n.id === "P/a.md")!;
    expect(a).toMatchObject({ x: 777, y: -5, pinned: true });
  });

  it("dims filter misses and folders without matching members", () => {
    const scene = buildVaultMapScene(
      inputOf(NODES, EDGES, { filters: { query: "deep", okfType: null, tagPaths: null, edgeKinds: new Set(DEFAULT_EDGE_KINDS) } })
    );
    const p = scene.nodes.find((n) => n.id === "folder:P")!;
    const q = scene.nodes.find((n) => n.id === "folder:Q")!;
    const root = scene.nodes.find((n) => n.id === "root.md")!;
    expect(p.dimmed).toBe(false); // contains deep.md
    expect(q.dimmed).toBe(true);
    expect(root.dimmed).toBe(true);
  });

  it("filters edge kinds and labels dominant property bundles", () => {
    const rel = [edge("P/a.md", "P/b.md", { kind: "property", propertyKey: "projekt", count: 2 })];
    const scene = buildVaultMapScene(inputOf(NODES, [...EDGES, ...rel], { expanded: new Set(["P"]) }));
    const ab = scene.edges.find((e) => [e.source, e.target].sort().join() === "P/a.md,P/b.md")!;
    expect(ab.style).toBe("property"); // 2 property counts beat 1 wikilink
    expect(ab.label).toBe("projekt");
    expect(ab.width).toBe(3);

    const noRel = buildVaultMapScene(
      inputOf(NODES, [...EDGES, ...rel], {
        expanded: new Set(["P"]),
        filters: { query: "", okfType: null, tagPaths: null, edgeKinds: new Set(["wikilink", "embed", "markdown-link"]) },
      })
    );
    const ab2 = noRel.edges.find((e) => [e.source, e.target].sort().join() === "P/a.md,P/b.md")!;
    expect(ab2.style).toBe("link");
    expect(ab2.width).toBe(1);
  });

  it("focus mode hides everything beyond seed + depth hops", () => {
    const scene = buildVaultMapScene(
      inputOf(NODES, EDGES, { expanded: new Set(["P", "P/Sub"]), focus: { seed: "P/a.md", depth: 1 } })
    );
    const visible = scene.nodes.filter((n) => !n.hidden).map((n) => n.id).sort();
    expect(visible).toEqual(["P/a.md", "P/b.md", "folder:Q"]);
    // root.md links only to deep.md -> outside depth 1 from a.md.
    expect(scene.nodes.find((n) => n.id === "root.md")!.hidden).toBe(true);
  });

  it("focus on a folder that then gets expanded shows the folder's contents, not an empty graph", () => {
    // Regression (2026-07-14): seed = folder:P, then P expanded. folder:P no longer
    // has a node of its own, so the old code hid EVERYTHING. Now the focus follows
    // into the folder and seeds from its now-visible members.
    const scene = buildVaultMapScene(
      inputOf(NODES, EDGES, { expanded: new Set(["P"]), focus: { seed: "folder:P", depth: 1 } })
    );
    const visible = scene.nodes.filter((n) => !n.hidden).map((n) => n.id);
    expect(visible.length).toBeGreaterThan(0); // not empty
    expect(visible).toContain("P/a.md");
    expect(visible).toContain("P/b.md");
  });

  it("heatmap sets recency heat; replay hides notes newer than the cutoff", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = 1000 * DAY;
    const nodes = [
      node("fresh.md", { mtime: now - DAY, ctime: now - DAY }),
      node("old.md", { mtime: now - 200 * DAY, ctime: now - 200 * DAY }),
    ];
    const heat = buildVaultMapScene(inputOf(nodes, [], { overlay: { mode: "heatmap", now } }));
    expect(heat.nodes.find((n) => n.id === "fresh.md")!.heat).toBe(1);
    expect(heat.nodes.find((n) => n.id === "old.md")!.heat).toBe(0);

    const dates = new Map<string, number>([["fresh.md", now - DAY]]);
    const replay = buildVaultMapScene(
      inputOf(nodes, [edge("fresh.md", "old.md")], { overlay: { mode: "replay", cutoff: now - 100 * DAY, dates } })
    );
    expect(replay.nodes.find((n) => n.id === "fresh.md")!.hidden).toBe(true);
    expect(replay.nodes.find((n) => n.id === "old.md")!.hidden).toBe(false);
    expect(replay.edges[0].hidden).toBe(true); // edge follows its hidden endpoint
  });

  it("effectiveDate prefers frontmatter over ctime over mtime", () => {
    const graph: VaultGraph = {
      nodes: new Map([
        ["a.md", node("a.md", { ctime: 50, mtime: 99 })],
        ["b.md", node("b.md", { ctime: null, mtime: 77 })],
      ]),
      edges: [],
      broken: [],
    };
    const dates = new Map([["a.md", 10]]);
    expect(effectiveDate("a.md", graph, dates)).toBe(10);
    expect(effectiveDate("b.md", graph, dates)).toBe(77);
    dates.delete("a.md");
    expect(effectiveDate("a.md", graph, dates)).toBe(50);
  });
});
