import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Dependencies that only load through LAZY chunks (P2.8/P2.9/P3.4/P3.5).
  // Without pre-bundling, the dev server discovers them on first open,
  // re-optimizes and FULL-RELOADS the page — which rips the state out from
  // under any E2E test (and user session) running at that moment.
  optimizeDeps: {
    include: [
      "mermaid",
      "katex",
      "remark-math",
      "rehype-katex",
      "@tauri-apps/plugin-updater",
      "@tauri-apps/plugin-process",
      "@codemirror/merge",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          if (id.includes("@codemirror") || id.includes("@lezer") || id.includes("@uiw/")) {
            // Statisch benoetigter Sprach-Stack des Markdown-Editors: lang-markdown
            // bettet HTML ein und zieht darueber lang-css/lang-javascript samt Parsern mit.
            if (/\/@codemirror\/lang-(markdown|html|css|javascript)\//.test(id)) return "editor";
            if (/\/@lezer\/(common|highlight|lr|markdown|html|css|javascript)\//.test(id)) return "editor";
            // Alle uebrigen Sprachpakete laedt @codemirror/language-data per Dynamic-Import.
            // Kein manualChunks-Zwang, damit Vite sie als eigene Lazy-Chunks emittiert
            // und Codeblock-Highlighting on demand laedt.
            if (/\/@codemirror\/(lang-|legacy-modes)/.test(id) || id.includes("@lezer")) return undefined;
            return "editor";
          }
          if (id.includes("react-markdown") || id.includes("remark") || id.includes("micromark") || id.includes("mdast") || id.includes("hast") || id.includes("unified") || id.includes("vfile")) {
            return "markdown";
          }
          if (id.includes("@tauri-apps")) {
            return "tauri";
          }
          if (id.includes("react") || id.includes("react-dom")) {
            return "react";
          }

          return undefined;
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // test-localstorage repairs Node >= 25's broken ambient localStorage and
    // must run FIRST; test-setup loads every locale bundle eagerly for tests —
    // the app itself lazy-loads them (P2.8) and tests would otherwise assert
    // against raw keys.
    setupFiles: ['./src/test-localstorage.ts', './src/test-setup.ts'],
  },
} as any));
