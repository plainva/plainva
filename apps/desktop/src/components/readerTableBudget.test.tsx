import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MATH_WORST_NODES_PER_CHAR, mathNodeCount, overBudgetInlineRanges, prepareReaderSource, READER_NOTICE_TAG, READER_READING, rehypeReaderMath, type MathHastNode, type MathLayout } from "@plainva/core";
import { boundReaderMarkdown } from "@plainva/ui";
import { SHAPES, shapeTable } from "../../../../packages/core/scripts/perf/table-budget";
import { loadReaderMath, READER_REMARK_PLUGINS } from "./markdownReaderModel";

/**
 * The table budget held against the reading view as it runs (L13): the
 * plugins of `MarkdownReader.tsx` (`READER_REMARK_PLUGINS`, and KaTeX for a
 * note with math) make nodes of their own — a tag pill, a highlight, the
 * dozens of elements of a formula — that the parsers of the core never see.
 * The core calibrates the budget under a capped heap with the reading view's
 * parser and its HTML tree; what the plugins add is held here, as nodes of
 * the rendered page: no table may make more nodes per weight with the
 * reading view's plugins than the densest calibrated shape makes without
 * them, less a tenth. Formulas are not weighed here: the reading view bounds
 * them on their own, by what KaTeX made of them (`readerMathBudget.ts`, held
 * below).
 * What React and the DOM hold beyond the page is not measured here.
 */

type Plugins = NonNullable<React.ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>;
type RehypePlugins = NonNullable<React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;

/** The nodes of a rendered page: its elements (each opening tag) and its texts (each stretch between two tags). */
function nodesOf(html: string): number {
  return (html.match(/<[a-zA-Z]/g)?.length ?? 0) + (html.match(/>[^<]+</g)?.length ?? 0);
}

/** What the scan weighs a text's tables at, for the reading view. */
function weightOf(text: string): number {
  let weight = 0;
  overBudgetInlineRanges(text, { table: (_first, _last, _exact, cost) => (weight += cost) }, READER_READING);
  return weight;
}

const render = (text: string, remark: Plugins, rehype: RehypePlugins = []) =>
  renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={remark} rehypePlugins={rehype}>
      {text}
    </ReactMarkdown>,
  );

