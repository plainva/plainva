import { isSaveFailureFinal, saveRetryDelay } from "@plainva/ui";

/**
 * The desktop editor's retry of a failed save (decided 2026-11-17).
 *
 * The phone's saver tries a failed save again by itself; the desktop's status
 * said "Save failed!" until the next keystroke or Ctrl+S. Both shells now keep
 * to one rule (`saveRetry.ts` in @plainva/ui): one second, then twice as long
 * each time, at most 30 seconds, and never after a failure no retry can help.
 *
 * One timer per editor pane. It never writes an older text after a newer one:
 * the retry reads the pane's text when it fires, a save that starts for any
 * other reason takes the planned retry's place, and once the pane shows
 * another note, or goes, the timer is gone and a late one does nothing.
 */
export interface SaveRetryTimer {
  /**
   * A save failed. Plans the next try unless the failure is final; `still`
   * says, when the timer fires, whether the pane still holds that unsaved
   * note. True when a try is planned.
   */
  failed(error: unknown, still: () => boolean, retry: () => void): boolean;
  /** A save starts, for whatever reason: a planned try is not needed any more. */
  starting(): void;
  /** The save went through, or the person acted (typed, Ctrl+S): the next failure waits one second again. */
  reset(): void;
  /** The pane shows another note, or goes: nothing planned stays. */
  cancel(): void;
  /** True while a try is planned. */
  readonly planned: boolean;
}

export function createSaveRetryTimer(onPlannedChange?: (planned: boolean) => void): SaveRetryTimer {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    onPlannedChange?.(false);
  };
  return {
    failed(error, still, retry) {
      clear();
      if (isSaveFailureFinal(error)) {
        attempts = 0;
        return false;
      }
      attempts += 1;
      timer = setTimeout(() => {
        timer = null;
        onPlannedChange?.(false);
        if (still()) retry();
      }, saveRetryDelay(attempts));
      onPlannedChange?.(true);
      return true;
    },
    starting: clear,
    reset() {
      clear();
      attempts = 0;
    },
    cancel() {
      clear();
      attempts = 0;
    },
    get planned() {
      return timer !== null;
    },
  };
}
