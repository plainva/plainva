import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from "react";
import { TauriVaultAdapter } from "../adapters/TauriVaultAdapter";
import { TauriDatabaseAdapter } from "../adapters/TauriDatabaseAdapter";
import { VaultIndexer, VaultQueryService, GraphService, initializeSchema, BackupVaultAdapter, IVaultAdapter, ConflictAwareVaultAdapter, SyncStateRepository, QueueingVaultAdapter, SyncQueue, SyncWorker, SyncEngine, WebDavSyncTarget, DriveSyncTarget, S3SyncTarget, OneDriveSyncTarget, DropboxSyncTarget, ISyncTarget, isInternalPath } from "@plainva/core";
import { credentialManager } from "../services/CredentialManager";
import { syncStatusStore } from "../services/syncStatusStore";
import { toast } from "../services/toastStore";
import i18n from "../i18n";
import { loadBackupRetentionSettings } from "../services/backupPolicy";
import { startBackupScheduler } from "../services/backupScheduler";
import { fetch } from "@tauri-apps/plugin-http";
import { oneDriveFetch } from "../services/authFetch";
import { open } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";
import { appDataDir } from "@tauri-apps/api/path";
import { readFile, writeFile, exists as fsExists, mkdir } from "@tauri-apps/plugin-fs";
import { indexDbFileName } from "../services/indexDbPath";

/** Provider ids match the settings form selection (SettingsModal/Splash deep link). */
export type SyncProviderId = "webdav" | "drive" | "onedrive" | "dropbox" | "s3";

interface VaultState {
  vaultPath: string | null;
  vaultAdapter: IVaultAdapter | null;
  /** The backup layer of the adapter chain (forceBackup/updatePolicy live here). */
  backupAdapter: BackupVaultAdapter | null;
  dbAdapter: TauriDatabaseAdapter | null;
  indexer: VaultIndexer | null;
  queryService: VaultQueryService | null;
  /** Read-model for the graph views (context graph, vault map, base graph). */
  graphService: GraphService | null;
  isLoading: boolean;
  error: string | null;
  fileTreeVersion: number;
  /**
   * Bumped only when the FOLDER structure may have changed (folder ops, full
   * re-index, vault load). The file tree's recursive disk listing (empty
   * folders) hangs on THIS version — file-only refreshes (every save) no
   * longer trigger a full-vault IPC walk (P2.5).
   */
  treeStructureVersion: number;
  /**
   * Paths behind the latest fileTreeVersion bump, or null when unknown/global.
   * Lets expensive consumers (open .base views) skip refreshes that cannot
   * affect them (P2.7).
   */
  fileTreeVersionPaths: string[] | null;
  syncWorker: SyncWorker | null;
  // Sync status/message/provider live in services/syncStatusStore.ts (P3/E2):
  // the worker flips idle→syncing→idle on every 15-s poll cycle, which must
  // not re-render every useVault consumer.
  recentVaults: string[];
  /** Whether the app skips the splash screen and reopens the last vault on start. */
  autoOpenLastVault: boolean;
  /** Path currently being loaded (shown on the loading screen; the new vault, not the old one). */
  loadingPath?: string | null;
  loadingProgress?: { current: number; total: number; message: string };
}

interface VaultContextType extends VaultState {
  selectVault: () => Promise<void>;
  openVault: (path: string) => Promise<void>;
  refreshVault: () => Promise<void>;
  /**
   * Refresh the tree/views. Passing the affected file paths marks this as a
   * FILE-ONLY refresh: the expensive folder-structure walk is skipped and
   * consumers can ignore irrelevant paths (P2.5/P2.7). Call without arguments
   * after folder operations or when unsure.
   */
  triggerFileTreeUpdate: (paths?: string[]) => void;
  closeVault: () => void;
  /** Forgets a vault in the recent list — files on disk are untouched. */
  removeRecentVault: (path: string) => Promise<void>;
  setAutoOpenLastVault: (value: boolean) => Promise<void>;
}

export const VaultContext = createContext<VaultContextType | undefined>(undefined);

export const STORE_KEY = "plainva-settings.json";

/** Default sync poll interval in seconds, and the lowest value we allow. */
export const DEFAULT_SYNC_INTERVAL_SECONDS = 15;
export const MIN_SYNC_INTERVAL_SECONDS = 5;

