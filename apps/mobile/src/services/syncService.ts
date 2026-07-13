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
import { getPlatformServices, scaffoldVaultTemplate, type VaultTemplateDefinition } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { allowHttpOrigin, webdavFetch } from "../adapters/webdavHttp";
import { CapacitorVaultAdapter } from "../adapters/CapacitorVaultAdapter";
import { updateMobileSettings } from "./mobileSettings";
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
  /** Wall-clock stamp of the last cycle that finished cleanly (P5). */
  lastSyncAt: number | null;
  /** Cycle progress while syncing (package I: the desktop status-bar x/y). */
  progress: { current: number; total: number } | null;
  /** Last few error messages, newest first (package I transparency). */
  errorHistory: Array<{ at: number; message: string }>;
}

let state: SyncState = { status: "off", message: null, lastSyncAt: null, progress: null, errorHistory: [] };
const listeners = new Set<() => void>();
let worker: SyncWorker | null = null;

function setState(next: { status: MobileSyncStatus; message: string | null }): void {
  const finished = state.status === "syncing" && next.status === "idle";
  const errorHistory =
    next.status === "error" && next.message && next.message !== state.message
      ? [{ at: Date.now(), message: next.message }, ...state.errorHistory].slice(0, 5)
      : state.errorHistory;
  state = {
    ...next,
    lastSyncAt: finished ? Date.now() : state.lastSyncAt,
    progress: next.status === "syncing" ? state.progress : null,
    errorHistory,
  };
  for (const l of listeners) l();
}

