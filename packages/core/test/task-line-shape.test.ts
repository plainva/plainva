import { describe, expect, it } from "vitest";
import { setChecklistTaskDone, setChecklistTaskDue, setChecklistTaskPriority, setChecklistTaskState } from "../src/vault/taskMutation.js";
import { scanTasks } from "../src/vault/taskScan.js";

/**
 * The checkbox writers and a note that lies there with `\r\n` or starts with a
 * byte order mark.
 *
 * They change ONE line and leave every other byte alone — each line keeps its
 * own line end, which is more exact than any rule about the file as a whole.
 * Two corners of that were wrong (finding 2026-10-09), both because the
 * pattern for a task line takes more than the line's own lead: the blank it
 * asks for behind the box is, for an empty box in a `\r\n` note, the line's
 * `\r`; and the blanks it allows in front take a mark in.
 */

// Built at run time: the mark is never typed into this file.
const MARK = String.fromCharCode(0xfeff);
const TODAY = { today: "2026-10-09", newId: () => "abc" };

describe("a checkbox line in a note with \\r\\n", () => {
  // This test and the one about a plain tick behind a mark hold what was
  // right before the change; the other three fail without it.
  it("is ticked, reopened and given a state without touching another byte", () => {
    const note = `${MARK}# Day\r\n\r\n- [ ] one\r\n- [ ] two\r\ntext\r\n`;
    const ticked = setChecklistTaskDone(note, 1, true, TODAY).content;
    expect(ticked).toBe(`${MARK}# Day\r\n\r\n- [ ] one\r\n- [x] two\r\ntext\r\n`);
    expect(setChecklistTaskDone(ticked, 1, false, TODAY).content).toBe(note);
    expect(setChecklistTaskState(note, 0, "progress").content).toBe(`${MARK}# Day\r\n\r\n- [/] one\r\n- [ ] two\r\ntext\r\n`);
    expect(setChecklistTaskDue(note, 0, "2026-10-10").content).toBe(`${MARK}# Day\r\n\r\n- [ ] one 📅 2026-10-10\r\n- [ ] two\r\ntext\r\n`);
  });

  it("gets a due day on an EMPTY box without a \\r left in the middle of the line", () => {
    // It used to come back "- [ ]\r 📅 2026-10-10\r\n": the line's own "\r",
    // taken for the blank behind the box, stayed where it was.
    const due = setChecklistTaskDue("- [ ]\r\nnext\r\n", 0, "2026-10-10").content;
    expect(due).toBe("- [ ] 📅 2026-10-10\r\nnext\r\n");
    expect(due.replace(/\r\n/g, "")).not.toContain("\r");
    // …and it is still a task line afterwards, with the day on it.
    expect(scanTasks(due)).toHaveLength(1);
    expect(scanTasks(due)[0].text).toContain("2026-10-10");
  });

  it("gets a priority on an empty box as a task line, with \\r\\n and with \\n", () => {
    // A mark set directly behind the bracket made the line no task line at
    // all — in a "\n" note as well ("- [ ]⏫").
    for (const eol of ["\r\n", "\n"]) {
      const marked = setChecklistTaskPriority(`- [ ]${eol}next${eol}`, 0, 1).content;
      expect(marked, JSON.stringify(eol)).toBe(`- [ ] ⏫${eol}next${eol}`);
      expect(scanTasks(marked), JSON.stringify(eol)).toHaveLength(1);
    }
    // A box with text keeps exactly the blanks it had.
    expect(setChecklistTaskPriority("- [ ] text\r\n", 0, 1).content).toBe("- [ ] text ⏫\r\n");
  });
});

describe("a checkbox on the first line of a note that starts with a mark", () => {
  it("is ticked with the mark where it was", () => {
    expect(setChecklistTaskDone(`${MARK}- [ ] water\r\nnext\r\n`, 0, true, TODAY).content).toBe(`${MARK}- [x] water\r\nnext\r\n`);
  });

  it("leaves ONE mark, at the start of the file, when a repeating task writes its successor above it", () => {
    const note = `${MARK}- [ ] water 🔁 every day 📅 2026-10-09\r\nnext\r\n`;
    const done = setChecklistTaskDone(note, 0, true, TODAY).content;
    // The successor stands above the task it follows — it is the first line
    // now. It used to bring a mark of its own, and the old one stayed in
    // front of the second line, in the middle of the file.
    expect(done.charCodeAt(0)).toBe(0xfeff);
    expect(done.slice(1)).not.toContain(MARK);
    const lines = done.slice(1).split("\r\n");
    expect(lines[0]).toMatch(/^- \[ \] water 🔁 every day 📅 2026-10-10/u);
    expect(lines[1]).toMatch(/^- \[x\] water 🔁 every day 📅 2026-10-09 .*✅ 2026-10-09$/u);
    expect(lines.slice(2)).toEqual(["next", ""]);
    // Both are task lines for the scanner.
    expect(scanTasks(done).map((task) => task.state)).toEqual(["open", "done"]);
  });
});
