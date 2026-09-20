import { describe, expect, it } from "vitest";
import { scanTasks, taskProgressOf } from "../src/vault/taskScan.js";
import { setChecklistTaskDone, setChecklistTaskState } from "../src/vault/taskMutation.js";

/**
 * Plan Aufgaben-Oberfläche, E12: `[/]` (in progress) and `[-]` (cancelled) are
 * tasks. They used to be invisible — no task, not even a box — which also
 * shifted nothing, because they were not counted. Now they ARE counted, so
 * every ordinal below has to stay in step with the toggle.
 */
const NOTE = ["# Plan", "- [ ] offen", "- [/] in Arbeit", "- [x] fertig", "- [-] gestrichen", "```", "- [/] im Codeblock", "```", "> 1. [/] im Zitat"].join("\n");

describe("task states", () => {
  it("reads four states, in document order, never inside a fence", () => {
    const tasks = scanTasks(NOTE);
    expect(tasks.map((t) => [t.ordinal, t.state, t.done, t.text])).toEqual([
      [0, "open", false, "offen"],
      [1, "progress", false, "in Arbeit"],
      [2, "done", true, "fertig"],
      [3, "cancelled", false, "gestrichen"],
      [4, "progress", false, "im Zitat"],
    ]);
  });

  it("a click moves between open and done only: in progress completes, cancelled reopens", () => {
    const ticked = setChecklistTaskDone(NOTE, 1, true);
    expect(ticked.content.split("\n")[2]).toBe("- [x] in Arbeit");
    const reopened = setChecklistTaskDone(NOTE, 3, false);
    expect(reopened.content.split("\n")[4]).toBe("- [ ] gestrichen");
    // Nothing to do where the box already says so.
    expect(setChecklistTaskDone(NOTE, 0, false).changed).toBe(false);
    expect(setChecklistTaskDone(NOTE, 2, true).changed).toBe(false);
  });

  it("the two states are set on request, and change one character", () => {
    const progress = setChecklistTaskState(NOTE, 0, "progress");
    expect(progress.content.split("\n")[1]).toBe("- [/] offen");
    const cancelled = setChecklistTaskState(NOTE, 4, "cancelled");
    expect(cancelled.content.split("\n")[8]).toBe("> 1. [-] im Zitat");
    expect(setChecklistTaskState(NOTE, 1, "progress").changed).toBe(false);
    // Every other line is untouched, byte for byte.
    const before = NOTE.split("\n");
    const after = progress.content.split("\n");
    expect(after.filter((line, i) => line !== before[i])).toEqual(["- [/] offen"]);
  });

  it("done and open go through the ordinary toggle — completion date included", () => {
    const dated = "- [/] Bericht 📅 2026-09-21";
    const done = setChecklistTaskState(dated, 0, "done", { today: "2026-09-20" });
    expect(done.content).toBe("- [x] Bericht 📅 2026-09-21 ✅ 2026-09-20");
  });

  it("keeps CRLF line endings when only the box changes", () => {
    const crlf = "- [ ] a\r\n- [ ] b\r\n";
    expect(setChecklistTaskState(crlf, 1, "cancelled").content).toBe("- [ ] a\r\n- [-] b\r\n");
  });

  it("a cancelled sub-task leaves the progress count", () => {
    expect(taskProgressOf("- [x] a\n- [-] b\n- [/] c")).toEqual({ done: 1, total: 2 });
    expect(taskProgressOf("- [x] a\n- [-] b")).toEqual({ done: 1, total: 1 });
  });
});
