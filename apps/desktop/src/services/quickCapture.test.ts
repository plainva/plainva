import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The global quick capture (plan Journal, J7). What is pinned here is the part
 * a suite CAN see: what the recorder makes of a key press, that nothing is
 * registered until it is switched on, that the old shortcut is released before
 * a new one is taken, and that a refusal — a taken shortcut, an unknown key, a
 * Wayland session — is reported instead of left half-on. The real system-wide
 * key is pressed by no suite.
 */

const storeValues: Record<string, unknown> = {};
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async (key: string) => storeValues[key],
    set: async (key: string, value: unknown) => { storeValues[key] = value; },
    save: async () => undefined,
  }),
}));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (key: string) => key } }));

import {
  DEFAULT_QUICK_CAPTURE_SHORTCUT, QUICK_CAPTURE_ENABLED_KEY, QUICK_CAPTURE_SHORTCUT_KEY,
  acceleratorFromEvent, acceleratorLabels, classifyRegisterError, initQuickCapture, onQuickCaptureState, quickCaptureState,
  readQuickCaptureConfig, resetQuickCaptureForTest, runQuickCapture, saveQuickCaptureConfig, setQuickCaptureSink, syncQuickCapture,
  type QuickCaptureDeps, type ShortcutKeyEvent,
} from "./quickCapture";

const press = (over: Partial<ShortcutKeyEvent>): ShortcutKeyEvent => ({ key: "j", code: "KeyJ", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over });

function fakeDeps(over: Partial<QuickCaptureDeps> = {}) {
  const calls: string[] = [];
  const handlers = new Map<string, () => void>();
  const deps: QuickCaptureDeps = {
    register: vi.fn(async (shortcut, onPressed) => { calls.push(`register:${shortcut}`); handlers.set(shortcut, onPressed); }),
    unregister: vi.fn(async (shortcut) => { calls.push(`unregister:${shortcut}`); handlers.delete(shortcut); }),
    sessionKind: vi.fn(async () => "other" as const),
    open: vi.fn(async () => undefined),
    ...over,
  };
  return { deps, calls, handlers };
}

beforeEach(() => {
  for (const key of Object.keys(storeValues)) delete storeValues[key];
  resetQuickCaptureForTest();
});

describe("the shortcut recorder", () => {
  it("waits while only modifiers are down", () => {
    expect(acceleratorFromEvent(press({ key: "Control", code: "ControlLeft", ctrlKey: true }), false)).toEqual({ ok: false, reason: "incomplete" });
    expect(acceleratorFromEvent(press({ key: "Shift", code: "ShiftLeft", shiftKey: true, altKey: true }), false)).toEqual({ ok: false, reason: "incomplete" });
  });

  it("refuses a bare or merely shifted key: system-wide it would be taken from every application", () => {
    expect(acceleratorFromEvent(press({}), false)).toEqual({ ok: false, reason: "needs-modifier" });
    expect(acceleratorFromEvent(press({ shiftKey: true, key: "J" }), false)).toEqual({ ok: false, reason: "needs-modifier" });
    expect(acceleratorFromEvent(press({ key: "F5", code: "F5" }), false)).toEqual({ ok: false, reason: "needs-modifier" });
  });

  it("does not offer keys a global shortcut should not end in", () => {
    for (const [key, code] of [["Enter", "Enter"], ["Tab", "Tab"], ["ArrowUp", "ArrowUp"], ["Backspace", "Backspace"]]) {
      expect(acceleratorFromEvent(press({ key, code, ctrlKey: true }), false)).toEqual({ ok: false, reason: "unsupported" });
    }
  });

  it("writes modifiers in one order and names the system key by platform", () => {
    expect(acceleratorFromEvent(press({ ctrlKey: true, altKey: true }), false)).toEqual({ ok: true, accelerator: "Control+Alt+J" });
    expect(acceleratorFromEvent(press({ shiftKey: true, altKey: true, ctrlKey: true, key: "J" }), false)).toEqual({ ok: true, accelerator: "Control+Alt+Shift+J" });
    expect(acceleratorFromEvent(press({ metaKey: true, shiftKey: true }), true)).toEqual({ ok: true, accelerator: "Shift+Command+J" });
    expect(acceleratorFromEvent(press({ metaKey: true }), false)).toEqual({ ok: true, accelerator: "Super+J" });
  });

  it("reads the physical key, so the shortcut is the same on every layout", () => {
    // A German keyboard: the key labelled Z reports code KeyY.
    expect(acceleratorFromEvent(press({ key: "z", code: "KeyY", ctrlKey: true }), false)).toEqual({ ok: true, accelerator: "Control+Y" });
    expect(acceleratorFromEvent(press({ key: "!", code: "Digit1", altKey: true, shiftKey: true }), false)).toEqual({ ok: true, accelerator: "Alt+Shift+1" });
    expect(acceleratorFromEvent(press({ key: "F9", code: "F9", ctrlKey: true }), false)).toEqual({ ok: true, accelerator: "Control+F9" });
    expect(acceleratorFromEvent(press({ key: " ", code: "Space", ctrlKey: true, altKey: true }), false)).toEqual({ ok: true, accelerator: "Control+Alt+Space" });
  });

  it("shows the shortcut as key caps in the platform's spelling", () => {
    expect(acceleratorLabels(DEFAULT_QUICK_CAPTURE_SHORTCUT, false)).toEqual(["Ctrl", "Alt", "J"]);
    expect(acceleratorLabels(DEFAULT_QUICK_CAPTURE_SHORTCUT, true)).toEqual(["⌘", "⌥", "J"]);
    expect(acceleratorLabels("Control+Shift+Super+Backquote", false)).toEqual(["Ctrl", "Shift", "Win", "`"]);
  });
});

