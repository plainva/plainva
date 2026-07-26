import { getLatestWhatsNew, getPlatformServices, shouldShowWhatsNew } from "@plainva/ui";
import { App } from "@capacitor/app";

/**
 * Which release dialog the phone owes its user on this start (H5).
 *
 * The rule is the shared one; what differs is where the marker lives (the
 * mobile settings store) and how the version is read (the Capacitor app info
 * rather than the Tauri manifest).
 */

const SEEN_KEY = "whatsNewSeenVersionMobile";

export type ReleaseDialog = "none" | "firstRun" | "whatsNew";

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
 * `onboarded` is what tells a brand-new install from an updated one: the
 * onboarding screen has always set it, so anyone who has it is an existing
 * user and gets the highlights rather than the welcome.
 */
export async function pendingReleaseDialog(onboarded: boolean): Promise<ReleaseDialog> {
  try {
    const seen = (await (await store()).get<string>(SEEN_KEY)) ?? null;
    if (!shouldShowWhatsNew(seen, await mobileAppVersion())) return "none";
    return !seen && !onboarded ? "firstRun" : "whatsNew";
  } catch {
    return "none"; // an unreadable store must never block the app start
  }
}

export async function markReleaseDialogSeen(): Promise<void> {
  try {
    const s = await store();
    await s.set(SEEN_KEY, await mobileAppVersion());
    await s.save();
  } catch {
    // Worst case it shows once more next start — never a reason to fail.
  }
}
