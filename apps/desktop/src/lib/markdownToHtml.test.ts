import { describe, it, expect } from "vitest";
import { markdownToHtml } from "@plainva/ui";

describe("markdownToHtml — inline", () => {
  it("preserves emphasis and inline code", () => {
    expect(markdownToHtml("**bold** and *italic* and ~~strike~~ and `code`")).toBe(
      "<p><strong>bold</strong> and <em>italic</em> and <del>strike</del> and <code>code</code></p>"
    );
  });

  it("renders ==highlight== as <mark>", () => {
    expect(markdownToHtml("==hi==")).toBe("<p><mark>hi</mark></p>");
  });

  it("escapes HTML in text and code so nothing can inject markup", () => {
    expect(markdownToHtml("a < b & `c > d`")).toBe("<p>a &lt; b &amp; <code>c &gt; d</code></p>");
  });

  it("degrades wiki links to their display text (no target outside the vault)", () => {
    expect(markdownToHtml("see [[Note|the note]]")).toBe("<p>see the note</p>");
  });

  it("keeps web markdown links as anchors, internal links as text", () => {
    expect(markdownToHtml("[site](https://example.com)")).toBe(
      '<p><a href="https://example.com">site</a></p>'
    );
    expect(markdownToHtml("[x](note.md)")).toBe("<p>x</p>");
  });

  it("turns bare URLs into anchors", () => {
    expect(markdownToHtml("visit https://a.test now")).toBe(
      '<p>visit <a href="https://a.test">https://a.test</a> now</p>'
    );
  });
});

describe("markdownToHtml — blocks", () => {
  it("headings by level", () => {
    expect(markdownToHtml("# Title")).toBe("<h1>Title</h1>");
    expect(markdownToHtml("### Sub")).toBe("<h3>Sub</h3>");
  });

  it("unordered / ordered lists and tasks", () => {
    expect(markdownToHtml("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(markdownToHtml("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
    expect(markdownToHtml("- [x] done\n- [ ] todo")).toBe("<ul><li>☑ done</li><li>☐ todo</li></ul>");
  });

  it("blockquote", () => {
    expect(markdownToHtml("> quoted")).toBe("<blockquote>quoted</blockquote>");
  });

  it("fenced code emits verbatim, escaped content", () => {
    expect(markdownToHtml("```\n<b>x</b>\n```")).toBe("<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>");
  });

  it("thematic break", () => {
    expect(markdownToHtml("---")).toBe("<hr>");
  });

  it("table with header and body", () => {
    const md = "| A | B |\n| - | - |\n| 1 | 2 |";
    expect(markdownToHtml(md)).toBe(
      "<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>"
    );
  });

  it("paragraphs split on blank lines; soft breaks become <br>", () => {
    expect(markdownToHtml("line1\nline2\n\npara2")).toBe("<p>line1<br>line2</p><p>para2</p>");
  });

  it("empty input yields empty string", () => {
    expect(markdownToHtml("")).toBe("");
  });
});
