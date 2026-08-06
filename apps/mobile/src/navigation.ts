import type { ComponentType } from "react";
import {CalendarDays, Home, ListChecks, Mail, Sun, Waypoints} from "lucide-react";

/**
 * Configurable bottom navigation. The persisted `tabSlots` value is the FULL
 * ordered pool; the bar renders its first `barTabCount` entries.
 *
 * Since 2026-07-25 (plan P5) there is NO fixed "More" tab: the bar carries
 * 3 to 5 areas and nothing else — exactly the Material range for a bottom
 * navigation, which is also why the labels can stay. The areas outside the bar
 * are reached through the AREAS sheet, opened from the app-bar title ("Home ▾")
 * or by long-pressing the bar (E10). Arranging moved out of the More screen
 * into Settings → Navigation bar.
 */

/**
 * The bar's pool — WORK surfaces only (redesign P2 / S9).
 *
 * Tags, bookmarks and databases used to be here. They answer "what do I have",
 * not "what am I working on", and they are tabs and pinned sections of the
 * DESKTOP's left sidebar; on the phone they now live in the navigator, which
 * is the same sidebar folded into one root surface. Removing them also ends an
 * inconsistency: the same entry behaved differently depending on whether its
 * area happened to be in the bar (in it → tab switch; outside → an overlay
 * push with NO tab lit). Stored orders self-heal — `sanitizeTabSlots` drops
 * ids the pool no longer knows (E3: no migration notice, there are no users
 * but the maintainer).
 */
export type TabScreenId = "notes" | "today" | "calendar" | "mail" | "tasks" | "graph";

export interface TabDef {
  id: TabScreenId;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  labelKey: string;
  /**
   * Shorter label for the navigation bar, where five destinations leave ~75 px
   * per tab (E7: long names are SHORTENED, never dropped). Only set where the
   * full name does not fit; everywhere else — areas sheet, settings — the full
   * `labelKey` is used.
   */
  barLabelKey?: string;
}

export const TAB_POOL: TabDef[] = [
  { id: "notes", icon: Home, labelKey: "mobile.tabHome" },
  { id: "today", icon: Sun, labelKey: "mobile.tabToday" },
  { id: "tasks", icon: ListChecks, labelKey: "tasks.title" },
  { id: "calendar", icon: CalendarDays, labelKey: "mobile.tabCalendar" },
  { id: "mail", icon: Mail, labelKey: "mail.title" },
  { id: "graph", icon: Waypoints, labelKey: "rightPanel.graph" },
];

/**
 * The bar's arrangement lives in the SHARED bar model (S10) — see
 * `services/mobileBar.ts` and `barLayout`'s `mobileBar` definition. This file
 * kept its own copy of the same idea (a full order plus a count, with its own
 * bounds and its own sanitizer); two models for one thing is how the phone
 * ended up unarrangeable from the desktop and out of the settings profile.
 *
 * What stays here is what the bar model does not know: the icon and the label
 * of each area, and the navigation state built on top.
 */

/*
 * Navigation state (R3.1): tab stacks plus ONE overlay stack that floats
 * above every tab. App-wide screens (search, More, settings, vault forms)
 * are overlay entries — they are not tab content, so returning to a tab can
 * never surface a stale settings push again, and any tab tap dismisses them
 * (maintainer finding 2026-07-11: "tapping the bottom bar in settings does
 * not switch"). Content opened FROM an overlay (a search hit, a screen from
 * the More menu) stays in the overlay so back returns to where it came from.
 */

/** Every kind the navigation can hold, as VALUES — the route table is checked
 *  against this list at runtime (S8), and a `satisfies` keeps the two in step:
 *  adding a kind to the union without adding it here does not compile. */
export const NAV_KINDS = [
  "folder", "note", "base", "today", "pimcalendar", "mail", "mailmsg", "mailcompose",
  "mailaccounts", "pimaccounts", "tasks", "databases", "graphmap", "cleanup", "tags", "bookmarks",
  "search", "more", "areas", "settings", "settingsArea", "vaults", "appearance",
  "cloudaccounts", "cloudaccount", "cloudconnect", "sync", "vault", "securitywizard",
  "importwizard", "imageviewer",
] as const;

export type NavKind =
  | "folder"
  | "note"
  | "base"
  | "today"
  | "pimcalendar"
  | "mail"
  | "mailmsg"
  | "mailcompose"
  | "mailaccounts"
  | "pimaccounts"
  | "tasks"
  | "databases"
  | "graphmap"
  | "cleanup"
  | "tags"
  | "bookmarks"
  | "search"
  | "more"
  | "areas"
  | "settings"
  | "settingsArea"
  | "vaults"
  | "appearance"
  | "cloudaccounts"
  | "cloudaccount"
  | "cloudconnect"
  | "sync"
  | "vault"
  | "securitywizard"
  | "importwizard"
  | "imageviewer";

