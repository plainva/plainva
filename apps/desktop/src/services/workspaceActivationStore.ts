import { useSyncExternalStore } from "react";

/**
 * The one running conversion of a vault into an encrypted workspace, as the
 * app sees it (finding 2026-09-03, K8).
 *
 * The progress used to live as local state inside the setup wizard, which is
 * a child of the security settings page. Any navigation inside the settings
 * hid it (inactive pages are visibility-hidden) and closing the settings
 * unmounted it — while the sweep kept running with nobody watching. This store
 * carries the same numbers at module level, so a surface mounted ABOVE the
 * settings can show them regardless of what the user clicks meanwhile.
 *
 * Only one conversion runs at a time: a second vault cannot be converted from
 * the same window while the first is still sweeping (the vault context is one
 * per window), so a single slot is the honest shape.
 */
export type WorkspaceActivationKind = "activate" | "resume";

export type WorkspaceActivationSnapshot =
  | { phase: "idle" }
  | { phase: "running"; vaultPath: string; kind: WorkspaceActivationKind; done: number; total: number }
  | { phase: "error"; vaultPath: string; kind: WorkspaceActivationKind; message: string };

const IDLE: WorkspaceActivationSnapshot = { phase: "idle" };
let snapshot: WorkspaceActivationSnapshot = IDLE;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const workspaceActivationStore = {
  get(): WorkspaceActivationSnapshot {
    return snapshot;
  },
  start(vaultPath: string, kind: WorkspaceActivationKind): void {
    snapshot = { phase: "running", vaultPath, kind, done: 0, total: 0 };
    emit();
  },
  progress(done: number, total: number): void {
    if (snapshot.phase !== "running") return;
    if (snapshot.done === done && snapshot.total === total) return;
    snapshot = { ...snapshot, done, total };
    emit();
  },
  /** The sweep is queued and the vault has been reloaded: nothing left to watch. */
  finish(): void {
    if (snapshot.phase === "idle") return;
    snapshot = IDLE;
    emit();
  },
  fail(message: string): void {
    if (snapshot.phase === "idle") return;
    snapshot = { phase: "error", vaultPath: snapshot.vaultPath, kind: snapshot.kind, message };
    emit();
  },
  /** The user read the failure; the settings page carries it on as `lastError`. */
  dismiss(): void {
    if (snapshot.phase !== "error") return;
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

export function useWorkspaceActivation(): WorkspaceActivationSnapshot {
  return useSyncExternalStore(workspaceActivationStore.subscribe, workspaceActivationStore.get);
}
