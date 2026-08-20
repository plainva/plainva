import {
  BackupVaultAdapter,
  ConflictAwareVaultAdapter,
  ConflictError,
  DEFAULT_BACKUP_RETENTION,
  initializeSchema,
  QueueingVaultAdapter,
  WorkspaceQueueingVaultAdapter,
  PermissionedVaultAdapter,
  SqlWorkspaceStateStore,
  evaluateWorkspaceAccess,
  workspaceSliceIdsForObject,
  createWorkspaceObjectId,
  SyncQueue,
  SyncStateRepository,
  VaultIndexer,
  VaultQueryService,
  type IDatabaseAdapter,
  type IVaultAdapter,
  type SearchResult,
  type PersonalWorkspaceRuntime,
  type VaultFileInfo,
  PimCacheRepository,
} from "@plainva/core";
import { CapacitorVaultAdapter } from "../adapters/CapacitorVaultAdapter";
import { CapacitorSqliteAdapter } from "../adapters/CapacitorSqliteAdapter";
import { FixtureSqliteAdapter, isFixtureSqliteAvailable } from "../adapters/FixtureSqliteAdapter";
import { Directory, Filesystem } from "@capacitor/filesystem";
import {
  addVault,
  getActiveVaultEntry,
  newVaultId,
  removeVault,
  setActiveVault,
  LOCAL_VAULT_ID,
  type VaultEntry,
} from "./vaultRegistry";
import { getStoredProvider, purgeCredentials, stopSyncAndDrain, syncSoon } from "./syncService";
import { clearMobileSyncState } from "./mobileSettingsSync";
import { recoverProfileImportIfNeeded } from "./profileImportJournal";
import { clearCloudAccounts } from "./cloudAccountsStore";
import { createSaveCoordinator } from "./saveCoordinator";
import { writeDraft, clearDraft } from "./draftJournal";
import { loadCloudAccounts } from "./cloudAccountsStore";
import { listMailAccounts } from "@plainva/ui/mail";
import {
  collectVaultSecretKeys,
  forgetVaultFiles,
  forgetVaultSecrets,
  forgetVaultStoreKeys,
} from "./vaultForget";
import { getMobileSettings, reloadMobileSettingsForActiveVault } from "./mobileSettings";
import { buildNewNoteFromTemplate, applyTemplateInteractive } from "./templateInteractive";
import { relativeLinkCandidates } from "../lib/relativeLink";
import {
  buildDailyNotePath,
  conflictCopyPath,
  parseBookmarksFile,
  parseRecentsFile,
  pushRecentEntry,
  renameFileWithLinkUpdates,
  serializeBookmarksFile,
  serializeRecentsFile,
  setPendingTemplateCaret,
  sweepPinboardRefs,
  toast,
  isImagePath,
  wikiTargetToPath,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getMobileWorkspaceStatus, loadMobileWorkspaceRuntime } from "./mobileWorkspaceSecurity";
import { noteConflict } from "./conflictState";

/**
 * Mobile vault bootstrap (M2/M3): a real sandbox vault behind the SAME
 * adapter chain as the desktop — raw → backup snapshots → sync queue →
 * conflict-aware three-way merge — plus the shared indexer/query service on
 * SQLite. The SQLite plugin has no plain-web backing store, so in the
 * browser the app runs chainless with search and sync disabled; natively
 * the full stack is live.
 */

export interface MobileVault {
  /** Registry id of this vault ("local" or a connection id). */
  vaultId: string;
  /** True when this boot created the vault (first run) — gates the template offer. */
  freshlySeeded: boolean;
  /** Raw sandbox adapter (listing, binary reads). */
  adapter: CapacitorVaultAdapter;
  /** App-facing adapter: the conflict-aware chain natively, raw on the web. */
  files: IVaultAdapter;
  backup: BackupVaultAdapter | null;
  syncQueue: SyncQueue | null;
  syncRepo: SyncStateRepository | null;
  workspaceRuntime: PersonalWorkspaceRuntime | null;
  workspaceState: SqlWorkspaceStateStore | null;
  /** Raw index DB (also carries the pim_* tables) — the calendar/PIM runtime. */
  db: IDatabaseAdapter | null;
  indexer: VaultIndexer | null;
  queryService: VaultQueryService | null;
  searchAvailable: boolean;
  /** Lets locally created files enqueue for push (called once sync starts). */
  enableSyncEnqueue(): void;
  /** Ends the initial-index enqueue deferral (3c) after the first pull. */
  markFirstSyncComplete(): void;
  /**
   * Whether the full index pass has finished. The task reconciler gates note
   * CREATION on this: a vault whose notes are still being indexed would look
   * like it is missing them, and an anchored note that has not been seen yet
   * gets imported a second time — the duplicate 0.6.7 exists to prevent.
   */
  indexSettled(): boolean;
  /** Re-indexes pulled paths so tree and search reflect remote changes. */
  reindexPaths(paths: string[]): Promise<void>;
  /** Closes the per-vault database (used when switching vaults). */
  dispose(): Promise<void>;
}

const OKF = (type: string, title: string, body: string) =>
  `---\ntype: ${type}\nokf_version: "1.0"\n---\n\n# ${title}\n\n${body}\n`;

