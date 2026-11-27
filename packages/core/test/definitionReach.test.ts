import { describe, expect, it } from "vitest";
import { definitionReach, type DefinitionReach } from "../src/definitionReach.ts";
import { parseMarkdownAst } from "../src/markdown-parser.ts";
import { readNoteLinks } from "../src/linkRewrite.ts";
import { findInlineTags } from "../src/tagRule.ts";

/**
 * The rule of `definitionReach.ts` itself, without a budget and without
 * pieces: a paragraph full of brackets is read whole under many sets of
 * defined labels — none, all, footnotes, a link label that folds to a
 * footnote's (`[ ^a]`) — and every place the rule calls fixed in one reading
 * must be read alike in every other: each link with its places, its target,
 * its kind and whether it stands in a label, and each tag of a container the
 * rule lets give tags. What the rule calls open may differ; it is given as
 * not read.
 */

const SECONDS = 1000;

/** The labels the paragraphs refer to, and how each may be defined. */
const DEFINITIONS = [
  "[a]: d.md",
  "[b]: d.md 'title'",
  "[c]: <d e.md>",
  "[x y]: d.md",
  "[A]: d.md",
  "[t]: d.md",
  "[!note]: d.md",
  "[^a]: footnote [[F]]",
  "[^b]: footnote two",
  "[ ^a]: d.md",
  "[a\nb]: d.md",
];

const TOKENS = [
  "[", "[", "[", "]", "]", "]", "![", "](", "][", "(", ")", "a", "b", "c", "t", "^", "^a", "x y", "A", " ", " ", " ", "\n",
  "[[A]]", "![[A]]", "[[A|b]]", "[[x.md]]", "`", "``", "<", ">", "<span>", "</span>", "\\", "\\[", "\\]", "x.md", "(x.md)",
  "(x.md \"t\")", "(<x y.md>)", "<x.md>", "\"t\"", "www.x.com", "<http://a.b>", "*", "_", "**", "~~", "#tag", "#t2",
  "a@b.co", "[a]", "[b]", "[^a]", "[^b]", "[x](x.md)", "[x][a]", "[a][]", "[ ^a]", "[a\nb]", "[!note]", "$", "&#91;",
  "[t](a b)", "[a](", "x.md)", "[[", "]]", "|",
];

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function paragraphOf(r: () => number): string {
  const count = 3 + Math.floor(r() * 26);
  let text = "";
  for (let k = 0; k < count; k++) text += TOKENS[Math.floor(r() * TOKENS.length)];
  // A paragraph, not a definition and not a block of another kind at its start — or in a quote, or in a table cell.
  const paragraph = `p ${text.replace(/\n(?=\s|[#>*+=-]|\d)/g, "\nq ")} end`;
  const wrap = r();
  if (wrap < 0.15) return paragraph.split("\n").map((line) => `> ${line}`).join("\n");
  if (wrap < 0.3) return `| h | g |\n|---|---|\n| ${paragraph.replace(/\n/g, " ").replace(/\|/g, "\\|")} | z |`;
  return paragraph;
}

interface Read {
  reach: DefinitionReach;
  /** Every link the reading makes in the paragraph, by its place, and what the rule calls fixed of them. */
  links: Map<number, string>;
  fixedLinks: Set<number>;
  /** Every tag of the paragraph's containers, by container and name, and the containers the rule lets give tags. */
  tags: string[];
  tagged: Set<number>;
}

const inAny = (ranges: readonly { from: number; to: number }[], at: number) => ranges.some((range) => range.from <= at && at < range.to);

/** The paragraph read whole with `definitions` behind it, by the rule. */
function readOf(paragraph: string, definitions: readonly string[], obsidian: boolean): Read {
  const note = definitions.length > 0 ? `${paragraph}\n\n${definitions.join("\n\n")}\n` : `${paragraph}\n`;
  const tree = parseMarkdownAst(note, { preserveObsidianSyntax: obsidian });
  const reach = definitionReach(note, tree);
  const inParagraph = (at: number) => at < paragraph.length;
  reach.open = reach.open.filter((range) => inParagraph(range.from));
  reach.untagged = reach.untagged.filter((range) => inParagraph(range.from));
  const links = new Map<number, string>();
  const fixedLinks = new Set<number>();
  for (const link of readNoteLinks(note).links) {
    if (!inParagraph(link.start)) continue;
    links.set(link.start, `${link.type} ${link.target} ${link.start}-${link.end} ${link.targetStart}-${link.targetEnd} label=${link.inLabel} table=${link.inTable}`);
    if (!inAny(reach.open, link.start)) fixedLinks.add(link.start);
  }
  // Tags: the tag rule over each text node, by its container, as the index reads them — a text node a plugin made (the
  // autolink literals split the text) has no place of its own.
  const tags: string[] = [];
  const tagged = new Set<number>();
  type Node = { type: string; value?: string; children?: unknown[]; position?: { start: { offset: number } } };
  const walk = (node: Node, container: number | null): void => {
    const at = node.position?.start.offset;
    if ((node.type === "paragraph" || node.type === "heading" || node.type === "tableCell") && at !== undefined && inParagraph(at)) {
      container = at;
      if (!inAny(reach.untagged, at)) tagged.add(at);
    }
    if (node.type === "text" && container !== null) for (const tag of findInlineTags(node.value ?? "")) tags.push(`${container} ${tag.name}`);
    for (const child of (node.children ?? []) as Node[]) walk(child, container);
  };
  walk(tree as never, null);
  tags.sort();
  return { reach, links, fixedLinks, tags, tagged };
}

