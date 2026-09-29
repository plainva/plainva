import { getMobileWorkspaceStatus, loadMobileWorkspaceRuntime } from "./mobileWorkspaceSecurity";

/**
 * Is the vault a sealed workspace this device cannot open right now?
 *
 * The same two questions `ShareInbox` asks: a phase other than `active`, or an
 * active phase whose runtime is not in memory because the vault was locked. A
 * vault without a workspace is never locked. One answer for the widget
 * snapshot (which then goes out empty, not full-and-hidden) and the remark
 * notifier (which then does nothing at all), so the two cannot disagree about
 * a lock (plan Befunde 24.09., E7).
 */
export async function isMobileWorkspaceLocked(vaultId: string): Promise<boolean> {
  try {
    const status = await getMobileWorkspaceStatus(vaultId);
    if (!status) return false;
    if (status.phase !== "active") return true;
    return !(await loadMobileWorkspaceRuntime(vaultId));
  } catch {
    // An unanswerable question about a lock is answered with the lock.
    return true;
  }
}
