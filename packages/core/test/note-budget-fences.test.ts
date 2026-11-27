import { afterAll, describe, expect, it } from "vitest";
import { extractLinksAndTags } from "../src/ast-scanner.ts";
import { NOTE_BUDGET, overBudgetInlineRanges, setNoteBudget } from "../src/inlineParseBudget.ts";
import { readNoteLinks } from "../src/linkRewrite.ts";
import { parseMarkdownAst } from "../src/markdown-parser.ts";
import { HEAVY } from "../scripts/perf/noteBlocks.ts";

/**
 * The budget's blocks are the parser's (review of L14, round four). Where the
 * scan cannot know where a fence or HTML that runs on ends — indented where a
 * list item may be open, or behind a quote's or an item's marker — it cuts
 * nothing to the note's end: a block it cut inside the parser's code was read
 * in pieces, and a piece read the code as Markdown, its links and tags. Each
 * note here holds such a construct before a heavy block the parser reads as
 * code; at every budget, the index lists the links and tags of the note read
 * whole, no more.
 */

afterAll(() => setNoteBudget(NOTE_BUDGET));

function weightOf(note: string): number {
  let total = 0;
  setNoteBudget(Number.MAX_SAFE_INTEGER);
  overBudgetInlineRanges(note, { note: (value) => (total = value) });
  return total;
}

function facts(note: string, budget: number): { links: string[]; unread: Array<{ from: number; to: number }>; tags: string[] } {
  setNoteBudget(budget);
  try {
    const read = readNoteLinks(note);
    const tags = extractLinksAndTags(parseMarkdownAst(note), note).tags.map((tag) => tag.name).sort();
    return { links: read.links.map((link) => `${link.target} ${link.start}`).sort(), unread: read.unread, tags };
  } finally {
    setNoteBudget(NOTE_BUDGET);
  }
}

const NOTES: Record<string, string> = {
  // HTML that runs on, opened in a quote: the quote's end ends it, the fence behind it holds the heavy block.
  "a comment opened in a quote": `> <!--\n\n\`\`\`\ncode\n-->\n\n${HEAVY(1)}\n\n${HEAVY(2)}\n\n\`\`\`\nend [[After]]\n`,
  // A fence in a list item that a line from the margin leaves: the fence after it opens to the note's end.
  "a fence in an item, left from the margin": `- item\n\n  \`\`\`\ncode\n\nmid [[Mid]]\n  \`\`\`\n\n${HEAVY(1)}\n\n${HEAVY(2)}\n`,
  // A fence indented by two in no item, its code from the margin: it holds the heavy block to its closing line.
  "an indented fence in no item": `intro [[Intro]]\n\n  \`\`\`\ncode\n\n${HEAVY(1)}\n\n${HEAVY(2)}\n  \`\`\`\n\nafter [[After]] #aftertag\n`,
  // HTML that runs on, indented where an item may be open.
  "a comment indented in an item": `- item\n\n  <!--\ncode\n\n${HEAVY(1)}\n\n${HEAVY(2)}\n\n-->\n\nafter [[After]]\n`,
};

describe("a fence or HTML whose end the scan cannot know", () => {
  for (const [name, note] of Object.entries(NOTES)) {
    it(`${name}: the index lists what the note read whole lists, at every budget`, () => {
      expect.hasAssertions();
      const whole = facts(note, Number.MAX_SAFE_INTEGER);
      const weight = weightOf(note);
      let read = 0;
      for (const share of [0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 0.95]) {
        const budget = Math.max(1, Math.floor(weight * share));
        setNoteBudget(budget);
        if (overBudgetInlineRanges(note).some((range) => range.block)) read++;
        setNoteBudget(NOTE_BUDGET);
        // No link and no tag the note read whole does not have; one it has is missing only where a part is not read.
        const head = facts(note, budget);
        expect(head.links.filter((link) => !whole.links.includes(link)), `${share} of its weight`).toEqual([]);
        const lost = whole.links.filter((link) => !head.links.includes(link) && !head.unread.some((range) => range.from <= Number(link.split(" ").pop()) && Number(link.split(" ").pop()) < range.to));
        expect(lost, `${share} of its weight: lost without a word`).toEqual([]);
        const left = [...whole.tags];
        for (const tag of head.tags) {
          const at = left.indexOf(tag);
          expect(at, `${share} of its weight: a tag the note read whole does not have: ${tag}`).toBeGreaterThanOrEqual(0);
          left.splice(at, 1);
        }
      }
      expect(read, "a block is read as text at some budget").toBeGreaterThan(0);
    });
  }
});
