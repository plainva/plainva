import { encryptedRemoteRetryDelay, type HeldFolderVerdict } from "@plainva/ui";

/**
 * Which sync a desktop vault starts (R8), decided before any of them is built.
 *
 * `plain` for nearly every vault: no probe, nothing awaited - its first
 * listing answers before its first write. `held` only for a vault that knows
 * something about its folder (a fact): the plain worker is built once the
 * held-folder rule allows it, in the background, never as part of opening the
 * vault. A member without its keys goes to the workspace branch whatever the
 * files switch says: that branch holds a locked or key-less workspace; the
 * settings-only sync would send the plain profile into the workspace's folder.
 */
export type DesktopSyncBranch = "held" | "settingsOnly" | "workspace" | "plain";

export function desktopSyncBranch(input: { held: boolean; filesRun: string; member: boolean; hasRuntime: boolean }): DesktopSyncBranch {
  if (input.filesRun === "settingsOnly" && !(input.member && !input.hasRuntime)) return "settingsOnly";
  if (input.member) return "workspace";
  return input.held ? "held" : "plain";
}

/**
 * Asks a held folder - at once, then again (R8, review point 5): `waiting`
 * with backoff, any verdict that needs the person stays until it is asked
 * again by hand or the machine comes back online. Never for a load that was
 * replaced or a vault that was closed. A verdict that allows the sync starts
 * the sync step only - never a reload of the vault.
 */
export function askHeldFolder(input: {
  decide: () => Promise<HeldFolderVerdict>;
  signal: AbortSignal;
  onWaiting: (verdict: HeldFolderVerdict, retryAt: number) => void;
  onHeld: (verdict: HeldFolderVerdict) => void;
  onStart: () => void;
  isOnline?: () => boolean;
  /** Subscribes to the machine coming back online; returns the unsubscribe. */
  whenOnline?: (callback: () => void) => () => void;
}): { cancel: () => void; askNow: () => void } {
  const isOnline = input.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  const whenOnline = input.whenOnline ?? ((callback: () => void) => {
    window.addEventListener("online", callback);
    return () => window.removeEventListener("online", callback);
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = false;
  let asking = false;
  let attempt = 0;
  const clearTimer = () => { if (timer) clearTimeout(timer); timer = null; };
  const unsubscribe = whenOnline(() => askNow());
  const cancel = () => { done = true; clearTimer(); unsubscribe(); };
  const ask = async () => {
    if (done || input.signal.aborted || asking) return;
    clearTimer();
    if (!isOnline()) return; // coming online asks again
    asking = true;
    let verdict: HeldFolderVerdict;
    try {
      verdict = await input.decide();
    } catch {
      verdict = { kind: "waiting" };
    } finally {
      asking = false;
    }
    if (done || input.signal.aborted) return;
    if (verdict.kind === "plain" || verdict.kind === "root-missing") {
      cancel();
      input.onStart();
      return;
    }
    if (verdict.kind === "waiting") {
      const delay = encryptedRemoteRetryDelay(attempt);
      attempt += 1;
      input.onWaiting(verdict, Date.now() + delay);
      timer = setTimeout(() => void ask(), delay);
      return;
    }
    input.onHeld(verdict);
  };
  const askNow = () => { attempt = 0; void ask(); };
  input.signal.addEventListener("abort", cancel, { once: true });
  void ask();
  return { cancel, askNow };
}
