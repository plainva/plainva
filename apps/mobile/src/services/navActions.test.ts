import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initialNavState, navTop, pushEntry, type NavState } from "../navigation";
import { armLeaveGuard, resetLeaveGuard } from "./leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "./mobileDialogs";
import { createNavActions } from "./navActions";

/**
 * The two ways OUT of a screen (finding 2026-10-09).
 *
 * `pop` is the reader wanting out, and it asks an armed guard first. `done` is
 * the screen ending itself after its work was sent or saved, and it must not
 * ask: the mail composer left through `pop` after a send, and the shell asked
 * whether to discard a message that was already on its way.
 */
describe("leaving a screen", () => {
  let nav: NavState;
  let bumps: number;
  const actions = () =>
    createNavActions(
      (next) => void (nav = typeof next === "function" ? next(nav) : next),
      (next) => void (bumps = typeof next === "function" ? next(bumps) : next),
    );
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    resetLeaveGuard();
    bumps = 0;
    nav = pushEntry(pushEntry(initialNavState("mail"), { kind: "mail", path: "" }), { kind: "mailcompose", path: "{}" });
  });

  afterEach(() => {
    const open = currentMobileDialog();
    if (open) dismissMobileDialog(open);
  });

  it("pop moves at once when nothing is at stake", async () => {
    actions().pop();
    await settle();
    expect(currentMobileDialog()).toBeNull();
    expect(navTop(nav)?.kind).toBe("mail");
    expect(bumps).toBe(1);
  });

  it("pop asks an armed guard, and stays when the answer is no", async () => {
    armLeaveGuard({ id: "mail-compose", message: "The draft will not be saved." });
    actions().pop();
    await settle();
    const asked = currentMobileDialog();
    expect(asked?.kind).toBe("confirm");
    expect(navTop(nav)?.kind).toBe("mailcompose");
    if (asked?.kind === "confirm") asked.resolve(false);
    await settle();
    expect(navTop(nav)?.kind).toBe("mailcompose");
    expect(bumps).toBe(0);
  });

  it("done leaves without the question, guard or not, and the screen below re-reads", async () => {
    armLeaveGuard({ id: "mail-compose", message: "The draft will not be saved." });
    actions().done();
    expect(navTop(nav)?.kind).toBe("mail");
    expect(bumps).toBe(1);
    await settle();
    expect(currentMobileDialog()).toBeNull();
  });
});
