import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
});
