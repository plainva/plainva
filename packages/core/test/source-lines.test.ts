import { describe, expect, it } from "vitest";
import { joinSourceLines, sourceLinesOf } from "../src/sourceLines.js";
import { scanTasks } from "../src/vault/taskScan.js";
import { rewriteChecklistTaskText, setChecklistTaskDone, setChecklistTaskState, setHtmlCheckboxChecked } from "../src/vault/taskMutation.js";
import { parseJournal, toggleJournalTask } from "../src/journal.js";
import { analyzeNoteOutline } from "../src/noteSource.js";

/**
 * A note whose lines end in a carriage return of their own — a file from a
 * classic Mac — is lines for the task scan and for every writer that finds a
 * box by the scan's count, as it is for the editor (open-items plan 3.96
 * "remains", 3.142 no. 2 and no. 3).
 */
describe("sourceLinesOf", () => {
  it("ends a line where an editor ends one, and gives the text back", () => {
    for (const text of ["a\nb", "a\r\nb\r\n", "a\rb\r", "a\r\r\nb", "", "x", "a\r\rb"]) {
      expect(joinSourceLines(sourceLinesOf(text)), JSON.stringify(text)).toBe(text);
    }
    expect(sourceLinesOf("a\rb\r\nc\r\r\nd").map((line) => line.text)).toEqual(["a", "b", "c", "d"]);
    // As `split("\n")`: a text that ends in a line end has an empty last line.
    expect(sourceLinesOf("a\n").map((line) => line.text)).toEqual(["a", ""]);
  });
});

describe("the task scan in a note of carriage returns", () => {
  const MAC = "# Day\r- [ ] first\r- [ ]\r- [ ] b\rplain text\r";

  it("reads each line as its own: titles end with their line, an empty box is no task named after the next", () => {
    const tasks = scanTasks(MAC);
    expect(tasks.map((task) => [task.line, task.text])).toEqual([
      [1, "first"],
      [2, ""],
      [3, "b"],
    ]);
  });

  it("counts lines as in a note of `\\n` and of `\\r\\n`", () => {
    const lf = scanTasks(MAC.replace(/\r/g, "\n")).map((task) => [task.line, task.text]);
    expect(scanTasks(MAC).map((task) => [task.line, task.text])).toEqual(lf);
    expect(scanTasks(MAC.replace(/\r/g, "\r\n")).map((task) => [task.line, task.text])).toEqual(lf);
  });

  it("builds the successor of a repeating task from its own line, and keeps every line end", () => {
    const note = "- [ ] water plants 🔁 every day 📅 2026-11-02\rnext line\rlast\r";
    const result = setChecklistTaskDone(note, 0, true, { today: "2026-11-02", newId: () => "abc" });
    expect(result.changed).toBe(true);
    const lines = sourceLinesOf(result.content);
    expect(lines.map((line) => line.eol)).toEqual(["\r", "\r", "\r", "\r", ""]);
    expect(lines[0].text).toMatch(/^- \[ \] water plants 🔁 every day 📅 2026-11-03/);
    expect(lines[1].text).toMatch(/^- \[x\] water plants/);
    expect(lines.slice(2).map((line) => line.text)).toEqual(["next line", "last", ""]);
  });

  it("rewrites, sets the state of and ticks only the box's own line", () => {
    const note = "- [ ] a\r- [ ] b\rtail";
    expect(rewriteChecklistTaskText(note, 1, () => "B").content).toBe("- [ ] a\r- [ ] B\rtail");
    expect(setChecklistTaskState(note, 1, "progress").content).toBe("- [ ] a\r- [/] b\rtail");
    expect(setChecklistTaskDone(note, 1, true, { today: "2026-11-02" }).content).toBe("- [ ] a\r- [x] b\rtail");
    expect(setHtmlCheckboxChecked("a\r<input type=\"checkbox\"> x\rb", 0, true).content).toBe("a\r<input type=\"checkbox\" checked> x\rb");
  });

  it("finds a journal entry and its task on the line the scan gives it, as the outline counts lines", () => {
    const note = "## Journal\r- 08:00 coffee\r- [ ] 09:00 call Anna\r";
    expect(analyzeNoteOutline(note).map((node) => node.line)).toEqual([1, 2]);
    const entries = parseJournal(note).entries;
    expect(entries.map((entry) => [entry.line, entry.task])).toEqual([[1, null], [2, "open"]]);
    const result = toggleJournalTask(note, entries[1]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe("## Journal\r- 08:00 coffee\r- [x] 09:00 call Anna\r");
  });
});
