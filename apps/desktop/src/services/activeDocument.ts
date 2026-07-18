/**
 * Shared "active document" channel(s).
 *
 * The Editor owns the live document content (load/edit/save). Other parts of the
 * shell — the right-sidebar Properties section and the status bar — need to read
 * that live content (reflecting unsaved edits) and, for Properties, write
 * frontmatter back into the editor. Rather than lift all of the Editor's state
 * into App, we expose a small singleton the Editor publishes to and others
 * subscribe to. This mirrors the window-event pattern already used across the
 * editor (plainva-insert-text, plainva-open-table-picker, …) but is synchronous,
 * so a late subscriber can read the current value immediately on mount.
 *
 * The live-document part is a reusable *channel* (`createDocChannel`): the global
 * `activeDocument` is one instance, but a floating peek window creates its own so
 * its inline Properties column binds to the peek note instead of the main pane —
 * without the two fighting over the shared sidebar. The base row-count map and
 * the selection stats are inherently app-global (the status bar) and stay on the
 * exported singleton only.
 */

export type ActiveDocKind = "markdown" | "base" | "virtual" | "none";

export interface ActiveDocMeta {
  /** Number of entries, for `.base` database files. */
  entries?: number;
  /** A short live status line for `virtual` tabs (calendar/mail), e.g.
   * "12 Termine · 3 Aufgaben" or "Posteingang · 5 ungelesen". The tab name
   * itself is derived from the path by the status bar. */
  info?: string;
}

export interface ActiveDoc {
  path: string | null;
  content: string;
  kind: ActiveDocKind;
  meta: ActiveDocMeta;
}

type Listener = (doc: ActiveDoc) => void;

/**
 * A scoped live-document channel. The Editor publishes to it; the Properties
 * section reads from it and writes frontmatter back through it. The global
 * `activeDocument` satisfies this shape, so components default to it.
 */
export interface DocChannel {
  get(): ActiveDoc;
  set(next: Partial<ActiveDoc>): void;
  clear(): void;
  subscribe(fn: Listener): () => void;
  registerApplyFrontmatter(fn: ((newContent: string) => void) | null): void;
  applyFrontmatter(newContent: string): boolean;
}

/** Create an independent live-document channel (the peek window uses its own). */
export function createDocChannel(): DocChannel {
  let current: ActiveDoc = { path: null, content: "", kind: "none", meta: {} };
  const listeners = new Set<Listener>();
  let applyFrontmatterFn: ((newContent: string) => void) | null = null;

  return {
    get(): ActiveDoc {
      return current;
    },
    set(next: Partial<ActiveDoc>): void {
      current = {
        path: next.path !== undefined ? next.path : current.path,
        content: next.content !== undefined ? next.content : current.content,
        kind: next.kind !== undefined ? next.kind : current.kind,
        meta: next.meta !== undefined ? next.meta : current.meta,
      };
      listeners.forEach((l) => {
        try { l(current); } catch (e) { console.error("doc channel listener failed", e); }
      });
    },
    clear(): void {
      applyFrontmatterFn = null;
      this.set({ path: null, content: "", kind: "none", meta: {} });
    },
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    registerApplyFrontmatter(fn: ((newContent: string) => void) | null): void {
      applyFrontmatterFn = fn;
    },
    applyFrontmatter(newContent: string): boolean {
      if (applyFrontmatterFn) {
        applyFrontmatterFn(newContent);
        return true;
      }
      return false;
    },
  };
}

// Row counts of every rendered `.base` viewer, keyed by its vault path. Filled by
// both directly-opened and embedded BaseViewers; the status bar reads it to show
// the aggregated entry count of the bases embedded in the current markdown page
// (#1), so an embedded base no longer clobbers the page's own word/char stats.
const baseEntryCounts = new Map<string, number>();
type BaseListener = () => void;
const baseListeners = new Set<BaseListener>();
function notifyBaseListeners(): void {
  baseListeners.forEach((l) => {
    try { l(); } catch (e) { console.error("activeDocument base listener failed", e); }
  });
}

/**
 * Selection word/char counts of the ACTIVE editor pane (P3.9). A separate
 * channel — selection moves fire far more often than document changes, and
 * only the status bar cares.
 */
export interface SelectionStats { chars: number; words: number; }
let selectionStats: SelectionStats | null = null;
type SelectionListener = (stats: SelectionStats | null) => void;
const selectionListeners = new Set<SelectionListener>();

const globalDoc = createDocChannel();

export const activeDocument = {
  ...globalDoc,
  /** Reset to the empty state (e.g. when no file is open); also clears selection. */
  clear(): void {
    globalDoc.clear();
    this.setSelectionStats(null);
  },
  /** A rendered `.base` viewer reports (or refreshes) its row count. */
  setBaseEntryCount(path: string, entries: number): void {
    if (!path) return;
    if (baseEntryCounts.get(path) === entries) return;
    baseEntryCounts.set(path, entries);
    notifyBaseListeners();
  },
  /** A `.base` viewer unmounts / navigates away: drop its count. */
  clearBaseEntryCount(path: string): void {
    if (baseEntryCounts.delete(path)) notifyBaseListeners();
  },
  /** Current path -> row-count map (read-only view for the status bar). */
  getBaseEntryCounts(): ReadonlyMap<string, number> {
    return baseEntryCounts;
  },
  /** Subscribe to base row-count changes (separate from the doc channel). */
  subscribeBaseEntries(fn: BaseListener): () => void {
    baseListeners.add(fn);
    return () => { baseListeners.delete(fn); };
  },
  /** The active editor pane publishes its selection stats (null = none). */
  setSelectionStats(stats: SelectionStats | null): void {
    if (stats === selectionStats) return;
    if (stats && selectionStats && stats.chars === selectionStats.chars && stats.words === selectionStats.words) return;
    selectionStats = stats;
    selectionListeners.forEach((l) => {
      try { l(selectionStats); } catch (e) { console.error("activeDocument selection listener failed", e); }
    });
  },
  getSelectionStats(): SelectionStats | null {
    return selectionStats;
  },
  subscribeSelection(fn: SelectionListener): () => void {
    selectionListeners.add(fn);
    return () => { selectionListeners.delete(fn); };
  },
};
