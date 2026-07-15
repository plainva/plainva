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
