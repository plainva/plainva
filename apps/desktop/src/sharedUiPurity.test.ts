import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Walks the whole source tree from disk: about half a second on its own, but past
// the 5 s unit-test default under the full suite's parallel load — six of these
// guards timed out at once and passed in isolation (2026-08-24). A default meant
// for unit tests is the wrong yardstick for a check whose runtime grows with the
// repo; 30 s still catches a hang.
vi.setConfig({ testTimeout: 30_000 });

/**
 * Shared-UI purity guard (ADR 0011).
 *
 * packages/ui is the shell-independent UI layer consumed by every app shell
 * (desktop today, mobile next). Nothing in it may import a shell API —
 * platform capabilities are injected by the consuming app. This suite fails
 * when a file under packages/ui/src imports @tauri-apps/* or @capacitor/*,
 * or reaches out of the package via a relative import (which would silently
 * couple the shared layer to desktop-only modules).
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
const UI_SRC = resolve(SRC, "../../../packages/ui/src");

const FORBIDDEN = [/^@tauri-apps(\/|$)/, /^@capacitor(\/|$)/];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// Static import/export-from specifiers plus dynamic import() calls.
const SPECIFIER = /(?:from\s*|import\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

describe("shared UI purity (packages/ui)", () => {
  const files = walk(UI_SRC);

  it("scans a non-empty package (guard must not rot into a no-op)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never imports shell APIs and never escapes the package", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(UI_SRC, file).replace(/\\/g, "/");
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(SPECIFIER)) {
        const spec = match[1];
        if (FORBIDDEN.some((re) => re.test(spec))) {
          violations.push(`${rel}: forbidden shell import "${spec}"`);
        } else if (spec.startsWith(".")) {
          const target = resolve(dirname(file), spec);
          if (target !== UI_SRC && !target.startsWith(UI_SRC + sep)) {
            violations.push(`${rel}: relative import escapes the package: "${spec}"`);
          }
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  /**
   * A module inside packages/ui must not import from "@plainva/ui" — its own
   * barrel. The barrel re-exports the very file doing the import, so the two
   * load each other, and whether that resolves cleanly depends on the order a
   * bundler picks. That is the same class of trap that shipped a white window
   * twice (see moduleInitBoundary.test.ts), which is why it gets a rule rather
   * than a budget entry: three files carried it, and all three now point
   * straight at the module that defines what they need.
   */
  it("never imports from its own barrel", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(UI_SRC, file).replace(/\\/g, "/");
      for (const match of readFileSync(file, "utf8").matchAll(SPECIFIER)) {
        if (/^@plainva\/ui(\/|$)/.test(match[1])) {
          violations.push(
            `${rel}: imports its own barrel ("${match[1]}") — import the defining module instead`
          );
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
