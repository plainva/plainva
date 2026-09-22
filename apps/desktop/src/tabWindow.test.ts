import { describe, expect, it } from "vitest";
import { TAB_MIN_WIDTH, tabWindowOf } from "./components/tabStrip";

/**
 * Tabs shrink, then overflow — never a scrollbar (E13, finding 2026-09-22).
 *
 * The strips used to scroll sideways: at eight tabs a scrollbar appeared under
 * them, which is a control nobody looks for in a tab strip and which put a tab
 * one drag away instead of one click.
 */
describe("the tab window", () => {
  /** Twelve tabs in a strip that has room for four and the overflow button. */
  const narrow = 4 * TAB_MIN_WIDTH + 44;

  it("shows everything while everything fits", () => {
    expect(tabWindowOf(3, 0, 10 * TAB_MIN_WIDTH)).toEqual({ start: 0, count: 3, hidden: [] });
  });

  it("shows everything before the strip has been measured", () => {
    // A strip that starts by hiding tabs and then reveals them flickers on
    // every window open.
    expect(tabWindowOf(12, 0, 0)).toEqual({ start: 0, count: 12, hidden: [] });
  });

  it("keeps the front while the active tab is in the window", () => {
    const w = tabWindowOf(12, 2, narrow);
    expect(w.start).toBe(0);
    expect(w.count).toBe(4);
    expect(w.hidden).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("moves the least it can to keep the active tab visible", () => {
    const w = tabWindowOf(12, 9, narrow);
    expect(w.start).toBe(6);
    expect(w.count).toBe(4);
    // Everything else is one click away, in document order.
    expect(w.hidden).toEqual([0, 1, 2, 3, 4, 5, 10, 11]);
    expect(w.hidden).not.toContain(9);
  });

  it("never falls below one tab, however narrow the strip is", () => {
    const w = tabWindowOf(12, 11, 10);
    expect(w.count).toBe(1);
    expect(w.start).toBe(11);
    expect(w.hidden).toHaveLength(11);
  });

  it("stops at the last tab instead of scrolling past it", () => {
    expect(tabWindowOf(6, 5, narrow).start).toBe(2);
  });
});
