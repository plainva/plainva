import { describe, it, expect } from "vitest";
import { shippedSources } from "./test-sourceTree";

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

const roots = ["apps/desktop/src", "packages/ui/src", "apps/mobile/src"];

/** `{ error: err.message }` / `{ message: e.message }` — no guard, no fallback. */
const BARE_INTERPOLATION = /\{\s*\w+\s*:\s*(?:\w+)\.message\s*\}/g;

describe("user-facing error text", () => {
  it("never interpolates a bare .message", () => {
    const findings: string[] = [];

    // Shipped sources of the three roots, read through the scan guards' shared snapshot.
    for (const { rel, text: source } of shippedSources(roots)) {
      for (const line of source.split("\n")) {
        // A guarded or defaulted expression on the same line is the correct
        // form, just written out longhand.
        if (line.includes("instanceof Error") || line.includes("|| String(")) continue;
        if (BARE_INTERPOLATION.test(line)) {
          findings.push(`${rel}: ${line.trim()}`);
        }
        BARE_INTERPOLATION.lastIndex = 0;
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
