// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  DOCK_MIN,
  EXPANDED_MIN,
  MEDIUM_MIN,
  getCanDock,
  getWindowClass,
  setWindowClassForTest,
  subscribeWindowClass,
  windowClassFor,
} from "./windowClass";

describe("window classes", () => {
  beforeEach(() => {
    setWindowClassForTest(360);
  });

  it("uses Material's breakpoints", () => {
    // The exact edges matter: one pixel either way is a different layout, and
    // 600/840 are the numbers every M3 surface is designed against.
    expect(MEDIUM_MIN).toBe(600);
    expect(EXPANDED_MIN).toBe(840);
    expect(windowClassFor(320)).toBe("compact");
    expect(windowClassFor(599)).toBe("compact");
    expect(windowClassFor(600)).toBe("medium");
    expect(windowClassFor(839)).toBe("medium");
    expect(windowClassFor(840)).toBe("expanded");
    expect(windowClassFor(1440)).toBe("expanded");
  });

  it("publishes the class on the document root", () => {
    setWindowClassForTest(900);
    expect(document.documentElement.getAttribute("data-window")).toBe("expanded");
    setWindowClassForTest(700);
    expect(document.documentElement.getAttribute("data-window")).toBe("medium");
  });

  it("notifies subscribers only when the class actually changes", () => {
    let calls = 0;
    const stop = subscribeWindowClass(() => {
      calls += 1;
    });
    setWindowClassForTest(700);
    expect(calls).toBe(1);
    // Still medium — a resize inside one class must not re-render the shell.
    setWindowClassForTest(800);
    expect(calls).toBe(1);
    setWindowClassForTest(1000);
    expect(calls).toBe(2);
    expect(getWindowClass()).toBe("expanded");
    stop();
  });
});

/**
 * A rotated phone is not a tablet (N1.4).
 *
 * On width alone a modern phone in landscape reaches "expanded" — 844x390,
 * 926x428, 932x430 are all past the 840 breakpoint — and would get the
 * navigator permanently beside the working surface: two columns in about
 * 400 px of height (Gesamtplan § 3.7).
 */
describe("the shorter edge decides whether two columns are possible", () => {
  const PHONES_LANDSCAPE: Array<[string, number, number]> = [
    ["iPhone 14 Pro", 852, 393],
    ["iPhone 14 Pro Max", 932, 430],
    ["Pixel 8 Pro", 892, 412],
  ];

  for (const [name, w, h] of PHONES_LANDSCAPE) {
    it(`keeps ${name} in landscape out of the tablet layout`, () => {
      expect(windowClassFor(w, h)).toBe("medium");
      // Without the height it WOULD be the tablet layout — that is the bug.
      expect(windowClassFor(w)).toBe("expanded");
    });
  }

  it("still gives a real tablet its two columns", () => {
    expect(windowClassFor(1024, 768)).toBe("expanded"); // iPad landscape
    expect(windowClassFor(1180, 820)).toBe("expanded");
  });

  it("leaves portrait phones and the rail class alone", () => {
    expect(windowClassFor(393, 852)).toBe("compact");
    expect(windowClassFor(768, 1024)).toBe("medium"); // iPad portrait
  });

  it("treats an unknown height as no constraint", () => {
    // A caller that only knows a width is saying the height does not
    // constrain, not that it is zero.
    expect(windowClassFor(1024)).toBe("expanded");
  });
});

/**
 * The third column needs its own, wider number (finding 2026-08-21).
 *
 * "expanded" says two surfaces fit. At 840 px the rail, a navigator of at
 * least 280 and a context column of at least 300 already claim 668 px — the
 * maintainer's tablet showed three squeezed columns and a page that scrolled
 * sideways. So docking asks a second question, and the answer is a boolean
 * because it drives a store: a pixel count changes every resize frame.
 */
describe("a third column needs more than the expanded class", () => {
  beforeEach(() => {
    setWindowClassForTest(360);
  });

  it("opens at 1024, not at 840", () => {
    expect(DOCK_MIN).toBe(1024);
    setWindowClassForTest(840, 1200);
    expect(getWindowClass()).toBe("expanded");
    expect(getCanDock()).toBe(false);
    setWindowClassForTest(1023, 1200);
    expect(getCanDock()).toBe(false);
    setWindowClassForTest(1024, 768);
    expect(getCanDock()).toBe(true);
  });

  it("stays shut on a phone in landscape, wide as it is", () => {
    // 1024x430 clears the width and fails the class — the rotated phone must
    // not acquire a column the tablet check already denied it.
    setWindowClassForTest(1024, 430);
    expect(getWindowClass()).toBe("medium");
    expect(getCanDock()).toBe(false);
  });

  it("notifies subscribers when only the dock answer changes", () => {
    setWindowClassForTest(900, 1200);
    let calls = 0;
    const stop = subscribeWindowClass(() => {
      calls += 1;
    });
    // Same class either side of the boundary; the third column appears anyway,
    // so a subscriber that only watched the class would keep the sheet.
    setWindowClassForTest(1100, 1200);
    expect(calls).toBe(1);
    expect(getCanDock()).toBe(true);
    setWindowClassForTest(1200, 1200);
    expect(calls).toBe(1);
    stop();
  });
});
