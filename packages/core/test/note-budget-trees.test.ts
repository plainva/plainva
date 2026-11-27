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
 * there. Notes of the building blocks, a heavy block first, in the middle or last, in
 * every one of the sixteen wrappings (CRLF, a properties block, a byte order
 * mark, an unclosed `---`), each at budgets of 5 to 95 percent of its weight;
 * every node that begins outside the stretches is compared, with the three
 * exceptions `differences` names. A list
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
  depth: number;
}

function nodesOf(tree: MarkdownTreeNode): Placed[] {
  const out: Placed[] = [];
  const walk = (node: MarkdownTreeNode, depth: number): void => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (node.type !== "root" && typeof from === "number" && typeof to === "number") out.push({ type: node.type, from, to, depth });
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  walk(tree, 0);
  return out;
}

const meets = (ranges: readonly BoundedRange[], node: Placed) => ranges.some((range) => range.from < Math.max(node.to, node.from + 1) && range.to > node.from);
const startsIn = (ranges: readonly BoundedRange[], node: Placed) => ranges.some((range) => range.from <= node.from && node.from < range.to);
const key = (node: Placed) => `${node.type} ${node.from}-${node.to} d${node.depth}`;
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
    const ranges = overBudgetInlineRanges(note);
    // Every node that begins outside the stretches read as text is compared, by kind, both ends and depth, both ways.
    // Three exceptions, each for the case it needs:
    // - a node that begins in a place a definition in a stretch may change (`definitionReach.ts`): the rule takes
    //   nothing there, and the tree reads the brackets without the definition;
    // - text and emphasis in a container that asks the parser for a label: the edges move around the reference
    //   (rule 6); the container's links are compared;
    // - a list or a quote a stand-in cuts in two: the note read whole holds one container across the stretch (it
    //   meets a stretch), the tree its two parts (each within that one); the items and all in them are compared.
    const open = reach?.open ?? [];
    const asking = reach?.untagged ?? [];
    const head = nodesOf(tree);
    const excused = (node: Placed, side: "whole" | "tree"): boolean => {
      if (startsIn(open, node)) return true;
      if (TEXTUAL.has(node.type) && meets(asking, node)) return true;
      if (!CUT.has(node.type)) return false;
      if (side === "whole") return meets(ranges, node);
      return whole.some((each) => each.type === node.type && meets(ranges, each) && each.from <= node.from && node.to <= each.to);
    };
    const headKeys = new Set(head.map(key));
    const wholeKeys = new Set(whole.map(key));
    const found: string[] = [];
    for (const node of whole) if (!startsIn(ranges, node) && !headKeys.has(key(node)) && !excused(node, "whole")) found.push(`the note read whole has ${key(node)} ${JSON.stringify(note.slice(node.from, node.from + 40))}, the tree not`);
    for (const node of head) if (!startsIn(ranges, node) && !wholeKeys.has(key(node)) && !excused(node, "tree")) found.push(`the tree has ${key(node)} ${JSON.stringify(note.slice(node.from, node.from + 40))}, the note read whole not`);
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
        const mid = Array.from({ length: 2 + Math.floor(r() * 8) }, () => BLOCKS[Math.floor(r() * BLOCKS.length)]);
        // The heavy block first, in the middle or last, and a second one at the end in every other note.
        const at = trial % 3 === 0 ? 0 : trial % 3 === 1 ? mid.length >> 1 : mid.length;
        const blocks = [...mid.slice(0, at), HEAVY(1), ...mid.slice(at), ...(trial % 2 === 0 ? [HEAVY(2)] : [])];
        const wrap = trial % 16;
        const note = noteOfBlocks(blocks, wrap);
        const weight = weightOf(note);
        for (const share of [0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 0.95]) {
          const { found, ranges } = differences(note, Math.max(1, Math.floor(weight * share)));
          if (ranges > 0) read++;
          expect(found.slice(0, 3), `trial ${trial}, wrapping ${wrap}, ${share} of its weight: ${JSON.stringify(mid).slice(0, 500)}`).toEqual([]);
        }
      }
      expect(read).toBeGreaterThan(300);
    }, 600 * SECONDS);
  }

  it("ends a fence where the parser ends it: an indented one at its closing line, one in an item where a line leaves the item", () => {
    expect.hasAssertions();
    // The fourth review's note: a diary, then a fence indented by two whose code is written from the margin, a blank
    // line in the code, a link and a tag in it. The scan ended the fence at the first line of code; the parser holds
    // it to its closing line. And behind a `---` nothing closes, an item's fence is no item's.
    const diary = Array.from({ length: 6_000 }, (_, i) => `Day ${i}: met [[Person ${i}]] about the plan, *notes* and more words here.`).join("\n\n");
    const code = Array.from({ length: 300 }, (_, i) => `line ${i} of the code`).join("\n");
    for (const indent of [" ", "  ", "   "]) {
      for (const marker of ["```", "~~~"]) {
        const note = `# Diary\n\n${diary}\n\n${indent}${marker}python\n${code}\n\nsee [[Target]] here #tagged\n${indent}${marker}\nend\n\nafter [[After]] here #aftertag\n`;
        setNoteBudget(NOTE_BUDGET);
        expect(overBudgetInlineRanges(note).some((range) => range.block), "a block is read as text").toBe(true);
        expect(differences(note, NOTE_BUDGET).found, `${JSON.stringify(indent)} ${marker}`).toEqual([]);
      }
    }
    const behind = `---\n${diary}\n\n- \`\`\`bash\n${code}\n\`\`\`\n\n  \`\`\`\nmore\n\n  \`\`\`\n\nafter [[Target]] here #tagged\n`;
    expect(differences(behind, NOTE_BUDGET).found).toEqual([]);
  }, 120 * SECONDS);

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
