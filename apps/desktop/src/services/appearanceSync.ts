import { getWindowBus } from "./windowBus";

/**
 * Keeping every window's look in step (multi-window P0).
 *
 * Theme, density, content font and UI zoom live in the settings store, and a
 * store write in the central window does not reach a second webview by itself.
 * Without this, an auxiliary window would keep the theme it was born with until
 * it is closed — the one thing a user would notice instantly.
 *
 * The broadcast sits on the SETTERS, never on the appliers: an applier also
 * runs when a window reacts to a broadcast, and two auxiliary windows would
 * then bounce the same change back and forth forever. A setter runs only where
 * somebody actually changed a setting, which today is the central window.
 *
 * Fire-and-forget on purpose: an appearance change must never fail because a
 * window bus is unavailable (browser tests, a single-window session before the
 * Tauri API is reachable).
 */
export function notifyAppearanceChanged(): void {
  void getWindowBus()
    // One appearance for the process, so this message belongs to no vault.
    .then((bus) => bus.broadcast("settings-changed", { domain: "appearance" }, null))
    .catch(() => {
      /* no bus (browser/test) — the local apply already happened */
    });
}

/**
 * Re-reads the appearance settings when another window reports a change.
 * Installed once per auxiliary window; the listener lives as long as the window.
 */
export async function installAppearanceSync(): Promise<void> {
  const bus = await getWindowBus();
  await bus.onBroadcast("settings-changed", (payload) => {
    if (payload.domain !== "appearance") return;
    void Promise.all([
      import("./theme").then(({ applyStoredTheme }) => applyStoredTheme()),
      import("./density").then(({ initDensity }) => initDensity()),
      import("./contentFont").then(({ initContentFont }) => initContentFont()),
      import("./uiZoom").then(({ initUiZoom }) => initUiZoom()),
    ]).catch((e) => console.warn("[appearanceSync] could not re-apply appearance", e));
  });
}
