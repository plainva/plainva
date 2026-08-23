import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { SyncStatus, SyncProgress, SyncErrorReason, NameCollision } from "@plainva/core";
import type { SyncProviderId } from "../contexts/VaultContext";
import { logDiagnostic } from "@plainva/ui";

/**
 * Sync status as a tiny external store (Gesamtplan Editor-Stabilitaet
 * 2026-07-05, P3/E2). The worker flips idle→syncing→idle on EVERY poll cycle
 * (15 s) — routed through the VaultContext state that re-rendered the whole
 * app (all useVault consumers) twice per tick. Only the status bar and the
 * sync-error UI actually care, so they subscribe here instead.
 *
 * Keyed by vault since stage D. It used to be one snapshot per process, which
 * was true while a process could only hold one open vault — with two, the
 * second worker's every poll overwrote the first one's status, and a status bar
 * would have reported a vault its window does not show. The key is passed in
 * rather than read from an ambient "current vault": every caller knows which
 * vault it means, and a store that guesses is the failure this split removes.
 */
export interface SyncStatusSnapshot {
  status: SyncStatus;
  message: string | null;
  /** Provider of the running sync worker (error UI deep-links into its form). */
  provider: SyncProviderId | null;
  /** Coarse progress of the current cycle (WP6); null = no active progress. */
  progress: SyncProgress | null;
  /**
   * Fatal-protocol reason of the current error, if any (Stilllegen P2). Lets the
   * sync-error dialog offer a connection-specific encryption reset for a bricked
   * content-E2E connection; undefined for ordinary (retryable) failures.
   */
  reason?: SyncErrorReason;
  /**
   * The failure is a missing sign-in on THIS device, stated by whoever set the
   * status instead of guessed from the message. `isSyncAuthenticationError`
   * reads German and English words only, so a locale like Japanese would never
   * match — and the dialog would offer "try again" for something no retry can
   * fix (P3, 2026-08-19).
   */
  authRecoverable?: boolean;
  /** With `retrying` only: wall clock of the next attempt (round 3, R4). */
  retryAt?: number;
  /**
   * Paths the remote cannot tell apart — a decision, not a failure (finding
   * 2026-08-21). Kept beside the status because the sync keeps working for
   * every other file, and the card that explains it needs the pairs rather
   * than the sentence the core used to build in English.
   */
  collisions: readonly NameCollision[];
}

const IDLE: SyncStatusSnapshot = { status: "idle", message: null, provider: null, progress: null, reason: undefined, collisions: [] };

const listeners = new Set<() => void>();

/** Recent sync errors (P4.3): shown in the settings' sync section. */
export interface SyncErrorEntry {
  ts: number;
  message: string;
  provider: SyncProviderId | null;
  reason?: SyncErrorReason;
  authRecoverable?: boolean;
}
export type SyncErrorSnapshot = SyncErrorEntry;
const MAX_ERROR_HISTORY = 20;

interface VaultSyncState {
  snapshot: SyncStatusSnapshot;
  errorHistory: SyncErrorEntry[];
}

const byVault = new Map<string, VaultSyncState>();
const NO_ERRORS: readonly SyncErrorEntry[] = [];

function stateOf(vaultPath: string): VaultSyncState {
  let st = byVault.get(vaultPath);
  if (!st) {
    st = { snapshot: IDLE, errorHistory: [] };
    byVault.set(vaultPath, st);
  }
  return st;
}

function emit() {
  for (const l of listeners) l();
}

