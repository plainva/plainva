import {
  DriveSyncTarget,
  DropboxSyncTarget,
  OneDriveSyncTarget,
  S3SyncTarget,
  SyncEngine,
  SyncWorker,
  WebDavSyncTarget,
  type ISyncTarget,
  type S3Credentials,
  type WebDavCredentials,
} from "@plainva/core";
import { getPlatformServices } from "@plainva/ui";
import { webdavFetch } from "../adapters/webdavHttp";
import type { MobileVault } from "./vaultService";

/**
 * Mobile sync bootstrap (M3), mirroring the desktop wiring: the engine
 * pushes through the conflict-aware chain, the worker pulls through the
 * backup adapter, and every core guard (three-way merge, .CONFLICT,
 * mass-deletion brake) applies unchanged. ONE provider is active at a time
 * (desktop XOR rule). Requires the native SQLite queue, so sync is
 * unavailable on the plain web dev server (same rule as search).
 *
 * Providers: WebDAV/Nextcloud and S3 (form-based) plus Google Drive,
 * OneDrive and Dropbox (system-browser OAuth via oauthService).
 */

const CRED_KEY = "sync_provider_mobile";
/** Pre-provider-refactor slot; migrated transparently on first read. */
const LEGACY_WEBDAV_KEY = "webdav_credentials_mobile";

export interface DriveMobileCredentials {
  clientId: string;
  /** Only for BYO desktop-type clients; Android OAuth clients have none. */
  clientSecret?: string;
  refreshToken: string;
  rootFolderName?: string;
}

export interface OneDriveMobileCredentials {
  clientId: string;
  refreshToken: string;
  rootFolderName?: string;
}

export interface DropboxMobileCredentials {
  appKey: string;
  refreshToken: string;
  rootPath?: string;
}

export type MobileSyncProvider =
  | { provider: "webdav"; creds: WebDavCredentials }
  | { provider: "s3"; creds: S3Credentials }
  | { provider: "drive"; creds: DriveMobileCredentials }
  | { provider: "onedrive"; creds: OneDriveMobileCredentials }
  | { provider: "dropbox"; creds: DropboxMobileCredentials };

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

export async function getStoredProvider(): Promise<MobileSyncProvider | null> {
  const store = getPlatformServices().credentials;
  const stored = await store.readSecret<MobileSyncProvider>(CRED_KEY);
  if (stored && stored.provider) return stored;
  const legacy = await store.readSecret<WebDavCredentials>(LEGACY_WEBDAV_KEY);
  if (legacy && legacy.url) return { provider: "webdav", creds: legacy };
  return null;
}

export function syncPossible(v: MobileVault): boolean {
  return v.syncQueue !== null && v.syncRepo !== null;
}

/** Starts the worker for stored credentials; no-op without credentials/queue. */
export async function startSyncIfConfigured(v: MobileVault): Promise<void> {
  if (worker || !syncPossible(v)) return;
  const stored = await getStoredProvider();
  if (!stored) {
    v.markFirstSyncComplete();
    return;
  }
  startWorker(v, stored);
}

/** Saves the provider, enqueues the local files once and starts the worker. */
export async function connectProvider(v: MobileVault, p: MobileSyncProvider): Promise<void> {
  if (!syncPossible(v)) throw new Error("sync requires the native SQLite queue");
  const store = getPlatformServices().credentials;
  await store.writeSecret(CRED_KEY, p);
  await store.removeSecret(LEGACY_WEBDAV_KEY);
  await v.syncQueue!.enqueueAllLocalFiles();
  stopSync();
  startWorker(v, p);
}

export async function disconnectProvider(): Promise<void> {
  stopSync();
  const store = getPlatformServices().credentials;
  await store.removeSecret(CRED_KEY);
  await store.removeSecret(LEGACY_WEBDAV_KEY);
  setState({ status: "off", message: null });
}

export function syncNow(): void {
  worker?.triggerImmediate();
}

let kickTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced push kick after local edits — no waiting for the 30 s tick. */
export function syncSoon(): void {
  if (!worker) return;
  if (kickTimer) clearTimeout(kickTimer);
  kickTimer = setTimeout(() => {
    kickTimer = null;
    worker?.triggerImmediate();
  }, 2000);
}

export function stopSync(): void {
  worker?.stop();
  worker = null;
}

function buildTarget(p: MobileSyncProvider): ISyncTarget {
  // OneDrive and Dropbox ROTATE refresh tokens: persist every rotation
  // immediately or the stored token goes stale (desktop lesson).
  const persistRotation = () => {
    void getPlatformServices().credentials.writeSecret(CRED_KEY, p).catch(() => {});
  };
  switch (p.provider) {
    case "s3":
      return new S3SyncTarget(p.creds, webdavFetch);
    case "drive":
      return new DriveSyncTarget(
        {
          clientId: p.creds.clientId,
          clientSecret: p.creds.clientSecret ?? "",
          refreshToken: p.creds.refreshToken,
          rootFolderName: p.creds.rootFolderName,
        },
        webdavFetch,
      );
    case "onedrive": {
      const target = new OneDriveSyncTarget(
        {
          clientId: p.creds.clientId,
          refreshToken: p.creds.refreshToken,
          rootFolderName: p.creds.rootFolderName,
        },
        webdavFetch,
      );
      target.onTokensRefreshed = (_accessToken, refreshToken) => {
        if (!refreshToken || refreshToken === p.creds.refreshToken) return;
        p.creds.refreshToken = refreshToken;
        persistRotation();
      };
      return target;
    }
    case "dropbox": {
      const target = new DropboxSyncTarget(
        {
          appKey: p.creds.appKey,
          refreshToken: p.creds.refreshToken,
          rootPath: p.creds.rootPath,
        },
        webdavFetch,
      );
      target.onTokensRefreshed = (_accessToken, refreshToken) => {
        if (!refreshToken || refreshToken === p.creds.refreshToken) return;
        p.creds.refreshToken = refreshToken;
        persistRotation();
      };
      return target;
    }
    default:
      return new WebDavSyncTarget(p.creds, webdavFetch);
  }
}

function startWorker(v: MobileVault, p: MobileSyncProvider): void {
  v.enableSyncEnqueue();
  const target = buildTarget(p);
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
