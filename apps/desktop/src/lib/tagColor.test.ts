// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyTagColors, tagColorAttrs, tagColorIndex } from "@plainva/ui";

/**
 * The colour of a tag (finding 2026-09-19): nothing is stored, the colour
 * follows from the NAME - from its root - and it paints only under the device
 * switch.
 */
afterEach(() => applyTagColors(false));

describe("the colour of a tag", () => {
  it("comes from the root, so a family stands together", () => {
    expect(tagColorIndex("project/site")).toBe(tagColorIndex("project/print"));
    expect(tagColorIndex("project/site/launch")).toBe(tagColorIndex("project"));
    expect(tagColorIndex("#project")).toBe(tagColorIndex("project"));
  });

  it("does not tell #Project from #project - the index does not either", () => {
    expect(tagColorIndex("Project/Site")).toBe(tagColorIndex("project/site"));
  });

  it("is never the grey slot: a tag that stays grey with colours on reads as a bug", () => {
    const names = Array.from({ length: 400 }, (_, i) => `tag-${i}`);
    const slots = new Set(names.map(tagColorIndex));
    expect([...slots].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("travels as the attribute the stylesheet reads", () => {
    expect(tagColorAttrs("idea")).toEqual({ "data-tag-color": String(tagColorIndex("idea")) });
  });
});

describe("the device switch", () => {
  it("is an attribute on <html>, and absent when off", () => {
    applyTagColors(true);
    expect(document.documentElement.getAttribute("data-tag-colors")).toBe("on");
    applyTagColors(false);
    expect(document.documentElement.hasAttribute("data-tag-colors")).toBe(false);
  });
});