describe("the table budget against the reading view's own plugins", () => {
  it("weighs each table at least as much as the reading view makes of it, with tags and highlights (the gauge)", async () => {
    const full = (text: string) => nodesOf(render(text, [...READER_REMARK_PLUGINS] as Plugins));
    const plain = (text: string) => nodesOf(render(text, [remarkGfm]));
    // The bound: the densest calibrated shape, rendered as the core measures the reading view (GFM alone).
    let bound = Infinity;
    for (const name of Object.keys(SHAPES)) {
      const text = shapeTable(name, 20);
      const weight = weightOf(text);
      if (weight > 0) bound = Math.min(bound, (0.9 * weight) / plain(text));
    }
    const forms: Record<string, (i: number) => string> = {
      tags: () => `| ${"#a ".repeat(100)}|`,
      nestedTags: () => `| ${"#a/b ".repeat(100)}|`,
      highlights: () => `| ${"==a== ".repeat(100)}|`,
      tagsInHighlights: () => `| ${"==#a== ".repeat(80)}|`,
      mixed: (i) => `| #t${i} ==m== $x$ | [[n${i}]] | a@b.cc #u $y^2$ |`,
    };
    const failures: string[] = [];
    const hold = (name: string, text: string) => {
      const weight = weightOf(text);
      const nodes = full(text);
      if (weight < bound * nodes) failures.push(`${name}: weight ${weight} < ${bound.toFixed(2)} × ${nodes} nodes (needs ${Math.ceil(bound * nodes - weight)} more)`);
    };
    for (const [name, row] of Object.entries(forms)) hold(name, `| h | h | h |\n|---|---|---|\n${Array.from({ length: 20 }, (_, i) => row(i)).join("\n")}\n`);
    // And every calibrated shape through the reading view's own plugins.
    for (const name of Object.keys(SHAPES)) hold(name, shapeTable(name, 20));
    expect(failures).toEqual([]);
  }, 300_000);

  it("lays formulas out in the order of the note until what KaTeX made reaches the budget, whatever the parser read (random notes)", async () => {
    // Ten reviews (2026-11-16/17) found formulas weighed wrong before the
    // parse: a price, a `$` in code, a reference definition (`[x][a$]` with
    // `[a$]: u` below is a link, alone a formula), a footnote, a padded
    // `$ x $` remark-math reads once it is loaded, a quote. The reading view
    // charges the formulas KaTeX really laid out, by what it made of them:
    // whatever the parser makes a formula is one, and nothing else.
    const math = await loadReaderMath();
    const katex = math.rehype as () => MathLayout;
    const pieces = ["$x^2$", "$\\frac{a}{b}$", "$$y$$", "$ z $", "$5", "$12.50", "`$HOME`", "`a $b$ c`", "<i t='$'>", "[a]($)", "<http://a.b/$>", "[x][a$]", "[^a$]", "\\$", "word", "two words", "[[Note]]", "*em*", "|", " "];
    let seed = 20261117;
    const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const failures: string[] = [];
    let over = 0;
    // A small budget, so that most notes are over it.
    const budget = 1_500;
    const isFormula = (node: MathHastNode) => {
      const names = node.properties?.className;
      if (Array.isArray(names) && names.includes("math-inline")) return true;
      return node.tagName === "pre" && (node.children ?? []).some((child) => Array.isArray(child.properties?.className) && (child.properties!.className as unknown[]).includes("language-math"));
    };
    for (let k = 0; k < 40; k++) {
      const long = k % 4 === 3 ? ` $${"\\frac{a}{b}".repeat(20)}$` : "";
      const line = () => Array.from({ length: 2 + Math.floor(random() * 8) }, () => pieces[Math.floor(random() * pieces.length)]).join("");
      const rows = Array.from({ length: 5 + Math.floor(random() * 25) }, () => `| ${line()}${long} | ${line()} |`);
      const original = `# N $x^2$\n\n| h | h |\n|---|---|\n${rows.join("\n")}\n\n> ${line()}\n> ${line()}${long}\n\n${line()}\n\n[a$]: http://u\n\n[^a$]: a note ${line()}\n`;
      const source = prepareReaderSource(original).text;
      // What KaTeX makes of each formula that reaches it, in the order of the note, without a budget.
      const made: Array<{ nodes: number; length: number }> = [];
      const textOf = (node: MathHastNode): string => (node.type === "text" ? node.value ?? "" : (node.children ?? []).map(textOf).join(""));
      const each = () => (tree: MathHastNode, file: unknown) => {
        const walk = (node: MathHastNode) => {
          for (const child of node.children ?? []) {
            if (!isFormula(child)) {
              walk(child);
              continue;
            }
            const alone: MathHastNode = { type: "root", children: [structuredClone(child)] };
            katex()(alone, file);
            made.push({ nodes: mathNodeCount(alone.children ?? []), length: textOf(child).length });
          }
        };
        walk(tree);
      };
      render(source, [...READER_REMARK_PLUGINS, math.remark] as Plugins, [each] as RehypePlugins);
      // In the order of the note: a formula whose dearest case would not fit into what is left is passed over, the first
      // whose layout crosses the budget ends it.
      let fits = 0;
      for (let i = 0, used = 0; i < made.length; i++) {
        if (made[i].length * MATH_WORST_NODES_PER_CHAR > budget - used) continue;
        if (used + made[i].nodes > budget) break;
        used += made[i].nodes;
        fits++;
      }
      if (fits < made.length) over++;
      // The reading view as it runs: remark-math, KaTeX within the budget, the notice.
      const html = render(source, [...READER_REMARK_PLUGINS, math.remark] as Plugins, [() => rehypeReaderMath({ layout: katex(), budget, notice: "NOTICE" })] as RehypePlugins);
      const laidOut = (html.match(/class="katex(?:-error)?"/g) ?? []).length;
      if (laidOut !== fits) failures.push(`note ${k}: ${made.length} formulas, ${fits} fit the budget, KaTeX laid out ${laidOut}`);
      const notice = html.includes(`<${READER_NOTICE_TAG}>NOTICE</${READER_NOTICE_TAG}>`);
      if ((laidOut < made.length) !== notice) failures.push(`note ${k}: ${laidOut} of ${made.length} laid out, the notice ${notice ? "stands" : "is missing"}`);
      if (!html.includes("<table")) failures.push(`note ${k}: no table`);
    }
    expect(failures).toEqual([]);
    expect(over).toBeGreaterThan(10);
  }, 300_000);

  it("decides as the index decides: a table the note's parsers read as written the reading view reads as written, and the other way round", () => {
    // The reading view shows `[[x]]` as `[x](wiki://x)` (`prepareReaderSource`):
    // a link and a literal more, so that it read a table of a word and a wiki
    // link as text from 2 390 rows on while the index read it as a table up to
    // 2 815. A row with a wiki link weighs, part by part, at least what the
    // reading view writes for it (`readerWikiLink`), and the reading view takes
    // the ranges the note's parsers set in the original as well.
    const row = (i: number) => `| word ${i} | [[note ${i}]] |`;
    const note = (rows: number) => `| a | b |\n|---|---|\n${Array.from({ length: rows }, (_, i) => row(i)).join("\n")}\n`;
    let lo = 1;
    let hi = 2;
    const indexBounds = (rows: number) => overBudgetInlineRanges(note(rows)).length > 0;
    while (!indexBounds(hi)) {
      lo = hi;
      hi *= 2;
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (indexBounds(mid)) hi = mid;
      else lo = mid;
    }
    for (const rows of [lo - 50, lo, hi, hi + 50]) {
      const original = note(rows);
      const source = prepareReaderSource(original);
      const reader = boundReaderMarkdown(source.text, { original, source }).ranges.length > 0;
      expect(reader, `${rows} rows`).toBe(indexBounds(rows));
    }
  });
});
