import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Both shells' production bundles run modules in the order their imports say
 * (stability plan R10, 2026-11-10). Rolldown does not promise that across
 * chunks by default: a module could run before one it imports and read its
 * exports as undefined. That is how the desktop's keychain slot builders were
 * undefined in the production bundle (every mail sign-in check threw), and how
 * a chunk of the shared UI read a list as "not iterable" when loaded first.
 *
 * With the option, every read of an imported binding while a module loads is
 * safe by construction - which is why no lint rule polices those reads one by
 * one. The production smokes load every chunk on its own (e2e-prod/chunk-load).
 */
describe("the production bundles keep the modules' order", () => {
  for (const shell of ["desktop", "mobile"]) {
    it(`${shell}: strictExecutionOrder is on in the build output`, () => {
      const config = readFileSync(new URL(`../../${shell}/vite.config.ts`, import.meta.url), "utf8");
      const output = config.slice(config.indexOf("output: {"));
      expect(config.indexOf("output: {"), "the config has an output block").toBeGreaterThan(0);
      expect(output.slice(0, output.indexOf("manualChunks"))).toMatch(/\bstrictExecutionOrder:\s*true\b/);
    });
  }
});
