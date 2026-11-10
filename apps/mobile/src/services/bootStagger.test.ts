// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterFirstPaint, BOOT_STEP_GAP_MS, FIRST_PAINT_DEADLINE_MS, staggerAfterFirstPaint } from "./bootStagger";

/**
 * The services of an open vault start after its first picture, a gap apart,
 * and at once when the person touches the app (performance plan L4, B10).
 */

/** Frames are painted only when the test says so. */
let frames: Array<() => void> = [];
const paintFrame = () => {
  const due = frames;
  frames = [];
  for (const frame of due) frame();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => { frames = []; });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("starting the vault's services one after the other", () => {
  it("waits for a painted frame, then starts a step per gap", () => {
    const started: string[] = [];
    staggerAfterFirstPaint([() => started.push("sync"), () => started.push("calendar"), () => started.push("cards")]);
    expect(started).toEqual([]);
    paintFrame();
    vi.advanceTimersByTime(0);
    expect(started).toEqual([]);
    vi.advanceTimersByTime(BOOT_STEP_GAP_MS);
    expect(started).toEqual(["sync"]);
    vi.advanceTimersByTime(BOOT_STEP_GAP_MS);
    expect(started).toEqual(["sync", "calendar"]);
    vi.advanceTimersByTime(BOOT_STEP_GAP_MS);
    expect(started).toEqual(["sync", "calendar", "cards"]);
  });

  it("starts without a painted frame after the deadline (a web view in the background)", () => {
    const done = vi.fn();
    afterFirstPaint(done);
    vi.advanceTimersByTime(FIRST_PAINT_DEADLINE_MS - 1);
    expect(done).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
    paintFrame();
    vi.advanceTimersByTime(10);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("starts everything that is left at the first touch", () => {
    const started: string[] = [];
    staggerAfterFirstPaint([() => started.push("sync"), () => started.push("calendar"), () => started.push("mail")]);
    window.dispatchEvent(new Event("pointerdown"));
    expect(started).toEqual(["sync", "calendar", "mail"]);
    vi.advanceTimersByTime(FIRST_PAINT_DEADLINE_MS + 5 * BOOT_STEP_GAP_MS);
    expect(started).toEqual(["sync", "calendar", "mail"]);
  });

  it("starts nothing more once cancelled (a vault switch)", () => {
    const started: string[] = [];
    const stagger = staggerAfterFirstPaint([() => started.push("sync"), () => started.push("calendar")]);
    paintFrame();
    vi.advanceTimersByTime(BOOT_STEP_GAP_MS);
    expect(started).toEqual(["sync"]);
    stagger.cancel();
    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(5 * BOOT_STEP_GAP_MS);
    expect(started).toEqual(["sync"]);
  });

  it("a step that fails does not keep the next from starting", () => {
    const started: string[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stagger = staggerAfterFirstPaint([() => { throw new Error("no network"); }, () => started.push("calendar")]);
    stagger.now();
    expect(started).toEqual(["calendar"]);
  });
});