const SEEDS: Array<[string, string]> = [
  [
    "Willkommen.md",
    OKF(
      "Note",
      "Willkommen",
      "Dein mobiler Plainva-Vault — echte Dateien in der App-Sandbox.\n\n- Der Editor ist DERSELBE wie am Desktop (`@plainva/ui`).\n- Tippe auf **+** für eine neue Notiz.\n- Wiki-Links funktionieren: [[Plainva Mobile]]\n\n> Sync: Mehr → Vault & Sync (WebDAV/Nextcloud).",
    ),
  ],
  ["Inbox/Erste Idee.md", OKF("Note", "Erste Idee", "Schnell erfasst, später einsortiert.")],
  [
    "Projekte/Plainva Mobile.md",
    OKF(
      "Note",
      "Plainva Mobile",
      "Companion-App: erfassen, lesen, finden.\n\n- [x] M1 Gerüst\n- [x] M2 Adapter\n- [ ] M3 Sync\n\nZurück zu [[Willkommen]].",
    ),
  ],
];

const isInternal = (path: string) => path.startsWith(".plainva") || path.includes(".CONFLICT");

/**
 * The vault's index database.
 *
 * Natively this is always the Capacitor SQLite plugin. On a plain web server
 * that plugin has no backing store, so the app used to run WITHOUT an index —
 * no search, no `.base` rows, no graph. That is precisely why the screenshot
 * baseline kept photographing empty states and calling them covered (rework
 * N0.1). When — and only when — the screenshot runner has installed its bridge
 * to a real `node:sqlite`, the index runs against that instead, so the
 * pictures show the surfaces they are supposed to prove.
 */
function createIndexDatabase(dbName: string): IDatabaseAdapter {
  return isFixtureSqliteAvailable() ? new FixtureSqliteAdapter(dbName) : new CapacitorSqliteAdapter(dbName);
}

/**
 * Says out loud when a version snapshot could not be written.
 *
 * It used to be a console line, which on a phone is nobody (finding
 * 2026-08-19): the file is saved either way, but the safety net silently is
 * not there — exactly the state a person has to know about. Throttled like the
 * desktop's, so a full disk cannot turn every keystroke into a toast.
 */
const SNAPSHOT_ERROR_TOAST_INTERVAL_MS = 60_000;
let lastSnapshotErrorToastAt = 0;
function reportSnapshotFailure(path: string): void {
  const now = Date.now();
  if (now - lastSnapshotErrorToastAt < SNAPSHOT_ERROR_TOAST_INTERVAL_MS) return;
  lastSnapshotErrorToastAt = now;
  console.warn("[mobile] backup snapshot failed", path);
  toast.warning(i18n.t("backup.snapshotFailed", { path }));
}

let bootPromise: Promise<MobileVault> | null = null;

export function getMobileVault(): Promise<MobileVault> {
  if (!bootPromise) bootPromise = getActiveVaultEntry().then(boot);
  return bootPromise;
}

/**
 * Activates another registry vault: stops the sync worker, closes the
 * current per-vault database and reboots. Screens listen for the event and
 * reset their stacks.
 */
export async function switchVault(id: string): Promise<void> {
  const current = bootPromise ? await bootPromise.catch(() => null) : null;
  if (current?.vaultId === id) return;
  // Pending editor saves must land BEFORE the worker stops and the database
  // closes — and they land in the vault they were typed in (the coordinator
  // captured that instance per schedule call).
  await noteSaver.flushAll();
  // Drain, don't just flag-stop (P3.4/M4): a cycle still downloading or
  // writing must finish before dispose() closes the per-vault database.
  await stopSyncAndDrain();
  await setActiveVault(id);
  // Swap the per-vault settings slice (folders, backup retention) to the new
  // vault BEFORE the next boot reads the backup policy / screens re-read
  // getMobileSettings() on the event below (package A vault isolation).
  await reloadMobileSettingsForActiveVault();
  if (current) await current.dispose().catch(() => {});
  bootPromise = null;
  window.dispatchEvent(new CustomEvent("m-vault-switched", { detail: { id } }));
}

export async function reloadActiveMobileVault(): Promise<void> {
  const current = bootPromise ? await bootPromise.catch(() => null) : null;
  await noteSaver.flushAll();
  await stopSyncAndDrain();
  if (current) await current.dispose().catch(() => {});
  bootPromise = null;
  window.dispatchEvent(new CustomEvent("m-vault-switched", { detail: { id: current?.vaultId } }));
}

/**
 * Deletes a connection vault: device-local container, index database,
 * credential slot and registry entry. The cloud storage is never touched.
 */
