// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

/**
 * The always-on-top pin of an auxiliary window (multi-window P4/E6).
 *
 * A pin is a promise about a window: "stay where I can see you while I work in
 * the other one". Three things must hold, and each of them is a way the promise
 * breaks quietly — the button must show the state the WINDOW is in (not the one
 * a fresh component assumes), it must fall back when the OS refuses instead of
 * claiming success, and it must tell the central window, because that is what a
 * restart reads.
 */

const calls: Array<string> = [];
let isOnTop = false;
let refuse = false;
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    async isAlwaysOnTop() {
      return isOnTop;
    },
    async setAlwaysOnTop(v: boolean) {
      if (refuse) throw new Error("the OS said no");
      isOnTop = v;
      calls.push("setAlwaysOnTop:" + v);
    },
  }),
}));

const reported: Array<{ label: string; value: boolean }> = [];
vi.mock("../services/windowBus", () => ({
  getWindowBus: async () => ({
    async request(name: string, args: unknown) {
      if (name === "window-always-on-top") reported.push(args as { label: string; value: boolean });
      return undefined;
    },
  }),
}));

import { AuxTitleBar } from "./AuxTitleBar";

let host: HTMLDivElement;
let root: Root;

async function mount(label: string | null = "aux-1") {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<AuxTitleBar title="Note.md" label={label} />);
  });
}

const pin = () => host.querySelector('[data-testid="aux-pin"]') as HTMLButtonElement;

beforeEach(() => {
  calls.length = 0;
  reported.length = 0;
  isOnTop = false;
  refuse = false;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
});

describe("the pin", () => {
  it("pins the window and tells the central window about it", async () => {
    await mount();
    await act(async () => {
      pin().click();
    });

    expect(calls).toEqual(["setAlwaysOnTop:true"]);
    // Without the report the pin is forgotten on the next start — the window
    // would come back behind everything, and nobody would know why.
    expect(reported).toEqual([{ label: "aux-1", value: true }]);
  });

  it("shows the state of a window that was restored pinned", async () => {
    isOnTop = true;
    await mount();

    // A fresh component assumes "not pinned". A restored window that IS pinned
    // would then show an off button that unpins on the first click.
    expect(pin().getAttribute("aria-pressed")).toBe("true");
  });

  it("puts the button back when the window system refuses", async () => {
    refuse = true;
    await mount();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await act(async () => {
      pin().click();
    });
    warn.mockRestore();

    // A button that shows "pinned" while the window is not is worse than no
    // pin: the user arranges their desktop around a promise that is not kept.
    expect(pin().getAttribute("aria-pressed")).toBe("false");
    expect(reported).toEqual([]);
  });

  it("still pins a window nobody is keeping a list for", async () => {
    await mount(null);
    await act(async () => {
      pin().click();
    });

    // No label means no owner to report to. The pin works for this session; it
    // just is not remembered.
    expect(calls).toEqual(["setAlwaysOnTop:true"]);
    expect(reported).toEqual([]);
  });
});
