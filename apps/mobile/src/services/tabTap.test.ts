// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumePendingNew, takePendingNew, takePendingNewText } from "@plainva/ui";
import { initialNavState, type NavState } from "../navigation";
import { activeLeaveGuard, armLeaveGuard, resetLeaveGuard } from "./leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "./mobileDialogs";
import { newInTab, tabTapped } from "./tabTap";

/**
 * "New task" and "New event" over unsaved work (finding 2026-10-12).
 *
 * Both are made where they live: the area opens and takes the request, which is
 * parked for a screen that may still be mounting. The request used to be
 * parked BEFORE the bar step asked about the message being written — so after
 * "Cancel" it was still waiting, and the capture sheet opened by itself on the
 * next visit to the area, with nobody having asked for it there. The question
 * comes first now, like everything else a tap on the bar changes.
 */

vi.mock("./haptics", () => ({ haptics: { light: vi.fn() } }));
vi.mock("./navigatorPlace", () => ({ forgetNavigatorSection: vi.fn() }));

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const MESSAGE = { id: "mail-compose", message: "The draft will not be saved." };
const answer = (discard: boolean) => {
  const dialog = currentMobileDialog();
  expect(dialog?.kind, "the leave question is on screen").toBe("confirm");
  if (dialog?.kind !== "confirm") throw new Error("no question");
  dialog.resolve(discard);
  dismissMobileDialog(dialog);
};

let nav: NavState;
const setNav = (step: (state: NavState) => NavState) => {
  nav = step(nav);
};
/** A screen of the area that is mounted and takes requests as they come. */
const mounted = (id: "task" | "event") => {
  const taken: string[] = [];
  const stop = consumePendingNew(id, (text) => taken.push(text));
  return { taken, stop };
};

beforeEach(() => {
  nav = { ...initialNavState("mail"), overlay: [{ kind: "mailcompose", path: "{}" }] };
  takePendingNew("task");
  takePendingNew("event");
  resetLeaveGuard();
});

afterEach(() => {
  const open = currentMobileDialog();
  if (open) dismissMobileDialog(open);
  resetLeaveGuard();
});

describe("a new task or event asked for from elsewhere", () => {
  it("opens its area and leaves the request for the screen that mounts there", async () => {
    expect(await newInTab("task", "tasks", setNav)).toBe(true);
    expect(nav.activeTab).toBe("tasks");
    expect(nav.overlay).toEqual([]);
    expect(takePendingNewText("task")).toBe("");
  });

  it("carries what was typed so far", async () => {
    await newInTab("task", "tasks", setNav, "Order the spare part");
    expect(takePendingNewText("task")).toBe("Order the spare part");
  });

  it("parks nothing while the question about unsaved work stands", async () => {
    armLeaveGuard(MESSAGE);
    const screen = mounted("task");
    const going = newInTab("task", "tasks", setNav, "Order the spare part");
    await settle();

    expect(currentMobileDialog()?.kind).toBe("confirm");
    expect(screen.taken, "no mounted screen was told").toEqual([]);
    expect(takePendingNew("task"), "nothing waits").toBe(false);
    expect(nav.activeTab).toBe("mail");

    answer(false);
    expect(await going).toBe(false);
    screen.stop();
  });

  it("leaves nothing behind on Cancel: the area visited later opens no capture", async () => {
    armLeaveGuard(MESSAGE);
    const going = newInTab("task", "tasks", setNav);
    await settle();
    answer(false);
    expect(await going).toBe(false);

    expect(nav.activeTab, "the message stays on screen").toBe("mail");
    expect(nav.overlay).toHaveLength(1);
    expect(activeLeaveGuard(), "and stays guarded").toEqual(MESSAGE);
    // THE DEFECT: the request was parked before the question and waited here.
    const later = mounted("task");
    expect(later.taken).toEqual([]);
    later.stop();
  });

  it("parks the request once the answer is Discard, and then opens the area", async () => {
    armLeaveGuard(MESSAGE);
    const going = newInTab("event", "today", setNav);
    await settle();
    answer(true);
    expect(await going).toBe(true);

    expect(nav.activeTab).toBe("today");
    expect(nav.overlay).toEqual([]);
    const screen = mounted("event");
    expect(screen.taken).toEqual([""]);
    screen.stop();
  });
});

describe("a tap on the bar", () => {
  it("says whether it went", async () => {
    expect(await tabTapped("tasks", setNav)).toBe(true);
    armLeaveGuard(MESSAGE);
    const tapped = tabTapped("notes", setNav);
    await settle();
    answer(false);
    expect(await tapped).toBe(false);
    expect(nav.activeTab).toBe("tasks");
  });

  it("runs what the step brings along only once the step is agreed to, and before the area opens", async () => {
    armLeaveGuard(MESSAGE);
    const order: string[] = [];
    const agreed = vi.fn(() => order.push(`agreed in ${nav.activeTab}`));
    const tapped = tabTapped("tasks", setNav, agreed);
    await settle();
    expect(agreed).not.toHaveBeenCalled();
    answer(true);
    await tapped;
    expect(order).toEqual(["agreed in mail"]);
    expect(nav.activeTab).toBe("tasks");
  });
});
