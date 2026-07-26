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
