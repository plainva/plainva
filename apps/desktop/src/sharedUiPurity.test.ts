import { describe, it, expect } from "vitest";
import { join, resolve, dirname, sep } from "node:path";
import { REPO, sourceTexts } from "./test-sourceTree";

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

const UI_ROOT = "packages/ui/src";
const UI_SRC = resolve(REPO, UI_ROOT);

const FORBIDDEN = [/^@tauri-apps(\/|$)/, /^@capacitor(\/|$)/];

// Static import/export-from specifiers plus dynamic import() calls.
const SPECIFIER = /(?:from\s*|import\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

describe("shared UI purity (packages/ui)", () => {
  // Every .ts/.tsx of the package, tests included, read through the scan
  // guards' shared snapshot; `rel` is package-relative as the messages had it.
  const files = sourceTexts([UI_ROOT], "code").map(({ rel, text }) => ({
    rel: rel.slice(UI_ROOT.length + 1),
    abs: join(REPO, rel),
    text,
  }));

  it("scans a non-empty package (guard must not rot into a no-op)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never imports shell APIs and never escapes the package", () => {
    const violations: string[] = [];
    for (const { rel, abs, text: source } of files) {
      for (const match of source.matchAll(SPECIFIER)) {
        const spec = match[1];
        if (FORBIDDEN.some((re) => re.test(spec))) {
          violations.push(`${rel}: forbidden shell import "${spec}"`);
        } else if (spec.startsWith(".")) {
          const target = resolve(dirname(abs), spec);
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
    for (const { rel, text } of files) {
      for (const match of text.matchAll(SPECIFIER)) {
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
