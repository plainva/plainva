import { getMobileSettings, updateMobileSettings } from "./mobileSettings";

/**
 * Which navigator tab a vault last showed (S9).
 *
 * The desktop remembers its left tab per vault, and for the same reason: a
 * vault organised in folders and one organised in tags are different places to
 * come back to. Component state would forget the choice the moment a note is
 * opened, because opening one unmounts the navigator.
 *
 * Deliberately NOT synced (it lives in the per-vault slice the settings
 * profile does not carry): this is where THIS phone was, not a setting.
 */

export type NavigatorTab = "files" | "tags" | "databases";

const TABS: readonly NavigatorTab[] = ["files", "tags", "databases"];

/** A stored value that is no longer a tab falls back to the file tree. */
export function asNavigatorTab(raw: unknown): NavigatorTab {
  return typeof raw === "string" && (TABS as readonly string[]).includes(raw) ? (raw as NavigatorTab) : "files";
}

/** The remembered tab. No vault argument: the settings ARE vault-scoped, and a
 *  parameter the function ignores would only look like it meant something. */
export function getNavigatorTab(): NavigatorTab {
  return asNavigatorTab(getMobileSettings().navigatorTab);
}

export function setNavigatorTab(tab: NavigatorTab): void {
  void updateMobileSettings({ navigatorTab: tab });
}
