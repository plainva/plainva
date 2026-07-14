// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGraphScene, type GraphEngineDeps, type GraphScene } from "@plainva/ui";
import type { SceneEdge, SceneNode } from "@plainva/ui";

/**
 * jsdom has no 2D canvas context — the engine's draw path no-ops on a null
 * ctx by design, so these tests cover the interaction/geometry layer: hit
 * testing, transforms, selection, keyboard focus, pointer gestures, SVG.
 */

function shimEnvironment() {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as any;
    (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
  }
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(canvas);
  return canvas;
}

function pointer(canvas: HTMLCanvasElement, type: string, opts: MouseEventInit & { pointerId?: number } = {}) {
  const ev = new MouseEvent(type, { bubbles: true, clientX: 0, clientY: 0, button: 0, ...opts });
  (ev as any).pointerId = opts.pointerId ?? 1;
  canvas.dispatchEvent(ev);
}

const NODES: SceneNode[] = [
  { id: "center.md", label: "Center", shape: "note", size: 10, x: 100, y: 100 },
  { id: "right.md", label: "Right", shape: "note", size: 10, x: 300, y: 100 },
  { id: "below.md", label: "Below", shape: "note", size: 10, x: 100, y: 300 },
  { id: "near.md", label: "NearButUnlinked", shape: "note", size: 10, x: 180, y: 108 },
];
const EDGES: SceneEdge[] = [
  { id: "e1", source: "center.md", target: "right.md", style: "link", width: 1 },
  { id: "e2", source: "center.md", target: "below.md", style: "property", width: 1, label: "projekt" },
];

