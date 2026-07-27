// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDragAutoScroll } from "@plainva/ui";

/**
 * Auto-scroll while dragging (plan § 9.3). Pointer capture keeps the surface
 * under the finger from scrolling on its own, so without this a drag from the
 * bottom of a long list to the top is not one gesture — it stops at the edge.
 */

let box: HTMLDivElement;
let row: HTMLDivElement;
let frame: FrameRequestCallback | null;

beforeEach(() => {
  box = document.createElement("div");
  box.style.overflowY = "auto";
  // jsdom has no layout: fake the two numbers scrollParent() reads and the
  // rectangle the edge zone is measured against.
  Object.defineProperty(box, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(box, "clientHeight", { value: 200, configurable: true });
  box.getBoundingClientRect = () => ({ top: 100, bottom: 300, left: 0, right: 100, width: 100, height: 200, x: 0, y: 100, toJSON: () => ({}) });
  row = document.createElement("div");
  box.appendChild(row);
  document.body.appendChild(box);

  frame = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { frame = null; });
});

afterEach(() => {
  box.remove();
  vi.unstubAllGlobals();
});

/** Run the pending frame once (the loop re-arms itself). */
function step() {
  const cb = frame;
  frame = null;
  cb?.(0);
}

describe("createDragAutoScroll", () => {
  it("does nothing while the pointer stays away from the edges", () => {
    const s = createDragAutoScroll(() => row);
    s.update(200); // dead centre of a 100..300 box
    expect(frame).toBeNull();
    expect(box.scrollTop).toBe(0);
  });

  it("scrolls up near the top edge and down near the bottom edge", () => {
    const s = createDragAutoScroll(() => row);
    box.scrollTop = 400;

    s.update(110); // 10px below the top → inside the 56px zone
    step();
    expect(box.scrollTop).toBeLessThan(400);

    const afterUp = box.scrollTop;
    s.update(295); // 5px above the bottom
    step();
    expect(box.scrollTop).toBeGreaterThan(afterUp);
  });

  it("eases in: the very edge scrolls faster than the zone's rim", () => {
    // A constant step would make a precise drop near the boundary impossible.
    const inner = createDragAutoScroll(() => row);
    box.scrollTop = 500;
    inner.update(299);
    step();
    const fast = box.scrollTop - 500;

    box.scrollTop = 500;
    const outer = createDragAutoScroll(() => row);
    outer.update(250); // just inside the bottom zone (300-56 = 244)
    step();
    const slow = box.scrollTop - 500;

    expect(fast).toBeGreaterThan(slow);
    inner.stop();
    outer.stop();
  });

  it("stops when the drag ends, and never keeps a frame pending", () => {
    const s = createDragAutoScroll(() => row);
    s.update(105);
    expect(frame).not.toBeNull();
    s.stop();
    expect(frame).toBeNull();
  });

  it("stops on its own when the pointer moves back into the middle", () => {
    const s = createDragAutoScroll(() => row);
    s.update(105);
    expect(frame).not.toBeNull();
    s.update(200);
    expect(frame).toBeNull();
  });

  it("falls back to the window when nothing around the row scrolls", () => {
    const loose = document.createElement("div");
    document.body.appendChild(loose);
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });

    const s = createDragAutoScroll(() => loose);
    s.update(590); // near the viewport's bottom edge
    step();
    expect(scrollBy).toHaveBeenCalled();
    s.stop();
    loose.remove();
  });
});
