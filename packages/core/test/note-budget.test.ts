import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NOTE_BUDGET, overBudgetInlineRanges, boundMarkdownForParse, readAsTextParts, restoreBoundedTree, setNoteBudget } from "../src/inlineParseBudget.ts";
import { parseMarkdownAst, parseMarkdownTree, type MarkdownTreeNode } from "../src/markdown-parser.ts";
import { analyzeNoteSource } from "../src/noteSource.ts";
import { renameNoteLinks } from "../src/linkRewrite.ts";
import { extractFrontmatter } from "../src/metadata-extractor.ts";
import { extractLinksAndTags } from "../src/ast-scanner.ts";
import { scanTasks } from "../src/vault/taskScan.ts";
import { markdownAstSchema } from "../src/markdown-ast.ts";
import remarkObsidianPreserve from "../src/remark-obsidian-preserve.ts";
import { remarkWikiLinks } from "../src/wikiLinkSyntax.ts";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { within } from "./helpers/timeBudget.js";
import { shapeTable } from "../scripts/perf/table-budget.ts";
import { NOTE_FORMS } from "../scripts/perf/note-budget.ts";

const SECONDS = 1000;
const CORE = new URL("..", import.meta.url).pathname;

/** Runs `body` (a module's code with `P`, the parser, and `text` at hand) in a process of its own with `mb` of heap. */
function underHeap(mb: number, text: string, body: string) {
  const script = `const P = await import(${JSON.stringify(new URL("../src/markdown-parser.ts", import.meta.url).pathname)}); const text = ${text}; ${body}`;
  return spawnSync(process.execPath, [`--max-old-space-size=${mb}`, "--import", "tsx", "--input-type=module", "-e", script], { cwd: CORE, encoding: "utf8", timeout: 240_000 });
}

const typesOf = (node: MarkdownTreeNode, into: string[] = []): string[] => {
  into.push(node.type);
  for (const child of node.children ?? []) typesOf(child, into);
  return into;
};
const textsOf = (node: MarkdownTreeNode, into: string[] = []): string[] => {
  if (typeof node.value === "string") into.push(node.value);
  for (const child of node.children ?? []) textsOf(child, into);
  return into;
};

