// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { drawLucideIcon, isLucideIconRef, lucideIconPaths, lucideIconSvg, docIconValue } from "@plainva/ui";

/**
 * Drawing an icon-set reference outside the DOM.
 *
 * The graph painted `n.icon` as TEXT, which is right for an emoji but drew the
 * raw string "lucide:circle-question-mark" across the map at node size for an
 * icon reference (report 2026-07-29, screenshot). The shapes existed all along —
 * these tests pin that they are what gets drawn, on the canvas and in the export.
 *
 * jsdom has no Path2D, so the canvas tests install a recording stub: that also
 * covers the fallback, because a build without Path2D must leave the node plain
 * instead of painting a name.
 */

class RecordingPath2D {
  static made: RecordingPath2D[] = [];
  ops: string[] = [];
  constructor(readonly d?: string) {
    RecordingPath2D.made.push(this);
    if (d) this.ops.push(`d:${d}`);
  }
  arc() {
    this.ops.push("arc");
  }
  ellipse() {
    this.ops.push("ellipse");
  }
  moveTo() {
    this.ops.push("moveTo");
  }
  lineTo() {
    this.ops.push("lineTo");
  }
  rect() {
    this.ops.push("rect");
  }
  roundRect() {
    this.ops.push("roundRect");
  }
  closePath() {
    this.ops.push("close");
  }
}

function withPath2D<T>(run: () => T): T {
  RecordingPath2D.made = [];
  (globalThis as unknown as { Path2D?: unknown }).Path2D = RecordingPath2D;
  try {
    return run();
  } finally {
    delete (globalThis as unknown as { Path2D?: unknown }).Path2D;
  }
}

/** Records the calls a stroke path makes, so a test can assert WHAT was drawn. */
function fakeCtx() {
  const calls: string[] = [];
  const ctx = {
    calls,
    save: () => void calls.push("save"),
    restore: () => void calls.push("restore"),
    translate: (x: number, y: number) => void calls.push(`translate:${x},${y}`),
    scale: (x: number, y: number) => void calls.push(`scale:${x.toFixed(4)},${y.toFixed(4)}`),
    stroke: (p?: unknown) => void calls.push(p ? "stroke:path" : "stroke"),
    fillText: (text: string) => void calls.push(`fillText:${text}`),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
    font: "",
    textAlign: "",
    textBaseline: "",
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: string[] };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("icon-set references outside the DOM", () => {
  it("recognises a drawable reference and rejects an emoji or an unknown name", () => {
    expect(isLucideIconRef(docIconValue("book"))).toBe(true);
    expect(isLucideIconRef("📕")).toBe(false);
    expect(isLucideIconRef(docIconValue("no-such-icon-anywhere"))).toBe(false);
  });

  it("turns the icon's shapes into paths, not into a string", () => {
    withPath2D(() => {
      const paths = lucideIconPaths(docIconValue("book"));
      expect(paths).not.toBeNull();
      expect(paths!.length).toBeGreaterThan(0);
      // Every element became a path op — nothing was silently dropped.
      for (const p of paths as unknown as RecordingPath2D[]) expect(p.ops.length).toBeGreaterThan(0);
    });
  });

  it("covers the non-path elements too (a circle icon)", () => {
    withPath2D(() => {
      // "clock" is drawn from a circle plus a polyline in lucide.
      const paths = lucideIconPaths(docIconValue("clock")) as unknown as RecordingPath2D[] | null;
      expect(paths).not.toBeNull();
      const ops = paths!.flatMap((p) => p.ops).join(" ");
      expect(ops).toMatch(/arc|d:/);
    });
  });

  it("strokes centred on the node and reports success", () => {
    withPath2D(() => {
      const ctx = fakeCtx();
      expect(drawLucideIcon(ctx, docIconValue("book"), 100, 50, 20, "#123456")).toBe(true);
      expect(ctx.calls).toContain("translate:90,40"); // centred: cx - d/2, cy - d/2
      expect(ctx.calls).toContain("scale:0.8333,0.8333"); // 20 / 24
      expect(ctx.calls.filter((c) => c === "stroke:path").length).toBeGreaterThan(0);
      // No text at all — that was the bug.
      expect(ctx.calls.some((c) => c.startsWith("fillText"))).toBe(false);
      expect(ctx.calls[0]).toBe("save");
      expect(ctx.calls[ctx.calls.length - 1]).toBe("restore");
    });
  });

  it("declines an emoji and an unknown name instead of drawing something wrong", () => {
    withPath2D(() => {
      const ctx = fakeCtx();
      expect(drawLucideIcon(ctx, "📕", 0, 0, 20, "#000")).toBe(false);
      expect(drawLucideIcon(ctx, docIconValue("nope"), 0, 0, 20, "#000")).toBe(false);
      expect(ctx.calls).toEqual([]);
    });
  });

  it("declines without Path2D, so a build that cannot draw leaves the node plain", () => {
    const ctx = fakeCtx();
    expect(lucideIconPaths(docIconValue("book"))).toBeNull();
    expect(drawLucideIcon(ctx, docIconValue("book"), 0, 0, 20, "#000")).toBe(false);
  });

  it("exports the same icon as SVG shapes, positioned like the canvas version", () => {
    const svg = lucideIconSvg(docIconValue("book"), 100, 50, 20, "#123456", 0.5);
    expect(svg).not.toBeNull();
    expect(svg).toContain('transform="translate(90 40) scale(0.8333333333333334)"');
    expect(svg).toContain('stroke="#123456"');
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toMatch(/<(path|circle|line|rect|polyline|polygon|ellipse) /);
    // The reference itself never appears in the file.
    expect(svg).not.toContain("lucide:");
  });

  it("leaves an emoji to the text path in the export", () => {
    expect(lucideIconSvg("📕", 0, 0, 20, "#000")).toBeNull();
    expect(lucideIconSvg(docIconValue("nope"), 0, 0, 20, "#000")).toBeNull();
  });
});
