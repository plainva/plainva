import { useEffect } from "react";
import { sweepMobilePinboardDrafts } from "./baseOps";
import type { MobileVault } from "./vaultService";

/**
 * Finishes what an app that was closed or killed during a pinboard entry left
 * behind (plan Befunde 2026-09-24, E15), each time a vault is opened — at the
 * start and after a switch. An empty draft goes the way closing its page would
 * have taken it; anything that changed since Plainva wrote it stays. A draft
 * whose entry page is open right now is left alone.
 *
 * Out of the shell for the same reason as `useBackupSchedule`: App.tsx has a
 * line budget so feature blocks live next to their service.
 */
export function usePinboardDraftSweep(vault: MobileVault | null): void {
  useEffect(() => {
    if (!vault) return;
    void sweepMobilePinboardDrafts(vault).catch((e) => console.warn("[pinboard] finishing drafts failed", e));
  }, [vault]);
}
