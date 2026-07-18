import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SplitDirection } from "../components/SplitButton";

// --- Split editor: pane/tab model ---------------------------------------
// A pane is one editor group with its own tab set; the layout holds 1..2 panes
// (MVP), a split direction and the focused pane. New files open in the focused
// pane. The transforms below are pure so the React handlers stay tiny — they
// live here (not in App) so App only wires them up, and so they can be unit
// tested in isolation (see usePaneLayout.test.ts).
export interface TabItem { history: string[]; historyIndex: number }
export interface Pane { tabs: TabItem[]; activeIndex: number }
export interface Layout { panes: Pane[]; direction: SplitDirection; activePaneIndex: number }

export const SPLIT_RATIO_MIN = 0.15;
export const SPLIT_RATIO_MAX = 0.85;
const DEFAULT_SPLIT_RATIO = 0.5;

const emptyLayout = (direction: SplitDirection = "vertical"): Layout => ({
  panes: [{ tabs: [], activeIndex: -1 }],
  direction,
  activePaneIndex: 0,
});

export function openInPane(pane: Pane, path: string, newTab: boolean): Pane {
  if (newTab || pane.tabs.length === 0) {
    return { tabs: [...pane.tabs, { history: [path], historyIndex: 0 }], activeIndex: pane.tabs.length };
  }
  const existingIdx = pane.tabs.findIndex((tb) => tb.history[tb.historyIndex] === path);
  if (existingIdx !== -1 && existingIdx !== pane.activeIndex) return { ...pane, activeIndex: existingIdx };
  const cur = pane.tabs[pane.activeIndex];
  if (cur && cur.history[cur.historyIndex] === path) return pane;
  const tabs = pane.tabs.slice();
  const tab = { ...cur };
  tab.history = tab.history.slice(0, tab.historyIndex + 1);
  tab.history.push(path);
  tab.historyIndex++;
  tabs[pane.activeIndex] = tab;
  return { ...pane, tabs };
}

/** Open a VIRTUAL singleton path (graph/tasks/calendar/mail) without stacking
 * duplicates: if any pane already has a tab showing it, focus that tab;
 * otherwise open a fresh tab in the focused pane. Pure transform (unit tested;
 * the hook wraps it with notifyOpen). */
export function focusOrOpenVirtualInLayout(prev: Layout, path: string): Layout {
  for (let p = 0; p < prev.panes.length; p++) {
    const idx = prev.panes[p].tabs.findIndex((tb) => tb.history[tb.historyIndex] === path);
    if (idx !== -1) {
      return {
        ...prev,
        activePaneIndex: p,
        panes: prev.panes.map((pane, i) => (i === p ? { ...pane, activeIndex: idx } : pane)),
      };
    }
  }
  return {
    ...prev,
    panes: prev.panes.map((pane, i) => (i === prev.activePaneIndex ? openInPane(pane, path, true) : pane)),
  };
}

export function navigateInPane(pane: Pane, dir: -1 | 1): Pane {
  if (pane.activeIndex < 0) return pane;
  const tab = pane.tabs[pane.activeIndex];
  const ni = tab.historyIndex + dir;
  if (ni < 0 || ni >= tab.history.length) return pane;
  const tabs = pane.tabs.slice();
  tabs[pane.activeIndex] = { ...tab, historyIndex: ni };
  return { ...pane, tabs };
}

export function closeTabInPane(pane: Pane, index: number): Pane {
  const tabs = pane.tabs.filter((_, i) => i !== index);
  let activeIndex = pane.activeIndex;
  if (tabs.length === 0) activeIndex = -1;
  else if (pane.activeIndex === index) activeIndex = Math.max(0, index - 1);
  else if (pane.activeIndex > index) activeIndex = pane.activeIndex - 1;
  return { tabs, activeIndex };
}

