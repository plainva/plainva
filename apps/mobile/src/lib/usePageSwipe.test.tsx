// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePageSwipe } from "./usePageSwipe";

vi.mock("../services/haptics", () => ({ haptics: { light: () => {} } }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The page swipe's END (finding 2026-09-19: "the calendar only ever swipes
 * forward, whatever the gesture").
 *
 * The hook ended a cancelled drag like a released one and read the distance
 * from the end event — and a `pointercancel` carries zero coordinates, so the
 * distance came out as "minus the start": forward, and past the quarter. The
 * touch test in `e2e-prod/swipe-gesture.spec.ts` shows the WebView no longer
 * cancels a drag in the time grid; THIS file pins the other half, which no
 * browser run can force: whatever an end event claims, the direction is the
 * finger's, and a cancel never pages.
 */

let container: HTMLDivElement;
let root: Root;
let commits: Array<-1 | 1>;

function Surface() {
  const [state, handlers] = usePageSwipe((dir) => commits.push(dir));
  return <div data-testid="pager" data-offset={state.offset} {...handlers} />;
}

/** Where the page stands, as the surface would translate it. */
const offset = () => Number(container.querySelector('[data-testid="pager"]')!.getAttribute("data-offset"));

/** `t` pins the event's timestamp where the SPEED of a drag is what is under test. */
function fire(type: string, x: number, y = 100, t?: number) {
  const el = container.querySelector('[data-testid="pager"]')!;
  const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  Object.defineProperty(ev, "pointerType", { value: "touch" });
  if (t !== undefined) Object.defineProperty(ev, "timeStamp", { value: t });
  act(() => {
    el.dispatchEvent(ev);
  });
}

/** Down at `from`, moves in steps to `to` — far enough to lock the axis and pass the quarter. */
function drag(from: number, to: number) {
  fire("pointerdown", from);
  const steps = 6;
  for (let i = 1; i <= steps; i++) fire("pointermove", from + ((to - from) * i) / steps);
}

beforeEach(() => {
  commits = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  // No settle animation: the commit is then synchronous, and the rule under
  // test is the decision, not the slide.
  window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query })) as unknown as typeof window.matchMedia;
  HTMLElement.prototype.setPointerCapture = () => {};
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  act(() => root.render(<Surface />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("usePageSwipe — the end of a drag", () => {
  it("a release after a drag to the RIGHT pages back", () => {
    drag(100, 300);
    fire("pointerup", 300);
    expect(commits).toEqual([-1]);
  });

  it("a release after a drag to the LEFT pages forward", () => {
    drag(300, 100);
    fire("pointerup", 100);
    expect(commits).toEqual([1]);
  });

  it("a cancel never pages — whatever coordinates it carries — and the page springs back", () => {
    drag(100, 300);
    expect(offset()).toBe(200);
    // What a WebView sends when it claims the gesture: zero coordinates. The
    // old end read them and computed -100: forward, and past the quarter.
    fire("pointercancel", 0, 0);
    expect(commits).toEqual([]);
    expect(offset()).toBe(0);
  });

  it("the direction is the finger's, not the end event's", () => {
    drag(100, 300);
    fire("pointerup", 0, 0);
    expect(commits).toEqual([-1]);
  });

  it("a short drag springs back without paging", () => {
    // Slow and short: 40 px of 400 in 1.2 s — below the quarter, below the flick.
    // The clock starts at 1000, not 0: React reads a zero timestamp as "none"
    // and substitutes the wall clock.
    fire("pointerdown", 200, 100, 1000);
    fire("pointermove", 215, 100, 1400);
    fire("pointermove", 230, 100, 1800);
    fire("pointermove", 240, 100, 2200);
    fire("pointerup", 240, 100, 2210);
    expect(commits).toEqual([]);
    expect(offset()).toBe(0);
  });

  it("a vertical drag belongs to the scroller", () => {
    fire("pointerdown", 200, 100);
    fire("pointermove", 203, 140);
    fire("pointermove", 205, 220);
    fire("pointerup", 205, 220);
    expect(commits).toEqual([]);
    expect(offset()).toBe(0);
  });
});
