import { toast, toastStore } from "@plainva/ui";
import { foreignInputArmed, onLeaveGuardChange } from "./leaveGuard";
import { leaveThen } from "./leaveQuestion";

/**
 * A step the PROGRAM takes that changes what is on screen — not the person,
 * and not the surface on top (finding 2026-10-22, § 3.139 Nr. 1 and 2).
 *
 * Only the screen on top is rendered. A connect run that puts its next screen
 * over it, or a vault reload that drops every stack once a key has been
 * derived, takes whatever is typed there in the same moment. Both happen
 * after a wait — a sign-in coming back, a key derivation, the network —, and
 * in that wait the person may have opened a message and begun to write.
 * Asking a question out of nowhere would be wrong there; the person did not
 * start anything at that moment.
 *
 * So such a step comes here. With nothing of anyone else's at stake it runs at
 * once, as it always did. While a surface holds unsaved input that is not the
 * step's own (`own`: the guards of the forms the step belongs to), the step
 * waits: a notice says what waits, and its button asks the surface's own
 * question first (`leaveThen`) — "Cancel" keeps the input and the notice.
 * A step marked `whenFree` also runs by itself as soon as nothing foreign is
 * at stake any more (the message sent or discarded): it finishes work the
 * person has already started, like a vault reload after an unlock.
 *
 * A step under the same `key` that comes by again while one waits replaces
 * it and raises nothing new: a notice closed by hand means "not now", and a
 * run that comes by on every sign of life must not nag. It runs once nothing
 * foreign is at stake when it next comes by.
 *
 * The vault switch of a flow has its own, stricter rule (`flowVault.ts`): a
 * vault once offered is the person's to open.
 */

export interface ScreenStep {
  /** What the step does to the screen. */
  run: () => void | Promise<void>;
  /** The notice while it waits. */
  offer: string;
  /** Its button. */
  label: string;
  /** Guards of the surfaces this step belongs to: their input is not at stake. */
  own?: string | readonly string[];
  /** Runs by itself once nothing foreign is at stake any more. */
  whenFree?: boolean;
}

interface Waiting {
  step: ScreenStep;
  notice: number | null;
  unsubscribe: (() => void) | null;
}

const waiting = new Map<string, Waiting>();

const standing = (w: Waiting) => w.notice !== null && toastStore.get().some((item) => item.id === w.notice);

function drop(key: string, w: Waiting): void {
  if (waiting.get(key) === w) waiting.delete(key);
  w.unsubscribe?.();
  w.unsubscribe = null;
  if (w.notice !== null) toast.dismiss(w.notice);
  w.notice = null;
}

/** Runs a step in this very tick, as the program always did; a failure is reported, not thrown at the caller. */
function start(key: string, step: ScreenStep): void {
  try {
    void Promise.resolve(step.run()).catch((error: unknown) => console.error("[screenStep]", key, error));
  } catch (error) {
    console.error("[screenStep]", key, error);
  }
}

function go(key: string, w: Waiting): void {
  drop(key, w);
  start(key, w.step);
}

function raise(key: string, w: Waiting): void {
  w.notice = toast.progress(w.step.offer, {
    label: w.step.label,
    run: () => {
      // The button went with the tap; the question decides whether the step goes.
      w.notice = null;
      leaveThen(
        () => {
          if (waiting.get(key) === w) go(key, w);
        },
        () => {
          if (waiting.get(key) === w) raise(key, w);
        },
      );
    },
  });
}

/**
 * Runs `step` now, or — while someone else's input is on screen — lets it
 * wait behind a notice. True: it ran (or was started) now.
 */
export function takeScreen(key: string, step: ScreenStep): boolean {
  const before = waiting.get(key);
  if (!foreignInputArmed(step.own)) {
    if (before) drop(key, before);
    start(key, step);
    return true;
  }
  if (before) {
    // The same step again: the latest one is the one that goes, under the notice already raised (or closed).
    before.step = step;
    return false;
  }
  const w: Waiting = { step, notice: null, unsubscribe: null };
  waiting.set(key, w);
  if (step.whenFree) {
    w.unsubscribe = onLeaveGuardChange(() => {
      if (waiting.get(key) === w && !foreignInputArmed(w.step.own)) go(key, w);
    });
  }
  raise(key, w);
  return false;
}

/** Whether a step waits under `key`, and whether its notice still stands. */
export function screenStepWaits(key: string): { waits: boolean; offered: boolean } {
  const w = waiting.get(key);
  return { waits: !!w, offered: !!w && standing(w) };
}

/** A step that is no longer wanted takes its notice down. */
export function releaseScreenStep(key: string): void {
  const w = waiting.get(key);
  if (w) drop(key, w);
}

/** Test seam — the app never forgets a waiting step. */
export function resetScreenStepsForTest(): void {
  for (const [key, w] of [...waiting]) drop(key, w);
}
