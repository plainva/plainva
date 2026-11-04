import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One rule for fenced code (`packages/core/src/markdownFence.ts`): every
 * scanner of the assistant that has to know whether a line is code asks the
 * shared tracker. A pattern of its own knew no quote and, in most of them,
 * closed a fence on any run of three (merge of main, 27 Oct 2026).
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const DIRS = ["packages/core/src/ai", "packages/ui/src/ai", "apps/desktop/src/ai", "apps/mobile/src/services/ai"];
/**
 * A fence written as a pattern: a counted run of backticks or tildes, in a class or a group, a backtick written as an
 * escape, a run repeated by a back-reference, a string search for a run, or the two runs side by side.
 */
const OWN_FENCE =
  /\[[^\]\n]*[`~][^\]\n]*\]\{3|[`~]\{3|\((?:\?:)?[`~](?:\|[`~])?\)\{3|\\x60|\\u0060|\\1\\1|\\1\{2|(?:startsWith|endsWith|includes|indexOf)\(\s*["'`](?:\\`){0,3}(?:```|~~~|\\`\\`\\`)|(?:===|!==)\s*["'`](?:```|~~~)|["'`](?:```|~~~)["'`]\s*(?:===|!==)|\^[^\n]*?(?:```|~~~)|```\|~~~|~~~\|```/;
/** The scanners that moved onto the rule: the guard must have read each of them. */
const MOVED = [
  "packages/core/src/ai/context/cards.ts",
  "packages/core/src/ai/context/sections.ts",
  "packages/core/src/ai/coverage.ts",
  "packages/core/src/ai/embeddings/chunks.ts",
  "packages/core/src/ai/memory/memoryFile.ts",
  "packages/core/src/ai/noteHints.ts",
  "packages/core/src/ai/writingStyle.ts",
  "packages/core/src/ai/writes/links.ts",
  "packages/ui/src/ai/answerBlocks.ts",
  "packages/ui/src/ai/aiSelectionActions.ts",
];

describe("the assistant's scanners", () => {
  it("read fenced code by the one rule, none by a pattern of its own", () => {
    const seen: string[] = [];
    const found: string[] = [];
    for (const dir of DIRS) {
      for (const name of readdirSync(join(ROOT, dir), { recursive: true }) as string[]) {
        const path = `${dir}/${name.replace(/\\/g, "/")}`;
        if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path)) continue;
        seen.push(path);
        readFileSync(join(ROOT, path), "utf8")
          .split("\n")
          .forEach((line, index) => {
            if (OWN_FENCE.test(line)) found.push(`${path}:${index + 1}`);
          });
      }
    }
    expect(seen).toEqual(expect.arrayContaining(MOVED));
    expect(found).toEqual([]);
  });

  it("knows a pattern of its own when it sees one", () => {
    for (const written of [
      "/^[`~]{3,}/",
      "/^(`|~){3}/",
      "/(?:`){3,}/",
      "/\\x60{3}/",
      "/([`~])\\1\\1/",
      "line.startsWith(\"```\")",
      "text.includes('~~~')",
      "/^(?:```|~~~)/",
      "/`{3}/",
      "if (/^\\s*```/.test(line)) inFence = !inFence;",
      "/^ {0,3}~~~/",
      "line.match(/^```/)",
      "line.trim() === \"```\"",
      "/^ {0,3}([`~])\\1{2,}/",
    ]) {
      expect(OWN_FENCE.test(written), written).toBe(true);
    }
    for (const written of ["out.push(\"```\" + lang);", "/~~/", "/-{3,}/", "const fence = createFenceTracker();"]) {
      expect(OWN_FENCE.test(written), written).toBe(false);
    }
  });
});
