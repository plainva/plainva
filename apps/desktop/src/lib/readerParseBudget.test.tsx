// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { prepareReaderSource } from "@plainva/core";
import { boundedInlineSyntax, boundReaderMarkdown, findSourceTextRange, rehypeReaderSource } from "@plainva/ui";
import { remarkMappedBreaks, remarkStripHighlightMarks, remarkTagPills, remarkTaskStates } from "../components/markdownReaderModel";

/**
 * The parse budget in the reading view and in the editor (open-items plan
 * 3.133 no. 4): a line of 100 000 `]` held the reading view for minutes, a
 * long run of `*a` held the editor's parser. A stretch over the budget is
 * read as written in both; every other block of the note, and its source
 * mapping, as before. The time limits are generous: the reading view's input
 * took the parser minutes before.
 */

const LONG_LINE = "]".repeat(100_000);
const NOTE = `# Title\n\nBefore [[Kept]] and *em*.\n\n${LONG_LINE}\n\n## After\n\nA [web](https://example.org) link and **bold**.\n`;

/** What `MarkdownReader` renders for `content`: the prepared text, bounded, with the reader's plugins and its source map. */
function read(content: string) {
  const source = prepareReaderSource(content);
  const bounded = boundReaderMarkdown(source.text);
  const container = document.createElement("div");
  container.className = "markdown-reader";
  container.innerHTML = renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[bounded.remarkRestore, remarkGfm, remarkTaskStates, remarkMappedBreaks, remarkStripHighlightMarks, remarkTagPills]}
      rehypePlugins={[rehypeReaderSource(source, content) as never]}
    >{bounded.text}</ReactMarkdown>,
  );
  return container;
}

describe("the reading view and a stretch over the parse budget", () => {
  it("shows a line of 100 000 `]` as written, in a moment, and the note around it as before", () => {
    const start = performance.now();
    const container = read(NOTE);
    expect(performance.now() - start).toBeLessThan(10_000);
    const paragraphs = [...container.querySelectorAll("p")];
    expect(paragraphs[1].textContent).toBe(LONG_LINE);
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("h2")?.textContent).toBe("After");
    expect(paragraphs[0].querySelector("em")?.textContent).toBe("em");
    expect(container.querySelector("a[href='https://example.org']")?.textContent).toBe("web");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  }, 300_000);

  it("keeps the source map: the stretch and what follows it lead back to their places", () => {
    const container = read(NOTE);
    document.body.append(container);
    try {
      for (const word of ["Before", "bold", "After"]) {
        const from = NOTE.indexOf(word);
        expect(findSourceTextRange(container, from, from + word.length, NOTE)?.toString(), word).toBe(word);
      }
      const from = NOTE.indexOf(LONG_LINE) + 10;
      expect(findSourceTextRange(container, from, from + 5, NOTE)?.toString()).toBe("]]]]]");
    } finally {
      container.remove();
    }
  }, 300_000);

  it("shows a stretch with Markdown in it as it is written: no picture, no link syntax, no emphasis", () => {
    const stretch = `![pixel](https://example.org/p.png) [x](y) *a* ${"a ]".repeat(10_000)}`;
    const container = read(`${stretch}\n\nafter *em*`);
    const first = container.querySelector("p")!;
    expect(first.textContent).toBe(stretch);
    expect(first.querySelector("img, em, a[href='y']")).toBeNull();
    // A bare address stays what it is in any text: a link, nothing fetched.
    expect([...first.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["https://example.org/p.png"]);
    expect(container.querySelectorAll("p")[1].querySelector("em")?.textContent).toBe("em");
  }, 300_000);
});

describe("the editor's parser and a block over the parse budget", () => {
  const parser = markdown({ base: markdownLanguage, extensions: [boundedInlineSyntax] }).language.parser;
  const names = (tree: ReturnType<typeof parser.parse>, from: number, to: number) => {
    const found = new Set<string>();
    tree.iterate({ from, to, enter: (node) => { found.add(node.name); } });
    return found;
  };

  it("reads a long run of `*a` as text, and the block after it as Markdown", () => {
    const run = "*a".repeat(150_000);
    const doc = `${run}\n\nafter *em* and [[x]] [y](z)\n`;
    const start = performance.now();
    const tree = parser.parse(doc);
    expect(performance.now() - start).toBeLessThan(10_000);
    expect(names(tree, 0, run.length).has("Emphasis")).toBe(false);
    const after = names(tree, run.length + 2, doc.length);
    expect(after.has("Emphasis")).toBe(true);
    expect(after.has("Link")).toBe(true);
  }, 300_000);

  it("reads a block with more links than any person writes as text: each closing link looked back over the block", () => {
    const block = Array.from({ length: 24_000 }, (_, i) => `row ${i} [a](b) [[c]]`).join("\n");
    const doc = `${block}\n\nafter [y](z)\n`;
    const start = performance.now();
    const tree = parser.parse(doc);
    expect(performance.now() - start).toBeLessThan(10_000);
    expect(names(tree, 0, block.length).has("Link")).toBe(false);
    expect(names(tree, block.length + 2, doc.length).has("Link")).toBe(true);
  }, 300_000);

  it("leaves a block a person writes as it was", () => {
    const doc = Array.from({ length: 400 }, (_, i) => `Sentence ${i} with a [[Link ${i}]], *some* **bold** and a [web](https://x.org/${i}) link.`).join(" ");
    const bounded = parser.parse(doc);
    const plain = markdown({ base: markdownLanguage }).language.parser.parse(doc);
    expect(bounded.toString()).toBe(plain.toString());
  });
});
