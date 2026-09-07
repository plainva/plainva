// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { rangeCoversRenderedContent, selectAllBridge, widenSelectAll } from "@plainva/ui";

/**
 * Build-91 feedback, P5: "Select All" from the platform reached only what
 * CodeMirror had rendered. The bridge recognises a DOM selection that spans
 * everything rendered and widens the state selection to the whole document.
 */
describe("selectAllBridge", () => {
  const DOC = Array.from({ length: 40 }, (_, i) => `Zeile ${i + 1} mit etwas Text`).join("\n");

  function mount() {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state: EditorState.create({ doc: DOC, extensions: [selectAllBridge()] }), parent });
    return view;
  }

  function selectRendered(view: EditorView) {
    const range = document.createRange();
    range.selectNodeContents(view.contentDOM);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    return range;
  }

  it("recognises a range over the whole rendered content", () => {
    const view = mount();
    const range = selectRendered(view);
    expect(rangeCoversRenderedContent(range, view.contentDOM)).toBe(true);
    // A range over a single line is not "all of it".
    const partial = document.createRange();
    partial.selectNodeContents(view.contentDOM.firstChild as Node);
    expect(rangeCoversRenderedContent(partial, view.contentDOM)).toBe(false);
    view.destroy();
  });

  it("widens the state selection to the whole document", () => {
    const view = mount();
    selectRendered(view);
    expect(widenSelectAll(view)).toBe(true);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(DOC.length);
    // Already everything: nothing to do.
    expect(widenSelectAll(view)).toBe(false);
    view.destroy();
  });

  it("leaves a collapsed or partial selection alone", () => {
    const view = mount();
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    expect(widenSelectAll(view)).toBe(false);
    const partial = document.createRange();
    partial.selectNodeContents(view.contentDOM.firstChild as Node);
    sel.addRange(partial);
    expect(widenSelectAll(view)).toBe(false);
    view.destroy();
  });
});