/** The list above must name exactly the union — in both directions. */
const _navKindsCoverUnion = NAV_KINDS satisfies readonly NavKind[];
type _UnionCoveredByList = Exclude<NavKind, (typeof NAV_KINDS)[number]> extends never ? true : never;
const _unionCovered: _UnionCoveredByList = true;
void _navKindsCoverUnion;
void _unionCovered;

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

const GLOBAL_KINDS = new Set<NavKind>(["search", "more", "areas", "settings", "settingsArea", "vaults", "appearance", "cloudaccounts", "cloudaccount", "cloudconnect", "sync", "vault"]);

export const isGlobalKind = (kind: NavKind): boolean => GLOBAL_KINDS.has(kind);

export interface NavState {
  activeTab: TabScreenId;
  stacks: Record<TabScreenId, NavEntry[]>;
  overlay: NavEntry[];
}

export const emptyStacks = (): Record<TabScreenId, NavEntry[]> => ({
  notes: [],
  today: [],
  tasks: [],
  calendar: [],
  mail: [],
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

/** Current browse target, including a folder reached through the More overlay. */
export function activeFolderPath(state: NavState): string {
  const top = navTop(state);
  return top?.kind === "folder" ? top.path : "";
}

/**
 * Capture stays available at a tab root and in every nested folder.
 *
 * Except in Mail: there the main action is "write a message", and that FAB is
 * the screen's own. Two stacked FABs mean a surface has no main action at all
 * (device report B2, 2026-07-26) — hence the tab id, not just the top entry:
 * a tab ROOT has no entry to look at.
 */
export function showsCaptureFab(top?: NavEntry, activeTab?: TabScreenId): boolean {
  if (!top) return activeTab !== "mail";
  if (top.kind === "mail") return false;
  return top.kind === "folder";
}

/**
 * Surfaces whose whole point is an unfinished input. The navigation bar is
 * hidden there, because a tap on it drops the overlay stack (`tapTab`) and the
 * half-written message, the credentials or the passphrase go with it — without
 * a question. The note editor was the only surface that already knew this.
 *
 * Hiding the bar is half the answer; the other half is the leave guard, which
 * asks before a surface with unsaved work is left by ANY route. The guard is
 * what covers surfaces this list cannot name.
 *
 * `securitywizard` joined in S37 and holds the highest stakes of all: its draft
 * carries in-memory keys that are zeroed the moment it is left. It used to be a
 * state inside a settings area — and, for the settings key, a bottom sheet — so
 * the bar sat under it offering five silent ways to destroy it. A wizard is a
 * flow, and a flow is a destination.
 *
 * `cloudconnect` is deliberately absent: it only picks a provider, and leaving
 * it loses nothing. The credentials are entered on the `sync` surface.
 */
const INPUT_KINDS = new Set<NavKind>(["note", "mailcompose", "sync", "securitywizard", "importwizard"]);

/**
 * The open note, or null. The command registry needs it to gate the
 * note-scoped commands (S16), and the shell must not answer questions about
 * entry kinds itself — that is what the route tables are for.
 */
export function activeNotePath(top?: NavEntry): string | null {
  return top?.kind === "note" ? top.path : null;
}

export function hidesTabBar(top?: NavEntry): boolean {
  return !!top && INPUT_KINDS.has(top.kind);
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
 * Bottom-bar tap: dismisses the overlay and lands on the tab's ROOT — whether
 * that tab was already active or not.
 *
 * It used to keep the other tab's stack, on the platform convention that a tab
 * remembers where you were in it. On a phone with a Home tab that reads as a
 * fault (Gesamtplan § 3.7): stand in a folder, tap Kalender, tap Home — and
 * Home is the folder again, because Home never meant "the tab's start", only
 * "the tab". A tap on the bar is the one gesture that is unambiguously "take
 * me there", so it takes you there. Going BACK still returns to where you
 * were; that is what the back gesture is for.
 */
export function tapTab(state: NavState, id: TabScreenId): NavState {
  return { ...state, overlay: [], activeTab: id, stacks: { ...state.stacks, [id]: [] } };
}

/**
 * Keeps the active tab inside the bar. Shrinking the bar (or reordering it) can
 * push the current tab out; without this the bar would show no selection at all
 * and the user would be looking at a screen they cannot navigate back to.
 */
export function ensureVisibleTab(state: NavState, visible: TabScreenId[]): NavState {
  if (visible.length === 0 || visible.includes(state.activeTab)) return state;
  return { ...state, activeTab: visible[0] };
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
