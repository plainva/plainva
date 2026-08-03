// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { applySelectionFormat } from "@plainva/ui";

function view(doc: string, from: number, to: number): EditorView {
  const state = EditorState.create({ doc, selection: { anchor: from, head: to } });
  return new EditorView({ state });
}

/**
 * The six formatting actions are shared between the shells since S18. These
 * pin the behaviour the desktop already had, so the move cannot change it.
 */
describe("selection formatting", () => {
  it("wraps a selection in the marker", () => {
    const v = view("hello world", 0, 5);
    applySelectionFormat(v, "bold", () => {});
    expect(v.state.doc.toString()).toBe("**hello** world");
  });

  it("builds a link with the url placeholder selected", () => {
    const v = view("the docs", 0, 8);
    applySelectionFormat(v, "link", () => {});
    expect(v.state.doc.toString()).toBe("[the docs](url)");
    const sel = v.state.selection.main;
    expect(v.state.sliceDoc(sel.from, sel.to)).toBe("url");
  });

  it("refuses a link across lines and says so", () => {
    const v = view("one\ntwo", 0, 7);
    const told = vi.fn();
    applySelectionFormat(v, "link", told);
    expect(told).toHaveBeenCalledOnce();
    expect(v.state.doc.toString()).toBe("one\ntwo");
  });

  it("does nothing without a selection", () => {
    const v = view("hello", 2, 2);
    applySelectionFormat(v, "bold", () => {});
    expect(v.state.doc.toString()).toBe("hello");
  });
});
