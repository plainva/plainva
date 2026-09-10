import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The three suites run side by side under turbo (pre-commit, pre-push,
    // CI). The workspace-comment and publication fixtures — real signing and
    // encryption — finish well under a second alone and crossed the 5 s
    // default under that load, a different set on every run (2026-09-10).
    // 20 s still catches a hang; the desktop and the phone carry the same.
    testTimeout: 20_000,
  },
});
