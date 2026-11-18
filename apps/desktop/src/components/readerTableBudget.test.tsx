import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { overBudgetInlineRanges, prepareReaderSource, READER_READING } from "@plainva/core";
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
 * them, less a tenth. Formulas are not weighed here: the reading view lays out
 * every formula of a note as `main` does (held below); how much memory a whole
 * note may take in the desktop's reading view is L14's to decide.
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

  it("lays out every formula of a note whose tables are under the budget, in every shape (as main does)", async () => {
    // The reading view exists on the desktop only, and its formulas are not
    // bounded (coordination, 2026-11-18): rehype-katex runs as it did, over
    // every formula remark-math reads, wherever it stands.
    const math = await loadReaderMath();
    const many = (n: number, f: (i: number) => string, sep = "\n\n") => Array.from({ length: n }, (_, i) => f(i)).join(sep);
    const shapes: Record<string, { text: string; formulas: number }> = {
      inline: { text: many(300, (i) => `Step ${i}: $x_{${i}} + \\frac{a}{b} = \\sqrt{c}$ and on.`), formulas: 300 },
      display: { text: many(40, (i) => `$$\n${"\\frac{a}{b} + ".repeat(20)}${i}\n$$`), formulas: 40 },
      aligned: { text: many(30, () => `$$\\begin{aligned} a &= b + c \\\\ d &= e + f \\end{aligned}$$`), formulas: 30 },
      cases: { text: many(30, () => `$$f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{else} \\end{cases}$$`), formulas: 30 },
      matrix: { text: many(20, () => `$$\\begin{pmatrix} ${"a & b \\\\ ".repeat(10)}c & d \\end{pmatrix}$$`), formulas: 20 },
      list: { text: many(200, (i) => `- item ${i} $y^{${i}}$`, "\n"), formulas: 200 },
      quote: { text: many(200, (i) => `> line ${i} $z_${i}$`, "\n>\n"), formulas: 200 },
      callout: { text: "> [!note] Formulas\n" + many(200, (i) => `> line ${i} $w_${i}$`, "\n>\n"), formulas: 200 },
      besideTable: { text: `| a | b |\n|---|---|\n${many(100, (i) => `| ${i} | [[n${i}]] |`, "\n")}\n\n${many(200, (i) => `After $v_${i}$.`)}`, formulas: 200 },
      formulaCells: { text: `| a | b |\n|---|---|\n${many(300, (i) => `| $\\frac{${i}}{2}$ | $u^${i}$ |`, "\n")}\n`, formulas: 600 },
    };
    // The reading view hands KaTeX's own plugin to its page, with nothing in between.
    expect(readFileSync(new URL("./MarkdownReader.tsx", import.meta.url), "utf8")).toContain("...(mathPlugins ? [mathPlugins.rehype as never] : [])");
    const failures: string[] = [];
    for (const [name, { text, formulas }] of Object.entries(shapes)) {
      const source = prepareReaderSource(text);
      const bounded = boundReaderMarkdown(source.text, { original: text, source });
      expect(bounded.ranges, `${name}: its tables are under the budget`).toEqual([]);
      const html = render(bounded.text, [bounded.remarkRestore, ...READER_REMARK_PLUGINS, math.remark] as Plugins, [math.rehype] as RehypePlugins);
      const laidOut = (html.match(/class="katex"/g) ?? []).length;
      if (laidOut !== formulas) failures.push(`${name}: ${laidOut} of ${formulas} laid out`);
    }
    expect(failures).toEqual([]);
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
