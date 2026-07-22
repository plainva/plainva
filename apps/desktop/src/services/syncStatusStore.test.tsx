// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { captureSyncErrorSnapshot, isSyncAuthenticationError, syncStatusStore, useDisplaySyncStatus } from "./syncStatusStore";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let renderCount = 0;
function Probe() {
  const snap = useDisplaySyncStatus(400);
  renderCount++;
  return <output>{snap.status}</output>;
}

function ProgressProbe() {
  const snap = useDisplaySyncStatus(400);
  return <output>{`${snap.status}:${snap.progress?.current ?? "-"}/${snap.progress?.total ?? "-"}`}</output>;
}

/**
 * Regression for the read-mode Mermaid flicker: the sync worker flips
 * idle→syncing→idle every 15 s poll. A consumer that re-rendered on each flip
 * (App.tsx, at the top level) churned the whole tree twice per tick and
 * remounted the diagram. The displayed status must stay "idle" for a fast
 * no-op cycle AND cause no extra render.
 */
describe("useDisplaySyncStatus", () => {
  let container: HTMLDivElement;
  let root: Root;
  const shown = () => container.querySelector("output")?.textContent;

  beforeEach(() => {
    vi.useFakeTimers();
    syncStatusStore.reset();
    renderCount = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("does not re-render on a fast idle→syncing→idle no-op cycle", () => {
    act(() => root.render(<Probe />));
    const initial = renderCount;
    expect(shown()).toBe("idle");

    act(() => { syncStatusStore.set({ status: "syncing" }); });
    act(() => { vi.advanceTimersByTime(100); });
    act(() => { syncStatusStore.set({ status: "idle", message: null, provider: null }); });

    expect(shown()).toBe("idle");
    expect(renderCount).toBe(initial); // the displayed value never changed
  });

  it("shows syncing only after the delay for a slow cycle", () => {
    act(() => root.render(<Probe />));
    act(() => { syncStatusStore.set({ status: "syncing" }); });
    act(() => { vi.advanceTimersByTime(100); });
    expect(shown()).toBe("idle"); // still collapsed within the delay
    act(() => { vi.advanceTimersByTime(400); });
    expect(shown()).toBe("syncing"); // now shown
  });

  it("passes errors through immediately", () => {
    act(() => root.render(<Probe />));
    act(() => { syncStatusStore.set({ status: "error", message: "boom" }); });
    expect(shown()).toBe("error");
  });

  it("flows progress updates through once syncing is revealed, without re-collapsing (WP6)", () => {
    act(() => root.render(<ProgressProbe />));
    act(() => { syncStatusStore.set({ status: "syncing", progress: { phase: "pull", current: 1, total: 10 } }); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(shown()).toBe("syncing:1/10");

    // A later progress tick (status stays syncing) updates the count in place.
    act(() => { syncStatusStore.set({ progress: { phase: "pull", current: 7, total: 10 } }); });
    expect(shown()).toBe("syncing:7/10");

    // Cycle end clears progress and returns to idle.
    act(() => { syncStatusStore.set({ status: "idle", progress: null }); });
    expect(shown()).toBe("idle:-/-");
  });

  it("keeps an immutable error snapshot after an automatic retry succeeds", () => {
    syncStatusStore.set({ status: "error", message: "Google Drive request timed out after 30s", provider: "drive" });
    const captured = captureSyncErrorSnapshot();
    syncStatusStore.set({ status: "idle", message: null });
    expect(captured).toMatchObject({ message: "Google Drive request timed out after 30s", provider: "drive" });
    expect(captureSyncErrorSnapshot()).toEqual(captured);
  });

  it("distinguishes authentication failures from transient provider failures", () => {
    expect(isSyncAuthenticationError("Drive token refresh failed: 401 invalid_grant")).toBe(true);
    expect(isSyncAuthenticationError("Google Drive request timed out after 30s")).toBe(false);
    expect(isSyncAuthenticationError("Google Drive list failed (HTTP 503): backendError")).toBe(false);
  });
});
