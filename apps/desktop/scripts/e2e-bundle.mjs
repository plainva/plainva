/**
 * The bundle the desktop end-to-end suite runs against in CI (stability plan
 * R10): `vite build --mode e2e`, served by `vite preview`.
 *
 * Until 2026-11 the suite ran against the Vite dev server only: one transform
 * pipeline behind every test, one worker, 67 minutes, and a bundle the suite
 * never saw (the production smokes look at the first screen and nothing more).
 * The e2e bundle is the shipped build plus what a handful of tests reach into
 * on purpose, and nothing else:
 *
 * - the probe pages' fixture modules (`e2e/fixtures/*Probe.ts(x)`): a probe
 *   page imports one of them by its source path, as it does from the dev server;
 * - three app modules a test drives directly (`TEST_HOOK_MODULES`). Each is an
 *   entry of its own, so the app and the test share ONE instance of it.
 *
 * `vite preview` answers the source paths with a redirect to the built file
 * (from the build manifest), so a spec reads the same in both modes. The dev
 * server stays the local default (`pnpm test:e2e`, or `E2E_BASE_URL` for a dev
 * server on another port); `E2E_BUNDLE=1` runs against this bundle instead.
 *
 * A release build is built in its own mode and gets none of it:
 * `e2eBundleBuild()` and `e2eBundlePlugins()` give nothing for any other mode,
 * and `e2eBundleIsolation.test.ts` holds the release workflows to that.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const E2E_BUNDLE_MODE = "e2e";
export const E2E_BUNDLE_OUT_DIR = "dist-e2e";

/** App modules a test imports by path to drive the app (relative to apps/desktop). */
export const TEST_HOOK_MODULES = ["src/services/syncStatusStore.ts", "src/services/dirtyStore.ts", "src/services/personalDesign.ts"];

/** What a probe page cannot do without in a bundle: the dev server's React refresh preamble, as a no-op. */
const REACT_REFRESH_STUB = "export default { injectIntoGlobalHook() {} };\n";

function probeModules(root) {
  const dir = join(root, "e2e", "fixtures");
  return readdirSync(dir).filter((name) => /Probe\.tsx?$/.test(name)).map((name) => `e2e/fixtures/${name}`);
}

/** Every extra entry of the e2e bundle, by its path relative to apps/desktop. */
export function e2eBundleEntries(root) {
  return [...probeModules(root), ...TEST_HOOK_MODULES];
}

/**
 * What the e2e mode adds to `build` (`build`) and to `build.rollupOptions`
 * (`rollup`); both empty for every other mode.
 */
export function e2eBundleBuild(mode, root) {
  if (mode !== E2E_BUNDLE_MODE) return { build: {}, rollup: {} };
  const input = { index: resolve(root, "index.html") };
  for (const rel of e2eBundleEntries(root)) input[`e2e-entry/${rel.replace(/\.[^.]+$/, "").replace(/[/\\]/g, "_")}`] = resolve(root, rel);
  return {
    build: { outDir: E2E_BUNDLE_OUT_DIR, manifest: true },
    // An entry keeps its exports: the test imports them.
    rollup: { input, preserveEntrySignatures: "exports-only" },
  };
}

/** Serves a source path a test imports as the built file it became. */
export function e2eBundlePlugins(mode, root) {
  if (mode !== E2E_BUNDLE_MODE) return [];
  return [{
    name: "plainva-e2e-bundle-paths",
    configurePreviewServer(server) {
      const manifestPath = join(root, E2E_BUNDLE_OUT_DIR, ".vite", "manifest.json");
      let built = null;
      const lookup = () => {
        if (built) return built;
        if (!existsSync(manifestPath)) throw new Error(`e2e bundle: ${manifestPath} is missing; build with --mode e2e first`);
        built = new Map();
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        for (const [src, chunk] of Object.entries(manifest)) if (chunk.isEntry) built.set(`/${src}`, `/${chunk.file}`);
        return built;
      };
      server.middlewares.use((req, res, next) => {
        const path = (req.url || "").split("?")[0];
        if (path === "/@react-refresh") {
          res.setHeader("Content-Type", "text/javascript");
          res.end(REACT_REFRESH_STUB);
          return;
        }
        if (!path.startsWith("/src/") && !path.startsWith("/e2e/")) return next();
        const target = lookup().get(path);
        if (!target) {
          // A test imported a module the bundle has no entry for: say which,
          // rather than letting the import fail on an HTML 404 page.
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain");
          res.end(`e2e bundle: ${path} is not an entry of the e2e bundle (apps/desktop/scripts/e2e-bundle.mjs)`);
          return;
        }
        res.statusCode = 302;
        res.setHeader("Location", target);
        res.end();
      });
    },
  }];
}
