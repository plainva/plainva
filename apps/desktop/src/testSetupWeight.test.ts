import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./test-sourceTree";

/**
 * A vitest setup file runs in front of every test file of its shell, so what it
 * imports every file pays for (Befunde 2026-09-24, Z2). The desktop's setup took
 * one test seam from the `@plainva/ui` barrel, and each of ~500 files loaded the
 * whole package before its first line: 3 s per file warm, 16 s cold, two thirds
 * of the suite's time. A setup file names narrow entries (`@plainva/ui/i18n`) or
 * the module itself; a test that needs a package imports it on its own.
 */

const SHELLS = ["apps/desktop", "apps/mobile"];
const BARREL = /(?:from|import)\s+["']@plainva\/(?:ui|core)["']|import\(\s*["']@plainva\/(?:ui|core)["']\s*\)/;

function setupFiles(shell: string): string[] {
  const config = readFileSync(join(REPO, shell, "vite.config.ts"), "utf8");
  const list = config.match(/setupFiles:\s*\[([^\]]*)\]/)?.[1] ?? "";
  return [...list.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

describe("vitest setup files", () => {
  for (const shell of SHELLS) {
    it(`${shell}: no setup file loads a package barrel`, () => {
      const files = setupFiles(shell);
      // A config whose list this cannot read would pass for the wrong reason.
      expect(files.length).toBeGreaterThan(0);
      const barrels = files.filter((file) => BARREL.test(readFileSync(join(REPO, shell, file), "utf8")));
      expect(barrels, "import the narrow entry or the module, not @plainva/ui or @plainva/core").toEqual([]);
    });
  }
});
