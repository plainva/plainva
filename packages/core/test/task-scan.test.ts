import { describe, it, expect } from "vitest";
import { scanTasks } from "../src/vault/taskScan.ts";

describe("scanTasks", () => {
  it("extracts open and done tasks with document-order ordinals and line numbers", () => {
    const content = ["# Notes", "- [ ] alpha", "- [x] beta done", "not a task", "  * [ ] nested"].join("\n");
    const tasks = scanTasks(content);
    expect(tasks.map((t) => [t.line, t.ordinal, t.done, t.text])).toEqual([
      [1, 0, false, "alpha"],
      [2, 1, true, "beta done"],
      [4, 2, false, "nested"],
    ]);
  });

  it("skips checkboxes inside fenced code blocks (and does not consume an ordinal)", () => {
    const content = ["- [ ] real", "```", "- [ ] fake in code", "```", "- [x] real2"].join("\n");
    const tasks = scanTasks(content);
    expect(tasks.map((t) => t.text)).toEqual(["real", "real2"]);
    expect(tasks[1].ordinal).toBe(1);
  });

  it("matches ordered lists and blockquoted tasks", () => {
    const tasks = scanTasks(["1. [ ] first", "> - [x] quoted"].join("\n"));
    expect(tasks).toHaveLength(2);
    expect(tasks[1].done).toBe(true);
  });

  it("pulls inline tags and a due date out of the task text", () => {
    const tasks = scanTasks("- [ ] pay invoice #finance #urgent 📅 2026-08-01");
    expect(tasks[0].tags).toEqual(["finance", "urgent"]);
    expect(tasks[0].due).toBe("2026-08-01");
  });

  it("returns nothing for content without tasks", () => {
    expect(scanTasks("# just a heading\nsome text")).toEqual([]);
  });
});

describe("subtasks and the bullets under a task (wish E6, 2026-10-24)", () => {
  it("names the task a checkbox is indented under, through a bullet in between too", () => {
    const tasks = scanTasks([
      "- [ ] Introduce level 7 and 8",
      "  - [ ] Dates with Javid",
      "    - [x] Check list",
      "  - Questions",
      "    - [ ] Ask the supplier",
      "- [ ] Next top-level task",
      "\t- [ ] Under a tab",
    ].join("\n"));
    expect(tasks.map((t) => [t.text, t.parent])).toEqual([
      ["Introduce level 7 and 8", undefined],
      ["Dates with Javid", 0],
      ["Check list", 1],
      // Its nearest checkbox ancestor; the bullet between has no box.
      ["Ask the supplier", 0],
      ["Next top-level task", undefined],
      ["Under a tab", 4],
    ]);
    // A task at the top of its list carries no `parent` key at all.
    expect("parent" in tasks[0]).toBe(false);
  });

  it("keeps up to two bullets without a box directly under a task as its details", () => {
    const tasks = scanTasks([
      "- [ ] Introduce level 7 and 8",
      "  - Proposal: level 8 every second Friday",
      "  - Where does the material orderer come in?",
      "  - A third question stays out of the preview",
      "  - [ ] Dates with Javid",
      "    - deeper bullet belongs to the subtask",
      "- [ ] No details here",
    ].join("\n"));
    expect(tasks[0].details).toEqual(["Proposal: level 8 every second Friday", "Where does the material orderer come in?"]);
    expect(tasks[1].details).toEqual(["deeper bullet belongs to the subtask"]);
    expect("details" in tasks[2]).toBe(false);
  });

  it("ends a list at a line that stands no further in, but not at a blank line", () => {
    const tasks = scanTasks([
      "- [ ] Parent",
      "",
      "  - [ ] Child after a blank line",
      "Paragraph",
      "  - [ ] Indented after a paragraph",
      "- bullet",
      "  - [ ] Under a plain bullet",
      "```",
      "  - [ ] fenced",
      "```",
      "  - [ ] after the fence",
    ].join("\n"));
    expect(tasks.map((t) => [t.text, t.parent])).toEqual([
      ["Parent", undefined],
      ["Child after a blank line", 0],
      ["Indented after a paragraph", undefined],
      ["Under a plain bullet", undefined],
      ["after the fence", undefined],
    ]);
    // A paragraph and a heading never count as a bullet of the task.
    expect(scanTasks("- [ ] Task\n  continuation text\n# Heading\n  - stray").every((t) => t.details === undefined)).toBe(true);
  });
});
