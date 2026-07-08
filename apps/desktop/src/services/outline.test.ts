import { describe, it, expect } from "vitest";
import { parseHeadings, slugify } from "./outline";

describe("slugify", () => {
  it("lowercases, trims and dashes", () => {
    expect(slugify("My Heading!")).toBe("my-heading");
    expect(slugify("  A  B  ")).toBe("a-b");
  });
});

describe("parseHeadings", () => {
  it("collects ATX headings with level and 1-based line", () => {
    const md = "# One\n\n## Two\ntext\n### Three";
    expect(parseHeadings(md)).toEqual([
      { level: 1, text: "One", line: 1, slug: "one" },
      { level: 2, text: "Two", line: 3, slug: "two" },
      { level: 3, text: "Three", line: 5, slug: "three" },
    ]);
  });

  it("skips frontmatter and fenced code blocks", () => {
    const md = "---\ntitle: x\n# not a heading\n---\n# Real\n```\n# in code\n```\n## After";
    expect(parseHeadings(md).map((h) => h.text)).toEqual(["Real", "After"]);
  });

  it("strips trailing # and ignores non-headings", () => {
    expect(parseHeadings("# Title ##\nplain")).toEqual([{ level: 1, text: "Title", line: 1, slug: "title" }]);
    expect(parseHeadings("#nospace")).toEqual([]);
  });
});
