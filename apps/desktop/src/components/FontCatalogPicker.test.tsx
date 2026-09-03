// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { FontCatalogPicker, FONT_CATALOG, detectFontPlatform, type CatalogFont } from "@plainva/ui";

/**
 * The font list in front of the free-text field (P12, T7): every catalog
 * font of this platform is a row previewed in its own face, the current
 * value is marked, a tap hands the font over. jsdom has no canvas, so the
 * verdict "installed?" is unknown here and every row stays pickable — the
 * verdict itself is pinned in fontCatalog.test.ts.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("FontCatalogPicker", () => {
  it("lists this platform's catalog, marks the current font, and hands a pick over", async () => {
    const picked: CatalogFont[] = [];
    const fonts = FONT_CATALOG[detectFontPlatform()];
    await act(async () => {
      root.render(<FontCatalogPicker value={fonts[1].css} onPick={(f) => picked.push(f)} />);
    });
    await act(async () => { await Promise.resolve(); });
    const rows = container.querySelectorAll(".pv-grouprow");
    expect(rows.length).toBe(fonts.length);
    // The preview is the row itself, set in the font it names.
    const title = rows[0].querySelector(".pv-grouprow-title span") as HTMLElement;
    expect(title.style.fontFamily.replace(/"/g, "")).toBe(fonts[0].css);
    expect(rows[1].getAttribute("aria-pressed")).toBe("true");
    expect(rows[0].getAttribute("aria-pressed")).toBe("false");
    act(() => { (rows[0] as HTMLElement).click(); });
    expect(picked.map((f) => f.css)).toEqual([fonts[0].css]);
    expect(container.textContent).toContain("Tap a font to use it");
  });
});
