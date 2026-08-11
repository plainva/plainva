import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * A user-facing message must never interpolate a bare `.message`.
 *
 * Errors crossing the Tauri boundary are strings, not Error objects: `.message`
 * on them is undefined, and an undefined interpolation renders as NOTHING. The
 * delete failure on issue #46 reached a user as "… Reason:" and stopped there —
 * a message whose entire purpose was to name its cause.
 *
 * `errorText()` handles every shape. This scan only covers the pattern that
 * actually shipped — a `.message` placed directly into an interpolation object
 * with no guard and no fallback. Guarded forms (`instanceof Error ? … : …`) and
 * fallbacks (`e.message || String(e)`) are fine and stay untouched; a scanner
 * that flags them would be ignored within a week.
 */

const roots = [
  resolve(__dirname, "."),
  resolve(__dirname, "../../../packages/ui/src"),
  resolve(__dirname, "../../mobile/src"),
];

/** `{ error: err.message }` / `{ message: e.message }` — no guard, no fallback. */
const BARE_INTERPOLATION = /\{\s*\w+\s*:\s*(?:\w+)\.message\s*\}/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("user-facing error text", () => {
  it("never interpolates a bare .message", () => {
    const findings: string[] = [];

    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const source = readFileSync(file, "utf8");
        for (const line of source.split("\n")) {
          // A guarded or defaulted expression on the same line is the correct
          // form, just written out longhand.
          if (line.includes("instanceof Error") || line.includes("|| String(")) continue;
          if (BARE_INTERPOLATION.test(line)) {
            findings.push(`${file.replace(resolve(__dirname, "../../.."), "")}: ${line.trim()}`);
          }
          BARE_INTERPOLATION.lastIndex = 0;
        }
      }
    }

    expect(
      findings,
      `A bare .message renders as an empty string when the error is a plain string — ` +
        `which is what every Tauri command rejects with. Use errorText(err) from ` +
        `@plainva/ui.\n  ${findings.join("\n  ")}`,
    ).toEqual([]);
  });
});
