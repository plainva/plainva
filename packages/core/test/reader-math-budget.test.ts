import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { TABLE_READ_BUDGET } from "../src/inlineParseBudget.js";
import { boundReaderMath, mathBudgetBeside, MATH_NODE_BUDGET, MATH_WORST_NODES_PER_CHAR, mathNodeCount, READER_NOTICE_TAG, rehypeReaderMath, type MathHastNode } from "../src/readerMathBudget.js";

/**
 * The reading view's formulas are charged by what KaTeX made of them, not by
 * their length (review, 2026-11-17): weighed by its source at the dearest
 * shape, the budget left ordinary lecture notes a third of their formulas.
 */

const SECONDS = 1000;
const inline = (tex: string): MathHastNode => ({ type: "element", tagName: "code", properties: { className: ["language-math", "math-inline"] }, children: [{ type: "text", value: tex }] });
const display = (tex: string): MathHastNode => ({ type: "element", tagName: "pre", properties: {}, children: [{ type: "element", tagName: "code", properties: { className: ["language-math", "math-display"] }, children: [{ type: "text", value: tex }] }] });
/** A layout that makes `nodes(tex)` nodes of each formula, as KaTeX does, and counts what it was asked. */
const layoutMaking = (nodes: (tex: string) => number) => {
  const asked: string[] = [];
  const layout = (tree: MathHastNode) => {
    const scope = tree.children![0];
    const tex = mathNodeText(scope);
    asked.push(tex);
    tree.children = [{ type: "element", tagName: "span", properties: { className: ["katex"] }, children: Array.from({ length: nodes(tex) - 1 }, () => ({ type: "text", value: "x" })) }];
  };
  return { layout, asked };
};
const mathNodeText = (node: MathHastNode): string => (node.type === "text" ? node.value ?? "" : (node.children ?? []).map(mathNodeText).join(""));
const laidOut = (tree: MathHastNode): number => (tree.properties?.className as string[] | undefined)?.includes("katex") ? 1 : (tree.children ?? []).reduce((sum, child) => sum + laidOut(child), 0);

