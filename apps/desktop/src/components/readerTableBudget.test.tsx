import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { overBudgetInlineRanges, READER_READING } from "@plainva/core";
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
 * them, less a tenth. Nodes are not memory for formulas: KaTeX holds far more
 * while it lays one out than the elements it leaves, so the core's
 * calibration measures the reading view's heap with `remark-math` and KaTeX
 * (`TABLE_MATH_WEIGHT`), and this test holds the nodes. What React and the DOM
 * hold beyond the page is not measured here.
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
  it("weighs each table at least as much as the reading view makes of it, with tags, highlights and formulas (the gauge)", async () => {
    const math = await loadReaderMath();
    const full = (text: string) => nodesOf(render(text, [...READER_REMARK_PLUGINS, math.remark] as Plugins, [math.rehype] as RehypePlugins));
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
      formulas: () => `| ${"$a$ ".repeat(100)}|`,
      fractions: () => `| ${"$\\frac{a}{b}$ ".repeat(40)}|`,
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
});