describe("graphEngine", () => {
  let canvas: HTMLCanvasElement;
  let deps: GraphEngineDeps;
  let depsRef: { current: GraphEngineDeps };
  let scene: GraphScene;

  beforeEach(() => {
    shimEnvironment();
    canvas = makeCanvas();
    deps = { reducedMotion: () => true };
    depsRef = { current: deps };
    scene = createGraphScene(canvas, depsRef);
    scene.setData(NODES, EDGES);
  });

  afterEach(() => {
    scene.destroy();
    canvas.remove();
  });

  it("hit-tests nodes through the transform", () => {
    expect(scene.nodeAtClient(104, 104)).toBe("center.md");
    expect(scene.nodeAtClient(400, 400)).toBeNull();

    scene.setTransform({ x: 50, y: 0, k: 2 });
    // world (100,100) -> client (100*2+50, 100*2+0) = (250, 200)
    expect(scene.nodeAtClient(250, 200)).toBe("center.md");
    expect(scene.nodeAtClient(104, 104)).toBeNull();
  });

  it("zoomToFit contains every node in the viewport", () => {
    scene.zoomToFit(40);
    const t = scene.getTransform();
    for (const n of NODES) {
      const px = n.x * t.k + t.x;
      const py = n.y * t.k + t.y;
      expect(px).toBeGreaterThanOrEqual(0);
      expect(px).toBeLessThanOrEqual(800);
      expect(py).toBeGreaterThanOrEqual(0);
      expect(py).toBeLessThanOrEqual(600);
    }
  });

  it("defers a fit while hidden and syncs the backing store once shown (no blank-until-toggle)", () => {
    // Sidebar canvas: created display:none (rect 0×0), shown once data loads.
    let w = 0;
    let h = 0;
    const c = document.createElement("canvas");
    c.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(c);
    const s = createGraphScene(c, { current: { reducedMotion: () => true } });
    s.setData(NODES, EDGES);

    // Still hidden: the fit must defer and leave the backing store tiny.
    s.zoomToFit();
    expect(c.width).toBeLessThanOrEqual(1);

    // Now visible: the deferred fit runs on the real size and the backing store
    // matches, so drawing is no longer clipped to a 1×1 buffer.
    w = 800;
    h = 600;
    s.zoomToFit();
    expect(c.width).toBe(800);
    expect(c.height).toBe(600);

    s.destroy();
    c.remove();
  });

  it("keeps the animated radius in sync (reduced motion + patchNode grow)", () => {
    // `size` is the animated radius the hit test reads; under reduced motion
    // it must land on the target immediately, and a size patch retargets it.
    scene.setData([{ id: "n.md", label: "n", shape: "note", size: 10, x: 500, y: 500 }], []);
    expect(scene.nodeAtClient(505, 500)).toBe("n.md");
    scene.patchNode("n.md", { size: 30 });
    expect(scene.nodeAtClient(528, 500)).toBe("n.md"); // grown radius hit-testable
    expect(scene.nodeAtClient(545, 500)).toBeNull();
  });

  it("preserves the viewport transform across setData/patchNode (only zoomToFit moves the view)", () => {
    // A data or pin rebuild must never re-center the view — the base/context
    // graph views rely on this so dragging a node does not jump the viewport.
    scene.setTransform({ x: 123, y: -45, k: 1.7 });
    scene.setData(NODES, EDGES);
    expect(scene.getTransform()).toMatchObject({ x: 123, y: -45, k: 1.7 });
    scene.patchNode("center.md", { pinned: true });
    expect(scene.getTransform()).toMatchObject({ x: 123, y: -45, k: 1.7 });
  });

  it("keeps prior animated positions for surviving nodes and prunes stale selection/focus", () => {
    scene.setSelection(["right.md"]);
    scene.setKeyboardFocus("right.md");
    scene.setData(NODES.filter((n) => n.id !== "right.md"), []);
    expect(scene.getSelection()).toEqual([]);
    expect(scene.getKeyboardFocus()).toBeNull();
  });

  it("prefers graph neighbors for arrow-key navigation", () => {
    scene.setKeyboardFocus("center.md");
    // near.md is closer to the right, but right.md is the linked neighbor.
    scene.moveFocus("right");
    expect(scene.getKeyboardFocus()).toBe("right.md");
    scene.setKeyboardFocus("center.md");
    scene.moveFocus("down");
    expect(scene.getKeyboardFocus()).toBe("below.md");
  });

  it("fires activate on Enter and context on the ContextMenu key", () => {
    const onNodeActivate = vi.fn();
    const onNodeContext = vi.fn();
    depsRef.current = { ...deps, onNodeActivate, onNodeContext };
    scene.setKeyboardFocus("center.md");
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onNodeActivate).toHaveBeenCalledWith("center.md");
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu" }));
    expect(onNodeContext).toHaveBeenCalled();
    expect(onNodeContext.mock.calls[0][0]).toBe("center.md");
  });

  it("emits click with modifier flags for a stationary node press", () => {
    const onNodeClick = vi.fn();
    depsRef.current = { ...deps, onNodeClick };
    pointer(canvas, "pointerdown", { clientX: 100, clientY: 100 });
    pointer(canvas, "pointerup", { clientX: 100, clientY: 100, ctrlKey: true });
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0][0]).toBe("center.md");
    expect(onNodeClick.mock.calls[0][1].ctrl).toBe(true);
  });

  it("drag to empty space pins the node; drop onto a node connects and restores", () => {
    const onNodeDragEnd = vi.fn();
    const onNodeDropOnNode = vi.fn();
    depsRef.current = { ...deps, onNodeDragEnd, onNodeDropOnNode };

    // Move center.md by (50, 40) onto empty space.
    pointer(canvas, "pointerdown", { clientX: 100, clientY: 100 });
    pointer(canvas, "pointermove", { clientX: 150, clientY: 140 });
    pointer(canvas, "pointerup", { clientX: 150, clientY: 140 });
    expect(onNodeDropOnNode).not.toHaveBeenCalled();
    expect(onNodeDragEnd).toHaveBeenCalledWith("center.md", 150, 140);
    expect(scene.getNodePositions().get("center.md")).toEqual({ x: 150, y: 140 });

    // Drag center.md onto right.md -> connect gesture, position restored.
    pointer(canvas, "pointerdown", { clientX: 150, clientY: 140 });
    pointer(canvas, "pointermove", { clientX: 300, clientY: 100 });
    pointer(canvas, "pointerup", { clientX: 300, clientY: 100 });
    expect(onNodeDropOnNode).toHaveBeenCalledWith("center.md", "right.md");
    expect(scene.getNodePositions().get("center.md")).toEqual({ x: 150, y: 140 });
  });

  it("selects nodes inside a lasso when lassoOnEmptyDrag is enabled", () => {
    scene.destroy();
    scene = createGraphScene(canvas, depsRef, { lassoOnEmptyDrag: true });
    scene.setData(NODES, EDGES);
    const onLassoSelect = vi.fn();
    depsRef.current = { ...deps, onLassoSelect };
    // Empty-area left-drag (no modifier) draws the lasso now.
    pointer(canvas, "pointerdown", { clientX: 50, clientY: 50 });
    pointer(canvas, "pointermove", { clientX: 220, clientY: 220 });
    pointer(canvas, "pointerup", { clientX: 220, clientY: 220 });
    expect(onLassoSelect).toHaveBeenCalledTimes(1);
    const ids = onLassoSelect.mock.calls[0][0] as string[];
    expect(ids.sort()).toEqual(["center.md", "near.md"]);
  });

  it("pans with the middle button and with Ctrl+left, even over a node", () => {
    // Middle-button drag over empty space pans.
    pointer(canvas, "pointerdown", { clientX: 500, clientY: 500, button: 1 });
    pointer(canvas, "pointermove", { clientX: 520, clientY: 480, button: 1 });
    pointer(canvas, "pointerup", { clientX: 520, clientY: 480, button: 1 });
    expect(scene.getTransform()).toMatchObject({ x: 20, y: -20 });

    // Ctrl+left starting on a node pans instead of moving the node.
    scene.setTransform({ x: 0, y: 0, k: 1 });
    const before = scene.getNodePositions().get("center.md");
    pointer(canvas, "pointerdown", { clientX: 100, clientY: 100, ctrlKey: true });
    pointer(canvas, "pointermove", { clientX: 140, clientY: 100, ctrlKey: true });
    pointer(canvas, "pointerup", { clientX: 140, clientY: 100, ctrlKey: true });
    expect(scene.getTransform()).toMatchObject({ x: 40, y: 0 });
    expect(scene.getNodePositions().get("center.md")).toEqual(before);
  });

  it("keeps a Ctrl+click without drag on a node as a click, not a pan", () => {
    const onNodeClick = vi.fn();
    depsRef.current = { ...deps, onNodeClick };
    pointer(canvas, "pointerdown", { clientX: 100, clientY: 100, ctrlKey: true });
    pointer(canvas, "pointerup", { clientX: 100, clientY: 100, ctrlKey: true });
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick.mock.calls[0][0]).toBe("center.md");
    expect(onNodeClick.mock.calls[0][1].ctrl).toBe(true);
  });

  it("moves the whole selection when dragging a selected node and reports every move", () => {
    const onNodesDragEnd = vi.fn();
    const onNodeDragEnd = vi.fn();
    depsRef.current = { ...deps, onNodesDragEnd, onNodeDragEnd };
    scene.setSelection(["center.md", "right.md"]);
    // Drag center.md by (50, 20); right.md shifts by the same world delta.
    pointer(canvas, "pointerdown", { clientX: 100, clientY: 100 });
    pointer(canvas, "pointermove", { clientX: 150, clientY: 120 });
    pointer(canvas, "pointerup", { clientX: 150, clientY: 120 });
    expect(onNodeDragEnd).not.toHaveBeenCalled();
    expect(onNodesDragEnd).toHaveBeenCalledTimes(1);
    const moves = onNodesDragEnd.mock.calls[0][0] as { id: string; x: number; y: number }[];
    const byId = Object.fromEntries(moves.map((m) => [m.id, m]));
    expect(byId["center.md"]).toEqual({ id: "center.md", x: 150, y: 120 });
    expect(byId["right.md"]).toEqual({ id: "right.md", x: 350, y: 120 });
    expect(scene.getNodePositions().get("right.md")).toEqual({ x: 350, y: 120 });
  });

  it("drags a single unselected node without moving the current selection", () => {
    const onNodesDragEnd = vi.fn();
    const onNodeDragEnd = vi.fn();
    depsRef.current = { ...deps, onNodesDragEnd, onNodeDragEnd };
    scene.setSelection(["right.md", "below.md"]); // center.md is NOT selected
    const rightBefore = scene.getNodePositions().get("right.md");
    pointer(canvas, "pointerdown", { clientX: 100, clientY: 100 }); // center.md
    pointer(canvas, "pointermove", { clientX: 130, clientY: 100 });
    pointer(canvas, "pointerup", { clientX: 130, clientY: 100 });
    expect(onNodesDragEnd).not.toHaveBeenCalled();
    expect(onNodeDragEnd).toHaveBeenCalledWith("center.md", 130, 100);
    expect(scene.getNodePositions().get("right.md")).toEqual(rightBefore);
  });

  it("Alt+drag moves a node with its direct neighbors when linkedDrag is enabled", () => {
    scene.destroy();
    scene = createGraphScene(canvas, depsRef, { linkedDrag: true });
    scene.setData(NODES, EDGES);
    const onNodesDragEnd = vi.fn();
    const onNodeDragEnd = vi.fn();
    depsRef.current = { ...deps, onNodesDragEnd, onNodeDragEnd };

    // Alt+drag center.md by world (40, 20). Its linked neighbors (right/below)
    // shift by the same delta; the nearby-but-UNLINKED node stays put.
    const nearBefore = scene.getNodePositions().get("near.md");
    pointer(canvas, "pointerdown", { clientX: 100, clientY: 100, altKey: true });
    pointer(canvas, "pointermove", { clientX: 140, clientY: 120, altKey: true });
    pointer(canvas, "pointerup", { clientX: 140, clientY: 120, altKey: true });

    expect(onNodeDragEnd).not.toHaveBeenCalled();
    expect(onNodesDragEnd).toHaveBeenCalledTimes(1);
    const moves = onNodesDragEnd.mock.calls[0][0] as { id: string; x: number; y: number }[];
    expect(moves.map((m) => m.id).sort()).toEqual(["below.md", "center.md", "right.md"]);
    const byId = Object.fromEntries(moves.map((m) => [m.id, m]));
    expect(byId["center.md"]).toEqual({ id: "center.md", x: 140, y: 120 });
    expect(byId["right.md"]).toEqual({ id: "right.md", x: 340, y: 120 });
    expect(byId["below.md"]).toEqual({ id: "below.md", x: 140, y: 320 });
    expect(scene.getNodePositions().get("near.md")).toEqual(nearBefore);
  });

  it("Alt+drag stays a single-node drag when linkedDrag is not enabled", () => {
    // Default scene (no linkedDrag): Alt is ignored, only the node moves.
    const onNodesDragEnd = vi.fn();
    const onNodeDragEnd = vi.fn();
    depsRef.current = { ...deps, onNodesDragEnd, onNodeDragEnd };
    const rightBefore = scene.getNodePositions().get("right.md");
    pointer(canvas, "pointerdown", { clientX: 100, clientY: 100, altKey: true });
    pointer(canvas, "pointermove", { clientX: 130, clientY: 100, altKey: true });
    pointer(canvas, "pointerup", { clientX: 130, clientY: 100, altKey: true });
    expect(onNodesDragEnd).not.toHaveBeenCalled();
    expect(onNodeDragEnd).toHaveBeenCalledWith("center.md", 130, 100);
    expect(scene.getNodePositions().get("right.md")).toEqual(rightBefore);
  });

  it("pans on background drag and zooms around the wheel position", () => {
    pointer(canvas, "pointerdown", { clientX: 500, clientY: 500 });
    pointer(canvas, "pointermove", { clientX: 520, clientY: 470 });
    pointer(canvas, "pointerup", { clientX: 520, clientY: 470 });
    expect(scene.getTransform()).toMatchObject({ x: 20, y: -30, k: 1 });

    const onZoomChange = vi.fn();
    depsRef.current = { ...deps, onZoomChange };
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, clientX: 400, clientY: 300, cancelable: true }));
    const t = scene.getTransform();
    expect(t.k).toBeGreaterThan(1);
    expect(onZoomChange).toHaveBeenCalledWith(t.k);
    // The world point under the cursor stays under the cursor.
    const world = scene.clientToWorld(400, 300);
    expect(world.x * t.k + t.x).toBeCloseTo(400, 5);
    expect(world.y * t.k + t.y).toBeCloseTo(300, 5);
  });

  it("routes contextmenu to node, edge or canvas", () => {
    const onNodeContext = vi.fn();
    const onEdgeContext = vi.fn();
    const onCanvasContext = vi.fn();
    depsRef.current = { ...deps, onNodeContext, onEdgeContext, onCanvasContext };

    canvas.dispatchEvent(new MouseEvent("contextmenu", { clientX: 100, clientY: 100, cancelable: true }));
    expect(onNodeContext).toHaveBeenCalledWith("center.md", 100, 100);

    // Midpoint of center->right edge, away from both nodes.
    canvas.dispatchEvent(new MouseEvent("contextmenu", { clientX: 200, clientY: 100, cancelable: true }));
    expect(onEdgeContext).toHaveBeenCalledWith("e1", 200, 100);

    canvas.dispatchEvent(new MouseEvent("contextmenu", { clientX: 700, clientY: 500, cancelable: true }));
    expect(onCanvasContext).toHaveBeenCalled();
  });

  it("serializes the scene to SVG without hidden nodes and with escaped labels", () => {
    scene.setData(
      [
        { id: "a.md", label: "A & <B>", shape: "note", size: 10, x: 0, y: 0 },
        { id: "ghost.md", label: "Ghost", shape: "note", size: 10, x: 50, y: 0, hidden: true },
      ],
      []
    );
    const svg = scene.toSVG();
    expect(svg).toContain("<circle");
    expect(svg).toContain("A &amp; &lt;B&gt;");
    expect(svg).not.toContain("Ghost");
  });

  it("stops emitting after destroy", () => {
    const onNodeClick = vi.fn();
    depsRef.current = { ...deps, onNodeClick };
    scene.destroy();
    pointer(canvas, "pointerdown", { clientX: 100, clientY: 100 });
    pointer(canvas, "pointerup", { clientX: 100, clientY: 100 });
    expect(onNodeClick).not.toHaveBeenCalled();
  });
});