/**
 * What the rule asks of two readings of one paragraph under two sets of definitions: every link `a` calls fixed is
 * a link of `b`, at its place, with its facts, and every link of `b` that `a` does not call fixed stands where `a`
 * reads nothing; the tags of every container `a` lets give tags are `b`'s tags there. Where each is open may differ:
 * a reading that loses a node in an image's label is more careful than the other, never less.
 */
function disagreements(a: Read, b: Read): string[] {
  const found: string[] = [];
  for (const at of a.fixedLinks) if (a.links.get(at) !== b.links.get(at)) found.push(`fixed ${a.links.get(at)} reads ${b.links.get(at) ?? "as no link"}`);
  for (const [at, link] of b.links) if (!a.fixedLinks.has(at) && !inAny(a.reach.open, at)) found.push(`${link} stands where it reads none`);
  for (const container of a.tagged) {
    const own = (read: Read) => read.tags.filter((tag) => tag.startsWith(`${container} `)).join(", ");
    if (own(a) !== own(b)) found.push(`the tags at ${container}: ${own(a)} against ${own(b)}`);
  }
  return found;
}

describe("the places a definition elsewhere may change", () => {
  for (const obsidian of [false, true]) {
    it(`reads every place it calls fixed alike under every set of definitions (${obsidian ? "the index's" : "a rename's"} parse)`, () => {
      expect.hasAssertions();
      let compared = 0;
      let opened = 0;
      for (let seed = 1; seed <= 1500; seed++) {
        const r = random(seed);
        const paragraph = paragraphOf(r);
        const sets: string[][] = [[], DEFINITIONS];
        for (let k = 0; k < 8; k++) sets.push(DEFINITIONS.filter(() => r() < 0.5));
        const first = readOf(paragraph, sets[0], obsidian);
        if (first.reach.open.length > 0) opened++;
        for (const set of sets.slice(1)) {
          const other = readOf(paragraph, set, obsidian);
          const name = `seed ${seed}: ${JSON.stringify(paragraph)} with ${JSON.stringify(set)}`;
          expect([...disagreements(first, other), ...disagreements(other, first)], name).toEqual([]);
          compared++;
        }
      }
      // Most paragraphs ask the parser for a label somewhere; a test of the rule needs both kinds.
      expect(opened, "paragraphs with an open place").toBeGreaterThan(300);
      expect(compared).toBe(1500 * 9);
    }, 300 * SECONDS);
  }

  it("holds where each clause matters, for the definitions that change it", () => {
    expect.hasAssertions();
    // Each a paragraph whose reading a definition changes in a way one clause of the rule answers for.
    const cases: Array<[string, string[]]> = [
      // A `[^…]` followed by `(`: a footnote and text where it is defined, a link whose destination swallows what follows where not.
      ["p [^a](<y [[A]]>) z", ["[^a]: f"]],
      // `[text][label]` followed by `(`: a reference and text, or a link; and a code span that the text then opens.
      ["p [x][y](a`) [[A]] ` z", ["[y]: d.md"]],
      ["p [foo][bar](x.md) [[A]] z", ["[bar]: d.md"]],
      // A reference in a link's text, and a shortcut whose destination fails, under a link.
      ["p [x [b]](x.md) [[A]] z", ["[b]: d.md"]],
      ["p [x [t](a b)](u.md) [[A]] z", ["[t]: d.md"]],
      // A wiki link in a reference's text, and an image's label that holds one.
      ["p [use [[A]]][bar] z", ["[bar]: d.md"]],
      ["p ![~~[[[A|b]]][a]x.md)](``b]![ z", ["[a]: d.md"]],
      // Escaped brackets are no brackets.
      ["p \\[x](y.md) [b] \\] [[A]] z", ["[b]: d.md"]],
      ["p [x \\] [b]](y.md) [[A]] z", ["[b]: d.md"]],
      // An escaped `]` closes nothing: read as a closer, the reference behind it looked like the only bracket open, and
      // the wiki link behind that fixed — where `b` is defined it stands in no link, where not in the link to `u`.
      ["p [a \\] [b] [[W]]](u.md) z", ["[b]: d.md"]],
    ];
    for (const [paragraph, definitions] of cases) {
      for (const obsidian of [false, true]) {
        const none = readOf(paragraph, [], obsidian);
        const some = readOf(paragraph, definitions, obsidian);
        expect([...disagreements(none, some), ...disagreements(some, none)], JSON.stringify(paragraph)).toEqual([]);
      }
    }
  });

  it("calls a note's usual links fixed", () => {
    expect.hasAssertions();
    const note = "See [[A]], [x](x.md), www.x.com and `[code]` with #tag.\n\n[a]: d.md\n";
    const reach = definitionReach(note, parseMarkdownAst(note));
    expect(reach.open).toEqual([]);
    expect(reach.untagged).toEqual([]);
  });

  it("opens a reference and what it may take, and reads on behind a reference that stands alone", () => {
    expect.hasAssertions();
    const note = "A [foo][bar](x.md) b\n\nB [^1] and [[A]] and [y](y.md)\n\nC [z [b]](z.md) [[A]]\n";
    const { open, untagged } = definitionReach(note, parseMarkdownAst(note));
    const stretch = (range: { from: number; to: number }) => note.slice(range.from, range.to);
    expect(open.map(stretch)).toEqual(["[foo][bar](x.md) b", "[^1]", "[z [b]](z.md) [[A]]"]);
    expect(untagged.map(stretch)).toEqual(["A [foo][bar](x.md) b", "B [^1] and [[A]] and [y](y.md)", "C [z [b]](z.md) [[A]]"]);
  });
});
