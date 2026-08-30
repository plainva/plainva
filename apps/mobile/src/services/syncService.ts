import {
  DriveSyncTarget,
  DropboxSyncTarget,
  OneDriveSyncTarget,
  S3SyncTarget,
  SyncEngine,
  SyncWorker,
  EncryptedWorkspaceWorker,
  createProviderWorkspaceObjectStore,
  initializePersonalWorkspaceMigration,
  parseWorkspaceDocument,
  workspaceDocumentHash,
  WebDavSyncTarget,
  probeRemoteGenesis,
  type ISyncTarget,
  type WorkspaceObjectStore,
  type NameCollision,
} from "@plainva/core";
import { getPlatformServices, scaffoldVaultTemplate, toast, type VaultTemplateDefinition } from "@plainva/ui";
import { syncProviderSlot, type MobileSyncProvider } from "./syncSlot";
import i18n from "@plainva/ui/i18n";
import { readSyncRootFolder, writeSyncRootFolder } from "./syncRootFolder";
import { allowHttpOrigin, webdavFetch } from "../adapters/webdavHttp";
import { createContentRefResolver, mobileSyncUploader } from "../adapters/syncUpload";
import { brokerTokenProvider } from "./accountBroker";
import { CapacitorVaultAdapter } from "../adapters/CapacitorVaultAdapter";
import { applyTemplateSettings, getMobileSettings } from "./mobileSettings";
import { MIN_SYNC_INTERVAL_SECONDS } from "./mobileSettingsScope";
import { getMobileVault, switchVault, type MobileVault } from "./vaultService";
import { prepareMobileSettingsSync } from "./mobileSettingsSync";
import { notifyPulledFiles } from "./pulledFiles";
import { loadMobilePublicationRuntime } from "./mobileWorkspaceSecurity";
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

const credKeyFor = syncProviderSlot;

export interface DriveMobileCredentials {
  clientId: string;
  /** Only for BYO desktop-type clients; Android OAuth clients have none. */
  clientSecret?: string;
  refreshToken: string;
  rootFolderName?: string;
  /**
   * What the consent actually GRANTED, as the provider reported it.
   *
   * Google ignores a requested scope on refresh and answers with the consent's
   * own set, so a token can never be widened later. Recording the request
   * instead of the grant is what let a Drive-only token be handed to the
   * calendar as if it covered it (finding 2026-08-19).
   */
  grantedScope?: string;
}

export interface OneDriveMobileCredentials {
  clientId: string;
  refreshToken: string;
  rootFolderName?: string;
  /** See `DriveMobileCredentials.grantedScope`. */
  grantedScope?: string;
}

export interface DropboxMobileCredentials {
  appKey: string;
  refreshToken: string;
  rootPath?: string;
}

export type { MobileSyncProvider } from "./syncSlot";


export type MobileSyncStatus = "off" | "idle" | "syncing" | "retrying" | "error";

interface SyncState {
  status: MobileSyncStatus;
  message: string | null;
  /** Set only on the encrypted-workspace "pair/recover this device" error so the
   *  UI can offer a deep-link into Security & Sharing (package F2). */
  errorKind?: "pair-required";
  /** Wall clock of the next attempt, with `retrying` only (round 3, R4). */
  retryAt?: number;
  /** Wall-clock stamp of the last cycle that finished cleanly (P5). */
  lastSyncAt: number | null;
  /** Cycle progress while syncing (package I: the desktop status-bar x/y). */
  progress: { current: number; total: number } | null;
  /** Last few error messages, newest first (package I transparency). */
  errorHistory: Array<{ at: number; message: string }>;
  /**
   * Paths the remote cannot tell apart — a decision, not a failure (finding
   * 2026-08-21). Held beside the status rather than inside its message: the
   * sync keeps working for every other file, and the card that explains this
   * needs the pairs, not a sentence.
   */
  collisions: readonly NameCollision[];
}

