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
import { getMobileVault, switchVault, type MobileVault } from "./vaultService";
import {
  addVault,
  getActiveVaultEntry,
  getVaultEntry,
  newVaultId,
  updateVault,
} from "./vaultRegistry";

/**
 * Mobile sync bootstrap (M3), mirroring the desktop wiring: the engine
 * pushes through the conflict-aware chain, the worker pulls through the
 * backup adapter, and every core guard (three-way merge, .CONFLICT,
 * mass-deletion brake) applies unchanged. Requires the native SQLite
 * queue, so sync is unavailable on the plain web dev server (same rule as
 * search).
 *
 * Isolation rework (M3.5): every connection owns a dedicated vault
 * container — connecting creates a fresh, EMPTY vault and pulls into it;
 * nothing from another vault is ever enqueued toward a provider. One
 * credential slot per vault id.
 *
 * Providers: WebDAV/Nextcloud and S3 (form-based) plus Google Drive,
 * OneDrive and Dropbox (system-browser OAuth via oauthService).
 */

const credKeyFor = (vaultId: string) => `sync_provider_mobile_${vaultId}`;

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

export async function getStoredProvider(vaultId: string): Promise<MobileSyncProvider | null> {
  const store = getPlatformServices().credentials;
  const stored = await store.readSecret<MobileSyncProvider>(credKeyFor(vaultId));
  return stored && stored.provider ? stored : null;
}

export function syncPossible(v: MobileVault): boolean {
  return v.syncQueue !== null && v.syncRepo !== null;
}

/** Starts the worker for stored credentials; no-op without credentials/queue. */
export async function startSyncIfConfigured(v: MobileVault): Promise<void> {
  if (worker || !syncPossible(v)) return;
  const entry = await getVaultEntry(v.vaultId);
  const stored = entry?.paused ? null : await getStoredProvider(v.vaultId);
  if (!stored) {
    v.markFirstSyncComplete();
    setState({ status: "off", message: null });
    return;
  }
  startWorker(v, stored);
}

/** Human-readable vault name for a fresh connection. */
function providerVaultName(p: MobileSyncProvider): string {
  switch (p.provider) {
    case "webdav": {
      try {
        return `WebDAV · ${new URL(p.creds.url).hostname}`;
      } catch {
        return "WebDAV";
      }
    }
    case "s3":
      return `S3 · ${p.creds.bucket}`;
    case "drive":
      return `Google Drive · ${p.creds.rootFolderName || "Plainva"}`;
    case "onedrive":
      return `OneDrive · ${p.creds.rootFolderName || "Plainva"}`;
    default:
      return `Dropbox · ${p.creds.rootPath || "/"}`;
  }
}

/**
 * Creates a fresh, EMPTY vault container for this connection, stores the
 * credentials under its slot and switches to it — the first cycle pulls
 * the remote content into the new vault. Files from other vaults are
 * never enqueued (isolation requirement, maintainer 2026-07-10).
 */
export async function connectProvider(v: MobileVault, p: MobileSyncProvider): Promise<void> {
  if (!syncPossible(v)) throw new Error("sync requires the native SQLite queue");
  const id = newVaultId();
  await getPlatformServices().credentials.writeSecret(credKeyFor(id), p);
  await addVault({ id, name: providerVaultName(p), provider: p.provider });
  await switchVault(id);
}

/**
 * Pauses sync for a vault ("Trennen"): the worker stops but the stored
 * credentials stay, so resuming is one tap (no re-auth). Pausing a
 * non-active vault leaves the running worker alone.
 */
export async function pauseProvider(vaultId: string): Promise<void> {
  await updateVault(vaultId, { paused: true });
  if ((await getActiveVaultEntry()).id === vaultId) {
    stopSync();
    setState({ status: "off", message: null });
  }
}

/** Resumes a paused vault; restarts the worker when it is the active one. */
export async function resumeProvider(vaultId: string): Promise<void> {
  await updateVault(vaultId, { paused: false });
  if ((await getActiveVaultEntry()).id === vaultId) {
    await startSyncIfConfigured(await getMobileVault());
  }
}

/** Final credential cleanup when a vault is deleted. */
export async function purgeCredentials(vaultId: string): Promise<void> {
  await getPlatformServices().credentials.removeSecret(credKeyFor(vaultId));
}

export function syncNow(): void {
  // Full listing, not a bare cursor cycle: brand-new remote files only
  // arrive through a listing, and on mobile the periodic one (every 20
  // foreground cycles) practically never comes around (Pixel report).
  worker?.triggerFullListing();
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

function buildTarget(p: MobileSyncProvider, credKey: string): ISyncTarget {
  // OneDrive and Dropbox ROTATE refresh tokens: persist every rotation
  // immediately or the stored token goes stale (desktop lesson).
  const persistRotation = () => {
    void getPlatformServices().credentials.writeSecret(credKey, p).catch(() => {});
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
  const target = buildTarget(p, credKeyFor(v.vaultId));
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
    // MVP dialog via the Dialog plugin (window.confirm silently returns
    // false in the Capacitor 8 WebView); Cancel takes the safe restore
    // branch.
    void import("@capacitor/dialog").then(async ({ Dialog }) => {
      const { value } = await Dialog.confirm({
        title: "Sync",
        message: `${pendingDeletes}/${syncedTotal} synced files are queued for REMOTE deletion. Delete them in the cloud? Cancel restores them from the remote.`,
      });
      if (value) w.approveMassDeletion();
      else void w.discardMassDeletion();
    });
  };
  worker = w;
  setState({ status: "idle", message: null });
  w.start();
  w.triggerImmediate();
}
