import {
  applyLinkStyle,
  readNoteLinkStyle,
  readWebLinkStyle,
  NOTE_LINK_STYLE_KEY,
  WEB_LINK_STYLE_KEY,
  type NoteLinkStyle,
  type WebLinkStyle,
} from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";
import { notifyAppearanceChanged } from "./appearanceSync";

/**
 * How links look on this device (Appearance -> Links, linkStyle.ts in
 * @plainva/ui). Persistence mirrors services/tagColors.ts: the Tauri store,
 * global, device-local; the phone keeps the same two keys in its settings.
 */
export async function getStoredLinkStyle(): Promise<{ note: NoteLinkStyle; web: WebLinkStyle }> {
  try {
    const store = await getSettingsStore();
    return {
      note: readNoteLinkStyle(await store.get<unknown>(NOTE_LINK_STYLE_KEY)),
      web: readWebLinkStyle(await store.get<unknown>(WEB_LINK_STYLE_KEY)),
    };
  } catch {
    return { note: readNoteLinkStyle(undefined), web: readWebLinkStyle(undefined) };
  }
}

export async function setStoredLinkStyle(note: NoteLinkStyle, web: WebLinkStyle): Promise<void> {
  const store = await getSettingsStore();
  await store.set(NOTE_LINK_STYLE_KEY, note);
  await store.set(WEB_LINK_STYLE_KEY, web);
  await store.save();
  applyLinkStyle(note, web);
  notifyAppearanceChanged();
}

/** Applies the stored choice once the store has answered (no default first: see initTagColors). */
export function initLinkStyle(): void {
  getStoredLinkStyle()
    .then(({ note, web }) => applyLinkStyle(note, web))
    .catch(() => {});
}
