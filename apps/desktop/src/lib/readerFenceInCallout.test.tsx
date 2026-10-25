// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { scanTasks } from "@plainva/core";
import { listTaskLines, noteTaskTick, parseNoteCard, replaceCheckboxWithLink, toggleTaskAtIndex } from "@plainva/ui";
import { remarkHtmlCheckbox, remarkTaskStates } from "../components/markdownReaderModel";
import { taskCheckboxOrdinal } from "../components/MarkdownReader";

/**
 * A fenced code block inside a callout (finding 2026-10-25).
 *
 * The reading view renders the note with remark, where a fence inside a quote
 * is code, and matches a ticked box back to the file by COUNTING boxes. The
 * scanner that owns the ordinals did not know a fence behind `> `: the example
 * lines in the fence counted as tasks, and a tick on a real task wrote a line
 * further up — one inside the code block, or the real task before it.
 */
const NOTE = [
  "# Example",
  "",
  "> [!example] How a checklist looks",
  "> ```markdown",
  "> - [ ] not a task",
  "> - [ ] not a task either",
  "> ```",
  "",
  "- [ ] first real",
  "- [ ] second real",
  "",
].join("\n");

function render(markdown: string): HTMLDivElement {
  const host = document.createElement("div");
  host.className = "markdown-reader";
  host.innerHTML = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm, remarkTaskStates, remarkHtmlCheckbox]}>{markdown}</ReactMarkdown>);
  document.body.append(host);
  return host;
}

const changedLines = (before: string, after: string): number[] => {
  const a = before.split("\n");
  return after.split("\n").map((l, i) => (l !== a[i] ? i : -1)).filter((i) => i >= 0);
};

describe("a fence in a callout, in the reading view", () => {
  it("draws one box per scanned task, in the same order", () => {
    const host = render(NOTE);
    try {
      const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
      expect(boxes.map((box) => taskCheckboxOrdinal(box))).toEqual(scanTasks(NOTE).map((task) => task.ordinal));
    } finally {
      host.remove();
    }
  });

  it("a tick on the second real box writes exactly that line", () => {
    const host = render(NOTE);
    try {
      const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
      expect(boxes).toHaveLength(2);
      const res = toggleTaskAtIndex(NOTE, taskCheckboxOrdinal(boxes[1]), true);
      expect(changedLines(NOTE, res.content)).toEqual([9]);
      expect(res.content.split("\n")[9]).toBe("- [x] second real");
    } finally {
      host.remove();
    }
  });
});

describe("a fence in a callout, everywhere else a task is counted", () => {
  it("the planner tick writes exactly the line it was listed for", () => {
    const second = scanTasks(NOTE).find((task) => task.text === "second real")!;
    const next = noteTaskTick({ ordinal: second.ordinal, text: second.text }, true)(NOTE);
    expect(next).not.toBeNull();
    expect(changedLines(NOTE, next!)).toEqual([9]);
  });

  it("the card checklist and the card body count the same two tasks", () => {
    expect(listTaskLines(NOTE).map((t) => [t.ordinal, t.line])).toEqual([[0, 8], [1, 9]]);
    const card = parseNoteCard(NOTE);
    const tasks = card.blocks.filter((b) => b.kind === "task");
    expect(tasks.map((b) => (b.kind === "task" ? b.ordinal : -1))).toEqual([0, 1]);
    // The fence is drawn as code, without its quote markers.
    const code = card.blocks.find((b) => b.kind === "code");
    expect(code && code.kind === "code" ? code.lines : null).toEqual(["- [ ] not a task", "- [ ] not a task either"]);
  });

  it("turning a task into a note replaces the real task, not a code line", () => {
    const res = replaceCheckboxWithLink(NOTE, 1, "Second");
    expect(res.changed).toBe(true);
    expect(changedLines(NOTE, res.content)).toEqual([9]);
  });
});
