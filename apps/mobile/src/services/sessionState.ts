/**
 * The navigation state across an app restart (TestFlight feedback Build 91, P6).
 *
 * The phone remembered ONE thing: the path of the last note (T6). A database
 * was never remembered — `openBase` only joined the recents — so the pinboard
 * the tester uses as his start page could not come back, and neither could
 * the tab he was on. The desktop restores its whole layout; the phone's
 * navigation model is already serialisable, so it restores its stacks.
 *
 * What comes back: the active tab, every tab's stack and the overlay, minus
 * the surfaces that carry unfinished input the app must not resurrect
 * (setup assistants, the sync form, a mail draft — `INPUT_KINDS`, with the
 * note as the one exception: its draft has its own journal). Entries whose
 * file is gone are dropped, and the active tab is kept inside the bar.
 * Stored per vault in local storage, like the scroll memory and the
 * conflicts; written debounced on every change and flushed when the app goes
 * to the background, because Android may kill the process without a further
 * callback.
 */
import { useEffect } from "react";
import { NAV_KINDS, INPUT_KINDS, emptyStacks, ensureVisibleTab, type NavEntry, type NavKind, type NavState, type TabScreenId } from "../navigation";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const defaultStorage = (): StorageLike | null => (typeof localStorage === "undefined" ? null : localStorage);

export const sessionKey = (vaultKey: string) => `plainva-nav-${vaultKey}`;

/** Kinds whose `path` names a file or folder that has to exist to be worth restoring. */
const PATH_KINDS = new Set<NavKind>(["note", "base", "folder", "imageviewer"]);

const KIND_SET = new Set<string>(NAV_KINDS);
const TAB_IDS = new Set<string>(Object.keys(emptyStacks()));

function sanitizeEntry(raw: unknown): NavEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = (raw as { kind?: unknown }).kind;
  const path = (raw as { path?: unknown }).path;
  if (typeof kind !== "string" || !KIND_SET.has(kind) || typeof path !== "string") return null;
  // Unfinished input never comes back — except the note, whose draft journal
  // is the thing that keeps typed text safe.
  if (INPUT_KINDS.has(kind as NavKind) && kind !== "note") return null;
  return { kind: kind as NavKind, path };
}

/** Parses a stored state; anything malformed becomes null, malformed entries are dropped. */
export function parseNavState(raw: string | null): NavState | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as { activeTab?: unknown; stacks?: unknown; overlay?: unknown };
    if (typeof p.activeTab !== "string" || !TAB_IDS.has(p.activeTab)) return null;
    const stacks = emptyStacks();
    const rawStacks = p.stacks && typeof p.stacks === "object" ? (p.stacks as Record<string, unknown>) : {};
    for (const tab of Object.keys(stacks) as TabScreenId[]) {
      const list = rawStacks[tab];
      if (Array.isArray(list)) stacks[tab] = list.map(sanitizeEntry).filter((e): e is NavEntry => e !== null);
    }
    const overlay = Array.isArray(p.overlay) ? p.overlay.map(sanitizeEntry).filter((e): e is NavEntry => e !== null) : [];
    return { activeTab: p.activeTab as TabScreenId, stacks, overlay };
  } catch {
    return null;
  }
}

export function serializeNavState(nav: NavState): string {
  // Only what a restart can use: kind and path. `configOpen` and the
  // connect-wizard carry-overs belong to the moment they were set.
  const strip = (list: NavEntry[]) => list.map(({ kind, path }) => ({ kind, path }));
  const stacks: Record<string, { kind: NavKind; path: string }[]> = {};
  for (const tab of Object.keys(nav.stacks) as TabScreenId[]) stacks[tab] = strip(nav.stacks[tab]);
  return JSON.stringify({ activeTab: nav.activeTab, stacks, overlay: strip(nav.overlay) });
}

export function readNavState(vaultKey: string, storage: StorageLike | null = defaultStorage()): NavState | null {
  try {
    return parseNavState(storage?.getItem(sessionKey(vaultKey)) ?? null);
  } catch {
    return null;
  }
}

export function writeNavState(vaultKey: string, nav: NavState, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(sessionKey(vaultKey), serializeNavState(nav));
  } catch {
    /* the session simply does not persist */
  }
}

/**
 * Drops entries whose file or folder no longer exists (the root folder ""
 * always exists) and keeps the active tab inside the bar. Returns the state
 * to boot into, or null when nothing of it survived.
 */
export async function restoreNavState(
  stored: NavState,
  opts: { exists: (path: string) => Promise<boolean>; visible: TabScreenId[] },
): Promise<NavState | null> {
  const keep = async (entries: NavEntry[]): Promise<NavEntry[]> => {
    const out: NavEntry[] = [];
    for (const e of entries) {
      if (PATH_KINDS.has(e.kind) && e.path !== "") {
        let ok = false;
        try {
          ok = await opts.exists(e.path);
        } catch {
          ok = false;
        }
        if (!ok) continue;
      }
      out.push(e);
    }
    return out;
  };
  const stacks = emptyStacks();
  for (const tab of Object.keys(stacks) as TabScreenId[]) stacks[tab] = await keep(stored.stacks[tab] ?? []);
  const overlay = await keep(stored.overlay ?? []);
  const next = ensureVisibleTab({ activeTab: stored.activeTab, stacks, overlay }, opts.visible);
  const anything = next.overlay.length > 0 || Object.values(next.stacks).some((s) => s.length > 0) || opts.visible[0] !== next.activeTab;
  return anything ? next : null;
}

/* ---------------------------------------------------------------- saving */

let pending: { vaultKey: string; nav: NavState } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Vaults whose restore has been attempted — before that, nothing is written over the stored session. */
const ready = new Set<string>();

export const NAV_SAVE_DEBOUNCE_MS = 250;

/** Called once the stored session was read for `vaultKey` (or found absent). */
export function markSessionReady(vaultKey: string): void {
  ready.add(vaultKey);
}

/** Debounced write; the boot's initial state never overwrites a session that has not been read yet. */
export function scheduleNavSave(vaultKey: string, nav: NavState, storage: StorageLike | null = defaultStorage()): void {
  if (!ready.has(vaultKey)) return;
  pending = { vaultKey, nav };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    flushNavSave(storage);
  }, NAV_SAVE_DEBOUNCE_MS);
}

/** Writes what is pending NOW — the app is going to the background. */
export function flushNavSave(storage: StorageLike | null = defaultStorage()): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!pending) return;
  writeNavState(pending.vaultKey, pending.nav, storage);
  pending = null;
}

/**
 * The shell's one line (App.tsx routes, it does not remember): every
 * navigation change is written debounced for the open vault; the background
 * flushes it, because Android may kill the process without another callback.
 */
export function useNavPersistence(vault: { vaultId: string } | null, nav: NavState): void {
  useEffect(() => {
    if (vault) scheduleNavSave(vault.vaultId, nav);
  }, [nav, vault]);
}

/** Test seam. */
export function resetSessionState(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
  ready.clear();
}
