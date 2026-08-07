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
