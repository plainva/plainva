// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { listIndentPlugin, listMarkerPrefixLength, markdownDecorationPlugin } from "@plainva/ui";
import { forceFullParse } from "../test-parse";

/**
 * A list marker may be followed by one to four spaces (CommonMark), and many
 * generators write three: `*   item`, `4.  item` (finding 2026-11-02). Those
 * spaces belong to the marker, not to the item's text: the live preview draws
 * the same bullet and the same gap as for `- item`, whatever the item starts
 * with, and the hanging indent is measured up to the first letter of the text.
 */

/** What each line of `doc` shows in the live preview, with the caret on the last line. */
function renderedLines(doc: string, live = true): string[] {
  const state = forceFullParse(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage }), markdownDecorationPlugin(live), listIndentPlugin({ hideLeadingWhitespace: live })],
      selection: EditorSelection.single(doc.length),
    }),
  );
  const view = new EditorView({ state, parent: document.body });
  try {
    return Array.from(view.contentDOM.querySelectorAll(".cm-line"), (line) => line.textContent ?? "");
  } finally {
    view.destroy();
  }
}

describe("the spaces after a list marker", () => {
  it("count up to the first letter of the item's text, for every marker form", () => {
    expect(listMarkerPrefixLength("    *   *Lead:* text")).toBe(8);
    expect(listMarkerPrefixLength("4.  **Title:**")).toBe(4);
    expect(listMarkerPrefixLength("1)    text")).toBe(6);
    expect(listMarkerPrefixLength("+    **Four spaces**")).toBe(5);
    expect(listMarkerPrefixLength("-\ttext")).toBe(2);
    // Five or more: one space belongs to the marker, the rest is the item's
    // content (an indented code block in CommonMark).
    expect(listMarkerPrefixLength("-      code")).toBe(2);
  });

  it("count the task box and the spaces around it", () => {
    expect(listMarkerPrefixLength("-   [ ] task")).toBe(8);
    expect(listMarkerPrefixLength("- [x]   done")).toBe(8);
    expect(listMarkerPrefixLength("  *  [/] going")).toBe(9);
  });

  it("leave the existing one-space forms as they were", () => {
    expect(listMarkerPrefixLength("- item")).toBe(2);
    expect(listMarkerPrefixLength("- [ ] task")).toBe(6);
    expect(listMarkerPrefixLength("    10. item")).toBe(8);
  });
});

describe("the live preview of list items with several spaces after the marker", () => {
  const doc = [
    "4.  **Title:**",
    "    *   *Lead one:* Text after an italic lead-in.",
    "    *   *Lead two:* More text with **bold** and a tail *(in parens)*.",
    "    *   👉 **Summary:** **ca. 7 €** *(remark)*.",
    "    *   Plain item.",
    "        *   `code` lead.",
    "-   *Three* spaces",
    "+    **Four** spaces",
    "- One space",
    "1)  ~~Struck~~ lead",
    "-   [ ] *Task* after three spaces",
    "- [ ]   Task with spaces after the box",
    "",
    "end",
  ].join("\n");

  it("draws one bullet and one gap, whatever follows the marker", () => {
    const lines = renderedLines(doc);
    expect(lines.slice(0, 12)).toEqual([
      "4. Title:",
      "◦ Lead one: Text after an italic lead-in.",
      "◦ Lead two: More text with bold and a tail (in parens).",
      "◦ 👉 Summary: ca. 7 € (remark).",
      "◦ Plain item.",
      "▪ code lead.",
      "• Three spaces",
      "• Four spaces",
      "• One space",
      "1) Struck lead",
      " Task after three spaces",
      " Task with spaces after the box",
    ]);
  });

  it("keeps every space in source mode", () => {
    const lines = renderedLines(doc, false);
    expect(lines[1]).toBe("    *   *Lead one:* Text after an italic lead-in.");
    expect(lines[10]).toBe("-   [ ] *Task* after three spaces");
  });
});
