// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { caretInListItem, shiftListIndent } from "@plainva/ui";

/**
 * The phone's keyboard toolbar shows indent and outdent while the caret is in
 * a list (wish TestFlight 2026-10-25, W2). The commands are the desktop's Tab
 * and Shift+Tab, so a list nested on the phone nests the same way there.
 */
function stateAt(doc: string, caret: number) {
  const state = EditorState.create({ doc, selection: { anchor: caret }, extensions: [markdown()] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
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
