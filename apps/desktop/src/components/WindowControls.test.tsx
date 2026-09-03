// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The maximize button of the frameless window (Windows/Linux). Finding
 * 2026-09-01 (D3): the icon only changed when THIS button was clicked — a
 * double-click on the title bar or the OS window key maximized the window
 * while the button kept showing the "maximize" square. The state is now
 * observed through the window's resize events.
 */

let maximized = false;
let resizeListeners: Array<() => void> = [];
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: async () => maximized,
    onResized: async (cb: () => void) => {
      resizeListeners.push(cb);
      return () => {
        resizeListeners = resizeListeners.filter((l) => l !== cb);
      };
    },
    minimize: async () => {},
    toggleMaximize: async () => {
      maximized = !maximized;
    },
    close: async () => {},
  }),
}));

let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const byId = (id: string) => host.querySelector(`[data-testid="${id}"]`);

async function mount() {
  // The controls only render inside the Tauri runtime — and never on macOS,
  // whose traffic lights stay native. The flag is read at import time.
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
  const { WindowControls } = await import("./WindowControls");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<WindowControls />); });
  await flush();
}

describe("WindowControls", () => {
  beforeEach(() => {
    maximized = false;
    resizeListeners = [];
    vi.resetModules();
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("swaps the icon when the window is maximized from outside the button", async () => {
    await mount();
    expect(byId("window-maximize-icon")).not.toBeNull();
    const before = byId("window-maximize")?.getAttribute("aria-label");
    expect(resizeListeners.length).toBe(1);

    // A title-bar double-click: the OS maximizes, only a resize event arrives.
    maximized = true;
    for (const l of resizeListeners) l();
    await flush();
    expect(byId("window-restore-icon")).not.toBeNull();
    expect(byId("window-maximize-icon")).toBeNull();
    expect(byId("window-maximize")?.getAttribute("aria-label")).not.toBe(before);

    // And back.
    maximized = false;
    for (const l of resizeListeners) l();
    await flush();
    expect(byId("window-maximize-icon")).not.toBeNull();
    expect(byId("window-maximize")?.getAttribute("aria-label")).toBe(before);
  });

  it("stops listening when it unmounts", async () => {
    await mount();
    expect(resizeListeners.length).toBe(1);
    await act(async () => { root.unmount(); });
    expect(resizeListeners.length).toBe(0);
    // afterEach unmounts again; React tolerates it, the listener list stays empty.
    root = createRoot(host);
  });
});
