// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { markdownDecorationPlugin } from "@plainva/ui";
import { forceFullParse } from "../test-parse";

/**
 * Issue 175: on the phone a fenced code block showed as plain text. The phone
 * always shows a note in the editor's live preview (`createEditorSession`,
 * mode "live", the same session the desktop editor uses), and in 0.8.7 the
 * live preview had no styling for code blocks; the desktop only hid it behind
 * its reading view's code card. Fixed with 77958a0d3 (X6); this pins it: each
 * line of the block is part of one card, and the info string is its label.
 */
const DOC = "Intro\n\n```js\nconst a = 1;\nconsole.log(a);\n```\n\nAfter\n";

function mount(isLive: boolean, caret = 0): EditorView {
  return new EditorView({
    state: forceFullParse(EditorState.create({ doc: DOC, extensions: [markdown(), markdownDecorationPlugin(isLive)], selection: EditorSelection.single(caret) })),
    parent: document.body,
  });
}

function lineClasses(view: EditorView): string[] {
  return [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")].map((el) => el.className);
}

describe("a fenced code block in the live preview (issue 175)", () => {
  it("draws every line of the block as one card, with the language as its label", () => {
    const view = mount(true);
    try {
      const classes = lineClasses(view);
      // Lines: Intro, "", ```js, const…, console…, ```, "", After
      expect(classes[2]).toContain("cm-md-codeblock--first");
      expect(classes[3]).toContain("cm-md-codeblock");
      expect(classes[4]).toContain("cm-md-codeblock");
      expect(classes[5]).toContain("cm-md-codeblock--last");
      expect(classes[0]).not.toContain("cm-md-codeblock");
      expect(classes[7]).not.toContain("cm-md-codeblock");
      expect(view.contentDOM.querySelector(".cm-md-codeinfo")?.textContent).toBe("js");
    } finally {
      view.destroy();
    }
  });

  it("keeps the card while the caret is inside the block", () => {
    const view = mount(true, DOC.indexOf("console"));
    try {
      expect(lineClasses(view).filter((c) => c.includes("cm-md-codeblock"))).toHaveLength(4);
    } finally {
      view.destroy();
    }
  });
});