// Snapshot failures (full disk, blocked .plainva dir) must be visible but not
// spammy — a full disk would otherwise toast on every debounced save. The
// write itself is NOT blocked by a failing snapshot (BackupVaultAdapter P1.1).
const SNAPSHOT_ERROR_TOAST_INTERVAL_MS = 60_000;
let lastSnapshotErrorToastAt = 0;
function reportSnapshotFailure(path: string): void {
  const now = Date.now();
  if (now - lastSnapshotErrorToastAt < SNAPSHOT_ERROR_TOAST_INTERVAL_MS) return;
  lastSnapshotErrorToastAt = now;
  toast.warning(i18n.t("backup.snapshotFailed", { path }));
}

/** Per-vault sync-interval store key (interval is configured per vault). */
export const syncIntervalKey = (vaultPath: string) =>
  `syncIntervalSeconds_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

export const dailyNotesFolderKey = (vaultPath: string) => `dailyNotesFolder_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const dailyNotesFormatKey = (vaultPath: string) => `dailyNotesFormat_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const templateFolderKey = (vaultPath: string) => `templateFolder_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const dailyNoteTemplateKey = (vaultPath: string) => `dailyNoteTemplate_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const extendedDatabasesKey = (vaultPath: string) => `extendedDatabases_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const SHOW_COMPATIBILITY_WARNING_KEY = "showCompatibilityWarning";
/**
 * Global (not per-vault) opt-in: reopen the last vault on start instead of the
 * splash screen. Default OFF — the splash is the standard entry (maintainer,
 * 2026-07-04); the checkbox lives on the splash and in Settings/General.
 */
export const AUTO_OPEN_LAST_VAULT_KEY = "autoOpenLastVault";

/** OKF write rule: every file Plainva creates gets at least `type` + `okf_version`. */
export const defaultNoteTypeKey = (vaultPath: string) => `defaultNoteType_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const dailyNoteTypeKey = (vaultPath: string) => `dailyNoteType_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const DEFAULT_NOTE_TYPE = "Note";
export const DEFAULT_DAILY_NOTE_TYPE = "Daily Note";
/** One-time vault-open conversion offer; a dismissal is remembered per vault. */
export const okfPromptDismissedKey = (vaultPath: string) => `okfPromptDismissed_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
/** One-time "initial sync may take a while" notice, shown once per vault (WP6). */
export const syncFirstNoticeKey = (vaultPath: string) => `syncFirstNotice_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

/**
 * Resolves the index-DB sqlite URL (WP5 5b). The SQLite index used to live in
 * `<vault>/.plainva/vault.db`; on a network-drive vault the ~10 index statements
 * per save were network round-trips (the sqlx pool forbids batching them into
 * one transaction), which made saving very slow. The index now lives in the OS
 * app-data dir — only the DB moves, backups stay in the vault.
 *
 * When an existing in-vault DB is found, we migrate it (copy the DB + WAL/SHM
 * sidecars) so the index AND the sync state carry over untouched — no reindex,
 * no spurious `.CONFLICT`. CRITICAL: we only switch to the app-data DB when that
 * migration actually succeeds (or there is no old DB = a genuinely new vault).
 * If the copy fails, we keep using the WARM in-vault DB instead of pointing at a
 * fresh, empty app-data DB — otherwise a failed copy would silently trigger a
 * full re-index of the whole vault on startup, and repeat it every launch.
 */
async function resolveIndexDbUrl(vaultPath: string): Promise<string> {
  const oldAbs = `${vaultPath}/.plainva/vault.db`;
  try {
    const dataDir = await appDataDir();
    const dir = `${dataDir}/index`;
    await mkdir(dir, { recursive: true });
    const newAbs = `${dir}/${await indexDbFileName(vaultPath)}`;

    // Already relocated (or a fresh vault whose DB was created here before): use it.
    if (await fsExists(newAbs)) return `sqlite:${newAbs}`;

    // No in-vault DB -> genuinely new vault: create the index in app-data (it is
    // indexed once, which is correct for a new vault).
    if (!(await fsExists(oldAbs))) return `sqlite:${newAbs}`;

    // Migrate the (closed) in-vault DB. The MAIN .db copy must succeed to reuse
    // the warm index; on failure keep the in-vault DB (warm, no reindex) rather
    // than falling through to an empty app-data DB.
    try {
      await writeFile(newAbs, await readFile(oldAbs));
    } catch (e) {
      console.warn("[VaultContext] index DB migration failed; keeping the in-vault DB (no reindex)", e);
      return `sqlite:${oldAbs}`;
    }
    // Sidecars are best-effort: copying the WAL/SHM avoids losing an
    // un-checkpointed tail, but a miss only costs a few files the next save
    // reconciles — it must not undo the successful main copy above.
    for (const suffix of ["-wal", "-shm"]) {
      try {
        if (await fsExists(oldAbs + suffix)) await writeFile(newAbs + suffix, await readFile(oldAbs + suffix));
      } catch (e) {
        console.warn(`[VaultContext] index DB sidecar ${suffix} copy failed; continuing`, e);
      }
    }
    return `sqlite:${newAbs}`;
  } catch (e) {
    console.warn("[VaultContext] app-data index path unavailable; keeping the in-vault DB", e);
    return `sqlite:${oldAbs}`;
  }
}

