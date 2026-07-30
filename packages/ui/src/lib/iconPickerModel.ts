/**
 * What the emoji/icon picker remembers and how its tabs are labelled — shared,
 * because the two shells drifted apart in exactly these details (report
 * 2026-07-29, F10-F13): the desktop had recents for emoji but not for icons and
 * no icon categories at all; the phone had neither, and no colour.
 *
 * Recents live in `localStorage` (present in the Tauri WebView and in the mobile
 * WebView alike) under GLOBAL keys — an icon you reach for often is a habit of
 * yours, not a property of one vault, so "forget this vault" deliberately leaves
 * them alone.
 */

import type { LucideIconCategory } from "../components/lucideIconData";

export const RECENT_EMOJI_KEY = "plainva-recent-emoji";
export const RECENT_ICON_KEY = "plainva-recent-icons";
export const MAX_RECENT = 24;

/** Reads a recents list; anything unreadable is simply "no recents yet". */
export function loadRecentPicks(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Most recent first, no duplicates, capped. Returns the new list. */
export function saveRecentPick(key: string, value: string, current: string[]): string[] {
  const next = [value, ...current.filter((v) => v !== value)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // localStorage unavailable — recents just won't persist this session.
  }
  return next;
}

/**
 * The glyph a category tab shows: a lucide name from that very category, so the
 * tab bar is made of the same material as the grid below it. The i18n key of the
 * label sits next to it, so a caller cannot pair the wrong two.
 */
export const LUCIDE_CATEGORY_TABS: {
  id: LucideIconCategory;
  /** lucide id (without the `lucide:` prefix) */
  glyph: string;
  labelKey: string;
}[] = [
  { id: "knowledge", glyph: "book-open", labelKey: "emojiPicker.iconCategories.knowledge" },
  { id: "work", glyph: "list-checks", labelKey: "emojiPicker.iconCategories.work" },
  { id: "tech", glyph: "code", labelKey: "emojiPicker.iconCategories.tech" },
  { id: "people", glyph: "users", labelKey: "emojiPicker.iconCategories.people" },
  { id: "media", glyph: "palette", labelKey: "emojiPicker.iconCategories.media" },
  { id: "life", glyph: "house", labelKey: "emojiPicker.iconCategories.life" },
  { id: "nature", glyph: "leaf", labelKey: "emojiPicker.iconCategories.nature" },
  { id: "travel", glyph: "plane", labelKey: "emojiPicker.iconCategories.travel" },
  { id: "finance", glyph: "wallet", labelKey: "emojiPicker.iconCategories.finance" },
  { id: "symbols", glyph: "circle-check", labelKey: "emojiPicker.iconCategories.symbols" },
];
