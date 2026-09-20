// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { scanTasks } from "@plainva/core";
import { remarkTaskStates } from "../components/markdownReaderModel";
import { taskCheckboxOrdinal } from "../components/MarkdownReader";

/**
 * Plan Aufgaben-Oberfläche, E12: `[/]` and `[-]` are tasks. The reader finds the
 * line to write by COUNTING rendered checkboxes, while the scanner that owns the
 * ordinals counts all four boxes — so every scanned task must be a rendered box,
 * or a tick lands on the wrong line.
 */
const NOTE = ["- [ ] offen", "- [/] in Arbeit", "- [x] fertig", "- [-] gestrichen", "- kein Kästchen", "  - [/] verschachtelt", "", "[/] kein Listenpunkt"].join("\n");

function render(markdown: string): HTMLDivElement {
  const host = document.createElement("div");
  host.className = "markdown-reader";
  host.innerHTML = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm, remarkTaskStates]}>{markdown}</ReactMarkdown>);
  document.body.append(host);
  return host;
}

describe("task states in the reader", () => {
  it("draws one box per scanned task, in the same order", () => {
    const host = render(NOTE);
    try {
      const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
      const scanned = scanTasks(NOTE);
      expect(boxes).toHaveLength(scanned.length);
      expect(boxes.map((box) => taskCheckboxOrdinal(box))).toEqual(scanned.map((task) => task.ordinal));
      // Closed boxes are ticked (done AND cancelled); in progress is an empty box
      // that the renderer turns into the native dash.
      expect(boxes.map((box) => box.checked)).toEqual([false, false, true, true, false]);
    } finally {
      host.remove();
    }
  });

  it("takes the marker out of the text and says which state it was", () => {
    const host = render(NOTE);
    try {
      const items = [...host.querySelectorAll("li.task-list-item")];
      expect(items.map((li) => li.getAttribute("data-task-state"))).toEqual([null, "progress", null, "cancelled", "progress"]);
      expect(host.textContent).not.toContain("[/] in Arbeit");
      expect(host.textContent).toContain("in Arbeit");
      expect(host.textContent).toContain("gestrichen");
      // Outside a list item the characters are just text.
      expect(host.textContent).toContain("[/] kein Listenpunkt");
    } finally {
      host.remove();
    }
  });
});