export async function deleteVault(id: string): Promise<void> {
  if (id === LOCAL_VAULT_ID) throw new Error("the local vault cannot be deleted");
  await noteSaver.flushAll();
  const current = bootPromise ? await bootPromise.catch(() => null) : null;
  // PIM rows live in the vault's own index database, which `switchVault` closes
  // — so they have to be read while it is still open. A vault that is not the
  // active one has a closed database anyway; its slots are then covered by the
  // registry ids alone, which is why this is best-effort rather than a hard
  // requirement (finding 2026-08-19).
  const pimIds =
    current?.vaultId === id && current.db
      ? await new PimCacheRepository(current.db)
          .listAccounts()
          .then((rows) => rows.map((r) => r.id))
          .catch(() => [] as string[])
      : [];
  if (current?.vaultId === id) await switchVault(LOCAL_VAULT_ID);
  try {
    await Filesystem.rmdir({ path: `vaults/${id}`, directory: Directory.Data, recursive: true });
  } catch {
    /* container may not exist (never synced) */
  }
  // The per-service slots are named after account ids, so they have to be
  // collected while the registries that hold those ids still exist (finding
  // 2026-08-19): an account that is already gone cannot have its slot removed.
  const secretKeys = await collectVaultSecretKeys(id, {
    cloud: await loadCloudAccounts(id).then((rows) => rows.map((r) => r.id)).catch(() => []),
    pim: pimIds,
    mail: await listMailAccounts(id).then((rows) => rows.map((r) => r.id)).catch(() => []),
  }).catch(() => [] as string[]);

  await CapacitorSqliteAdapter.deleteDatabase(`plainva-${id}`).catch(() => {});
  // Drop the connection E2E pin + vault-scoped settings-sync state BEFORE the
  // provider secret is purged (the connection id is derived from it), so
  // re-connecting the same cloud folder never reanimates the fail-closed guard.
  await getStoredProvider(id)
    .then((provider) => clearMobileSyncState(id, provider))
    .catch(() => {});
  // The cloud-account registry is vault-scoped too; leaving it behind would
  // resurrect stale accounts if the same vault id were ever reused.
  await clearCloudAccounts(id).catch(() => {});
  await purgeCredentials(id).catch(() => {});
  // Everything the old delete left on the device: the per-service secrets, the
  // drafts, the repair/import journals, the settings record, the bar layout.
  await forgetVaultSecrets(secretKeys);
  await forgetVaultFiles(id).catch(() => {});
  await forgetVaultStoreKeys(id).catch(() => {});
  await removeVault(id);
}

/**
 * Creates a NEW local vault (no provider): a fresh registry entry + its own
 * container, then switches to it. The empty container is seeded on boot
 * (freshlySeeded), so the caller may then offer a structure template.
 */
export async function createLocalVault(name: string): Promise<string> {
  const id = newVaultId();
  await addVault({ id, name });
  await switchVault(id);
  return id;
}

