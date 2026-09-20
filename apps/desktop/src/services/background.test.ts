import { describe, expect, it, vi } from "vitest";

/**
 * Running in the background.
 *
 * One property matters more than all the others here: there must be no state in
 * which the window can be closed with nothing to bring it back. Every path that
 * does not end in a visible tray icon has to end with the setting OFF, because
 * the window's close handler asks the tray — not the setting — whether it may
 * hide (src/tray.rs).
 */

vi.mock("@tauri-apps/plugin-autostart", () => ({ enable: vi.fn(), disable: vi.fn(), isEnabled: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const listen = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (k: string) => k } }));

import { applyAutostart, onTrayNewTask, turnTrayOn } from "./background";

const port = (over: Partial<Parameters<typeof turnTrayOn>[0]> = {}) => ({
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
  confirmVisible: vi.fn(async () => true),
  ...over,
});

describe("turnTrayOn", () => {
  it("keeps the icon once it has been seen", async () => {
    const p = port();
    expect(await turnTrayOn(p)).toEqual({ on: true });
    expect(p.disable).not.toHaveBeenCalled();
  });

  it("takes the icon back down when nobody could see it", async () => {
    // The case a build-succeeded gate misses entirely: on Linux the icon
    // registers over D-Bus whether or not anything renders it.
    const p = port({ confirmVisible: vi.fn(async () => false) });
    expect(await turnTrayOn(p)).toEqual({ on: false, reason: "invisible" });
    expect(p.disable).toHaveBeenCalled();
  });

  it("reports what the platform said when the icon cannot be built", async () => {
    const p = port({ enable: vi.fn(async () => { throw new Error("no tray here"); }) });
    expect(await turnTrayOn(p)).toEqual({ on: false, reason: "failed", error: "no tray here" });
  });

  it("never asks before the icon is actually up", async () => {
    // Asking first and building afterwards would make the answer a guess.
    const order: string[] = [];
    await turnTrayOn({
      enable: vi.fn(async () => void order.push("enable")),
      disable: vi.fn(async () => {}),
      confirmVisible: vi.fn(async () => (order.push("ask"), true)),
    });
    expect(order).toEqual(["enable", "ask"]);
  });

  it("stays off on every path that does not end in a visible icon", async () => {
    for (const p of [port({ confirmVisible: vi.fn(async () => false) }), port({ enable: vi.fn(async () => { throw new Error("x"); }) })]) {
      expect((await turnTrayOn(p)).on).toBe(false);
    }
  });
});

describe("applyAutostart", () => {
  const autoPort = (enabled: boolean) => ({
    enable: vi.fn(async () => {}),
    disable: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => enabled),
  });

  it("registers only when the system does not have it yet", async () => {
    const p = autoPort(false);
    expect(await applyAutostart(true, p)).toBe(true);
    expect(p.enable).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the system already agrees", async () => {
    // The entry can be removed from outside Plainva, so the system is asked
    // first — writing blindly would either duplicate it or report a state that
    // is not true.
    const p = autoPort(true);
    expect(await applyAutostart(true, p)).toBe(true);
    expect(p.enable).not.toHaveBeenCalled();
    expect(p.disable).not.toHaveBeenCalled();
  });

  it("removes the registration when switched off", async () => {
    const p = autoPort(true);
    expect(await applyAutostart(false, p)).toBe(false);
    expect(p.disable).toHaveBeenCalledTimes(1);
  });
});

describe("onTrayNewTask", () => {
  it("runs the handler when the tray asks for a new task", async () => {
    let fire: () => void = () => {};
    listen.mockImplementationOnce(async (_event: string, cb: () => void) => { fire = cb; return () => {}; });
    const handler = vi.fn();
    await onTrayNewTask(handler);
    expect(listen).toHaveBeenCalledWith("plainva-tray-new-task", expect.any(Function));
    fire();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes without an error when the event plugin is not there", async () => {
    // Tauri's unlisten is async under a synchronous type and REJECTS where the
    // plugin internals are missing (the browser of the E2E suite). Unhandled,
    // that is a page error - the search suite caught exactly that.
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      listen.mockImplementationOnce(async () => async () => { throw new TypeError("Cannot read properties of undefined (reading 'unregisterListener')"); });
      const rejecting = await onTrayNewTask(() => {});
      expect(() => rejecting()).not.toThrow();
      listen.mockImplementationOnce(async () => () => { throw new Error("sync failure"); });
      const throwing = await onTrayNewTask(() => {});
      expect(() => throwing()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  it("is a no-op where there is no tray to listen to", async () => {
    listen.mockImplementationOnce(async () => { throw new Error("not a desktop shell"); });
    const unsubscribe = await onTrayNewTask(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
