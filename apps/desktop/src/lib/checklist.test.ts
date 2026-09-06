import { describe, expect, it } from "vitest";
import { appendTaskLine, listTaskLines, parseTaskProgress, toggleTaskAtIndex } from "@plainva/ui";
import { formatTaskProgress, taskProgressOf } from "@plainva/core";

// The checklist on a board card (issue #83, P4): the index counts the note's
// checkbox lines, the card lists them with the SAME ordinals the toggle uses,
// and a new sub-task lands after the last checkbox in the same list style.

describe("taskProgressOf / formatTaskProgress (the `file.tasks` column)", () => {
  it("counts done and total outside fences, empty when the note has none", () => {
    expect(taskProgressOf("- [x] a\n- [ ] b\n```\n- [ ] not a task\n```\n> - [X] c")).toEqual({ done: 2, total: 3 });
    expect(formatTaskProgress(taskProgressOf("- [x] a\n- [ ] b"))).toBe("1/2");
    expect(formatTaskProgress(taskProgressOf("# no tasks\n\nplain text"))).toBe("");
  });
});

describe("parseTaskProgress", () => {
  it("reads the index value and rejects everything else", () => {
    expect(parseTaskProgress("3/5")).toEqual({ done: 3, total: 5 });
    expect(parseTaskProgress("")).toBeNull();
    expect(parseTaskProgress("0/0")).toBeNull();
    expect(parseTaskProgress(7)).toBeNull();
    expect(parseTaskProgress("9/5")).toEqual({ done: 5, total: 5 });
  });
});

describe("listTaskLines", () => {
  it("lists every checkbox with the ordinal toggleTaskAtIndex expects", () => {
    const src = ["- [ ] eins", "  - [x] zwei", "```", "- [ ] code", "```", "> * [X] drei"].join("\n");
    const lines = listTaskLines(src);
    expect(lines.map((l) => [l.ordinal, l.done, l.text])).toEqual([
      [0, false, "eins"],
      [1, true, "zwei"],
      [2, true, "drei"],
    ]);
    // The ordinal really flips that line.
    expect(toggleTaskAtIndex(src, lines[2].ordinal, false).content).toContain("> * [ ] drei");
  });

  it("is empty for a note without checkboxes", () => {
    expect(listTaskLines("just prose\n- a bullet")).toEqual([]);
  });
});

describe("appendTaskLine", () => {
  it("appends after the last checkbox in the same list style", () => {
    const src = "# Task\n\n- [x] eins\n  - [ ] zwei\n\nNotes below.";
    expect(appendTaskLine(src, "drei")).toBe("# Task\n\n- [x] eins\n  - [ ] zwei\n  - [ ] drei\n\nNotes below.");
  });

  it("goes to the end when the note has no checklist, on its own line", () => {
    expect(appendTaskLine("# Task\n\nSome text", "eins")).toBe("# Task\n\nSome text\n- [ ] eins\n");
    expect(appendTaskLine("", "eins")).toBe("- [ ] eins\n");
    expect(appendTaskLine("text\n", "eins")).toBe("text\n- [ ] eins\n");
  });

  it("ignores checkboxes inside fences and keeps the text on one line", () => {
    const src = "- [ ] real\n```\n- [ ] fenced\n```\n";
    expect(appendTaskLine(src, "new\nline")).toBe("- [ ] real\n- [ ] new line\n```\n- [ ] fenced\n```\n");
    expect(appendTaskLine(src, "   ")).toBe(src);
  });
});
