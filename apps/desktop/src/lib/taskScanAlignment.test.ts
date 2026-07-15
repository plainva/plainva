import { describe, it, expect } from "vitest";
import { scanTasks } from "@plainva/core";
import { toggleTaskAtIndex } from "@plainva/ui";

// scanTasks (core, used by the vault-wide Tasks view) and toggleTaskAtIndex (ui,
// used by the read-mode checkbox + the Tasks view's write-back) each carry their
// own copy of the task/fence regex. This guards them against drift: for every
// ordinal scanTasks reports, toggling that ordinal must flip EXACTLY the line
// scanTasks pointed at — same document order, same fence handling.
describe("scanTasks / toggleTaskAtIndex alignment", () => {
  const content = [
    "# Todo",
    "- [ ] a",
    "```",
    "- [ ] fenced (must be ignored)",
    "```",
    "> - [x] b in a quote",
    "  1. [ ] c nested ordered",
  ].join("\n");

  it("every scanned ordinal flips exactly the line scanTasks reported", () => {
    const tasks = scanTasks(content);
    expect(tasks.length).toBe(3); // the fenced checkbox is not counted

    const orig = content.split("\n");
    for (const task of tasks) {
      const res = toggleTaskAtIndex(content, task.ordinal, !task.done);
      expect(res.changed).toBe(true);
      const flipped = res.content.split("\n");
      const changed = flipped.map((l, i) => (l !== orig[i] ? i : -1)).filter((i) => i >= 0);
      expect(changed).toEqual([task.line]);
    }
  });

  it("an out-of-range ordinal is a no-op for both", () => {
    expect(scanTasks(content)[99]).toBeUndefined();
    expect(toggleTaskAtIndex(content, 99, true).changed).toBe(false);
  });
});
