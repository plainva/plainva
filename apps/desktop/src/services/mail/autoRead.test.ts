import { describe, expect, it } from "vitest";
import { AUTO_READ_DELAY_MS, applyManualSeen, retainOnlyOpen, shouldScheduleAutoRead } from "@plainva/ui/mail";

const NONE: ReadonlySet<string> = new Set();

describe("auto-read scheduling", () => {
  it("runs for an open unread message whose body has arrived", () => {
    expect(shouldScheduleAutoRead({ openId: "7", hasBody: true, seen: false, heldUnread: NONE })).toBe(true);
  });

  it("does not run while the body is still loading — a spinner is not reading", () => {
    expect(shouldScheduleAutoRead({ openId: "7", hasBody: false, seen: false, heldUnread: NONE })).toBe(false);
  });

  it("does not run for an already read message", () => {
    expect(shouldScheduleAutoRead({ openId: "7", hasBody: true, seen: true, heldUnread: NONE })).toBe(false);
  });

  it("does not run with no message open", () => {
    expect(shouldScheduleAutoRead({ openId: null, hasBody: true, seen: false, heldUnread: NONE })).toBe(false);
  });

  /**
   * The bug this step exists for: turning an OPEN message unread used to restart
   * the very timer that marked it read again three seconds later.
   */
  it("does not run for a message the reader held unread by hand", () => {
    expect(shouldScheduleAutoRead({ openId: "7", hasBody: true, seen: false, heldUnread: new Set(["7"]) })).toBe(false);
  });

  it("a hold on a different message does not block this one", () => {
    expect(shouldScheduleAutoRead({ openId: "7", hasBody: true, seen: false, heldUnread: new Set(["8"]) })).toBe(true);
  });

  it("waits three seconds", () => {
    expect(AUTO_READ_DELAY_MS).toBe(3000);
  });
});

describe("manual read state", () => {
  it("turning unread holds the message", () => {
    expect([...applyManualSeen(NONE, ["7"], false)]).toEqual(["7"]);
  });

  it("turning read releases the hold, so the next visit behaves normally", () => {
    expect([...applyManualSeen(new Set(["7"]), ["7"], true)]).toEqual([]);
  });

  it("a bulk action holds every message it turned unread", () => {
    expect([...applyManualSeen(NONE, ["7", "8", "9"], false)].sort()).toEqual(["7", "8", "9"]);
  });

  it("leaves the caller's set untouched", () => {
    const before = new Set(["7"]);
    applyManualSeen(before, ["8"], false);
    expect([...before]).toEqual(["7"]);
  });
});

describe("leaving a message", () => {
  it("releases every hold but the one that is still open", () => {
    expect([...retainOnlyOpen(new Set(["7", "8"]), "7")]).toEqual(["7"]);
  });

  it("releases the hold when the reader closes the message", () => {
    expect([...retainOnlyOpen(new Set(["7"]), null)]).toEqual([]);
  });

  it("releases the hold when another message is opened", () => {
    expect([...retainOnlyOpen(new Set(["7"]), "8")]).toEqual([]);
  });

  it("is idempotent for the message that stays open", () => {
    const once = retainOnlyOpen(new Set(["7"]), "7");
    expect([...retainOnlyOpen(once, "7")]).toEqual(["7"]);
  });
});

/**
 * The full round trip, in the order the two shells drive it: open, hold by
 * hand, leave, open again. The last step is the one that has to flip back —
 * a hold that survived the visit would be a new bug in the other direction.
 */
describe("hold across a visit", () => {
  it("holds while open and lets go after leaving and returning", () => {
    let held: ReadonlySet<string> = NONE;
    expect(shouldScheduleAutoRead({ openId: "7", hasBody: true, seen: false, heldUnread: held })).toBe(true);

    held = applyManualSeen(held, ["7"], false);
    expect(shouldScheduleAutoRead({ openId: "7", hasBody: true, seen: false, heldUnread: held })).toBe(false);

    held = retainOnlyOpen(held, null);
    held = retainOnlyOpen(held, "7");
    expect(shouldScheduleAutoRead({ openId: "7", hasBody: true, seen: false, heldUnread: held })).toBe(true);
  });
});
