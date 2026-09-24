// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { calloutLine, calloutLineClass, calloutTint, listIndentPlugin, markdownDecorationPlugin } from "@plainva/ui";
import { isDoneTaskItem } from "./markdownReaderModel";
import { forceFullParse } from "../test-parse";

/**
 * The note body (finding 2026-09-19): a callout is ONE card although the editor
 * only has lines, a done task reads like one, and nested list levels get an
 * indent guide. This pins the classes and ranges the theme then draws.
 */
interface Deco { from: number; to: number; cls: string }

function decorations(doc: string, caret = 0): { view: EditorView; all: Deco[] } {
  // The whole tree before the view exists: the plugins draw from it once, at
  // construction, and CodeMirror's first parse is a 20 ms wall-clock slice. A
  // busy machine (the pre-commit hook runs every suite) cut it short, and a
  // callout or a done task read as plain lines (test-parse.ts).
  const state = forceFullParse(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), markdownDecorationPlugin(true), listIndentPlugin({ hideLeadingWhitespace: true })],
      selection: EditorSelection.single(caret),
    }),
  );
  const view = new EditorView({ state, parent: document.body });
  const all: Deco[] = [];
  for (const source of view.state.facet(EditorView.decorations)) {
    const set: DecorationSet = typeof source === "function" ? source(view) : source;
    for (const it = set.iter(); it.value; it.next()) {
      const cls = (it.value.spec as { class?: string }).class;
      if (cls) all.push({ from: it.from, to: it.to, cls });
    }
  }
  return { view, all };
}

const lineClasses = (doc: string, caret = 0): string[] => {
  const { view, all } = decorations(doc, caret);
  try {
    const out: string[] = [];
    for (let n = 1; n <= view.state.doc.lines; n++) {
      const from = view.state.doc.line(n).from;
      out.push(all.filter((d) => d.from === from && d.to === from).map((d) => d.cls).sort().join(" "));
    }
    return out;
  } finally {
    view.destroy();
  }
};

describe("a callout is one card", () => {
  it("names the position of a line within the card", () => {
    expect(calloutLineClass("blue", 3, 3, 5)).toBe("cm-callout cm-callout-blue cm-callout--first");
    expect(calloutLineClass("blue", 4, 3, 5)).toBe("cm-callout cm-callout-blue");
    expect(calloutLineClass("blue", 5, 3, 5)).toBe("cm-callout cm-callout-blue cm-callout--last");
    // One line is first AND last: a card of its own, not an open top.
    expect(calloutLineClass("amber", 7, 7, 7)).toBe("cm-callout cm-callout-amber cm-callout--first cm-callout--last");
  });

  it("puts those classes on the lines, and leaves a plain quote its bar", () => {
    const doc = ["text", "", "> [!tip] Title", "> body one", "> body two", "", "> [!warning]", "", "> plain quote"].join("\n");
    const classes = lineClasses(doc);
    expect(classes[2]).toBe("cm-callout cm-callout-green cm-callout--first");
    expect(classes[3]).toBe("cm-callout cm-callout-green");
    expect(classes[4]).toBe("cm-callout cm-callout-green cm-callout--last");
    expect(classes[6]).toBe("cm-callout cm-callout-amber cm-callout--first cm-callout--last");
    expect(classes[8]).toBe("cm-blockquote-line");
    expect(classes[0]).toBe("");
  });

  it("takes line and tint from the mode's strength, mixed with transparent", () => {
    expect(calloutLine("blue")).toBe("color-mix(in srgb, var(--callout-blue, #3a8ca6) var(--callout-line, 42%), transparent)");
    expect(calloutTint("blue")).toContain("var(--callout-blue-tint");
  });
});

describe("a done task reads like one", () => {
  it("marks the text of a checked task, not the box, and not an open task", () => {
    const doc = ["- [x] done thing", "- [ ] open thing", "- [X] also done"].join("\n");
    const { view, all } = decorations(doc, doc.length);
    try {
      const done = all.filter((d) => d.cls === "cm-md-task-done").map((d) => view.state.sliceDoc(d.from, d.to));
      expect(done).toEqual(["done thing", "also done"]);
    } finally {
      view.destroy();
    }
  });

  it("keeps the mark while the caret is on the line - the task is still done", () => {
    const doc = "- [x] done thing";
    const { view, all } = decorations(doc, 8);
    try {
      expect(all.some((d) => d.cls === "cm-md-task-done")).toBe(true);
    } finally {
      view.destroy();
    }
  });

  it("reads the same fact from the reading view's list item", () => {
    const box = (checked: boolean) => ({ type: "element", tagName: "input", properties: { type: "checkbox", checked } });
    expect(isDoneTaskItem({ type: "element", tagName: "li", children: [box(true), { type: "text" }] })).toBe(true);
    expect(isDoneTaskItem({ type: "element", tagName: "li", children: [box(false)] })).toBe(false);
    // A loose list wraps the box in a paragraph.
    expect(isDoneTaskItem({ type: "element", tagName: "li", children: [{ type: "text" }, { type: "element", tagName: "p", children: [box(true)] }] })).toBe(true);
    // A checked box further down belongs to a nested item, not to this one.
    const nested = { type: "element", tagName: "ul", children: [{ type: "element", tagName: "li", children: [box(true)] }] };
    expect(isDoneTaskItem({ type: "element", tagName: "li", children: [box(false), nested] })).toBe(false);
    expect(isDoneTaskItem(null)).toBe(false);
  });
});

describe("indent guides", () => {
  it("draws one guide per PARENT level, from the second level on", () => {
    const doc = ["- one", "  - two", "    - three", "  - two again", "- one again"].join("\n");
    const classes = lineClasses(doc, doc.length);
    expect(classes).toEqual(["", "cm-list-guides-1", "cm-list-guides-2", "cm-list-guides-1", ""]);
  });
});
