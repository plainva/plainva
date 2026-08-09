import { disable as autostartDisable, enable as autostartEnable, isEnabled as autostartIsEnabled } from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";
import i18n from "@plainva/ui/i18n";

/**
 * Running in the background (S11c).
 *
 * Two separate wishes, two separate switches, both off by default: starting
 * with the system, and staying alive in the tray when the window is closed.
 * They extend the runtime that desktop reminders need (S11b) and change nothing
 * about how those reminders are planned — one code path, more opportunity.
 *
 * The tray switch is the one that can strand a person: hide the window with
 * nothing to bring it back, and the app is a process they can only end in a
 * task manager. The plan wanted the switch unlocked once `TrayIconBuilder`
 * succeeded — measurement says that is not proof on Linux, where the icon
 * registers over D-Bus whether or not anything renders it. So the proof is the
 * person's own eyes: the icon goes up, they are asked whether they can see it,
 * and only a yes keeps the setting.
 */

/** Global, not per vault: one app, one process, one tray icon. */
export const RUN_IN_TRAY_KEY = "runInTray";
/** Whether the one-time offer has been made, so it is made once and not again. */
export const BACKGROUND_OFFERED_KEY = "backgroundOffered";

/** Turns the tray icon on with a localized menu. Throws what the platform says. */
export async function enableTray(): Promise<void> {
  await invoke("tray_enable", {
    openLabel: i18n.t("background.trayOpen"),
    nextLabel: i18n.t("background.trayNoNext"),
    quitLabel: i18n.t("background.trayQuit"),
  });
}

export async function disableTray(): Promise<void> {
  await invoke("tray_disable");
}

/** Updates the tray's "next appointment" line. Silent when no tray is up. */
export async function setTrayNext(text: string): Promise<void> {
  try {
    await invoke("tray_set_next", { text });
  } catch {
    /* No tray, nothing to say — not an error worth a toast. */
  }
}

export interface AutostartPort {
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  isEnabled: () => Promise<boolean>;
}

const platformAutostart: AutostartPort = {
  enable: autostartEnable,
  disable: autostartDisable,
  isEnabled: autostartIsEnabled,
};

/**
 * Brings the system's autostart registration in line with the wish.
 *
 * Reads the platform's own state first: the registry entry, LaunchAgent or
 * .desktop file can be removed from outside Plainva, and writing blindly would
 * either duplicate it or report a state that is not true.
 */
export async function applyAutostart(wanted: boolean, port: AutostartPort = platformAutostart): Promise<boolean> {
  const current = await port.isEnabled();
  if (current === wanted) return wanted;
  if (wanted) await port.enable();
  else await port.disable();
  return wanted;
}

export interface TrayPort {
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  /** Asks the person whether the icon actually appeared. */
  confirmVisible: () => Promise<boolean>;
}

export type TrayOutcome =
  | { on: true }
  /** The platform refused to build the icon at all. */
  | { on: false; reason: "failed"; error: string }
  /** It was built, but nobody could see it — the case a build-succeeded gate
   * would have missed entirely. */
  | { on: false; reason: "invisible" };

/**
 * Switches the tray on, then proves it.
 *
 * The icon is built FIRST and taken down again unless the person confirms they
 * can see it. Both failure paths end with no icon and the setting off, so the
 * window's close handler keeps quitting — there is no state in which the window
 * can vanish with no way back.
 */
export async function turnTrayOn(port: TrayPort): Promise<TrayOutcome> {
  try {
    await port.enable();
  } catch (e) {
    return { on: false, reason: "failed", error: e instanceof Error ? e.message : String(e) };
  }
  if (await port.confirmVisible()) return { on: true };
  await port.disable().catch(() => {});
  return { on: false, reason: "invisible" };
}