let state: SyncState = { status: "off", message: null, lastSyncAt: null, progress: null, errorHistory: [], collisions: [] };
const listeners = new Set<() => void>();
type MobileSyncWorker = {
  start(): void;
  stop(): void;
  stopAndDrain(): Promise<void>;
  triggerImmediate(): void;
  retryFailed(): void | Promise<void>;
  noteUserInitiatedDeletion(paths: string[]): void;
  fullResync?: () => Promise<void>;
  onStatusChange?: SyncWorker["onStatusChange"];
  onProgress?: SyncWorker["onProgress"];
  onFilesChanged?: SyncWorker["onFilesChanged"];
};
let worker: MobileSyncWorker | null = null;

/** Cascade deletion (plan Kaskadenloeschung): user-confirmed deletions must
 * not trip — or be resurrected by — the sync mass-deletion guard. */
export function notifyUserInitiatedDeletion(paths: string[]): void {
  worker?.noteUserInitiatedDeletion(paths);
}

function setState(next: {
  status: MobileSyncStatus;
  message: string | null;
  errorKind?: "pair-required";
  retryAt?: number;
}): void {
  const finished = state.status === "syncing" && next.status === "idle";
  // A temporary failure is recorded too: the surface stops shouting about it,
  // and that is exactly when the history has to keep the raw provider string —
  // otherwise "it fails sometimes" would have nothing behind it.
  const errorHistory =
    (next.status === "error" || next.status === "retrying") && next.message && next.message !== state.message
      ? [{ at: Date.now(), message: next.message }, ...state.errorHistory].slice(0, 5)
      : state.errorHistory;
  state = {
    ...next,
    lastSyncAt: finished ? Date.now() : state.lastSyncAt,
    progress: next.status === "syncing" ? state.progress : null,
    errorHistory,
    // Survives a status change: the pair is still there whether the cycle
    // succeeded or failed, and only the worker's next report clears it.
    collisions: state.collisions,
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

function setCollisions(collisions: readonly NameCollision[]): void {
  // Identity matters: the worker reports every cycle, and a fresh empty array
  // each time would re-render every subscriber twice a minute for nothing.
  const same =
    state.collisions.length === collisions.length &&
    state.collisions.every((c, i) => c.path === collisions[i].path && c.twin === collisions[i].twin);
  if (same) return;
  state = { ...state, collisions };
  for (const fn of listeners) fn();
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
    // "Off" and "configured but unreachable here" used to look the same, and
    // the second one is the one worth saying (finding 2026-08-19): the card
    // reads the registry, so it kept claiming a connection while nothing came
    // through. A paused vault is a decision, not a failure.
    const blocked = !entry?.paused && !!entry?.provider;
    setState({
      status: blocked ? "error" : "off",
      message: blocked ? i18n.t("cloudAccounts.filesNoAccess") : null,
    });
    return;
  }
  await startWorker(v, stored);
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
  await applyTemplateSettings(opts.template?.settings);
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

/**
 * Re-authorize an EXISTING vault after its OAuth refresh token died
 * (revoked/rotated away). Unlike connectProvider it never mints a new vault:
 * it merges the fresh token into the vault's stored credentials (keeping its
 * cloud folder), un-pauses it, and restarts the worker when it is active — so
 * a dead token is fixed in place instead of forcing delete + re-create.
 */
export async function reauthorizeVault(vaultId: string, fresh: MobileSyncProvider): Promise<void> {
  const existing = await getStoredProvider(vaultId);
  let merged: MobileSyncProvider = fresh;
  if (existing && existing.provider === fresh.provider) {
    if (fresh.provider === "drive" && existing.provider === "drive") {
      merged = { provider: "drive", creds: { ...existing.creds, clientId: fresh.creds.clientId, clientSecret: fresh.creds.clientSecret, refreshToken: fresh.creds.refreshToken } };
    } else if (fresh.provider === "onedrive" && existing.provider === "onedrive") {
      merged = { provider: "onedrive", creds: { ...existing.creds, clientId: fresh.creds.clientId, refreshToken: fresh.creds.refreshToken } };
    } else if (fresh.provider === "dropbox" && existing.provider === "dropbox") {
      merged = { provider: "dropbox", creds: { ...existing.creds, appKey: fresh.creds.appKey, refreshToken: fresh.creds.refreshToken } };
    }
  }
  await getPlatformServices().credentials.writeSecret(credKeyFor(vaultId), merged);
  await updateVault(vaultId, { paused: false });
  if ((await getActiveVaultEntry()).id === vaultId) {
    stopSync();
    await startWorker(await getMobileVault(), merged);
  }
}

/**
 * Hands the file sync over to the account broker: the per-service refresh token
 * is emptied, and the worker restarts so the target picks up the broker-backed
 * access-token provider. Called after a union consent (accountLogin) — a copy
 * left behind here would keep refreshing on the side, which is exactly the
 * arrangement that let one service go stale while another stayed alive.
 */
export async function switchProviderToAccountBroker(vaultId: string): Promise<void> {
  const existing = await getStoredProvider(vaultId);
  if (!existing) return;
  let merged: MobileSyncProvider;
  if (existing.provider === "drive") merged = { provider: "drive", creds: { ...existing.creds, refreshToken: "" } };
  else if (existing.provider === "onedrive") merged = { provider: "onedrive", creds: { ...existing.creds, refreshToken: "" } };
  else return; // password- or key-based providers have nothing to hand over
  await getPlatformServices().credentials.writeSecret(credKeyFor(vaultId), merged);
  if ((await getActiveVaultEntry()).id === vaultId) {
    stopSync();
    await startWorker(await getMobileVault(), merged);
  }
}

/** Final credential cleanup when a vault is deleted. */
export async function purgeCredentials(vaultId: string): Promise<void> {
  await getPlatformServices().credentials.removeSecret(credKeyFor(vaultId));
}

/**
 * True when nothing is still on its way in: either the vault has no sync target
 * at all, or its first full cycle has landed. The task reconciler gates note
 * CREATION on this (mobile matters more than desktop here — a freshly connected
 * container fills up over minutes, and a task whose note has not arrived yet
 * would be imported as a new one).
 */
let firstCycleSettled = true;

export function firstSyncSettled(): boolean {
  return firstCycleSettled;
}

export function syncNow(): void {
  // Full resync, not a bare cursor cycle: brand-new remote files only arrive
  // through a listing, and pushes parked in manual-intervention/backoff after
  // repeated failures must be revived by the user's explicit action — mobile
  // has no other button that would (2026-07-16). fullResync = reset stuck
  // queue ops + drop the cursor + immediate cycle.
  if (worker?.fullResync) void worker.fullResync().catch((e) => console.error("[sync] resync failed", e));
  else { worker?.retryFailed(); worker?.triggerImmediate(); }
}

let lastForegroundSyncAt = 0;

/**
 * Sync on app start / return-to-foreground, throttled to once per minute so
 * frequent app switching can't loop. A full resync also revives stuck pushes,
 * so the user no longer has to trigger a sync by hand after opening the app.
 */
export function foregroundSync(): void {
  if (!worker) return;
  const now = Date.now();
  if (now - lastForegroundSyncAt < 60_000) return;
  lastForegroundSyncAt = now;
  if (worker.fullResync) void worker.fullResync().catch((e) => console.error("[sync] foreground resync failed", e));
  else { worker.retryFailed(); worker.triggerImmediate(); }
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

/**
 * Per-request timeout handed to every sync target on device. The native
 * bridge delivers a response in one piece (no streaming), so — unlike the
 * desktop, where the 30 s default only bounds the header phase — this signal
 * bounds the WHOLE transfer. 120 s keeps large attachment up/downloads on
 * slow mobile links alive while still guaranteeing that no single request
 * can wedge a sync cycle for longer (the freeze class fixed 2026-07-16).
 */
const MOBILE_REQUEST_TIMEOUT_MS = 120_000;

/**
 * Says it out loud when the sync had to CREATE the vault's remote folder.
 *
 * For a genuinely new connection that is unremarkable. For a reconnected one it
 * means the configured folder was lost and a fresh, empty remote just took its
 * place — the vault then uploads into the wrong place while its real folder
 * sits untouched, and until this notice existed nothing on screen said so
 * (finding 2026-08-19). A warning, not an error: nothing is broken, but the
 * person has to decide whether that folder is the one they meant.
 */
function reportRootFolderCreated(name: string): void {
  toast.warning(i18n.t("sync.remoteFolderCreated", { name }), {
    label: i18n.t("sync.openSettings"),
    run: () => window.dispatchEvent(new CustomEvent("m-open-settings")),
  });
}

async function buildTarget(p: MobileSyncProvider, credKey: string, vaultId?: string): Promise<ISyncTarget> {
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
      return new S3SyncTarget(p.creds, webdavFetch, MOBILE_REQUEST_TIMEOUT_MS, undefined, mobileSyncUploader);
    case "drive": {
      const target = new DriveSyncTarget(
        {
          clientId: p.creds.clientId,
          clientSecret: p.creds.clientSecret ?? "",
          refreshToken: p.creds.refreshToken,
          // From the settings, not the slot: the slot's copy dies with the
          // account, and the default that took over then created a second
          // folder in the cloud (finding 2026-08-19).
          rootFolderName: (await readSyncRootFolder(vaultId ?? "", "drive", p)) || undefined,
        },
        webdavFetch,
        MOBILE_REQUEST_TIMEOUT_MS,
        mobileSyncUploader,
      );
      target.onRootFolderCreated = (name) => reportRootFolderCreated(name);
      // Google joined the broker on 2026-07-28: an account connected through
      // the union consent keeps ONE refresh token, and every service asks for
      // an access token instead of holding a copy that can go stale.
      if (vaultId) {
        // Awaited, not handed in later: a broker account leaves its own
        // refresh token blank on purpose, so a cycle that started before the
        // provider arrived ran without any token at all and fell into backoff.
        const provider = await brokerTokenProvider(vaultId, "files").catch(() => undefined);
        if (provider) target.accessTokenProvider = provider;
      }
      return target;
    }
    case "onedrive": {
      const target = new OneDriveSyncTarget(
        {
          clientId: p.creds.clientId,
          refreshToken: p.creds.refreshToken,
          rootFolderName: (await readSyncRootFolder(vaultId ?? "", "onedrive", p)) || undefined,
        },
        webdavFetch,
        MOBILE_REQUEST_TIMEOUT_MS,
        mobileSyncUploader,
      );
      // Broker-backed accounts (cloud accounts stage B): the account slot owns
      // the rotating refresh token, this target only asks for access tokens.
      if (vaultId) {
        // Awaited, not handed in later: a broker account leaves its own
        // refresh token blank on purpose, so a cycle that started before the
        // provider arrived ran without any token at all and fell into backoff.
        const provider = await brokerTokenProvider(vaultId, "files").catch(() => undefined);
        if (provider) target.accessTokenProvider = provider;
      }
      target.onRootFolderCreated = (name) => reportRootFolderCreated(name);
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
          rootPath: (await readSyncRootFolder(vaultId ?? "", "dropbox", p)) || undefined,
        },
        webdavFetch,
        MOBILE_REQUEST_TIMEOUT_MS,
        undefined,
        mobileSyncUploader,
      );
      target.onRootFolderCreated = (name) => reportRootFolderCreated(name);
      target.onTokensRefreshed = async (_accessToken, refreshToken) => {
        if (!refreshToken || refreshToken === p.creds.refreshToken) return;
        p.creds.refreshToken = refreshToken;
        await persistRotation();
      };
      return target;
    }
    default:
      return new WebDavSyncTarget(p.creds, webdavFetch, MOBILE_REQUEST_TIMEOUT_MS, mobileSyncUploader);
  }
}