describe("the note's budget (L14)", () => {
  it("reads every note under a capped heap, however large: words, lists, many short blocks", () => {
    // Each of these ran a parse out of 128 MB with nothing else in the note,
    // on main as well: a paragraph of 1.5 MB of one-letter words (GFM's table
    // parser read the line as a header row, a piece a word), a list of 20 000
    // linked items (B1: 409 MB), 40 000 short paragraphs, 4 MB of prose.
    const notes = [
      `"# N\\n\\n" + "x ".repeat(750000)`,
      `"# N\\n\\n" + Array.from({ length: 20000 }, (_, i) => "- item " + i + " [[Note " + i + "]]").join("\\n")`,
      `"# N\\n\\n" + Array.from({ length: 40000 }, (_, i) => "alpha beta gamma delta " + i).join("\\n\\n")`,
      `"# N\\n\\n" + Array.from({ length: 60000 }, (_, i) => "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda " + i).join("\\n")`,
    ];
    for (const text of notes) {
      for (const parse of ["parseMarkdownTree(text)", "parseMarkdownAst(text, { preserveObsidianSyntax: true })"]) {
        const run = underHeap(128, text, `P.${parse}; console.log("ok");`);
        expect(run.stdout.trim(), `${text.slice(0, 60)} ${parse}: ${run.stderr.slice(-200)}`).toBe("ok");
      }
    }
  }, 600 * SECONDS);

  it("reads the heaviest blocks as text, keeps the rest, the headings and the properties, and every character", () => {
    const list = Array.from({ length: 20_000 }, (_, i) => `- item ${i} [[Note ${i}]]`).join("\n");
    const text = `---\ntitle: Big\n---\n\n# Start\n\nA *short* paragraph with [[Link]].\n\n${list}\n\n## End\n\nAfter **it**.\n`;
    const ranges = overBudgetInlineRanges(text);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].block).toBe(true);
    expect(text.slice(ranges[0].from, ranges[0].to)).toBe(list);
    const tree = parseMarkdownTree(text);
    const types = typesOf(tree);
    expect(types).toEqual(expect.arrayContaining(["yaml", "heading", "emphasis", "wikiLink", "strong"]));
    expect(types).not.toContain("list");
    // The list comes back as one text, character for character.
    expect(textsOf(tree)).toContain(list);
    // The headings keep their lines, behind a block that is one line in the parsed text.
    const headings = analyzeNoteSource(text).headings.map((h) => [h.text, h.line]);
    expect(headings).toEqual([["Start", 5], ["End", 20_010]]);
    expect(extractFrontmatter(parseMarkdownAst(text))).toMatchObject({ success: true, data: { title: "Big" } });
  });

  it("leaves a note under its budget as it is", () => {
    const list = Array.from({ length: 3_000 }, (_, i) => `- item ${i} [[Note ${i}]]`).join("\n");
    const prose = Array.from({ length: 3_000 }, (_, i) => `A line of prose number ${i} with a few words in it.`).join("\n");
    for (const text of [`# T\n\n${list}\n`, `# T\n\n${prose}\n`]) expect(overBudgetInlineRanges(text)).toEqual([]);
  });

  it("reads headings as text only where the rest cannot bring the note into its budget", () => {
    const headings = Array.from({ length: 30_000 }, (_, i) => `## Heading ${i}`).join("\n");
    const ranges = overBudgetInlineRanges(`${headings}\n`);
    expect(ranges.some((range) => range.block)).toBe(true);
    // With a heavy list beside them, the list goes and the headings stay.
    const list = Array.from({ length: 20_000 }, (_, i) => `- item ${i} [[Note ${i}]]`).join("\n");
    const some = Array.from({ length: 50 }, (_, i) => `## Heading ${i}`).join("\n\n");
    const text = `${some}\n\n${list}\n`;
    const blocks = overBudgetInlineRanges(text).filter((range) => range.block);
    expect(blocks.map((range) => text.slice(range.from, range.to))).toEqual([list]);
  });

  it("joins blocks with only blank lines between them into one range, so that they are one line", () => {
    // Blocks of one weight, read as text from the first on: one range. (Of different weights, the heaviest go first,
    // and the blocks chosen need not lie next to each other.)
    const text = `# T\n\n${Array.from({ length: 40_000 }, () => "alpha beta gamma").join("\n\n")}\n`;
    const ranges = overBudgetInlineRanges(text).filter((range) => range.block);
    expect(ranges).toHaveLength(1);
    const bounded = boundMarkdownForParse(text);
    expect(bounded.text.slice(bounded.ranges[0].from, bounded.ranges[0].to)).not.toContain("\n");
    const tree = { type: "text", value: bounded.text, position: { start: { offset: 0, line: 1, column: 1 }, end: { offset: text.length } } };
    restoreBoundedTree(tree, bounded);
    expect(tree.value).toBe(text);
  });

  it("weighs a note in time linear in its size", () => {
    const note = (lines: number) => `# T\n\n${Array.from({ length: lines }, (_, i) => `- item ${i} [[Note ${i}]] and a@b.cc`).join("\n")}\n`;
    const small = note(25_000);
    const large = note(100_000);
    const time = (text: string) => {
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        overBudgetInlineRanges(text);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    const one = time(small);
    const four = within(2 * SECONDS, () => time(large));
    expect(four).toBeLessThan(8 * one + 100);
    expect(NOTE_BUDGET).toBeGreaterThan(0);
  }, 60 * SECONDS);

  it("rewrites the links of a block read as text when a note is renamed", () => {
    const list = Array.from({ length: 10_000 }, (_, i) => `- item ${i} [[Old]] and \`[[Old]]\` in code`).join("\n");
    const text = `# T\n\n[[Old]] at the top\n\n${list}\n`;
    expect(overBudgetInlineRanges(text).some((range) => range.block)).toBe(true);
    const result = renameNoteLinks(text, new Map([["Old", "New"]]));
    expect(readAsTextParts(text).unread).toEqual([]);
    expect(result.renamed).toBe(10_001);
    // A link in a code span stays as it is written.
    expect(result.content.split("`[[Old]]`").length - 1).toBe(10_000);
    expect(result.content).not.toMatch(/item \d+ \[\[Old\]\]/);
  });

  it("keeps the links, tags and tasks of a block read as text for the index, each once", () => {
    // The index lists the links of a block read as text from its pieces, read by the parser itself (`forEachReadPiece`):
    // a backlink and the graph keep them, and a rename finds each one once.
    const list = Array.from({ length: 10_000 }, (_, i) => `- [ ] task ${i} [[Note ${i % 7}]] [label](<Other ${i % 5}.md>) #tag${i % 3} \`[[Code]]\``).join("\n");
    const text = `# T\n\n[[Top]] and [x](Top.md)\n\n${list}\n`;
    expect(overBudgetInlineRanges(text).some((range) => range.block)).toBe(true);
    // The index reads it in pieces: nothing of it is unread.
    expect(readAsTextParts(text).unread).toEqual([]);
    const { links, tags } = extractLinksAndTags(parseMarkdownAst(text, { preserveObsidianSyntax: true }), text);
    expect(links.filter((link) => link.type === "wikilink")).toHaveLength(10_001);
    expect(links.filter((link) => link.type === "markdown-link")).toHaveLength(10_001);
    expect(links.some((link) => link.target === "Code")).toBe(false);
    expect(new Set(links.filter((link) => link.type === "markdown-link").map((link) => link.target))).toEqual(new Set(["Top.md", "Other 0.md", "Other 1.md", "Other 2.md", "Other 3.md", "Other 4.md"]));
    // A link stands at its own line.
    expect(links.find((link) => link.target === "Note 3")?.line).toBe(8);
    expect(tags.filter((tag) => tag.source === "inline")).toHaveLength(10_000);
    expect(scanTasks(text)).toHaveLength(10_000);
    // A rename counts each link of the block once.
    expect(renameNoteLinks(text, new Map([["Note 3", "Renamed"]])).renamed).toBe(Math.ceil((10_000 - 3) / 7));
  });

  /** A seeded generator (mulberry32). */
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /**
   * A note of blocks as people write them, with links, tags and tasks in every
   * kind of block, and links where the parser reads none: in code spans (one
   * backtick and two), in fenced code, behind a backtick that closes nothing.
   */
  const mixedNote = (seed: number, lines: number): string => {
    const r = random(seed);
    const pick = <T,>(items: T[]) => items[Math.floor(r() * items.length)];
    const word = () => pick(["alpha", "beta", "gamma", "delta", "notes", "plan", "Meeting"]);
    const link = () => pick([`[[${word()} ${Math.floor(r() * 9)}]]`, `[[${word()}|alias]]`, `![[${word()}.png]]`, `[text](${word()}.md)`, `[t](<${word()} 2.md>)`, `[[${word()}#Heading]]`]);
    const line = () => pick([
      () => `${word()} ${link()} and ${word()} #${word()} here`,
      () => `- [ ] task ${link()} #todo`,
      () => `- [x] done ${word()} ${link()}`,
      () => `  - item ${link()} *em* \`[[NotALink]]\``,
      () => `> quoted ${link()} and \`\`[[Not]] \` here\`\``,
      () => `1. ordered ${link()} with a lone \` tick ${link()}`,
      () => `## Heading ${word()}`,
      () => `| a | ${link()} |`,
      () => `${word()} ${word()} ${word()} **bold** ${link()}`,
    ])();
    const blocks: string[] = [];
    for (let made = 0; made < lines; ) {
      const kind = r();
      if (kind < 0.05) {
        blocks.push(`\`\`\`\n[[InCode]] [x](InCode.md)\n\`\`\``);
        made += 3;
      } else if (kind < 0.1) {
        // In a table a `|` ends the cell, an alias's as well (written `\|` there): its links have none.
        blocks.push(`| h | i |\n|---|---|\n${Array.from({ length: 3 }, () => `| [[${word()} 1]] [t](${word()}.md) | ${word()} |`).join("\n")}`);
        made += 5;
      } else {
        const size = 1 + Math.floor(r() * (r() < 0.05 ? 3_000 : 30));
        blocks.push(Array.from({ length: size }, line).join("\n"));
        made += size;
      }
    }
    return `---\ntitle: Mixed\n---\n\n# Mixed\n\n${blocks.join(r() < 0.5 ? "\n\n" : "\n\n\n")}\n`;
  };
  const unboundedIndex = (text: string) => {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]).use(remarkWikiLinks).use(remarkObsidianPreserve);
    return extractLinksAndTags(markdownAstSchema.parse(processor.runSync(processor.parse(text))));
  };
  const listed = (data: ReturnType<typeof extractLinksAndTags>) => ({
    links: data.links.map((link) => `${link.line} ${link.type} ${link.rawTarget} ${link.alias ?? ""}`).sort(),
    tags: data.tags.map((tag) => `${tag.source} ${tag.name}`).sort(),
  });

  it("lists the links, tags and tasks of random notes over the budget as a parse without the budget does, each link once", () => {
    for (const seed of [11, 23, 37, 51]) {
      const text = mixedNote(seed, 12_000);
      const ranges = overBudgetInlineRanges(text);
      expect(ranges.some((range) => range.block), `seed ${seed}`).toBe(true);
      expect(readAsTextParts(text).unread, `seed ${seed}`).toEqual([]);
      const index = listed(extractLinksAndTags(parseMarkdownAst(text, { preserveObsidianSyntax: true }), text));
      const whole = listed(unboundedIndex(text));
      expect(index.links.length, `seed ${seed}: links`).toBe(whole.links.length);
      expect(index.links, `seed ${seed}: links`).toEqual(whole.links);
      expect(index.tags, `seed ${seed}: tags`).toEqual(whole.tags);
    }
  }, 300 * SECONDS);

  it("leaves the index of random notes under the budget as a parse without the budget reads it", () => {
    for (const seed of [3, 5, 8, 13, 21, 34]) {
      const text = mixedNote(seed, 1_500);
      expect(overBudgetInlineRanges(text), `seed ${seed}`).toEqual([]);
      expect(listed(extractLinksAndTags(parseMarkdownAst(text, { preserveObsidianSyntax: true }), text)), `seed ${seed}`).toEqual(listed(unboundedIndex(text)));
    }
  }, 120 * SECONDS);

  it("keeps every heading of a note whose other blocks bring it within its budget, and reads 30 000 headings under 128 MB", () => {
    const list = Array.from({ length: 20_000 }, (_, i) => `- item ${i} [[Note ${i}]]`).join("\n");
    const headings = Array.from({ length: 2_000 }, (_, i) => `## Heading ${i}`);
    const text = `${headings.slice(0, 1_000).join("\n\n")}\n\n${list}\n\n${headings.slice(1_000).join("\n\n")}\n`;
    expect(overBudgetInlineRanges(text).every((range) => !text.slice(range.from, range.to).includes("## Heading"))).toBe(true);
    expect(analyzeNoteSource(text).headings).toHaveLength(2_000);
    const many = `"" + Array.from({ length: 30000 }, (_, i) => "## Heading " + i).join("\\n") + "\\n"`;
    for (const parse of ["parseMarkdownTree(text)", "parseMarkdownAst(text, { preserveObsidianSyntax: true })"]) {
      const run = underHeap(128, many, `P.${parse}; console.log("ok");`);
      expect(run.stdout.trim(), `${parse}: ${run.stderr.slice(-200)}`).toBe("ok");
    }
  }, 300 * SECONDS);

  it("does not let a backtick in a link's destination hide a wiki link behind it (F46)", () => {
    const row = (i: number) => `- item ${i} [a](x\`y.md) [[Note ${i}]] and [b](z.md)`;
    const text = `# T\n\n${Array.from({ length: 10_000 }, (_, i) => row(i)).join("\n")}\n`;
    expect(overBudgetInlineRanges(text).some((range) => range.block)).toBe(true);
    expect(readAsTextParts(text).unread).toEqual([]);
    const { links } = extractLinksAndTags(parseMarkdownAst(text, { preserveObsidianSyntax: true }), text);
    expect(links.filter((link) => link.type === "wikilink")).toHaveLength(10_000);
    expect(links.filter((link) => link.type === "markdown-link")).toHaveLength(20_000);
    expect(renameNoteLinks(text, new Map([["Note 5", "Five"]])).renamed).toBe(1);
  });

  it("weighs the comment the reading view writes in front of a link behind a `]`, as the table's weight does", () => {
    // `readerWikiLinkLead`: behind a `]` an empty comment stands in front of a wiki link in the reading view's text.
    const most = (line: (i: number) => string) => {
      const over = (n: number) => overBudgetInlineRanges(`# T\n\n${Array.from({ length: n }, (_, i) => line(i)).join("\n")}\n`).length > 0;
      let lo = 0;
      let hi = 1024;
      while (!over(hi)) {
        lo = hi;
        hi *= 2;
      }
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (over(mid)) hi = mid;
        else lo = mid;
      }
      return lo;
    };
    // The two lines differ in the comment alone: `a][[a]]` is a character shorter than `a] [[a]]`, with the same
    // words and runs of syntax, and seven characters heavier in the reading view.
    const behind = most((i) => `- item ${i} a][[a]] and more words here`);
    const beside = most((i) => `- item ${i} a] [[a]] and more words here`);
    expect(behind).toBeLessThan(beside);
  });

  it("joins a link of a paragraph read as written to that paragraph, in a list item in a quote (the hunt of seed 956860)", () => {
    // The paragraph keeps its markers, so its stretch begins in front of `- 2. >`: the link joined the list item
    // there, and the index's check of the tree threw.
    const text = `# T\n\ntext\n- 2. > [[Kept]] ${"]".repeat(120_000)} [[Inside]]\n\nafter [[End]]\n`;
    expect(overBudgetInlineRanges(text).length).toBeGreaterThan(0);
    const { links } = extractLinksAndTags(parseMarkdownAst(text, { preserveObsidianSyntax: true }), text);
    // A paragraph over the inline budget is not read for links, as before the note's budget; it is named as unread.
    expect(links.map((link) => link.target)).toEqual(["End"]);
    expect(readAsTextParts(text).unread).toHaveLength(1);
  });

  it("never reads a note of one table the table budget reads as a table as text (the hunt of seed 956860)", () => {
    for (const [name, rows] of [["gen:956860:11", 961], ["gen:956860:30", 58], ["gen:956860:100", 1796]] as const) {
      const text = shapeTable(name, rows);
      const ranges = overBudgetInlineRanges(text);
      expect(ranges.some((range) => range.block), name).toBe(false);
      expect(parseMarkdownTree(text).children!.some(function table(node: MarkdownTreeNode): boolean { return node.type === "table" || (node.children ?? []).some(table); }), name).toBe(true);
    }
  });

  it("reads every calibrated form of each shell formatted up to no more than main reads under its heap, and no earlier than calibrated", () => {
    expect.hasAssertions();
    // `noteBudgetShells.json`: per shell, main's limit under the shell's heap and readers per form, and the ratio of the
    // calibration (2026-11-25). Every ratio keeps 1.13 or more (main's limit is known to some 5 to 8 %). At main's limit
    // the shell's budget reads a block as text (the safe side: what it keeps formatted, main reads under the heap too); at
    // main's limit over the calibrated ratio plus 5 % it does not yet (a change of the weights that reads a form as text
    // earlier shows here). `perf:notes -- --check` reads the notes at the thresholds themselves.
    const { shells } = JSON.parse(readFileSync(new URL("../scripts/perf/noteBudgetShells.json", import.meta.url), "utf8")) as { shells: Record<string, { factor: number; parses: string[]; forms: Record<string, { main: number; ratio: number; lowerBound?: boolean }> }> };
    const wrap = (body: string) => `---\ntitle: T\n---\n\n# Title\n\n${body}\n`;
    const asText = (form: string, n: number) => overBudgetInlineRanges(wrap(NOTE_FORMS[form](n))).some((range) => range.block);
    expect(Object.keys(shells.phone.forms).length).toBeGreaterThanOrEqual(42);
    try {
      for (const [shell, { factor, parses, forms }] of Object.entries(shells)) {
        // The editor's limit is a named one: its parse is the whole note, whatever the budget.
        if (parses.includes("editor")) continue;
        setNoteBudget(NOTE_BUDGET * factor);
        for (const [form, { main, ratio, lowerBound }] of Object.entries(forms)) {
          expect(ratio, `${shell} ${form}: the safe side`).toBeGreaterThanOrEqual(1.13);
          expect(asText(form, main), `${shell} ${form}: formatted at main's limit ${main}`).toBe(true);
          // A form measured on its safe side only holds a lower bound of main's limit, no ratio of the early side.
          if (lowerBound) continue;
          const earliest = Math.floor(main / (ratio * 1.05));
          expect(asText(form, earliest), `${shell} ${form}: text at ${earliest}, below the calibrated ratio ${ratio}`).toBe(false);
        }
      }
    } finally {
      setNoteBudget(NOTE_BUDGET);
    }
  }, 600 * SECONDS);

  it("reads a table twelve and twenty-four quotes deep at its threshold under 128 MB, and one row more as text", () => {
    expect.hasAssertions();
    // A table deep in quotes once ran the parse out of memory (each level of every row is a marker of its own).
    for (const depth of [12, 24]) {
      const q = "> ".repeat(depth);
      const make = (n: number) => `# T\n\n${q}| a | b |\n${q}|---|---|\n` + Array.from({ length: n }, (_, i) => `${q}| ${i} | [[n${i}]] |`).join("\n") + "\n";
      let lo = 1;
      let hi = 20_000;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (overBudgetInlineRanges(make(mid)).length > 0) hi = mid;
        else lo = mid;
      }
      expect(overBudgetInlineRanges(make(hi)).some((range) => range.table), `depth ${depth}`).toBe(true);
      const text = `"# T\\n\\n" + Array.from({ length: ${lo} }, (_, i) => "${q}| " + i + " | [[n" + i + "]] |").join("\\n").replace(/^/, "${q}| a | b |\\n${q}|---|---|\\n") + "\\n"`;
      const body = `const S = await import(${JSON.stringify(new URL("../src/ast-scanner.ts", import.meta.url).pathname)}); const N = await import(${JSON.stringify(new URL("../src/noteSource.ts", import.meta.url).pathname)}); const { links } = S.extractLinksAndTags(P.parseMarkdownAst(text, { preserveObsidianSyntax: true }), text); N.analyzeNoteSource(text); console.log(links.length === ${lo} ? "ok" : "links " + links.length);`;
      const run = underHeap(128, text, body);
      expect(run.stdout.trim(), `depth ${depth}: ${run.stderr.slice(-200)}`).toBe("ok");
    }
  }, 300 * SECONDS);

  it("lists every link of 100 000 items of links and of embeds under 128 MB, and names a paragraph of them unread", () => {
    expect.hasAssertions();
    // Twenty-five times the threshold of the forms of links: the blocks read as text are read in pieces by the parser
    // itself (`forEachReadPiece`), each let go before the next, all of them — every link is listed, nothing is
    // unread. A picture (`![alt](…)`) is no link to the index, as the parser reads it. One paragraph of such lines is
    // over the inline budget: it is unread, as on `main`, and the index runs no more out of 128 MB than for the lists.
    const notes = [
      [`"# N\\n\\n" + Array.from({ length: 100000 }, (_, i) => "- see [[n" + i + "]] and [t](u" + i + ")").join("\\n") + "\\n"`, 2],
      [`"# N\\n\\n" + Array.from({ length: 100000 }, (_, i) => "- ![[image " + i + ".png]] ![alt](pic" + i + ".jpg)").join("\\n") + "\\n"`, 1],
      [`"# N\\n\\n" + Array.from({ length: 100000 }, (_, i) => "see [[n" + i + "]] and [t](u" + i + ")").join("\\n") + "\\n"`, 0],
    ] as const;
    for (const [text, perLine] of notes) {
      const body = `const S = await import(${JSON.stringify(new URL("../src/ast-scanner.ts", import.meta.url).pathname)}); const B = await import(${JSON.stringify(new URL("../src/inlineParseBudget.ts", import.meta.url).pathname)}); const parts = B.readAsTextParts(text); let lines = 0; for (const p of parts.pieces) lines += text.slice(p.from, p.to).split("\\n").filter((l) => l.startsWith("- ")).length; const { links } = S.extractLinksAndTags(P.parseMarkdownAst(text, { preserveObsidianSyntax: true }), text); console.log((${perLine} === 0 ? links.length === 0 && parts.unread.length > 0 : links.length === ${perLine} * 100000 && lines === 100000 && parts.unread.length === 0) ? "ok" : "links " + links.length + " lines " + lines + " unread " + parts.unread.length);`;
      const run = underHeap(128, text, body);
      expect(run.stdout.trim(), `${text.slice(0, 60)}: ${run.stderr.slice(-200)}`).toBe("ok");
    }
  }, 600 * SECONDS);
});

