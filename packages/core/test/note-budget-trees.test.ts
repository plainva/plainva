import { afterAll, describe, expect, it } from "vitest";
import { NOTE_BUDGET, overBudgetInlineRanges, setNoteBudget, type BoundedRange } from "../src/inlineParseBudget.ts";
import { definitionReachOf, parseMarkdownTree, type MarkdownTreeNode } from "../src/markdown-parser.ts";
import { BLOCKS, HEAVY, noteOfBlocks } from "../scripts/perf/noteBlocks.ts";

/**
 * A stand-in changes nothing outside itself. A stretch the note's budget reads
 * as text stands in, in the note's tree, as characters that read as nothing;
 * what decides how the rest of the note is read never stands in a stretch —
 * the first line of a properties block nothing closes, a fence, an HTML block
 * or a comment open beyond the stretch's end. So outside the stretches the
 * note's tree is the tree of the note read whole, node for node, by kind and
 * place (review of L14, round three: a note that began with a `---` nothing
 * closes lost it with its first block read as text, and the tree read the rest
 * the other way — a rename wrote into a code span). This is stronger than
 * comparing links: it holds every reader of the tree, before a writer meets it.
 *
 * Outside also means outside the places the rule of `definitionReach.ts`
 * names: where a definition in a stretch read as text may change brackets
 * around it, the tree reads them without it, and its readers take nothing
 * there. Notes of the building blocks, a heavy first and a heavy last block, in every
 * one of the sixteen wrappings (CRLF, a properties block, a byte order mark,
 * an unclosed `---`), each at budgets of 15 to 90 percent of its weight. A list
 * or a quote that a stand-in in its middle cuts in two reads as its parts: the
 * part of such a container is allowed where the note read whole holds the
 * container across the stretch.
 */

afterAll(() => setNoteBudget(NOTE_BUDGET));

const SECONDS = 1000;

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

interface Placed {
  type: string;
  from: number;
  to: number;
}

function nodesOf(tree: MarkdownTreeNode): Placed[] {
  const out: Placed[] = [];
  const walk = (node: MarkdownTreeNode): void => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (node.type !== "root" && typeof from === "number" && typeof to === "number") out.push({ type: node.type, from, to });
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return out;
}

const meets = (ranges: readonly BoundedRange[], node: Placed) => ranges.some((range) => range.from < Math.max(node.to, node.from + 1) && range.to > node.from);
const key = (node: Placed) => `${node.type} ${node.from}-${node.to}`;
/** What of a container's inline content a reference moves the edges of. */
const TEXTUAL = new Set(["text", "emphasis", "strong", "delete"]);
/** Containers a stand-in may cut in two. */
const CUT = new Set(["list", "blockquote"]);

function weightOf(note: string): number {
  let total = 0;
  setNoteBudget(Number.MAX_SAFE_INTEGER);
  overBudgetInlineRanges(note, { note: (value) => (total = value) });
  return total;
}

/** What of the note's tree outside its stretches read as text differs from the note read whole, at `budget`. */
function differences(note: string, budget: number): { found: string[]; ranges: number } {
  setNoteBudget(Number.MAX_SAFE_INTEGER);
  const whole = nodesOf(parseMarkdownTree(note));
  setNoteBudget(budget);
  try {
    // What the tree does not read: its stretches read as text, and where a definition in them may change brackets
    // outside them (`definitionReach.ts`) — that is the rule's to answer for, not the stand-in's.
    const tree = parseMarkdownTree(note);
    const reach = definitionReachOf(tree);
    const ranges = [...overBudgetInlineRanges(note), ...(reach?.open ?? [])];
    // In a container that asks the parser for a label, the edges of its text and its emphasis move around the
    // reference (rule 6): its text is not compared, its links are.
    const asking = reach?.untagged ?? [];
    const outside = (node: Placed) => !meets(ranges, node) && !(TEXTUAL.has(node.type) && meets(asking, node));
    const head = nodesOf(tree).filter(outside);
    const wholeOutside = whole.filter(outside);
    const headOutside = new Set(head.map(key));
    const wholeKeys = new Set(wholeOutside.map(key));
    const found: string[] = [];
    for (const node of wholeOutside) if (!headOutside.has(key(node))) found.push(`the note read whole has ${key(node)} ${JSON.stringify(note.slice(node.from, node.from + 40))}, the tree not`);
    for (const node of head) {
      if (wholeKeys.has(key(node))) continue;
      const part = CUT.has(node.type) && whole.some((each) => each.type === node.type && meets(ranges, each) && each.from <= node.from && node.to <= each.to);
      if (!part) found.push(`the tree has ${key(node)} ${JSON.stringify(note.slice(node.from, node.from + 40))}, the note read whole not`);
    }
    return { found, ranges: ranges.length };
  } finally {
    setNoteBudget(NOTE_BUDGET);
  }
}

describe("the note's tree outside what it reads as text", () => {
  for (const seed of [3, 17]) {
    it(`is the tree of the note read whole, node for node (seed ${seed})`, () => {
      expect.hasAssertions();
      let read = 0;
      for (let trial = 0; trial < 96; trial++) {
        const r = random(seed * 7_919 + trial);
        const blocks = [HEAVY(1), ...Array.from({ length: 2 + Math.floor(r() * 8) }, () => BLOCKS[Math.floor(r() * BLOCKS.length)]), HEAVY(2)];
        const wrap = trial % 16;
        const note = noteOfBlocks(blocks, wrap);
        const weight = weightOf(note);
        for (const share of [0.15, 0.3, 0.5, 0.7, 0.9]) {
          const { found, ranges } = differences(note, Math.max(1, Math.floor(weight * share)));
          if (ranges > 0) read++;
          expect(found.slice(0, 3), `trial ${trial}, wrapping ${wrap}, ${share} of its weight: ${JSON.stringify(blocks.slice(1, -1)).slice(0, 500)}`).toEqual([]);
        }
      }
      expect(read).toBeGreaterThan(300);
    }, 600 * SECONDS);
  }

  it("keeps the line of a `---` nothing closes out of what it reads as text, whatever follows it", () => {
    expect.hasAssertions();
    // The review's note: an unclosed `---`, a heavy list right behind it, then a code span over a line that reads as
    // a list item where the `---` is gone.
    for (const bom of ["", "﻿"]) {
      const note = `${bom}---\n${Array.from({ length: 10_200 }, (_, i) => `- item ${i} **b** _c_ \`d\` [[Other${i}]] <e> &amp; ~~s~~ words`).join("\n")}\n\nx \`a\n- [[Target]] b\` end\n`;
      setNoteBudget(NOTE_BUDGET);
      const ranges = overBudgetInlineRanges(note);
      expect(ranges.some((range) => range.block), "the list is read as text").toBe(true);
      expect(ranges.every((range) => range.from >= note.indexOf("\n")), "the `---` line stays").toBe(true);
      expect(differences(note, NOTE_BUDGET).found).toEqual([]);
    }
  }, 120 * SECONDS);
});
