// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QrScanner } from "@plainva/ui";

/**
 * The shared live scanner (parity gap qr-pairing-scan, closed 2026-08-20).
 *
 * Both shells render this now; the phone adds Capacitor's permission prompt
 * through the hook. jsdom has no getUserMedia, which is exactly the failure
 * path worth pinning.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const classes = {
  root: "pv-qr-scanner",
  video: "pv-qr-video",
  frame: "pv-qr-frame",
  fallback: "pv-qr-fallback",
  bar: "pv-qr-bar",
};

let host: HTMLDivElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

async function render(props: Partial<Parameters<typeof QrScanner>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<QrScanner classes={classes} onClose={() => {}} onDecode={() => {}} {...props} />);
  });
  return host;
}

describe("the shared QR scanner", () => {
  it("shows the reason and NO video element when the camera cannot start", async () => {
    // An Android WebView paints its play-button placeholder over a video with
    // no stream, which read as a broken screen (maintainer 2026-07-25). The
    // fix was to leave the element unmounted — this is what holds that.
    const el = await render();
    expect(el.querySelector(".pv-qr-fallback")).not.toBeNull();
    expect(el.querySelector("video")).toBeNull();
  });

  it("asks the platform for permission first, where one is passed", async () => {
    const ask = vi.fn(async () => {});
    await render({ requestPermission: ask });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("works without a permission hook — the desktop's WebView prompts itself", async () => {
    const el = await render({ requestPermission: undefined });
    expect(el.querySelector(".pv-qr-scanner")).not.toBeNull();
  });
});
