import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { createFenceTracker, fencedCodeLines } from "../src/markdownFence.ts";
import { scanTasks, taskProgressOf } from "../src/vault/taskScan.ts";
import { setChecklistTaskDone, setHtmlCheckboxChecked } from "../src/vault/taskMutation.ts";
import { findInlineTagsInSource } from "../src/tagRule.ts";

/**
 * A fence inside a block quote or a callout (finding 2026-10-25). The reading
 * view renders with remark and maps a checkbox back by counting, so the line
 * scanner must see code exactly where remark does: remark is the oracle here.
 */
const parser = unified().use(remarkParse).use(remarkGfm);

/** The 0-based lines remark reads as fenced code (opening, body, closing line). */
function remarkFencedLines(markdown: string): boolean[] {
  const lines = markdown.split("\n");
  const out = lines.map(() => false);
  visit(parser.parse(markdown) as never, "code", (node: { position?: { start: { line: number; column: number }; end: { line: number } } }) => {
    const pos = node.position!;
    // Indented code is no fence: its first line does not start with the run.
    const first = lines[pos.start.line - 1].slice(pos.start.column - 1);
    if (!/^[`~]{3}/.test(first)) return;
    for (let l = pos.start.line; l <= pos.end.line; l++) out[l - 1] = true;
  });
  return out;
}

const CASES: Record<string, string[]> = {
  "a fence in a callout": ["> [!note] Example", "> ```", "> - [ ] not a task", "> ```", "", "- [ ] real"],
  "a fence in a plain quote, no space after >": [">```md", ">- [ ] code", ">```", "- [ ] real"],
  "a fence in a nested quote": ["> > ```", "> > - [ ] code", "> > ```", "> - [ ] quoted task"],
  "a deeper quote marker inside a quote fence is code": ["> ```", "> > ```", "> - [ ] still code", "> ```", "- [ ] real"],
  "the quote ends without a closing fence": ["> ```", "> - [ ] code", "", "- [ ] real after the quote"],
  "a fence closed outside its quote opens a new one": ["> ```", "> code", "```", "- [ ] code to the end"],
  "a quote marker inside a top-level fence is code": ["```", "> ```", "- [ ] code", "```", "- [ ] real"],
  "a longer closing run closes, a shorter one does not": ["````", "```", "- [ ] code", "`````", "- [ ] real"],
  "the other character does not close": ["~~~", "```", "- [ ] code", "~~~", "- [ ] real"],
  "inline code at the start of a line is no fence": ["```x``` - not a fence", "- [ ] real"],
  "a run with text behind it does not close": ["```", "``` not a close", "- [ ] code", "```", "- [ ] real"],
  "a callout fence with tilde and info": ["> [!tip]", "> ~~~mermaid", "> graph TD", "> ~~~", "- [ ] real"],
  "an unclosed fence runs to the end": ["- [ ] real", "```", "- [ ] code"],
  "a run indented four inside a fence is code, not its close": ["```markdown", "1. Install:", "", "    ```bash", "    - [ ] code", "    ```", "```", "", "- [ ] real"],
  "a closer in a list item stands within the item's content": ["1. Step", "   ```", "   - [ ] code", "    ```", "   - [ ] real"],
  "a closer three deeper than its opener closes it": ["1. Step", "   ```", "   - [ ] code", "      ```", "   - [ ] real"],
  "a tab behind a quote marker before a closer closes it": ["> [!tip]", "> ```", "> - [ ] code", "> \t```", "> - [ ] real"],
};

describe("fenced code lines: the scanner reads them as remark does", () => {
  for (const [name, lines] of Object.entries(CASES)) {
    it(name, () => {
      const md = lines.join("\n");
      expect(fencedCodeLines(lines)).toEqual(remarkFencedLines(md));
    });
  }

  it("says which line opens, which is code and which closes", () => {
    const fence = createFenceTracker();
    expect(["text", "> ```js", "> a", "> ```", "after"].map((l) => fence.step(l))).toEqual([null, "open", "code", "close", null]);
    expect(fence.inFence).toBe(false);
  });

  it("reads lines with a carriage return and a byte order mark", () => {
    const lines = ["﻿```", "- [ ] code\r", "```\r", "- [ ] real\r"];
    expect(fencedCodeLines(lines)).toEqual([true, true, true, false]);
  });
});

const CALLOUT_NOTE = [
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
].join("\n");

describe("a fence in a callout holds no tasks", () => {
  it("the scanner does not list the lines in the fence", () => {
    expect(scanTasks(CALLOUT_NOTE).map((t) => [t.ordinal, t.line, t.text])).toEqual([
      [0, 8, "first real"],
      [1, 9, "second real"],
    ]);
    expect(taskProgressOf(CALLOUT_NOTE)).toEqual({ done: 0, total: 2 });
  });

  it("ticking the second real task writes exactly that line", () => {
    const res = setChecklistTaskDone(CALLOUT_NOTE, 1, true, { today: "2026-10-25" });
    const before = CALLOUT_NOTE.split("\n");
    const after = res.content.split("\n");
    expect(after.map((l, i) => (l !== before[i] ? i : -1)).filter((i) => i >= 0)).toEqual([9]);
    expect(after[9]).toBe("- [x] second real");
  });

  it("an HTML checkbox in a callout fence keeps its ordinal space out of the code", () => {
    const note = ["> ```html", '> <input type="checkbox">', "> ```", '| a | <input type="checkbox"> |'].join("\n");
    const res = setHtmlCheckboxChecked(note, 0, true);
    expect(res.changed).toBe(true);
    expect(res.content.split("\n")[1]).toBe('> <input type="checkbox">');
    expect(res.content.split("\n")[3]).toContain("checked");
  });

  it("a tag in a callout fence is no tag", () => {
    const tags = findInlineTagsInSource(["> ```", "> #code", "> ```", "#real"].join("\n")).map((t) => t.name);
    expect(tags).toEqual(["real"]);
  });
});
