import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: [{ find: /^@plainva\/core$/, replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)) }] },
  test: {
    // The three suites run side by side under turbo (pre-commit, pre-push,
    // CI). The workspace-comment and publication fixtures — real signing and
    // encryption — finish well under a second alone and crossed the 5 s
    // default under that load, a different set on every run (2026-09-10).
    // 20 s still catches a hang; the desktop and the phone carry the same.
    testTimeout: 20_000,
    // Setup and teardown hooks get their own, longer cap: some build a real
    // SQLite file or a vault on disk, and the Windows release runner took more
    // than the 10 s default for that (release 0.8.6, Sammelplan 3.149).
    hookTimeout: 60_000,
    // See the desktop config: PLAINVA_TEST_WORKERS=<n> caps the workers on a loaded machine.
    ...(process.env.PLAINVA_TEST_WORKERS ? { maxWorkers: Number(process.env.PLAINVA_TEST_WORKERS) } : {}),
  },
});
