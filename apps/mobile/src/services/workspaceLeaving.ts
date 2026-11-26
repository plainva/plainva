import { SqlWorkspaceStateStore } from "@plainva/core/workspace";
import { decommissionMobileWorkspace, markMobileEncryptionLift, mobileDecommissionUnfinished, type MobileLeaving } from "./mobileWorkspaceSecurity";
import { retireWorkspaceRuntime, withRuntimeStep } from "./syncService";
import type { MobileVault } from "./vaultService";

/**
 * Leaving the encrypted workspace on the phone — decommissioning it, or
 * lifting its encryption — as the Security area runs it, apart from the
 * screen so that what it decides is tested without one (review B2, round
 * 10, MG5): which state it clears, what it records that was asked for, when
 * the vault opens anew, and which row a decommission that stopped shows.
 */

/** The step's one reload (`withRuntimeStep`), by the screen that pressed it. */
const OWN = "security-area";

/**
 * The workspace state a decommission clears: the runtime's, or — where the
 * vault opened without its workspace after a decommission that passed its
 * gate and stopped — the one in its database.
 */
export function workspaceStateOf(vault: Pick<MobileVault, "workspaceState" | "db">): SqlWorkspaceStateStore | null {
  return vault.workspaceState ?? (vault.db ? new SqlWorkspaceStateStore(vault.db) : null);
}

/**
 * The sync stopped for the step, within the deadline (the step's `stop`):
 * where the vault had to be left, the step goes on with the new runtime and
 * its workspace state.
 */
export async function stopSyncLeaving(vault: MobileVault, stop: () => Promise<MobileVault>, renewedTo?: (fresh: MobileVault) => void): Promise<{ state: SqlWorkspaceStateStore | null } | null> {
  const on = await stop();
  if (on === vault) return null;
  renewedTo?.(on);
  return { state: workspaceStateOf(on) };
}

/**
 * Decommissions the vault's workspace, or lifts its encryption (`intent`),
 * holding its sync for the whole step. On success the vault opens anew
 * without its workspace. Past the gate — the status went, and the runtime
 * still carries the workspace in memory — that runtime is retired at once
 * (`retireWorkspaceRuntime`): it never gets a sync again, whatever follows
 * (review B2, rounds 10 and 11). A failure past the gate opens the vault anew
 * as well — also one after the decommission itself finished and removed its
 * fact (a lift that could not queue its files) — and the new runtime is held
 * by the fact of the gate where it still stands. `done` runs once the step's
 * work is through (a notice).
 */
export async function leaveWorkspaceStep(vault: MobileVault, intent: MobileLeaving, done?: () => void): Promise<void> {
  // "Past the gate", not "while the fact stands" (review B2, round 11): the lift's own steps after the decommission
  // come after its fact is gone.
  let pastGate = false;
  await withRuntimeStep({ vaultId: vault.vaultId, runtime: vault }, {
    work: async (stop) => {
      let on = vault;
      await decommissionMobileWorkspace({
        vaultId: vault.vaultId,
        state: workspaceStateOf(vault),
        stopSync: () => stopSyncLeaving(vault, stop, (fresh) => { on = fresh; }),
        runtime: vault.workspaceRuntime,
        intent,
        passedGate: () => {
          pastGate = true;
          retireWorkspaceRuntime(on, OWN);
        },
      });
      if (intent === "lift") {
        // The queue table lives in the vault's own database, which is still open
        // here — the reload boots a plain vault whose worker drains it.
        await on.syncQueue?.enqueueAllLocalFiles();
        await markMobileEncryptionLift(vault.vaultId);
      }
      done?.();
    },
    reload: { own: OWN, afterFailure: async () => pastGate },
  });
}

/** The row a decommission (or lift) that passed its gate and stopped shows in the Security area, by its locale key — or null. */
export async function unfinishedLeavingText(vaultId: string): Promise<"workspaceSecurity.decommissionUnfinished" | "workspaceSecurity.liftUnfinished" | null> {
  const leaving = await mobileDecommissionUnfinished(vaultId).catch(() => null);
  return leaving === "lift" ? "workspaceSecurity.liftUnfinished" : leaving ? "workspaceSecurity.decommissionUnfinished" : null;
}
