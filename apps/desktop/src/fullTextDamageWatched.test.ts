import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A damaged full-text index shows while the vault is open — at a search, at a
 * read of a note's text, at a write — and is noted by the watch around the
 * database (`watchFullTextDamage`), so the next open makes the full-text table
 * anew. That holds only for a database that is handed on watched. So every
 * place in either shell that opens an index database (`await
 * initializeSchema(`) hands it on through the watch, once per open: a new open
 * without it fails here.
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const DIRS = ["apps/desktop/src", "apps/mobile/src"];

/** Not an open of a vault's index: a test vault for the search by meaning, in memory. */
const NOT_A_VAULT = new Set(["apps/desktop/src/ai/embeddingTestVault.ts"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sources(path, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !/^test-/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

describe("every index database either shell opens is watched for a damaged full-text index", () => {
  const opens = DIRS.flatMap((dir) => sources(dir))
    .map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8") }))
    .filter(({ text }) => /await initializeSchema\(/.test(text));

  it("finds the opens of both shells", () => {
    const files = opens.map((o) => o.file);
    expect(files).toContain("apps/desktop/src/services/indexDatabase.ts");
    expect(files).toContain("apps/mobile/src/services/vaultService.ts");
  });

  it("hands each one on through the watch", () => {
    const unwatched = opens
      .filter(({ file }) => !NOT_A_VAULT.has(file))
      .filter(({ text }) => count(text, /watchFullTextDamage\(/g) < count(text, /await initializeSchema\(/g))
      .map(({ file }) => file);
    expect(unwatched).toEqual([]);
  });
});