export function closeByPrefixInPane(pane: Pane, prefix: string): Pane {
  const keep: { tab: TabItem; idx: number }[] = [];
  pane.tabs.forEach((tb, i) => {
    const p = tb.history[tb.historyIndex];
    if (p !== prefix && !p.startsWith(prefix + "/")) keep.push({ tab: tb, idx: i });
  });
  if (keep.length === pane.tabs.length) return pane;
  const tabs = keep.map((k) => k.tab);
  let activeIndex = -1;
  if (tabs.length) {
    const found = keep.findIndex((k) => k.idx === pane.activeIndex);
    activeIndex = Math.max(0, found >= 0 ? found : Math.min(pane.activeIndex, tabs.length - 1));
  }
  return { tabs, activeIndex };
}

export function renamePrefixInPane(pane: Pane, oldPrefix: string, newPrefix: string): Pane {
  let changed = false;
  const tabs = pane.tabs.map((tb) => {
    let hc = false;
    const history = tb.history.map((p) => {
      if (p === oldPrefix) { hc = true; return newPrefix; }
      if (p.startsWith(oldPrefix + "/")) { hc = true; return newPrefix + p.substring(oldPrefix.length); }
      return p;
    });
    if (hc) changed = true;
    return hc ? { ...tb, history } : tb;
  });
  return changed ? { ...pane, tabs } : pane;
}

// Drop empty panes (always keep at least one) and remap the focused-pane index.
export function normalizeLayout(layout: Layout): Layout {
  if (layout.panes.length <= 1) return layout;
  const kept: { pane: Pane; idx: number }[] = [];
  layout.panes.forEach((p, i) => { if (p.tabs.length > 0) kept.push({ pane: p, idx: i }); });
  if (kept.length === layout.panes.length) return layout;
  if (kept.length === 0) return { ...layout, panes: [{ tabs: [], activeIndex: -1 }], activePaneIndex: 0 };
  const panes = kept.map((k) => k.pane);
  const found = kept.findIndex((k) => k.idx === layout.activePaneIndex);
  const activePaneIndex = Math.max(0, Math.min(found >= 0 ? found : layout.activePaneIndex, panes.length - 1));
  return { ...layout, panes, activePaneIndex };
}

// Move a tab within a pane (reorder) or between panes (D5 drag). The moved tab
// keeps its full history. `toIndex === null` appends at the end of the target
// pane; otherwise it is inserted at that position. The target pane becomes the
// focused one and the moved tab its active tab; an emptied source pane collapses
// via normalizeLayout so a two-pane split folds back to one.
export function moveTab(layout: Layout, fromPane: number, fromIndex: number, toPane: number, toIndex: number | null): Layout {
  const src = layout.panes[fromPane];
  if (!src || fromIndex < 0 || fromIndex >= src.tabs.length) return layout;
  if (!layout.panes[toPane]) return layout;
  // Same pane, same slot (or the no-op "insert right after itself") — nothing to do.
  if (fromPane === toPane && (toIndex === null || toIndex === fromIndex || toIndex === fromIndex + 1)) {
    return layout.activePaneIndex === toPane ? layout : { ...layout, activePaneIndex: toPane };
  }
  const moved = src.tabs[fromIndex];
  const panes = layout.panes.map((p) => ({ tabs: p.tabs.slice(), activeIndex: p.activeIndex }));

  // Remove from source.
  panes[fromPane] = closeTabInPane(panes[fromPane], fromIndex);

  // Compute the insertion slot in the target (accounting for the removal when
  // moving within the same pane, where earlier removal shifts later indices).
  const target = panes[toPane];
  let insertAt = toIndex === null ? target.tabs.length : toIndex;
  if (fromPane === toPane && toIndex !== null && toIndex > fromIndex) insertAt -= 1;
  insertAt = Math.max(0, Math.min(insertAt, target.tabs.length));
  target.tabs.splice(insertAt, 0, moved);
  target.activeIndex = insertAt;

  const next: Layout = { ...layout, panes, activePaneIndex: toPane };
  return normalizeLayout(next);
}

