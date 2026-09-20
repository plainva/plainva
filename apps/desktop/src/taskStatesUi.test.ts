import { describe, expect, it } from "vitest";
import { buildPlanner, filterTasks, listTaskLines, markdownToPlainText, plannerRowsFromTasks, taskRowActions } from "@plainva/ui";
import type { TaskRecord } from "@plainva/core";

/**
 * Plan Aufgaben-Oberfläche, E12, above the scanner: what the views make of the
 * two new boxes. In progress counts as open, cancelled as closed — in the
 * status filter, in the planner and in a card's checklist.
 */
const task = (state: TaskRecord["state"], text: string, ordinal: number): TaskRecord => ({
  path: "Plan.md", title: "Plan", excluded: false, line: ordinal, ordinal, done: state === "done", state, text, tags: [], due: "2026-09-20",
});
const TASKS = [task("open", "offen", 0), task("progress", "in Arbeit", 1), task("done", "fertig", 2), task("cancelled", "gestrichen", 3)];

describe("task states in the views", () => {
  it("the status filter: 'open' includes in progress, 'done' includes cancelled", () => {
    expect(filterTasks(TASKS, { status: "open" }).map((t) => t.text)).toEqual(["offen", "in Arbeit"]);
    expect(filterTasks(TASKS, { status: "done" }).map((t) => t.text)).toEqual(["fertig", "gestrichen"]);
    expect(filterTasks(TASKS, { status: "all" })).toHaveLength(4);
  });

  it("the planner: in progress is due today, cancelled belongs to Done", () => {
    const planner = buildPlanner(plannerRowsFromTasks(TASKS), "2026-09-20");
    expect(planner.sections("today").flatMap((s) => s.rows.map((r) => r.title))).toEqual(["in Arbeit", "offen"]);
    expect(planner.sections("done")[0].rows.map((r) => [r.title, r.state])).toEqual([["fertig", "done"], ["gestrichen", "cancelled"]]);
  });

  it("a card's checklist reads the box, not 'anything but a space'", () => {
    // `done: m[2] !== " "` would have ticked both new boxes as done.
    expect(listTaskLines("- [/] a\n- [-] b\n- [x] c\n- [ ] d").map((l) => [l.text, l.done, l.state])).toEqual([
      ["a", false, "progress"],
      ["b", false, "cancelled"],
      ["c", true, "done"],
      ["d", false, "open"],
    ]);
  });

  it("'Set state' is offered where the shell can do it, and copied text keeps four shapes", () => {
    const t = (key: string) => key;
    expect(taskRowActions(t, { done: false, state: () => undefined }).map((a) => a.id)).toEqual(["state"]);
    expect(taskRowActions(t, { done: false }).map((a) => a.id)).toEqual([]);
    expect(markdownToPlainText("- [ ] a\n- [/] b\n- [x] c\n- [-] d")).toBe("- ☐ a\n- ◪ b\n- ☑ c\n- ☒ d");
  });
});
