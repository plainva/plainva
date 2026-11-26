// Types for packageBarrels.mjs (the shells' build); the module itself documents what it does.
import type { Plugin } from "vite";
export declare const PACKAGE_BARRELS: Record<string, string>;
export declare function packageBarrels(): Plugin;
