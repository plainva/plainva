import type { ComponentType } from "react";
import { Bookmark, Sunrise, CalendarDays, Database, Hash, Home, Waypoints } from "lucide-react";

/**
 * Configurable bottom navigation (R2.2): the user picks up to four screens
 * for the tab bar (two left + two right of the fixed ＋). Every pool screen
 * stays reachable through the More menu regardless of the selection.
 */

export type TabScreenId = "notes" | "today" | "tags" | "bookmarks" | "calendar" | "databases" | "graph";

export interface TabDef {
  id: TabScreenId;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  labelKey: string;
}

export const TAB_POOL: TabDef[] = [
  { id: "notes", icon: Home, labelKey: "mobile.tabHome" },
  { id: "today", icon: Sunrise, labelKey: "mobile.tabToday" },
  { id: "tags", icon: Hash, labelKey: "mobile.tags" },
  { id: "bookmarks", icon: Bookmark, labelKey: "mobile.bookmarks" },
  { id: "calendar", icon: CalendarDays, labelKey: "mobile.tabCalendar" },
  { id: "databases", icon: Database, labelKey: "mobile.tabDatabases" },
  { id: "graph", icon: Waypoints, labelKey: "rightPanel.graph" },
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

/*
 * Navigation state (R3.1): tab stacks plus ONE overlay stack that floats
 * above every tab. App-wide screens (search, More, settings, vault forms)
 * are overlay entries — they are not tab content, so returning to a tab can
 * never surface a stale settings push again, and any tab tap dismisses them
 * (maintainer finding 2026-07-11: "tapping the bottom bar in settings does
 * not switch"). Content opened FROM an overlay (a search hit, a screen from
 * the More menu) stays in the overlay so back returns to where it came from.
 */

export type NavKind =
  | "folder"
  | "note"
  | "base"
  | "today"
  | "calendar"
  | "databases"
  | "graphmap"
  | "tags"
  | "bookmarks"
  | "search"
  | "more"
  | "settings"
  | "appearance"
  | "sync"
  | "vault";

export interface NavEntry {
  kind: NavKind;
  path: string;
  /** Fresh .base entries open with the configure sheet up (E3 mini wizard). */
  configOpen?: boolean;
  /**
   * "sync" entries only (2026-07-13): opens the connect screen in CREATE mode
   * carrying the pre-picked structure template id ("" = empty vault); absent =
   * plain "connect existing vault".
   */
  createTemplateId?: string;
}

const GLOBAL_KINDS = new Set<NavKind>(["search", "more", "settings", "appearance", "sync", "vault"]);

export const isGlobalKind = (kind: NavKind): boolean => GLOBAL_KINDS.has(kind);

export interface NavState {
  activeTab: TabScreenId;
  stacks: Record<TabScreenId, NavEntry[]>;
  overlay: NavEntry[];
}

export const emptyStacks = (): Record<TabScreenId, NavEntry[]> => ({
  notes: [],
  today: [],
  tags: [],
  bookmarks: [],
  calendar: [],
  databases: [],
  graph: [],
});

export function initialNavState(activeTab: TabScreenId): NavState {
  return { activeTab, stacks: emptyStacks(), overlay: [] };
}

/** Topmost visible entry: the overlay wins over the active tab's stack. */
export function navTop(state: NavState): NavEntry | undefined {
  if (state.overlay.length > 0) return state.overlay[state.overlay.length - 1];
  const stack = state.stacks[state.activeTab];
  return stack[stack.length - 1];
}

/**
 * Push a screen. Global kinds always go to the overlay; content pushed while
 * an overlay is open stays in the overlay (back returns to the search/More
 * screen it came from); plain content goes to the active tab's stack.
 */
export function pushEntry(state: NavState, entry: NavEntry): NavState {
  if (isGlobalKind(entry.kind) || state.overlay.length > 0) {
    return { ...state, overlay: [...state.overlay, entry] };
  }
  return {
    ...state,
    stacks: {
      ...state.stacks,
      [state.activeTab]: [...state.stacks[state.activeTab], entry],
    },
  };
}

/** Pop the topmost entry (overlay before the active tab's stack). */
export function popTop(state: NavState): NavState {
  if (state.overlay.length > 0) return { ...state, overlay: state.overlay.slice(0, -1) };
  const stack = state.stacks[state.activeTab];
  if (stack.length === 0) return state;
  return {
    ...state,
    stacks: { ...state.stacks, [state.activeTab]: stack.slice(0, -1) },
  };
}

/**
 * Bottom-bar tap: always dismisses the overlay; tapping the ACTIVE tab pops
 * its stack back to the root (platform convention), tapping another tab
 * switches while keeping that tab's own stack.
 */
export function tapTab(state: NavState, id: TabScreenId): NavState {
  if (id === state.activeTab) {
    return { ...state, overlay: [], stacks: { ...state.stacks, [id]: [] } };
  }
  return { ...state, overlay: [], activeTab: id };
}

/** Android back: overlay first, then the tab stack, else minimize the app. */
export function backStep(state: NavState): { next: NavState; minimize: boolean } {
  if (state.overlay.length > 0 || state.stacks[state.activeTab].length > 0) {
    return { next: popTop(state), minimize: false };
  }
  return { next: state, minimize: true };
}

/**
 * ＋ capture: with an overlay open the note opens on top of it (back returns
 * there); otherwise it lands in the notes tab when the bar carries one, else
 * in the active tab.
 */
export function pushCapturedNote(
  state: NavState,
  slots: TabScreenId[],
  path: string,
): NavState {
  const entry: NavEntry = { kind: "note", path };
  if (state.overlay.length > 0) return pushEntry(state, entry);
  const tab = slots.includes("notes") ? "notes" : state.activeTab;
  return pushEntry({ ...state, activeTab: tab }, entry);
}
