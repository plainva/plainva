import type { ComponentType } from "react";
import { Bookmark, Sunrise, CalendarDays, Database, Hash, Home, Waypoints } from "lucide-react";

/**
 * Configurable bottom navigation (settings redesign 2026-07-18, P3): the bar
 * carries THREE free slots plus a fixed "More" tab; ＋ capture floats as a
 * FAB. The persisted `tabSlots` value is the FULL ordered pool — the bar
 * renders its first three entries, the More screen shows the whole order and
 * rearranges it with a drag handle. Every pool screen stays reachable through
 * "More" regardless of the arrangement.
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

/** Default order = pool order; the bar shows the first BAR_TAB_COUNT. */
export const DEFAULT_TAB_ORDER: TabScreenId[] = TAB_POOL.map((t) => t.id);
export const BAR_TAB_COUNT = 3;

const POOL_IDS = new Set<string>(TAB_POOL.map((t) => t.id));

/**
 * Normalizes a persisted order: unknown ids and duplicates drop, missing pool
 * ids are appended in pool order — the result ALWAYS carries the whole pool.
 * A legacy ≤4-slot value (pre-redesign `tabSlots`) therefore stays readable:
 * its entries lead, the rest follows, the bar shows the first three.
 */
export function sanitizeTabSlots(raw: unknown): TabScreenId[] {
  const out: TabScreenId[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (typeof v !== "string" || !POOL_IDS.has(v) || out.includes(v as TabScreenId)) continue;
      out.push(v as TabScreenId);
    }
  }
  for (const t of TAB_POOL) {
    if (!out.includes(t.id)) out.push(t.id);
  }
  return out;
}

/** The bar's free slots — the first three entries of the full order. */
export function barTabs(order: TabScreenId[]): TabScreenId[] {
  return order.slice(0, BAR_TAB_COUNT);
}

/**
 * Drag-handle reorder (More screen): moves `id` to `toIndex` within the full
 * order. Bar membership follows from POSITION (top three), never from a
 * separate selection — dragging into the top three promotes into the bar.
 */
export function moveTabId(order: TabScreenId[], id: TabScreenId, toIndex: number): TabScreenId[] {
  const from = order.indexOf(id);
  if (from < 0) return [...order];
  const next = order.filter((v) => v !== id);
  const clamped = Math.max(0, Math.min(next.length, toIndex));
  next.splice(clamped, 0, id);
  return next;
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
  | "settingsArea"
  | "vaults"
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

const GLOBAL_KINDS = new Set<NavKind>(["search", "more", "settings", "settingsArea", "vaults", "appearance", "sync", "vault"]);

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
