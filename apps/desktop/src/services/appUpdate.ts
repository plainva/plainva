import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getSettingsStore } from "./settingsStore";
import { toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * The app-update service (P3.8): ALL updater-plugin access lives here — the
 * silent startup check below and the check/download/install operations the
 * settings "Updates" section drives. The settings keep only UI state.
 */

export type UpdateCheckResult =
  | { status: "available"; update: Update }
  | { status: "none" }
  /** The releases feed does not exist yet (pre-launch) — not an error. */
  | { status: "no-release" }
  | { status: "error"; error: string };

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  try {
    const update = await check();
    return update ? { status: "available", update } : { status: "none" };
  } catch (e) {
    const error = String(e);
    if (error.includes("Could not fetch a valid release JSON")) return { status: "no-release" };
    return { status: "error", error };
  }
}

/** Downloads, installs and relaunches. Rejects on failure — caller shows it. */
export async function downloadAndInstallUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}

export const AUTO_UPDATE_CHECK_KEY = "autoUpdateCheck";

export async function getAutoUpdateCheck(): Promise<boolean> {
  try {
    const store = await getSettingsStore();
    return (await store.get<boolean>(AUTO_UPDATE_CHECK_KEY)) ?? true;
  } catch {
    return true;
  }
}

export async function setAutoUpdateCheck(value: boolean): Promise<void> {
  const store = await getSettingsStore();
  await store.set(AUTO_UPDATE_CHECK_KEY, value);
  await store.save();
}

// Silent startup check: one quiet probe ~10 s after start, one toast if an
// update exists; every failure (no feed yet, offline, dev build) stays silent
// by design — a startup check must never nag.
const STARTUP_DELAY_MS = 10_000;
let scheduled = false;

export function scheduleStartupUpdateCheck(): void {
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(() => {
    void (async () => {
      try {
        if (!(await getAutoUpdateCheck())) return;
        const result = await checkForAppUpdate();
        if (result.status === "available") {
          const update = result.update;
          // Clickable toast (maintainer): the action installs the update directly.
          toast.info(i18n.t("settings.updateAvailable", { version: update.version }), {
            label: i18n.t("settings.installUpdate"),
            run: () => {
              toast.info(i18n.t("settings.installingUpdate"));
              void downloadAndInstallUpdate(update).catch((e) => {
                toast.error(i18n.t("settings.updateInstallError", { error: String(e) }));
              });
            },
          });
        }
      } catch {
        // Silent by design.
      }
    })();
  }, STARTUP_DELAY_MS);
}

/** Test hook. */
export function resetStartupUpdateCheckForTests(): void {
  scheduled = false;
}
