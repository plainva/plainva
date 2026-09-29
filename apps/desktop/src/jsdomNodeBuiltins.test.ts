import { describe, expect, it } from "vitest";
import { sourceTexts } from "./test-sourceTree";

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

const ROOTS = ["apps/desktop/src", "apps/mobile/src", "packages/ui/src", "packages/ui/test", "packages/core/src", "packages/core/test"];

describe("jsdom tests and Node built-ins", () => {
  it("no jsdom test imports node:sqlite", () => {
    const offenders: string[] = [];
    // Every test file of the six roots, read through the scan guards' shared snapshot.
    for (const { rel, text } of sourceTexts(ROOTS, "tests")) {
      if (!/@vitest-environment\s+jsdom/.test(text)) continue;
      if (/from\s+["']node:sqlite["']|import\(\s*["']node:sqlite["']\s*\)/.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
