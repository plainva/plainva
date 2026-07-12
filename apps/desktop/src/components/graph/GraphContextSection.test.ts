// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { GraphEdgeInfo, GraphNodeInfo, VaultGraph } from "@plainva/core";
import { buildContextScene } from "@plainva/ui";

function node(path: string, extra: Partial<GraphNodeInfo> = {}): GraphNodeInfo {
  return {
    path,
    title: path.split("/").pop()!.replace(/\.md$/, ""),
    mode: "obsidian",
    okfType: null,
    folder: path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "",
    mtime: 0,
    ctime: null,
    ...extra,
  };
}

function edge(source: string, target: string, extra: Partial<GraphEdgeInfo> = {}): GraphEdgeInfo {
  return { source, target, kind: "wikilink", propertyKey: null, count: 1, lineNumber: null, ...extra };
}

function graphOf(nodes: GraphNodeInfo[], edges: GraphEdgeInfo[]): VaultGraph {
  return { nodes: new Map(nodes.map((n) => [n.path, n])), edges, broken: [] };
}

describe("buildContextScene", () => {
  it("places structure above, incoming left, outgoing right around the focus", () => {
    const g = graphOf(
      [node("P/focus.md"), node("P/index.md"), node("in.md"), node("out.md")],
      [edge("in.md", "P/focus.md"), edge("P/focus.md", "out.md")]
    );
    const scene = buildContextScene(
      {
        graph: g,
        neighborhood: { center: "P/focus.md", nodes: [...g.nodes.values()], edges: g.edges, truncated: false },
        suggestions: [],
      },
      "P/focus.md"
    );

    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    expect(byId.get("P/focus.md")).toMatchObject({ x: 0, y: 0 });
    // Folder chain resolves to the folder's index note, above the focus.
    const parent = byId.get("P/index.md")!;
    expect(parent.shape).toBe("folder");
    expect(parent.y).toBeLessThan(0);
    expect(byId.get("in.md")!.x).toBeLessThan(0);
    expect(byId.get("out.md")!.x).toBeGreaterThan(0);

    const incoming = scene.edges.find((e) => e.id === "in:in.md")!;
    expect(incoming).toMatchObject({ source: "in.md", target: "P/focus.md", style: "link" });
    const outgoing = scene.edges.find((e) => e.id === "out:out.md")!;
    expect(outgoing).toMatchObject({ source: "P/focus.md", target: "out.md" });
  });

  it("labels relation edges with the property key and folders without index as dimmed markers", () => {
    const g = graphOf(
      [node("Deep/Sub/focus.md"), node("proj.md")],
      [edge("Deep/Sub/focus.md", "proj.md", { kind: "property", propertyKey: "projekt" })]
    );
    const scene = buildContextScene(
      {
        graph: g,
        neighborhood: { center: "Deep/Sub/focus.md", nodes: [...g.nodes.values()], edges: g.edges, truncated: false },
        suggestions: [],
      },
      "Deep/Sub/focus.md"
    );
    const rel = scene.edges.find((e) => e.id === "out:proj.md")!;
    expect(rel.style).toBe("property");
    expect(rel.label).toBe("projekt");
    // No index notes exist: chain markers are unclickable overflow ids, dimmed.
    const markers = scene.nodes.filter((n) => n.id.startsWith("overflow:folder:"));
    expect(markers.length).toBe(2); // Deep + Deep/Sub
    expect(markers.every((m) => m.dimmed)).toBe(true);
  });

  it("applies stored pins to neighbors but keeps the focus centered", () => {
    const g = graphOf(
      [node("P/focus.md"), node("in.md"), node("out.md")],
      [edge("in.md", "P/focus.md"), edge("P/focus.md", "out.md")]
    );
    const scene = buildContextScene(
      {
        graph: g,
        neighborhood: { center: "P/focus.md", nodes: [...g.nodes.values()], edges: g.edges, truncated: false },
        suggestions: [],
      },
      "P/focus.md",
      // A pin on the focus note must be ignored — the center slot is fixed.
      { "in.md": { x: 240, y: -80 }, "P/focus.md": { x: 999, y: 999 } }
    );

    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    expect(byId.get("in.md")).toMatchObject({ x: 240, y: -80, pinned: true });
    expect(byId.get("P/focus.md")).toMatchObject({ x: 0, y: 0 });
    expect(byId.get("P/focus.md")!.pinned).toBeFalsy();
    expect(byId.get("out.md")!.pinned).toBeFalsy(); // unpinned neighbor keeps its zone slot
  });

  it("lists an index note's folder children below and collapses zone overflow into +N", () => {
    const children = Array.from({ length: 3 }, (_, i) => node(`P/c${i}.md`));
    const manyIncoming = Array.from({ length: 11 }, (_, i) => node(`src${i}.md`));
    const g = graphOf(
      [node("P/index.md"), ...children, ...manyIncoming],
      manyIncoming.map((n) => edge(n.path, "P/index.md"))
    );
    const scene = buildContextScene(
      {
        graph: g,
        neighborhood: {
          center: "P/index.md",
          nodes: [...g.nodes.values()],
          edges: g.edges,
          truncated: false,
        },
        suggestions: [],
      },
      "P/index.md"
    );

    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    for (const c of children) {
      expect(byId.get(c.path)!.y).toBeGreaterThan(0); // children zone below
    }
    // 11 incoming, zone cap 8 -> +3 overflow marker on the left.
    const overflow = byId.get("overflow:left")!;
    expect(overflow.label).toBe("+3");
    expect(scene.edges.filter((e) => e.id.startsWith("in:")).length).toBe(8);
  });
});
