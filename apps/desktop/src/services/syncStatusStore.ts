import { useEffect, useState, useSyncExternalStore } from "react";
import type { SyncStatus, SyncProgress } from "@plainva/core";
import type { SyncProviderId } from "../contexts/VaultContext";
import { logDiagnostic } from "@plainva/ui";

/**
 * Sync status as a tiny external store (Gesamtplan Editor-Stabilitaet
 * 2026-07-05, P3/E2). The worker flips idle→syncing→idle on EVERY poll cycle
 * (15 s) — routed through the VaultContext state that re-rendered the whole
 * app (all useVault consumers) twice per tick. Only the status bar and the
 * sync-error UI actually care, so they subscribe here instead.
 */
export interface SyncStatusSnapshot {
  status: SyncStatus;
  message: string | null;
  /** Provider of the running sync worker (error UI deep-links into its form). */
  provider: SyncProviderId | null;
  /** Coarse progress of the current cycle (WP6); null = no active progress. */
  progress: SyncProgress | null;
}

const IDLE: SyncStatusSnapshot = { status: "idle", message: null, provider: null, progress: null };

let snapshot: SyncStatusSnapshot = IDLE;
const listeners = new Set<() => void>();

/** Recent sync errors (P4.3): shown in the settings' sync section. */
export interface SyncErrorEntry {
  ts: number;
  message: string;
}
const MAX_ERROR_HISTORY = 20;
const errorHistory: SyncErrorEntry[] = [];

function emit() {
  for (const l of listeners) l();
}

export const syncStatusStore = {
  get(): SyncStatusSnapshot {
    return snapshot;
  },
  set(next: Partial<SyncStatusSnapshot>) {
    const wasError = snapshot.status === "error" && snapshot.message;
    snapshot = { ...snapshot, ...next };
    // Record each error TRANSITION (not every repeated error tick).
    if (snapshot.status === "error" && snapshot.message && snapshot.message !== (wasError || null)) {
      errorHistory.push({ ts: Date.now(), message: snapshot.message });
      if (errorHistory.length > MAX_ERROR_HISTORY) errorHistory.splice(0, errorHistory.length - MAX_ERROR_HISTORY);
      logDiagnostic("sync", snapshot.message);
    }
    emit();
  },
  getErrorHistory(): readonly SyncErrorEntry[] {
    return errorHistory;
  },
  reset() {
    snapshot = IDLE;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useSyncStatus(): SyncStatusSnapshot {
  return useSyncExternalStore(syncStatusStore.subscribe, syncStatusStore.get);
}

function sameSnap(a: SyncStatusSnapshot, b: SyncStatusSnapshot): boolean {
  return (
    a.status === b.status &&
    a.message === b.message &&
    a.provider === b.provider &&
    a.progress?.phase === b.progress?.phase &&
    a.progress?.current === b.progress?.current &&
    a.progress?.total === b.progress?.total
  );
}

/** The displayed snapshot with "syncing" collapsed to "idle" (anti-flicker). */
function displayOf(snap: SyncStatusSnapshot, showSyncing: boolean): SyncStatusSnapshot {
  return snap.status === "syncing" && !showSyncing ? { ...snap, status: "idle" } : snap;
}

/**
 * Display variant with anti-flicker (E2): a fast no-op poll cycle must not
 * blink the UI, so "syncing" only shows once a cycle runs longer than
 * `delayMs`. Errors and idle pass through immediately. It keeps its OWN state
 * and re-renders the consumer ONLY when the DISPLAYED value changes.
 *
 * IMPORTANT (2026-07-06): subscribe to this ONLY from small leaf components
 * that actually show sync state (the status bar, the switcher icon, the error
 * dialog). It is NOT enough to rely on the collapse: a real network cycle
 * (Dropbox/…) outlasts `delayMs`, so the display genuinely flips
 * idle→syncing→idle every poll. When App.tsx subscribed at the top level that
 * flip re-rendered the WHOLE tree twice per 15 s tick — remounting the
 * read-mode Mermaid diagram (flicker) and churning the live editor around the
 * caret. Keeping the subscription in leaves confines each flip to that leaf.
 */
export function useDisplaySyncStatus(delayMs = 400): SyncStatusSnapshot {
  const [display, setDisplay] = useState<SyncStatusSnapshot>(() => displayOf(syncStatusStore.get(), false));
  useEffect(() => {
    let timer: number | null = null;
    // Once "syncing" has been revealed (past the delay) it stays shown until the
    // status leaves syncing — so progress ticks (WP6) update the count in place
    // instead of re-collapsing the display to idle on every emit.
    let revealed = false;
    const commit = (next: SyncStatusSnapshot) => setDisplay((prev) => (sameSnap(prev, next) ? prev : next));
    const recompute = () => {
      const snap = syncStatusStore.get();
      if (snap.status === "syncing") {
        if (revealed) {
          commit(snap); // already shown -> flow updates (progress) straight through
          return;
        }
        commit(displayOf(snap, false)); // keep the last non-syncing display
        if (timer === null) {
          timer = window.setTimeout(() => {
            timer = null;
            if (syncStatusStore.get().status === "syncing") {
              revealed = true;
              commit(syncStatusStore.get());
            }
          }, delayMs);
        }
      } else {
        if (timer !== null) { window.clearTimeout(timer); timer = null; }
        revealed = false;
        commit(snap);
      }
    };
    const unsub = syncStatusStore.subscribe(recompute);
    recompute();
    return () => { unsub(); if (timer !== null) window.clearTimeout(timer); };
  }, [delayMs]);
  return display;
}
