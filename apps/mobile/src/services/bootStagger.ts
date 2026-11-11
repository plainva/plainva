/**
 * The services an open vault runs, started one after the other once the vault
 * is on screen (performance plan L4, finding B10).
 *
 * The sync worker, the calendars, the mailboxes' repair, the reconciling of
 * the account cards and the index's pass over the vault all began in the same
 * instant, before the vault's first picture, on the phone's one database
 * connection: what the first screen asked of the database queued behind all of
 * them. Now they wait for the first picture and then start a short gap apart.
 *
 * Nothing waits longer than the person: the first touch, key or tap starts
 * whatever has not started yet (opening Mail or the calendar does not wait for
 * a gap). A web view in the background paints no frames, so a fixed deadline
 * starts the first step all the same.
 */

/** The gap between two steps. */
export const BOOT_STEP_GAP_MS = 200;
/** The longest the first step waits for a painted frame. */
export const FIRST_PAINT_DEADLINE_MS = 500;

const INPUT_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

export interface BootStagger {
  /** Starts every step that has not started yet, now. */
  now(): void;
  /** Starts nothing more (a vault switch, the shell going away). */
  cancel(): void;
}

/** Calls `fn` once the next frame has been painted, or after `deadlineMs` at the latest. */
export function afterFirstPaint(fn: () => void, deadlineMs = FIRST_PAINT_DEADLINE_MS): () => void {
  let done = false;
  let frame: number | undefined;
  let after: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    if (done) return;
    done = true;
    clearTimeout(deadline);
    clearTimeout(after);
    if (frame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    fn();
  };
  const deadline = setTimeout(fire, deadlineMs);
  // A frame callback runs before its frame is painted; the task after it runs
  // once the picture is up.
  if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(() => { after = setTimeout(fire, 0); });
  return () => {
    done = true;
    clearTimeout(deadline);
    clearTimeout(after);
    if (frame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
  };
}

/**
 * Runs `steps` in order: the first `gapMs` after the first painted frame, each
 * next one `gapMs` later, all that are left at the first input or on `now()`.
 * A step that throws does not keep the others from starting.
 */
export function staggerAfterFirstPaint(steps: ReadonlyArray<() => void>, gapMs = BOOT_STEP_GAP_MS): BootStagger {
  let next = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelPaint: (() => void) | null = null;
  const target = typeof window !== "undefined" ? window : null;

  const stopListening = () => {
    for (const name of INPUT_EVENTS) target?.removeEventListener(name, onInput, true);
  };
  const runOne = () => {
    const step = steps[next++];
    try {
      step();
    } catch (error) {
      console.error("[boot] a background service did not start", error);
    }
  };
  const finishIfDone = () => {
    if (next < steps.length) return false;
    stopListening();
    return true;
  };
  const tick = () => {
    timer = undefined;
    if (cancelled) return;
    runOne();
    if (!finishIfDone()) timer = setTimeout(tick, gapMs);
  };
  const now = () => {
    if (cancelled) return;
    cancelPaint?.();
    cancelPaint = null;
    clearTimeout(timer);
    timer = undefined;
    while (next < steps.length) runOne();
    finishIfDone();
  };
  function onInput() {
    now();
  }

  if (steps.length === 0) return { now: () => {}, cancel: () => {} };
  for (const name of INPUT_EVENTS) target?.addEventListener(name, onInput, true);
  // The index's pass over the vault starts with the first picture
  // (vaultService); the first step comes a gap after it.
  cancelPaint = afterFirstPaint(() => {
    cancelPaint = null;
    if (!cancelled) timer = setTimeout(tick, gapMs);
  });
  return {
    now,
    cancel() {
      cancelled = true;
      cancelPaint?.();
      clearTimeout(timer);
      stopListening();
    },
  };
}
