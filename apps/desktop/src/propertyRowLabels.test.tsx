// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyRow } from "./components/PropertyValues";

/**
 * The properties column in a narrow window (finding 2026-09-04): three rows
 * broke in three different ways, and all three had a structural cause that no
 * width fixes on its own.
 *
 *  - An OKF lifecycle row showed the raw key (`stale_after`) while the phone
 *    showed "Veraltet ab"; the row now takes a display label and keeps the key
 *    on the element and in the lock icon's tooltip.
 *  - A select chip's text was a bare text node, so it wrapped and the fixed
 *    chip height clipped it to "d". The text lives in .pv-chip-text now, where
 *    the ellipsis rule is.
 */

const t = (key: string, opts?: Record<string, unknown>) => (opts && "key" in opts ? `${key}:${String(opts.key)}` : key);
const noop = () => {};
const base = {
  onChangeValue: noop, onRename: noop, onDelete: noop, onChangeType: noop,
  tagSuggestions: [], t, locale: "de",
};

describe("PropertyRow (2026-09-04)", () => {
  it("shows the display label for a locked row and keeps the key on the element and in the lock tooltip", () => {
    const html = renderToStaticMarkup(
      <PropertyRow {...base} propKey="okf_version" value="0.2" type="text" lockMeta lockValue displayLabel="OKF-Version" />,
    );
    expect(html).toContain('value="OKF-Version"');
    expect(html).toContain('data-key="okf_version"');
    expect(html).toContain('data-tip="properties.okfKeyHint:okf_version"');
    // The file's key is never shown as the label once a display label exists.
    expect(html).not.toContain('value="okf_version"');
  });

  it("keeps the raw key as the label where no display label is given", () => {
    const html = renderToStaticMarkup(<PropertyRow {...base} propKey="type" value="Note" type="text" lockMeta />);
    expect(html).toContain('value="type"');
  });

  it("puts a select chip's text in .pv-chip-text so it truncates instead of wrapping", () => {
    const html = renderToStaticMarkup(
      <PropertyRow {...base} propKey="status" value="done" type="select" curatedOptions={[{ value: "done", label: "done" }]} />,
    );
    expect(html).toMatch(/<span class="pv-dot"><\/span><span class="pv-chip-text">done<\/span>/);
  });

  it("puts every multi-select chip's text in .pv-chip-text", () => {
    const html = renderToStaticMarkup(
      <PropertyRow {...base} propKey="tags" value={["alpha", "beta"]} type="multiselect" curatedOptions={[{ value: "alpha" }, { value: "beta" }]} />,
    );
    expect(html.match(/<span class="pv-chip-text">(alpha|beta)<\/span>/g)?.length).toBe(2);
  });
});
