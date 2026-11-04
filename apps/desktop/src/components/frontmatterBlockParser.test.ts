// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { forceFullParse } from "../test-parse";
import { frontmatterBlock, listBlocks, visibleTagRanges } from "@plainva/ui";
import { createComposeSession } from "@plainva/ui/mail";
import { FRONTMATTER_FORMS } from "../../../../packages/core/test/fixtures/frontmatterForms";
import { frontmatterLines, frontmatterLinesOf } from "../../../../packages/ui/src/components/editorFrontmatter";

/**
 * The editor's Markdown parser knows the properties block (Sammelplan § 3.46).
 *
 * It read the block's lines as Markdown. A YAML value that opens a code fence
 * or an HTML comment made a node from that line to the end of the note, and
 * everything that began inside the block was skipped: the whole note was code
 * to the editor — no formatting, no block handles, no tag pills, no spell
 * checking.
 */
const noteState = (doc: string) => forceFullParse(EditorState.create({ doc, extensions: [markdown({ extensions: [frontmatterBlock] })] }));

const FENCE_IN_VALUE = ["---", "snippet: |", "  ```", "  code", "---", "# Heading", "", "Some **bold** #tag", ""].join("\n");
const COMMENT_IN_VALUE = ["---", "note: <!-- open", "---", "# Heading", "", "Text #tag", ""].join("\n");

describe("the properties block as a node of the editor's tree", () => {
  it.each(FRONTMATTER_FORMS.map((form) => [JSON.stringify(form), form] as const))("is the block the editor's rule reads in %s", (_label, form) => {
    const state = noteState(form);
    const block = frontmatterLines(state.doc);
    const first = syntaxTree(state).topNode.firstChild;
    const node = first?.name === "FrontMatter" ? { from: first.from, to: first.to } : null;
    expect(node).toEqual(block ? { from: 0, to: block.closeTo } : null);
  });

  it("ends where the block ends, whatever a value opens", () => {
    for (const doc of [FENCE_IN_VALUE, COMMENT_IN_VALUE]) {
      const state = noteState(doc);
      const names: string[] = [];
      for (let child = syntaxTree(state).topNode.firstChild; child; child = child.nextSibling) names.push(child.name);
      expect(names).toEqual(["FrontMatter", "ATXHeading1", "Paragraph"]);
    }
  });

  it("gives the text behind it back its blocks and its tags", () => {
    for (const doc of [FENCE_IN_VALUE, COMMENT_IN_VALUE]) {
      const state = noteState(doc);
      expect(listBlocks(state).map((b) => b.type)).toEqual(["heading", "paragraph"]);
      expect(visibleTagRanges(state, [{ from: 0, to: state.doc.length }]).map((t) => t.name)).toEqual(["tag"]);
    }
  });

  it("reads a note that opens with a fence and never closes it as text", () => {
    const state = noteState("---\n# Heading\n\nText #tag\n");
    expect(syntaxTree(state).topNode.firstChild?.name).toBe("HorizontalRule");
    expect(visibleTagRanges(state, [{ from: 0, to: state.doc.length }]).map((t) => t.name)).toEqual(["tag"]);
  });

  it("finds the closing fence far down, past the first look ahead", () => {
    const yaml = Array.from({ length: 2000 }, (_, i) => `key${i}: value ${i}`);
    const state = noteState(["---", ...yaml, "---", "# Heading", ""].join("\n"));
    const first = syntaxTree(state).topNode.firstChild!;
    expect([first.name, first.to, first.nextSibling?.name]).toEqual(["FrontMatter", frontmatterLines(state.doc)!.closeTo, "ATXHeading1"]);
  });
});

describe("a message in the composer has no properties block", () => {
  it("leaves the text between two `---` lines prose", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const session = createComposeSession({ parent, doc: "---\nHello #team\n---\nBye", onChange: () => {} });
    const state = session.view.state;
    expect(frontmatterLinesOf(state)).toBeNull();
    expect(visibleTagRanges(state, [{ from: 0, to: state.doc.length }]).map((t) => t.name)).toEqual(["team"]);
    session.destroy();
  });
});
