/**
 * The bundle the desktop end-to-end suite runs against in CI (stability plan
 * R10): `vite build --mode e2e` into dist-e2e, served by `vite preview`.
 *
 * Until 2026-11 the suite ran against the Vite dev server only: one transform
 * pipeline behind every test, one worker, 67 minutes, and a bundle the suite
 * never saw (the production smokes look at the first screen and nothing more).
 *
 * The e2e bundle is the production build, chunk for chunk. The first version
 * added the test fixtures and three app modules as extra entries; that moved
 * modules between chunks, changed the order they load in, and the app in it
 * failed where the shipped one does not (a slot builder read before its module
 * had run). So nothing is added to the module graph:
 *
 * - A few tests drive an app module directly (`TEST_HOOK_MODULES`, imported by
 *   its source path as from the dev server). In the e2e mode those modules get
 *   one line appended that registers their exports on `globalThis` when they
 *   load; `vite preview` answers the source path with a module that waits for
 *   that registration and re-exports it. Same instance as the app's, no new
 *   chunk, no new import.
 * - The probe pages (`PROBE_SPECS`, a bare page around one fixture module) do
 *   not use the app at all: they run against the dev server in a job of their
 *   own (`E2E_PROBES=1`), and the bundle run leaves them out.
 *
 * A release build is built in its own mode and gets none of it:
 * `e2eBundleBuild()` and `e2eBundlePlugins()` give nothing for any other mode,
 * and ciWorkflow.test.ts holds the release workflows to that.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const E2E_BUNDLE_MODE = "e2e";
export const E2E_BUNDLE_OUT_DIR = "dist-e2e";

/** App modules a test imports by path to drive the app (relative to apps/desktop). */
export const TEST_HOOK_MODULES = ["src/services/syncStatusStore.ts", "src/services/dirtyStore.ts", "src/services/personalDesign.ts"];

/** Specs built on probe pages: a bare page that imports one fixture module from the dev server. */
export const PROBE_SPECS = [
  "floatingLayer.spec.ts",
  "listGeometry.spec.ts",
  "menus.spec.ts",
  "pinboardReturn.spec.ts",
  "pressBeside.spec.ts",
  "propertySuggestions.spec.ts",
  "rtlEditor.spec.ts",
  "security-rendering.spec.ts",
  "tableCell.spec.ts",
];

const REGISTRY = "__plainvaTestModules";

/** The names a module exports, read from its source (`export const|function|class|let`, `export { … }`). */
export function exportedNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (name && !part.trim().startsWith("type ")) names.add(name);
    }
  }
  return [...names];
}

/** The `build` options the e2e mode adds; empty for every other mode. */
export function e2eBundleBuild(mode) {
  if (mode !== E2E_BUNDLE_MODE) return {};
  return { outDir: E2E_BUNDLE_OUT_DIR };
}

/** The registration line and the source-path answers; nothing for every other mode. */
export function e2eBundlePlugins(mode, root) {
  if (mode !== E2E_BUNDLE_MODE) return [];
  const hookKey = (id) => {
    const rel = id.replace(/\\/g, "/").split("?")[0];
    return TEST_HOOK_MODULES.find((m) => rel.endsWith(`/apps/desktop/${m}`));
  };
  return [{
    name: "plainva-e2e-bundle",
    transform(code, id) {
      const key = hookKey(id);
      if (!key) return null;
      const names = exportedNames(code);
      return { code: `${code}\n;(globalThis.${REGISTRY} ??= {})[${JSON.stringify(key)}] = { ${names.join(", ")} };\n`, map: null };
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || "").split("?")[0];
        const key = TEST_HOOK_MODULES.find((m) => path === `/${m}`);
        if (!key) return next();
        const names = exportedNames(readFileSync(join(root, key), "utf8"));
        // The module registers itself when the app loads it; a test asks after the app is up.
        const body = [
          `const key = ${JSON.stringify(key)};`,
          `let mod = globalThis.${REGISTRY}?.[key];`,
          `for (let waited = 0; !mod && waited < 15000; waited += 50) { await new Promise((r) => setTimeout(r, 50)); mod = globalThis.${REGISTRY}?.[key]; }`,
          `if (!mod) throw new Error("e2e bundle: " + key + " was never loaded by the app");`,
          ...names.map((n) => `export const ${n} = mod.${n};`),
          "",
        ].join("\n");
        res.setHeader("Content-Type", "text/javascript");
        res.setHeader("Cache-Control", "no-store");
        res.end(body);
      });
    },
  }];
}
