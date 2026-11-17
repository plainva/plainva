// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { prepareReaderSource } from "@plainva/core";
import { markdownToPlainText } from "@plainva/ui";
import { remarkStripHtmlComments } from "../components/markdownReaderModel";
import FROZEN_MAIN from "./readerFormulas.main.json";

/**
 * Edges of the reading view (Fehlerliste 0.9.0, B3 to B5), through the text
 * the reader prepares and the renderer with its formulas, as `MarkdownReader`
 * takes them.
 */
function html(content: string, formulas: boolean): string {
  const source = prepareReaderSource(content, formulas ? { formulas: remarkMath, tables: true } : { tables: true });
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkStripHtmlComments, remarkMath]} urlTransform={(url) => url}>{source.text}</ReactMarkdown>,
  );
}

function read(content: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html(content, true);
  return container;
}

const links = (el: HTMLElement) => [...el.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
const formulas = (el: HTMLElement) => [...el.querySelectorAll(".language-math")].map((m) => m.textContent);

describe("the reading view of a wiki link", () => {
  it("behind a `]` is the link, not the label of a reference", () => {
    const el = read("[x][[a]]\n\n[a]: https://e.com");
    expect(links(el)).toEqual([["a", "wiki://a"]]);
    expect(el.textContent).toBe("[x]a");
  });

  it("with an alias over a delimiter row stays in a paragraph, as in the note", () => {
    const el = read("[[a|b]] | c\n|---|---|\n");
    expect(el.querySelector("table")).toBeNull();
    expect(links(el)).toEqual([["b", "wiki://a"]]);
    expect(el.textContent).toBe("b | c\n|---|---|");
    // A table the note has stays one.
    expect(read("| [[a\\|b]] | c |\n|---|---|\n").querySelector("table th a")?.getAttribute("href")).toBe("wiki://a");
    // The plain text of a card (the phone's embeds) reads no sign of it.
    expect(markdownToPlainText(prepareReaderSource("[[a|b]] | c\n|---|---|\nnext").text)).toBe(markdownToPlainText("b | c\n|---|---|\nnext"));
  });

  it("is never taken into a formula, and every other formula stays one", () => {
    const el = read("Preis $3 [[Notiz]] und $4, dazu $x^2$");
    expect(links(el)).toEqual([["Notiz", "wiki://Notiz"]]);
    expect(formulas(el)).toEqual(["x^2"]);
    expect(el.textContent).toContain("Preis $3 Notiz und $4");
    const inside = read("Sei $a [[b]] c$ und $y$\n\n$$\nx = [[b]]\n$$\n\n$$z$$");
    expect(links(inside)).toEqual([["b", "wiki://b"], ["b", "wiki://b"]]);
    expect(formulas(inside)).toEqual(["y", "z"]);
  });

  // The rule of the coordination (Fehlerliste 0.9.0, F45): the reading view
  // renders every formula it rendered before B4, which may only keep a
  // formula from taking a wiki link. The renderings are main's as of
  // 2026-11-17 (`readerFormulas.main.json`), frozen: `$` in an alias and in a
  // name of a link, forms without a link in a formula, and formulas over a
  // link whose signs cannot be taken out unseen — behind a backslash, in an
  // address, in code — which stay as they were.
  it("renders as main rendered, frozen", () => {
    for (const [form, rendered] of Object.entries(FROZEN_MAIN as Record<string, string>)) expect(html(form, true), form).toBe(rendered);
  });
});
