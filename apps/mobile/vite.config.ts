import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port 1430 on purpose: the desktop dev server owns 1420 and both run in
// parallel during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1430,
    strictPort: true,
  },
  test: {
    // Scoped to src on purpose: `e2e-prod` holds a PLAYWRIGHT spec, and an
    // unrestricted vitest run would try to execute it and fail on the import.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
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
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-i18next|i18next)[\\/]/.test(id)) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
} as any);
