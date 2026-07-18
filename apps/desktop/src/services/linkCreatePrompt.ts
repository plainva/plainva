import { getSettingsStore } from "./settingsStore";

/**
 * "Ask before creating a note from an unresolved wiki link" (maintainer
 * 2026-07-18). Default off = Obsidian behavior: clicking a link to a
 * not-yet-created note creates it immediately. When on, the create is
 * confirmed first. Global setting (Settings → App → Editor & Notes), read
 * on-demand in the click handler — no sync cache needed.
 */
const KEY = "askBeforeCreateLink";

export async function getAskBeforeCreateLink(): Promise<boolean> {
  try {
    const store = await getSettingsStore();
    return (await store.get<boolean>(KEY)) === true;
  } catch {
    return false;
  }
}

export async function setAskBeforeCreateLink(value: boolean): Promise<void> {
  const store = await getSettingsStore();
  await store.set(KEY, value);
  await store.save();
}
