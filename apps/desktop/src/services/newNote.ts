import { getSettingsStore } from "./settingsStore";
import {
  defaultNoteTypeKey,
  dailyNoteTypeKey,
  DEFAULT_NOTE_TYPE,
  DEFAULT_DAILY_NOTE_TYPE,
} from "../contexts/VaultContext";

/**
 * OKF write path for files Plainva creates (Masterplan §9.2, owner decision):
 * every new .md file carries at least `type` + `okf_version`. Existing
 * frontmatter (e.g. from a template) wins — only missing pieces are added.
 */

/** Per-vault configured default `type` for new notes (fallback "Note"). */
export async function getConfiguredNoteType(vaultPath: string): Promise<string> {
  const store = await getSettingsStore();
  const value = await store.get<string>(defaultNoteTypeKey(vaultPath));
  return value?.trim() || DEFAULT_NOTE_TYPE;
}

/** Per-vault configured default `type` for daily notes (fallback "Daily Note"). */
export async function getConfiguredDailyNoteType(vaultPath: string): Promise<string> {
  const store = await getSettingsStore();
  const value = await store.get<string>(dailyNoteTypeKey(vaultPath));
  return value?.trim() || DEFAULT_DAILY_NOTE_TYPE;
}

// The two content builders below moved to @plainva/ui (feinplan G0.1) so the
// shared mail code can build notes; re-exported here so every existing import
// path keeps working.
export { withOkfDefaults, buildNewNoteContent } from "@plainva/ui";
