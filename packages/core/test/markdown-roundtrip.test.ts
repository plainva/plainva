import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkObsidianPreserve from "../src/remark-obsidian-preserve.ts";
import { unified } from "unified";
import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(currentDir, "fixtures");

// We only specify the base names of the tests here
const edgeCases = [
  "obsidian-callout",
  "obsidian-wikilink",
  "obsidian-embed"
];

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkObsidianPreserve)
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "*",
    fences: true,
    listItemIndent: "one"
  });

describe("markdown roundtrip standard fixtures", () => {
  const standardFixtures = ["plain-note", "frontmatter", "links-and-tags", "full-markdown"];
  for (const fixture of standardFixtures) {
    it(`roundtrips ${fixture}.md without changing text`, async () => {
      const input = await readFile(path.join(fixtureDir, `${fixture}.md`), "utf8");
      const vfile = await processor.process(input);
      const output = String(vfile);
      expect(output).toBe(input);
    });
  }
});

describe("markdown roundtrip obsidian edge cases (diagnostic)", () => {
  for (const edgeCase of edgeCases) {
    it(`documents baseline behavior for ${edgeCase}`, async () => {
      const input = await readFile(path.join(fixtureDir, `${edgeCase}.input.md`), "utf8");
      
      // We expect all obsidian edge cases to roundtrip perfectly now,
      // because our custom plugin protects them from escaping.
      const expected = input;
      
      const vfile = await processor.process(input);
      const output = String(vfile);

      expect(output).toBe(expected);
    });
  }
});
