import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The settings page reserves its scrollbar gutter (finding 2026-09-04): the
 * theme gallery is an auto-fill grid just above its four-column threshold, and
 * a page that started to roll took the scrollbar's width away from the content,
 * reflowing four cards into three. The width of a settings page must never
 * depend on its height.
 */
describe("settings page scrollbar gutter", () => {
  it("is stable on the page scroller", () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/ui/src/styles/ui.css"), "utf8");
    const block = /\.pv-setpages > \.pv-setpage \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(block).toContain("overflow-y: auto");
    expect(block).toContain("scrollbar-gutter: stable");
  });
});
