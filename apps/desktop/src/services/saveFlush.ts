import { waitForPendingWrites } from "./pendingWrites";

/** A window-local request. Each matching editor joins before dispatch returns. */
export interface SaveFlushRequest {
  path: string;
  vaultPath?: string;
  waitUntil(write: Promise<void>): void;
}

/**
 * Waits for actual editor saves, including writes from an unmounted editor.
 * No listener means no open buffer; a slow or failed write is never converted
 * into a successful timeout. Multiple panes must all finish before a restore.
 */
export async function requestSaveFlush(path: string, vaultPath?: string): Promise<void> {
  const writes: Promise<void>[] = [];
  const detail: SaveFlushRequest = { path, vaultPath, waitUntil: (write) => { writes.push(write); } };
  window.dispatchEvent(new CustomEvent("plainva-flush-pending-save", { detail }));
  writes.push(waitForPendingWrites(path, vaultPath));
  const results = await Promise.allSettled(writes);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}
