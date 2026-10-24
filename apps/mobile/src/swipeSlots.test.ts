import { describe, expect, it, vi } from "vitest";

vi.mock("./services/haptics", () => ({ haptics: { light: () => undefined } }));

const { MAX_SWIPE_SLOTS, swipeSlots } = await import("./components/SwipeRow");

const action = (label: string, danger = false) => ({ icon: null, label, danger, onClick: () => undefined });

/**
 * A swipe strip never buries its row (TestFlight, build 139, 24.10.).
 *
 * The task list handed six actions to a row: 396 px of strip, wider than the
 * row on a phone, so the row slid off the screen and there was nothing left to
 * tap or swipe back. Three slots leave the row readable; the rest of what a row
 * can do is in its sheet.
 */
describe("the swipe strip", () => {
  it("keeps three slots", () => {
    expect(MAX_SWIPE_SLOTS).toBe(3);
  });

  it("passes a short list through unchanged", () => {
    const list = [action("a"), action("b"), action("c", true)];
    expect(swipeSlots(list)).toBe(list);
  });

  it("cuts a long list to three, in order", () => {
    const list = ["a", "b", "c", "d", "e", "f"].map((l) => action(l));
    expect(swipeSlots(list).map((a) => a.label)).toEqual(["a", "b", "c"]);
  });

  it("keeps the destructive action, last", () => {
    const list = [action("a"), action("b"), action("c"), action("d"), action("delete", true)];
    expect(swipeSlots(list).map((a) => a.label)).toEqual(["a", "b", "delete"]);
  });
});
