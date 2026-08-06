// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
  EXPANDED_MIN,
  MEDIUM_MIN,
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
