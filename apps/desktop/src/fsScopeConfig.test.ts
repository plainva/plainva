import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * tauri-plugin-fs checks every path against the capability scope with the `glob`
 * crate's `require_literal_leading_dot`, which defaults to `true` on Unix (Linux
 * and macOS) and `false` on Windows. With the default on, `*`/`**` never match a
 * path segment starting with `.`, so a dot-file inside a dot-folder (e.g. an
 * Obsidian vault's `.attachments/.gitkeep` or `.rumdl_cache/.gitignore`) is
 * rejected: no combination of glob patterns in capabilities/default.json covers
 * two dot-segments in a row (issue #70). Turning the flag off here matches the
 * Windows default everywhere and makes the existing `**` pattern sufficient.
 */
describe("fs plugin scope config", () => {
  it("disables the Unix leading-dot glob restriction", () => {
    const conf = JSON.parse(readFileSync(resolve(__dirname, "../src-tauri/tauri.conf.json"), "utf8"));
    expect(conf?.plugins?.fs?.requireLiteralLeadingDot).toBe(false);
  });
});
