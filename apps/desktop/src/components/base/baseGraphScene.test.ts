// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { GraphEdgeInfo, GraphNodeInfo, VaultGraph } from "@plainva/core";
import { buildBaseGraphScene, type BaseGraphSceneInput } from "./baseGraphScene";

function node(path: string): GraphNodeInfo {
  return { path, title: path.replace(/\.md$/, ""), mode: "obsidian", okfType: null, folder: "", mtime: 0, ctime: null };
}

function edge(source: string, target: string, extra: Partial<GraphEdgeInfo> = {}): GraphEdgeInfo {
  return { source, target, kind: "wikilink", propertyKey: null, count: 1, lineNumber: null, ...extra };
}

function inputOf(partial: Partial<BaseGraphSceneInput>): BaseGraphSceneInput {
  const graph: VaultGraph = {
    nodes: new Map(["a.md", "b.md", "ext.md"].map((p) => [p, node(p)])),
    edges: [
      edge("a.md", "b.md", { kind: "property", propertyKey: "projekt" }),
      edge("a.md", "b.md"),
      edge("a.md", "ext.md", { kind: "property", propertyKey: "projekt" }),
      // An external note whose relation points INTO row a (e.g. a task -> project).
      edge("ext.md", "a.md", { kind: "property", propertyKey: "quelle" }),
    ],
    broken: [],
  };
  return {
    rows: [
      { "file.path": "a.md", "file.name": "a", status: "Offen", prio: 1 },
      { "file.path": "b.md", "file.name": "b", status: "Erledigt", prio: 9 },
    ],
    graph,
    edgeKeys: ["projekt"],
    showWikiLinks: false,
    showExternal: false,
    showIncoming: false,
    colorBy: null,
    sizeBy: null,
    pins: {},
    seed: "test",
    ...partial,
  };
}

describe("buildBaseGraphScene", () => {
  it("renders rows as nodes and selected relation properties as labeled edges", () => {
    const scene = buildBaseGraphScene(inputOf({}));
    expect(scene.nodes.map((n) => n.id).sort()).toEqual(["a.md", "b.md"]); // ext.md hidden
    expect(scene.edges).toEqual([
      expect.objectContaining({ source: "a.md", target: "b.md", style: "property", label: "projekt" }),
    ]);
  });

  it("optionally shows wiki links and external relation targets (dimmed)", () => {
    const scene = buildBaseGraphScene(inputOf({ showWikiLinks: true, showExternal: true }));
    expect(scene.edges.length).toBe(3); // relation a-b, wiki a-b, relation a-ext
    const ext = scene.nodes.find((n) => n.id === "ext.md")!;
    expect(ext.dimmed).toBe(true);
  });

  it("maps select values onto chip colors and numbers onto sizes", () => {
    const scene = buildBaseGraphScene(inputOf({ colorBy: "status", sizeBy: "prio" }));
    const a = scene.nodes.find((n) => n.id === "a.md")!;
    const b = scene.nodes.find((n) => n.id === "b.md")!;
    expect(a.colorToken).not.toBeNull();
    expect(b.colorToken).not.toBeNull();
    expect(a.colorToken).not.toBe(b.colorToken); // distinct values, distinct chips
    expect(b.size).toBeGreaterThan(a.size); // prio 9 > prio 1
  });

  it("optionally shows incoming cross-DB relations (dimmed source node)", () => {
    const scene = buildBaseGraphScene(inputOf({ showIncoming: true }));
    // ext.md -> a.md via `quelle` (a foreign key, never in edgeKeys) now shows.
    expect(scene.edges).toContainEqual(
      expect.objectContaining({ source: "ext.md", target: "a.md", style: "property", label: "quelle" })
    );
    expect(scene.nodes.find((n) => n.id === "ext.md")?.dimmed).toBe(true);
    // Still off by default — the toggle governs it, not the edgeKeys.
    const off = buildBaseGraphScene(inputOf({ showIncoming: false }));
    expect(off.edges.some((e) => e.source === "ext.md")).toBe(false);
  });

  it("labels relation edges through labelForKey when provided", () => {
    const scene = buildBaseGraphScene(inputOf({ labelForKey: (k) => `«${k}»` }));
    expect(scene.edges.find((e) => e.style === "property")?.label).toBe("«projekt»");
  });

  it("is deterministic and honors pins", () => {
    const one = buildBaseGraphScene(inputOf({}));
    const two = buildBaseGraphScene(inputOf({}));
    expect(one.nodes).toEqual(two.nodes);
    const pinned = buildBaseGraphScene(inputOf({ pins: { "a.md": { x: 42, y: 24 } } }));
    expect(pinned.nodes.find((n) => n.id === "a.md")).toMatchObject({ x: 42, y: 24, pinned: true });
  });
});
