/** Types for `e2e-bundle.mjs` (the bundle the desktop E2E suite runs against in CI). */
export declare const E2E_BUNDLE_MODE: string;
export declare const E2E_BUNDLE_OUT_DIR: string;
export declare const TEST_HOOK_MODULES: string[];
export declare const PROBE_SPECS: string[];
export declare function exportedNames(source: string): string[];
export declare function e2eBundleBuild(mode: string): Record<string, unknown>;
export declare function e2eBundlePlugins(mode: string, root: string): unknown[];
