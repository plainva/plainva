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
