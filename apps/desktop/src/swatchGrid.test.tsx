// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SwatchGrid } from "@plainva/ui";

const PRESETS = ["#c94f4f", "#2f6f6f", "#5a5fd0"];

/**
 * THE colour choice (plan "Farbwahl überall", 2026-09-04): fixed slots, the
 * pick a ring, the free colour a disc in the last slot — and the ring always
 * sits somewhere: on the preset that matches, or on the free disc when the
 * value is none of them (the dark default ground of "My theme" was not, and
 * the row showed no pick at all).
 */
describe("SwatchGrid", () => {
  it("rings the matching preset, case-insensitively, and leaves the free disc plain", () => {
    const html = renderToStaticMarkup(
      <SwatchGrid presets={PRESETS} value="#2F6F6F" onPick={() => {}} free={{ label: "Custom", onChange: () => {} }} />,
    );
    const pressed = html.match(/aria-pressed="true"/g) ?? [];
    expect(pressed).toHaveLength(1);
    expect(html).toContain('aria-label="#2f6f6f" aria-pressed="true"');
    expect(html).not.toContain("pv-swatch--free is-on");
  });

  it("rings the free disc when the value is none of the presets", () => {
    const html = renderToStaticMarkup(
      <SwatchGrid presets={PRESETS} value="#123456" onPick={() => {}} free={{ label: "Custom", onChange: () => {} }} />,
    );
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).toContain("pv-swatch--free is-on");
    expect(html).toContain('type="color" aria-label="Custom" value="#123456"');
  });

  it("an active none slot takes the ring from everything else", () => {
    const html = renderToStaticMarkup(
      <SwatchGrid
        presets={PRESETS}
        value="#123456"
        onPick={() => {}}
        none={{ label: "Default", active: true, onPick: () => {}, glyph: "letter" }}
        free={{ label: "Custom", onChange: () => {} }}
      />,
    );
    expect(html).toContain('aria-label="Default" aria-pressed="true"');
    expect(html).not.toContain("pv-swatch--free is-on");
    expect(html).toContain(">A</button>");
  });

  it("a slash none slot has no letter, and preset test ids follow the prefix", () => {
    const html = renderToStaticMarkup(
      <SwatchGrid
        presets={PRESETS}
        value=""
        onPick={() => {}}
        none={{ label: "Calendar colour", active: true, onPick: () => {}, glyph: "slash", testId: "ctx-color-default" }}
        testIdPrefix="ctx-color-"
      />,
    );
    expect(html).toContain("pv-swatch--none-slash");
    expect(html).not.toContain(">A</button>");
    expect(html).toContain('data-testid="ctx-color-#c94f4f"');
    expect(html).toContain('data-testid="ctx-color-default"');
  });

  it("read-only renders plain discs, nothing to press, and the column count is a variable", () => {
    const html = renderToStaticMarkup(<SwatchGrid presets={PRESETS} readOnly columns={6} />);
    expect(html).not.toContain("<button");
    expect(html).toContain("pv-swatch--static");
    expect(html).toContain("--swatch-cols:6");
  });
});
