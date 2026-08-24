import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Walks the whole source tree from disk: about half a second on its own, but past
// the 5 s unit-test default under the full suite's parallel load — six of these
// guards timed out at once and passed in isolation (2026-08-24). A default meant
// for unit tests is the wrong yardstick for a check whose runtime grows with the
// repo; 30 s still catches a hang.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Source hygiene guard: no RAW control characters in any TypeScript/TSX/CSS
 * source. A single stray U+0000 makes git treat the file as BINARY (no diffs,
 * no blame) — it has slipped in twice now (graph files 2026-07-05, the
 * calendar view 2026-07-17). Control characters that are genuinely needed
 * (FTS snippet sentinels etc.) are constructed at runtime via
 * String.fromCharCode, never typed literally.
 */

const ROOTS = [
  join(__dirname, ".."), // apps/desktop (src + e2e)
  // apps/mobile was NOT covered, which is how a stray U+0000 reached the mail
  // list on 2026-07-26 — the third time this bug class has landed, and the
  // first where the guard that exists for it simply was not looking.
  join(__dirname, "..", "..", "mobile", "src"),
  join(__dirname, "..", "..", "..", "packages", "ui", "src"),
  join(__dirname, "..", "..", "..", "packages", "core", "src"),
];

const EXTENSIONS = /\.(ts|tsx|css|json)$/;
// Everything below U+0020 except TAB (0x09), LF (0x0A) and CR (0x0D — CRLF
// working trees on Windows are normalized by .gitattributes at commit time).
// Built at RUNTIME: typing these literally is exactly the guarded bug.
const CONTROL = new RegExp(
  `[${String.fromCharCode(1)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}]`
);
const NUL = String.fromCharCode(0);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".") || entry === "dist" || entry === "target") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTENSIONS.test(entry)) out.push(full);
  }
}

describe("source encoding", () => {
  it("no source file contains raw control characters (NUL makes git go binary)", () => {
    const files: string[] = [];
    for (const root of ROOTS) walk(root, files);
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (content.includes(NUL) || CONTROL.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders, `raw control characters in:\n${offenders.join("\n")}`).toEqual([]);
  });
});
