import { describe, expect, it } from "vitest";
import { applyReadAnchors, readAnchorRegions, type HastNode } from "@plainva/ui";

/**
 * Comment anchors in the rendered read view (C28). The tree here is the shape
 * remark-rehype produces — elements and text with source offsets — so the
 * rule is pinned without a renderer: which characters get a mark, which
 * cells and pictures get a frame, and what a picture's regions carry.
 */
const text = (value: string, from: number): HastNode => ({ type: "text", value, position: { start: { offset: from }, end: { offset: from + value.length } } });
const el = (tagName: string, children: HastNode[], from: number, to: number, properties: Record<string, unknown> = {}): HastNode => ({
  type: "element", tagName, properties, children, position: { start: { offset: from }, end: { offset: to } },
});
const root = (...children: HastNode[]): HastNode => ({ type: "root", children });
const flat = (node: HastNode): string =>
  node.type === "text"
    ? node.value ?? ""
    : node.tagName === "mark"
      ? `[${(node.properties?.className as string[]).includes("pv-read-anchor--active") ? "!" : ""}${(node.children ?? []).map(flat).join("")}]`
      : (node.children ?? []).map(flat).join("");

describe("applyReadAnchors", () => {
  it("marks exactly the covered characters of a paragraph, active stronger", () => {
    // Source: "Die Projektleitung entscheidet." starting at offset 10.
    const p = el("p", [text("Die Projektleitung entscheidet.", 10)], 10, 41);
    const tree = root(p);
    const n = applyReadAnchors(tree, [
      { commentId: "c1", from: 14, to: 28 },
      { commentId: "c2", from: 29, to: 40, active: true },
    ]);
    expect(n).toEqual({ marks: 2, frames: 0 });
    expect(flat(tree)).toBe("Die [Projektleitung] [!entscheidet].");
    const marks = (p.children ?? []).filter((c) => c.tagName === "mark");
    expect(marks[0].properties?.dataCommentId).toBe("c1");
    expect(marks[1].properties?.dataCommentId).toBe("c2");
  });

  it("leaves text alone whose length disagrees with its offsets (entities)", () => {
    const p = el("p", [{ type: "text", value: "a & b", position: { start: { offset: 0 }, end: { offset: 9 } } }], 0, 9);
    const tree = root(p);
    expect(applyReadAnchors(tree, [{ commentId: "c", from: 0, to: 3 }])).toEqual({ marks: 0, frames: 0 });
    expect(flat(tree)).toBe("a & b");
  });

  it("frames every commented cell of a table, not only one", () => {
    const cellA = el("td", [text("alpha", 20)], 20, 25);
    const cellB = el("td", [text("beta", 28)], 28, 32);
    const cellC = el("td", [text("gamma", 35)], 35, 40);
    const tree = root(el("table", [el("tr", [cellA, cellB, cellC], 19, 41)], 19, 41));
    const frame = { kind: "tableCell" as const };
    const n = applyReadAnchors(tree, [
      { commentId: "a", from: 20, to: 25, frame: { ...frame, row: 1, column: 0 } },
      { commentId: "c", from: 35, to: 40, frame: { ...frame, row: 1, column: 2 }, active: true },
    ]);
    expect(n.frames).toBe(2);
    expect(cellA.properties?.className).toEqual(["pv-read-anchor-frame"]);
    expect(cellB.properties?.className).toBeUndefined();
    expect(cellC.properties?.className).toEqual(["pv-read-anchor-frame", "pv-read-anchor-frame--active"]);
    // A framed cell's text is not additionally tinted: the frame is the mark.
    expect(flat(tree)).toBe("alphabetagamma");
  });

  it("frames a picture and hands its marked regions to the renderer", () => {
    const img = el("img", [], 50, 70, { src: "x.png" });
    const tree = root(el("p", [img], 50, 70));
    applyReadAnchors(tree, [
      { commentId: "whole", from: 50, to: 70, frame: { kind: "image" } },
      { commentId: "part", from: 50, to: 70, frame: { kind: "image", rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }, active: true },
    ]);
    expect(img.properties?.className).toEqual(["pv-read-anchor-frame", "pv-read-anchor-frame--active"]);
    expect(img.properties?.dataCommentId).toBe("part");
    expect(readAnchorRegions(img.properties?.dataAnchorRegions)).toEqual([{ commentId: "part", active: true, x: 0.1, y: 0.2, w: 0.3, h: 0.4 }]);
    expect(readAnchorRegions(undefined)).toEqual([]);
    expect(readAnchorRegions("not json")).toEqual([]);
  });

  it("does nothing without highlights", () => {
    const p = el("p", [text("plain", 0)], 0, 5);
    const tree = root(p);
    expect(applyReadAnchors(tree, [])).toEqual({ marks: 0, frames: 0 });
    expect(p.children).toHaveLength(1);
  });
});

describe("insertion points in the read view (V3)", () => {
  it("draws the proposal at its place even though it covers no character", () => {
    const p = el("p", [text("Die Projektleitung entscheidet.", 10)], 10, 41);
    const tree = root(p);
    const n = applyReadAnchors(tree, [{ commentId: "i1", from: 28, to: 28, suggestion: { replacement: " heute" } }]);
    expect(n.marks).toBe(0);
    const ins = (p.children ?? []).find((c) => c.tagName === "ins");
    expect(ins?.children?.[0]?.value).toBe(" heute");
    expect((p.children ?? []).map((c) => c.type === "text" ? c.value : `<${c.tagName}>`)).toEqual(["Die Projektleitung", "<ins>", " entscheidet."]);
  });
});