// --- Persistence ---------------------------------------------------------
// The layout is persisted per vault so panes, tabs and the active file survive
// an app restart (plan D1). We mirror App's existing per-vault localStorage
// convention (`recentPaths-<vaultPath>`); the snapshot also carries the split
// direction and ratio (previously global) so each vault keeps its own layout.
interface LayoutSnapshot { panes: Pane[]; direction: SplitDirection; activePaneIndex: number; splitRatio: number }

const layoutKey = (vaultPath: string) => `plainva-layout-${vaultPath}`;

const clampRatio = (r: number) => (r >= SPLIT_RATIO_MIN && r <= SPLIT_RATIO_MAX ? r : DEFAULT_SPLIT_RATIO);

function readSnapshot(vaultPath: string): LayoutSnapshot | null {
  try {
    const raw = localStorage.getItem(layoutKey(vaultPath));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.panes)) return null;
    return parsed as LayoutSnapshot;
  } catch {
    return null;
  }
}

// Rebuild a validated layout from a snapshot: keep only tabs whose current file
// still exists, reset each surviving tab to a single-entry history (a stale
// back/forward stack pointing at deleted files is not worth preserving across a
// restart), then normalize so emptied panes collapse.
async function restoreLayout(vaultPath: string, validatePath: (p: string) => Promise<boolean>): Promise<{ layout: Layout; splitRatio: number } | null> {
  const snap = readSnapshot(vaultPath);
  if (!snap) return null;

  const currentPaths = new Set<string>();
  for (const pane of snap.panes) {
    for (const tab of pane.tabs ?? []) {
      const p = tab?.history?.[tab.historyIndex];
      if (typeof p === "string") currentPaths.add(p);
    }
  }
  const validity = new Map<string, boolean>();
  await Promise.all(
    Array.from(currentPaths).map(async (p) => {
      try { validity.set(p, await validatePath(p)); } catch { validity.set(p, false); }
    })
  );

  const panes: Pane[] = snap.panes.map((pane) => {
    const kept: TabItem[] = [];
    let newActive = -1;
    (pane.tabs ?? []).forEach((tab, i) => {
      const p = tab?.history?.[tab.historyIndex];
      if (typeof p === "string" && validity.get(p)) {
        if (i === pane.activeIndex) newActive = kept.length;
        kept.push({ history: [p], historyIndex: 0 });
      }
    });
    if (kept.length > 0 && newActive === -1) newActive = 0;
    return { tabs: kept, activeIndex: kept.length ? newActive : -1 };
  });

  const direction: SplitDirection = snap.direction === "horizontal" ? "horizontal" : "vertical";
  const activePaneIndex = Math.max(0, Math.min(snap.activePaneIndex ?? 0, panes.length - 1));
  const layout = normalizeLayout({ panes: panes.length ? panes : [{ tabs: [], activeIndex: -1 }], direction, activePaneIndex });
  return { layout, splitRatio: clampRatio(snap.splitRatio) };
}

export interface UsePaneLayoutOptions {
  vaultPath: string | null;
  /** Resolve whether a persisted tab path still exists (used to prune on restore). */
  validatePath: (path: string) => Promise<boolean>;
  /** Fired whenever a path is opened, so the host can track it (e.g. recent files). */
  onOpenPath?: (path: string) => void;
  /** Fired when a fresh empty pane is created by a split, so the host can prompt for a file. */
  onRequestPick?: () => void;
}

/**
 * Owns the split-editor pane/tab layout: the panes, their tabs, the active file,
 * split direction/ratio, and per-vault persistence (save + validated restore).
 * Extracted from App (plan D1) so App only wires the returned operations to the
 * UI. Multi-value host concerns (recent files, the quick switcher) are delegated
 * via the `onOpenPath` / `onRequestPick` callbacks.
 */
