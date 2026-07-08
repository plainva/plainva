import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseMarkdownAst } from "../src/markdown-parser.ts";
import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(currentDir, "fixtures");

const standardFixtures = ["plain-note", "frontmatter", "links-and-tags"];
const obsidianFixtures = [
  "obsidian-callout.input",
  "obsidian-wikilink.input",
  "obsidian-embed.input"
];

describe("parseMarkdownAst", () => {
  it("parses and validates current roundtrip fixtures", async () => {
    for (const fixture of [...standardFixtures, ...obsidianFixtures]) {
      const input = await readFile(path.join(fixtureDir, `${fixture}.md`), "utf8");
      const ast = parseMarkdownAst(input);

      expect(ast.type).toBe("root");
      expect(ast.children.length).toBeGreaterThan(0);
    }
  });

  it("preserves Obsidian syntax as html nodes when requested", async () => {
    for (const fixture of obsidianFixtures) {
      const input = await readFile(path.join(fixtureDir, `${fixture}.md`), "utf8");
      const ast = parseMarkdownAst(input, { preserveObsidianSyntax: true });

      expect(JSON.stringify(ast)).toContain("\"type\":\"html\"");
    }
  });

  it("keeps YAML frontmatter as an AST node without parsing metadata", async () => {
    const input = await readFile(path.join(fixtureDir, "frontmatter.md"), "utf8");
    const ast = parseMarkdownAst(input);

    expect(ast.children[0]).toMatchObject({
      type: "yaml",
      value: "title: Roundtrip Fixture\ntags:\n  - plainva\n  - roundtrip"
    });
  });


});
