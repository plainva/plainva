import { describe, expect, it } from "vitest";
import { TaskMutationGate, filterTaskDbRows, filterTasks, groupTasksByNote, type TaskLike } from "@plainva/ui";

const task = (over: Partial<TaskLike> = {}): TaskLike => ({
  path: "Notes/A.md", title: "A", text: "buy milk", done: false, due: null, tags: [], excluded: false, ordinal: 0, ...over,
});

/**
 * Both shells must answer "which tasks are open" identically — a second
 * implementation of that question is the divergence this package exists to
 * remove.
 */
describe("task filtering", () => {
  it("hides opted-out notes unless asked", () => {
    const rows = [task(), task({ excluded: true, text: "from a template" })];
    expect(filterTasks(rows, { status: "all" })).toHaveLength(1);
    expect(filterTasks(rows, { status: "all", includeHidden: true })).toHaveLength(2);
  });

  it("separates open from done, and 'all' keeps both", () => {
    const rows = [task(), task({ done: true, text: "done thing" })];
    expect(filterTasks(rows, { status: "open" }).map((t) => t.text)).toEqual(["buy milk"]);
    expect(filterTasks(rows, { status: "done" }).map((t) => t.text)).toEqual(["done thing"]);
    expect(filterTasks(rows, { status: "all" })).toHaveLength(2);
  });

  it("matches a folder by prefix, not by substring", () => {
    const rows = [task({ path: "Work/A.md" }), task({ path: "Workshop/B.md" })];
    expect(filterTasks(rows, { status: "all", folder: "Work" }).map((t) => t.path)).toEqual(["Work/A.md"]);
  });

  it("filters by tag, due date and text", () => {
    const rows = [task({ tags: ["home"] }), task({ text: "call bank", due: "2026-08-01" })];
    expect(filterTasks(rows, { status: "all", tag: "home" })).toHaveLength(1);
    expect(filterTasks(rows, { status: "all", dueOnly: true })).toHaveLength(1);
    expect(filterTasks(rows, { status: "all", text: "BANK" }).map((t) => t.text)).toEqual(["call bank"]);
  });

  it("applies the status filter to database rows too", () => {
    // Without it a task completed at the provider still looked open, which made
    // the filter itself look broken.
    const rows = [{ title: "open one", done: false, due: null }, { title: "closed one", done: true, due: null }];
    expect(filterTaskDbRows(rows, { status: "open" }).map((r) => r.title)).toEqual(["open one"]);
  });

  it("groups by note in reading order", () => {
    const rows = [task({ path: "B.md", title: "B" }), task({ path: "A.md", title: "A" }), task({ path: "B.md", title: "B", ordinal: 1 })];
    const groups = groupTasksByNote(rows);
    expect(groups.map((g) => g.path)).toEqual(["B.md", "A.md"]);
    expect(groups[0].items).toHaveLength(2);
  });
});

describe("TaskMutationGate", () => {
  it("refuses a read that started before a write finished", () => {
    // Otherwise the older result rolls the checkbox back in front of the user,
    // which reads as "my check-off did not stick".
    const gate = new TaskMutationGate();
    const versionAtStart = gate.value;
    gate.begin();
    gate.finish();
    expect(gate.canCommit(versionAtStart)).toBe(false);
  });

  it("accepts a read when nothing changed and nothing is in flight", () => {
    const gate = new TaskMutationGate();
    expect(gate.canCommit(gate.value)).toBe(true);
  });

  it("blocks while a write is still running", () => {
    const gate = new TaskMutationGate();
    gate.begin();
    expect(gate.canCommit(gate.value)).toBe(false);
  });
});
