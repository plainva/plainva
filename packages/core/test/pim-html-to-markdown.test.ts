import { describe, it, expect } from "vitest";
import { htmlToMarkdown, normalizeDescription, looksLikeHtml } from "../src/pim/htmlToMarkdown.js";

describe("htmlToMarkdown", () => {
  it("maps common inline tags and links to Markdown", () => {
    expect(htmlToMarkdown("<b>Hello</b> <i>world</i>")).toBe("**Hello** *world*");
    expect(htmlToMarkdown('<a href="https://x.io">site</a>')).toBe("[site](https://x.io)");
    expect(htmlToMarkdown('<a href="https://x.io">https://x.io</a>')).toBe("https://x.io");
  });

  it("turns <br>, paragraphs and list items into newlines / bullets", () => {
    expect(htmlToMarkdown("line1<br>line2")).toBe("line1\nline2");
    expect(htmlToMarkdown("<p>a</p><p>b</p>")).toBe("a\n\nb");
    expect(htmlToMarkdown("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n- two");
  });

  it("decodes entities and strips unknown tags", () => {
    expect(htmlToMarkdown("Tom &amp; Jerry &lt;3 <span>x</span>")).toBe("Tom & Jerry <3 x");
  });
});

describe("normalizeDescription", () => {
  it("converts HTML but passes plain text through; empties become undefined", () => {
    expect(normalizeDescription("<p>Hi <b>there</b></p>")).toBe("Hi **there**");
    expect(normalizeDescription("Just plain text with **markdown**")).toBe("Just plain text with **markdown**");
    expect(normalizeDescription("   ")).toBeUndefined();
    expect(normalizeDescription(null)).toBeUndefined();
    expect(normalizeDescription(undefined)).toBeUndefined();
  });
});

describe("looksLikeHtml", () => {
  it("detects tags and entities, ignores markdown", () => {
    expect(looksLikeHtml("<p>x</p>")).toBe(true);
    expect(looksLikeHtml("a &amp; b")).toBe(true);
    expect(looksLikeHtml("plain **markdown** text")).toBe(false);
    expect(looksLikeHtml("a < b comparison")).toBe(false);
  });
});
