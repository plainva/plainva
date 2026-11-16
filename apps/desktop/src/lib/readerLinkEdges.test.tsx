// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { prepareReaderSource } from "@plainva/core";
import { remarkStripHtmlComments } from "../components/markdownReaderModel";

/**
 * Three edges of the reading view (Sammelplan § 3.133 Nr. 3 and Nr. 5),
 * through the text the reader prepares and the renderer with its formulas, as
 * `MarkdownReader` takes them.
 */
function read(content: string): HTMLElement {
  const source = prepareReaderSource(content, { formulas: true });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkStripHtmlComments, remarkMath]} urlTransform={(url) => url}>{source.text}</ReactMarkdown>,
  );
  return container;
}

const links = (el: HTMLElement) => [...el.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);

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
  });

  it("between two `$` that are no formula stays a link, and a formula stays one", () => {
    const el = read("Preis $3 [[Notiz]] und $4, dazu $x^2$");
    expect(links(el)).toEqual([["Notiz", "wiki://Notiz"]]);
    expect([...el.querySelectorAll(".math-inline")].map((m) => m.textContent)).toEqual(["x^2"]);
    expect(el.textContent).toContain("Preis $3 Notiz und $4");
  });
});
