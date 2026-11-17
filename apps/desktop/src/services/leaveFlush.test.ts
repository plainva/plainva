import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The central window says it listens (`leave_armed`) — and says so last.
 *
 * React's Strict Mode, in every development and Labs build, runs an effect,
 * takes it out and runs it again. The first run's cleanup lands after the
 * second run's announcement; until 2026-11-17 the native side heard "not
 * listening" last, and in those builds nothing was ever held.
 */

const told: boolean[] = [];
const listeners = new Set<() => void>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_event: string, handler: () => void) => {
    listeners.add(handler);
    return () => listeners.delete(handler);
  },
}));
let lastWayOutCut = false;
const warnings: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: { armed?: boolean }) => {
    if (cmd === "leave_armed") told.push(args.armed === true);
    if (cmd === "leave_was_cut") return lastWayOutCut;
    return null;
  },
}));
vi.mock("@plainva/ui", () => ({ toast: { warning: (text: string) => warnings.push(text) } }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (key: string) => key } }));
const steps: string[] = [];
let heldHere = false;
let personLetsGo = true;
let otherWindowHolds = false;
let ownSettle: "settled" | "cut" = "settled";
let othersDone = true;
vi.mock("./beforeLeaving", () => ({
  settleBeforeLeaving: async () => {
    steps.push("settled");
    return ownSettle;
  },
}));
vi.mock("./windowDraftFlush", () => ({ flushWindowDrafts: async () => othersDone }));
vi.mock("./windowManager", () => ({ windowsStillHoldingWork: async () => otherWindowHolds }));
vi.mock("./windowCloseGuard", () => ({
  holdsUnsavedWork: () => heldHere,
  askHeldWork: async () => {
    steps.push("asked");
    return personLetsGo;
  },
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  exit: async (code: number) => {
    steps.push(`exit(${code})`);
  },
}));

const { installLeaveFlush, leaveOrStay, resetLeaveFlushForTest } = await import("./leaveFlush");

/** The effect in `AppContext`, as it is written there. */
function effect(): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;
  void installLeaveFlush().then((off) => {
    if (cancelled) off();
    else stop = off;
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("the central window says it listens", () => {
  beforeEach(() => {
    told.length = 0;
    listeners.clear();
    resetLeaveFlushForTest();
  });

  it("stays armed when Strict Mode runs the effect, takes it out and runs it again", async () => {
    const first = effect();
    first();
    const second = effect();
    await settle();
    expect(told[told.length - 1]).toBe(true);
    expect(listeners.size).toBe(1);
    second();
    await settle();
    expect(told[told.length - 1]).toBe(false);
    expect(listeners.size).toBe(0);
  });

  it("is disarmed once the last listener is gone, however the takes-out interleave", async () => {
    const a = effect();
    const b = effect();
    await settle();
    a();
    await settle();
    expect(told[told.length - 1]).toBe(true);
    b();
    await settle();
    expect(told[told.length - 1]).toBe(false);
  });
});

describe("a mail or a remark not sent in the central window itself", () => {
  beforeEach(() => {
    steps.length = 0;
    heldHere = true;
    personLetsGo = true;
    otherWindowHolds = false;
    resetLeaveFlushForTest();
  });

  it("is asked about on quit, and the app quits once the person lets it go", async () => {
    expect((await leaveOrStay()).stay).toBe(true);
    await settle();
    expect(steps).toEqual(["asked", "exit(0)"]);
    // The quit that follows does not ask a second time.
    expect((await leaveOrStay()).stay).toBe(false);
    expect(steps[steps.length - 1]).toBe("settled");
  });

  it("keeps the app open with everything in it when the person cancels", async () => {
    personLetsGo = false;
    expect((await leaveOrStay()).stay).toBe(true);
    await settle();
    expect(steps).toEqual(["asked"]);
  });

  it("is not asked about on a termination signal: everything is written and the app goes", async () => {
    otherWindowHolds = true;
    expect((await leaveOrStay(false)).stay).toBe(false);
    expect(steps).toEqual(["settled"]);
  });
});

describe("a way out the deadline cut short", () => {
  beforeEach(() => {
    warnings.length = 0;
    resetLeaveFlushForTest();
  });

  it("is said once at the next start", async () => {
    lastWayOutCut = true;
    const first = effect();
    first();
    const second = effect();
    await settle();
    expect(warnings).toEqual(["window.closedBeforeSaved"]);
    second();
    lastWayOutCut = false;
  });

  it("is not said when the last way out was in time", async () => {
    const off = effect();
    await settle();
    expect(warnings).toEqual([]);
    off();
  });
});

describe("an answer given on one way out", () => {
  beforeEach(() => {
    steps.length = 0;
    heldHere = true;
    personLetsGo = true;
    otherWindowHolds = false;
    ownSettle = "settled";
    othersDone = true;
    resetLeaveFlushForTest();
  });

  it("is used up when the app stays: a mail written in the central window afterwards is asked about on the next quit", async () => {
    otherWindowHolds = true;
    // Quit: the central window asks, the person lets its mail go, and the app quits on its own.
    expect((await leaveOrStay()).stay).toBe(true);
    await settle();
    expect(steps).toEqual(["asked", "exit(0)"]);
    // That quit: another window holds a mail, its question is cancelled, the app stays.
    expect((await leaveOrStay()).stay).toBe(true);
    // Later: a new mail in the central window, the other window's mail is sent, quit again.
    otherWindowHolds = false;
    expect((await leaveOrStay()).stay).toBe(true);
    await settle();
    expect(steps).toEqual(["asked", "exit(0)", "asked", "exit(0)"]);
  });
});

describe("a way out a window did not finish", () => {
  beforeEach(() => {
    steps.length = 0;
    heldHere = false;
    otherWindowHolds = false;
    ownSettle = "settled";
    othersDone = true;
    resetLeaveFlushForTest();
  });

  it("is said to the native side when the central window's own wait ran out", async () => {
    ownSettle = "cut";
    expect(await leaveOrStay()).toEqual({ stay: false, cut: true });
  });

  it("is said when another window did not answer in time, or said its wait ran out", async () => {
    othersDone = false;
    expect(await leaveOrStay()).toEqual({ stay: false, cut: true });
  });

  it("is not said when every window was done", async () => {
    expect(await leaveOrStay()).toEqual({ stay: false, cut: false });
  });
});
