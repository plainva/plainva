import i18n from "i18next";
import { toast } from "../services/toastStore";
import { PROFILE_FIELDS } from "./profileFields";

/**
 * Whether a setting that names a folder or a file in the vault may hold this
 * value (open-items plan 3.127 no. 4): a path inside the vault, written with
 * `/` between folders, without `..` or `.`, not absolute, and not into the
 * app's own folder `.plainva`. The empty value is "unset" and always allowed.
 *
 * One rule for both shells and for both ways a value arrives — typed in or
 * picked in the settings, or carried over in a settings profile from another
 * device. Before, only the desktop's profile import asked it; typed in by
 * hand the desktop took a folder under `.plainva`, and the phone's import
 * refused only a leading `/`. Notes there are not indexed, not synced and get
 * no versions, and the app treats them as files of its own.
 *
 * Values stored before the rule are read as they are; only new ones are asked.
 */
export function isVaultPathSetting(value: string): boolean {
  if (value === "") return true;
  if (value.length > 1024 || value.includes("\0") || value.includes("\\")) return false;
  if (/^(?:[a-z]+:|\/|[A-Za-z]:)/.test(value)) return false;
  const parts = value.split("/");
  return !parts.some((part) => part === ".." || part === ".") && parts[0] !== ".plainva";
}

/**
 * For every place a person sets such a path — a field, a folder picked in the
 * browser: says why a value is refused, and answers true when it is.
 */
export function refuseVaultPathSetting(value: string): boolean {
  if (isVaultPathSetting(value)) return false;
  toast.error(i18n.t("settings.vaultPathRefused", { path: value }));
  return true;
}

/** The logical names of the settings that name a folder or a file in the vault (profile catalog, kind `vaultPath`). */
export const VAULT_PATH_SETTINGS: ReadonlySet<string> = new Set(
  PROFILE_FIELDS.filter((field) => field.kind === "vaultPath").map((field) => field.logical),
);

/** The phone's settings keys for those fields (`dailyFolder`, `templateFolder`, …). */
export const VAULT_PATH_SETTINGS_MOBILE: ReadonlySet<string> = new Set(
  PROFILE_FIELDS.filter((field) => field.kind === "vaultPath" && typeof field.mobile === "string" && field.mobile !== "own").map(
    (field) => field.mobile as string,
  ),
);

/**
 * The fields of a settings patch that name a vault path the rule refuses,
 * by the keys the patch uses (`keyIsPath` says which keys are such fields).
 */
export function refusedVaultPaths(patch: Record<string, unknown>, keyIsPath: (key: string) => boolean): string[] {
  return Object.entries(patch)
    .filter(([key, value]) => keyIsPath(key) && typeof value === "string" && !isVaultPathSetting(value))
    .map(([key]) => key);
}
