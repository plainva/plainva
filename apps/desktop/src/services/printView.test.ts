// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import { invoke } from "@tauri-apps/api/core";
import { isMacPlatform, printElement } from "./printView";

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

describe("printView", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockResolvedValue(undefined);
    document.querySelectorAll(".pv-print-host").forEach((n) => n.remove());
    document.body.removeAttribute("data-printing");
    window.print = vi.fn();
  });

  it("detects macOS user agents only", () => {
    expect(isMacPlatform(MAC_UA)).toBe(true);
    expect(isMacPlatform(WIN_UA)).toBe(false);
    expect(isMacPlatform("Mozilla/5.0 (X11; Linux x86_64) WebKitGTK")).toBe(false);
  });

  it("uses window.print() on non-mac platforms and cleans up via afterprint", async () => {
    setUserAgent(WIN_UA);
    const source = document.createElement("div");
    source.textContent = "note body";

    await printElement(source);

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    expect(document.body.hasAttribute("data-printing")).toBe(true);
    expect(document.querySelector(".pv-print-host")?.textContent).toBe("note body");

    window.dispatchEvent(new Event("afterprint"));
    expect(document.body.hasAttribute("data-printing")).toBe(false);
    expect(document.querySelector(".pv-print-host")).toBeNull();
  });

  it("routes macOS through the native print command, not window.print()", async () => {
    setUserAgent(MAC_UA);
    const source = document.createElement("div");

    await printElement(source);

    expect(invoke).toHaveBeenCalledWith("print_webview");
    expect(window.print).not.toHaveBeenCalled();
    // The clone must OUTLIVE the command return — macOS may still be
    // rendering the preview (issue #6 spike finding).
    expect(document.querySelector(".pv-print-host")).not.toBeNull();
    expect(document.body.hasAttribute("data-printing")).toBe(true);

    window.dispatchEvent(new Event("afterprint"));
    expect(document.querySelector(".pv-print-host")).toBeNull();
  });

  it("falls back to window.print() when the native command fails", async () => {
    setUserAgent(MAC_UA);
    vi.mocked(invoke).mockRejectedValueOnce(new Error("unsupported"));

    await printElement(document.createElement("div"));

    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it("replaces a lingering host instead of stacking, and stale cleanups are no-ops", async () => {
    setUserAgent(MAC_UA);
    await printElement(document.createElement("div"));
    const first = document.querySelector(".pv-print-host");

    await printElement(document.createElement("div"));
    const hosts = document.querySelectorAll(".pv-print-host");
    expect(hosts.length).toBe(1);
    expect(hosts[0]).not.toBe(first);
    // The second run owns data-printing even after the first run's cleanup
    // path already detached its host.
    expect(document.body.hasAttribute("data-printing")).toBe(true);
  });
});