function workspaceProvider(provider: MobileSyncProvider["provider"]) {
  return provider === "drive" ? "google-drive" as const : provider;
}

export async function getMobileWorkspaceObjectStore(vaultId: string): Promise<WorkspaceObjectStore> {
  const provider = await getStoredProvider(vaultId);
  if (!provider) throw new Error("sync connection required");
  return createProviderWorkspaceObjectStore(workspaceProvider(provider.provider), await buildTarget(provider, credKeyFor(vaultId), vaultId));
}

export async function getMobileRemoteWorkspaceInfo(vaultId: string): Promise<{ workspaceId: string; fingerprint: string } | null> {
  const store = await getMobileWorkspaceObjectStore(vaultId);
  const bytes = await store.get(".pvws/genesis.pvgen");
  if (!bytes) return null;
  const genesis = parseWorkspaceDocument(bytes);
  if (genesis.kind !== "genesis") throw new Error("remote workspace genesis is invalid");
  return { workspaceId: genesis.workspaceId, fingerprint: workspaceDocumentHash(genesis) };
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
  // Awaited here (unlike the worker start): this runs behind a button and a
  // lost race would show the user a bare "could not list" instead of retrying.
  if (p.provider === "webdav") await allowHttpOrigin(p.creds.url);
  else if (p.provider === "s3") await allowHttpOrigin(p.creds.endpoint);
  const target = await buildTarget(p, credKeyFor("probe"));
  return target.listFolders ? target.listFolders(path) : [];
}

