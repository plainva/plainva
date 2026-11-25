// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { extractLinksAndTags, overBudgetInlineRanges, parseMarkdownAst, prepareReaderSource, remarkFormulasYieldToLinks } from "@plainva/core";
import { boundReaderMarkdown } from "@plainva/ui";
import { remarkStripHtmlComments } from "../components/markdownReaderModel";

/**
 * A block the note's budget reads as text (L14) and a formula that gives way
 * to a wiki link (Fehlerliste 0.9.0, B4) in one note, through the reading
 * view as `MarkdownReader` takes them: the stretch restored first, then the
 * formulas giving way, then the parse's own. Inside the stretch remark-math
 * sees stand-ins: no formula is made there and none is freed, so nothing is
 * written twice; outside it the formula gives way as on main. The index finds
 * each link once, from the pieces of the stretch (`forEachReadPiece`).
 */
const list = Array.from({ length: 20_000 }, (_, i) => (i === 500 ? "- item $x [[Inside]] y$ and $$[[Block]]$$" : `- item ${i} [[Note ${i}]]`)).join("\n");
const NOTE = `# T\n\nOutside $z [[Freed]] w$ and $a+b$.\n\n${list}\n\n## End\n`;

function render(content: string): HTMLElement {
  const source = prepareReaderSource(content, { tables: true });
  const bounded = boundReaderMarkdown(source.text, { original: content, source });
  const markup = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[bounded.remarkRestore, remarkFormulasYieldToLinks(source), remarkGfm, remarkStripHtmlComments, remarkMath]} urlTransform={(url) => url}>{bounded.text}</ReactMarkdown>,
  );
  const container = document.createElement("div");
  container.innerHTML = markup;
  return container;
}

describe("a block read as text beside a formula that gives way to a link (L14 and B4)", () => {
  it("the reading view frees the formula outside the block once, and reads the block as it is written", () => {
    expect(overBudgetInlineRanges(NOTE).some((range) => range.block)).toBe(true);
    const el = render(NOTE);
    const targets = [...el.querySelectorAll("a[href^='wiki']")].map((a) => a.getAttribute("href"));
    // The formula outside the block gives way to its link, once; the plain formula beside it stays a formula.
    expect(targets.filter((href) => href?.includes("Freed"))).toHaveLength(1);
    expect([...el.querySelectorAll(".language-math")].map((m) => m.textContent)).toEqual(["a+b"]);
    // The block is its source: no link, no formula, every character once.
    expect(targets.some((href) => href?.includes("Inside") || href?.includes("Block") || href?.includes("Note"))).toBe(false);
    const text = el.textContent ?? "";
    expect(text.split("$x [[Inside]] y$ and $$[[Block]]$$").length - 1).toBe(1);
    expect(text.split("[[Note 19999]]").length - 1).toBe(1);
  }, 120_000);

  it("the index lists each link once, the ones in the block's formulas too", () => {
    const { links } = extractLinksAndTags(parseMarkdownAst(NOTE, { preserveObsidianSyntax: true }), NOTE);
    const count = (target: string) => links.filter((link) => link.target === target).length;
    expect([count("Freed"), count("Inside"), count("Block"), count("Note 7")]).toEqual([1, 1, 1, 1]);
    expect(links.filter((link) => link.type === "wikilink")).toHaveLength(1 + 2 + 19_999);
  }, 120_000);
});
