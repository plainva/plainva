import { getLatestWhatsNew, getPlatformServices, shouldShowWhatsNew } from "@plainva/ui";
import { App } from "@capacitor/app";

/**
 * Which release dialog the phone owes its user on this start (H5).
 *
 * The rule is the shared one; what differs is where the marker lives (the
 * mobile settings store). The marker identifies the shared release catalog:
 * TestFlight can keep the same marketing version across several releases.
 */

const LEGACY_SEEN_KEY = "whatsNewSeenVersionMobile";
const SEEN_KEY = "whatsNewSeenReleaseMobile";

export type ReleaseDialog = "none" | "whatsNew";

async function store() {
  return getPlatformServices().loadSettings();
}

/** The running app version; falls back to the catalog on the web dev server. */
export async function mobileAppVersion(): Promise<string> {
  try {
    return (await App.getInfo()).version;
  } catch {
    return getLatestWhatsNew().version;
  }
}

/**
 * Whether this start owes the user the release highlights.
 *
 * A fresh install gets NOTHING here — the onboarding screen is this platform's
 * welcome, and it marks the highlights as seen when it finishes (BS5). Before,
 * both existed: a `firstRun` branch of the sheet that could only appear right
 * after the onboarding, so a new user was welcomed twice in a row.
 *
 * `onboarded` is what tells the two apart: the onboarding screen has always set
 * it, so someone who has it but no marker is upgrading from a build before the
 * marker existed and gets the highlights.
 */
export async function pendingReleaseDialog(onboarded: boolean): Promise<ReleaseDialog> {
  try {
    const s = await store();
    const current = getLatestWhatsNew().version;
    const releaseSeen = await s.get<string>(SEEN_KEY);
    const seen = releaseSeen ?? (await s.get<string>(LEGACY_SEEN_KEY)) ?? null;
    if (!seen && !onboarded) return "none"; // fresh install — the onboarding welcomes
    if (!shouldShowWhatsNew(seen, current)) {
      if (!releaseSeen) {
        // Android's old X.Y.Z(.N) marker maps to the catalog without repeating
        // its highlights. An old iOS marker such as 1.0 is ambiguous: show the
        // current catalog once, then persist its identity on acknowledgement.
        await s.set(SEEN_KEY, current);
        await s.save();
      }
      return "none";
    }
    return "whatsNew";
  } catch {
    return "none"; // an unreadable store must never block the app start
  }
}

/**
 * Forget that the highlights were seen, so the next start shows them again
 * (settings → start & behaviour, S39).
 *
 * Clearing the marker rather than storing an older version keeps the rule in
 * one place: `pendingReleaseDialog` decides what an absent marker means.
 */
export async function resetMobileWhatsNew(): Promise<void> {
  const s = await store();
  await s.delete(SEEN_KEY);
  await s.delete(LEGACY_SEEN_KEY);
  await s.save();
}

export async function markReleaseDialogSeen(): Promise<void> {
  try {
    const s = await store();
    await s.set(SEEN_KEY, getLatestWhatsNew().version);
    await s.save();
  } catch {
    // Worst case it shows once more next start — never a reason to fail.
  }
}
