import { applyTagColors } from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";
import { notifyAppearanceChanged } from "./appearanceSync";

/**
 * "Colour tags" (finding 2026-09-19): every tag surface carries the colour slot
 * of its root tag, and this device switch decides whether the slot paints. Off
 * by default - a note that was calm stays calm until somebody asks for colour.
 * Nothing about a tag is stored; the colour follows from its name. Persistence
 * mirrors services/density.ts (Tauri store, global, device-local).
 */
export const DEFAULT_TAG_COLORS = false;

export async function getStoredTagColors(): Promise<boolean> {
  try {
    const store = await getSettingsStore();
    return (await store.get<boolean>("tagColors")) === true;
  } catch {
    return DEFAULT_TAG_COLORS;
  }
}

export async function setStoredTagColors(on: boolean): Promise<void> {
  const store = await getSettingsStore();
  await store.set("tagColors", on);
  await store.save();
  applyTagColors(on);
  notifyAppearanceChanged();
}

/** Applies the default immediately (avoids a flash), then the stored value. */
export function initTagColors(): void {
  applyTagColors(DEFAULT_TAG_COLORS);
  getStoredTagColors()
    .then((on) => applyTagColors(on))
    .catch(() => {});
}