/**
 * Does a sideband file exist in the cloud for this vault? Used before the phone
 * creates a settings keyfile (H2e): one may already be up there, unpulled, and
 * publishing a second would lock every other device out of the sealed profile.
 * A transport failure PROPAGATES — the caller must treat "cannot tell" as "do
 * not create", never as "no".
 */
export async function remoteSidebandFileExists(vaultId: string, path: string): Promise<boolean> {
  const provider = await getStoredProvider(vaultId);
  if (!provider) throw new Error("sync connection required");
  return (await (await buildTarget(provider, credKeyFor(vaultId), vaultId)).download(path)) !== null;
}

/** The picker's "new folder" row for a NOT-yet-connected provider (2026-07-13). */
export async function createProviderFolder(p: MobileSyncProvider, path: string): Promise<void> {
  if (p.provider === "webdav") await allowHttpOrigin(p.creds.url);
  else if (p.provider === "s3") await allowHttpOrigin(p.creds.endpoint);
  const target = await buildTarget(p, credKeyFor("probe"));
  if (target.createFolder) await target.createFolder(path);
}

/**
 * Cycle interval in ms (H2a). Was hard-coded to 30 s at both worker call sites;
 * it is now the per-vault, syncable `syncIntervalSeconds` setting — same field
 * name and same lower bound as the desktop, so a value set there arrives here
 * through the settings sync instead of being silently ignored.
 */