/** Container circles (vault map A4): rim-only hit testing, innermost wins,
 *  dragging a container moves its content. Views without containers are
 *  covered by the suite above — their path is unchanged. */
describe("graphEngine containers", () => {
  const CONTAINER_NODES: SceneNode[] = [
    { id: "folder:P", label: "P", shape: "folder", container: true, size: 100, x: 100, y: 100 },
    { id: "P/a.md", label: "a", shape: "note", size: 10, x: 100, y: 100, parent: "folder:P" },
    { id: "P/b.md", label: "b", shape: "note", size: 10, x: 150, y: 100, parent: "folder:P" },
    { id: "out.md", label: "out", shape: "note", size: 10, x: 400, y: 400 },
  ];

  let canvas: HTMLCanvasElement;
  let deps: GraphEngineDeps;
  let depsRef: { current: GraphEngineDeps };
  let scene: GraphScene;

  beforeEach(() => {
    shimEnvironment();
    canvas = makeCanvas();
    deps = { reducedMotion: () => true };
    depsRef = { current: deps };
    scene = createGraphScene(canvas, depsRef, { lassoOnEmptyDrag: true, linkedDrag: true });
    scene.setData(CONTAINER_NODES, []);
  });

  afterEach(() => {
    scene.destroy();
    canvas.remove();
  });

  it("hits the child inside a container, never the container's interior", () => {
    expect(scene.nodeAtClient(100, 100)).toBe("P/a.md");
    expect(scene.nodeAtClient(150, 100)).toBe("P/b.md");
    // Empty interior spot: no child in reach, rim far away -> nothing.
    expect(scene.nodeAtClient(100, 40)).toBeNull();
  });

  it("hits the container on its rim only", () => {
    expect(scene.nodeAtClient(100, 200)).toBe("folder:P"); // bottom rim
    expect(scene.nodeAtClient(200, 100)).toBe("folder:P"); // right rim
    expect(scene.nodeAtClient(100, 215)).toBeNull(); // just outside the tolerance
  });

  it("prefers the innermost rim when containers nest", () => {
    scene.setData(
      [
        { id: "folder:P", label: "P", shape: "folder", container: true, size: 100, x: 100, y: 100 },
        { id: "folder:P/Sub", label: "Sub", shape: "folder", container: true, size: 50, x: 100, y: 100, parent: "folder:P" },
        { id: "P/Sub/deep.md", label: "deep", shape: "note", size: 8, x: 100, y: 100, parent: "folder:P/Sub" },
      ],
      []
    );
    expect(scene.nodeAtClient(100, 150)).toBe("folder:P/Sub"); // inner rim
    expect(scene.nodeAtClient(100, 200)).toBe("folder:P"); // outer rim
    expect(scene.nodeAtClient(100, 100)).toBe("P/Sub/deep.md"); // child beats both interiors
  });

  it("dragging a container at its rim moves the container with its whole content", () => {
    const onNodesDragEnd = vi.fn();
    const onNodeDragEnd = vi.fn();
    depsRef.current = { ...deps, onNodesDragEnd, onNodeDragEnd };
    pointer(canvas, "pointerdown", { clientX: 100, clientY: 200 }); // bottom rim
    pointer(canvas, "pointermove", { clientX: 130, clientY: 200 });
    pointer(canvas, "pointerup", { clientX: 130, clientY: 200 });
    expect(onNodeDragEnd).not.toHaveBeenCalled();
    expect(onNodesDragEnd).toHaveBeenCalledTimes(1);
    const moves = onNodesDragEnd.mock.calls[0][0] as { id: string; x: number; y: number }[];
    expect(moves.map((m) => m.id).sort()).toEqual(["P/a.md", "P/b.md", "folder:P"]);
    const byId = Object.fromEntries(moves.map((m) => [m.id, m]));
    expect(byId["folder:P"]).toMatchObject({ x: 130, y: 100 });
    expect(byId["P/a.md"]).toMatchObject({ x: 130, y: 100 });
    expect(byId["P/b.md"]).toMatchObject({ x: 180, y: 100 });
    expect(scene.getNodePositions().get("out.md")).toEqual({ x: 400, y: 400 });
  });

  it("double-clicking the rim fires onNodeDoubleClick for the container", () => {
    const onNodeDoubleClick = vi.fn();
    depsRef.current = { ...deps, onNodeDoubleClick };
    pointer(canvas, "pointerdown", { clientX: 100, clientY: 200 });
    pointer(canvas, "pointerup", { clientX: 100, clientY: 200 });
    pointer(canvas, "pointerdown", { clientX: 100, clientY: 200 });
    pointer(canvas, "pointerup", { clientX: 100, clientY: 200 });
    expect(onNodeDoubleClick).toHaveBeenCalledWith("folder:P");
  });

  it("dropping a dragged note on a container rim stays a plain move, not a connect", () => {
    const onNodeDragEnd = vi.fn();
    const onNodeDropOnNode = vi.fn();
    depsRef.current = { ...deps, onNodeDragEnd, onNodeDropOnNode };
    pointer(canvas, "pointerdown", { clientX: 400, clientY: 400 }); // out.md
    pointer(canvas, "pointermove", { clientX: 100, clientY: 200 }); // onto the rim
    pointer(canvas, "pointerup", { clientX: 100, clientY: 200 });
    expect(onNodeDropOnNode).not.toHaveBeenCalled();
    expect(onNodeDragEnd).toHaveBeenCalledWith("out.md", 100, 200);
    expect(scene.getNodePositions().get("out.md")).toEqual({ x: 100, y: 200 });
  });

  it("revealNode centers the target and only zooms OUT when the circle would not fit", () => {
    // Small node, current zoom 1: keep the zoom, just center (800x600 canvas).
    scene.setData(
      [
        { id: "folder:P", label: "P", shape: "folder", container: true, size: 100, x: 1000, y: 500 },
        { id: "big", label: "big", shape: "folder", container: true, size: 400, x: -2000, y: 0 },
      ],
      []
    );
    scene.setTransform({ x: 0, y: 0, k: 1 });
    scene.revealNode("folder:P");
    expect(scene.getTransform()).toMatchObject({ k: 1, x: 400 - 1000, y: 300 - 500 });

    // Huge container: zoom out just enough (min((800-120)/800, (600-120)/800) = 0.6).
    scene.revealNode("big");
    const t = scene.getTransform();
    expect(t.k).toBeCloseTo(0.6, 5);
    expect(t.x).toBeCloseTo(400 - -2000 * 0.6, 5);
    expect(t.y).toBeCloseTo(300 - 0 * 0.6, 5);

    // Unknown or hidden ids are a no-op.
    scene.revealNode("ghost");
    expect(scene.getTransform().k).toBeCloseTo(0.6, 5);
  });

  it("keeps arrow-key navigation on regular nodes and exports container rims as unfilled SVG circles", () => {
    scene.setKeyboardFocus("P/a.md");
    scene.moveFocus("right");
    expect(scene.getKeyboardFocus()).toBe("P/b.md"); // never lands on folder:P
    const svg = scene.toSVG();
    expect(svg).toContain('fill="none"');
    expect(svg).toContain(">P<"); // container label serialized
  });
});