describe("registration", () => {
  it("registers nothing while it is off — the default", async () => {
    const { deps } = fakeDeps();
    expect(await readQuickCaptureConfig()).toEqual({ enabled: false, shortcut: DEFAULT_QUICK_CAPTURE_SHORTCUT });
    expect(await initQuickCapture(deps)).toEqual({ status: "off" });
    expect(await syncQuickCapture({ enabled: false, shortcut: "Control+Alt+J" }, deps)).toEqual({ status: "off" });
    expect(deps.register).not.toHaveBeenCalled();
    expect(deps.unregister).not.toHaveBeenCalled();
    expect(deps.sessionKind).not.toHaveBeenCalled();
  });

  it("registers the chosen shortcut, and a press opens the capture window", async () => {
    const { deps, handlers } = fakeDeps();
    expect(await syncQuickCapture({ enabled: true, shortcut: "Control+Alt+J" }, deps)).toEqual({ status: "on", shortcut: "Control+Alt+J" });
    handlers.get("Control+Alt+J")!();
    expect(deps.open).toHaveBeenCalledOnce();
    // Asking again for what already holds does nothing.
    await syncQuickCapture({ enabled: true, shortcut: "Control+Alt+J" }, deps);
    expect(deps.register).toHaveBeenCalledOnce();
  });

  it("releases the old shortcut BEFORE it takes the new one, and releases it when switched off", async () => {
    const { deps, calls } = fakeDeps();
    await syncQuickCapture({ enabled: true, shortcut: "Control+Alt+J" }, deps);
    await syncQuickCapture({ enabled: true, shortcut: "Control+Alt+K" }, deps);
    await syncQuickCapture({ enabled: false, shortcut: "Control+Alt+K" }, deps);
    expect(calls).toEqual(["register:Control+Alt+J", "unregister:Control+Alt+J", "register:Control+Alt+K", "unregister:Control+Alt+K"]);
    expect(quickCaptureState()).toEqual({ status: "off" });
  });

  it("reports a shortcut another application holds, and leaves nothing half-on", async () => {
    const { deps, calls } = fakeDeps({ register: vi.fn(async () => { throw new Error("HotKey already registered"); }) });
    expect(await syncQuickCapture({ enabled: true, shortcut: "Control+Alt+J" }, deps)).toEqual({
      status: "failed", shortcut: "Control+Alt+J", reason: "taken", error: "HotKey already registered",
    });
    // Nothing was registered, so switching off has nothing to release.
    await syncQuickCapture({ enabled: false, shortcut: "Control+Alt+J" }, deps);
    expect(calls).toEqual([]);
  });

  it("keeps the working shortcut out of the way of a refused one: the old one is gone, the state says why", async () => {
    const taken = new Set(["Control+Alt+K"]);
    const { deps, calls } = fakeDeps();
    deps.register = vi.fn(async (shortcut) => {
      if (taken.has(shortcut)) throw new Error("already registered");
      calls.push(`register:${shortcut}`);
    });
    await syncQuickCapture({ enabled: true, shortcut: "Control+Alt+J" }, deps);
    const state = await syncQuickCapture({ enabled: true, shortcut: "Control+Alt+K" }, deps);
    expect(state).toMatchObject({ status: "failed", reason: "taken", shortcut: "Control+Alt+K" });
    // Picking a free one afterwards works without a stale release.
    expect(await syncQuickCapture({ enabled: true, shortcut: "Control+Alt+L" }, deps)).toEqual({ status: "on", shortcut: "Control+Alt+L" });
    expect(calls).toEqual(["register:Control+Alt+J", "unregister:Control+Alt+J", "register:Control+Alt+L"]);
  });

  it("tells a key the system does not know from one that is taken", () => {
    expect(classifyRegisterError(new Error("Couldn't recognize \"Foo\" as a valid key for hotkey"))).toMatchObject({ reason: "invalid" });
    expect(classifyRegisterError("failed to parse hotkey")).toMatchObject({ reason: "invalid" });
    expect(classifyRegisterError(new Error("RegisterHotKey failed"))).toEqual({ reason: "taken", error: "RegisterHotKey failed" });
  });

  it("does not even try under Wayland, and says so", async () => {
    const { deps } = fakeDeps({ sessionKind: vi.fn(async () => "wayland" as const) });
    expect(await syncQuickCapture({ enabled: true, shortcut: "Control+Alt+J" }, deps)).toEqual({ status: "failed", shortcut: "Control+Alt+J", reason: "wayland" });
    expect(deps.register).not.toHaveBeenCalled();
  });

  it("applies fast changes in the order they were made", async () => {
    const { deps, calls } = fakeDeps();
    const slow = deps.register;
    deps.register = vi.fn(async (shortcut, onPressed) => { await new Promise((r) => setTimeout(r, 5)); await slow(shortcut, onPressed); });
    const all = [
      syncQuickCapture({ enabled: true, shortcut: "Control+Alt+J" }, deps),
      syncQuickCapture({ enabled: false, shortcut: "Control+Alt+J" }, deps),
      syncQuickCapture({ enabled: true, shortcut: "Control+Alt+K" }, deps),
    ];
    await Promise.all(all);
    expect(calls).toEqual(["register:Control+Alt+J", "unregister:Control+Alt+J", "register:Control+Alt+K"]);
    expect(quickCaptureState()).toEqual({ status: "on", shortcut: "Control+Alt+K" });
  });

  it("stores the choice, tells the settings what came of it, and registers it again on the next start", async () => {
    const { deps } = fakeDeps();
    const seen: string[] = [];
    const off = onQuickCaptureState((state) => seen.push(state.status));
    await saveQuickCaptureConfig({ enabled: true, shortcut: "Control+Alt+K" }, deps);
    expect(storeValues[QUICK_CAPTURE_ENABLED_KEY]).toBe(true);
    expect(storeValues[QUICK_CAPTURE_SHORTCUT_KEY]).toBe("Control+Alt+K");
    expect(seen).toEqual(["on"]);
    off();

    // A new session: nothing is registered yet, the stored choice is.
    resetQuickCaptureForTest();
    const next = fakeDeps();
    expect(await initQuickCapture(next.deps)).toEqual({ status: "on", shortcut: "Control+Alt+K" });
    expect(next.calls).toEqual(["register:Control+Alt+K"]);
  });
});

describe("the capture that comes in over the bus", () => {
  it("has nowhere to go without an open vault, and says so", async () => {
    expect(await runQuickCapture({ text: "a thought", task: false })).toEqual({ ok: false, message: "quickCapture.noVault" });
  });

  it("goes to the shell that registered, and only that shell takes its registration back", async () => {
    const first = vi.fn(async () => ({ ok: true } as const));
    const second = vi.fn(async () => ({ ok: false, message: "refused" } as const));
    const offFirst = setQuickCaptureSink(first);
    setQuickCaptureSink(second);
    // A late cleanup of the first shell must not take the second one's sink away.
    offFirst();
    expect(await runQuickCapture({ text: "a thought", task: true })).toEqual({ ok: false, message: "refused" });
    expect(second).toHaveBeenCalledWith({ text: "a thought", task: true });
    expect(first).not.toHaveBeenCalled();
  });
});
