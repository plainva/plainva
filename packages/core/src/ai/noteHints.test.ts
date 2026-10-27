import { describe, expect, it } from "vitest";
import { noteHintKey, noteHints, todoAsTask, todoLineOf, todoLines, withTodoAsTask } from "./noteHints.js";

/**
 * Calm hints at the open note without a model (plan KI-Harness P8-3): which
 * lines are TODO lines, the line as a task where it stands, and which three
 * hints a note gets.
 */

const BOM = String.fromCharCode(0xfeff);

describe("a TODO line", () => {
  it("is the marker at the start of a line, then a blank or a colon, then words — as a list item too", () => {
    expect(todoLineOf("TODO Studio anfragen")).toEqual({ indent: "", bullet: null, rest: "Studio anfragen" });
    expect(todoLineOf("Todo: call Tom ")).toEqual({ indent: "", bullet: null, rest: "call Tom" });
    expect(todoLineOf("  - todo:book the room")).toEqual({ indent: "  ", bullet: "-", rest: "book the room" });
    expect(todoLineOf("* ToDo   ask")).toEqual({ indent: "", bullet: "*", rest: "ask" });
    expect(todoLineOf("\tTODO: tabs")).toEqual({ indent: "\t", bullet: null, rest: "tabs" });
  });

  it("is no word that merely begins with the marker, no heading, quote or task, and nothing without words", () => {
    for (const line of ["TODOs for Monday", "Todoist export", "# TODO list", "> TODO quoted", "- [ ] TODO already a task", "TODO", "TODO:   ", "Do TODO later", "-TODO no blank after the mark"]) {
      expect(todoLineOf(line), line).toBeNull();
    }
  });

  it("is looked for outside the properties block and the code blocks, with the line it stands on", () => {
    const note = ["---", "todo: not a line of the text", "---", "# Plan", "TODO first", "```", "TODO in code", "```", "- [ ] a task", "- TODO second"].join("\n");
    expect(todoLines(note).map(({ line, todo }) => [line, todo.rest])).toEqual([
      [5, "first"],
      [10, "second"],
    ]);
    // Windows line ends and a byte order mark do not move a line or hide the first one.
    expect(todoLines(`${BOM}TODO top\r\nmore\r\nTODO three`).map(({ line, raw }) => [line, raw])).toEqual([
      [1, "TODO top"],
      [3, "TODO three"],
    ]);
  });

  it("knows code by the task scanners' one fence rule: a run as long as the opening one closes it, and inline code opens nothing", () => {
    // "```" does not close "````", so the TODO behind it is code; "```js```" is a code span, so the TODO behind it is text.
    const note = ["````", "```", "TODO still code", "````", "```js``` is a span", "TODO after"].join("\n");
    expect(todoLines(note).map(({ line, todo }) => [line, todo.rest])).toEqual([[6, "after"]]);
  });
});

describe("a TODO line as a task", () => {
  it("keeps its indentation and list mark, and drops the marker", () => {
    expect(todoAsTask(todoLineOf("TODO Studio anfragen")!)).toBe("- [ ] Studio anfragen");
    expect(todoAsTask(todoLineOf("  * Todo: Tom anrufen")!)).toBe("  * [ ] Tom anrufen");
  });

  it("changes that one line and nothing else — line ends and byte order mark included", () => {
    const note = `${BOM}TODO first\r\nkeep\r\n  - TODO: second\r\n`;
    expect(withTodoAsTask(note, 3, "  - TODO: second")).toBe(`${BOM}TODO first\r\nkeep\r\n  - [ ] second\r\n`);
    expect(withTodoAsTask(note, 1, "TODO first")).toBe(`${BOM}- [ ] first\r\nkeep\r\n  - TODO: second\r\n`);
  });

  it("changes nothing where the line is no longer what the hint was about", () => {
    expect(withTodoAsTask("TODO changed meanwhile\n", 1, "TODO first")).toBeNull();
    expect(withTodoAsTask("one line\n", 5, "TODO first")).toBeNull();
    expect(withTodoAsTask("plain words\n", 1, "plain words")).toBeNull();
  });
});

describe("the hints of a note", () => {
  const path = "Journal/2026-10-09.md";
  const input = {
    path,
    links: [
      { label: "[[Drehplan Winter]]", line: 3 },
      { label: "[[Budget 2027]]", line: 4 },
    ],
    todos: [
      { line: 6, rest: "Studio anfragen" },
      { line: 7, rest: "Tom anrufen" },
    ],
    meetings: [{ uid: "ev-1", title: "Studio Hafenkante" }],
    dismissed: new Set<string>(),
  };

  it("are at most three, one of each kind in turn", () => {
    expect(noteHints(input).map((hint) => [hint.kind, hint.subject, hint.line])).toEqual([
      ["link", "[[Drehplan Winter]]", 3],
      ["todo", "Studio anfragen", 6],
      ["meeting", "Studio Hafenkante", null],
    ]);
    expect(noteHints({ ...input, meetings: [] }).map((hint) => hint.subject)).toEqual(["[[Drehplan Winter]]", "Studio anfragen", "[[Budget 2027]]"]);
    expect(noteHints({ ...input, links: [], todos: [], meetings: [] })).toEqual([]);
  });

  it("leave out what was hidden, and name the thing as it stands — a changed line asks again", () => {
    const hidden = new Set([noteHintKey(path, "link", "[[Drehplan Winter]]"), noteHintKey(path, "todo", "Studio anfragen")]);
    expect(noteHints({ ...input, dismissed: hidden }).map((hint) => hint.subject)).toEqual(["[[Budget 2027]]", "Tom anrufen", "Studio Hafenkante"]);
    expect(noteHints({ ...input, todos: [{ line: 6, rest: "Studio für Block zwei anfragen" }], links: [], meetings: [], dismissed: hidden }).map((hint) => hint.subject)).toEqual(["Studio für Block zwei anfragen"]);
    // The same thing in another note is another hint.
    expect(noteHintKey(path, "todo", "x")).not.toBe(noteHintKey("Other.md", "todo", "x"));
  });

  it("name each thing once", () => {
    expect(noteHints({ ...input, links: [{ label: "[[A]]", line: 1 }, { label: "[[A]]", line: 9 }], todos: [], meetings: [] })).toHaveLength(1);
  });
});
