/**
 * Release highlights shown to existing users after an update.
 *
 * The highlight *texts* live in i18n (`whatsNew.highlightN`) so they exist in
 * all ten languages; this catalog only says which version they belong to and
 * how many there are. Both must be updated together at release time.
 */
import { getSettingsStore } from './settingsStore';

export interface WhatsNewItem {
  version: string;
  releaseDate: string;
  /** Number of `whatsNew.highlightN` keys this release ships. */
  highlightCount: number;
  blogUrl?: string;
}

export const WHATS_NEW_CATALOG: WhatsNewItem[] = [
  {
    version: '0.5.0',
    releaseDate: '2026-07-25',
    highlightCount: 5,
    blogUrl: 'https://plainva.com/blog/plainva-0-5-0',
  },
];

const SEEN_VERSION_KEY = 'whatsNewSeenVersion';

export function getLatestWhatsNew(): WhatsNewItem {
  return WHATS_NEW_CATALOG[0];
}

/**
 * True when this build's highlights have not been acknowledged yet.
 *
 * A missing marker means the user has never seen the dialog. Whether that
 * makes them a *new* user (first run) or someone upgrading from before the
 * marker existed is decided by the caller, which also looks at recent vaults.
 */
export function shouldShowWhatsNew(seenVersion: string | null | undefined, currentVersion: string): boolean {
  if (!seenVersion) return true;
  return seenVersion !== currentVersion;
}

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
