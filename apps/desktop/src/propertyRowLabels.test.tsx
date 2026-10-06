// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyRow } from "./components/PropertyValues";
import type { PropertyType } from "@plainva/ui";

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
 *
 * Since 2026-10-06 (plan Befunde, R2) the row is the context column's one
 * row — icon · name · value · edge — and the name is a growing field instead
 * of a one-line input: an input cannot wrap, and it cut `day_of_week` without
 * a sign. That is why the two label tests below read the field's TEXT instead
 * of an `value="…"` attribute; what they pin is unchanged.
 */

const t = (key: string, opts?: Record<string, unknown>) => (opts && "key" in opts ? `${key}:${String(opts.key)}` : key);
const noop = () => {};
const base = {
  onChangeValue: noop, onRename: noop, onDelete: noop, onChangeType: noop,
  tagSuggestions: [], t, locale: "de",
};

const row = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild as HTMLElement;
};
const cells = (el: HTMLElement) => [...el.children].map((child) => child.className);

describe("PropertyRow (2026-09-04)", () => {
  it("shows the display label for a locked row and keeps the key on the element and in the lock tooltip", () => {
    const html = renderToStaticMarkup(
      <PropertyRow {...base} propKey="okf_version" value="0.2" type="text" lockMeta lockValue displayLabel="OKF-Version" />,
    );
    const name = row(html).querySelector<HTMLTextAreaElement>(".pv-prow-name textarea")!;
    expect(name.textContent).toBe("OKF-Version");
    expect(name.getAttribute("data-key")).toBe("okf_version");
    expect(name.disabled).toBe(true);
    expect(html).toContain('data-tip="properties.okfKeyHint:okf_version"');
    // The file's key is never shown as the label once a display label exists.
    expect(row(html).querySelector(".pv-prow-name")!.textContent).not.toContain("okf_version");
  });

  it("keeps the raw key as the label where no display label is given", () => {
    const html = renderToStaticMarkup(<PropertyRow {...base} propKey="type" value="Note" type="text" lockMeta />);
    expect(row(html).querySelector(".pv-prow-name textarea")!.textContent).toBe("type");
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

/**
 * One row for every value type (plan Befunde 2026-10-06, R2, § 6).
 *
 * The column had a form per type: a select with its own inset, tag pills with
 * an input behind them, a date as a button, text as an input, a switch as a
 * pill — and the lock and the delete button now in the name, now at the end.
 * Whatever the type, the row is the same four cells in the same order, and
 * what a row can do stands in the edge.
 */
const VALUES: Array<{ type: PropertyType; value: unknown; edge: "caret" | "plus" | "none"; frame: "quiet" | "none" }> = [
  { type: "text", value: "Donnerstag", edge: "none", frame: "quiet" },
  { type: "number", value: 3, edge: "none", frame: "quiet" },
  { type: "url", value: "https://example.org", edge: "none", frame: "quiet" },
  { type: "email", value: "a@example.org", edge: "none", frame: "quiet" },
  { type: "phone", value: "030 1234", edge: "none", frame: "quiet" },
  { type: "date", value: "2026-09-24", edge: "none", frame: "quiet" },
  { type: "datetime", value: "2026-09-24T10:30", edge: "none", frame: "quiet" },
  { type: "checkbox", value: true, edge: "none", frame: "none" },
  { type: "rating", value: 3, edge: "none", frame: "none" },
  { type: "select", value: "draft", edge: "caret", frame: "quiet" },
  { type: "status", value: "draft", edge: "caret", frame: "quiet" },
  { type: "multiselect", value: ["a", "b"], edge: "plus", frame: "quiet" },
  { type: "list", value: ["a", "b"], edge: "plus", frame: "quiet" },
  { type: "tags", value: ["typ/tagebuch", "ort/mahlow"], edge: "plus", frame: "quiet" },
  { type: "link", value: ["[[Alpha]]"], edge: "plus", frame: "quiet" },
];

describe("PropertyRow: one grammar for every value type (2026-10-06)", () => {
  for (const { type, value, edge, frame } of VALUES) {
    it(`${type}: icon, name, value, edge — in that order, and the edge says what the row is`, () => {
      const el = row(renderToStaticMarkup(<PropertyRow {...base} propKey="feld" value={value} type={type} onComment={noop} />));
      expect(el.className).toBe("pv-prow");
      expect(cells(el)).toEqual(["pv-prow-icon", "pv-prow-name", "pv-prow-value", "pv-prow-edge"]);
      expect(el.getAttribute("data-kind")).toBe(type);
      expect(el.getAttribute("data-frame")).toBe(frame);

      // The type glyph is the button that opens the type menu.
      expect(el.querySelector(".pv-prow-icon > .pv-type-btn")).not.toBeNull();
      // The name is an editable field that can wrap.
      expect(el.querySelector(".pv-prow-name textarea")!.textContent).toBe("feld");

      const rest = el.querySelector(".pv-prow-edge > .pv-prow-rest");
      if (edge === "none") expect(rest).toBeNull();
      else expect(rest!.querySelector("svg")!.getAttribute("class")).toContain(edge === "caret" ? "lucide-chevron-down" : "lucide-plus");

      // Comment and delete live in the edge, never beside the value: nothing
      // of them is a child of the row itself or of its value.
      const actions = el.querySelector(".pv-prow-edge > .pv-prow-actions")!;
      expect(actions.querySelector(".pv-comment-dot")).not.toBeNull();
      expect(actions.querySelector(".pv-del")).not.toBeNull();
      expect(el.querySelector(".pv-prow-value .pv-del, .pv-prow-value .pv-comment-dot, .pv-prow-name .pv-del")).toBeNull();
      // No caret inside the value: a select's caret is the edge's.
      expect(el.querySelector(".pv-prow-value .pv-select-caret")).toBeNull();
    });
  }

  it("text is ONE value in a field that grows: it wraps, and its frame is the row's, not the field's", () => {
    const el = row(renderToStaticMarkup(<PropertyRow {...base} propKey="notiz" value="Ein langer Wert" type="text" />));
    const field = el.querySelector<HTMLTextAreaElement>(".pv-prow-value textarea")!;
    expect(field.className).toContain("pv-field--grow");
    expect(field.textContent).toBe("Ein langer Wert");
    expect(field.getAttribute("rows")).toBe("1");
  });

  it("a date shows its long form in a value that may wrap — no short form, no ellipsis", () => {
    const el = row(renderToStaticMarkup(<PropertyRow {...base} propKey="date" value="2026-09-24" type="date" locale="de" />));
    const date = el.querySelector(".pv-prow-value .pv-prow-date")!;
    expect(date.textContent).toMatch(/24\. September 2026/);
    expect(date.getAttribute("style")).toBeNull();
  });

  it("every chip carries its full text as a tooltip, for the day it is longer than the row", () => {
    const tags = row(renderToStaticMarkup(<PropertyRow {...base} propKey="tags" value={["typ/tagebuch"]} type="tags" />));
    expect(tags.querySelector(".pv-chip")!.getAttribute("data-tip")).toBe("typ/tagebuch");
    const multi = row(renderToStaticMarkup(<PropertyRow {...base} propKey="tags" value={["a"]} type="multiselect" curatedOptions={[{ value: "a", label: "Alpha" }]} />));
    expect(multi.querySelector(".pv-chip")!.getAttribute("data-tip")).toBe("Alpha");
    const select = row(renderToStaticMarkup(<PropertyRow {...base} propKey="s" value="a" type="select" curatedOptions={[{ value: "a", label: "Alpha" }]} />));
    expect(select.querySelector(".pv-chip")!.getAttribute("data-tip")).toBe("Alpha");
    const link = row(renderToStaticMarkup(<PropertyRow {...base} propKey="p" value={["[[Ein langer Notizname]]"]} type="link" />));
    expect(link.querySelector(".pv-chip-link-open")!.getAttribute("data-tip")).toBe("Ein langer Notizname");
    expect(link.querySelector(".pv-chip-link-open > .pv-chip-text")!.textContent).toBe("Ein langer Notizname");
  });

  it("a locked row shows its lock in the edge and keeps it there: its actions open beside it", () => {
    const el = row(renderToStaticMarkup(<PropertyRow {...base} propKey="type" value="Note" type="select" lockMeta onComment={noop} />));
    const edgeCell = el.querySelector(".pv-prow-edge")!;
    expect(edgeCell.getAttribute("data-keep")).toBe("true");
    expect(edgeCell.querySelector(".pv-prow-rest .lucide-lock")).not.toBeNull();
    // Locked: no delete, and the type glyph does nothing.
    expect(el.querySelector(".pv-del")).toBeNull();
    expect(el.querySelector<HTMLButtonElement>(".pv-type-btn")!.disabled).toBe(true);
  });

  it("a value that cannot be changed is text, without a field frame", () => {
    const el = row(renderToStaticMarkup(<PropertyRow {...base} propKey="okf_version" value="0.2" type="text" lockMeta lockValue />));
    expect(el.getAttribute("data-frame")).toBe("none");
    expect(el.querySelector(".pv-prow-value textarea, .pv-prow-value input")).toBeNull();
    expect(el.querySelector(".pv-prow-value .pv-prow-static")!.textContent).toBe("0.2");
  });

  it("a comment count stays visible at rest, the other actions do not", () => {
    const withCount = row(renderToStaticMarkup(<PropertyRow {...base} propKey="a" value="x" type="text" onComment={noop} commentCount={2} />));
    expect(withCount.querySelector(".pv-prow-actions")!.getAttribute("data-pinned")).toBe("true");
    expect(withCount.querySelector(".pv-comment-dot")!.getAttribute("data-has")).toBe("true");
    const without = row(renderToStaticMarkup(<PropertyRow {...base} propKey="a" value="x" type="text" onComment={noop} />));
    expect(without.querySelector(".pv-prow-actions")!.getAttribute("data-pinned")).toBeNull();
    expect(without.querySelector(".pv-comment-dot")!.getAttribute("data-has")).toBe("false");
  });
});
