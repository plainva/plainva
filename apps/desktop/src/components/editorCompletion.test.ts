// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { completionStatus } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { editorCompletion } from "@plainva/ui";

/**
 * Escape and the editor's completion (plan Befunde 2026-09-24, E15): a menu on
 * screen takes the key; a query that is only running after a keystroke — every
 * source is pending for about 100 ms after each typed character — does not.
 * It used to: CodeMirror's binding cancelled the invisible query, reported the
 * key as handled, and the pinboard's "New entry" window did not close on an
 * Escape pressed right after typing.
 */
describe("editorCompletion: Escape", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
  });

  function mount(): EditorView {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: "", extensions: [editorCompletion({ getQueryService: () => null })] }),
      parent,
    });
    views.push(view);
    return view;
  }

  const type = (view: EditorView, text: string) =>
    view.dispatch({
      changes: { from: view.state.doc.length, insert: text },
      selection: { anchor: view.state.doc.length + text.length },
      userEvent: "input.type",
    });

  const escape = (view: EditorView) => runScopeHandlers(view, new KeyboardEvent("keydown", { key: "Escape" }), "editor");

  it("an Escape right after typing plain text is not swallowed — the query is cancelled and the key goes on", () => {
    const view = mount();
    type(view, "Bleibt stehen");
    expect(completionStatus(view.state)).toBe("pending");
    expect(escape(view)).toBe(false);
    expect(completionStatus(view.state)).toBeNull();
  });

  it("a menu on screen takes the Escape and closes", async () => {
    const view = mount();
    type(view, "/");
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"), { timeout: 3000 });
    expect(view.dom.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
    expect(escape(view)).toBe(true);
    expect(completionStatus(view.state)).toBeNull();
  });

  it("without any completion Escape is not the editor's", () => {
    const view = mount();
    expect(escape(view)).toBe(false);
  });
});
