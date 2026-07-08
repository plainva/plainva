import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { markdownAstSchema } from "../src/markdown-ast.ts";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import remarkObsidianPreserve from "../src/remark-obsidian-preserve.ts";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(currentDir, "fixtures");

const parser = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]);
const preservingProcessor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkObsidianPreserve);

const standardFixtures = ["plain-note", "frontmatter", "links-and-tags", "full-markdown"];
const obsidianFixtures = [
  "obsidian-callout.input",
  "obsidian-wikilink.input",
  "obsidian-embed.input"
];

describe("markdownAstSchema", () => {
  it("validates raw mdast for current roundtrip fixtures", async () => {
    for (const fixture of [...standardFixtures, ...obsidianFixtures]) {
      const input = await readFile(path.join(fixtureDir, `${fixture}.md`), "utf8");
      const tree = parser.parse(input);

      expect(markdownAstSchema.safeParse(tree).success).toBe(true);
    }
  });

  it("validates transformed mdast with preserved Obsidian syntax html nodes", async () => {
    for (const fixture of obsidianFixtures) {
      const input = await readFile(path.join(fixtureDir, `${fixture}.md`), "utf8");
      const tree = preservingProcessor.parse(input);
      const transformedTree = await preservingProcessor.run(tree);
      const result = markdownAstSchema.safeParse(transformedTree);

      expect(result.success).toBe(true);
      expect(JSON.stringify(transformedTree)).toContain("\"type\":\"html\"");
    }
  });

  it("rejects unsupported nodes outside the current schema corridor", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "math",
          value: "E = mc^2"
        }
      ]
    };

    expect(markdownAstSchema.safeParse(tree).success).toBe(false);
  });

  it("rejects malformed supported nodes", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "heading",
          depth: 7,
          children: [{ type: "text", value: "Invalid heading" }]
        }
      ]
    };

    expect(markdownAstSchema.safeParse(tree).success).toBe(false);
  });
});