export const syncStatusStore = {
  /** Null (no vault open) reads as idle — the splash has no sync to report. */
  get(vaultPath: string | null): SyncStatusSnapshot {
    if (!vaultPath) return IDLE;
    return byVault.get(vaultPath)?.snapshot ?? IDLE;
  },
  set(vaultPath: string, next: Partial<SyncStatusSnapshot>) {
    const st = stateOf(vaultPath);
    const snapshot = st.snapshot;
    // A temporary failure counts as a transition too: the surface deliberately
    // stops shouting about it, so the history is the only place its raw text
    // survives (round 3, R4).
    const wasFailure = (snapshot.status === "error" || snapshot.status === "retrying") && snapshot.message;
    const merged = { ...snapshot, ...next };
    // `authRecoverable` belongs to ONE failure. Merging would carry it into the
    // next status, so a long-resolved sign-in problem would keep sending later
    // network errors to the settings instead of offering a retry.
    if ((next.status !== undefined || next.message !== undefined) && next.authRecoverable === undefined) {
      merged.authRecoverable = undefined;
    }
    st.snapshot = merged;
    if (
      (merged.status === "error" || merged.status === "retrying") &&
      merged.message &&
      merged.message !== (wasFailure || null)
    ) {
      st.errorHistory.push({
        ts: Date.now(),
        message: merged.message,
        provider: merged.provider,
        reason: merged.reason,
        authRecoverable: merged.authRecoverable,
      });
      if (st.errorHistory.length > MAX_ERROR_HISTORY) st.errorHistory.splice(0, st.errorHistory.length - MAX_ERROR_HISTORY);
      logDiagnostic("sync", merged.message);
    }
    emit();
  },
  getErrorHistory(vaultPath: string | null): readonly SyncErrorEntry[] {
    if (!vaultPath) return NO_ERRORS;
    return byVault.get(vaultPath)?.errorHistory ?? NO_ERRORS;
  },
  getLatestError(vaultPath: string | null): SyncErrorEntry | null {
    const h = syncStatusStore.getErrorHistory(vaultPath);
    return h[h.length - 1] ?? null;
  },
  /**
   * Drops everything this vault said, status and error history alike.
   *
   * The history used to be one process-wide list, so a failing vault's errors
   * kept showing in the sync settings of a DIFFERENT vault opened afterwards —
   * which is why the reset had to clear it. Keyed, that cannot happen at all;
   * the reset now only frees what a closed vault left behind.
   */
  reset(vaultPath: string) {
    byVault.delete(vaultPath);
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Tests only: forget every vault. */
  resetAll() {
    byVault.clear();
    emit();
  },
};

/** Captures the failed attempt before an automatic retry changes live status. */
export function captureSyncErrorSnapshot(vaultPath: string | null): SyncErrorSnapshot | null {
  const current = syncStatusStore.get(vaultPath);
  if (current.status === "error" && current.message) {
    const latest = syncStatusStore.getLatestError(vaultPath);
    if (latest?.message === current.message && latest.provider === current.provider) return latest;
    return {
      ts: Date.now(),
      message: current.message,
      provider: current.provider,
      reason: current.reason,
      authRecoverable: current.authRecoverable,
    };
  }
  return syncStatusStore.getLatestError(vaultPath);
}

/** Authentication failures are the only errors for which reconnect is useful. */
export function isSyncAuthenticationError(message: string): boolean {
  return /(?:\b401\b|unauthori[sz]ed|invalid[_ -]?grant|invalid[_ -]?token|token.*(?:expired|revoked)|refresh token|authentication|authentifizierung|anmeldung.*abgelaufen)/i.test(message);
}

export function useSyncStatus(vaultPath: string | null): SyncStatusSnapshot {
  const read = useCallback(() => syncStatusStore.get(vaultPath), [vaultPath]);
  return useSyncExternalStore(syncStatusStore.subscribe, read);
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
export function useDisplaySyncStatus(vaultPath: string | null, delayMs = 400): SyncStatusSnapshot {
  const [display, setDisplay] = useState<SyncStatusSnapshot>(() => displayOf(syncStatusStore.get(vaultPath), false));
  useEffect(() => {
    let timer: number | null = null;
    // Once "syncing" has been revealed (past the delay) it stays shown until the
    // status leaves syncing — so progress ticks (WP6) update the count in place
    // instead of re-collapsing the display to idle on every emit.
    let revealed = false;
    const commit = (next: SyncStatusSnapshot) => setDisplay((prev) => (sameSnap(prev, next) ? prev : next));
    const recompute = () => {
      const snap = syncStatusStore.get(vaultPath);
      if (snap.status === "syncing") {
        if (revealed) {
          commit(snap); // already shown -> flow updates (progress) straight through
          return;
        }
        commit(displayOf(snap, false)); // keep the last non-syncing display
        if (timer === null) {
          timer = window.setTimeout(() => {
            timer = null;
            if (syncStatusStore.get(vaultPath).status === "syncing") {
              revealed = true;
              commit(syncStatusStore.get(vaultPath));
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
  }, [vaultPath, delayMs]);
  return display;
}
