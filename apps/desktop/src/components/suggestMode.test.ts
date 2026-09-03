// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createSuggestMode } from "../../../../packages/ui/src/components/suggestMode";
import { suggestionBase, suggestionChunks } from "@plainva/ui";

/**
 * The suggestion mode inside the editor (plan Vorschlagsmodus, V2): typing in
 * the mode edits a copy, the base stays; the chunks between the two are what
 * the shell turns into proposal records; stopping puts the base back.
 */
describe("suggest mode", () => {
  const BASE = "The contract runs until the end of the year.\nThe electrician is a separate firm.\nReserve 10 %.\n";

  function viewWith(): { view: EditorView; mode: ReturnType<typeof createSuggestMode> } {
    const mode = createSuggestMode();
    const view = new EditorView({ state: EditorState.create({ doc: BASE, extensions: [mode.extension] }), parent: document.body });
    return { view, mode };
  }

  it("reports a replacement, an insertion and a deletion as chunks against the base", () => {
    const { view, mode } = viewWith();
    const counts: number[] = [];
    try {
      expect(suggestionBase(view.state)).toBeNull();
      mode.start(view, (n) => counts.push(n));
      expect(suggestionBase(view.state)).toBe(BASE);
      // Replace on line 1, insert a whole line after line 2, delete line 3.
      const from = BASE.indexOf("until the end of the year");
      view.dispatch({ changes: { from, to: from + "until the end of the year".length, insert: "for 30 days from the offer date" } });
      const afterLine2 = view.state.doc.toString().indexOf("Reserve");
      view.dispatch({ changes: { from: afterLine2, insert: "Acceptance follows the electrics.\n" } });
      const reserve = view.state.doc.toString().indexOf("Reserve 10 %.\n");
      view.dispatch({ changes: { from: reserve, to: reserve + "Reserve 10 %.\n".length, insert: "" } });
      const chunks = suggestionChunks(view.state);
      // Word-level (finding 2026-09-03): the changed clauses, not the whole
      // line - a one-word edit must read as a one-word edit.
      expect(chunks.map((c) => [BASE.slice(c.fromA, c.toA), c.replacement])).toEqual([
        ["until the end of", "for 30 days from"],
        ["year", "offer date"],
        ["Reserve 10 %", "Acceptance follows the electrics"],
      ]);
      expect(counts[counts.length - 1]).toBe(3);
      mode.stop(view);
      expect(view.state.doc.toString()).toBe(BASE);
      expect(suggestionBase(view.state)).toBeNull();
      expect(suggestionChunks(view.state)).toEqual([]);
    } finally {
      view.destroy();
    }
  });

  it("draws a changed clause inside its paragraph - struck words where they stood, new words marked", () => {
    const { view, mode } = viewWith();
    try {
      mode.start(view);
      const from = BASE.indexOf("separate");
      view.dispatch({ changes: { from, to: from + "separate".length, insert: "different" } });
      const del = view.contentDOM.querySelector(".cm-suggest-del");
      const ins = view.contentDOM.querySelector(".cm-suggest-ins");
      expect(del?.textContent).toBe("separate");
      expect(ins?.textContent).toBe("different");
      // Both sit in the one line the change belongs to; nothing else is marked.
      expect(view.contentDOM.querySelectorAll(".cm-suggest-del, .cm-suggest-ins").length).toBe(2);
      expect(del?.closest(".cm-line")?.textContent).toContain("The electrician is a");
    } finally {
      view.destroy();
    }
  });

  it("gives a pure insertion an empty base range", () => {
    const { view, mode } = viewWith();
    try {
      mode.start(view);
      view.dispatch({ changes: { from: BASE.length, insert: "Added at the end.\n" } });
      const [chunk] = suggestionChunks(view.state);
      expect(chunk.fromA).toBe(chunk.toA);
      expect(chunk.replacement).toBe("Added at the end.\n");
    } finally {
      view.destroy();
    }
  });
});
