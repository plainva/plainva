import { describe, expect, it } from "vitest";
import { sourceTexts } from "./test-sourceTree";

/**
 * Source hygiene guard: no RAW control characters in any TypeScript/TSX/CSS
 * source. A single stray U+0000 makes git treat the file as BINARY (no diffs,
 * no blame) — it has slipped in twice now (graph files 2026-07-05, the
 * calendar view 2026-07-17). Control characters that are genuinely needed
 * (FTS snippet sentinels etc.) are constructed at runtime via
 * String.fromCharCode, never typed literally.
 */

const ROOTS = [
  "apps/desktop", // src + e2e
  // apps/mobile was NOT covered, which is how a stray U+0000 reached the mail
  // list on 2026-07-26 — the third time this bug class has landed, and the
  // first where the guard that exists for it simply was not looking.
  "apps/mobile/src",
  "packages/ui/src",
  "packages/core/src",
];

// TypeScript, TSX, CSS and JSON ("text" in the scan guards' shared reader,
// test-sourceTree.ts, which also skips node_modules, dist, target and dot folders).
// Everything below U+0020 except TAB (0x09), LF (0x0A) and CR (0x0D — CRLF
// working trees on Windows are normalized by .gitattributes at commit time).
// Built at RUNTIME: typing these literally is exactly the guarded bug.
const CONTROL = new RegExp(
  `[${String.fromCharCode(1)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}]`
);
const NUL = String.fromCharCode(0);

describe("source encoding", () => {
  it("no source file contains raw control characters (NUL makes git go binary)", () => {
    const files = sourceTexts(ROOTS, "text");
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const { rel, text: content } of files) {
      if (content.includes(NUL) || CONTROL.test(content)) {
        offenders.push(rel);
      }
    }
    expect(offenders, `raw control characters in:\n${offenders.join("\n")}`).toEqual([]);
  });
});
