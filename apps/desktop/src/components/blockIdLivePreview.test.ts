// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { markdownDecorationPlugin } from "@plainva/ui";
import { forceFullParse } from "../test-parse";

/**
 * A block id in the live preview (Fehlerliste 0.9.0, B6): ` ^id` at the end
 * of a paragraph stood as text in the line, while the reading view hides it.
 * Faint while writing, as written on the caret's line, hidden while reading
 * (the phone's read mode is this editor, read-only).
 */
const DOC = "First paragraph ^intro\n\n- item text ^item\n\nSecond line\n\n`code ^no`\n\nplain caret^no\n\n| A |\n| - |\n| B |\n\n^table\n";

function decorated(view: EditorView): { faint: string[]; hidden: string[] } {
  const faint: string[] = [];
  const hidden: string[] = [];
  for (const set of view.state.facet(EditorView.decorations)) {
    const resolved = typeof set === "function" ? set(view) : set;
    const it = resolved.iter();
    while (it.value) {
      const spec = (it.value as unknown as { spec?: { class?: string; widget?: unknown; block?: boolean } }).spec ?? {};
      const text = view.state.sliceDoc(it.from, it.to);
      if (spec.class?.includes("cm-md-block-id")) faint.push(text);
      else if (spec.class === undefined && spec.widget === undefined && !spec.block && text.includes("^")) hidden.push(text);
      it.next();
    }
  }
  return { faint, hidden };
}

function view(at: number, editable = true): EditorView {
  return new EditorView({
    state: forceFullParse(EditorState.create({
      doc: DOC,
      extensions: [markdown(), markdownDecorationPlugin(true), EditorState.readOnly.of(!editable)],
      selection: EditorSelection.single(at),
    })),
    parent: document.body,
  });
}

describe("a block id in the live preview", () => {
  it("is faint away from the caret, and only a block id is", () => {
    const v = view(DOC.indexOf("Second"));
    try {
      expect(decorated(v)).toEqual({ faint: ["^intro", "^item", "^table"], hidden: [] });
    } finally {
      v.destroy();
    }
  });

  it("stands as it is written on the caret's line", () => {
    const v = view(DOC.indexOf("First") + 2);
    try {
      expect(decorated(v).faint).toEqual(["^item", "^table"]);
    } finally {
      v.destroy();
    }
  });

  it("is hidden while reading, with the blank in front of it", () => {
    const v = view(0, false);
    try {
      expect(decorated(v)).toEqual({ faint: [], hidden: [" ^intro", " ^item", "^table"] });
    } finally {
      v.destroy();
    }
  });

  it("stands as it is written in source mode", () => {
    const v = new EditorView({ state: forceFullParse(EditorState.create({ doc: DOC, extensions: [markdown(), markdownDecorationPlugin(false)] })), parent: document.body });
    try {
      expect(decorated(v)).toEqual({ faint: [], hidden: [] });
    } finally {
      v.destroy();
    }
  });
});
