import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { listBlocks, blockAt } from "./blockModel";

function st(doc: string) {
  const s = EditorState.create({ doc, extensions: [markdown()] });
  ensureSyntaxTree(s, s.doc.length, 5000); // force a full parse for the test
  return s;
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
