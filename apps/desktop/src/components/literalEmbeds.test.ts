// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { buildNoteEmbedCoreExtension, imagePreviewPlugin, type NoteEmbedRenderer } from "@plainva/ui";

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

  it("still draws a picture in an HTML block, and after an escaped backslash", () => {
    // `<p align="center">` around a picture is common in notes from GitHub,
    // and the phone reads in the editor: the picture stays, as it always did.
    for (const doc of ["<p align=\"center\">\n![[a.png]]\n</p>", "A backslash \\\\![[a.png]] and then the picture"]) {
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
    expect(rendered).toEqual(["Real note"]);
    view.destroy();
  });
});
