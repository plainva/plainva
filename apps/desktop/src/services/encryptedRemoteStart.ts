import { encryptedRemoteRetryDelay, type EncryptedRemoteGate } from "@plainva/ui";

/**
 * Which sync a desktop vault starts (R8), decided before any of them is built.
 *
 * `held`: the folder holds a workspace this device has not joined, it left
 * one, or the folder could not be confirmed - nothing plain is built, not the
 * file worker and not the settings-only sync. A member without its keys goes
 * to the workspace branch whatever the files switch says: that branch holds a
 * locked or key-less workspace and says so; the settings-only sync would send
 * the plain profile into the workspace's folder.
 */
export type DesktopSyncBranch = "held" | "settingsOnly" | "workspace" | "plain";

export function desktopSyncBranch(input: {
  gate: EncryptedRemoteGate | null;
  filesRun: string;
  member: boolean;
  hasRuntime: boolean;
}): DesktopSyncBranch {
  if (input.gate && input.gate.kind !== "plain") return "held";
  if (input.filesRun === "settingsOnly" && !(input.member && !input.hasRuntime)) return "settingsOnly";
  if (input.member) return "workspace";
  return "plain";
}

/**
 * Asks a held folder again - only the probe, not the vault (R8, review point
 * 6): with backoff, waiting while the machine is offline, and never for a load
 * that was replaced or a vault that was closed meanwhile. A verdict other than
 * "still unconfirmed" is handed on once; the caller reloads the vault then.
 */
export function recheckEncryptedRemote(input: {
  decide: () => Promise<EncryptedRemoteGate>;
  signal: AbortSignal;
  onStillHeld: (gate: EncryptedRemoteGate | null) => void;
  onVerdict: (gate: EncryptedRemoteGate) => void;
  isOnline?: () => boolean;
  /** Subscribes to the machine coming back online; returns the unsubscribe. */
  whenOnline?: (callback: () => void) => () => void;
}): { cancel: () => void } {
  const isOnline = input.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const whenOnline = input.whenOnline ?? ((callback: () => void) => {
    window.addEventListener("online", callback, { once: true });
    return () => window.removeEventListener("online", callback);
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  let attempt = 0;
  const cancel = () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    unsubscribe?.();
  };
  const schedule = () => {
    if (cancelled || input.signal.aborted) return;
    timer = setTimeout(() => void check(), encryptedRemoteRetryDelay(attempt));
  };
  const check = async () => {
    if (cancelled || input.signal.aborted) return;
    if (!isOnline()) {
      unsubscribe = whenOnline(() => { unsubscribe = null; void check(); });
      return;
    }
    const gate = await input.decide().catch(() => null);
    if (cancelled || input.signal.aborted) return;
    if (!gate || gate.kind === "unconfirmed") {
      input.onStillHeld(gate);
      attempt += 1;
      schedule();
      return;
    }
    cancel();
    input.onVerdict(gate);
  };
  input.signal.addEventListener("abort", cancel, { once: true });
  schedule();
  return { cancel };
}