function syncIntervalMs(): number {
  const seconds = getMobileSettings().syncIntervalSeconds;
  return Math.max(MIN_SYNC_INTERVAL_SECONDS, Number.isFinite(seconds) ? seconds : 30) * 1000;
}

/**
 * Points an existing connection at a different remote folder (H2d) — the
 * desktop has had this on its sync page; mobile could only pick a folder while
 * connecting. Local files are untouched; the next cycle reconciles against the
 * new remote. WebDAV is deliberately not supported: there the chosen folder is
 * baked into the base URL at connect time, so "changing" it means reconnecting.
 */
export function canChangeRemoteFolder(provider: string | undefined): boolean {
  return provider === "drive" || provider === "onedrive" || provider === "dropbox" || provider === "s3";
}

export function remoteFolderOf(p: MobileSyncProvider): string {
  switch (p.provider) {
    case "drive":
    case "onedrive": return p.creds.rootFolderName ?? "";
    case "dropbox": return p.creds.rootPath ?? "";
    case "s3": return p.creds.prefix ?? "";
    default: return "";
  }
}

function withRemoteFolder(p: MobileSyncProvider, folder: string): MobileSyncProvider {
  const value = folder.trim() || undefined;
  switch (p.provider) {
    case "drive": return { provider: "drive", creds: { ...p.creds, rootFolderName: value } };
    case "onedrive": return { provider: "onedrive", creds: { ...p.creds, rootFolderName: value } };
    case "dropbox": return { provider: "dropbox", creds: { ...p.creds, rootPath: value } };
    case "s3": return { provider: "s3", creds: { ...p.creds, prefix: value } };
    default: return p;
  }
}

