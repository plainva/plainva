// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { buildNoteEmbedCoreExtension, imagePreviewPlugin, type NoteEmbedRenderer } from "@plainva/ui";
import { forceFullParse } from "../test-parse";

/**
 * Embed syntax inside code is an example, not an embed (TestFlight build 136,
 * iPad): the tour's lesson writes `![[Attachments/skizze.svg|240]]` in a code
 * span to show how a picture gets its width, and the live preview of both
 * shells drew the picture in the middle of the sentence. The read view of the
 * desktop and the note embeds already left code alone; the picture and sound
 * preview now asks the same question (literalSyntax.ts).
 */

function mountImages(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const readBinary = vi.fn(async () => new Uint8Array([1]));
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), imagePreviewPlugin("/vault", true, readBinary)] });
  const view = new EditorView({ state, parent });
  // The decorations follow the tree; a parse that yielded under load would draw too little.
  forceFullParse(view);
  return { view, parent, pictures: () => parent.querySelectorAll(".pv-image-embed").length };
}

describe("the picture preview leaves written-out syntax alone", () => {
  it("draws a picture that stands in the text", () => {
    const { view, pictures } = mountImages("Try an image width such as ![[Attachments/skizze.svg|240]] here.");
    expect(pictures()).toBe(1);
    view.destroy();
  });

  it("draws none in a code span — the tour's own sentence", () => {
    const { view, pictures, parent } = mountImages("Try an image width such as `![[Attachments/skizze.svg|240]]`; choose the real attachment path in your vault.");
    expect(pictures()).toBe(0);
    expect(parent.textContent).toContain("![[Attachments/skizze.svg|240]]");
    view.destroy();
  });

  it("draws none in a fenced block, an indented block or a comment, nor when escaped", () => {
    for (const doc of [
      "```\n![[a.png]]\n```",
      "Text\n\n    ![[a.png]]\n",
      "<!--\n![[a.png]]\n-->",
      "\\![[a.png]] stays text",
      "`![](a.png)` is the other spelling",
    ]) {
      const { view, pictures } = mountImages(doc);
      expect(pictures(), doc).toBe(0);
      view.destroy();
    }
  });

  it("draws none in an HTML block — one rule with the reading view and the note embeds (E12)", () => {
    // Obsidian renders no Markdown inside an HTML element (its help page
    // "HTML content"); the reading view and the note embeds left such an
    // embed as text, and only this preview drew it (3.131 no. 6).
    for (const doc of ["<p align=\"center\">\n![[a.png]]\n</p>", "<details>\n<summary>S</summary>\n![[a.png]]\n</details>", "<div>\n![](a.png)\n</div>"]) {
      const { view, pictures, parent } = mountImages(doc);
      expect(pictures(), doc).toBe(0);
      expect(parent.textContent, doc).toMatch(/!\[/);
      view.destroy();
    }
  });

  it("draws a picture behind a blank line that ends the HTML block, and after an escaped backslash", () => {
    for (const doc of ["<p align=\"center\">\n\n![[a.png]]\n\n</p>", "A backslash \\\\![[a.png]] and then the picture"]) {
      const { view, pictures } = mountImages(doc);
      expect(pictures(), doc).toBe(1);
      view.destroy();
    }
  });
});

describe("a note embed in code stays text as well", () => {
  it("renders no card for `![[Note]]` in a code span", () => {
    const rendered: string[] = [];
    const renderer: NoteEmbedRenderer = { render(_container, target) { rendered.push(target); return () => {}; } };
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const state = EditorState.create({ doc: "Write `![[Note]]` to embed, like this:\n\n![[Real note]]", extensions: [markdown({ base: markdownLanguage }), buildNoteEmbedCoreExtension(renderer, true)] });
    const view = new EditorView({ state, parent });
    forceFullParse(view);
    expect(rendered).toEqual(["Real note"]);
    view.destroy();
  });
});
