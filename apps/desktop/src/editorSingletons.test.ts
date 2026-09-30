import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The editor's building blocks resolve to exactly one version each
 * (found by Dependabot #115, 2026-09-30).
 *
 * CodeMirror demands a single instance of `@codemirror/state` and its
 * siblings: extensions built against a second copy are rejected at runtime
 * ("Unrecognized extension value … multiple instances of @codemirror/state"),
 * and syntax trees from two copies of `@lezer/common` are not the same `Tree`.
 * #115 left `@lezer/common` 1.5.2 and 1.5.3 side by side; the type checker
 * caught it only because the two copies' types happened to differ. A
 * duplicate with identical types would pass every typecheck and break the
 * editor at runtime. Reading the lockfile here turns such a tree red, whatever
 * the types say. The fix is a `pnpm dedupe` (or a matching range bump), never
 * an exception in this list.
 */

const REPO = resolve(__dirname, "../../..");

const SINGLETONS = [
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
] as const;

/** Every resolved version of `name` in pnpm-lock.yaml (`packages:` and `snapshots:` keys). */
function resolvedVersions(lock: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const key = new RegExp(`^ {2}'?${escaped}@(\\d+\\.\\d+\\.\\d+[^('\\s:]*)`, "gm");
  const out = new Set<string>();
  for (const match of lock.matchAll(key)) out.add(match[1]!);
  return [...out].sort();
}

describe("editor singletons", () => {
  const lock = readFileSync(join(REPO, "pnpm-lock.yaml"), "utf8").replace(/\r\n/g, "\n");

  it("finds every editor building block in the lockfile", () => {
    // A parser that finds nothing must not pass the comparison below.
    for (const name of SINGLETONS) expect(resolvedVersions(lock, name), name).not.toEqual([]);
  });

  it("resolves each editor building block to exactly one version", () => {
    const duplicated = SINGLETONS.map((name) => [name, resolvedVersions(lock, name)] as const)
      .filter(([, versions]) => versions.length > 1)
      .map(([name, versions]) => `${name}: ${versions.join(", ")}`);
    expect(
      duplicated,
      "CodeMirror needs one instance of each editor package. Run `pnpm dedupe` " +
        "(or align the ranges) until each resolves once.\n  " +
        duplicated.join("\n  "),
    ).toEqual([]);
  });
});