export async function changeRemoteFolder(v: MobileVault, folder: string): Promise<void> {
  const stored = await getStoredProvider(v.vaultId);
  if (!stored || !canChangeRemoteFolder(stored.provider)) throw new Error("remote folder is not changeable for this provider");
  await stopSyncAndDrain();
  // The three OAuth providers keep the folder in the settings now, so it
  // survives an account being removed; WebDAV and S3 keep theirs in the
  // connection, where a reconnect shows it in the form.
  await writeSyncRootFolder(v.vaultId, stored.provider, folder.trim());
  if (stored.provider === "s3") {
    await getPlatformServices().credentials.writeSecret(credKeyFor(v.vaultId), withRemoteFolder(stored, folder));
  }
  await startSyncIfConfigured(v);
}

async function startWorker(v: MobileVault, p: MobileSyncProvider): Promise<void> {
  v.enableSyncEnqueue();
  // Origin policy (P4.3): user-configured servers must be allowed on the
  // native bridge before requests fly. Fire-and-forget is safe — a request
  // racing the registration fails ONE cycle and the next one self-heals.
  if (p.provider === "webdav") void allowHttpOrigin(p.creds.url);
  else if (p.provider === "s3") void allowHttpOrigin(p.creds.endpoint);
  const rawTarget = await buildTarget(p, credKeyFor(v.vaultId), v.vaultId);
  if (!v.workspaceRuntime) {
    // Probe for an encrypted-workspace genesis so a plaintext local vault is
    // never synced blindly against a workspace remote. A transport/auth failure
    // here (e.g. an expired Google Drive token → HTTP 400) must NOT abort
    // startWorker: that rejection used to escape to the boot handler and cover
    // the ENTIRE app with a fatal "startup error", locking the user out (they
    // couldn't even reach Reconnect). We cannot confirm a workspace on a failed
    // probe, so fall through to the regular worker — its cycle reports the auth
    // error as a recoverable sync-error status and its fail-closed sealed-blob
    // guard still protects note content. Only a SUCCESSFUL probe that returns a
    // genesis refuses to sync.
    const objectStore = createProviderWorkspaceObjectStore(workspaceProvider(p.provider), rawTarget);
    const probe = await probeRemoteGenesis(() => objectStore.get(".pvws/genesis.pvgen"));
    if (probe.probeError) {
      console.warn("[sync] workspace genesis probe failed; starting the regular worker", probe.probeError);
    }
    if (probe.encryptedGenesisFound) {
      setState({ status: "error", message: i18n.t("workspaceSecurity.mobilePairRequired", { defaultValue: "This remote is an encrypted workspace. Pair or recover this device in Security settings." }), errorKind: "pair-required" });
      return;
    }
  }
  const { target, runner: settingsSync } = await prepareMobileSettingsSync(v, p, rawTarget);
  if (v.workspaceRuntime && v.workspaceState) {
    const objectStore = createProviderWorkspaceObjectStore(workspaceProvider(p.provider), rawTarget);
    // Encrypting/indexing the local vault at join time can take minutes on a
    // large vault; surface it as determinate sync progress instead of a silent
    // freeze (package F1, Punkt 14).
    setState({ status: "syncing", message: null });
    await initializePersonalWorkspaceMigration({ store: objectStore, state: v.workspaceState, vault: v.backup ?? v.adapter, runtime: v.workspaceRuntime, recoveryConfirmedAt: new Date().toISOString(), onProgress: (done, total) => setProgress({ current: done, total }) });
    const encrypted = new EncryptedWorkspaceWorker(objectStore, v.workspaceState, v.backup ?? v.adapter, v.workspaceRuntime, {
      intervalMs: syncIntervalMs(),
      // The workspace worker runs its sideband AFTER pull and push, so the
      // manifest guard is not a pre-pull check here. That is fine and not a
      // gap: what it protects against is a PLAINTEXT sync pushing into a remote
      // that has meanwhile become encrypted, and in an encrypted workspace
      // everything leaves sealed by construction. It still runs, so a manifest
      // that has gone missing surfaces as a cycle error (verified 2026-08-19).
      sideband: async () => { await settingsSync.guardBeforeCycle?.(rawTarget, v.backup ?? v.adapter); await settingsSync.run(rawTarget, v.backup ?? v.adapter); },
      // Only whether THIS device holds the publication's keys; the folder it
      // lives in is derived inside core from the vault's workspace id. Null
      // covers both "never published from here" and "vault locked" - and
      // neither is an error the publisher could act on from this device.
      openPublicationRuntime: (record) => loadMobilePublicationRuntime(v.vaultId, record.publicationId),
    });
    // No `retryAt` here: the encrypted-workspace worker has no failure counter
    // and still reports every throw as `error` (round 3 changed the ordinary
    // sync worker; giving this one the same treatment is its own step).
    // No name-collision channel here on purpose: an encrypted workspace stores
    // sealed objects under content hashes, so the remote never carries a human
    // file name and two Unicode forms of one cannot exist (finding 2026-08-21).
    encrypted.onStatusChange = (status, errorMsg) => setState({ status, message: errorMsg ?? null });
    encrypted.onProgress = (progress) => setProgress(progress ? { current: progress.current, total: progress.total } : null);
    encrypted.onFilesChanged = (paths) => { void v.reindexPaths(paths); notifyPulledFiles(paths); };
    worker = encrypted;
    setState({ status: "idle", message: null });
    encrypted.start();
    encrypted.triggerImmediate();
    lastForegroundSyncAt = Date.now();
    return;
  }
  // Large writes stream from disk instead of crossing the bridge as base64
  // (issue #48); below the threshold nothing changes.
  const engine = new SyncEngine(
    v.syncQueue!,
    target,
    v.files,
    v.syncRepo!,
    createContentRefResolver(v.adapter.sandboxRoot),
  );
  // Pulls write through the backup adapter (not the queueing chain) — the
  // worker does its own merge and manages sync_state (desktop pattern).
  // Smaller download windows than the desktop (P3.3): phones have tighter
  // memory budgets, and a batch of large attachments must not balloon RAM.
  firstCycleSettled = false;
  const w = new SyncWorker(engine, target, v.syncRepo!, v.backup ?? v.adapter, v.syncQueue!, syncIntervalMs(), {
    downloadConcurrency: 2,
    downloadBufferBytes: 8 * 1024 * 1024,
    settingsSync,
  });
  w.onStatusChange = (status, errorMsg, _reason, retryAt) => {
    setState({ status, message: errorMsg ?? null, retryAt });
  };
  w.onNameCollisions = setCollisions;
  w.onProgress = (p) => {
    setProgress(p ? { current: p.current, total: p.total } : null);
  };
  w.onFirstCycleComplete = () => {
    void v.syncQueue!.enqueueLocalOnlyFiles().catch(() => {});
    v.markFirstSyncComplete();
    // The remote content is here now, so anchored notes exist and can be
    // ADOPTED rather than imported a second time.
    firstCycleSettled = true;
  };
  w.onFilesChanged = (paths) => {
    void v.reindexPaths(paths);
    // Not just the lists: the open editor has to hear about a pulled note, or
    // its next save overwrites it. See notifyPulledFiles for why the indexer
    // cannot do this (S45).
    notifyPulledFiles(paths);
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
      if (value) {
        w.approveMassDeletion();
        return;
      }
      // The user chose "restore", so they must learn whether it worked
      // (desktop rule, carried over 2026-08-19). Going quiet here means
      // believing the files are back while the deletions still stand.
      try {
        const discarded = await w.discardMassDeletion();
        toast.info(i18n.t("sync.massDeleteRestored", { n: discarded }));
      } catch (e) {
        console.error("[syncService] discardMassDeletion failed", e);
        toast.error(i18n.t("sync.massDeleteRestoreFailed"));
      }
    });
  };
  worker = w;
  setState({ status: "idle", message: null });
  w.start();
  w.triggerImmediate();
  // The startup cycle counts as the foreground sync so a resume within a minute
  // of a cold start doesn't fire a second one.
  lastForegroundSyncAt = Date.now();
}

/** Rebuilds the worker after unlocking or changing the settings-sync opt-in. */
export async function restartSync(v: MobileVault): Promise<void> {
  await stopSyncAndDrain();
  await startSyncIfConfigured(v);
}
