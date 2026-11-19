import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The file format reference names who stamps `generated` (F31 of the known-defects
// list for release 0.9.0): it once named three actors while the AI, the MCP server,
// external agents and scripts stamped too. Every writer prefix of
// `packages/core/src/ai/writes/authors.ts` appears on the page in every language.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DOCS_USER = join(ROOT, "docs", "user");

function writerPrefixes(): string[] {
  const source = readFileSync(join(ROOT, "packages", "core", "src", "ai", "writes", "authors.ts"), "utf8");
  return [...source.matchAll(/^const [A-Z]+_PREFIX = "([^"]+)";$/gm)].map((match) => match[1]!);
}

describe("the file format reference names every machine writer", () => {
  it("reads the writers from the code", () => {
    expect(writerPrefixes()).toEqual(["plainva-ai/", "mcp:", "acp:", "script:"]);
  });

  it("names each writer's id on the page in every language", () => {
    const missing: string[] = [];
    for (const lang of readdirSync(DOCS_USER).filter((entry) => statSync(join(DOCS_USER, entry)).isDirectory())) {
      const page = readFileSync(join(DOCS_USER, lang, "File_Format_Reference.md"), "utf8");
      for (const prefix of writerPrefixes()) if (!page.includes(`\`${prefix}`)) missing.push(`${lang}: ${prefix}`);
    }
    expect(missing).toEqual([]);
  });
});
