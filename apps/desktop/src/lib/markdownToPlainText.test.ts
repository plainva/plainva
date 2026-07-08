import { describe, it, expect } from "vitest";
import { markdownToPlainText } from "./markdownToPlainText";

const CHECKED = "☑"; // ☑
const UNCHECKED = "☐"; // ☐

describe("markdownToPlainText — inline", () => {
  it("passes plain text through unchanged", () => {
    expect(markdownToPlainText("hello world")).toBe("hello world");
    expect(markdownToPlainText("")).toBe("");
  });

  it("strips emphasis, strong, strong-italic and strikethrough marks", () => {
    expect(markdownToPlainText("**a** *b* ***c*** ~~d~~ _e_ __f__")).toBe("a b c d e f");
  });

  it("strips inline code backticks but keeps the code text", () => {
    expect(markdownToPlainText("run `npm test` now")).toBe("run npm test now");
  });

  it("strips ==highlight== markers", () => {
    expect(markdownToPlainText("some ==important== note")).toBe("some important note");
  });

  it("reduces wiki links to their display text", () => {
    expect(markdownToPlainText("see [[Page]]")).toBe("see Page");
    expect(markdownToPlainText("see [[Page|Alias]]")).toBe("see Alias");
    expect(markdownToPlainText("see [[Page#Section|Alias]]")).toBe("see Alias");
  });

  it("reduces markdown links to their label and keeps bare URLs", () => {
    expect(markdownToPlainText("[label](https://x.test)")).toBe("label");
    expect(markdownToPlainText("visit https://example.com now")).toBe("visit https://example.com now");
  });

  it("honours backslash escapes", () => {
    expect(markdownToPlainText("\\*literal\\*")).toBe("*literal*");
  });

  it("does not treat a #tag mid-text as a heading", () => {
    expect(markdownToPlainText("#tag and more")).toBe("#tag and more");
  });
});

describe("markdownToPlainText — blocks", () => {
  it("strips ATX heading markers (leading and optional trailing)", () => {
    expect(markdownToPlainText("# Title")).toBe("Title");
    expect(markdownToPlainText("### Sub ###")).toBe("Sub");
    expect(markdownToPlainText("## **Bold** heading")).toBe("Bold heading");
  });

  it("strips blockquote markers, including nested and heading-in-quote", () => {
    expect(markdownToPlainText("> quote")).toBe("quote");
    expect(markdownToPlainText("> > deep")).toBe("deep");
    expect(markdownToPlainText("> # Q")).toBe("Q");
  });

  it("drops thematic breaks and setext underlines", () => {
    expect(markdownToPlainText("a\n---\nb")).toBe("a\nb");
    expect(markdownToPlainText("a\n***\nb")).toBe("a\nb");
    expect(markdownToPlainText("Title\n===")).toBe("Title");
  });

  it("keeps list markers but strips inline formatting inside items", () => {
    expect(markdownToPlainText("- item")).toBe("- item");
    expect(markdownToPlainText("* star")).toBe("* star");
    expect(markdownToPlainText("1. first")).toBe("1. first");
    expect(markdownToPlainText("  - **bold** sub")).toBe("  - bold sub");
  });

  it("renders task checkboxes as symbols", () => {
    expect(markdownToPlainText("- [ ] todo")).toBe(`- ${UNCHECKED} todo`);
    expect(markdownToPlainText("- [x] done")).toBe(`- ${CHECKED} done`);
    expect(markdownToPlainText("- [X] Done ==now==")).toBe(`- ${CHECKED} Done now`);
  });

  it("does not mistake *italic* on its own line for a list", () => {
    expect(markdownToPlainText("*just italic*")).toBe("just italic");
  });
});

describe("markdownToPlainText — tables", () => {
  it("converts pipe tables to tab-separated rows and drops the separator", () => {
    const table = "| Name | Age |\n| --- | --- |\n| Ann | **30** |";
    expect(markdownToPlainText(table)).toBe("Name\tAge\nAnn\t30");
  });

  it("leaves inline pipes without edge pipes untouched", () => {
    expect(markdownToPlainText("a | b")).toBe("a | b");
  });
});

describe("markdownToPlainText — fenced code", () => {
  it("emits fenced code verbatim and drops the fences", () => {
    const md = "```js\nconst x = **not bold**;\n```";
    expect(markdownToPlainText(md)).toBe("const x = **not bold**;");
  });

  it("supports ~~~ fences and does not strip inside them", () => {
    const md = "~~~\nkeep ~~this~~ and *that*\n~~~";
    expect(markdownToPlainText(md)).toBe("keep ~~this~~ and *that*");
  });
});

describe("markdownToPlainText — mixed document", () => {
  it("handles a realistic multi-line selection", () => {
    const md = [
      "# Project **Plainva**",
      "",
      "> A note with [[Docs|the guide]] and `code`.",
      "",
      "- [ ] first ==task==",
      "- second *item*",
    ].join("\n");
    const expected = [
      "Project Plainva",
      "",
      "A note with the guide and code.",
      "",
      `- ${UNCHECKED} first task`,
      "- second item",
    ].join("\n");
    expect(markdownToPlainText(md)).toBe(expected);
  });
});
