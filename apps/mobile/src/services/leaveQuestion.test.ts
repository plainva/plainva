import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeLeaveGuard, armLeaveGuard, disarmLeaveGuard, resetLeaveGuard } from "./leaveGuard";
import { askBeforeLeaving, leaveThen } from "./leaveQuestion";
import { currentMobileDialog, dismissMobileDialog } from "./mobileDialogs";

/**
 * A step the shell starts over the surface on top (finding 2026-10-09).
 *
 * Only the screen on top is rendered, so a screen pushed over a message being
 * written takes the message with it. The bar tap, the back arrow and Android
 * back asked first; the share inbox's "Choose vault", the settings in a
 * tablet's rail, a notice's button and the rest did not. `leaveThen` is what
 * they go through now: the question an armed guard holds comes first, and with
 * nothing armed the step is exactly what it was.
 */
describe("a step that takes the surface on top off the screen", () => {
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const GUARD = { id: "mail-compose", message: "The draft will not be saved." };
  /** The question on screen, or a failed test. */
  const asked = () => {
    const dialog = currentMobileDialog();
    expect(dialog?.kind, "the leave question is on screen").toBe("confirm");
    if (dialog?.kind !== "confirm") throw new Error("no question");
    return dialog;
  };
  /** Answers it the way the dialog host does: the promise first, then off the screen. */
  const answer = (discard: boolean) => {
    const dialog = asked();
    dialog.resolve(discard);
    dismissMobileDialog(dialog);
  };

  beforeEach(() => {
    resetLeaveGuard();
  });

  afterEach(() => {
    const open = currentMobileDialog();
    if (open) dismissMobileDialog(open);
    resetLeaveGuard();
  });

  it("runs in the same tick when nothing is at stake", () => {
    const step = vi.fn();
    leaveThen(step);
    // Not a tick later: a tap that opens a screen must not start to lag.
    expect(step).toHaveBeenCalledTimes(1);
    expect(currentMobileDialog()).toBeNull();
  });

  it("asks an armed guard first, with the surface's own sentence, and does nothing on Cancel", async () => {
    armLeaveGuard(GUARD);
    const step = vi.fn();
    leaveThen(step);
    await settle();
    const question = asked();
    expect(question.message).toBe(GUARD.message);
    expect(question.danger).toBe(true);
    expect(step, "nothing moves while the question stands").not.toHaveBeenCalled();

    answer(false);
    await settle();
    expect(step).not.toHaveBeenCalled();
    expect(activeLeaveGuard(), "the work is still there, and still guarded").toEqual(GUARD);
  });

  it("runs on Discard, and leaves the guard to the surface, which disarms it when it really goes", async () => {
    armLeaveGuard(GUARD);
    const step = vi.fn();
    leaveThen(step);
    await settle();
    answer(true);
    await settle();
    expect(step).toHaveBeenCalledTimes(1);
    expect(currentMobileDialog()).toBeNull();
    // The step put another screen on top: the surface unmounts and lets go.
    disarmLeaveGuard(GUARD.id);
    expect(activeLeaveGuard()).toBeNull();
  });

  it("keeps the work guarded when the step does not leave after all", async () => {
    // "New database" asks for a name next, a new note for its template's
    // answers — and both can be cancelled. The composer is still on screen
    // then, with the message in it. Disarmed by the "Discard" that only agreed
    // to the step, it would let the next back arrow take the message unasked.
    armLeaveGuard(GUARD);
    const cancelledAfterTheQuestion = vi.fn();
    leaveThen(cancelledAfterTheQuestion);
    await settle();
    answer(true);
    await settle();
    expect(cancelledAfterTheQuestion).toHaveBeenCalledTimes(1);
    expect(activeLeaveGuard(), "still on screen, still guarded").toEqual(GUARD);

    // The back arrow, afterwards: it asks.
    let left: boolean | null = null;
    void askBeforeLeaving().then((ok) => {
      left = ok;
    });
    await settle();
    asked();
    answer(false);
    await settle();
    expect(left).toBe(false);
  });

  it("asks again the next time, after a Cancel", async () => {
    armLeaveGuard(GUARD);
    const step = vi.fn();
    leaveThen(step);
    await settle();
    answer(false);
    await settle();

    leaveThen(step);
    await settle();
    answer(true);
    await settle();
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("leaves the way back as it was: a confirmed leave there is the end of the question", async () => {
    // The back arrow, the bar and Android back always leave once the answer is
    // yes, and must not ask a second time on the way out.
    armLeaveGuard(GUARD);
    const leaving = askBeforeLeaving();
    await settle();
    answer(true);
    expect(await leaving).toBe(true);
    expect(activeLeaveGuard()).toBeNull();
  });
});