function setProgress(progress: { current: number; total: number } | null): void {
  state = { ...state, progress };
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
 * "New vault with an online service" (2026-07-13): like connectProvider, but
 * the chosen structure template is scaffolded into the fresh container BEFORE
 * the vault becomes active — the worker only starts after switchVault, so no
 * cycle can observe a half-written structure. Against the (new, empty) cloud
 * folder the first pull is empty and `enqueueLocalOnlyFiles` uploads the
 * scaffold (the same first-sync path a filled local vault always takes).
 */
export async function createProviderVault(
  v: MobileVault,
  p: MobileSyncProvider,
  opts: { template: VaultTemplateDefinition | null; vaultName: string; subfoldersHeading: string },
): Promise<void> {
  if (!syncPossible(v)) throw new Error("sync requires the native SQLite queue");
  const id = newVaultId();
  const adapter = new CapacitorVaultAdapter(`vaults/${id}`);
  await adapter.initialize();
  await scaffoldVaultTemplate({
    adapter,
    template: opts.template,
    vaultName: opts.vaultName,
    subfoldersHeading: opts.subfoldersHeading,
  });
  const ts = opts.template?.settings;
  if (ts) {
    await updateMobileSettings({
      ...(ts.dailyNotesFolder !== undefined ? { dailyFolder: ts.dailyNotesFolder } : {}),
      ...(ts.templateFolder !== undefined ? { templateFolder: ts.templateFolder } : {}),
      ...(ts.dailyNoteTemplate !== undefined ? { dailyTemplate: ts.dailyNoteTemplate } : {}),
    });
  }
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

/**
 * Stops the worker AND waits for a running cycle (P3.4, finding M4): vault
 * switch/delete close or remove the per-vault database right after — a cycle
 * still downloading/writing must finish (or abort) first.
 */
export async function stopSyncAndDrain(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await w.stopAndDrain();
}

function buildTarget(p: MobileSyncProvider, credKey: string): ISyncTarget {
  // OneDrive and Dropbox ROTATE refresh tokens: persist every rotation
  // immediately or the stored token goes stale (desktop lesson). AWAITED and
  // failures PROPAGATE (P3.1b, finding M7): a rotation whose persistence
  // silently failed would lock the next app start out of sync — better to
  // surface it as a cycle error now (the in-memory token still works this
  // session, and the next refresh retries the persistence).
  const persistRotation = async () => {
    await getPlatformServices().credentials.writeSecret(credKey, p);
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
      target.onTokensRefreshed = async (_accessToken, refreshToken) => {
        if (!refreshToken || refreshToken === p.creds.refreshToken) return;
        p.creds.refreshToken = refreshToken;
        await persistRotation();
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
      target.onTokensRefreshed = async (_accessToken, refreshToken) => {
        if (!refreshToken || refreshToken === p.creds.refreshToken) return;
        p.creds.refreshToken = refreshToken;
        await persistRotation();
      };
      return target;
    }
    default:
      return new WebDavSyncTarget(p.creds, webdavFetch);
  }
}

/**
 * Lists remote folders under `path` for a NOT-yet-connected provider — feeds
 * the connect-time folder picker (#10). Builds a throwaway target from the
 * given credentials (Drive/OneDrive/Dropbox after OAuth, S3 from the form).
 * WebDAV browses relative to the entered base URL (core listFolders since
 * 2026-07-13). Passing the SAME provider object across calls matters:
 * OneDrive/Dropbox rotate the refresh token on use, and `buildTarget`'s
 * `onTokensRefreshed` mutates `p.creds` in place, so the eventual connect
 * uses the current token.
 */
export async function listProviderFolders(p: MobileSyncProvider, path: string): Promise<string[]> {
  if (p.provider === "webdav") void allowHttpOrigin(p.creds.url);
  else if (p.provider === "s3") void allowHttpOrigin(p.creds.endpoint);
  const target = buildTarget(p, credKeyFor("probe"));
  return target.listFolders ? target.listFolders(path) : [];
}

/** The picker's "new folder" row for a NOT-yet-connected provider (2026-07-13). */
export async function createProviderFolder(p: MobileSyncProvider, path: string): Promise<void> {
  if (p.provider === "webdav") void allowHttpOrigin(p.creds.url);
  else if (p.provider === "s3") void allowHttpOrigin(p.creds.endpoint);
  const target = buildTarget(p, credKeyFor("probe"));
  if (target.createFolder) await target.createFolder(path);
}

function startWorker(v: MobileVault, p: MobileSyncProvider): void {
  v.enableSyncEnqueue();
  // Origin policy (P4.3): user-configured servers must be allowed on the
  // native bridge before requests fly. Fire-and-forget is safe — a request
  // racing the registration fails ONE cycle and the next one self-heals.
  if (p.provider === "webdav") void allowHttpOrigin(p.creds.url);
  else if (p.provider === "s3") void allowHttpOrigin(p.creds.endpoint);
  const target = buildTarget(p, credKeyFor(v.vaultId));
  const engine = new SyncEngine(v.syncQueue!, target, v.files, v.syncRepo!);
  // Pulls write through the backup adapter (not the queueing chain) — the
  // worker does its own merge and manages sync_state (desktop pattern).
  // Smaller download windows than the desktop (P3.3): phones have tighter
  // memory budgets, and a batch of large attachments must not balloon RAM.
  const w = new SyncWorker(engine, target, v.syncRepo!, v.backup ?? v.adapter, v.syncQueue!, 30_000, {
    downloadConcurrency: 2,
    downloadBufferBytes: 8 * 1024 * 1024,
  });
  w.onStatusChange = (status, errorMsg) => {
    setState({ status, message: errorMsg ?? null });
  };
  w.onProgress = (p) => {
    setProgress(p ? { current: p.current, total: p.total } : null);
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
    // Native dialog via the Dialog plugin (window.confirm silently returns
    // false in the Capacitor 8 WebView); Cancel takes the safe restore
    // branch. Localized with the shared sync.massDelete* strings (P5).
    void import("@capacitor/dialog").then(async ({ Dialog }) => {
      const { value } = await Dialog.confirm({
        title: i18n.t("sync.massDeleteTitle"),
        message: i18n.t("sync.massDeleteBody", { n: pendingDeletes, total: syncedTotal }),
        okButtonTitle: i18n.t("sync.massDeleteConfirm"),
        cancelButtonTitle: i18n.t("sync.massDeleteRestore"),
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
