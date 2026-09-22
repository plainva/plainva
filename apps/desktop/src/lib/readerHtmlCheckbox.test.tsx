// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkBrToBreak, remarkHtmlCheckbox, remarkTaskStates } from "../components/markdownReaderModel";
import { taskCheckboxOrdinal } from "../components/MarkdownReader";

/**
 * A checkbox in a table cell (finding 2026-09-22).
 *
 * GFM has no spelling for one, so the HTML tag is what people write and what
 * Obsidian draws. The reader has no `rehype-raw` and must not get one — the
 * plugin recognises this ONE element and builds the node itself, the way
 * `remarkBrToBreak` does for `<br>`. Everything else stays literal text.
 */
function render(markdown: string): HTMLDivElement {
  const host = document.createElement("div");
  host.className = "markdown-reader";
  host.innerHTML = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkTaskStates, remarkBrToBreak, remarkHtmlCheckbox]}>{markdown}</ReactMarkdown>,
  );
  document.body.append(host);
  return host;
}

const TABLE = [
  "| Step | done |",
  "| --- | --- |",
  '| Fuse checked | <input type="checkbox" checked> |',
  '| Router swapped | <input type="checkbox"> |',
  "",
].join("\n");

describe("HTML checkboxes in the reader", () => {
  it("draws a real box for each tag, ticked as the file says", () => {
    const host = render(TABLE);
    try {
      const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
      expect(boxes).toHaveLength(2);
      expect(boxes.map((b) => b.checked)).toEqual([true, false]);
      expect(boxes.map((b) => b.getAttribute("data-html-box"))).toEqual(["0", "1"]);
      // Not a single tag left standing as text.
      expect(host.textContent).not.toContain("<input");
    } finally {
      host.remove();
    }
  });

  it("leaves every other piece of raw HTML exactly where it was", () => {
    const host = render(
      ['<input type="text">', "", "<script>alert(1)</script>", "", '<input type="checkbox" onclick="x()">', ""].join("\n"),
    );
    try {
      expect(host.querySelectorAll("input")).toHaveLength(0);
      expect(host.querySelectorAll("script")).toHaveLength(0);
      expect(host.textContent).toContain('<input type="text">');
      expect(host.textContent).toContain("<script>alert(1)</script>");
      // A checkbox tag carrying anything executable is not one of ours either.
      expect(host.textContent).toContain("onclick");
    } finally {
      host.remove();
    }
  });

  it("keeps the GFM ordinals free of the HTML boxes", () => {
    const host = render(["- [ ] a real task", "", TABLE, "- [ ] another real task", ""].join("\n"));
    try {
      const gfm = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not([data-html-box])')];
      expect(gfm.map((box) => taskCheckboxOrdinal(box))).toEqual([0, 1]);
      // The two boxes of the table sit between them and count for nothing here.
      expect(host.querySelectorAll("input[data-html-box]")).toHaveLength(2);
    } finally {
      host.remove();
    }
  });
});
