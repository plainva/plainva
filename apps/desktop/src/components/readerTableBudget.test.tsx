import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { boundReaderMath, MATH_BUDGET, mathWeight, overBudgetInlineRanges, prepareReaderSource, READER_READING, remarkReaderMathBudget } from "@plainva/core";
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
 * them, less a tenth. Formulas are not weighed here: KaTeX holds far more
 * while it lays one out than the elements it leaves, and the reading view
 * bounds them on their own before KaTeX (`readerMathBudget.ts`, held below).
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

type MdNode = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: MdNode[] };

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

  it("lays out every formula under the budget, and leaves every one over it as its source, whatever the parser read (random notes)", async () => {
    // Ten reviews (2026-11-16/17) found formulas weighed wrong before the
    // parse: a price, a `$` in code, a reference definition (`[x][a$]` with
    // `[a$]: u` below is a link, alone a formula), a footnote, a padded
    // `$ x $` remark-math reads once it is loaded, a quote. The reading view
    // weighs the formulas of the tree it parsed, between remark-math and
    // KaTeX: whatever the parser makes a formula is one, and nothing else.
    const math = await loadReaderMath();
    const pieces = ["$x^2$", "$\\frac{a}{b}$", "$$y$$", "$ z $", "$5", "$12.50", "`$HOME`", "`a $b$ c`", "<i t='$'>", "[a]($)", "<http://a.b/$>", "[x][a$]", "[^a$]", "\\$", "word", "two words", "[[Note]]", "*em*", "|", " "];
    let seed = 20261117;
    const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const failures: string[] = [];
    let over = 0;
    for (let k = 0; k < 40; k++) {
      // Notes of a table, a quote and a paragraph, with the definitions below; every fourth one with a long formula
      // in each row, so that a share of them is over the budget.
      const long = k % 4 === 3 ? ` $${"\\frac{a}{b}".repeat(120)}$` : "";
      const line = () => Array.from({ length: 2 + Math.floor(random() * 8) }, () => pieces[Math.floor(random() * pieces.length)]).join("");
      const rows = Array.from({ length: 5 + Math.floor(random() * 25) }, () => `| ${line()}${long} | ${line()} |`);
      const original = `# N $x^2$\n\n| h | h |\n|---|---|\n${rows.join("\n")}\n\n> ${line()}\n> ${line()}${long}\n\n${line()}\n\n[a$]: http://u\n\n[^a$]: a note ${line()}\n`;
      const source = prepareReaderSource(original).text;
      // The formulas as remark-math reads them, in the order of the note, without a budget.
      const weights: number[] = [];
      const collect = () => (tree: MdNode) => {
        const walk = (node: MdNode) => {
          if (node.type === "inlineMath" || node.type === "math") weights.push(mathWeight((node.position?.end.offset ?? 0) - (node.position?.start.offset ?? 0)));
          for (const child of node.children ?? []) walk(child);
        };
        walk(tree);
      };
      render(source, [...READER_REMARK_PLUGINS, math.remark, collect] as Plugins);
      let fits = 0;
      for (let sum = 0; fits < weights.length && sum + weights[fits] <= MATH_BUDGET; fits++) sum += weights[fits];
      if (fits < weights.length) over++;
      // The reading view as it runs: remark-math, the budget, KaTeX. Behind the budget the formulas still formulas are
      // the first that fit; what of them reaches KaTeX (a footnote nothing refers to is not shown) it lays out, or shows
      // as an error it could not lay out: either way it took it.
      let kept = 0;
      const keptAfter = () => (tree: MdNode) => {
        const walk = (node: MdNode) => {
          if (node.type === "inlineMath" || node.type === "math") kept++;
          for (const child of node.children ?? []) walk(child);
        };
        walk(tree);
      };
      let reached = 0;
      type HNode = { type: string; properties?: { className?: unknown }; children?: HNode[] };
      const reachedKatex = () => (tree: HNode) => {
        const walk = (node: HNode) => {
          const names = node.properties?.className;
          if (node.type === "element" && Array.isArray(names) && (names.includes("math-inline") || names.includes("math-display"))) reached++;
          for (const child of node.children ?? []) walk(child);
        };
        walk(tree);
      };
      const html = render(source, [...READER_REMARK_PLUGINS, math.remark, remarkReaderMathBudget, keptAfter] as Plugins, [reachedKatex, math.rehype] as RehypePlugins);
      const laidOut = (html.match(/class="katex(?:-error)?"/g) ?? []).length;
      if (kept !== fits) failures.push(`note ${k}: ${weights.length} formulas, ${fits} within the budget, ${kept} kept as formulas`);
      if (laidOut !== reached || reached > fits) failures.push(`note ${k}: ${reached} formulas reached KaTeX (${fits} within the budget), it laid out ${laidOut}`);
      if (!html.includes("<table")) failures.push(`note ${k}: no table`);
    }
    expect(failures).toEqual([]);
    expect(over).toBeGreaterThan(3);
  }, 300_000);

  it("leaves every formula past the budget as its source, in the order of the note", () => {
    // `boundReaderMath` on a tree as remark-math makes it: the first formulas within the budget stay formulas, the rest become code with their source.
    const formula = "$\\frac{a}{b}$";
    const per = mathWeight(formula.length);
    const fit = Math.floor(MATH_BUDGET / per);
    const text = Array.from({ length: fit + 3 }, () => formula).join(" ");
    const children = Array.from({ length: fit + 3 }, (_, i) => ({ type: "inlineMath", value: "\\frac{a}{b}", position: { start: { offset: i * (formula.length + 1) }, end: { offset: i * (formula.length + 1) + formula.length } } }));
    const tree = { type: "root", children: [{ type: "paragraph", children }] };
    expect(boundReaderMath(tree as never, text)).toBe(3);
    const after = (tree.children[0].children as Array<{ type: string; value: string }>);
    expect(after.slice(0, fit).every((node) => node.type === "inlineMath")).toBe(true);
    expect(after.slice(fit)).toEqual(Array.from({ length: 3 }, (_, i) => ({ type: "inlineCode", value: formula, position: children[fit + i].position })));
  });

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
