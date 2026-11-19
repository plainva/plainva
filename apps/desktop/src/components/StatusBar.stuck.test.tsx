// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { SYNC_STUCK_AFTER_MINUTES } from "@plainva/core";
import { syncStatusStore } from "../services/syncStatusStore";

const V = "/vault";
vi.mock("../contexts/VaultContext", () => ({ useVault: () => ({ syncWorker: { retryFailed() {} }, vaultPath: V }) }));
const { StatusBar } = await import("./StatusBar");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A cycle the watchdog gave up on (`stuck`): the status line says so — with
 * the watchdog's minutes, not a number in the language file — in place of
 * the retry time, and the notice goes once the next cycle runs.
 */
describe("the desktop status line of a stuck sync", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    syncStatusStore.resetAll();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("replaces the status line while the given-up step runs, and goes with the next cycle", async () => {
    act(() => syncStatusStore.set(V, { status: "retrying", message: "abandoned", reason: "stuck", retryAt: Date.now() + 60_000 }));
    act(() => root.render(<StatusBar />));
    const stuck = () => container.querySelector('[data-testid="sync-stuck"]')?.textContent ?? null;
    expect(stuck()).toBe(i18n.t("sync.stuck", { minutes: SYNC_STUCK_AFTER_MINUTES }));
    expect(container.textContent).not.toContain(i18n.t("sync.retrying"));

    act(() => syncStatusStore.set(V, { status: "syncing", message: null, reason: undefined }));
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(stuck(), "gone once the new cycle runs").toBeNull();

    act(() => syncStatusStore.set(V, { status: "retrying", message: "503", reason: undefined }));
    expect(stuck(), "an ordinary retry is no stuck sync").toBeNull();
  });
});
