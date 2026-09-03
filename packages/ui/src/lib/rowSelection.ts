import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Selecting several rows at once — the part both shells and both surfaces
 * (file tree, database views) share.
 *
 * Lifted out of `fileTreeModel.ts` rather than copied: the rules below are the
 * kind that look obvious and are not. `clickSelectionMode` in particular
 * carries a platform trap that cost a released bug once already (Issue #13),
 * and a second derivation of it would reintroduce that bug on the next surface.
 */

/** The minimum a row needs to take part in a selection. */
export interface SelectionRow {
  path: string;
}

export type ClickSelectionMode = "single" | "toggle" | "range" | "none";

/**
 * Explorer-style click reducer: plain click replaces the selection, the
 * platform's multi-select modifier toggles, Shift selects the visible range
 * from the anchor (replacing the selection, anchor unchanged). An unknown
 * anchor falls back to a plain click.
 *
 * `rows` must be in RENDER order — the range walks it, so a sorted table and a
 * grouped board would select different sets from the same two clicks.
 */
export function applyClickSelection(
  prev: ReadonlySet<string>,
  anchor: string | null,
  rows: readonly SelectionRow[],
  path: string,
  mode: "single" | "toggle" | "range",
): { selection: Set<string>; anchor: string } {
  if (mode === "toggle") {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return { selection: next, anchor: path };
  }
  if (mode === "range" && anchor) {
    const ai = rows.findIndex((v) => v.path === anchor);
    const bi = rows.findIndex((v) => v.path === path);
    if (ai !== -1 && bi !== -1) {
      const [from, to] = ai <= bi ? [ai, bi] : [bi, ai];
      return { selection: new Set(rows.slice(from, to + 1).map((v) => v.path)), anchor };
    }
  }
  return { selection: new Set([path]), anchor: path };
}

/**
 * Which selection gesture a mouse click carries, resolved per platform. Shift
 * ranges; the platform's multi-select modifier toggles. That modifier is Cmd
 * (metaKey) on macOS and Ctrl elsewhere — critically NOT `ctrlKey || metaKey`:
 * on macOS Ctrl+click is the OS secondary-click that opens the context menu,
 * so treating Ctrl as a toggle there flips the row out of the selection the
 * instant the menu opens, which is why "select a group and delete" never
 * worked on macOS (Issue #13). Such a Ctrl-modified click on macOS is reported
 * as "none": the contextmenu handler already owns it, and the stray `click`
 * some WebViews still emit must move nothing and open nothing.
 */
export function clickSelectionMode(
  e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  isMac: boolean,
): ClickSelectionMode {
  if (isMac && e.ctrlKey && !e.metaKey) return "none";
  if (e.shiftKey) return "range";
  const toggle = isMac ? e.metaKey : e.ctrlKey;
  return toggle ? "toggle" : "single";
}

/**
 * The gesture a click on a row CHECKBOX carries (finding 2026-09-03).
 *
 * A checkbox is a switch, not an Explorer row: a plain click on a ticked box
 * must untick it. Read as `clickSelectionMode` it was "single" — replace the
 * selection with this very row — so the tick came back on every click and the
 * only way out was the bar's "clear selection". Shift still spans the range
 * from the anchor; the platform's multi-select modifier toggles as well (it
 * cannot mean anything else on a switch); macOS Ctrl-click stays the
 * context-menu gesture and moves nothing. Mobile never had this problem: its
 * cell calls `toggle` directly.
 */
export function checkboxSelectionMode(
  e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  isMac: boolean,
): ClickSelectionMode {
  if (isMac && e.ctrlKey && !e.metaKey) return "none";
  if (e.shiftKey) return "range";
  return "toggle";
}

/**
 * Drops selected paths that are no longer on screen.
 *
 * The failure this prevents is quiet and expensive: rows leave the result set
 * for ordinary reasons (a value edit moves a row past the filter, a sync pull
 * removes a note), and a selection that keeps them would delete or rewrite
 * something the person can no longer see. Pruning is deliberately NOT a reset —
 * setting a value on ten rows must not clear the selection just because the
 * requery reordered them.
 */
export function pruneSelection(
  selection: ReadonlySet<string>,
  rows: readonly SelectionRow[],
): Set<string> {
  if (selection.size === 0) return selection as Set<string>;
  const present = new Set(rows.map((r) => r.path));
  const next = new Set<string>();
  for (const p of selection) if (present.has(p)) next.add(p);
  return next;
}

export interface RowSelection {
  /** Currently selected paths. Empty means no selection mode is active. */
  selection: ReadonlySet<string>;
  /** True while at least one row is selected. */
  active: boolean;
  /** Apply a click with its resolved gesture. `"none"` is a no-op by design. */
  click: (path: string, rows: readonly SelectionRow[], mode: ClickSelectionMode) => void;
  /** Toggle one row — the touch gesture, and the checkbox. */
  toggle: (path: string) => void;
  /** Select every given row, or clear when all of them already are. */
  toggleAll: (rows: readonly SelectionRow[]) => void;
  clear: () => void;
}

/**
 * Selection state for one view.
 *
 * `resetKey` identifies WHAT is being shown (database, view, filter). When it
 * changes the selection is dropped whole — carrying it across a view switch
 * would let a delete hit rows chosen under a different filter. Row churn
 * WITHIN the same view only prunes (see `pruneSelection`).
 */
export function useRowSelection(resetKey: string, rows: readonly SelectionRow[]): RowSelection {
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set<string>());
  const anchorRef = useRef<string | null>(null);

  useEffect(() => {
    setSelection(new Set<string>());
    anchorRef.current = null;
  }, [resetKey]);

  // Rows can vanish under a selection that stays valid otherwise; keep the two
  // in step without clearing what the person picked.
  useEffect(() => {
    setSelection((prev) => {
      const next = pruneSelection(prev, rows);
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const click = useCallback((path: string, rowsNow: readonly SelectionRow[], mode: ClickSelectionMode) => {
    if (mode === "none") return;
    setSelection((prev) => {
      const r = applyClickSelection(prev, anchorRef.current, rowsNow, path, mode);
      anchorRef.current = r.anchor;
      return r.selection;
    });
  }, []);

  const toggle = useCallback((path: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      anchorRef.current = path;
      return next;
    });
  }, []);

  const toggleAll = useCallback((rowsNow: readonly SelectionRow[]) => {
    setSelection((prev) => {
      const all = rowsNow.length > 0 && rowsNow.every((r) => prev.has(r.path));
      anchorRef.current = null;
      return all ? new Set<string>() : new Set(rowsNow.map((r) => r.path));
    });
  }, []);

  const clear = useCallback(() => {
    anchorRef.current = null;
    setSelection(new Set<string>());
  }, []);

  return { selection, active: selection.size > 0, click, toggle, toggleAll, clear };
}
