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

  it("unfolds an expanded folder into a container that encloses its notes and deeper bubbles", () => {
    const scene = buildVaultMapScene(inputOf(NODES, EDGES, { expanded: new Set(["P"]) }));
    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    expect(byId.has("P/a.md")).toBe(true);
    expect(byId.has("P/b.md")).toBe(true);
    expect(byId.get("folder:P/Sub")!.container).toBeUndefined(); // one level only -> bubble
    // The unfolded folder is a CONTAINER circle now (A4), not gone.
    const p = byId.get("folder:P")!;
    expect(p.container).toBe(true);
    expect(p.shape).toBe("folder");
    expect(p.badge).toBe(3); // transitive notes: a, b, deep
    // Every child sits fully inside the container circle, and carries parent.
    for (const childId of ["P/a.md", "P/b.md", "folder:P/Sub"]) {
      const c = byId.get(childId)!;
      expect(c.parent).toBe("folder:P");
      expect(Math.hypot(c.x - p.x, c.y - p.y) + c.size).toBeLessThanOrEqual(p.size + 0.001);
    }
    expect(byId.get("root.md")!.parent).toBeUndefined();
    const ab = scene.edges.find((e) => [e.source, e.target].sort().join() === "P/a.md,P/b.md")!;
    expect(ab.style).toBe("link"); // note-to-note keeps its kind
    // No edges ever attach to the container itself.
    expect(scene.edges.some((e) => e.source === "folder:P" || e.target === "folder:P")).toBe(false);
  });

  it("nests containers recursively when a subfolder is expanded too", () => {
    const scene = buildVaultMapScene(inputOf(NODES, EDGES, { expanded: new Set(["P", "P/Sub"]) }));
    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    const p = byId.get("folder:P")!;
    const sub = byId.get("folder:P/Sub")!;
    expect(p.container).toBe(true);
    expect(sub.container).toBe(true);
    expect(sub.parent).toBe("folder:P");
    expect(sub.badge).toBe(1); // deep.md
    // The sub-container circle sits fully inside its parent's circle …
    expect(Math.hypot(sub.x - p.x, sub.y - p.y) + sub.size).toBeLessThanOrEqual(p.size + 0.001);
    // … and the deep note sits inside the sub-container.
    const deep = byId.get("P/Sub/deep.md")!;
    expect(deep.parent).toBe("folder:P/Sub");
    expect(Math.hypot(deep.x - sub.x, deep.y - sub.y) + deep.size).toBeLessThanOrEqual(sub.size + 0.001);
  });

  it("is deterministic and honors pins; the container reflows around a pinned child", () => {
    const one = buildVaultMapScene(inputOf(NODES, EDGES, { expanded: new Set(["P"]) }));
    const two = buildVaultMapScene(inputOf(NODES, EDGES, { expanded: new Set(["P"]) }));
    expect(one.nodes).toEqual(two.nodes);

    const pinned = buildVaultMapScene(
      inputOf(NODES, EDGES, { expanded: new Set(["P"]), pins: { "P/a.md": { x: 777, y: -5 } } })
    );
    const a = pinned.nodes.find((n) => n.id === "P/a.md")!;
    expect(a).toMatchObject({ x: 777, y: -5, pinned: true });
    // The container follows its (far-dragged) child instead of losing it.
    const p = pinned.nodes.find((n) => n.id === "folder:P")!;
    expect(p.pinned).toBeFalsy(); // containers are never pinned themselves
    expect(Math.hypot(a.x - p.x, a.y - p.y) + a.size).toBeLessThanOrEqual(p.size + 0.001);
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
    // folder:P stays visible as the container around the visible a/b; the
    // Sub container hides with its only (hidden) note.
    expect(visible).toEqual(["P/a.md", "P/b.md", "folder:P", "folder:Q"]);
    // root.md links only to deep.md -> outside depth 1 from a.md.
    expect(scene.nodes.find((n) => n.id === "root.md")!.hidden).toBe(true);
    expect(scene.nodes.find((n) => n.id === "folder:P/Sub")!.hidden).toBe(true);
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

  it("hides OKF reserved notes (index.md/log.md) by default and reveals them on demand", () => {
    const withIndex = [node("root.md"), node("P/a.md"), node("P/index.md"), node("P/log.md")];
    const withIndexEdges = [edge("P/a.md", "P/index.md"), edge("P/a.md", "root.md")];

    const hidden = buildVaultMapScene(inputOf(withIndex, withIndexEdges, { expanded: new Set(["P"]) }));
    const hiddenIds = new Set(hidden.nodes.map((n) => n.id));
    expect(hiddenIds.has("P/index.md")).toBe(false);
    expect(hiddenIds.has("P/log.md")).toBe(false);
    expect(hiddenIds.has("P/a.md")).toBe(true);
    // The index.md's edge to a.md is dropped with it.
    expect(hidden.edges.some((e) => [e.source, e.target].includes("P/index.md"))).toBe(false);

    const shown = buildVaultMapScene(
      inputOf(withIndex, withIndexEdges, { expanded: new Set(["P"]), showIndexNotes: true })
    );
    const shownIds = new Set(shown.nodes.map((n) => n.id));
    expect(shownIds.has("P/index.md")).toBe(true);
    expect(shownIds.has("P/log.md")).toBe(true);
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