describe("the formula budget of the reading view", () => {
  it("lays formulas out in the order of the note until what they made reaches the budget, and leaves the rest as their source", () => {
    const formulas = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? display(`d${i}`) : inline(`x${i}`)));
    const tree: MathHastNode = { type: "root", children: [{ type: "element", tagName: "p", children: formulas }] };
    const { layout, asked } = layoutMaking(() => 100);
    // Room for 20 formulas of 100 nodes and the dearest case of a third one's source: the 21st is laid out, crosses the
    // budget and stays as source, and so does every later one.
    const left = boundReaderMath(tree, {}, layout, 2_090);
    expect(left).toBe(10);
    expect(laidOut(tree)).toBe(20);
    expect(asked).toHaveLength(21);
    const sources = tree.children![0].children!.filter((node) => (node.properties?.className as string[] | undefined)?.includes("math-source") || node.tagName === "pre");
    expect(sources).toHaveLength(10);
    // A formula left as its source asks for no layout any more, and keeps its text.
    expect(JSON.stringify(sources)).not.toContain("math-inline");
    expect(sources.map(mathNodeText)).toEqual(Array.from({ length: 10 }, (_, i) => (i + 20) % 3 === 0 ? `d${i + 20}` : `x${i + 20}`));
  });

  it("never lays out a formula whose dearest case alone would not fit into what is left, and goes on with the next", () => {
    const giant = "a&".repeat(Math.ceil(MATH_NODE_BUDGET / MATH_WORST_NODES_PER_CHAR));
    const tree: MathHastNode = { type: "root", children: [display(giant), inline("x"), display(giant), inline("y")] };
    const { layout, asked } = layoutMaking(() => 50);
    expect(boundReaderMath(tree, {}, layout)).toBe(2);
    // KaTeX never saw the giant: its memory is spent before anything could be counted.
    expect(asked).toEqual(["x", "y"]);
  });

  it("gives the formulas of a note what its tables leave of the memory", () => {
    // A table at its budget and formulas at theirs ran the reading view out of memory (the hunt, 2026-11-18).
    expect(mathBudgetBeside(0)).toBe(MATH_NODE_BUDGET);
    expect(mathBudgetBeside(TABLE_READ_BUDGET / 4)).toBe(Math.floor(MATH_NODE_BUDGET * 0.75));
    expect(mathBudgetBeside(TABLE_READ_BUDGET)).toBe(0);
    expect(mathBudgetBeside(3 * TABLE_READ_BUDGET)).toBe(0);
  });

  it("counts every node a formula made", () => {
    expect(mathNodeCount([{ type: "element", children: [{ type: "text", value: "a" }, { type: "element", children: [{ type: "text", value: "b" }] }] }])).toBe(4);
  });

  it("says once at the top of the note that formulas stay as their source, and nothing when all are laid out", () => {
    const note = (count: number): MathHastNode => ({ type: "root", children: [{ type: "element", tagName: "p", children: Array.from({ length: count }, (_, i) => inline(`x${i}`)) }] });
    const { layout } = layoutMaking(() => 100);
    const step = rehypeReaderMath({ layout, budget: 1_000, notice: "Some formulas are shown as their source." });
    const over = note(20);
    const file = { data: {} as Record<string, unknown> };
    step(over, file);
    expect(over.children![0].tagName).toBe(READER_NOTICE_TAG);
    expect(mathNodeText(over.children![0])).toBe("Some formulas are shown as their source.");
    expect(over.children!.filter((node) => node.tagName === READER_NOTICE_TAG)).toHaveLength(1);
    expect(file.data.mathLeftAsSource).toBe(10);
    const within = note(5);
    step(within, { data: {} });
    expect(within.children!.some((node) => node.tagName === READER_NOTICE_TAG)).toBe(false);
  });

  /**
   * `main`'s limits, frozen (`scripts/perf/reader-math.ts calibrate` at
   * `main` ee8f2a950, 2026-11-17): the most formulas of each shape KaTeX laid
   * out in a process capped at 128 MB, on the reading view's math path as the
   * desktop app runs it. Every formula of each is laid out here, and three
   * times as many stay under 128 MB.
   */
  const MAIN_LIMITS: Array<[shape: string, count: number, len: number]> = [
    ["inline", 1010, 35],
    ["inline", 1454, 20],
    ["block", 78, 500],
    ["cells", 780, 40],
    ["footnotes", 770, 40],
    ["list", 790, 40],
  ];
  /** Notes `main` lays out under 128 MB, from the review of 2026-11-17: every formula of each is laid out here. */
  const ORDINARY_NOTES: Array<[shape: string, count: number, len: number]> = [
    ["inline", 300, 35],
    ["inline", 400, 35],
    ["block", 50, 500],
    ["inline", 1000, 20],
    ["list", 600, 40],
    ["cells", 400, 40],
  ];
  const capped = (shape: string, count: number, len: number) => {
    const run = spawnSync(process.execPath, ["--max-old-space-size=128", "--import", "tsx", new URL("../scripts/perf/reader-math.ts", import.meta.url).pathname, "run", "head", shape, String(count), String(len)], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
      timeout: 120 * SECONDS,
    });
    const line = run.stdout.split("\n").find((l) => l.startsWith("{"));
    return { ran: run.status === 0 && line !== undefined, result: line ? (JSON.parse(line) as { laid: number; left: number }) : null, stderr: run.stderr.slice(-300) };
  };

  it("lays out every formula main lays out under 128 MB, and stays under 128 MB at three times main's limit", () => {
    for (const [shape, count, len] of ORDINARY_NOTES) {
      const run = capped(shape, count, len);
      expect(run.ran, `${shape} ${count} ×${len}: ${run.stderr}`).toBe(true);
      expect(run.result, `${shape} ${count} ×${len}`).toEqual(expect.objectContaining({ left: 0 }));
    }
    for (const [shape, count, len] of MAIN_LIMITS) {
      const at = capped(shape, count, len);
      expect(at.ran, `${shape} ×${len} at main's limit: ${at.stderr}`).toBe(true);
      // Formulas in a table share the memory with it (`mathBudgetBeside`): at main's limit the table of 780 rows
      // weighs 0.41 of its budget, and the formulas get the rest — 78 120 nodes, 479 of the 780.
      if (shape === "cells") expect(at.result!.laid, `${shape} ×${len} at main's limit`).toBeGreaterThanOrEqual(479);
      else expect(at.result, `${shape} ×${len} at main's limit`).toEqual(expect.objectContaining({ left: 0 }));
      const past = capped(shape, 3 * count, len);
      expect(past.ran, `${shape} ×${len} at three times main's limit: ${past.stderr}`).toBe(true);
      expect(past.result!.left, `${shape} ×${len} past main's limit`).toBeGreaterThan(0);
    }
  }, 600 * SECONDS);

  it("stays under 128 MB with the dearest single formulas, which ran it out within the budget by their length (review, 2026-11-17)", () => {
    // A matrix of one row (`a&a&…`) of 11 397 characters held 246 MB; two of 5 700 ran out, and so did an array of 400 columns.
    for (const [shape, count, len] of [["matrixWide", 1, 11_397], ["matrixWide", 2, 5_700], ["arrays", 2, 5_700], ["matrix", 1, 23_000]] as const) {
      const run = capped(shape, count, len);
      expect(run.ran, `${shape} ${count} × ${len}: ${run.stderr}`).toBe(true);
    }
  }, 300 * SECONDS);
});
