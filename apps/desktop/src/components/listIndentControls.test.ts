// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { forceFullParse } from "../test-parse";
import { caretInListItem, shiftListIndent } from "@plainva/ui";

/**
 * The phone's keyboard toolbar shows indent and outdent while the caret is in
 * a list (wish TestFlight 2026-10-25, W2). The commands are the desktop's Tab
 * and Shift+Tab, so a list nested on the phone nests the same way there.
 */
function stateAt(doc: string, caret: number) {
  // forceFullParse returns a state whose tree snapshot holds the whole parse;
  // `ensureSyntaxTree` alone drives the parser but leaves `syntaxTree(state)`
  // at the window the state was created with (it failed under load, 2026-11-10).
  return forceFullParse(EditorState.create({ doc, selection: { anchor: caret }, extensions: [markdown()] }));
}

describe("list controls of the keyboard toolbar", () => {
  const doc = "# Title\n\n- one\n- two\n- [ ] task\n1. first\n\nplain";
  const at = (needle: string, offset = 0) => doc.indexOf(needle) + offset;
  it("knows when the caret is in a list item - bullets, tasks, numbers, at the end of the line too", () => {
    expect(caretInListItem(stateAt(doc, at("two", 3)))).toBe(true);
    expect(caretInListItem(stateAt(doc, at("task", 4)))).toBe(true);
    expect(caretInListItem(stateAt(doc, at("first", 0)))).toBe(true);
    expect(caretInListItem(stateAt(doc, at("plain", 2)))).toBe(false);
    expect(caretInListItem(stateAt(doc, at("Title", 1)))).toBe(false);
  });
  it("knows a list item beyond the part of a long note the editor has parsed yet", () => {
    // A state reads the first few thousand characters when it is created; the
    // rest is parsed later. A caret far down in a list must still count as in
    // the list, or the phone's keyboard toolbar offers the wrong controls.
    const long = `${"A paragraph of plain prose that the parser has to read first.\n\n".repeat(400)}- item at the end\n`;
    const caret = long.indexOf("item at the end") + 4;
    const fresh = EditorState.create({ doc: long, selection: { anchor: caret }, extensions: [markdown()] });
    expect(fresh.doc.length).toBeGreaterThan(20_000);
    expect(caretInListItem(fresh)).toBe(true);
    expect(caretInListItem(EditorState.create({ doc: long, selection: { anchor: 3 }, extensions: [markdown()] }))).toBe(false);
  });

  it("indents and outdents the line the way Tab and Shift+Tab do", () => {
    const parent = document.createElement("div");
    const view = new EditorView({ state: stateAt("- one\n- two", 9), parent });
    expect(shiftListIndent(view, 1)).toBe(true);
    const indented = view.state.doc.line(2).text;
    expect(indented === "- two").toBe(false);
    expect(indented.trimStart()).toBe("- two");
    expect(shiftListIndent(view, -1)).toBe(true);
    expect(view.state.doc.line(2).text).toBe("- two");
    view.destroy();
  });
});
