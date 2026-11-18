import { saveRetryAfter } from "@plainva/ui";

/**
 * The desktop editor's retry of a failed save (decided 2026-11-17).
 *
 * The phone's saver tries a failed save again by itself; the desktop's status
 * said "Save failed!" until the next keystroke or Ctrl+S. Both shells now keep
 * to one rule (`saveRetry.ts` in @plainva/ui): one second, then twice as long
 * each time, at most 30 seconds, never after a failure that is surely final,
 * and after about five minutes of retries the timer rests: the status says why
 * the note is not saved, and the next try comes when the person types, saves
 * or comes back to the window (`resting`).
 *
 * One timer per editor pane. It never writes an older text after a newer one:
 * the retry reads the pane's text when it fires, a save that starts for any
 * other reason takes the planned retry's place, and once the pane shows
 * another note, or goes, the timer is gone and a late one does nothing.
 */
export type SaveRetryState = "idle" | "planned" | "resting";

export interface SaveRetryTimer {
  /**
   * A save failed. Plans the next try unless the failure is final or the
   * retries are used up; `still` says, when the timer fires, whether the pane
   * still holds that unsaved note. True when a try is planned.
   */
  failed(error: unknown, still: () => boolean, retry: () => void): boolean;
  /** A save starts, for whatever reason: a planned try is not needed any more. */
  starting(): void;
  /** The save went through, or the person acted (typed, Ctrl+S, came back): the next failure waits one second again. */
  reset(): void;
  /** The pane shows another note, or goes: nothing planned stays. */
  cancel(): void;
  /** True while a try is planned. */
  readonly planned: boolean;
  /** True once the retries were used up on a failure that is not final: the person's next step tries again. */
  readonly resting: boolean;
}

export function createSaveRetryTimer(onStateChange?: (state: SaveRetryState) => void): SaveRetryTimer {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let state: SaveRetryState = "idle";
  const become = (next: SaveRetryState) => {
    if (next === state) return;
    state = next;
    onStateChange?.(next);
  };
  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    failed(error, still, retry) {
      clear();
      attempts += 1;
      const delay = saveRetryAfter(error, attempts);
      if (delay === null) {
        // Final: no try comes by itself, nor with the window's return. Used up: rest.
        const final = saveRetryAfter(error, 1) === null;
        attempts = final ? 0 : attempts;
        become(final ? "idle" : "resting");
        return false;
      }
      timer = setTimeout(() => {
        timer = null;
        become("idle");
        if (still()) retry();
      }, delay);
      become("planned");
      return true;
    },
    starting() {
      clear();
      become("idle");
    },
    reset() {
      clear();
      attempts = 0;
      become("idle");
    },
    cancel() {
      clear();
      attempts = 0;
      become("idle");
    },
    get planned() {
      return state === "planned";
    },
    get resting() {
      return state === "resting";
    },
  };
}
