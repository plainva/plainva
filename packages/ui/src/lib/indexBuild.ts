import type { IndexNotWholeState, IndexWholeness, IndexWholenessState } from "@plainva/core";
import i18n from "../i18n";

/**
 * How whole the index of each open vault is — one store for both shells
 * (issue 143 on the phone; performance plan L3 on the desktop).
 *
 * A vault without an index used to be read whole before the app drew
 * anything. The first scan now runs behind the open app, and so can the scan
 * of an index that is owed one (a first scan that failed, issue 125). This
 * store is what the app knows about it, per vault: the strip on top of the app
 * counts the files read (`IndexBuildNotice`), and whoever plans a write from
 * the index asks the vault's query service, which asks here
 * (`indexWholenessFor`, core `indexWholeness.ts`): over a whole index it goes
 * on, otherwise it is refused with the reason.
 *
 * Per vault, not "the" build: the desktop's central window runs one vault
 * runtime for every vault any window holds (`VaultHost`), and two of them can
 * build at once. The window that runs a vault writes its entry; every other
 * window that shows it mirrors that entry (`applyIndexBuildState`) — none of
 * them guesses.
 *
 * A vault whose index is whole has no entry. "building" ends in "whole" (a
 * full scan went through), "failed" (the scan did not; the next one that goes
 * through makes it whole) or "closed" (the vault was closed meanwhile).
 */

const states = new Map<string, IndexNotWholeState>();
const listeners = new Set<() => void>();
const changeWaiters = new Map<string, Array<(state: IndexWholenessState) => void>>();
/** Progress comes per file; the screens hear of it at most this often — less than once a frame. */
const NOTIFY_INTERVAL_MS = 200;
let lastNotified = 0;
let trailing: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  lastNotified = Date.now();
  if (trailing) { clearTimeout(trailing); trailing = null; }
  for (const listener of listeners) listener();
}

function changed(vaultId: string): void {
  const waiting = changeWaiters.get(vaultId);
  changeWaiters.delete(vaultId);
  const now = indexBuildState(vaultId);
  for (const resolve of waiting ?? []) resolve(now);
  notify();
}

export function subscribeIndexBuild(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** How whole the index of `vaultId` is. */
export function indexBuildState(vaultId: string): IndexWholenessState {
  // One object for "whole": the screens read this as an external store snapshot.
  return states.get(vaultId) ?? WHOLE;
}
const WHOLE: IndexWholenessState = Object.freeze({ kind: "whole" as const });

/** Whether the index of this vault is being built right now. */
export function isIndexBuilding(vaultId: string): boolean {
  return states.get(vaultId)?.kind === "building";
}

/** The window that runs the vault: a scan of an index that is not whole begins. */
export function beginIndexBuild(vaultId: string): void {
  states.set(vaultId, { kind: "building", done: 0, total: 0 });
  changed(vaultId);
}

/** Per file; ignored unless this vault's build is running. Heard at most every 200 ms. */
export function reportIndexBuild(vaultId: string, done: number, total: number): void {
  if (!isIndexBuilding(vaultId)) return;
  states.set(vaultId, { kind: "building", done, total });
  const wait = NOTIFY_INTERVAL_MS - (Date.now() - lastNotified);
  if (wait <= 0) notify();
  else if (!trailing) trailing = setTimeout(notify, wait);
}

/** A full scan went through: the index of this vault is whole. */
export function markIndexWhole(vaultId: string): void {
  if (!states.has(vaultId)) return;
  states.delete(vaultId);
  changed(vaultId);
}

/** The scan that was to make the index whole failed; the next one that goes through will. */
export function markIndexFailed(vaultId: string, reason: string): void {
  states.set(vaultId, { kind: "failed", reason });
  changed(vaultId);
}

/**
 * The vault was closed (or another one opened in its place): whoever waits for
 * it is refused, and the entry goes — a vault opened again starts over.
 */
export function markIndexClosed(vaultId: string): void {
  if (!states.has(vaultId)) return;
  states.set(vaultId, { kind: "closed" });
  changed(vaultId);
  states.delete(vaultId);
}

/** A window that does not run the vault: what the window that runs it said (`indexBuildState` there). */
export function applyIndexBuildState(vaultId: string, state: IndexWholenessState): void {
  const before = states.get(vaultId);
  if (state.kind === "whole") {
    if (!before) return;
    states.delete(vaultId);
  } else {
    states.set(vaultId, state);
    if (before && state.kind === "building" && before.kind === "building") {
      // Progress only: heard at the pace of the owner, no change for waiters.
      notify();
      return;
    }
  }
  changed(vaultId);
  if (state.kind === "closed") states.delete(vaultId);
}

/** The vault's wholeness as its query service asks it (core `IndexWholeness`). */
export function indexWholenessFor(vaultId: string): IndexWholeness {
  return {
    state: () => indexBuildState(vaultId),
    changed: () => new Promise<IndexWholenessState>((resolve) => {
      const list = changeWaiters.get(vaultId) ?? [];
      list.push(resolve);
      changeWaiters.set(vaultId, list);
    }),
  };
}

/** What a refusal says to the person who asked (`IndexNotWholeError`). */
export function indexNotWholeText(state: IndexNotWholeState): string {
  if (state.kind === "building") {
    return state.total > 0
      ? i18n.t("mobile.indexNotWhole", { done: state.done, total: state.total })
      : i18n.t("mobile.indexNotWholeWalk");
  }
  if (state.kind === "failed") return i18n.t("mobile.indexNotWholeFailed");
  return i18n.t("mobile.indexNotWholeClosed");
}

/** For tests: forget every vault. */
export function resetIndexBuildsForTests(): void {
  states.clear();
  for (const list of changeWaiters.values()) for (const resolve of list) resolve({ kind: "closed" });
  changeWaiters.clear();
}
