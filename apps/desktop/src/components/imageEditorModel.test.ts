import { describe, expect, it } from "vitest";
import {
  arrowHeadPoints,
  clampRect,
  emptyEditorState,
  pushOp,
  rectFrom,
  redoOp,
  sizeAfterOps,
  undoOp,
  type ImageOp,
} from "./imageEditorModel";

const draw: ImageOp = { kind: "draw", tool: "pen", points: [{ x: 0, y: 0 }], color: "#f00", strokeWidth: 4 };

describe("sizeAfterOps", () => {
  it("swaps dimensions on rotate and follows crop/resize; draws never change size", () => {
    const initial = { width: 400, height: 300 };
    expect(sizeAfterOps(initial, [{ kind: "rotate90", dir: 1 }])).toEqual({ width: 300, height: 400 });
    expect(
      sizeAfterOps(initial, [
        { kind: "crop", rect: { x: 10, y: 10, width: 200, height: 100 } },
        { kind: "rotate90", dir: -1 },
        draw,
        { kind: "resize", width: 50, height: 80 },
      ])
    ).toEqual({ width: 50, height: 80 });
    expect(sizeAfterOps(initial, [draw, { kind: "flip", axis: "h" }])).toEqual(initial);
  });
});

describe("undo/redo", () => {
  it("pops into the redo stack and re-pushes in order; a new op clears redo", () => {
    const a: ImageOp = { kind: "rotate90", dir: 1 };
    const b: ImageOp = { kind: "flip", axis: "v" };
    let s = pushOp(pushOp(emptyEditorState(), a), b);
    s = undoOp(s);
    expect(s.ops).toEqual([a]);
    expect(s.redo).toEqual([b]);
    s = redoOp(s);
    expect(s.ops).toEqual([a, b]);
    expect(s.redo).toEqual([]);
    s = undoOp(undoOp(s));
    expect(s.ops).toEqual([]);
    expect(s.redo).toEqual([a, b]);
    s = pushOp(s, draw);
    expect(s.redo).toEqual([]);
  });

  it("is a no-op on empty stacks", () => {
    expect(undoOp(emptyEditorState())).toEqual(emptyEditorState());
    expect(redoOp(emptyEditorState())).toEqual(emptyEditorState());
  });
});

describe("rects", () => {
  it("rectFrom normalizes any drag direction", () => {
    expect(rectFrom({ x: 10, y: 20 }, { x: 4, y: 2 })).toEqual({ x: 4, y: 2, width: 6, height: 18 });
  });

  it("clampRect stays inside the bounds", () => {
    expect(clampRect({ x: -10, y: 5 }, { x: 50, y: 500 }, { width: 40, height: 30 })).toEqual({
      x: 0,
      y: 5,
      width: 40,
      height: 25,
    });
  });
});

describe("arrowHeadPoints", () => {
  it("places the head points symmetrically behind the tip", () => {
    const [h1, h2] = arrowHeadPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(h1.x).toBeLessThan(100);
    expect(h2.x).toBeLessThan(100);
    expect(h1.x).toBeCloseTo(h2.x, 5);
    expect(h1.y).toBeCloseTo(-h2.y, 5);
  });
});
