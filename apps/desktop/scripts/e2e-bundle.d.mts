/** Types for `e2e-bundle.mjs` (the bundle the desktop E2E suite runs against in CI). */
export declare const E2E_BUNDLE_MODE: string;
export declare const E2E_BUNDLE_OUT_DIR: string;
export declare const TEST_HOOK_MODULES: string[];
export declare function e2eBundleEntries(root: string): string[];
export declare function e2eBundleBuild(mode: string, root: string): { build: Record<string, unknown>; rollup: Record<string, unknown> };
export declare function e2eBundlePlugins(mode: string, root: string): unknown[];
