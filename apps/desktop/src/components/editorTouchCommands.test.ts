// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  toggleInlineMark,
  insertMarkdownLink,
  setHeadingLevel,
  toggleTaskLine,
} from "@plainva/ui";

/** Runs a command against a fresh view and returns the resulting doc + caret. */
function run(
  doc: string,
  sel: { anchor: number; head: number },
  fn: (v: EditorView) => void,
): { text: string; from: number; to: number } {
  const view = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.range(sel.anchor, sel.head) }),
  });
  fn(view);
  const main = view.state.selection.main;
  const out = { text: view.state.doc.toString(), from: main.from, to: main.to };
  view.destroy();
  return out;
}
const atCursor = (doc: string, at: number, fn: (v: EditorView) => void) =>
  run(doc, { anchor: at, head: at }, fn);

describe("editor formatting shortcuts (keyboard rollout)", () => {
  it("bold wraps and unwraps the selection (Mod+B)", () => {
    const wrapped = run("foo", { anchor: 0, head: 3 }, (v) => toggleInlineMark(v, "**"));
    expect(wrapped.text).toBe("**foo**");
    // The selection tracks the inner text so a second press unwraps it.
    expect([wrapped.from, wrapped.to]).toEqual([2, 5]);
    const unwrapped = run("**foo**", { anchor: 2, head: 5 }, (v) => toggleInlineMark(v, "**"));
    expect(unwrapped.text).toBe("foo");
  });

  it("italic and strikethrough use their markers", () => {
    expect(run("hi", { anchor: 0, head: 2 }, (v) => toggleInlineMark(v, "*")).text).toBe("*hi*");
    expect(run("hi", { anchor: 0, head: 2 }, (v) => toggleInlineMark(v, "~~")).text).toBe("~~hi~~");
    expect(run("hi", { anchor: 0, head: 2 }, (v) => toggleInlineMark(v, "==")).text).toBe("==hi==");
  });

  it("formats every selected Markdown line while preserving block prefixes", () => {
    const source = "## Release\n- [ ] Ship it\n> quoted";
    const wrapped = run(source, { anchor: 0, head: source.length }, (v) => toggleInlineMark(v, "**"));
    expect(wrapped.text).toBe("## **Release**\n- [ ] **Ship it**\n> **quoted**");
    const unwrapped = run(wrapped.text, { anchor: 0, head: wrapped.text.length }, (v) => toggleInlineMark(v, "**"));
    expect(unwrapped.text).toBe(source);
  });

  it("fills only missing marks in a mixed multi-line selection", () => {
    const source = "**already**\nplain";
    expect(run(source, { anchor: 0, head: source.length }, (v) => toggleInlineMark(v, "**")).text)
      .toBe("**already**\n**plain**");
  });

  it("insert link wraps the selection and parks the caret inside the parens (Mod+K)", () => {
    const r = run("foo", { anchor: 0, head: 3 }, (v) => insertMarkdownLink(v));
    expect(r.text).toBe("[foo]()");
    expect(r.from).toBe(6); // between "(" and ")"
    // Empty selection inserts a ready-to-type link.
    expect(atCursor("", 0, (v) => insertMarkdownLink(v)).text).toBe("[]()");
  });

  it("sets and clears heading levels (Mod+Shift+1..3 / Mod+Shift+0)", () => {
    expect(atCursor("foo", 0, (v) => setHeadingLevel(v, 2)).text).toBe("## foo");
    expect(atCursor("## foo", 1, (v) => setHeadingLevel(v, 1)).text).toBe("# foo");
    expect(atCursor("### foo", 0, (v) => setHeadingLevel(v, 0)).text).toBe("foo");
    expect(atCursor("- [ ] foo", 0, (v) => setHeadingLevel(v, 2)).text).toBe("- [ ] foo");
  });

  it("toggles the task checkbox on the current line (Mod+Enter)", () => {
    expect(atCursor("foo", 0, (v) => toggleTaskLine(v)).text).toBe("- [ ] foo");
    expect(atCursor("- [ ] foo", 0, (v) => toggleTaskLine(v)).text).toBe("- [x] foo");
    expect(atCursor("- [x] foo", 0, (v) => toggleTaskLine(v)).text).toBe("- [ ] foo");
    // A bare bullet becomes a task without duplicating the marker.
    expect(atCursor("- foo", 0, (v) => toggleTaskLine(v)).text).toBe("- [ ] foo");
    expect(atCursor("## foo", 0, (v) => toggleTaskLine(v)).text).toBe("## foo");
  });
});
