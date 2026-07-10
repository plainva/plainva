import {
  SyncEngine,
  SyncWorker,
  WebDavSyncTarget,
  type WebDavCredentials,
} from "@plainva/core";
import { getPlatformServices } from "@plainva/ui";
import { webdavFetch } from "../adapters/webdavHttp";
import type { MobileVault } from "./vaultService";

/**
 * Mobile sync bootstrap (M3): WebDAV first, mirroring the desktop wiring —
 * the engine pushes through the conflict-aware chain, the worker pulls
 * through the backup adapter, and every guard (three-way merge, .CONFLICT,
 * mass-deletion brake) comes from the shared core unchanged. Requires the
 * native SQLite queue, so sync is unavailable on the plain web dev server
 * (same rule as search).
 */

const CRED_KEY = "webdav_credentials_mobile";

export type MobileSyncStatus = "off" | "idle" | "syncing" | "error";

interface SyncState {
  status: MobileSyncStatus;
  message: string | null;
}

let state: SyncState = { status: "off", message: null };
const listeners = new Set<() => void>();
let worker: SyncWorker | null = null;

function setState(next: SyncState): void {
  state = next;
  for (const l of listeners) l();
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncStatus(): SyncState {
  return state;
}

export async function getWebDavCredentials(): Promise<WebDavCredentials | null> {
  return getPlatformServices().credentials.readSecret<WebDavCredentials>(CRED_KEY);
}

export function syncPossible(v: MobileVault): boolean {
  return v.syncQueue !== null && v.syncRepo !== null;
}

/** Starts the worker for stored credentials; no-op without credentials/queue. */
export async function startSyncIfConfigured(v: MobileVault): Promise<void> {
  if (worker || !syncPossible(v)) return;
  const creds = await getWebDavCredentials();
  if (!creds || !creds.url) return;
  startWorker(v, creds);
}

/** Saves credentials, enqueues the local files once and starts the worker. */
export async function connectWebDav(v: MobileVault, creds: WebDavCredentials): Promise<void> {
  if (!syncPossible(v)) throw new Error("sync requires the native SQLite queue");
  await getPlatformServices().credentials.writeSecret(CRED_KEY, creds);
  await v.syncQueue!.enqueueAllLocalFiles();
  stopSync();
  startWorker(v, creds);
}

export async function disconnectWebDav(): Promise<void> {
  stopSync();
  await getPlatformServices().credentials.removeSecret(CRED_KEY);
  setState({ status: "off", message: null });
}

export function syncNow(): void {
  worker?.triggerImmediate();
}

export function stopSync(): void {
  worker?.stop();
  worker = null;
}

function startWorker(v: MobileVault, creds: WebDavCredentials): void {
  v.enableSyncEnqueue();
  const target = new WebDavSyncTarget(creds, webdavFetch);
  const engine = new SyncEngine(v.syncQueue!, target, v.files, v.syncRepo!);
  // Pulls write through the backup adapter (not the queueing chain) — the
  // worker does its own merge and manages sync_state (desktop pattern).
  const w = new SyncWorker(engine, target, v.syncRepo!, v.backup ?? v.adapter, v.syncQueue!, 30_000);
  w.onStatusChange = (status, errorMsg) => {
    setState({ status, message: errorMsg ?? null });
  };
  w.onFirstCycleComplete = () => {
    void v.syncQueue!.enqueueLocalOnlyFiles().catch(() => {});
    v.markFirstSyncComplete();
  };
  w.onFilesChanged = (paths) => {
    void v.reindexPaths(paths);
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
  };
  w.onMassDeletionPending = ({ pendingDeletes, syncedTotal }) => {
    // MVP dialog: native confirm; Cancel takes the safe restore branch.
    const ok = window.confirm(
      `${pendingDeletes}/${syncedTotal} synced files are queued for REMOTE deletion. Delete them in the cloud? Cancel restores them from the remote.`,
    );
    if (ok) w.approveMassDeletion();
    else void w.discardMassDeletion();
  };
  worker = w;
  setState({ status: "idle", message: null });
  w.start();
  w.triggerImmediate();
}
