import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { buildInfoDefine } from "../../scripts/build-info.mjs";
import { packageBarrels } from "../../scripts/vite/packageBarrels.mjs";
import { localeAreas } from "../../scripts/vite/localeAreas.mjs";
import { startChunk } from "../../scripts/vite/startChunk.mjs";
import { pinTestTimeZone } from "../../scripts/test-clock.mjs";
import { e2eBuildDefine } from "./scripts/e2e-build-env.mjs";

// Port 1430 on purpose: the desktop dev server owns 1420 and both run in
// parallel during development.
export default defineConfig(({ mode }) => {
  const start = startChunk(/apps\/mobile\/src\/main\.tsx$/);
  // Unit tests run in one fixed zone, set before any worker starts (R9, scripts/test-clock.mjs).
  if (mode === "test") pinTestTimeZone();
  return {
  // Named imports of the shared packages go to the defining module in a build; the locale files load by area (performance plan L5).
  plugins: [packageBarrels(), localeAreas(), start.plugin, react()],
  // Which build this is (channel, branch, commit, CI run) for About & diagnostics.
  // The e2e build (`--mode e2e`, the smoke:prod script) also ships the fake
  // provider's standard Google client; every other mode gets nothing from it.
  define: { ...buildInfoDefine(), ...e2eBuildDefine(mode) },
  // Same canonical source module as desktop; no package build/HMR split.
  resolve: {
    alias: [
      { find: /^@plainva\/core$/, replacement: fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)) },
      // The parts of the core the start does not need have entries of their own, so a static import of the main entry
      // never drags them into the start bundle (performance plan L5).
      { find: /^@plainva\/core\/(ai|import|workspace)$/, replacement: fileURLToPath(new URL("../../packages/core/src/$1/index.ts", import.meta.url)) },
    ],
  },
  server: {
    port: 1430,
    strictPort: true,
  },
  // The engine of the script sandbox loads inside the script worker, the first time a script runs: pre-bundled, so
  // the dev server does not discover it then and reload the page under the run.
  optimizeDeps: { include: ["@plainva/ui > quickjs-emscripten-core", "@plainva/ui > @jitl/quickjs-ng-wasmfile-release-sync", "@plainva/ui > @jitl/quickjs-ng-wasmfile-release-sync/emscripten-module"] },
  // The script worker (packages/ui/src/ai/scripts) is a module worker that loads its engine on demand: that needs
  // code splitting, which only the `es` format has.
  worker: { format: "es" },
  test: {
    // Scoped to src on purpose: `e2e-prod` holds a PLAYWRIGHT spec, and an
    // unrestricted vitest run would try to execute it and fail on the import.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // See the desktop config: the suites run side by side under turbo, and a
    // real-SQLite test that takes 200 ms alone timed out at 5 s in the hook.
    testTimeout: 20_000,
    // Setup and teardown hooks get their own, longer cap: some build a real
    // SQLite file or a vault on disk, and the Windows release runner took more
    // than the 10 s default for that (release 0.8.6, Sammelplan 3.149).
    hookTimeout: 60_000,
    // See the desktop config: PLAINVA_TEST_WORKERS=<n> caps the workers on a loaded machine.
    ...(process.env.PLAINVA_TEST_WORKERS ? { maxWorkers: Number(process.env.PLAINVA_TEST_WORKERS) } : {}),
    // Same repair as the desktop's (code review B3): Node >= 25 ships an
    // ambient localStorage whose methods are all missing, and its workers
    // print a "--localstorage-file" warning on every start. vaultBackup's
    // `localStorage.clear()` threw on the harness while CI's Node 22 stayed
    // green (2026-09-10); the shim and the flag close the class here too.
    // test-setup gives `vi.waitFor` the suites' common default (Sammelplan 3.160 Nr. 3).
    // The test clock comes first (R9): every file starts at TEST_NOW, in the zone pinned at the top.
    setupFiles: [fileURLToPath(new URL("../../scripts/vitest-shared-setup.mjs", import.meta.url)), "./src/test-localstorage.ts", "./src/test-setup.ts"],
    execArgv: ["--no-experimental-webstorage"],
  },
  build: {
    /**
     * Pinned for the same reason as the desktop's: inherited from Vite's default
     * this number moves on its own with a dependency bump, and the one thing a
     * floor must not do is move quietly (issue #46).
     *
     * It matches the desktop because the phone ships the same shared packages,
     * and those are what set the bar — a scan of the built bundle finds regex
     * lookbehind (Safari 16.4) in two chunks of the STARTUP chain.
     *
     * This number and IPHONEOS_DEPLOYMENT_TARGET in the Xcode project say the
     * same thing on purpose. They did not until 2026-08-22: the project said
     * 15.0 while the bundle needed 16.4, so the App Store offered Plainva to
     * devices on which it could not start. The target was raised to 16.4 --
     * on iOS the engine ships WITH the system, so the iOS version IS the
     * engine version, unlike macOS where Safari.app can run years ahead of
     * the WebView an app embeds (issue #46). floorConsistency.test.ts holds
     * the two together from here on.
     */
    target: ["chrome111", "edge111", "firefox114", "safari16.4", "ios16.4"],
    rollupOptions: {
      output: {
        // Modules run in the order their imports say, whichever chunk they
        // land in. Rolldown does not promise that by default: across chunks
        // that import each other, a module could run before one it imports
        // and read its exports as undefined. In the desktop bundle the
        // keychain slot builders were undefined that way and every mail
        // sign-in check threw; a probe of the shared UI read a list of AI
        // tools as "not iterable" (stability plan R10, 2026-11-10). This
        // closes the class for every module instead of rewriting each read.
        strictExecutionOrder: true,
        /**
         * React and everything that reaches for it go in ONE chunk.
         *
         * Without this the mobile app did not mount from a production build at
         * all: `TypeError: ae is not a function` while evaluating a feature
         * chunk, where `ae` is the CommonJS shim for react-dom and `t(ae())`
         * is react-i18next's interop call at module scope. The automatic split
         * had put the shim and its caller in two chunks that reference each
         * other, so the caller ran before the shim was initialised — a cycle,
         * and the same class of failure as the white window in v0.3.0: the dev
         * server orders modules differently and stays green.
         *
         * The desktop has pinned its React chunk since the performance pass and
         * was therefore never exposed. This is that rule, and only that rule —
         * mobile has no editor or markdown stack to split.
         */
        manualChunks(id: string) {
          // What the entry reaches through static imports goes into one chunk, `start` (startChunk.mjs).
          if (!id.includes("node_modules")) return start.chunkOf(id);
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-i18next|i18next)[\\/]/.test(id)) {
            return "react";
          }
          return start.chunkOf(id);
        },
      },
    },
  },
  } as any;
});
