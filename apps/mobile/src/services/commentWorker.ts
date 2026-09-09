import type { MobileVault } from "./vaultService";

export interface MobileCommentWorker {
  triggerImmediate(): void;
  publishQueuedComments?(): Promise<void>;
  onCommentsChanged?: (paths: string[]) => void;
}

let active: { vault: MobileVault; worker: MobileCommentWorker } | null = null;

/** The store cannot send through a replacement worker belonging to another vault. */
export function mobileCommentWorker(vault: MobileVault): MobileCommentWorker | null {
  return active?.vault === vault ? active.worker : null;
}

export function setMobileCommentWorker(vault: MobileVault, worker: MobileCommentWorker): void {
  active = { vault, worker };
  worker.onCommentsChanged = paths => {
    if (active?.vault !== vault || active.worker !== worker) return;
    for (const path of paths) window.dispatchEvent(new CustomEvent("plainva-workspace-comments-changed", { detail: { path, vaultId: vault.vaultId } }));
  };
}
export function clearMobileCommentWorker(): void { active = null; }
