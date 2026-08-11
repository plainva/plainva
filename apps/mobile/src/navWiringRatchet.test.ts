import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A route handler must never `pop()` and then `push()`.
 *
 * The shell's `pop` is asynchronous: it asks about unsaved input first, so its
 * state update lands a microtask AFTER a `push` written on the next line. The
 * push opens the target, the late pop removes it — and the tap looks like it
 * did nothing. That is exactly what shipped: in the connect wizard, tapping
 * "Files", "Calendar" or "Mail" did nothing at all, on iOS and on Android
 * (#47, reported against 0.6.2 and confirmed on both platforms).
 *
 * This is a SOURCE guard on purpose. The reducer was never wrong, and the
 * reducer tests stayed green with the broken wiring in place — the fault lived
 * in the two lines that called it, which no test looked at. A behavioural test
 * would have to drive the whole shell to see it; reading the two lines is both
 * cheaper and closer to the actual mistake.
 *
 * The replacement is `replace()`, one atomic transition (see `replaceTop`).
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      sources(full, out);
      continue;
    }
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("navigation wiring", () => {
  it("never follows pop() with push() — pop is asynchronous (#47)", () => {
    const offenders: string[] = [];

    for (const file of sources(SRC)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/\bpop\(\)\s*;?\s*$/.test(line.trim())) return;
        // Look at the next few statements: the push may be wrapped over
        // several lines, and blank lines or a comment do not make it safe.
        const ahead = lines
          .slice(i + 1, i + 4)
          .join(" ")
          .trim();
        if (/\bpush\(\s*\{/.test(ahead)) {
          offenders.push(`${relative(SRC, file)}:${i + 1}`);
        }
      });
    }

    expect(
      offenders,
      "pop() is asynchronous, so a push() after it opens a screen the late pop then closes. Use replace() for a forward step that drops the current screen.",
    ).toEqual([]);
  });
});
