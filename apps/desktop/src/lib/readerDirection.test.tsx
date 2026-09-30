// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { prepareReaderSource } from "@plainva/core";
import { lineDirections, rehypeReaderDirection, rehypeReaderSource } from "@plainva/ui";
import { remarkTaskStates } from "../components/markdownReaderModel";

/**
 * Right-to-left text in the desktop reading view (issue #111, plan Teil R,
 * R3). The reader runs the same two rehype steps MarkdownReader does - source
 * addresses, then directions - and every block must carry the direction the
 * editor gives its line.
 */
function render(markdown: string): HTMLDivElement {
  const source = prepareReaderSource(markdown);
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkTaskStates]}
      rehypePlugins={[rehypeReaderSource(source, markdown) as never, rehypeReaderDirection(markdown) as never]}
    >
      {source.text}
    </ReactMarkdown>,
  );
  return host;
}

const NOTE = [
  "---",
  "title: Lesenotizen",
  "---",
  "# ملاحظات القراءة",
  "",
  "بدأت اليوم قراءة كتاب جديد. قرأت 42 صفحة من 310.",
  "",
  "- الفصل الأول: قرطبة",
  "- [x] شراء الكتاب",
  "",
  "> العلم في الصغر كالنقش على الحجر.",
  "",
  "Plainva يحفظ ملاحظاتي كملفات Markdown.",
  "",
  "| الاسم | Wert |",
  "| --- | --- |",
  "| ٣ | Plainva |",
  "",
  "```",
  'grep -n "الأندلس" notes.md',
  "```",
].join("\n");

describe("right-to-left blocks in the reader", () => {
  it("gives headings, paragraphs, lists, quotes and tables their direction", () => {
    const host = render(NOTE);
    expect(host.querySelector("h1")?.getAttribute("dir")).toBe("rtl");
    const paragraphs = [...host.querySelectorAll(":scope > p")];
    expect(paragraphs.map((p) => p.getAttribute("dir"))).toEqual(["rtl", "ltr"]);
    expect(host.querySelector("ul")?.getAttribute("dir")).toBe("rtl");
    expect([...host.querySelectorAll("li")].map((li) => li.getAttribute("dir"))).toEqual(["rtl", "rtl"]);
    expect(host.querySelector("blockquote")?.getAttribute("dir")).toBe("rtl");
    expect(host.querySelector("table")?.getAttribute("dir")).toBe("rtl");
    // Each cell decides on its own; a number runs with its table.
    expect([...host.querySelectorAll("th, td")].map((c) => c.getAttribute("dir"))).toEqual(["rtl", "ltr", "rtl", "ltr"]);
    // Code keeps the reader's left-to-right.
    expect(host.querySelector("pre")?.hasAttribute("dir")).toBe(false);
    expect(host.querySelector("code")?.hasAttribute("dir")).toBe(false);
  });

  it("decides exactly as the editor does, block by block", () => {
    const host = render(NOTE);
    const dirs = lineDirections(NOTE);
    // h1 on line 4, first list item on line 8, the Latin-led paragraph on line 13.
    expect(host.querySelector("h1")?.getAttribute("dir")).toBe(dirs[3]);
    expect(host.querySelector("li")?.getAttribute("dir")).toBe(dirs[7]);
    expect([...host.querySelectorAll(":scope > p")][1].getAttribute("dir")).toBe(dirs[12]);
  });

  it("a callout without a title runs the way its body does", () => {
    const host = render("> [!note]\n> ملاحظة مهمة");
    expect(host.querySelector("blockquote")?.getAttribute("dir")).toBe("rtl");
  });

  it("leaves a note without right-to-left text untouched", () => {
    const host = render("# Heading\n\n- [x] done\n\n> quote\n\n| a | b |\n| - | - |\n| 1 | 2 |");
    expect(host.querySelectorAll("[dir]")).toHaveLength(0);
  });
});