export function usePaneLayout({ vaultPath, validatePath, onOpenPath, onRequestPick }: UsePaneLayoutOptions) {
  const [layout, setLayout] = useState<Layout>(() => emptyLayout());
  const [splitRatio, setSplitRatioState] = useState<number>(DEFAULT_SPLIT_RATIO);

  // Latest callback/validator via refs so the restore/persist effects can depend
  // only on vaultPath (not on identities that change every render). The refs are
  // written in an effect (never during render); declared before the restore effect
  // so they are current when it runs on a vault switch.
  const validateRef = useRef(validatePath);
  const onOpenPathRef = useRef(onOpenPath);
  const onRequestPickRef = useRef(onRequestPick);
  const layoutRef = useRef(layout);
  // Guards saving until the current vault has been hydrated, so the interim empty
  // layout set on a vault switch never clobbers the stored snapshot.
  const hydratedForVault = useRef<string | null>(null);

  useEffect(() => {
    validateRef.current = validatePath;
    onOpenPathRef.current = onOpenPath;
    onRequestPickRef.current = onRequestPick;
    layoutRef.current = layout;
  });

  const notifyOpen = (path: string) => { onOpenPathRef.current?.(path); };

  // Restore on vault change (switching vaults invalidates the old vault's tabs —
  // their paths are relative to it). Reset immediately, then hydrate async.
  useEffect(() => {
    let cancelled = false;
    hydratedForVault.current = null;
    setLayout(emptyLayout());
    setSplitRatioState(DEFAULT_SPLIT_RATIO);
    if (!vaultPath) return;
    (async () => {
      const restored = await restoreLayout(vaultPath, validateRef.current);
      if (cancelled) return;
      if (restored) {
        setLayout(restored.layout);
        setSplitRatioState(restored.splitRatio);
      }
      hydratedForVault.current = vaultPath;
    })();
    return () => { cancelled = true; };
  }, [vaultPath]);

  // Persist on change (debounced; skipped until this vault is hydrated).
  useEffect(() => {
    if (!vaultPath || hydratedForVault.current !== vaultPath) return;
    const id = window.setTimeout(() => {
      const snap: LayoutSnapshot = { panes: layout.panes, direction: layout.direction, activePaneIndex: layout.activePaneIndex, splitRatio };
      try { localStorage.setItem(layoutKey(vaultPath), JSON.stringify(snap)); } catch { /* quota/serialization — non-fatal */ }
    }, 250);
    return () => window.clearTimeout(id);
  }, [vaultPath, layout, splitRatio]);

  // Open a path in a SPECIFIC pane (used by each pane's own editor/links) and focus it.
  const openTab = useCallback((paneIndex: number, path: string, newTab: boolean) => {
    notifyOpen(path);
    setLayout((prev) => ({
      ...prev,
      activePaneIndex: paneIndex,
      panes: prev.panes.map((p, i) => (i === paneIndex ? openInPane(p, path, newTab) : p)),
    }));
  }, []);

  // Open a path in the focused pane (used by sidebar, quick switcher, calendar, …).
  const openInFocusedPane = useCallback((path: string, newTab: boolean = false) => {
    notifyOpen(path);
    setLayout((prev) => ({
      ...prev,
      panes: prev.panes.map((p, i) => (i === prev.activePaneIndex ? openInPane(p, path, newTab) : p)),
    }));
  }, []);

  // Open a VIRTUAL singleton path (graph/tasks/calendar/mail) without stacking
  // duplicates: if any pane already has a tab showing it, focus that tab;
  // otherwise open a fresh tab in the focused pane. The ribbon/palette entry
  // points route through here so repeated clicks don't pile up second copies.
  const focusOrOpenVirtual = useCallback((path: string) => {
    notifyOpen(path);
    setLayout((prev) => focusOrOpenVirtualInLayout(prev, path));
  }, []);

  // Open a path in the pane NEXT TO `fromPane` (Base-UX2 P5: Ctrl+click on a
  // base element, the peek window's "open in split", the card drop zone).
  // Splits vertically first when there is only one pane; if the target pane
  // already shows the path in a tab, that tab is focused instead of duplicated.
  const openInOtherPane = useCallback((fromPane: number, path: string) => {
    notifyOpen(path);
    setLayout((prev) => {
      if (prev.panes.length >= 2) {
        const other = fromPane === 0 ? 1 : 0;
        const pane = prev.panes[other];
        const existing = pane.tabs.findIndex((tb) => tb.history[tb.historyIndex] === path);
        const nextPane = existing !== -1 ? { ...pane, activeIndex: existing } : openInPane(pane, path, true);
        return { ...prev, activePaneIndex: other, panes: prev.panes.map((p, i) => (i === other ? nextPane : p)) };
      }
      return {
        direction: "vertical",
        activePaneIndex: prev.panes.length,
        panes: [...prev.panes, openInPane({ tabs: [], activeIndex: -1 }, path, true)],
      };
    });
  }, []);

  // Open a path in a split with an explicit direction (file-tree context menu,
  // plan UI-UX-Paket P8). Not split yet → create the second pane in `direction`;
  // already split → re-orient and reuse the other pane like openInOtherPane.
  const openPathInSplit = useCallback((path: string, direction: SplitDirection) => {
    notifyOpen(path);
    setLayout((prev) => {
      if (prev.panes.length >= 2) {
        const other = prev.activePaneIndex === 0 ? 1 : 0;
        const pane = prev.panes[other];
        const existing = pane.tabs.findIndex((tb) => tb.history[tb.historyIndex] === path);
        const nextPane = existing !== -1 ? { ...pane, activeIndex: existing } : openInPane(pane, path, true);
        return { ...prev, direction, activePaneIndex: other, panes: prev.panes.map((p, i) => (i === other ? nextPane : p)) };
      }
      return {
        direction,
        activePaneIndex: prev.panes.length,
        panes: [...prev.panes, openInPane({ tabs: [], activeIndex: -1 }, path, true)],
      };
    });
  }, []);

  const navigateTab = useCallback((paneIndex: number, direction: -1 | 1) => {
    setLayout((prev) => ({ ...prev, panes: prev.panes.map((p, i) => (i === paneIndex ? navigateInPane(p, direction) : p)) }));
  }, []);

  const selectTab = useCallback((paneIndex: number, index: number) => {
    setLayout((prev) => ({ ...prev, activePaneIndex: paneIndex, panes: prev.panes.map((p, i) => (i === paneIndex ? { ...p, activeIndex: index } : p)) }));
  }, []);

  // Closing the last tab of a pane collapses the split back to a single pane.
  const closeTab = useCallback((paneIndex: number, index: number) => {
    setLayout((prev) => normalizeLayout({ ...prev, panes: prev.panes.map((p, i) => (i === paneIndex ? closeTabInPane(p, index) : p)) }));
  }, []);

  // Delete/rename affect every pane (the file may be open in more than one).
  const closeTabsByPrefix = useCallback((prefix: string) => {
    setLayout((prev) => normalizeLayout({ ...prev, panes: prev.panes.map((p) => closeByPrefixInPane(p, prefix)) }));
  }, []);

  const renameTabPrefix = useCallback((oldPrefix: string, newPrefix: string) => {
    setLayout((prev) => ({ ...prev, panes: prev.panes.map((p) => renamePrefixInPane(p, oldPrefix, newPrefix)) }));
  }, []);

  const focusPane = useCallback((paneIndex: number) => {
    setLayout((prev) => (prev.activePaneIndex === paneIndex ? prev : { ...prev, activePaneIndex: paneIndex }));
  }, []);

  // Split the editor area (MVP: max 2 panes). The new pane starts empty; the host
  // is asked (onRequestPick) to open the quick switcher so the user picks the
  // second document. If already split, this just re-orients the existing split.
  const splitEditor = useCallback((direction: SplitDirection) => {
    const wasSplit = layoutRef.current.panes.length >= 2;
    setLayout((prev) => (prev.panes.length >= 2
      ? { ...prev, direction }
      : { panes: [...prev.panes, { tabs: [], activeIndex: -1 }], direction, activePaneIndex: prev.panes.length }));
    if (!wasSplit) onRequestPickRef.current?.();
  }, []);

  // Split the editor area and move a specific tab into the new pane. If already split,
  // it just re-orients (like splitEditor). If it is the only tab in the pane, it falls
  // back to normal split behavior (opens the Quick Switcher).
  const splitEditorWithTab = useCallback((direction: SplitDirection, fromPaneIndex: number, fromTabIndex: number) => {
    const wasSplit = layoutRef.current.panes.length >= 2;
    const fromPane = layoutRef.current.panes[fromPaneIndex];

    setLayout((prev) => {
      const pane = prev.panes[fromPaneIndex];
      if (!pane) return prev;

      if (prev.panes.length >= 2) {
        // Already split. Just re-orient like the standard splitEditor does.
        return { ...prev, direction };
      }

      // Not split yet.
      if (pane.tabs.length <= 1) {
        // Only 1 tab, so we shouldn't move it (would leave empty pane). Just split normally.
        return { panes: [...prev.panes, { tabs: [], activeIndex: -1 }], direction, activePaneIndex: prev.panes.length };
      }

      // Not split, >1 tabs. Create new pane and move the tab there.
      const targetPaneIdx = prev.panes.length;
      const next: Layout = { ...prev, direction, panes: [...prev.panes, { tabs: [], activeIndex: -1 }], activePaneIndex: targetPaneIdx };
      return moveTab(next, fromPaneIndex, fromTabIndex, targetPaneIdx, null);
    });

    if (!wasSplit && fromPane && fromPane.tabs.length <= 1) {
      onRequestPickRef.current?.();
    }
  }, []);

  // Drag a tab within/between panes (D5). Focuses the target pane.
  const moveTabTo = useCallback((fromPane: number, fromIndex: number, toPane: number, toIndex: number | null) => {
    setLayout((prev) => moveTab(prev, fromPane, fromIndex, toPane, toIndex));
  }, []);

  const setSplitRatio = useCallback((updater: number | ((r: number) => number)) => {
    setSplitRatioState((prev) => {
      const raw = typeof updater === "function" ? updater(prev) : updater;
      return Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, raw));
    });
  }, []);

  // Drop any panes emptied while a picker was open (quick switcher cancel).
  const normalizeNow = useCallback(() => setLayout((prev) => normalizeLayout(prev)), []);

  const derived = useMemo(() => {
    const activePane = layout.panes[layout.activePaneIndex] ?? layout.panes[0];
    const activeTab = activePane && activePane.activeIndex >= 0 && activePane.activeIndex < activePane.tabs.length
      ? activePane.tabs[activePane.activeIndex]
      : null;
    const activePath = activeTab ? activeTab.history[activeTab.historyIndex] : null;
    const isSplit = layout.panes.length > 1;
    // When split, the split direction is already applied; the split controls hide
    // the matching option (re-splitting the same way is a no-op).
    const activeSplitDirection = isSplit ? layout.direction : undefined;
    return { activePane, activeTab, activePath, isSplit, activeSplitDirection };
  }, [layout]);

  return {
    layout,
    splitRatio,
    ...derived,
    openTab,
    openInFocusedPane,
    focusOrOpenVirtual,
    openInOtherPane,
    openPathInSplit,
    navigateTab,
    selectTab,
    closeTab,
    closeTabsByPrefix,
    renameTabPrefix,
    focusPane,
    splitEditor,
    splitEditorWithTab,
    moveTabTo,
    setSplitRatio,
    normalizeNow,
  };
}
