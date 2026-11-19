/** The domain of the app-wide `settings-changed` channel that carries it. */
const DOMAIN = "vault-features";
/** The window event that has every reader of a vault's features read them again. */
export const FEATURES_SAVED_EVENT = "plainva-features-saved";

/**
 * Tells every other window that a vault's features were saved (F8 of release
 * 0.9.0). The settings are written in one window; another full window on the
 * same vault reads them only when told — before, it kept the daily-note
 * naming it had opened with, so its task lists, Tasks queries and databases
 * named other days than the window beside it.
 *
 * Fire-and-forget: a window without a bus (browser tests) has nobody to tell.
 */
export function announceVaultFeaturesSaved(vaultPath: string): void {
  // Loaded on use: the settings import calls this, and must not load the bus with it.
  void import("./windowBus")
    .then(({ getWindowBus }) => getWindowBus())
    .then((bus) => bus.broadcast("settings-changed", { domain: DOMAIN }, vaultPath))
    .catch(() => {
      /* no other window to tell */
    });
}

/**
 * Tells this window and every other one that a vault's features were saved:
 * the save of a single setting outside the settings dialog, which batches its
 * own. Here the event names the vault, as one carried from another window
 * does, so a reader of another vault passes over it (`featuresSavedFor`).
 */
export function vaultFeaturesSaved(vaultPath: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(FEATURES_SAVED_EVENT, { detail: { vaultPath } }));
  announceVaultFeaturesSaved(vaultPath);
}

/**
 * Installed once per window: a save in another window reads as one here. The
 * bus never hands a window its own broadcast, and nothing here sends one, so
 * two windows cannot bounce it. Every reader re-reads its own vault's
 * settings, so a save for another vault changes nothing.
 */
export async function installVaultFeaturesRelay(): Promise<void> {
  const { getWindowBus } = await import("./windowBus");
  const bus = await getWindowBus();
  await bus.onBroadcast("settings-changed", (payload, _from, vaultPath) => {
    if (payload.domain !== DOMAIN) return;
    window.dispatchEvent(new CustomEvent(FEATURES_SAVED_EVENT, { detail: { vaultPath } }));
  });
}

/**
 * Whether a `FEATURES_SAVED_EVENT` is about `vaultPath`: saved in this window
 * it names no vault (the settings here are this window's vault), carried from
 * another window by `installVaultFeaturesRelay` it names the vault saved.
 */
export function featuresSavedFor(event: Event, vaultPath: string): boolean {
  const savedFor = (event as CustomEvent<{ vaultPath?: string } | undefined>).detail?.vaultPath;
  return savedFor === undefined || savedFor === vaultPath;
}
