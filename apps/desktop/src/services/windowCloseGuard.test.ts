// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The window's half of "a window does not close over a changed draft without
 * asking" (finding 2026-10-09). The central window destroys a window when its
 * close is asked for, so a window that holds unsaved work has to say so, has to
 * answer when it is asked back, and has to let go again once the work is sent,
 * filed or given up. The central window's half is windowCloseHold.test.ts.
 *
 * A real bus on an in-memory wire stands in for the two windows; only the OS
 * close itself is a fake.
 */

/** `order` is what happened, in sequence: what the central window was told, and the OS close. */
const os = vi.hoisted(() => ({ closes: 0, order: [] as string[] }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: async () => {
      os.closes += 1;
      os.order.push("close");
    },
  }),
}));

import { createWindowBus, OWNER_LABEL, setWindowBusForTest, type BusTransport, type WindowBus } from "./windowBus";
import { resetWindowParamsForTest } from "./windowContext";
import { holdWindowClose, releaseWindowClose, resetWindowCloseGuardForTest } from "./windowCloseGuard";

function createWire() {
  const listeners = new Map<string, Set<{ label: string; fn: (p: unknown) => void }>>();
  return (label: string): BusTransport => ({
    label,
    async emit(event, payload) {
      for (const e of listeners.get(event) ?? []) e.fn(payload);
    },
    async emitTo(target, event, payload) {
      for (const e of listeners.get(event) ?? []) if (e.label === target) e.fn(payload);
    },
    async listen(event, handler) {
      const entry = { label, fn: handler };
      const set = listeners.get(event) ?? new Set();
      set.add(entry);
      listeners.set(event, set);
      return () => set.delete(entry);
    },
  });
}

const LABEL = "compose-1";
let owner: WindowBus;
let client: WindowBus;
/** What the central window was told, in order: who, and whether it holds work. */
let told: Array<[string, boolean]>;
/** A central window that is busy: it hears a report at once and answers it this much later. */
let ownerAnswersAfter = 0;

/** Lets the bus round trips and the promise chains behind them run out. */
async function settle() {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
}

/** The central window asks back, as it does when the close is requested. */
async function closeRequested(label = LABEL) {
  await owner.broadcast("close-requested", { label }, null);
  await settle();
}

/** A question whose answer the test gives when it chooses to. */
function question() {
  let answer!: (discard: boolean) => void;
  const asked = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
  return { asked, answer: (discard: boolean) => answer(discard) };
}

beforeEach(async () => {
  os.closes = 0;
  os.order.length = 0;
  told = [];
  resetWindowCloseGuardForTest();
  resetWindowParamsForTest(`?win=compose&vault=%2Fvault&label=${LABEL}`);
  const wire = createWire();
  owner = createWindowBus(wire(OWNER_LABEL));
  client = createWindowBus(wire(LABEL));
  ownerAnswersAfter = 0;
  await owner.handle("window-close-hold", async ({ held }, from) => {
    told.push([from, held]);
    os.order.push(held ? "held" : "let go");
    if (ownerAnswersAfter) await new Promise((r) => setTimeout(r, ownerAnswersAfter));
  });
  setWindowBusForTest(client);
});

afterEach(async () => {
  setWindowBusForTest(null);
  resetWindowParamsForTest();
  resetWindowCloseGuardForTest();
  await owner.dispose();
  await client.dispose();
});

