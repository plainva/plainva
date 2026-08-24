/**
 * Desktop side of the release highlights.
 *
 * The catalog and the "has this been seen" rule are SHARED (H5): the phone
 * shows the same highlights, and a release that updates one must not leave the
 * other behind. What stays here is desktop-specific — where the marker lives
 * and how the running version is read.
 */
import { getSettingsStore } from './settingsStore';
import { getLatestWhatsNew } from '@plainva/ui';

export { WHATS_NEW_CATALOG, getLatestWhatsNew, shouldShowWhatsNew, type WhatsNewItem } from '@plainva/ui';

const SEEN_VERSION_KEY = 'whatsNewSeenVersion';

export async function readWhatsNewSeenVersion(): Promise<string | null> {
  try {
    const store = await getSettingsStore();
    const value = await store.get<string>(SEEN_VERSION_KEY);
    return value ?? null;
  } catch {
    return null;
  }
}

/**
 * The release dialogs are decided ONCE per app start.
 *
 * This lives here rather than in a component ref because `App` remounts
 * whenever the shown vault changes (stage D put it under a `VaultProvider`
 * keyed by that vault, so the null -> vault step of an ordinary start
 * remounts it too). A ref therefore means "once per mount", which brought the
 * dialog back on every vault switch. Returns true for the first caller of this
 * app start and false for every later one.
 */
let releaseDialogSlotTaken = false;
export function takeReleaseDialogSlot(): boolean {
  if (releaseDialogSlotTaken) return false;
  releaseDialogSlotTaken = true;
  return true;
}

/** Tests only: a fresh app start. */
export function resetReleaseDialogSlot(): void {
  releaseDialogSlotTaken = false;
}

export async function markWhatsNewSeen(version: string): Promise<void> {
  try {
    const store = await getSettingsStore();
    await store.set(SEEN_VERSION_KEY, version);
    await store.save();
  } catch {
    // A settings store that cannot be written should never block the UI —
    // worst case the dialog appears once more on the next start.
  }
}

/**
 * The welcome cannot open over an open vault — it belongs to a start without
 * one. "Show it again" therefore arms it for the next such start instead of
 * promising something the settings dialog cannot deliver from where it stands.
 */
const WELCOME_REQUESTED_KEY = 'welcomeRequested';

export async function requestWelcomeOnNextStart(): Promise<void> {
  try {
    const store = await getSettingsStore();
    await store.set(WELCOME_REQUESTED_KEY, true);
    await store.save();
  } catch {
    // Nothing to recover: the request is a convenience, not a guarantee.
  }
}

/** Reads the request AND clears it — the welcome is armed for exactly one start. */
export async function takeWelcomeRequest(): Promise<boolean> {
  try {
    const store = await getSettingsStore();
    if (!(await store.get<boolean>(WELCOME_REQUESTED_KEY))) return false;
    await store.delete(WELCOME_REQUESTED_KEY);
    await store.save();
    return true;
  } catch {
    return false;
  }
}

/** The running app version, from the Tauri manifest. */
export async function getAppVersion(): Promise<string> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    // Browser shell (dev server, E2E): fall back to the catalog so the dialog
    // logic stays exercisable outside the native build.
    return getLatestWhatsNew().version;
  }
}
