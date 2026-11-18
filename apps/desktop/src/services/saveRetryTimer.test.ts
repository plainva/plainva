import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, VaultFileNotFoundError, VaultUnreachableError } from "@plainva/core";
import { KeepBesideFailedError } from "@plainva/ui";
import { SAVE_RETRY_LIMIT } from "@plainva/ui";
import { createSaveRetryTimer, type SaveRetryState } from "./saveRetryTimer";

/**
 * The desktop editor tries a failed save again by itself, by the rule the
 * phone keeps (decided 2026-11-17): one second, doubling, at most 30 seconds,
 * never after a failure that is surely final, and after about five minutes it
 * rests until the person types, saves or comes back to the window (review
 * 2026-11-17: on Windows a file another program holds says "Access is denied").
 */

const passing = () => new Error("The network path was not found. (os error 53)");

/** A pane: its text, whether it still shows the note, and the saves it ran. */
function pane(failFirst: number) {
  let text = "one";
  let shown = true;
  const writes: string[] = [];
  const timer = createSaveRetryTimer();
  const save = () => {
    timer.starting();
    writes.push(text);
    if (writes.length <= failFirst) timer.failed(passing(), () => shown, save);
    else timer.reset();
  };
  return {
    timer,
    writes,
    save,
    type(next: string) {
      text = next;
    },
    showAnother() {
      shown = false;
      timer.cancel();
    },
  };
}

describe("a failed save on the desktop", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is tried again after 1, 2 and 4 seconds, and stops once it went through", async () => {
    const p = pane(3);
    p.save();
    expect(p.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(p.writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(p.writes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(p.writes).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(p.writes).toHaveLength(4);
    expect(p.timer.planned).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(p.writes).toHaveLength(4);
  });

  it("writes the text the pane holds when the retry comes, never an older one", async () => {
    const p = pane(1);
    p.save();
    p.type("two");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(p.writes).toEqual(["one", "two"]);
  });

  it("waits at most 30 seconds between two tries", async () => {
    const p = pane(100);
    p.save();
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 8_000 + 16_000);
    expect(p.writes).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(p.writes).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(p.writes).toHaveLength(7);
  });

  it.each([
    ["a conflict", new ConflictError("conflict", "Note.CONFLICT.md")],
    ["a file that is gone", new VaultFileNotFoundError("Note.md")],
    ["a file that is no text", Object.assign(new Error("not text"), { code: "NOT_TEXT_FILE" })],
    ["no copy beside a file that is no text", new KeepBesideFailedError(new Error("not text"), new Error("disk full"))],
  ])("is not tried again after %s, nor when the window comes back", async (_what, error) => {
    const timer = createSaveRetryTimer();
    const retry = vi.fn();
    expect(timer.failed(error, () => true, retry)).toBe(false);
    expect(timer.resting).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(retry).not.toHaveBeenCalled();
  });

  it.each([
    ["a file another program holds (Windows)", new Error("Access is denied. (os error 5)")],
    ["no right to write", new Error("Permission denied (os error 13)")],
    ["a read-only drive", new Error("Read-only file system (os error 30)")],
    ["a vault folder that cannot be reached", new VaultUnreachableError("Note.md")],
  ])("is tried again after %s", async (_what, error) => {
    const timer = createSaveRetryTimer();
    const retry = vi.fn();
    expect(timer.failed(error, () => true, retry)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("rests after about five minutes of retries, and the person's next step starts at one second again", async () => {
    const said: SaveRetryState[] = [];
    const timer = createSaveRetryTimer((state) => said.push(state));
    let writes = 0;
    const save = () => {
      timer.starting();
      writes += 1;
      timer.failed(new Error("Access is denied. (os error 5)"), () => true, save);
    };
    save();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(writes).toBe(SAVE_RETRY_LIMIT + 1);
    expect(timer.resting).toBe(true);
    expect(timer.planned).toBe(false);
    expect(said[said.length - 1]).toBe("resting");
    const states = said.length;
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(writes).toBe(SAVE_RETRY_LIMIT + 1);
    expect(said).toHaveLength(states);
    // A save that starts meanwhile (a keystroke's) is no resting one: the window's return then does nothing.
    timer.starting();
    expect(timer.resting).toBe(false);
    save();
    await vi.advanceTimersByTimeAsync(0);
    expect(timer.resting).toBe(true);
    // Back at the window (or a keystroke, or Ctrl+S): reset, then one save.
    timer.reset();
    expect(timer.resting).toBe(false);
    save();
    expect(writes).toBe(SAVE_RETRY_LIMIT + 3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writes).toBe(SAVE_RETRY_LIMIT + 4);
  });

  it("is not tried again once the pane shows another note or closed", async () => {
    const p = pane(1);
    p.save();
    p.showAnother();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(p.writes).toHaveLength(1);
  });

  it("does not try again behind a save that started meanwhile, and a keystroke starts at one second again", async () => {
    const p = pane(4);
    p.save();
    await vi.advanceTimersByTimeAsync(1_000 + 2_000);
    expect(p.writes).toHaveLength(3);
    // The person presses Ctrl+S (or the way out tries once): that save takes the planned one's place.
    p.timer.reset();
    p.save();
    expect(p.writes).toHaveLength(4);
    // It failed too: the next try comes after one second, not eight.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(p.writes).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(p.writes).toHaveLength(5);
  });

  it("says when a try is planned, for the status line", async () => {
    const said: SaveRetryState[] = [];
    const timer = createSaveRetryTimer((state) => said.push(state));
    timer.failed(passing(), () => true, () => {});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(said).toEqual(["planned", "idle"]);
  });
});
