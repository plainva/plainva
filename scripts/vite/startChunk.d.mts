// Types for startChunk.mjs; the module itself documents what it does.
import type { Plugin } from "vite";
export declare function startChunk(entry: RegExp): { plugin: Plugin; chunkOf(id: string): string | undefined };
