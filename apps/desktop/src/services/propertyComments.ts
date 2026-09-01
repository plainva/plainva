import { useSyncExternalStore } from "react";

/**
 * Bridge between the editor (which owns the workspace comment list) and the
 * Properties panel (which owns the rows), plan Stufe E section E2.
 *
 * The panel is NOT rendered by the editor - the right sidebar and a peek window
 * render it, and a peek carries its own document channel. So the counts travel
 * with the path they belong to and every reader compares that path against its
 * own before showing a number: a peek on another note must never inherit the
 * editor's counts.
 *
 * Counts are THREADS, not messages. A reply inherits its thread's anchor and
 * carries none of its own (`postWorkspaceComment(..., parentId, null)`), so
 * counting messages would inflate one busy discussion into many remarks.
 */

export interface PropertyCommentSnapshot {
  /** Note path these counts belong to; empty while nothing is published. */
  path: string;
  /** Thread count per bare frontmatter key (only keys that carry comments). */
  counts: ReadonlyMap<string, number>;
  /** Whether the viewer may start a comment at all (`comment.create`). */
  canComment: boolean;
}

const EMPTY: PropertyCommentSnapshot = { path: "", counts: new Map(), canComment: false };

let state: PropertyCommentSnapshot = EMPTY;
let requestHandler: ((key: string) => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function sameCounts(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

export const propertyCommentStore = {
  get: (): PropertyCommentSnapshot => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /**
   * Publish the counts of the note the editor currently shows. A no-op when
   * nothing changed - the editor calls this from an effect, and a fresh object
   * on every render would loop through every subscriber.
   */
  publish(path: string, counts: ReadonlyMap<string, number>, canComment: boolean) {
    if (state.path === path && state.canComment === canComment && sameCounts(state.counts, counts)) return;
    state = { path, counts, canComment };
    emit();
  },
  /** Editor unmounted or switched away from a workspace note. */
  clear() {
    if (state === EMPTY || (state.path === "" && state.counts.size === 0 && !state.canComment)) return;
    state = EMPTY;
    emit();
  },
  /** The editor registers how a comment is started; null on unmount. */
  registerRequest(handler: ((key: string) => void) | null) {
    requestHandler = handler;
  },
  /**
   * Ask the editor to start a comment on `key`. Refuses when the caller shows a
   * different note than the published one - the handler writes into the editor's
   * open document, so a peek on another note must not reach it.
   */
  request(path: string, key: string): boolean {
    if (!requestHandler || !key || !path || path !== state.path || !state.canComment) return false;
    requestHandler(key);
    return true;
  },
};

/** Counts for `path`, or an empty map when the editor shows another note. */
export function usePropertyCommentCounts(path: string | null | undefined): ReadonlyMap<string, number> {
  const snap = useSyncExternalStore(propertyCommentStore.subscribe, propertyCommentStore.get);
  return path && snap.path === path ? snap.counts : EMPTY.counts;
}

/** Whether a comment can be started from `path` right now. */
export function useCanCommentOnProperties(path: string | null | undefined): boolean {
  const snap = useSyncExternalStore(propertyCommentStore.subscribe, propertyCommentStore.get);
  return Boolean(path) && snap.path === path && snap.canComment;
}