// Global tracker to prevent double-loads in React Strict Mode
let activeLoadPath: string | null = null;
let loadAbortController: AbortController | null = null;

export const VaultProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<VaultState>({
    vaultPath: null,
    vaultAdapter: null,
    backupAdapter: null,
    dbAdapter: null,
    indexer: null,
    queryService: null,
    graphService: null,
    isLoading: true,
    error: null,
    fileTreeVersion: 0,
    treeStructureVersion: 0,
    fileTreeVersionPaths: null,
    syncWorker: null,
    recentVaults: [],
    autoOpenLastVault: false,
  });

  /**
   * Incremental index for a batch of changed paths (watcher events, sync
   * pulls) — P2.5. Falls back to the full scan for folder-level changes or
   * event floods; a batch of pure echoes ("unchanged") triggers NO re-render.
   */
  const applyIncrementalIndex = async (indexer: VaultIndexer, paths: string[]) => {
    const MAX_INCREMENTAL = 50;
    let fullScan = paths.length > MAX_INCREMENTAL;
    let anyChange = false;
    if (!fullScan) {
      for (const p of paths) {
        try {
          const result = await indexer.indexPath(p);
          if (result === "needs-full-scan") {
            fullScan = true;
            break;
          }
          if (result === "indexed" || result === "removed") anyChange = true;
        } catch (e) {
          console.warn("[VaultContext] incremental index failed for", p, e);
          fullScan = true;
          break;
        }
      }
    }
    if (fullScan) {
      await indexer.indexVaultFull().catch(console.error);
      setState(s => ({ ...s, fileTreeVersion: s.fileTreeVersion + 1, treeStructureVersion: s.treeStructureVersion + 1, fileTreeVersionPaths: null }));
    } else if (anyChange) {
      setState(s => ({ ...s, fileTreeVersion: s.fileTreeVersion + 1, fileTreeVersionPaths: paths }));
    }
  };

  const loadVault = async (path: string, isNewConnection?: boolean) => {
    // If we're already loading this exact path, ignore the duplicate call
    if (activeLoadPath === path) {
      console.log(`[VaultContext] Already loading ${path}, skipping duplicate call`);
      return;
    }
    
    // If we are loading a DIFFERENT path, abort the old one (basic tracking)
    if (activeLoadPath && activeLoadPath !== path) {
      console.log(`[VaultContext] Aborting previous load of ${activeLoadPath} in favor of ${path}`);
      if (loadAbortController) {
        loadAbortController.abort();
      }
    }

    activeLoadPath = path;
    loadAbortController = new AbortController();
    const currentAbortSignal = loadAbortController.signal;

    try {
      setState(s => ({ ...s, isLoading: true, error: null, loadingProgress: undefined, loadingPath: path }));
      syncStatusStore.reset();

      if (state.syncWorker) {
        state.syncWorker.stop();
      }

      if (currentAbortSignal.aborted) return;

      const tauriVaultAdapter = new TauriVaultAdapter(path);
      await tauriVaultAdapter.initialize();
      await tauriVaultAdapter.createDir(".plainva");

      // Retention (snapshot interval / max count / max age) is per-vault
      // configurable; settings changes are pushed in via updatePolicy without
      // a vault reload (plainva-backup-settings-changed listener below).
      const retentionStore = await Store.load(STORE_KEY);
      const retentionPolicy = await loadBackupRetentionSettings(retentionStore, path);
      const backupVaultAdapter = new BackupVaultAdapter(tauriVaultAdapter, {
        policy: retentionPolicy,
        onBackupError: reportSnapshotFailure,
      });

      // The SQLite index lives in the OS app-data dir, not in the vault (WP5 5b):
      // a network-drive vault paid a round-trip per index statement on every save.
      // Backups stay in the vault; an existing in-vault DB is migrated once.
      const dbPath = await resolveIndexDbUrl(path);
      const dbAdapter = new TauriDatabaseAdapter(dbPath);
      await dbAdapter.initialize();
      await initializeSchema(dbAdapter);

      const syncQueue = new SyncQueue(dbAdapter);
      const queueingVaultAdapter = new QueueingVaultAdapter(backupVaultAdapter, syncQueue);

      const syncRepo = new SyncStateRepository(dbAdapter);
      const vaultAdapter = new ConflictAwareVaultAdapter(
        queueingVaultAdapter,
        syncRepo,
        (mergedPath, mergedText) => {
          // The adapter auto-merged external + local changes and wrote the result to disk.
          // Tell the editor so it adopts the merged content instead of overwriting it on the next save.
          window.dispatchEvent(new CustomEvent("plainva-auto-merged", { detail: { path: mergedPath, mergedText } }));
        }
      );

      // Read this vault's sync credentials once: decides whether locally-detected changes
      // get enqueued for push, and which target the worker uses below.
      const driveCreds = await credentialManager.getDriveCredentials(path).catch(() => null);
      const webdavCreds = await credentialManager.getWebDavCredentials(path).catch(() => null);
      const oneDriveCreds = await credentialManager.getOneDriveCredentials(path).catch(() => null);
      const dropboxCreds = await credentialManager.getDropboxCredentials(path).catch(() => null);
      const s3Creds = await credentialManager.getS3Credentials(path).catch(() => null);
      const driveReady = !!(driveCreds && driveCreds.clientId && driveCreds.clientSecret && driveCreds.refreshToken);
      const oneDriveReady = !!(oneDriveCreds && oneDriveCreds.clientId && oneDriveCreds.refreshToken);
      const dropboxReady = !!(dropboxCreds && dropboxCreds.appKey && dropboxCreds.refreshToken);
      const s3Ready = !!(s3Creds && s3Creds.endpoint && s3Creds.bucket && s3Creds.accessKeyId && s3Creds.secretAccessKey && s3Creds.region);
      const hasSyncTarget = driveReady || oneDriveReady || dropboxReady || s3Ready || !!(webdavCreds && webdavCreds.url);

      // Files created/modified outside Plainva's own write path (another editor, the OS)
      // are indexed but were never enqueued. Push them when this vault has a sync target.
      const enqueueLocalChange = (changedPath: string) => {
        if (!hasSyncTarget || changedPath.includes(".plainva") || changedPath.includes(".CONFLICT")) return;
        syncQueue.queueWrite(changedPath)
          .then(() => window.dispatchEvent(new CustomEvent("plainva-sync-queued")))
          .catch((e) => console.error("[VaultContext] failed to enqueue local change", e));
      };

      // Only the initial full index below reports progress into React state (P3).
      let reportInitialProgress = true;
      // Defer the initial-index push enqueue until the first pull establishes the base
      // (3c). A COLD/rebuilt index sees EVERY local file as "new"; enqueuing them all as
      // pushes let a rebuilt DB blindly overwrite a possibly-newer remote (the reported
      // mass data loss). The first pull's reconcile adopts/merges the remote instead, and
      // onFirstCycleComplete then sweeps only the genuinely local-only files.
      let deferInitialEnqueue = true;
      const indexer = new VaultIndexer(vaultAdapter, dbAdapter, {
        onExternalModification: (path) => {
          console.log(`VaultContext: External modification detected for ${path}`);
          window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path } }));
          enqueueLocalChange(path);
        },
        onNewLocalFile: (path) => {
          // During the initial index, defer to the first pull (3c). Runtime discoveries
          // (files created while running) enqueue normally.
          if (deferInitialEnqueue) return;
          enqueueLocalChange(path);
        },
        onLocalFileDeleted: (path) => {
          if (path.includes(".plainva") || path.includes(".CONFLICT")) return;
          if (hasSyncTarget) {
            // Propagate the deletion to the remote; sync_state is cleaned after the push.
            syncQueue.queueDelete(path)
              .then(() => window.dispatchEvent(new CustomEvent("plainva-sync-queued")))
              .catch((e) => console.error("[VaultContext] failed to enqueue local delete", e));
          } else {
            // No sync target: just drop the stale state row.
            syncRepo.deleteSyncState(path).catch(() => {});
          }
        },
        onProgress: (current, total, msgPath) => {
          // Only the INITIAL vault load reports progress into React state (P3):
          // background re-indexes (watcher echo of our own saves, sync pulls)
          // fired one state update per indexed file and re-rendered every
          // useVault consumer for an invisible loading bar.
          if (!reportInitialProgress) return;
          setState(s => ({
            ...s,
            loadingProgress: { current, total, message: `Indexing ${current}/${total}: ${msgPath}` }
          }));
        }
      });
      const queryService = new VaultQueryService(dbAdapter);
      const graphService = new GraphService(dbAdapter);

      // Time-to-first-note: don't block the whole load on the full index when the
      // index is already WARM. After the app-data relocation an existing vault's
      // DB carries over, so the file tree (files come from the DB, folders from
      // disk) is fully populated at open; the full index is then just a
      // reconciliation pass that can run in the background — the vault renders
      // immediately and any changes reconcile in with a single fileTreeVersion
      // bump when it finishes. A COLD/empty index (a genuinely fresh vault, or a
      // first index) still blocks WITH the progress bar so the tree is not empty
      // while hundreds of files are parsed.
      const indexedCount = await queryService.db
        .query<{ n: number }>(`SELECT COUNT(*) AS n FROM files`)
        .then((r) => (r[0]?.n ?? 0))
        .catch(() => 0);

      if (indexedCount > 0) {
        reportInitialProgress = false; // background reconcile: no loading bar
        // Warm index: files are already known, so the background pass discovers no mass
        // of "new" files — let any genuinely new ones (created while closed) enqueue.
        deferInitialEnqueue = false;
        void indexer
          .indexVaultFull()
          .then(() => {
            if (currentAbortSignal.aborted) return;
            setState((s) => ({
              ...s,
              fileTreeVersion: s.fileTreeVersion + 1,
              treeStructureVersion: s.treeStructureVersion + 1,
              fileTreeVersionPaths: null,
            }));
          })
          .catch((e) => console.error("[VaultContext] background full index failed", e));
      } else {
        // Fresh/empty index: block with progress so the tree isn't empty. Every file is
        // "new" here — the deferred enqueue (3c) keeps this from mass-pushing over the
        // remote; the first pull reconciles and onFirstCycleComplete sweeps local-only.
        await indexer.indexVaultFull();
        reportInitialProgress = false;
        deferInitialEnqueue = false;
      }

      // If it's a new WebDAV connection, we enqueue all local files to trigger an initial push
      if (isNewConnection) {
        await syncQueue.enqueueAllLocalFiles();
      }

      let syncWorker: SyncWorker | null = null;
      let syncProvider: SyncProviderId | null = null;
      try {
        // Target selection per vault: the settings UI enforces one provider per vault
        // (saving one clears the others), so this order only decides ties in corrupt
        // states: Drive > OneDrive > Dropbox > S3 > WebDAV. Drive additionally drives the
        // worker's incremental cursor pull (getStartCursor + pull(cursor)); the others use
        // the full-listing model.
        let target: ISyncTarget | null = null;
        if (driveReady && driveCreds && driveCreds.refreshToken) {
          syncProvider = "drive";
          target = new DriveSyncTarget(
            {
              clientId: driveCreds.clientId,
              clientSecret: driveCreds.clientSecret,
              refreshToken: driveCreds.refreshToken,
              rootFolderName: driveCreds.rootFolderName,
            },
            fetch
          );
        } else if (oneDriveReady && oneDriveCreds && oneDriveCreds.refreshToken) {
          syncProvider = "onedrive";
          const oneDriveTarget = new OneDriveSyncTarget(
            {
              clientId: oneDriveCreds.clientId,
              refreshToken: oneDriveCreds.refreshToken,
              rootFolderName: oneDriveCreds.rootFolderName,
            },
            oneDriveFetch
          );
          // Microsoft ROTATES refresh tokens: persist every rotation immediately or the
          // stored token goes stale and the user is forced through the consent flow again.
          oneDriveTarget.onTokensRefreshed = (_accessToken, refreshToken) => {
            if (!refreshToken || refreshToken === oneDriveCreds.refreshToken) return;
            oneDriveCreds.refreshToken = refreshToken;
            credentialManager
              .saveOneDriveCredentials(path, { ...oneDriveCreds, refreshToken })
              .catch((e) => console.error("[VaultContext] persisting rotated OneDrive token failed", e));
          };
          target = oneDriveTarget;
        } else if (dropboxReady && dropboxCreds && dropboxCreds.refreshToken) {
          syncProvider = "dropbox";
          const dropboxTarget = new DropboxSyncTarget(
            {
              appKey: dropboxCreds.appKey,
              refreshToken: dropboxCreds.refreshToken,
              rootPath: dropboxCreds.rootPath,
            },
            fetch
          );
          dropboxTarget.onTokensRefreshed = (_accessToken, refreshToken) => {
            if (!refreshToken || refreshToken === dropboxCreds.refreshToken) return;
            dropboxCreds.refreshToken = refreshToken;
            credentialManager
              .saveDropboxCredentials(path, { ...dropboxCreds, refreshToken })
              .catch((e) => console.error("[VaultContext] persisting rotated Dropbox token failed", e));
          };
          target = dropboxTarget;
        } else if (s3Ready && s3Creds) {
          syncProvider = "s3";
          target = new S3SyncTarget(s3Creds, fetch);
        } else if (webdavCreds && webdavCreds.url) {
          syncProvider = "webdav";
          target = new WebDavSyncTarget(webdavCreds, fetch);
        }

        if (target) {
            const settingsStore = await Store.load(STORE_KEY);
            // Per-vault interval, falling back to the legacy global value, then the default.
            const perVaultInterval = await settingsStore.get<number>(syncIntervalKey(path));
            const globalInterval = await settingsStore.get<number>("syncIntervalSeconds");
            const savedInterval = perVaultInterval ?? globalInterval;
            const intervalMs = Math.max(MIN_SYNC_INTERVAL_SECONDS, savedInterval ?? DEFAULT_SYNC_INTERVAL_SECONDS) * 1000;
            const engine = new SyncEngine(syncQueue, target, vaultAdapter, syncRepo);
            // The worker writes pulled content through the raw backup adapter (not
            // the queueing/conflict-aware one): it does its own merge and manages
            // sync_state, so routing through the queue would re-enqueue every pull.
            syncWorker = new SyncWorker(engine, target, syncRepo, backupVaultAdapter, syncQueue, intervalMs);
            syncWorker.onStatusChange = (status, errorMsg) => {
              // Store instead of context state (P3/E2): idle→syncing→idle fires
              // every poll cycle and must not re-render the whole app.
              syncStatusStore.set({ status, message: errorMsg || null, ...(status !== "syncing" ? { progress: null } : {}) });
            };
            syncWorker.onProgress = (progress) => {
              // Coarse cycle progress for the status bar (WP6); throttled in core.
              syncStatusStore.set({ progress });
            };
            syncWorker.onFirstCycleComplete = () => {
              // The first pull established the remote base. Now enqueue genuinely
              // local-only files (no remote_etag) — including those whose initial-index
              // enqueue we deferred (3c) — so new local files still reach the remote,
              // without the fresh-index mass-overwrite risk.
              syncQueue.enqueueLocalOnlyFiles()
                .then(() => window.dispatchEvent(new CustomEvent("plainva-sync-queued")))
                .catch((e) => console.error("[VaultContext] enqueueLocalOnlyFiles failed", e));
            };
            syncWorker.onFilesChanged = (paths) => {
              // Pulled writes/deletions happen outside the editor; re-index so the
              // file tree and search reflect them deterministically. Incremental
              // per-path (P2.5) — the sync reports exactly which paths changed.
              void applyIncrementalIndex(indexer, paths);
              for (const p of paths) {
                if (!p.includes(".CONFLICT")) {
                  window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path: p } }));
                }
              }
            };
            syncWorker.start();
        }
      } catch (e) {
          console.error("Failed to start SyncWorker", e);
      }

      if (currentAbortSignal.aborted) return;

      syncStatusStore.set({ status: "idle", message: null, provider: syncWorker ? syncProvider : null });
      setState(s => ({
        ...s,
        vaultPath: path,
        vaultAdapter,
        backupAdapter: backupVaultAdapter,
        dbAdapter,
        indexer,
        queryService,
        graphService,
        isLoading: false,
        error: null,
        fileTreeVersion: 0,
        treeStructureVersion: s.treeStructureVersion + 1,
        fileTreeVersionPaths: null,
        syncWorker,
        loadingProgress: undefined,
        loadingPath: null,
      }));
      
      if (activeLoadPath === path) {
        activeLoadPath = null;
      }
    } catch (error: any) {
      if (currentAbortSignal.aborted) return;
      console.error("Failed to load vault", error);
      setState(s => ({ ...s, isLoading: false, error: error.message || String(error), loadingProgress: undefined }));
      if (activeLoadPath === path) {
        activeLoadPath = null;
      }
    }
  };

  useEffect(() => {
    const initStore = async () => {
      try {
        const store = await Store.load(STORE_KEY);
        const savedPath = await store.get<string>("lastVaultPath");
        let savedRecents = await store.get<string[]>("recentVaults") || [];
        
        // Legacy migration: If we have a savedPath but it's not in recentVaults, add it
        if (savedPath && !savedRecents.includes(savedPath)) {
          savedRecents = [savedPath, ...savedRecents].slice(0, 10);
          await store.set("recentVaults", savedRecents);
          await store.save();
        }

        const savedLanguage = await store.get<string>("appLanguage");
        if (savedLanguage) {
          // Loads the bundle on demand first — locales are lazy chunks (P2.8).
          import("../i18n").then(({ changeAppLanguage }) => {
            changeAppLanguage(savedLanguage).catch(console.error);
          });
        }

        const autoOpen = (await store.get<boolean>(AUTO_OPEN_LAST_VAULT_KEY)) ?? false;
        setState(s => ({ ...s, recentVaults: savedRecents, autoOpenLastVault: autoOpen }));

        if (savedPath && autoOpen) {
          await loadVault(savedPath);
        } else {
          setState(s => ({ ...s, isLoading: false }));
        }
      } catch (e) {
        console.error("Store error:", e);
        setState(s => ({ ...s, isLoading: false }));
      }
    };
    initStore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!state.vaultAdapter || !state.indexer) return;

    let unwatchFn: (() => void) | undefined;
    let debounceTimer: ReturnType<typeof setTimeout>;
    // Paths accumulated across the debounce window: the timer only sees the
    // LAST event batch otherwise, and incremental indexing needs all of them.
    const pendingWatchPaths = new Set<string>();

    const startWatching = async () => {
      if (!state.vaultAdapter?.watch) return;

      try {
        unwatchFn = await state.vaultAdapter.watch((events) => {
          // Only react to real markdown changes. Crucially this excludes writes
          // inside .plainva (the SQLite db + its -wal/-shm files), which we write
          // on every index/sync; reacting to them caused an endless
          // re-index -> db write -> watcher -> re-index feedback loop. The
          // `.includes` checks are robust even if the path was not relativised.
          const relevantEvents = events.filter(e => {
            // React to markdown AND attachment changes, mirroring the indexer's own
            // SQLite db + -wal/-shm), so we don't re-trigger on our own index writes.
            return e.path !== "" && !isInternalPath(e.path);
          });
          if (relevantEvents.length > 0) {
            for (const e of relevantEvents) pendingWatchPaths.add(e.path);
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              const batch = Array.from(pendingWatchPaths);
              pendingWatchPaths.clear();
              console.log("[VaultContext] vault watcher detected changes", batch);
              // Incremental per-path indexing (P2.5) — the former full scan
              // walked the ENTIRE vault over IPC after every save echo.
              const idx = state.indexer;
              if (idx) void applyIncrementalIndex(idx, batch);
            }, 1000);
          }
        });
      } catch (err: any) {
        setState(s => ({ ...s, error: `Watcher error: ${err.message || String(err)}` }));
      }
    };

    startWatching();

    return () => {
      clearTimeout(debounceTimer);
      if (unwatchFn) unwatchFn();
    };
  }, [state.vaultAdapter, state.indexer]);

  // Per-vault background backups: daily ZIP + daily snapshot pruning. The
  // scheduler re-reads its settings from the store on every tick, so only the
  // vault switch needs a restart.
  useEffect(() => {
    if (!state.vaultPath || !state.vaultAdapter) return;
    const stop = startBackupScheduler({ vaultPath: state.vaultPath, adapter: state.vaultAdapter });
    return stop;
  }, [state.vaultPath, state.vaultAdapter]);

  // Retention settings changed in the settings modal: push the new policy into
  // the live BackupVaultAdapter without reloading the vault.
  useEffect(() => {
    const handler = async () => {
      if (!state.vaultPath || !state.backupAdapter) return;
      try {
        const store = await Store.load(STORE_KEY);
        state.backupAdapter.updatePolicy(await loadBackupRetentionSettings(store, state.vaultPath));
      } catch (e) {
        console.warn("[VaultContext] applying backup settings failed", e);
      }
    };
    window.addEventListener("plainva-backup-settings-changed", handler);
    return () => window.removeEventListener("plainva-backup-settings-changed", handler);
  }, [state.vaultPath, state.backupAdapter]);

  useEffect(() => {
    const handleCredentialsSaved = (e: Event) => {
      if (state.vaultPath) {
        if (state.syncWorker) {
          state.syncWorker.stop();
        }
        const customEvent = e as CustomEvent;
        const isNew = customEvent.detail?.isNewConnection;
        loadVault(state.vaultPath, isNew);
      }
    };

    const handleSyncQueued = () => {
      if (state.syncWorker) {
        state.syncWorker.triggerImmediate();
      }
    };
    
    window.addEventListener("plainva-credentials-saved", handleCredentialsSaved);
    window.addEventListener("plainva-sync-queued", handleSyncQueued);
    
    return () => {
      window.removeEventListener("plainva-credentials-saved", handleCredentialsSaved);
      window.removeEventListener("plainva-sync-queued", handleSyncQueued);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.vaultPath, state.syncWorker]);

  const openVault = async (path: string) => {
    const store = await Store.load(STORE_KEY);
    await store.set("lastVaultPath", path);
    
    const currentRecents = await store.get<string[]>("recentVaults") || [];
    const newRecents = [path, ...currentRecents.filter(p => p !== path)].slice(0, 10);
    await store.set("recentVaults", newRecents);
    await store.save();
    
    setState(s => ({ ...s, recentVaults: newRecents }));
    await loadVault(path);
  };

  const selectVault = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Vault Directory"
    });

    if (selected && typeof selected === "string") {
      await openVault(selected);
    }
  };

  const closeVault = async () => {
    if (state.syncWorker) {
      state.syncWorker.stop();
    }
    
    // Update state IMMEDIATELY so the UI responds even if Rust/IPC is deadlocked
    syncStatusStore.reset();
    setState(s => ({
      ...s,
      vaultPath: null,
      vaultAdapter: null,
      backupAdapter: null,
      dbAdapter: null,
      indexer: null,
      queryService: null,
      graphService: null,
      fileTreeVersion: 0,
      syncWorker: null,
      isLoading: false,
      error: null,
      loadingProgress: undefined,
      loadingPath: null
    }));

    try {
      const store = await Store.load(STORE_KEY);
      await store.set("lastVaultPath", null);
      await store.save();
    } catch (e) {
      console.error("Failed to update store on closeVault:", e);
    }
  };

  const refreshVault = async () => {
    if (state.indexer) {
      setState(s => ({ ...s, isLoading: true }));
      await state.indexer.indexVaultFull();
      setState(s => ({ ...s, isLoading: false, fileTreeVersion: s.fileTreeVersion + 1, treeStructureVersion: s.treeStructureVersion + 1, fileTreeVersionPaths: null }));
    }
  };

  const triggerFileTreeUpdate = (paths?: string[]) => {
    if (paths && paths.length > 0) {
      // File-only refresh (P2.5): no folder-structure walk, and consumers may
      // skip refreshes whose paths cannot affect them (P2.7).
      setState(s => ({ ...s, fileTreeVersion: s.fileTreeVersion + 1, fileTreeVersionPaths: paths }));
    } else {
      setState(s => ({ ...s, fileTreeVersion: s.fileTreeVersion + 1, treeStructureVersion: s.treeStructureVersion + 1, fileTreeVersionPaths: null }));
    }
  };

  const removeRecentVault = async (path: string) => {
    const store = await Store.load(STORE_KEY);
    const currentRecents = (await store.get<string[]>("recentVaults")) || [];
    const newRecents = currentRecents.filter(p => p !== path);
    await store.set("recentVaults", newRecents);
    const last = await store.get<string>("lastVaultPath");
    if (last === path) {
      await store.set("lastVaultPath", null);
    }
    await store.save();
    setState(s => ({ ...s, recentVaults: newRecents }));
  };

  const setAutoOpenLastVault = async (value: boolean) => {
    setState(s => ({ ...s, autoOpenLastVault: value }));
    try {
      const store = await Store.load(STORE_KEY);
      await store.set(AUTO_OPEN_LAST_VAULT_KEY, value);
      await store.save();
    } catch (e) {
      console.error("Failed to persist autoOpenLastVault:", e);
    }
  };

  // One value identity per state change: renders of the provider itself (e.g.
  // parent re-renders) must not fan out to every useVault consumer (P3).
  const value = useMemo(
    () => ({ ...state, selectVault, openVault, refreshVault, triggerFileTreeUpdate, closeVault, removeRecentVault, setAutoOpenLastVault }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state]
  );

  return (
    <VaultContext.Provider value={value}>
      {children}
    </VaultContext.Provider>
  );
};

export const useVault = () => {
  const context = useContext(VaultContext);
  if (context === undefined) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return context;
};
