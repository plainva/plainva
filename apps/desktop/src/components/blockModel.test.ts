import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { forceFullParse } from "../test-parse";
import { listBlocks, blockAt } from "@plainva/ui";

function st(doc: string) {
  const s = EditorState.create({ doc, extensions: [markdown()] });
  return forceFullParse(s);
}

describe("listBlocks", () => {
  it("returns heading + paragraph as separate blocks", () => {
    const blocks = listBlocks(st("# Title\n\npara line\nmore"));
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph"]);
    expect(blocks[0]).toMatchObject({ firstLine: 1, lastLine: 1 });
    expect(blocks[1]).toMatchObject({ firstLine: 3, lastLine: 4 });
  });

  it("treats a whole bullet list as one block", () => {
    const blocks = listBlocks(st("- a\n- b\n- c"));
    expect(blocks.map((b) => b.type)).toEqual(["list"]);
    expect(blocks[0]).toMatchObject({ firstLine: 1, lastLine: 3 });
  });

  it("treats a nested list as one block spanning all items", () => {
    const blocks = listBlocks(st("- a\n  - a1\n- b"));
    expect(blocks.map((b) => b.type)).toEqual(["list"]);
    expect(blocks[0]).toMatchObject({ firstLine: 1, lastLine: 3 });
  });

  it("treats a fenced code block and a blockquote as one block each", () => {
    expect(listBlocks(st("```\nx\ny\n```")).map((b) => b.type)).toEqual(["code"]);
    expect(listBlocks(st("> a\n> b")).map((b) => b.type)).toEqual(["quote"]);
  });

  it("excludes YAML frontmatter (no phantom blocks for the --- fences)", () => {
    const blocks = listBlocks(st("---\ntitle: x\ntags: [a]\n---\n# Heading\n\npara"));
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph"]);
    expect(blocks[0].firstLine).toBe(5); // first real block is the heading on line 5
  });

  // The block as the one definition reads it (finding 2026-10-09): the scan of
  // this module wanted a line that is exactly `---`, so a fence with a blank
  // behind it surfaced as a rule block and a heading block with handles.
  it("excludes the frontmatter in every form the definition reads as a block", () => {
    const MARK = String.fromCharCode(0xfeff);
    for (const head of [
      "--- \ntitle: x\n---\t\n", // blanks behind either fence
      "---\n---\n", // the empty block
      "---\n\n---\n", // a blank line between the fences
      `${MARK}---\ntitle: x\n---\n`, // behind a byte order mark
      `${MARK}---\n---\n`,
    ]) {
      const state = st(`${head}# Heading\n\npara`);
      const blocks = listBlocks(state);
      expect(blocks.map((b) => b.type), JSON.stringify(head)).toEqual(["heading", "paragraph"]);
      expect(blocks[0].firstLine, JSON.stringify(head)).toBe(head.split("\n").length);
      // No block answers for a position inside the frontmatter.
      expect(blockAt(state, 1), JSON.stringify(head)).toBeNull();
    }
  });

  it("keeps the lines of a note that only opens with a rule", () => {
    // No closing fence, no frontmatter: the rule and the text are blocks.
    expect(listBlocks(st("---\n\npara\n\nmore")).map((b) => b.type)).toEqual(["hr", "paragraph", "paragraph"]);
    // An empty block closes on the next line; the rule further down is a block of the text.
    expect(listBlocks(st("---\n---\n\npara\n\n---\n\nmore")).map((b) => b.type)).toEqual(["paragraph", "hr", "paragraph"]);
  });
});

describe("blockAt", () => {
  it("finds the block containing a position", () => {
    const s = st("# Title\n\npara");
    const para = s.doc.line(3);
    const b = blockAt(s, para.from + 1);
    expect(b?.type).toBe("paragraph");
    expect(b?.firstLine).toBe(3);
  });
});
