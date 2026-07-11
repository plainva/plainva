import type { ComponentType } from "react";
import { Bookmark, Calendar, CalendarDays, Database, FileText, Hash } from "lucide-react";

/**
 * Configurable bottom navigation (R2.2): the user picks up to four screens
 * for the tab bar (two left + two right of the fixed ＋). Every pool screen
 * stays reachable through the More menu regardless of the selection.
 */

export type TabScreenId = "notes" | "today" | "tags" | "bookmarks" | "calendar" | "databases";

export interface TabDef {
  id: TabScreenId;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  labelKey: string;
}

export const TAB_POOL: TabDef[] = [
  { id: "notes", icon: FileText, labelKey: "mobile.tabNotes" },
  { id: "today", icon: Calendar, labelKey: "mobile.tabToday" },
  { id: "tags", icon: Hash, labelKey: "mobile.tags" },
  { id: "bookmarks", icon: Bookmark, labelKey: "mobile.bookmarks" },
  { id: "calendar", icon: CalendarDays, labelKey: "mobile.tabCalendar" },
  { id: "databases", icon: Database, labelKey: "mobile.tabDatabases" },
];

export const DEFAULT_TAB_SLOTS: TabScreenId[] = ["notes", "today", "tags", "bookmarks"];
export const MAX_TAB_SLOTS = 4;

const POOL_IDS = new Set<string>(TAB_POOL.map((t) => t.id));

/**
 * Normalizes a persisted slot list: unknown ids and duplicates drop, at most
 * MAX_TAB_SLOTS survive, an empty result falls back to the default so the
 * bar never renders empty.
 */
export function sanitizeTabSlots(raw: unknown): TabScreenId[] {
  const out: TabScreenId[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (typeof v !== "string" || !POOL_IDS.has(v) || out.includes(v as TabScreenId)) continue;
      out.push(v as TabScreenId);
      if (out.length === MAX_TAB_SLOTS) break;
    }
  }
  return out.length > 0 ? out : [...DEFAULT_TAB_SLOTS];
}
