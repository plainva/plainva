// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { tabLabel, dropIndicatorShadow, dropIndexFor, hitTestTabs, TAB_ATTR, PANE_ATTR, STRIP_ATTR } from "./tabStrip";

describe("tabLabel", () => {
  it("strips the .md extension", () => {
    expect(tabLabel("notes/Hello.md")).toBe("Hello");
  });

  it("strips the .base extension (plan D3)", () => {
    expect(tabLabel("db/Tasks.base")).toBe("Tasks");
    expect(tabLabel("Tasks.BASE")).toBe("Tasks");
  });

  it("handles Windows backslash separators", () => {
    expect(tabLabel("notes\\sub\\Note.md")).toBe("Note");
  });

  it("keeps unrelated extensions and dots in the name", () => {
    expect(tabLabel("image.png")).toBe("image.png");
    expect(tabLabel("v1.2.md")).toBe("v1.2");
  });

  it("falls back to Untitled for an empty path", () => {
    expect(tabLabel("")).toBe("Untitled");
  });
});

describe("dropIndicatorShadow", () => {
  it("returns undefined at rest so the stylesheet active-underline stays visible", () => {
    // An inline `box-shadow: none` would override the CSS rule that carries the
    // active-tab underline — the function must yield NO inline value instead.
    expect(dropIndicatorShadow(null, 0, 0)).toBeUndefined();
    expect(dropIndicatorShadow({ paneIndex: 0, tabIndex: 1, side: "before" }, 0, 0)).toBeUndefined();
  });

  it("only marks the tab in the matching pane (not the same index in another pane)", () => {
    const over = { paneIndex: 1, tabIndex: 0, side: "before" as const };
    expect(dropIndicatorShadow(over, 0, 0)).toBeUndefined();
    expect(dropIndicatorShadow(over, 1, 0)).toContain("inset 2px 0 0 0 var(--accent-color)");
  });

  it("adds a leading/trailing edge marker on the hovered tab", () => {
    expect(dropIndicatorShadow({ paneIndex: 0, tabIndex: 0, side: "before" }, 0, 0)).toBe("inset 2px 0 0 0 var(--accent-color)");
    expect(dropIndicatorShadow({ paneIndex: 0, tabIndex: 0, side: "after" }, 0, 0)).toBe("inset -2px 0 0 0 var(--accent-color)");
  });
});

describe("dropIndexFor", () => {
  it("inserts before (same index) when dropping on the left half", () => {
    expect(dropIndexFor({ paneIndex: 0, tabIndex: 2, side: "before" })).toBe(2);
  });
  it("inserts after (index + 1) when dropping on the right half", () => {
    expect(dropIndexFor({ paneIndex: 0, tabIndex: 2, side: "after" })).toBe(3);
  });
});

describe("hitTestTabs (pill tolerance)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** Strip 0..300 x 0..40 with two pill tabs that (like LCARS) neither fill
   *  the strip height nor sit flush: tab0 10..100, tab1 110..200, both y 8..28. */
  function mountStrip() {
    const strip = document.createElement("div");
    strip.setAttribute(STRIP_ATTR, "0");
    const rect = (left: number, right: number, top: number, bottom: number) =>
      () => ({ left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    strip.getBoundingClientRect = rect(0, 300, 0, 40);
    for (let i = 0; i < 2; i++) {
      const tab = document.createElement("div");
      tab.setAttribute(TAB_ATTR, String(i));
      tab.setAttribute(PANE_ATTR, "0");
      tab.getBoundingClientRect = rect(10 + i * 100, 100 + i * 100, 8, 28);
      strip.appendChild(tab);
    }
    document.body.appendChild(strip);
  }

  it("hits a tab exactly and picks the side from the horizontal half", () => {
    mountStrip();
    expect(hitTestTabs(20, 18)).toEqual({ paneIndex: 0, tabIndex: 0, side: "before" });
    expect(hitTestTabs(95, 18)).toEqual({ paneIndex: 0, tabIndex: 0, side: "after" });
    expect(hitTestTabs(115, 18)).toEqual({ paneIndex: 0, tabIndex: 1, side: "before" });
  });

  it("counts the full strip height, not just the pill's own box", () => {
    mountStrip();
    // y=35 is below the pill (bottom 28) but inside the strip (bottom 40).
    expect(hitTestTabs(50, 35)).toEqual({ paneIndex: 0, tabIndex: 0, side: "before" });
    expect(hitTestTabs(50, 3)).toEqual({ paneIndex: 0, tabIndex: 0, side: "before" });
  });

  it("bridges the gap between pills with horizontal slack", () => {
    mountStrip();
    // x=103 sits in the 100..110 gap; the 4px slack resolves it to tab0/after.
    expect(hitTestTabs(103, 18)).toEqual({ paneIndex: 0, tabIndex: 0, side: "after" });
    expect(hitTestTabs(107, 18)).toEqual({ paneIndex: 0, tabIndex: 1, side: "before" });
  });

  it("misses outside the strip or beyond the slack", () => {
    mountStrip();
    expect(hitTestTabs(50, 50)).toBeNull();
    expect(hitTestTabs(230, 18)).toBeNull();
  });
});