describe("holding work", () => {
  it("tells the central window, and tells it again once nothing is held", async () => {
    const letGo = holdWindowClose(async () => true);
    await settle();
    expect(told).toEqual([[LABEL, true]]);
    letGo();
    await settle();
    expect(told).toEqual([[LABEL, true], [LABEL, false]]);
  });

  it("reports once for two surfaces, and lets go only when both did", async () => {
    const first = holdWindowClose(async () => true);
    const second = holdWindowClose(async () => true);
    await settle();
    expect(told).toEqual([[LABEL, true]]);
    first();
    await settle();
    expect(told).toEqual([[LABEL, true]]);
    second();
    await settle();
    expect(told).toEqual([[LABEL, true], [LABEL, false]]);
  });

  it("sends every change as it happens, not one after the central window answered the last", async () => {
    // A central window that is busy for a moment — indexing, a sync cycle. A
    // draft that goes back to untouched and is changed again in that time must
    // not be known there by its older state when the close arrives.
    ownerAnswersAfter = 300;
    const first = holdWindowClose(async () => true);
    first();
    holdWindowClose(async () => true);
    await settle();
    expect(told).toEqual([[LABEL, true], [LABEL, false], [LABEL, true]]);
  });

  it("is nothing the central window does for itself: nobody asks it when it closes", async () => {
    resetWindowParamsForTest("");
    const letGo = holdWindowClose(async () => true);
    await settle();
    letGo();
    await settle();
    expect(told).toEqual([]);
  });
});

describe("a close that is asked for", () => {
  it("is answered first and then put to the person; Cancel keeps the window", async () => {
    const q = question();
    holdWindowClose(q.asked);
    await settle();
    await closeRequested();
    // The central window waits for this answer before it decides.
    expect(told).toEqual([[LABEL, true], [LABEL, true]]);
    expect(q.asked).toHaveBeenCalledTimes(1);

    q.answer(false);
    await settle();
    expect(os.closes, "Cancel: the window stays, with everything in it").toBe(0);
    expect(told[told.length - 1]).toEqual([LABEL, true]);
  });

  it("lets the window go on Discard: the central window hears it, then the window closes", async () => {
    const q = question();
    holdWindowClose(q.asked);
    await settle();
    await closeRequested();
    q.answer(true);
    await settle();
    expect(told[told.length - 1]).toEqual([LABEL, false]);
    expect(os.closes).toBe(1);
    // In that order: the close then meets a central window that knows.
    expect(os.order.slice(-2)).toEqual(["let go", "close"]);

    // The close it asked for itself comes back as a request like any other —
    // and is answered with "nothing held", without a second question.
    await closeRequested();
    expect(q.asked).toHaveBeenCalledTimes(1);
    expect(told[told.length - 1]).toEqual([LABEL, false]);
  });

  it("asks once, however often the close is requested while the question stands", async () => {
    const q = question();
    holdWindowClose(q.asked);
    await settle();
    await closeRequested();
    await closeRequested();
    expect(q.asked).toHaveBeenCalledTimes(1);
    // Each request still gets its answer: the work is held.
    expect(told.filter(([, held]) => held)).toHaveLength(3);
    q.answer(false);
    await settle();
    expect(os.closes).toBe(0);
  });

  it("asks again the next time, after a Cancel", async () => {
    const q = question();
    holdWindowClose(q.asked);
    await settle();
    await closeRequested();
    q.answer(false);
    await settle();
    await closeRequested();
    expect(q.asked).toHaveBeenCalledTimes(2);
  });

  it("is not this window's when it names another one", async () => {
    const q = question();
    holdWindowClose(q.asked);
    await settle();
    await closeRequested("aux-7");
    expect(q.asked).not.toHaveBeenCalled();
    expect(told).toEqual([[LABEL, true]]);
  });
});

describe("a window that is done with its work", () => {
  it("says so and is not asked again — a sent message is not a discarded one", async () => {
    // The composer's fields still hold everything that was typed when the
    // message leaves: the hold is still registered. What changed is that the
    // work is no longer the window's to lose.
    const q = question();
    holdWindowClose(q.asked);
    await settle();
    releaseWindowClose();
    await settle();
    expect(told).toEqual([[LABEL, true], [LABEL, false]]);

    await closeRequested();
    expect(q.asked).not.toHaveBeenCalled();
    expect(told[told.length - 1]).toEqual([LABEL, false]);
  });

  it("has nothing to say when it never held anything", async () => {
    releaseWindowClose();
    await settle();
    expect(told).toEqual([]);
  });
});