async function boot(entry: VaultEntry): Promise<MobileVault> {
  // Paths are vault-relative: a stale lastPersisted entry from another vault
  // must never classify this vault's disk content as our own echo.
  clearPersistedTextCache();
  // The default local vault keeps the legacy container/db paths (existing
  // data); every other vault — cloud OR an additional local vault — gets its
  // own vaults/<id>. "Local" (no provider) means there is no remote to pull
  // from, so an empty one is seeded (and may then be templated).
  const isDefaultLocal = entry.id === LOCAL_VAULT_ID;
  const isLocal = !entry.provider;
  const adapter = new CapacitorVaultAdapter(isDefaultLocal ? "vault" : `vaults/${entry.id}`);
  await adapter.initialize();
  const workspaceStatus = await getMobileWorkspaceStatus(entry.id);
  const workspaceRuntime = workspaceStatus ? await loadMobileWorkspaceRuntime(entry.id) : null;

  // A vault seeded THIS boot is brand new — the onboarding may offer the
  // structure templates (package I); existing installs never get the offer.
  let freshlySeeded = false;
  // Set when the full index pass is through — see MobileVault.indexSettled.
  let indexPassSettled = false;
  if (isLocal && (await adapter.listDir("")).length === 0) {
    for (const [path, text] of SEEDS) await adapter.writeTextFile(path, text);
    freshlySeeded = true;
  }

  // Enqueue guards mirror the desktop: nothing enqueues before sync is
  // configured, and the initial full index defers new-file pushes until the
  // first pull established the remote base (3c — a fresh index must never
  // mass-push over a possibly newer remote).
  let syncEnqueueEnabled = false;
  let deferInitialEnqueue = true;
  let queue: SyncQueue | null = null;
  let workspaceState: SqlWorkspaceStateStore | null = null;
  let permissioned: PermissionedVaultAdapter | null = null;

  const enqueueLocal = async (path: string) => {
    if (!syncEnqueueEnabled || isInternal(path)) return;
    if (permissioned && !await permissioned.authorizeExternalChange(path, true)) return;
    if (workspaceState) void workspaceState.enqueue("write", path).catch(() => {});
    else if (queue) void queue.queueWrite(path).catch(() => {});
  };

  let files: IVaultAdapter;
  let backup: BackupVaultAdapter | null;
  let syncRepo: SyncStateRepository | null;
  let indexer: VaultIndexer | null;
  let queryService: VaultQueryService | null;
  let searchAvailable = false;

  let db: IDatabaseAdapter | null = null;
  try {
    db = createIndexDatabase(isDefaultLocal ? "plainva-index" : `plainva-${entry.id}`);
    await db.initialize();
    await initializeSchema(db);

    // Retention comes from the global mobile settings (package G); the
    // desktop keeps this per vault, mobile applies one policy to the active
    // vault (updatePolicy also reacts to live settings changes below).
    const ms = getMobileSettings();
    backup = new BackupVaultAdapter(adapter, {
      policy: {
        ...DEFAULT_BACKUP_RETENTION,
        minSnapshotIntervalSeconds: ms.backupIntervalSeconds,
        maxBackupsPerFile: ms.backupMaxPerFile,
        maxAgeDays: ms.backupMaxAgeDays,
      },
      onBackupError: reportSnapshotFailure,
      // S4: this device has no trash. A recursively deleted folder is final
      // here, so every file below it gets a snapshot first — the desktop
      // deletes into the OS trash and names that in its confirmation.
      snapshotRecursiveDeletes: true,
    });
    queue = new SyncQueue(db);
    workspaceState = workspaceStatus ? new SqlWorkspaceStateStore(db) : null;
    permissioned = workspaceState ? new PermissionedVaultAdapter(backup, async (request) => {
      if (!workspaceRuntime) return false;
      const existing = await workspaceState!.getObjectByPath(request.path);
      const objectId = existing?.objectId ?? createWorkspaceObjectId();
      const policy = workspaceRuntime.policy.payload;
      const access = (path: string, capability: Parameters<typeof evaluateWorkspaceAccess>[1]["capability"]) => evaluateWorkspaceAccess(policy, {
        memberId: workspaceRuntime.memberId,
        deviceId: workspaceRuntime.device.publicIdentity.deviceId,
        capability,
        objectId,
        sliceIds: workspaceSliceIdsForObject(policy, { objectId, path, contentKind: existing?.contentKind }),
      });
      const sourceDecision = access(request.path, request.capability);
      if (!request.newPath || !sourceDecision.allowed) return sourceDecision;
      const targetDecision = access(request.newPath, request.capability);
      if (!targetDecision.allowed) return targetDecision;
      if (access(request.path, "content.read").allowed && !access(request.newPath, "content.read").allowed) {
        const { Dialog } = await import("@capacitor/dialog");
        const answer = await Dialog.confirm({
          title: i18n.t("workspaceSecurity.moveAccessLossTitle"),
          message: i18n.t("workspaceSecurity.moveAccessLossMessage", { path: request.newPath }),
          okButtonTitle: i18n.t("workspaceSecurity.moveAnyway"),
          cancelButtonTitle: i18n.t("common.cancel"),
        });
        return answer.value;
      }
      return targetDecision;
    }, async (request) => {
      const forkId = createWorkspaceObjectId();
      const safeName = request.path.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "_") || "external-change";
      const forkPath = `.plainva/workspace/forks/${forkId}-${safeName}`;
      if (await backup!.exists(request.path)) { await backup!.createDir(".plainva/workspace/forks"); await backup!.writeBinaryFile(forkPath, await backup!.readBinaryFile(request.path)); }
      await workspaceState!.saveLocalFork({ forkId, originalPath: request.path, forkPath, reason: "permission-denied", createdAt: new Date().toISOString() });
    }) : null;
    const queueing = workspaceState ? new WorkspaceQueueingVaultAdapter(permissioned!, workspaceState) : new QueueingVaultAdapter(backup, queue);
    syncRepo = new SyncStateRepository(db);
    files = new ConflictAwareVaultAdapter(queueing, syncRepo, (path, mergedText) => {
      window.dispatchEvent(new CustomEvent("m-auto-merged", { detail: { path, mergedText } }));
    });

    indexer = new VaultIndexer(files, db, {
      onExternalModification: (path) => {
        void enqueueLocal(path);
        window.dispatchEvent(new CustomEvent("m-external-update", { detail: { path } }));
      },
      onNewLocalFile: (path) => {
        if (deferInitialEnqueue) return;
        void enqueueLocal(path);
      },
      onLocalFileDeleted: (path) => {
        if (!syncEnqueueEnabled || isInternal(path)) return;
        if (permissioned) { void permissioned.authorizeExternalChange(path, false).then((allowed) => { if (allowed) return workspaceState!.enqueue("delete", path); }).catch(() => {}); }
        else if (queue) void queue.queueDelete(path).catch(() => {});
      },
    });
    queryService = new VaultQueryService(db);
    // Warm index (P5): a vault that was indexed before boots straight from
    // the database — the full pass runs in the background and refreshes the
    // UI when done. A cold/empty index still blocks so the tree is never
    // empty on first open.
    const warm = ((await db.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM files"))?.n ?? 0) > 0;
    if (warm) {
      void indexer
        .indexVaultFull()
        .then(() => {
          indexPassSettled = true;
          window.dispatchEvent(new CustomEvent("m-vault-changed"));
        })
        .catch(() => {});
    } else {
      await indexer.indexVaultFull();
      indexPassSettled = true;
    }
    searchAvailable = true;
  } catch (err) {
    console.warn("[mobile] index unavailable (expected on the plain web dev server)", err);
    files = adapter;
    backup = null;
    queue = null;
    syncRepo = null;
    indexer = null;
    queryService = null;
    db = null;
  }

  const v: MobileVault = {
    vaultId: entry.id,
    freshlySeeded,
    adapter,
    files,
    backup,
    syncQueue: queue,
    syncRepo,
    workspaceRuntime,
    workspaceState,
    db,
    indexer,
    queryService,
    searchAvailable,
    enableSyncEnqueue: () => {
      syncEnqueueEnabled = true;
    },
    markFirstSyncComplete: () => {
      deferInitialEnqueue = false;
    },
    indexSettled: () => indexPassSettled,
    reindexPaths: async (paths) => {
      if (!indexer) return;
      for (const p of paths) {
        try {
          await indexer.indexFile(await adapter.getFileInfo(p));
        } catch {
          /* deleted or transient — the next full pass repairs it */
        }
      }
    },
    dispose: async () => {
      if (db) await db.close().catch(() => {});
    },
  };
  // An import that died mid-apply left a journal behind; roll it back before
  // anything reads the half state. It lives HERE rather than in the sync path
  // because that one only runs with a provider configured — someone who
  // crashed and then paused the sync would never see a recovery.
  //
  // A failing rollback is logged, not thrown: the desktop lets it fail the
  // vault open, but on the phone that would mean an app that will not start.
  // The journal stays behind on purpose, so the next start tries again.
  try {
    await recoverProfileImportIfNeeded(v);
  } catch (e) {
    console.error("[boot] profile import rollback failed", e);
  }
  return v;
}

export interface FolderListing {
  folders: Array<{ name: string; count: number }>;
  notes: Array<{ path: string; title: string; mtime?: number }>;
  /** Read-only databases (M4): .base files in this folder. */
  bases: Array<{ path: string; title: string }>;
  /**
   * Everything else in the folder (S42).
   *
   * The navigator listed notes and databases only, so a photo inserted into a
   * note was invisible the moment you left the note — the file was in the
   * vault, synced and backed up, and no screen on the phone would admit it
   * existed. Dot-files stay hidden: `.plainva` is machinery, not content.
   */
  attachments: Array<{ path: string; name: string; isImage: boolean }>;
}

const noteTitle = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");

export const vaultOps = {
  async listFolder(v: MobileVault, folder: string): Promise<FolderListing> {
    const entries = await v.files.listDir(folder);
    // Note counts per subfolder (mockup 1 "24 Notizen").
    //
    // S21: this counted ONE level with a directory listing, so a folder holding
    // nothing but subfolders said "0 Notizen" beside a chevron that leads to
    // hundreds. The index knows every path, and one query answers the whole
    // listing recursively — cheaper than the listings it replaces. Without an
    // index (first run, before the initial scan) the shallow count still beats
    // showing nothing.
    const folderNames = entries
      .filter((e) => e.isDirectory && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
    const deep = v.queryService ? await v.queryService.countNotesPerSubfolder(folder) : null;
    const shallowCount = async (path: string): Promise<number> => {
      try {
        return (await v.files.listDir(path)).filter((e) => !e.isDirectory && /\.md$/i.test(e.name)).length;
      } catch {
        return 0;
      }
    };
    const folders = await Promise.all(
      folderNames.map(async (name) => ({
        name,
        count: deep ? (deep.get(name) ?? 0) : await shallowCount(folder ? `${folder}/${name}` : name),
      })),
    );
    const notes = entries
      .filter((e) => !e.isDirectory && /\.md$/i.test(e.name))
      .map((e) => ({ path: e.path, title: noteTitle(e.path), mtime: e.mtime }))
      .sort((a, b) => a.title.localeCompare(b.title));
    const bases = entries
      .filter((e) => !e.isDirectory && /\.base$/i.test(e.name))
      .map((e) => ({ path: e.path, title: e.name.replace(/\.base$/i, "") }))
      .sort((a, b) => a.title.localeCompare(b.title));
    const attachments = entries
      .filter(
        (e) =>
          !e.isDirectory &&
          !e.name.startsWith(".") &&
          !/\.(md|base)$/i.test(e.name),
      )
      .map((e) => ({ path: e.path, name: e.name, isImage: isImagePath(e.path) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { folders, notes, bases, attachments };
  },

  /** Renames a note within its folder; sync mirrors it via the queueing chain.
   * With a warm index every vault link onto the note is retargeted through the
   * SHARED renameFileWithLinkUpdates (package C — a mobile rename used to break
   * [[links]] silently); rewrites run through v.files, so backups + sync queue
   * see every touched referencing note. */
  async rename(v: MobileVault, oldPath: string, newTitle: string): Promise<string> {
    // S2: land the editor's pending text BEFORE the path moves. A queued save
    // that settles afterwards writes to the OLD path — which recreates the file
    // we just renamed away, and the sync queue then pushes that ghost.
    await noteSaver.flush(oldPath);
    const dir = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/") + 1) : "";
    const newPath = `${dir}${newTitle}.md`;
    if (newPath === oldPath) return oldPath;
    let changedPaths: string[] = [];
    if (v.queryService) {
      const result = await renameFileWithLinkUpdates({
        adapter: v.files,
        queryService: v.queryService,
        oldPath,
        newPath,
      });
      changedPaths = result.changedPaths;
      if (result.linkUpdateFailed) toast.warning(i18n.t("dialogs.renameLinksFailed"));
      else if (result.changedFiles > 0)
        toast.success(i18n.t("dialogs.renameLinksUpdated", { links: result.renamedLinks, files: result.changedFiles }));
    } else {
      await v.files.renameItem(oldPath, newPath);
    }
    if (v.indexer) {
      await v.indexer.removePathFromIndex(oldPath).catch(() => {});
      for (const p of [newPath, ...changedPaths]) {
        try {
          await v.indexer.indexFile(await v.adapter.getFileInfo(p));
        } catch {
          /* next full pass repairs it */
        }
      }
    }
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
    return newPath;
  },

  /** Deletes a note; with sync active the deletion reaches the cloud too. */
  async remove(v: MobileVault, path: string): Promise<void> {
    // S2: a queued save landing after the delete resurrects the note. Flushing
    // (rather than discarding) also awaits a write already in flight, which
    // `discard` cannot recall — and it leaves a snapshot of the last state.
    await noteSaver.flush(path);
    await v.files.deleteItem(path);
    if (v.indexer) await v.indexer.removePathFromIndex(path).catch(() => {});
    // Drop a bookmark to the deleted note so it can't be tapped into a crash.
    await this.removeBookmark(v, path).catch(() => {});
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
  },

  /* ---- P3: full file/folder operations (all through the sync chain) ---- */

  async createFolder(v: MobileVault, path: string): Promise<void> {
    await v.files.createDir(path);
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
  },

  /** Folder renames/deletes re-run the full index (children change paths). */
  async renameFolder(v: MobileVault, oldPath: string, newName: string): Promise<void> {
    // S2, whole-queue variant: every note UNDER the folder changes path, and
    // we do not know which of them the editor holds — so everything pending
    // lands first. With nothing pending this costs nothing.
    await noteSaver.flushAll();
    const dir = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/") + 1) : "";
    const newPath = `${dir}${newName}`;
    if (newPath === oldPath) return;
    await v.files.renameItem(oldPath, newPath);
    // Pinboard arrangements store vault-relative paths (plan Pinboard P5):
    // rewrite them by prefix so cards under the folder keep position and pin.
    await sweepPinboardRefs({ adapter: v.files, queryService: v.queryService }, [], [{ from: oldPath, to: newPath }]).catch(() => {});
    if (v.indexer) await v.indexer.indexVaultFull().catch(() => {});
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
  },

  async removeFolder(v: MobileVault, path: string): Promise<void> {
    // S2: same reasoning as renameFolder — a queued save for any note inside
    // would recreate it after the folder is gone.
    await noteSaver.flushAll();
    await v.files.deleteItem(path, true);
    if (v.indexer) await v.indexer.indexVaultFull().catch(() => {});
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
  },

  async moveNote(v: MobileVault, path: string, targetFolder: string): Promise<string> {
    // S2: identical to rename — the path moves, a late save would write to the
    // old one and leave a ghost the sync queue then pushes.
    await noteSaver.flush(path);
    const name = path.split("/").pop()!;
    const newPath = targetFolder ? `${targetFolder}/${name}` : name;
    if (newPath === path) return path;
    await v.files.renameItem(path, newPath);
    // Retarget pinboard arrangements (vault-relative paths, plan Pinboard P5).
    const sweptBases = await sweepPinboardRefs({ adapter: v.files, queryService: v.queryService }, [{ from: path, to: newPath }]).catch(() => [] as string[]);
    if (v.indexer) {
      await v.indexer.removePathFromIndex(path).catch(() => {});
      for (const p of [newPath, ...sweptBases]) {
        try {
          await v.indexer.indexFile(await v.adapter.getFileInfo(p));
        } catch {
          /* next full pass repairs it */
        }
      }
    }
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
    return newPath;
  },

  async duplicateNote(v: MobileVault, path: string): Promise<string> {
    // S2, and here the damage is different in kind: without the flush the copy
    // is taken from the LAST SAVED text, so a duplicate made while typing
    // silently loses whatever came after the last autosave.
    await noteSaver.flush(path);
    const text = await v.files.readTextFile(path);
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    const base = path.split("/").pop()!.replace(/\.md$/i, "");
    let candidate = `${dir}${base} 2.md`;
    for (let n = 2; await v.files.exists(candidate); n++) {
      candidate = `${dir}${base} ${n + 1}.md`;
    }
    await v.files.writeTextFile(candidate, text);
    if (v.indexer) {
      try {
        await v.indexer.indexFile(await v.adapter.getFileInfo(candidate));
      } catch {
        /* next full pass repairs it */
      }
    }
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
    return candidate;
  },

  /* ---- P3: bookmarks (device-local, .plainva/bookmarks.json) ---- */

  async getBookmarks(v: MobileVault): Promise<string[]> {
    try {
      const raw = await v.adapter.readTextFile(".plainva/bookmarks.json");
      // Shared parser (package A5): accepts the legacy bare-array shape this
      // shell used to write AND the desktop {items:[...]} object.
      const paths = parseBookmarksFile(raw).paths;
      // A bookmark to a note deleted/renamed elsewhere (sync, folder delete,
      // move) silently falls out — mirrors getRecents so a stale bookmark can
      // never point at a missing file (tapping it used to crash the app).
      const out: string[] = [];
      for (const p of paths) {
        if (await v.adapter.exists(p)) out.push(p);
      }
      return out;
    } catch {
      return [];
    }
  },

  async toggleBookmark(v: MobileVault, path: string): Promise<boolean> {
    const marks = await this.getBookmarks(v);
    const idx = marks.indexOf(path);
    if (idx >= 0) marks.splice(idx, 1);
    else marks.push(path);
    await v.adapter.writeTextFile(".plainva/bookmarks.json", serializeBookmarksFile(marks));
    window.dispatchEvent(new CustomEvent("m-vault-changed"));
    return idx < 0;
  },

  /** Removes a path from bookmarks if present (e.g. on delete); persists the
   *  cleanup by reading the RAW file so it works even after the note is gone. */
  async removeBookmark(v: MobileVault, path: string): Promise<void> {
    let paths: string[];
    try {
      paths = parseBookmarksFile(await v.adapter.readTextFile(".plainva/bookmarks.json")).paths;
    } catch {
      return; // no bookmarks file yet
    }
    if (!paths.includes(path)) return;
    await v.adapter.writeTextFile(
      ".plainva/bookmarks.json",
      serializeBookmarksFile(paths.filter((p) => p !== path)),
    );
  },

  async recent(v: MobileVault, limit: number): Promise<Array<{ path: string; title: string }>> {
    const all = await v.files.listDir("", true);
    return all
      .filter((e) => !e.isDirectory && /\.md$/i.test(e.name) && !e.path.startsWith("."))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((e) => ({ path: e.path, title: noteTitle(e.path) }));
  },

  /* ---- B2: real MRU (last OPENED, .plainva/recents.json — device-local,
     shared contract with the desktop in @plainva/ui). mtime `recent()` above
     stays the first-run fallback: it surfaces synced files, not opens. ---- */

  async getRecents(
    v: MobileVault,
    limit: number,
  ): Promise<Array<{ path: string; title: string; openedAt?: number }>> {
    try {
      const entries = parseRecentsFile(await v.adapter.readTextFile(".plainva/recents.json"));
      const out: Array<{ path: string; title: string; openedAt?: number }> = [];
      for (const e of entries) {
        if (out.length >= limit) break;
        // Deleted/renamed notes silently fall out of the strip.
        if (await v.adapter.exists(e.path))
          out.push({ path: e.path, title: noteTitle(e.path), openedAt: e.openedAt });
      }
      return out;
    } catch {
      return [];
    }
  },

  async pushRecent(v: MobileVault, path: string): Promise<void> {
    if (!/\.md$/i.test(path) || path.startsWith(".")) return;
    try {
      let entries: ReturnType<typeof parseRecentsFile> = [];
      try {
        entries = parseRecentsFile(await v.adapter.readTextFile(".plainva/recents.json"));
      } catch {
        /* first use */
      }
      await v.adapter.writeTextFile(
        ".plainva/recents.json",
        serializeRecentsFile(pushRecentEntry(entries, path, Date.now())),
      );
    } catch {
      /* recents are best-effort; never block opening a note */
    }
  },

  async read(v: MobileVault, path: string): Promise<string> {
    return v.files.readTextFile(path);
  },

  async save(v: MobileVault, path: string, text: string): Promise<void> {
    await v.files.writeTextFile(path, text);
    if (v.indexer) {
      try {
        const info: VaultFileInfo = await v.adapter.getFileInfo(path);
        await v.indexer.indexFile(info);
      } catch {
        /* index lag is acceptable; the next full pass repairs it */
      }
    }
  },

  /**
   * New note in a folder. Since the Vorlagen-Engine (P6) this goes through the
   * template rules: a folder or type rule set on the desktop seeds the body
   * here too, questions are asked in one sheet, and `{{cursor}}` is parked for
   * the editor that opens next. Cancelling the questions creates nothing —
   * hence the nullable return.
   */
  async createNote(v: MobileVault, folder: string, type: string): Promise<string | null> {
    for (let n = 1; ; n++) {
      const title = `Notiz ${n}`;
      const path = `${folder}/${title}.md`;
      if (await v.files.exists(path)) continue;
      const built = await buildNewNoteFromTemplate({
        read: (p) => this.read(v, p),
        exists: (p) => v.files.exists(p),
        vaultName: (await getActiveVaultEntry()).name || "Plainva",
        folder,
        title,
        type,
        fallbackBody: OKF(type, title, ""),
      });
      if (!built) return null;
      await this.save(v, path, built.content);
      if (built.caret !== null) setPendingTemplateCaret({ path, offset: built.caret });
      return path;
    }
  },

  /**
   * New note from a template (R3.4): the full template text with the
   * placeholders interpolated against the chosen title; a template without
   * frontmatter gets the OKF header so every created note stays conformant.
   * Name collisions count up ("Name 2", "Name 3", …).
   */
  async createNoteFromTemplate(
    v: MobileVault,
    folder: string,
    title: string,
    templateRaw: string,
  ): Promise<string | null> {
    let name = title;
    let n = 2;
    while (await v.files.exists(`${folder}/${name}.md`)) name = `${title} ${n++}`;
    const path = `${folder}/${name}.md`;
    const ms = getMobileSettings();
    // The raw text is already in hand (picked template / share capture), so the
    // engine runs on it directly — the file-based rule lookup would only find
    // the same thing, and the share path has no file at all.
    const answered = await applyTemplateInteractive(templateRaw, {
      title: name,
      now: new Date(),
      folder,
      vaultName: (await getActiveVaultEntry()).name || "Plainva",
      dailyPath: (offset) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return buildDailyNotePath(d, ms.dailyFormat, ms.dailyFolder).fullPath.replace(/\.md$/i, "");
      },
    });
    if (!answered) return null; // cancelled → nothing is created
    const content = /^---\r?\n/.test(answered.text)
      ? answered.text
      : `---\ntype: ${ms.defaultNoteType}\nokf_version: "1.0"\n---\n\n${answered.text.replace(/^\n+/, "")}`;
    await this.save(v, path, content);
    if (answered.cursor !== null) {
      setPendingTemplateCaret({ path, offset: answered.cursor + (content.length - answered.text.length) });
    }
    return path;
  },

  async ensureNote(v: MobileVault, path: string, type: string, title: string): Promise<string> {
    if (!(await v.files.exists(path))) await this.save(v, path, OKF(type, title, ""));
    return path;
  },

  /**
   * Create-and-return the note a click on an unresolved wiki link points to
   * (maintainer 2026-07-18, Obsidian parity). Same placement rules as desktop
   * (shared wikiTargetToPath): explicit folder, else the host note's folder,
   * else the vault root. Existing target = just return it (race-safe).
   */
  async createNoteFromWikiTarget(v: MobileVault, target: string, hostPath?: string): Promise<string | null> {
    const { path, title } = wikiTargetToPath(target, hostPath);
    if (!title) return null;
    if (await v.files.exists(path)) return path;
    await this.save(v, path, OKF("Note", title, ""));
    return path;
  },

  /**
   * Daily note create-or-open (package I): a configured daily template seeds
   * fresh dailies (placeholders interpolated, OKF frontmatter secured —
   * desktop dailyNotesTemplate contract); without one the plain skeleton.
   */
  async ensureDailyNote(v: MobileVault, path: string, title: string): Promise<string | null> {
    if (await v.files.exists(path)) return path;
    const ms = getMobileSettings();
    if (ms.dailyTemplate) {
      const tplPath = `${ms.templateFolder}/${ms.dailyTemplate}`;
      // A missing template file falls back to the skeleton below.
      const raw = await this.read(v, tplPath).catch(() => null);
      if (raw !== null) {
        // Opening today's note is a PERSON's action, so a `{{prompt:…}}` in
        // the daily template asks rather than resolving to nothing (P6).
        const answered = await applyTemplateInteractive(raw, {
          title,
          now: new Date(),
          folder: path.split("/").slice(0, -1).join("/"),
          vaultName: (await getActiveVaultEntry()).name || "Plainva",
        });
        if (!answered) return null; // cancelled → no daily note is created
        const content = /^---\r?\n/.test(answered.text)
          ? answered.text
          : `---\ntype: ${ms.dailyNoteType}\nokf_version: "1.0"\n---\n\n${answered.text.replace(/^\n+/, "")}`;
        await this.save(v, path, content);
        if (answered.cursor !== null) {
          setPendingTemplateCaret({ path, offset: answered.cursor + (content.length - answered.text.length) });
        }
        return path;
      }
    }
    await this.save(v, path, OKF("Daily Note", title, ""));
    return path;
  },

  async resolveWikiTarget(v: MobileVault, target: string, hostPath?: string): Promise<string | null> {
    if (!target.trim()) return null;
    // Path-style target (markdown relative/absolute link, incl. generated
    // index.md links): resolve against the host folder, then the vault root.
    // This used to match by note TITLE only, so markdown links never opened on
    // mobile (maintainer, 2026-07-15).
    for (const c of relativeLinkCandidates(target, hostPath)) {
      if (await v.files.exists(c)) return c;
    }
    // Bare wiki target ([[Note]]): match by note title — and, failing that, by
    // FILE NAME including the extension, which is how an attachment is written
    // (issue #55). Dropping a PDF into a note produces `[[Report.pdf]]`; the
    // title-only match never resolved that, so the app went on to CREATE
    // `Report.pdf.md`. Notes keep precedence: the loop below runs over notes
    // first and only then considers attachments, so a note called "Report"
    // still wins over a file called "Report".
    const name = target.split("#")[0].split("|")[0].trim().toLowerCase();
    const all = await v.files.listDir("", true);
    const files = all.filter((e) => !e.isDirectory);
    for (const e of files) {
      if (!/\.md$/i.test(e.name)) continue;
      if (noteTitle(e.path).toLowerCase() === name) return e.path;
    }
    for (const e of files) {
      if (/\.md$/i.test(e.name)) continue;
      if (e.name.toLowerCase() === name) return e.path;
    }
    return null;
  },

  async search(v: MobileVault, query: string): Promise<SearchResult[]> {
    if (!v.queryService) return [];
    return v.queryService.searchFullText(query, 30);
  },
};

/**
 * Text of the editor's last own write (or load) per path — the mobile side of
 * the desktop's lastPersisted tracking (2026-07-16). decideDirtyExternalUpdate
 * compares the on-disk content against this to tell our own save echo from a
 * genuinely foreign version reaching the disk (sync pull, auto-merge).
 */
const lastPersistedText = new Map<string, string>();

export function rememberPersistedText(path: string, text: string): void {
  lastPersistedText.set(path, text);
}

export function getLastPersistedText(path: string): string | null {
  return lastPersistedText.get(path) ?? null;
}

export function clearPersistedTextCache(): void {
  lastPersistedText.clear();
}

/**
 * Shared note-save coordinator (hardening P2 mobile, finding M1): owns the
 * pending text outside any component lifecycle — single-flight per note,
 * latest-write-wins revisions, retry with backoff, and the text survives
 * until a write CONFIRMED. EditorHost schedules here; app background and
 * vault switch/delete flush it. A first failure surfaces one toast; retries
 * keep running silently in the background.
 */
export const noteSaver = createSaveCoordinator<MobileVault>({
  write: async (vault, path, text) => {
    await vaultOps.save(vault, path, text);
    rememberPersistedText(path, text);
  },
  onSchedule: (vault, path, text, revision) => writeDraft(vault, path, text, revision),
  onSaved: (path, vault, revision) => {
    // Only up to the revision that was written: typing on while the save was in
    // flight journals a newer text, and that one has to survive.
    clearDraft(vault, path, revision);
    syncSoon();
  },
  // S5: a conflict is not a transient failure. The adapter has already written
  // the user's text to a `.CONFLICT` sibling; retrying writes another one every
  // backoff round, and none of them is anywhere on screen.
  isTerminal: (err) => err instanceof ConflictError,
  onError: (path, err, attempt) => {
    console.error(`[noteSaver] save failed for ${path} (attempt ${attempt})`, err);
    if (err instanceof ConflictError) {
      // An end state, shown as a banner at the note itself — not a toast that
      // fades before the user can act on it.
      noteConflict(path, err.conflictPath ?? conflictCopyPath(path));
      return;
    }
    if (attempt === 1) toast.warning(i18n.t("mobile.saveRetry"));
  },
});
