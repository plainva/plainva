import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeLeaveGuard, armLeaveGuard, confirmLeave, disarmLeaveGuard, resetLeaveGuard } from "./leaveGuard";

/**
 * A tap on the navigation bar clears the overlay stack, and until now that
 * threw away a half-written mail, entered credentials or the encryption
 * wizard's in-memory keys without asking. These pin the question itself.
 */
describe("leave guard", () => {
  beforeEach(resetLeaveGuard);

  it("lets navigation through untouched when no surface has unsaved work", async () => {
    const confirm = vi.fn(async () => true);
    expect(await confirmLeave(confirm)).toBe(true);
    // The common case must not cost a dialog — navigation has to feel unchanged.
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks before leaving an armed surface and keeps it when the answer is no", async () => {
    armLeaveGuard({ id: "compose", message: "Entwurf verwerfen?" });
    const confirm = vi.fn(async () => false);
    expect(await confirmLeave(confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith("Entwurf verwerfen?");
    // Staying must not disarm: the next attempt has to ask again.
    expect(activeLeaveGuard()).not.toBeNull();
  });

  it("stops asking once the user confirmed the discard", async () => {
    armLeaveGuard({ id: "compose", message: "Entwurf verwerfen?" });
    const confirm = vi.fn(async () => true);
    expect(await confirmLeave(confirm)).toBe(true);
    expect(activeLeaveGuard()).toBeNull();
    expect(await confirmLeave(confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("only lets a surface disarm the guard it armed itself", () => {
    armLeaveGuard({ id: "compose", message: "Entwurf verwerfen?" });
    // React runs the OLD screen's cleanup after the new screen mounted; without
    // the id check that late cleanup would disarm the new screen's guard.
    armLeaveGuard({ id: "wizard", message: "Einrichtung abbrechen?" });
    disarmLeaveGuard("compose");
    expect(activeLeaveGuard()?.id).toBe("wizard");
    disarmLeaveGuard("wizard");
    expect(activeLeaveGuard()).toBeNull();
  });
});
