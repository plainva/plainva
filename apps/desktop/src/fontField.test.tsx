// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FontField } from "@plainva/ui";

/**
 * The font field (second look 2026-09-04, A3): the field SHOWS what is chosen
 * — the default by its real name, or the picked family — and the list only
 * exists once it is opened. Before this, twenty rows stood open under a text
 * field whose placeholder read "Wie das Design".
 */
describe("FontField", () => {
  it("shows the default by name when nothing is chosen, and the family when one is", () => {
    const empty = renderToStaticMarkup(<FontField value="" onChange={() => {}} defaultLabel="Standard (Inter)" ariaLabel="Schrift" />);
    expect(empty).toContain("Standard (Inter)");
    expect(empty).toContain('aria-expanded="false"');
    // The catalogue list is not on the page until the field is opened.
    expect(empty).not.toContain("pv-popover");

    const chosen = renderToStaticMarkup(<FontField value="Georgia" onChange={() => {}} defaultLabel="Standard (Inter)" ariaLabel="Schrift" />);
    expect(chosen).toContain("Georgia");
    expect(chosen).not.toContain("Standard (Inter)");
  });
});
