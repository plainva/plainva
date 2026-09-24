import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * No `node:sqlite` in a jsdom test (finding 2026-09-24).
 *
 * A jsdom test is bundled by Vite for the client environment, and Vite only
 * leaves Node built-ins alone that the running Node knows. `node:sqlite` is
 * built in on the Node 25 of the developer machine but not on the Node 22 of
 * the CI, so two render tests passed locally and failed the whole CI job with
 * "Cannot bundle Node.js built-in node:sqlite". Tests that need a real database
 * run in the node environment; a jsdom render test gets a fake adapter.
 */

const REPO = resolve(__dirname, "../../..");
const ROOTS = ["apps/desktop/src", "apps/mobile/src", "packages/ui/src", "packages/ui/test", "packages/core/src", "packages/core/test"];

function testFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...testFiles(full));
    else if (/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("jsdom tests and Node built-ins", () => {
  it("no jsdom test imports node:sqlite", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of testFiles(join(REPO, root))) {
        const text = readFileSync(file, "utf8");
        if (!/@vitest-environment\s+jsdom/.test(text)) continue;
        if (/from\s+["']node:sqlite["']|import\(\s*["']node:sqlite["']\s*\)/.test(text)) {
          offenders.push(relative(REPO, file).replace(/\\/g, "/"));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
