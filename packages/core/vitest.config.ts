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
    // Console output goes straight to the process instead of through the
    // worker's RPC. The sync suites log a lot; twice (24.10. and 26.10.) a
    // worker was torn down while such a log was still in flight, and vitest
    // failed the run with "Closing rpc while onUserConsoleLog was pending"
    // although every test had passed (Sammelplan 3.153 Nr. 9).
    disableConsoleIntercept: true,
    // See the desktop config: PLAINVA_TEST_WORKERS=<n> caps the workers on a loaded machine.
    ...(process.env.PLAINVA_TEST_WORKERS ? { maxWorkers: Number(process.env.PLAINVA_TEST_WORKERS) } : {}),
  },
});
