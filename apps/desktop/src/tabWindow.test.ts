import { describe, expect, it } from "vitest";
import { TAB_MIN_WIDTH, tabNeed, tabWindowOf } from "./components/tabStrip";

/**
 * Tabs are as wide as their names, shrink once the strip is full, then
 * overflow — never a scrollbar (E13, finding 2026-09-22; widths, finding
 * 2026-10-23).
 *
 * The strips used to scroll sideways: at eight tabs a scrollbar appeared under
 * them, which is a control nobody looks for in a tab strip and which put a tab
 * one drag away instead of one click.
 */
const uniform = (n: number, need = TAB_MIN_WIDTH) => Array.from({ length: n }, () => need);
const BUTTON = 44;

describe("the tab window", () => {
  /** Twelve tabs in a strip that has room for four and the overflow button. */
  const narrow = 4 * TAB_MIN_WIDTH + BUTTON;

  it("shows everything while everything fits", () => {
    expect(tabWindowOf(uniform(3), 0, 10 * TAB_MIN_WIDTH)).toEqual({ start: 0, count: 3, hidden: [] });
  });

  it("shows everything before the strip has been measured", () => {
    // A strip that starts by hiding tabs and then reveals them flickers on
    // every window open.
    expect(tabWindowOf(uniform(12), 0, 0)).toEqual({ start: 0, count: 12, hidden: [] });
  });

  it("keeps the front while the active tab is in the window", () => {
    const w = tabWindowOf(uniform(12), 2, narrow, BUTTON);
    expect(w.start).toBe(0);
    expect(w.count).toBe(4);
    expect(w.hidden).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("moves the least it can to keep the active tab visible", () => {
    const w = tabWindowOf(uniform(12), 9, narrow, BUTTON);
    expect(w.start).toBe(6);
    expect(w.count).toBe(4);
    // Everything else is one click away, in document order.
    expect(w.hidden).toEqual([0, 1, 2, 3, 4, 5, 10, 11]);
    expect(w.hidden).not.toContain(9);
  });

  it("never falls below one tab, however narrow the strip is", () => {
    const w = tabWindowOf(uniform(12), 11, 10, BUTTON);
    expect(w.count).toBe(1);
    expect(w.start).toBe(11);
    expect(w.hidden).toHaveLength(11);
    expect(tabWindowOf(uniform(12), 0, 10, BUTTON)).toEqual({ start: 0, count: 1, hidden: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] });
  });

  it("stops at the last tab instead of scrolling past it", () => {
    expect(tabWindowOf(uniform(6), 5, narrow, BUTTON).start).toBe(2);
  });

  it("holds more short tabs than the floor would: a short tab needs only its own width", () => {
    // Ten tabs of 80 px fit 800 px whole; at the floor they would need 1040.
    expect(tabWindowOf(uniform(10, 80), 0, 800, BUTTON).hidden).toEqual([]);
    // One pixel less and they overflow — into as many as the room holds.
    const w = tabWindowOf(uniform(10, 80), 0, 799, BUTTON);
    expect(w.count).toBe(Math.floor((799 - BUTTON) / 80));
  });

  it("weighs every tab by what it needs, so a window of mixed tabs is as full as it can be", () => {
    const needs = [60, TAB_MIN_WIDTH, 60, TAB_MIN_WIDTH, 60, TAB_MIN_WIDTH];
    // 60 + 104 + 60 = 224 fits a budget of 230; the fourth tab would not.
    expect(tabWindowOf(needs, 0, 230 + BUTTON, BUTTON)).toMatchObject({ start: 0, count: 3 });
    // The active last tab pulls the window to the end and reaches back as far as it fits.
    // (104 + 60 = 164; the 104 before them would make 268.)
    expect(tabWindowOf(needs, 5, 230 + BUTTON, BUTTON)).toMatchObject({ start: 4, count: 2 });
  });
});

describe("what a tab needs before it goes behind the button", () => {
  it("is its own width when that is below the floor, and the floor otherwise", () => {
    expect(tabNeed(70, 0)).toBe(70);
    expect(tabNeed(300, 0)).toBe(TAB_MIN_WIDTH);
  });

  it("is the floor for a tab that has never been on screen — it may be long", () => {
    expect(tabNeed(undefined, 0)).toBe(TAB_MIN_WIDTH);
  });

  it("adds what every tab costs beside its own box (a theme's margins, the strip's gap)", () => {
    expect(tabNeed(70, 7)).toBe(77);
    expect(tabNeed(undefined, 7)).toBe(TAB_MIN_WIDTH + 7);
  });
});
