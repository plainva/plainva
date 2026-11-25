// Types for localeAreas.mjs (the locale files by area); the module itself documents what it does.
import type { Plugin } from "vite";
export declare function readLocaleAreas(): Record<string, string[]>;
export declare function localeArea(messages: Record<string, unknown>, area: string, areas?: Record<string, string[]>): Record<string, unknown>;
export declare function localeAreas(): Plugin;
