// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { foldedRanges } from "@codemirror/language";
import { isLineFolded, listFoldRange, markdownFolding, toggleFoldAtLine } from "@plainva/ui";

/**
 * List folding (feedback round 2026-09-01, T8c / P10). Headings, quotes and
 * code blocks folded before; list items did not — and on the phone nothing
 * folded at all, because folding hung on a keymap. The range rule and the
 * bullet's toggle are pinned here; the bullet itself is a live-preview widget.
 */
const doc = [
  "- Parent",          // 1
  "  - child one",     // 2
  "",                  // 3
  "  - child two",     // 4
  "    - grandchild",  // 5
  "- Sibling",         // 6
  "- Flat",            // 7
  "",                  // 8
  "Paragraph after",   // 9
].join("\n");

const state = () => EditorState.create({ doc, extensions: [markdownFolding()] });
const lineFrom = (s: EditorState, n: number) => s.doc.line(n).from;

describe("listFoldRange", () => {
  it("folds a parent over every deeper line, blank lines included", () => {
    const s = state();
    const r = listFoldRange(s, lineFrom(s, 1));
    expect(r).toEqual({ from: s.doc.line(1).to, to: s.doc.line(5).to });
  });

  it("folds a nested item over its own children only", () => {
    const s = state();
    expect(listFoldRange(s, lineFrom(s, 4))).toEqual({ from: s.doc.line(4).to, to: s.doc.line(5).to });
    expect(listFoldRange(s, lineFrom(s, 2))).toBeNull();
  });

  it("offers nothing for a flat item, a sibling, or a non-list line", () => {
    const s = state();
    expect(listFoldRange(s, lineFrom(s, 6))).toBeNull();
    expect(listFoldRange(s, lineFrom(s, 7))).toBeNull();
    expect(listFoldRange(s, lineFrom(s, 9))).toBeNull();
  });

  it("understands ordered lists and tab indents", () => {
    const s = EditorState.create({ doc: "1. one\n\t- deep\n2. two", extensions: [markdownFolding()] });
    expect(listFoldRange(s, 0)).toEqual({ from: s.doc.line(1).to, to: s.doc.line(2).to });
    expect(listFoldRange(s, lineFrom(s, 3))).toBeNull();
  });
});

describe("toggleFoldAtLine", () => {
  it("folds on the first toggle, unfolds on the second, and ignores a flat line", () => {
    const parent = document.createElement("div");
    const view = new EditorView({ state: state(), parent });
    try {
      const at = view.state.doc.line(1).from;
      expect(isLineFolded(view.state, at)).toBe(false);
      expect(toggleFoldAtLine(view, at)).toBe(true);
      expect(isLineFolded(view.state, at)).toBe(true);
      let ranges = 0;
      foldedRanges(view.state).between(0, view.state.doc.length, () => { ranges += 1; });
      expect(ranges).toBe(1);
      expect(toggleFoldAtLine(view, at)).toBe(true);
      expect(isLineFolded(view.state, at)).toBe(false);
      expect(toggleFoldAtLine(view, view.state.doc.line(7).from)).toBe(false);
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});
