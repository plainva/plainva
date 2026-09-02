import React, { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode } from "react";
import { useApp } from "./AppContext";
import { TauriVaultAdapter } from "../adapters/TauriVaultAdapter";
import { TauriDatabaseAdapter } from "../adapters/TauriDatabaseAdapter";
import { VaultIndexer, VaultQueryService, GraphService, initializeSchema, BackupVaultAdapter, IVaultAdapter, ConflictAwareVaultAdapter, SyncStateRepository, QueueingVaultAdapter, SyncQueue, SyncWorker, SyncEngine, WebDavSyncTarget, DriveSyncTarget, S3SyncTarget, OneDriveSyncTarget, DropboxSyncTarget, ISyncTarget, isInternalPath, SqlWorkspaceStateStore, WorkspaceQueueingVaultAdapter, EncryptedWorkspaceWorker, WorkspaceRevisionHistoryService, WorkspaceQuarantineService, createProviderWorkspaceObjectStore, initializePersonalWorkspaceMigration, PermissionedVaultAdapter, evaluateWorkspaceAccess, effectiveWorkspaceCapabilities, workspaceSliceIdsForObject, loadWorkspaceSliceObjects, workspaceRecipientGroupIds, previewWorkspaceMoveAccess, workspaceGroupNames, refreshWorkspaceSliceMaterialization, listBrokenWorkspaceSlices, createWorkspaceObjectId, approveWorkspacePairing, findWorkspacePairingRequest, pairingFingerprint, parseWorkspacePairingRequest, publishWorkspacePairingApproval, publishWorkspaceGovernanceUpdate, applyWorkspaceGovernanceUpdate, revokeWorkspaceDeviceAndRotate, revokeWorkspaceMemberAndRotate, inviteWorkspaceMember, createWorkspaceGroup, createWorkspaceSlice, createWorkspaceSliceDefinition, previewWorkspaceSlice, createPublication, invitePublicationRecipient as mintPublicationRecipient, publicationRecipients, publicationRecipientGroupId, revokePublicationRecipient as revokeRecipientAndRotate, planPublicationTeardown, runPublicationRefresh, pendingPublicationChanges, publishableObjects, previewPublishedProjection, defaultPublishedPropertyPolicy, type PublishedProjectionPreview, type PublishedSliceMode, emptyPublicationManifest, publicationStoreFor, collectPublicationComments, type PublicationComment, restoreWorkspaceFromRecoveryPackage, rotateWorkspaceRecoveryPackage, publishWorkspaceRecoveryRotation, transferWorkspaceOwnership, prepareWorkspaceComment, publishWorkspaceComment, commitPublishedWorkspaceComment, decodeBase64Exact, workspaceDocumentHash, startWorkspaceRekey, type WorkspaceRekeyMode, type RotatedWorkspaceRecovery, type WorkspaceRevisionRecord, type WorkspaceCommentRecord, type WorkspaceCommentAnchor, type WorkspacePolicyMember, type WorkspaceCapability, type WorkspaceGovernanceUpdate, type WorkspaceRole, type WorkspaceDynamicSliceDefinition, type WorkspaceSliceObject, type PersonalWorkspaceRuntime, type WorkspaceRuntimeMeta, type WorkspacePublicationRecord, type PublicationRecipient, type PublishedSliceProvider } from "@plainva/core";
import { credentialManager } from "../services/CredentialManager";
import { migrateVaultKeychainSlots } from "../services/keychainSlots";
import { brokerTokenProvider } from "../services/accountBroker";
import { resolveFileSyncAccess } from "../services/fileSyncAccess";
import { readSyncRootFolder } from "../services/syncRootFolder";
import { syncStatusStore, type SyncStatusSnapshot } from "../services/syncStatusStore";
import { settlePendingWrites } from "../services/pendingWrites";
import { awaitVaultTeardown, noteVaultTeardown } from "../services/vaultTeardown";
import { currentWindowParams } from "../services/windowContext";
import { createContentRefResolver, tauriSyncUploader } from "../services/syncUpload";
import { createLimiter, noteLargeFileTrimmed, plainvaProducer, profileDefault, setExtraTextExtensions, toast, useStableHandler } from "@plainva/ui";
import { appConfirm } from "../services/appDialogs";
import i18n from "@plainva/ui/i18n";
import { loadBackupRetentionSettings } from "../services/backupPolicy";
import { buildSettingsSyncStep, getActiveConnectionId } from "../services/settingsProfile";
import { LOCAL_COMMENT_CAPABILITIES, listAllLocalComments, listLocalCommentAuthors, listLocalComments, localCommentSelfId, postLocalComment } from "../services/localComments";
import { saveConnectionState } from "../services/encryptionManifest";
import { activatePreparedPersonalWorkspace, listLegacyRemotePlaintext, preparePersonalWorkspace, removeLegacyRemotePlaintext, resumePersonalWorkspaceSetup, workspaceProviderName, type PreparedPersonalWorkspace } from "../services/workspaceSecurity/workspaceLifecycle";
import { WORKSPACE_MINIMUM_CLIENT_VERSION, changeWorkspaceFallbackPassphrase, clearPublicationRuntimes, clearWorkspaceRuntime, persistPublicationRuntime, readPublicationRuntime, describeWorkspaceKeyStorage, getWorkspaceSecurityStatus, readWorkspaceRuntime, lockWorkspaceRuntime, persistWorkspaceRuntime, saveWorkspaceSecurityStatus, unlockWorkspaceRuntime, updateWorkspaceRuntime, type WorkspaceKeyStorage, type WorkspaceSecurityPublicStatus } from "../services/workspaceSecurity/workspaceKeychain";
import { beginWorkspaceJoin as beginWorkspaceJoinFlow, cancelWorkspaceJoin, completeWorkspaceJoin, detectRemoteWorkspace, hasPendingWorkspaceJoin, type PendingJoin, type WorkspaceInvite } from "../services/workspaceSecurity/workspacePairing";
import { startBackupScheduler } from "../services/backupScheduler";
import { startReminderScheduler } from "../services/reminderScheduler";
import { requestCalendarDay } from "../services/pim/calendarNav";
import { forgetTrayNext, reportTrayNext } from "../services/trayNext";
import { showContentInVaultWindow } from "../services/windowManager";
import { CALENDAR_TAB_PATH } from "../components/graph/virtualPaths";
import { openClientVault, type ClientVaultServices } from "../services/clientVault";
import { getWindowBus } from "../services/windowBus";
import { broadcastIndexChanged, installOwnerBus, installSyncStatusMirror } from "../services/ownerBus";
import { createClientSyncWorker } from "../services/clientSyncWorker";
import { createRemoteIndexer, type IndexerApi } from "../services/remoteIndexer";
import { createClientPimRuntime } from "../services/pim/remotePimTarget";
import { fetch } from "@tauri-apps/plugin-http";
import { microsoftAuthFetch } from "../services/authFetch";
import { getSettingsStore } from "../services/settingsStore";
import { appDataDir } from "@tauri-apps/api/path";
import { readFile, writeFile, exists as fsExists, mkdir } from "@tauri-apps/plugin-fs";
import { indexDbFileName } from "../services/indexDbPath";
import { createIncrementalIndexQueue, IncrementalIndexQueue } from "../services/incrementalIndexQueue";
import { AUTO_REFRESH_LIMITS, buildRefreshToast, planAutoRefresh, runVaultRefresh, type VaultRefreshResult } from "../services/vaultRefresh";
import { WATCH_RESCAN_MARKER } from "../adapters/TauriVaultAdapter";
import { createPimRuntime, type PimRuntime } from "../services/pim/pimRuntime";
import { runEntryEventSync } from "../services/pim/entryEventSync";
import { runTaskSync } from "../services/pim/taskSync";
import {
  initTaskDeletion,
  pendingTaskDeletions,
  taskDeletionsInFlight,
  resolveTaskDeletion,
  type TaskDeletionOrder,
} from "../services/pim/taskDeletion";

/** Provider ids match the settings form selection (SettingsModal/Splash deep link). */
export type SyncProviderId = "webdav" | "drive" | "onedrive" | "dropbox" | "s3";

/** Common control surface shared by the legacy and encrypted sync workers. */
export interface VaultSyncWorker {
  start(): void;
  stop(): void;
  stopAndDrain(): Promise<void>;
  triggerImmediate(): void;
  retryFailed(): void;
  /**
   * Drop the delta cursor, revive parked pushes and sync now. Only the plain
   * sync worker has it (the encrypted workspace worker has no delta cursor);
   * "Vault neu einlesen" falls back to triggerImmediate without it.
   */
  fullResync?: () => Promise<void>;
  noteUserInitiatedDeletion(paths: string[]): void;
  listPendingOperations(limit?: number): Promise<{ total: number; items: Array<{ operation: string; file_path: string; retry_count: number }> }>;
}

interface VaultState {
  vaultPath: string | null;
  vaultAdapter: IVaultAdapter | null;
  /** The backup layer of the adapter chain (forceBackup/updatePolicy live here). */
  backupAdapter: BackupVaultAdapter | null;
  dbAdapter: TauriDatabaseAdapter | null;
  // Typed by what the app calls, not by the class: an auxiliary window gets a
  // no-op stand-in (services/remoteIndexer.ts) because the owner indexes every
  // delegated write itself. The real VaultIndexer satisfies this structurally.
  indexer: IndexerApi | null;
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
  syncWorker: VaultSyncWorker | null;
  workspaceSecurityStatus: WorkspaceSecurityPublicStatus | null;
  /**
   * PIM runtime (Gesamtplan PIM-Ausbau 2026-07-17): calendar/task object
   * cache + pull worker, bound to this vault's index DB. null until a vault
   * is open; the worker only starts when the vault has PIM accounts.
   */
  pimRuntime: PimRuntime | null;
  /**
   * Serialized incremental-index queue shared by the watcher and the sync
   * worker's onFilesChanged (services/incrementalIndexQueue.ts): batches never
   * run concurrently, and batches arriving during a run coalesce into one
   * follow-up pass instead of stacking redundant full scans.
   */
  indexQueue: IncrementalIndexQueue | null;
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

/**
 * A recipient's remark, plus the name of the publication it came through (D7).
 *
 * The name is publisher-local - the record on this machine carries it, the
 * publication itself never does - so it is added HERE rather than in core: it
 * answers "which of my publications is this from", which only the publisher can
 * ask.
 */
export type PublicationCommentEntry = PublicationComment & { publicationName: string };

interface VaultContextType extends VaultState {
  selectVault: () => Promise<void>;
  openVault: (path: string) => Promise<void>;
  /**
   * "Read the vault again" (P1): reconcile the index against the disk AND —
   * when the vault syncs — ask the cloud for a full listing. Returns the report
   * so the caller can show it; never throws for the cloud half.
   */
  refreshVault: (opts?: { silent?: boolean; skipCloud?: boolean }) => Promise<VaultRefreshResult>;
  /** Reconcile a single folder subtree (the fast path on huge vaults). */
  refreshFolder: (folderPath: string) => Promise<void>;
  /** Throw the index away and index every file from scratch (slow, with progress). */
  rebuildIndex: () => Promise<void>;
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
  /** Prepare a personal encrypted workspace and its recovery package. */
  preparePersonalWorkspace: (input: { ownerDisplayName: string; deviceDisplayName: string; fallbackPassphrase?: string }) => Promise<PreparedPersonalWorkspace>;
  activatePersonalWorkspace: (draftId: string, onProgress?: (done: number, total: number) => void) => Promise<{ queued: number; total: number }>;
  unlockPersonalWorkspace: (passphrase?: string) => Promise<void>;
  lockPersonalWorkspace: () => Promise<void>;
  removeRemotePlaintext: (onProgress?: (done: number, total: number) => void) => Promise<number>;
  /** Resumes a `setup-incomplete` conversion using the key bundle already on this device. */
  resumePersonalWorkspaceSetup: (onProgress?: (done: number, total: number) => void) => Promise<{ queued: number; total: number }>;
  changeWorkspacePassphrase: (currentPassphrase: string, nextPassphrase: string) => Promise<void>;
  getWorkspaceKeyStorage: () => Promise<{ stored: WorkspaceKeyStorage | null; available: WorkspaceKeyStorage }>;
  /**
   * Reset content-E2E for the active sync connection (Stilllegen P2): un-brick a
   * connection whose remote `encryption.json` is missing or invalid by dropping
   * this device's `knownEncrypted` pin and retrying the sync. Explicit, confirmed
   * user action — the fail-closed guard is otherwise never weakened.
   */
  resetConnectionEncryption: () => Promise<void>;
  /**
   * Decommission the encrypted workspace on this device (Stilllegen P4): lock +
   * drop the local runtime, status and workspace state, then reopen the vault so
   * it comes back as a plain (or local) vault. Also un-bricks an orphaned
   * workspace whose remote `.pvws/genesis` was deleted. Remote `.pvws/` objects
   * are NOT auto-removed (the object store is immutable) — the user deletes the
   * cloud folder afterwards. Explicit, confirmed action.
   */
  decommissionWorkspace: () => Promise<void>;
  /**
   * Lift encryption entirely (E8): the same teardown as
   * `decommissionWorkspace`, but reopen as a NEW plaintext connection so EVERY
   * local file is re-uploaded to the same cloud as plain text (not only
   * local-only files). The immutable `.pvws/` objects are NOT deleted — the user
   * removes the cloud folder afterwards. Local files are untouched and the
   * upload never deletes anything. Explicit, confirmed action.
   */
  liftWorkspaceEncryption: () => Promise<void>;
  getWorkspaceDiagnostics: () => Promise<{ meta: WorkspaceRuntimeMeta | null; queuedMutations: number; legacyPlaintextPaths: number; quarantine: number; localForks: number }>;
  getWorkspaceGovernance: () => Promise<{
    memberId: string;
    deviceId: string;
    members: PersonalWorkspaceRuntime["policy"]["payload"]["members"];
    devices: PersonalWorkspaceRuntime["policy"]["payload"]["devices"];
    groups: PersonalWorkspaceRuntime["policy"]["payload"]["groups"];
    assignments: PersonalWorkspaceRuntime["policy"]["payload"]["assignments"];
    slices: PersonalWorkspaceRuntime["policy"]["payload"]["slices"];
    /** Slices whose definition cannot be read — they grant nothing and the surface says so. */
    brokenSlices: ReturnType<typeof listBrokenWorkspaceSlices>;
    quarantine: Awaited<ReturnType<SqlWorkspaceStateStore["listQuarantine"]>>;
    localForks: Awaited<ReturnType<SqlWorkspaceStateStore["listLocalForks"]>>;
  }>;
  approveWorkspaceDevice: (tokenOrCode: string) => Promise<string>;
  inspectWorkspacePairingRequest: (tokenOrCode: string) => Promise<{ token: string; deviceName: string; platform: string; memberId: string; fingerprint: string; expiresAt: string }>;
  detectJoinableWorkspace: () => Promise<{ workspaceId: string; fingerprint: string } | null>;
  beginWorkspaceJoin: (invite: WorkspaceInvite, deviceName: string) => Promise<PendingJoin>;
  pollWorkspaceJoin: (fallbackPassphrase?: string) => Promise<boolean>;
  getPendingWorkspaceJoin: () => Promise<PendingJoin | null>;
  cancelPendingWorkspaceJoin: () => Promise<void>;
  revokeWorkspaceDevice: (deviceId: string, reason: string, mode?: WorkspaceRekeyMode) => Promise<void>;
  revokeWorkspaceMember: (memberId: string, reason: string, mode?: WorkspaceRekeyMode) => Promise<void>;
  inviteWorkspaceMember: (displayName: string, role: WorkspaceRole, scopeKind?: "workspace" | "slice" | "object", scopeId?: string | null) => Promise<string>;
  createWorkspaceGroup: (input: { name: string; memberIds: string[]; role: WorkspaceRole; scopeKind?: "workspace" | "slice" | "object"; scopeId?: string | null }) => Promise<string>;
  createWorkspaceSlice: (input: { name: string; definition: { kind: "folder"; folder: string } | { kind: "selection"; objectIds: string[] } | { kind: "dynamic"; definition: WorkspaceDynamicSliceDefinition }; materializedObjectIds: string[]; publication?: { mode: "exact" | "sanitized"; access: "read" | "comment" | "suggest"; provider: "google-drive" | "onedrive" | "nextcloud" | "dropbox" | "webdav" | "s3"; propertyAllowlist?: string[] | null; privateProperties?: string[] } }) => Promise<string>;
  previewWorkspaceSlice: (definition: { kind: "folder"; folder: string } | { kind: "selection"; objectIds: string[] } | { kind: "dynamic"; definition: WorkspaceDynamicSliceDefinition }) => Promise<Array<{ objectId: string; path: string }>>;
  /** Candidates a slice can be built FROM: every workspace object with the tags and properties a rule may ask about. The picker and the rule builder need the same list the preview matches against, so both come from one place. */
  listWorkspaceSliceObjects: () => Promise<WorkspaceSliceObject[]>;
  /** Turns a slice into a publication: its own workspace, its own keys, its own folder. Returns the derived publication id. */
  createSlicePublication: (input: { sliceId: string; name: string; mode: "exact" | "sanitized"; access: "read" | "comment" | "suggest"; provider: PublishedSliceProvider; propertyAllowlist?: string[] | null; privateProperties?: string[] }) => Promise<string>;
  listSlicePublications: () => Promise<WorkspacePublicationRecord[]>;
  /** How many objects the next refresh of each publication would publish, republish or retract - the number behind "N changes pending". */
  listPublicationPendingCounts: () => Promise<Record<string, number>>;
  /** What a publication of these objects would hand out: which properties, links and embeds are removed, plus one before/after sample. Answers before the publication exists, so the wizard can show it. */
  previewSlicePublication: (input: { objectIds: string[]; mode: PublishedSliceMode }) => Promise<PublishedProjectionPreview>;
  /** Mints a recipient of one publication and returns the code that lets them in. Their key opens the publication and nothing else. */
  invitePublicationRecipient: (input: { publicationId: string; displayName: string }) => Promise<{ memberId: string; invite: string }>;
  listPublicationRecipients: (publicationId: string) => Promise<PublicationRecipient[]>;
  /**
   * Closes the door behind one recipient and changes the lock.
   *
   * Does NOT reach the bytes they already hold - the store is put-only and a
   * deletion is a tombstone. The surface has to say that before the click.
   */
  revokePublicationRecipient: (input: { publicationId: string; memberId: string; reason: string }) => Promise<void>;
  /** Retracts everything a publication holds, then forgets it. The provider-side share stays for the publisher to remove. */
  removeSlicePublication: (publicationId: string) => Promise<{ retracted: number; error: string | null }>;
  restoreWorkspaceRecovery: (input: { bytes: Uint8Array; recoveryCode: string; deviceDisplayName: string; fallbackPassphrase?: string; revokeOtherDevices?: boolean }) => Promise<void>;
  rotateWorkspaceRecovery: (input: { bytes: Uint8Array; recoveryCode: string }) => Promise<{ bytes: Uint8Array; recoveryCode: string; activation: RotatedWorkspaceRecovery["anchor"] }>;
  activateWorkspaceRecovery: (activation: RotatedWorkspaceRecovery["anchor"]) => Promise<void>;
  prepareWorkspaceOwnerTransfer: (input: { targetMemberId: string; bytes: Uint8Array; recoveryCode: string }) => Promise<{ bytes: Uint8Array; recoveryCode: string; activation: { anchor: RotatedWorkspaceRecovery["anchor"]; update: WorkspaceGovernanceUpdate; ownerMemberId: string } }>;
  activateWorkspaceOwnerTransfer: (activation: { anchor: RotatedWorkspaceRecovery["anchor"]; update: WorkspaceGovernanceUpdate; ownerMemberId: string }) => Promise<void>;
  updateWorkspaceQuarantine: (quarantineId: string, action: "retry" | "ignore" | "repaired") => Promise<void>;
  exportWorkspaceQuarantine: (quarantineId: string) => Promise<Uint8Array | null>;
  getWorkspaceCapabilities: (path: string) => Promise<WorkspaceCapability[] | null>;
  listWorkspaceComments: (path: string) => Promise<WorkspaceCommentRecord[]>;
  /**
   * What the people this note was published to have written back (D7).
   *
   * A publication is a workspace of its own, so their remarks live there and
   * never touch this vault - which is why they cannot simply appear in
   * `listWorkspaceComments`. Separate from that list on purpose: these come
   * from outside, carry their own author names, and cannot be replied to from
   * here, and a column that blurred the two would misrepresent all three facts.
   */
  listPublicationComments: (path: string) => Promise<PublicationCommentEntry[]>;
  /**
   * Every note of this vault that carries comments, path -> its records.
   * The overview (D9) asks one question about the whole vault; asking it note
   * by note would be one query per note.
   */
  listAllWorkspaceComments: () => Promise<Map<string, WorkspaceCommentRecord[]>>;
  /** Every guest remark in the vault, keyed by the source note's path (F4). */
  listAllPublicationComments: () => Promise<Map<string, PublicationCommentEntry[]>>;
  /** Notes this member wrote; empty without a workspace (F4). */
  listOwnedPaths: () => Promise<Set<string>>;
  /**
   * The member roster of the open workspace, for showing names instead of ids.
   * Deliberately NOT getWorkspaceGovernance: that one also refreshes slice
   * materialization counts and reads quarantine plus local forks — far too much
   * work for a label the editor needs on every note it opens.
   */
  listWorkspaceMembers: () => Promise<WorkspacePolicyMember[]>;
  /**
   * Who this device is as a comment author — the member id in a workspace, the
   * device id in a plain vault. Null when neither exists (no vault open), and
   * then nothing counts as addressed to you.
   */
  getCommentSelfId: () => Promise<string | null>;
  postWorkspaceComment: (path: string, body: string, parentCommentId?: string | null, anchor?: WorkspaceCommentAnchor | null, suggestion?: { replacement: string } | null) => Promise<void>;
  resolveWorkspaceComment: (path: string, commentId: string, suggestionOutcome?: "applied" | "declined" | null) => Promise<void>;
  listWorkspaceRevisions: (path: string) => Promise<WorkspaceRevisionRecord[] | null>;
  readWorkspaceRevision: (revisionId: string) => Promise<Uint8Array>;
}

export const VaultContext = createContext<VaultContextType | undefined>(undefined);

// Store filename lives with the desktop settings adapter now (ADR 0011);
// re-exported here because many modules import their store KEYS from this hub.
export { STORE_KEY } from "../services/settingsStore";

/**
 * Default sync poll interval in seconds, and the lowest value we allow.
 *
 * A FUNCTION rather than a constant on purpose (C20). Reading the shared
 * defaults table while THIS module loads reaches across a package boundary, and
 * stage D gave the bundler a chunk order that evaluates this module before the
 * one holding the table: the production bundle then died on startup with an
 * empty window, which is precisely the failure moduleInitBoundary.test.ts
 * describes and its budget used to tolerate here. Inside a function the same
 * read is safe - by the time anything calls it, every chunk is loaded.
 */
export function defaultSyncIntervalSeconds(): number {
  return profileDefault<number>("syncIntervalSeconds")!;
}
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
    run: () => window.dispatchEvent(new CustomEvent("plainva-open-sync-settings")),
  });
}

/** Per-vault sync-interval store key (interval is configured per vault). */
export const syncIntervalKey = (vaultPath: string) =>
  `syncIntervalSeconds_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

export const dailyNotesFolderKey = (vaultPath: string) => `dailyNotesFolder_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const dailyNotesFormatKey = (vaultPath: string) => `dailyNotesFormat_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const templateFolderKey = (vaultPath: string) => `templateFolder_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
/** Folder → template mapping (plan Vorlagen-Engine P4), a `FolderTemplateRule[]`. */
export const folderTemplatesKey = (vaultPath: string) => `folderTemplates_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
/** OKF type → template mapping (P4b), a `TypeTemplateRule[]`. */
export const typeTemplatesKey = (vaultPath: string) => `typeTemplates_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
/** Where dropped/pasted files land (S17); empty = beside the note, as before. */
export const inboxFolderKey = (vaultPath: string) => `inboxFolder_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const attachmentFolderKey = (vaultPath: string) => `attachmentFolder_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
/**
 * Extra file extensions this vault opens as text (C15). A `string[]`; the
 * built-in list in `openTarget.ts` is never reduced by it.
 */
export const textFileExtensionsKey = (vaultPath: string) => `textFileExtensions_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const dailyNoteTemplateKey = (vaultPath: string) => `dailyNoteTemplate_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const extendedDatabasesKey = (vaultPath: string) => `extendedDatabases_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
/** Standard task database (PIM plan 1a): vault-relative path of the `.base`
 * that promoted checkbox tasks (and later synced external tasks) land in. */
export const taskDatabaseKey = (vaultPath: string) => `taskDatabase_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
/** Meetings folder (PIM stage 2c): vault-relative folder for notes created via
 * "Termin → Meeting-Notiz" in the calendar tab. Default "Meetings". */
export const meetingFolderKey = (vaultPath: string) => `meetingFolder_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
/** Default calendar for new events ("<accountId> <calId>"): new events preselect
 * it. Empty/invalid falls back to the first writable calendar. */
export const defaultCalendarKey = (vaultPath: string) => `defaultCalendar_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const DEFAULT_MEETING_FOLDER = "Meetings";
/** Mail capture folder (PIM stage 5): captured e-mail notes + .eml files. */
export const mailFolderKey = (vaultPath: string) => `mailFolder_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const DEFAULT_MAIL_FOLDER = "Mail";
/** Per-vault opt-in: always load remote https images in the mail viewer.
 * Default OFF — loading a remote image is a tracking beacon by definition. */
export const mailRemoteImagesKey = (vaultPath: string) => `mailRemoteImages_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
/**
 * Per-vault: may a comment write its anchor pair into the Markdown (Stufe D,
 * SD2)? Default ON - an anchor that survives an edit is the whole point of
 * anchoring. Off falls back to the stored quote, which still resolves but
 * drifts once the passage around it changes. A VAULT setting, not a per-device
 * one: the markers land in the note, so one device writing them while another
 * does not would leave the same vault half-marked.
 */
export const commentAnchorsKey = (vaultPath: string) => `commentAnchors_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const SHOW_COMPATIBILITY_WARNING_KEY = "showCompatibilityWarning";
/**
 * Global (not per-vault) opt-in: reopen the last vault on start instead of the
 * splash screen. Default OFF — the splash is the standard entry (maintainer,
 * 2026-07-04); the checkbox lives on the splash and in Settings/General.
 */
export const AUTO_OPEN_LAST_VAULT_KEY = "autoOpenLastVault";

/** OKF write rule: every file Plainva creates gets at least `type` (the bundle's
 * `okf_version` lives in the root index.md only — OKF v0.2, E1 2026-08-20). */
export const defaultNoteTypeKey = (vaultPath: string) => `defaultNoteType_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const dailyNoteTypeKey = (vaultPath: string) => `dailyNoteType_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
export const DEFAULT_NOTE_TYPE = "Note";
export const DEFAULT_DAILY_NOTE_TYPE = "Daily Note";
/**
 * The name "Mark as reviewed" writes as `verified: human:<name>` (OKF 0.2,
 * plan P3b, D1). Per vault and DEVICE-LOCAL on purpose — it is not in the
 * profile catalogue: the reviewer is the person at this keyboard, and a
 * second device (or a second person sharing the vault) must not inherit it.
 */
export const verifierNameKey = (vaultPath: string) => `verifierName_${btoa(unescape(encodeURIComponent(vaultPath)))}`;
/** One-time vault-open conversion offer; a dismissal is remembered per vault. */
export const okfPromptDismissedKey = (vaultPath: string) => `okfPromptDismissed_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

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


/**
 * How this window runs the vault (multi-window P0).
 *
 * "owner" is the central window: it builds the indexer, the file watcher, the
 * sync chain, the workspace worker, the PIM worker, the schedulers and the undo
 * queues, and it holds every write path. "client" is an auxiliary window: it
 * reads the vault and the index directly and hands mutations to the owner over
 * the window bus (services/clientVault.ts). There is deliberately no third mode
 * and no half-owner — two windows running the same background service is the
 * failure this architecture exists to prevent.
 */
export type VaultMode = "owner" | "client";

/** The vault-lifecycle half of the context — owner-only in a client window. */
type VaultLifecycleApi = Pick<
  VaultContextType,
  | "selectVault"
  | "openVault"
  | "closeVault"
  | "refreshVault"
  | "rebuildIndex"
  | "removeRecentVault"
  | "setAutoOpenLastVault"
>;

const ownerOnly = (name: string) => `${name} is owner-only; an auxiliary window cannot run it`;

export const VaultProvider: React.FC<{
  /** Absent for a background runtime: a vault another window is showing. */
  children?: ReactNode;
  mode?: VaultMode;
  /** Client mode only: which vault this window shows. */
  clientVaultPath?: string | null;
  /**
   * Owner mode: the vault this instance runs (stage D). One provider per held
   * vault, so the path is fixed for the life of the instance — switching vaults
   * mounts another provider rather than reloading this one, which is why the
   * runtime can be torn down by simply unmounting.
   */
  vaultPath?: string | null;
  /**
   * The app layer is still reading which vault to reopen. Without it the very
   * first paint would be the splash for the few milliseconds the settings read
   * takes, and an auto-opening start would flash it before the loading screen.
   */
  appBooting?: boolean;
}> = ({ children, mode = "owner", clientVaultPath = null, vaultPath: ownerVaultPath = null, appBooting = false }) => {
  // Per instance, not per process (stage D): with one provider per held vault
  // a module-level tracker would let the second vault's load abort the first.
  // It still does what it always did — swallow React Strict Mode's double call.
  const activeLoadPathRef = useRef<string | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  // Recents, the last-vault memory, auto-open and the three lifecycle entry
  // points live one level up (contexts/AppContext.tsx) — they outlive any
  // single vault. They are re-exported through this context so the sixty-one
  // useVault() consumers keep the shape they already had.
  const {
    shownVault,
    recentVaults,
    autoOpenLastVault,
    openVault,
    selectVault,
    closeVault,
    removeRecentVault,
    setAutoOpenLastVault,
  } = useApp();
  const [state, setState] = useState<VaultState>({
    vaultPath: null,
    vaultAdapter: null,
    backupAdapter: null,
    dbAdapter: null,
    indexer: null,
    queryService: null,
    graphService: null,
    pimRuntime: null,
    isLoading: true,
    error: null,
    fileTreeVersion: 0,
    treeStructureVersion: 0,
    fileTreeVersionPaths: null,
    syncWorker: null,
    workspaceSecurityStatus: null,
    indexQueue: null,
    recentVaults: [],
    autoOpenLastVault: false,
  });

  // Raw (unwrapped) sync target of the open vault, captured before the content-E2E
  // decorator wraps it. Held on a ref (not state) so the encryption activation can
  // write the remote manifest + drive the migration sweep synchronously, without
  // waiting for a state update. null when no vault/sync connection is open.
  /** Coalesces overlapping refresh requests (F5 spam, focus + interval landing together). */
  const refreshInFlightRef = useRef<Promise<VaultRefreshResult> | null>(null);
  /** Last automatic refresh per half, for the focus/interval throttles (E4/E11). */
  const autoRefreshMarksRef = useRef({ local: 0, cloud: 0 });
  const syncTargetRef = useRef<ISyncTarget | null>(null);
  const syncProviderRef = useRef<SyncProviderId | null>(null);
  const workspaceStateRef = useRef<SqlWorkspaceStateStore | null>(null);
  const workspaceRuntimeRef = useRef<PersonalWorkspaceRuntime | null>(null);
  /** Client mode: the read/render services, kept for disposal on unmount. */
  const clientServicesRef = useRef<ClientVaultServices | null>(null);
  const isClient = mode === "client";
  /** This window's label — the key the owner refcounts its runtimes by. */
  const windowLabel = isClient ? currentWindowParams().label : null;

  // Incremental indexing for changed-path batches (watcher events, sync pulls)
  // lives in services/incrementalIndexQueue.ts (P2.5): loadVault creates one
  // serialized queue per vault and maps its batch results to version bumps.

  const loadVault = async (path: string, isNewConnection?: boolean) => {
    // The owner path below builds indexer, watcher, sync worker, workspace
    // worker, PIM runtime and the schedulers. A client window must never run
    // it — loud rather than silent, because a second set of services shows up
    // as duplicate reminders and a token refresh race, not as an error.
    if (isClient) throw new Error(ownerOnly("loadVault"));

    // If we're already loading this exact path, ignore the duplicate call
    if (activeLoadPathRef.current === path) {
      console.log(`[VaultContext] Already loading ${path}, skipping duplicate call`);
      return;
    }
    
    // If we are loading a DIFFERENT path, abort the old one (basic tracking)
    if (activeLoadPathRef.current && activeLoadPathRef.current !== path) {
      console.log(`[VaultContext] Aborting previous load of ${activeLoadPathRef.current} in favor of ${path}`);
      loadAbortRef.current?.abort();
    }

    activeLoadPathRef.current = path;
    loadAbortRef.current = new AbortController();
    const currentAbortSignal = loadAbortRef.current.signal;

    try {
      setState(s => ({ ...s, isLoading: true, error: null, loadingProgress: undefined, loadingPath: path }));
      syncStatusStore.reset(path);

      // A previous runtime for this very vault may still be draining (stage D):
      // the last window looking away starts the drain and cannot await it, so
      // the next open does. Without this wait, closing and reopening a vault in
      // quick succession would put two workers on one queue.
      await awaitVaultTeardown(path);

      // Which extra file types this vault opens as text (C15). It belongs to
      // the vault, so it is installed with the vault and not by whoever first
      // renders a path — a surface that had to remember to pass it would be
      // the second truth `openTarget` exists to prevent.
      setExtraTextExtensions(await (await getSettingsStore()).get<string[]>(textFileExtensionsKey(path)) ?? []);

      if (state.syncWorker) {
        // Drain, don't just stop (P3.4): the old worker may still be mid-cycle
        // writing into the very DB file the reload below re-opens/migrates.
        await state.syncWorker.stopAndDrain();
      }

      // Keychain entries move to their readable names (P6) — deliberately NOT
      // awaited. It is a dozen keychain round-trips, and putting them in front
      // of the vault would make every open wait for housekeeping. It can run
      // alongside because readers try both names: whichever one exists at the
      // moment of the read is found, and the old entry is only deleted after
      // the new one has been read back, so there is no window with neither.
      void migrateVaultKeychainSlots(path, credentialManager).catch((e) =>
        console.error("[VaultContext] keychain slot migration failed", e),
      );
      state.pimRuntime?.stop();

      if (currentAbortSignal.aborted) return;

      const tauriVaultAdapter = new TauriVaultAdapter(path);
      await tauriVaultAdapter.initialize();
      await tauriVaultAdapter.createDir(".plainva");

      // Retention (snapshot interval / max count / max age) is per-vault
      // configurable; settings changes are pushed in via updatePolicy without
      // a vault reload (plainva-backup-settings-changed listener below).
      const retentionStore = await getSettingsStore();
      const retentionPolicy = await loadBackupRetentionSettings(retentionStore, path);
      const backupVaultAdapter = new BackupVaultAdapter(tauriVaultAdapter, {
        policy: retentionPolicy,
        onBackupError: reportSnapshotFailure,
        onLargeFileTrimmed: (file, size) => {
          void noteLargeFileTrimmed(
            {
              store: retentionStore,
              vaultKey: btoa(unescape(encodeURIComponent(path))),
              notify: (p, mb) => toast.info(i18n.t("backup.largeFileTrimmed", { path: p, mb })),
            },
            file,
            size
          );
        },
      });

      // The SQLite index lives in the OS app-data dir, not in the vault (WP5 5b):
      // a network-drive vault paid a round-trip per index statement on every save.
      // Backups stay in the vault; an existing in-vault DB is migrated once.
      const dbPath = await resolveIndexDbUrl(path);
      const dbAdapter = new TauriDatabaseAdapter(dbPath);
      await dbAdapter.initialize();
      await initializeSchema(dbAdapter);

      const syncQueue = new SyncQueue(dbAdapter);
      const workspaceSecurityStatus = await getWorkspaceSecurityStatus(path);
      // "Locked" and "no key bundle here" are different answers and need different offers
      // (finding 2026-08-25, B6). They used to arrive as the same null.
      const workspaceAccess = workspaceSecurityStatus ? await readWorkspaceRuntime(path) : null;
      const workspaceRuntime = workspaceAccess?.state === "unlocked" ? workspaceAccess.runtime : null;
      workspaceRuntimeRef.current = workspaceRuntime;
      let resolvedWorkspaceSecurityStatus = workspaceSecurityStatus;
      const workspaceStateStore = workspaceSecurityStatus ? new SqlWorkspaceStateStore(dbAdapter) : null;
      const workspaceMaterializedPaths = new Set<string>();
      workspaceStateRef.current = workspaceStateStore;
      const permissionedWorkspaceAdapter = workspaceStateStore ? new PermissionedVaultAdapter(backupVaultAdapter, async (request) => {
        if (!workspaceRuntime) return false;
        const existing = await workspaceStateStore.getObjectByPath(request.path);
        const objectId = existing?.objectId ?? createWorkspaceObjectId();
        const policy = workspaceRuntime.policy.payload;
        const sliceObject = (path: string) => ({ objectId, path, contentKind: existing?.contentKind });
        const access = (path: string, capability: WorkspaceCapability) => evaluateWorkspaceAccess(policy, {
          memberId: workspaceRuntime.memberId,
          deviceId: workspaceRuntime.device.publicIdentity.deviceId,
          capability,
          objectId,
          sliceIds: workspaceSliceIdsForObject(policy, sliceObject(path)),
          object: sliceObject(path),
          objectAuthorMemberId: existing?.authorMemberId ?? null,
        });
        const sourceDecision = access(request.path, request.capability);
        if (!request.newPath || !sourceDecision.allowed) return sourceDecision;
        const targetDecision = access(request.newPath, request.capability);
        if (!targetDecision.allowed) return targetDecision;
        // A move can change who can read a file. Asking only "do I still see it?" misses the
        // case that costs other people their access while the mover notices nothing — that is
        // what previewWorkspaceMoveAccess was written for (finding 2026-08-25).
        const impact = previewWorkspaceMoveAccess(policy, sliceObject(request.path), request.newPath, workspaceRuntime.memberId);
        if (impact.removesActorAccess) {
          return await appConfirm({
            title: i18n.t("workspaceSecurity.moveAccessLossTitle"),
            message: i18n.t("workspaceSecurity.moveAccessLossMessage", { path: request.newPath }),
            kind: "warning",
            confirmLabel: i18n.t("workspaceSecurity.moveAnyway"),
            cancelLabel: i18n.t("common.cancel"),
          });
        }
        if (impact.removedGroupIds.length > 0) {
          return await appConfirm({
            title: i18n.t("workspaceSecurity.moveGroupLossTitle"),
            message: i18n.t("workspaceSecurity.moveGroupLossMessage", {
              groups: workspaceGroupNames(policy, impact.removedGroupIds).join(", "),
              path: request.newPath,
            }),
            kind: "warning",
            confirmLabel: i18n.t("workspaceSecurity.moveAnyway"),
            cancelLabel: i18n.t("common.cancel"),
          });
        }
        return targetDecision;
      }, async (request) => {
        const forkId = createWorkspaceObjectId();
        const safeName = request.path.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "_") || "external-change";
        const forkPath = `.plainva/workspace/forks/${forkId}-${safeName}`;
        if (await backupVaultAdapter.exists(request.path)) {
          await backupVaultAdapter.createDir(".plainva/workspace/forks");
          await backupVaultAdapter.writeBinaryFile(forkPath, await backupVaultAdapter.readBinaryFile(request.path));
        }
        await workspaceStateStore.saveLocalFork({ forkId, originalPath: request.path, forkPath, reason: "permission-denied", createdAt: new Date().toISOString() });
      }) : null;
      const queueingVaultAdapter = workspaceStateStore
        ? new WorkspaceQueueingVaultAdapter(permissionedWorkspaceAdapter!, workspaceStateStore)
        : new QueueingVaultAdapter(backupVaultAdapter, syncQueue);

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
      // Whether this device can open the vault's provider is ONE rule, shared
      // with the account surface — see `fileSyncAccess.ts` for why it may not
      // be restated per caller.
      const filesViaBroker = !!(await brokerTokenProvider(path, "files").catch(() => undefined));
      const fileAccess = resolveFileSyncAccess(
        { drive: driveCreds, onedrive: oneDriveCreds, dropbox: dropboxCreds, s3: s3Creds, webdav: webdavCreds },
        filesViaBroker
      );
      const driveReady = fileAccess.ready.drive;
      const oneDriveReady = fileAccess.ready.onedrive;
      const dropboxReady = fileAccess.ready.dropbox;
      const s3Ready = fileAccess.ready.s3;
      const hasSyncTarget = fileAccess.provider !== null;
      /**
       * A provider IS configured for this vault, but nothing can open it.
       * Without saying so the load ended as plain "idle" with no provider: the
       * account card kept claiming "connected" while the file sync was silently
       * off, and the only symptom was that nothing ever arrived (finding
       * 2026-08-19, same class as 2026-07-30). Being unable to reach an account
       * is a state worth showing, not a reason to go quiet.
       */
      const unusableProvider = fileAccess.blocked;
      const filesConfiguredWithoutAccess = unusableProvider !== null;

      // Files created/modified outside Plainva's own write path (another editor, the OS)
      // are indexed but were never enqueued. Push them when this vault has a sync target.
      const enqueueLocalChange = async (changedPath: string) => {
        if (!hasSyncTarget || changedPath.includes(".plainva") || changedPath.includes(".CONFLICT")) return;
        if (workspaceMaterializedPaths.delete(changedPath)) return;
        if (permissionedWorkspaceAdapter && !await permissionedWorkspaceAdapter.authorizeExternalChange(changedPath, true)) return;
        const queued = workspaceStateStore
          ? workspaceStateStore.enqueue("write", changedPath)
          : syncQueue.queueWrite(changedPath);
        queued
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
          void enqueueLocalChange(path);
        },
        onNewLocalFile: (path) => {
          // During the initial index, defer to the first pull (3c). Runtime discoveries
          // (files created while running) enqueue normally.
          if (deferInitialEnqueue) return;
          void enqueueLocalChange(path);
        },
        onLocalFileDeleted: (path) => {
          if (path.includes(".plainva") || path.includes(".CONFLICT")) return;
          if (workspaceMaterializedPaths.delete(path)) return;
          if (hasSyncTarget) {
            if (permissionedWorkspaceAdapter) {
              void permissionedWorkspaceAdapter.authorizeExternalChange(path, false).then((allowed) => {
                if (!allowed) return;
                return workspaceStateStore!.enqueue("delete", path).then(() => window.dispatchEvent(new CustomEvent("plainva-sync-queued")));
              }).catch((e) => console.error("[VaultContext] failed to authorize local delete", e));
              return;
            }
            // Propagate the deletion to the remote; sync_state is cleaned after the push.
            const queued = workspaceStateStore
              ? workspaceStateStore.enqueue("delete", path)
              : syncQueue.queueDelete(path);
            queued
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

      // Serialized incremental indexing for watcher events and sync pulls (P2.5):
      // one batch at a time, concurrent producers coalesce into one follow-up
      // pass, redundant full scans collapse. Batch results map to the version
      // bumps here: a full scan may have changed the folder structure (both
      // versions), a per-path batch is file-only, a pure echo batch bumps nothing.
      const indexQueue = createIncrementalIndexQueue({
        indexer,
        exists: (p) => tauriVaultAdapter.exists(p),
        onBatchDone: ({ fullScan, anyChange, paths: batchPaths }) => {
          if (fullScan) {
            setState(s => ({ ...s, fileTreeVersion: s.fileTreeVersion + 1, treeStructureVersion: s.treeStructureVersion + 1, fileTreeVersionPaths: null }));
          } else if (anyChange) {
            setState(s => ({ ...s, fileTreeVersion: s.fileTreeVersion + 1, fileTreeVersionPaths: batchPaths }));
          }
        },
      });

      // PIM runtime (calendar/task cache + pull worker). The worker only runs
      // when the vault actually has accounts — an unconfigured vault pays
      // nothing. Account connects start it via the settings section. After
      // every completed cycle the stage-3 task reconciler mirrors the selected
      // task lists into the standard task database and pushes local note edits
      // back (single-flight; a cycle finishing mid-run queues one follow-up).
      // E7: while a synced vault is still filling up, the task reconciler must
      // not IMPORT anything — a task whose note is still on its way would come
      // back as a new note, which is the duplicate this all exists to prevent.
      // A vault without a sync target has nothing to wait for.
      let firstSyncSettled = true;
      let taskSyncRunning = false;
      let taskSyncQueued = false;
      const runTaskSyncNow = async () => {
        if (taskSyncRunning) {
          taskSyncQueued = true;
          return;
        }
        taskSyncRunning = true;
        try {
          const store = await getSettingsStore();
          const taskDbPath = ((await store.get<string>(taskDatabaseKey(path))) ?? "").trim() || null;
          if (taskDbPath) {
            const noteType = ((await store.get<string>(defaultNoteTypeKey(path))) ?? "").trim() || DEFAULT_NOTE_TYPE;
            const allNotePaths = (await queryService.listNotes()).map((n) => n.path);
            const res = await runTaskSync({
              adapter: vaultAdapter,
              cache: pimRuntime.cache,
              buildTarget: pimRuntime.buildTarget,
              taskDbPath,
              noteType,
              allNotePaths,
              // OKF 0.2 provenance (plan P3b): a mirrored task names its producer.
              generatedBy: await plainvaProducer("task-sync"),
              // One query instead of reading every note once per task.
              anchorsByUid: await queryService.getTaskAnchors(),
              mayCreateNotes: firstSyncSettled,
              // Deletions the user confirmed here whose provider task should
              // follow (E4b). The reconciler owns the call: it has the target,
              // the etag and the CalDAV href, and it retries next cycle.
              pendingDeletions: pendingTaskDeletions(),
              deletionsInFlight: taskDeletionsInFlight(),
              onDeletionResolved: (intent, outcome) =>
                resolveTaskDeletion(intent as TaskDeletionOrder, outcome),
            });
            const touched = [...res.createdNotes, ...res.changedNotes];
            if (touched.length > 0) indexQueue.enqueue(touched);
            for (const err of res.errors) console.warn("[VaultContext] task sync:", err);
            // The Tasks view listens for this to re-query — the index-diff
            // chain alone is not a reliable refresh signal for it.
            window.dispatchEvent(new CustomEvent("plainva-task-sync-done"));
          }
          // The writing connection (S19): entries that were put in the calendar
          // follow their appointment. Runs on the same hook and independently of
          // the task database — an entry needs no task database to be scheduled.
          const day = (offset: number) => {
            const d = new Date();
            d.setDate(d.getDate() + offset);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          };
          const ev = await runEntryEventSync({
            adapter: vaultAdapter,
            db: queryService.db,
            cache: pimRuntime.cache,
            // The same window the worker fills the cache for — outside it an
            // absent appointment means "not looked at", not "deleted".
            window: { startDay: day(-60), endDay: day(400) },
          });
          if (ev.changedNotes.length > 0) {
            indexQueue.enqueue(ev.changedNotes);
            window.dispatchEvent(new CustomEvent("plainva-pim-changed"));
          }
          for (const err of ev.errors) console.warn("[VaultContext] entry event sync:", err);
        } catch (e) {
          console.warn("[VaultContext] task sync failed", e);
        } finally {
          taskSyncRunning = false;
          if (taskSyncQueued) {
            taskSyncQueued = false;
            void runTaskSyncNow();
          }
        }
      };
      // "Undo" has to give the note back and get it re-indexed; the reconciler
      // is poked so the provider deletion happens the moment the window closes
      // instead of waiting for the next poll.
      initTaskDeletion({
        writeTextFile: (p, c) => vaultAdapter.writeTextFile(p, c),
        runTaskSync: () => void runTaskSyncNow(),
        onRestored: (paths) => indexQueue.enqueue(paths),
      });

      const pimRuntime = createPimRuntime({ db: dbAdapter, vaultPath: path, onCycleEnd: () => void runTaskSyncNow() });
      try {
        if ((await pimRuntime.cache.listAccounts()).length > 0) pimRuntime.worker.start();
      } catch (e) {
        console.warn("[VaultContext] starting the PIM worker failed", e);
      }

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
      // Warm index ⇒ the notes are already on screen, so the encrypted-workspace
      // reconcile sweep (A2) can run in the background instead of blocking open.
      const deferWorkspaceReconcile = indexedCount > 0;

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
        const { perfMeasure } = await import("../services/perfMetrics");
        await perfMeasure("initial full index (cold)", () => indexer.indexVaultFull());
        reportInitialProgress = false;
        deferInitialEnqueue = false;
      }

      // If it's a new WebDAV connection, we enqueue all local files to trigger an initial push
      if (isNewConnection && !workspaceStateStore) {
        await syncQueue.enqueueAllLocalFiles();
      }

      let syncWorker: SyncWorker | EncryptedWorkspaceWorker | null = null;
      let syncProvider: SyncProviderId | null = null;
      try {
        // Target selection per vault: the settings UI enforces one provider per vault
        // (saving one clears the others), so this order only decides ties in corrupt
        // states: Drive > OneDrive > Dropbox > S3 > WebDAV. Drive additionally drives the
        // worker's incremental cursor pull (getStartCursor + pull(cursor)); the others use
        // the full-listing model.
        syncTargetRef.current = null; // cleared each load; set to the raw target below
        syncProviderRef.current = null;
        let target: ISyncTarget | null = null;
        // Microsoft accounts connected through the union consent keep ONE
        // refresh token in the account slot; the file sync then only asks the
        // broker for an access token instead of rotating a copy of its own
        // (cloud accounts stage B). Undefined for every other account.
        const filesTokenProvider = await brokerTokenProvider(path, "files").catch(() => undefined);
        if (driveReady && driveCreds && (driveCreds.refreshToken || filesTokenProvider)) {
          syncProvider = "drive";
          const driveTarget = new DriveSyncTarget(
            {
              clientId: driveCreds.clientId,
              clientSecret: driveCreds.clientSecret,
              // Empty for broker-backed accounts: the provider below supplies
              // the access token and this field is never read.
              refreshToken: driveCreds.refreshToken ?? "",
              // From the per-vault settings, not the slot: the slot's copy dies
              // with the account, and the default that took over then created a
              // second folder in the cloud (finding 2026-08-19).
              rootFolderName: (await readSyncRootFolder(path, "drive")) || undefined,
            },
            fetch,
            undefined,
            tauriSyncUploader
          );
          if (filesTokenProvider) driveTarget.accessTokenProvider = filesTokenProvider;
          driveTarget.onRootFolderCreated = (name) => reportRootFolderCreated(name);
          target = driveTarget;
        } else if (oneDriveReady && oneDriveCreds && (oneDriveCreds.refreshToken || filesTokenProvider)) {
          syncProvider = "onedrive";
          const oneDriveTarget = new OneDriveSyncTarget(
            {
              clientId: oneDriveCreds.clientId,
              // Empty for broker-backed accounts: the provider below supplies
              // the access token and this field is never read.
              refreshToken: oneDriveCreds.refreshToken ?? "",
              rootFolderName: (await readSyncRootFolder(path, "onedrive")) || undefined,
            },
            microsoftAuthFetch,
            undefined,
            tauriSyncUploader
          );
          if (filesTokenProvider) {
            // The broker owns the refresh token and its rotation for every
            // service of the account; this target never refreshes on its own.
            oneDriveTarget.accessTokenProvider = filesTokenProvider;
          } else {
            // Microsoft ROTATES refresh tokens: persist every rotation immediately or the
            // stored token goes stale and the user is forced through the consent flow again.
            oneDriveTarget.onTokensRefreshed = (_accessToken, refreshToken) => {
              if (!refreshToken || refreshToken === oneDriveCreds.refreshToken) return;
              oneDriveCreds.refreshToken = refreshToken;
              credentialManager
                .saveOneDriveCredentials(path, { ...oneDriveCreds, refreshToken })
                .catch((e) => console.error("[VaultContext] persisting rotated OneDrive token failed", e));
            };
          }
          oneDriveTarget.onRootFolderCreated = (name) => reportRootFolderCreated(name);
          target = oneDriveTarget;
        } else if (dropboxReady && dropboxCreds && dropboxCreds.refreshToken) {
          syncProvider = "dropbox";
          const dropboxTarget = new DropboxSyncTarget(
            {
              appKey: dropboxCreds.appKey,
              refreshToken: dropboxCreds.refreshToken,
              rootPath: (await readSyncRootFolder(path, "dropbox")) || undefined,
            },
            fetch,
            undefined,
            undefined,
            tauriSyncUploader
          );
          dropboxTarget.onTokensRefreshed = (_accessToken, refreshToken) => {
            if (!refreshToken || refreshToken === dropboxCreds.refreshToken) return;
            dropboxCreds.refreshToken = refreshToken;
            credentialManager
              .saveDropboxCredentials(path, { ...dropboxCreds, refreshToken })
              .catch((e) => console.error("[VaultContext] persisting rotated Dropbox token failed", e));
          };
          dropboxTarget.onRootFolderCreated = (name) => reportRootFolderCreated(name);
          target = dropboxTarget;
        } else if (s3Ready && s3Creds) {
          syncProvider = "s3";
          target = new S3SyncTarget(s3Creds, fetch, undefined, undefined, tauriSyncUploader);
        } else if (webdavCreds && webdavCreds.url) {
          syncProvider = "webdav";
          // The fourth argument makes large writes stream from disk instead of
          // travelling through the webview (issue #48).
          target = new WebDavSyncTarget(webdavCreds, fetch, undefined, tauriSyncUploader);
        }

        if (target) {
          syncTargetRef.current = target;
          syncProviderRef.current = syncProvider;
          const settingsStore = await getSettingsStore();
          // Per-vault interval, falling back to the legacy global value, then the default.
          const perVaultInterval = await settingsStore.get<number>(syncIntervalKey(path));
          const globalInterval = await settingsStore.get<number>("syncIntervalSeconds");
          const savedInterval = perVaultInterval ?? globalInterval;
          const intervalMs = Math.max(MIN_SYNC_INTERVAL_SECONDS, savedInterval ?? defaultSyncIntervalSeconds()) * 1000;
          if (workspaceSecurityStatus && workspaceStateStore) {
            const runtime = workspaceRuntime;
            if (!runtime) {
              // A locked workspace can be opened with what is on this device; a missing key
              // bundle cannot, and offering "enter your passphrase" for a bundle that is not
              // there sends the user looking for the wrong thing (finding 2026-08-25, B6).
              const missing = workspaceAccess?.state === "absent";
              const nextStatus: WorkspaceSecurityPublicStatus = missing
                ? { ...workspaceSecurityStatus, phase: "error", lastError: "workspace-key-bundle-missing" }
                : { ...workspaceSecurityStatus, phase: "locked" };
              resolvedWorkspaceSecurityStatus = nextStatus;
              await saveWorkspaceSecurityStatus(path, nextStatus);
              syncStatusStore.set(path, {
                status: "error",
                message: i18n.t(missing ? "workspaceSecurity.keyBundleMissingMessage" : "workspaceSecurity.lockedMessage"),
                provider: syncProvider,
              });
            } else {
              if (runtime.workspaceId !== workspaceSecurityStatus.workspaceId) {
                throw new Error("The stored workspace key bundle does not match this vault.");
              }
              const objectStore = createProviderWorkspaceObjectStore(workspaceProviderName(syncProvider!), target);
              const activeSecurityStatus = workspaceSecurityStatus;
              // The open-time reconcile sweep (A1 mtime-skip) is O(changed files),
              // but on a network mount the listDir alone can be slow. When the
              // index is WARM the notes are already on screen (they come from the
              // DB), so run the sweep + worker start in the BACKGROUND (A2) — like
              // the warm full-index pass right above. A COLD open still blocks with
              // a determinate splash bar so the encrypted setup shows progress.
              const startEncryptedWorkspace = async (): Promise<EncryptedWorkspaceWorker | null> => {
                const { perfMeasure } = await import("../services/perfMetrics");
                await perfMeasure("encrypted workspace reconcile (open)", () =>
                  initializePersonalWorkspaceMigration({
                    store: objectStore,
                    state: workspaceStateStore,
                    vault: backupVaultAdapter,
                    runtime,
                    recoveryConfirmedAt: activeSecurityStatus.recoveryConfirmedAt,
                    signal: currentAbortSignal,
                    onProgress: deferWorkspaceReconcile
                      ? undefined
                      : (done, total) => setState((s) => s.loadingPath === path
                        ? { ...s, loadingProgress: { current: done, total, message: i18n.t("workspaceSecurity.reconcileProgress") } }
                        : s),
                  }));
                if (currentAbortSignal.aborted) return null;
                const sideband = (await buildSettingsSyncStep(path, { pimRuntime, rawVault: backupVaultAdapter, memberId: runtime.memberId })) ?? undefined;
                const worker = new EncryptedWorkspaceWorker(objectStore, workspaceStateStore, backupVaultAdapter, runtime, {
                  intervalMs,
                  sideband: sideband ? () => sideband.run(target!, backupVaultAdapter) : undefined,
                  // Only whether THIS device holds the publication's keys. The
                  // folder it lives in is derived inside core from the vault's
                  // workspace id - a publication bootstraps a workspace whose id
                  // is its own publication id, and deriving from that here would
                  // address a folder nobody joined, silently.
                  openPublicationRuntime: async (record) => {
                    const access = await readPublicationRuntime(path, record.publicationId);
                    // "locked" is not "missing": a locked vault locks its
                    // publications too, and the next cycle after unlocking
                    // refreshes them.
                    return access.state === "unlocked" ? access.runtime : null;
                  },
                });
                worker.onStatusChange = (status, errorMsg) => {
                  syncStatusStore.set(path, { status, message: errorMsg || null, ...(status !== "syncing" ? { progress: null } : {}) });
                  void workspaceStateStore.loadMeta().then(async (meta) => {
                    if (!meta) return;
                    const publicStatus: WorkspaceSecurityPublicStatus = {
                      ...activeSecurityStatus,
                      phase: status === "error" ? "error" : meta.phase,
                      lastError: errorMsg || meta.lastError,
                    };
                    await saveWorkspaceSecurityStatus(path, publicStatus);
                    setState((s) => s.vaultPath === path ? { ...s, workspaceSecurityStatus: publicStatus } : s);
                  });
                };
                worker.onProgress = (progress) => syncStatusStore.set(path, { progress });
                worker.onFilesChanged = (paths) => {
                  for (const changedPath of paths) workspaceMaterializedPaths.add(changedPath);
                  indexQueue.enqueue(paths);
                  for (const changedPath of paths) {
                    if (!changedPath.includes(".CONFLICT")) {
                      window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path: changedPath } }));
                    }
                  }
                };
                if (currentAbortSignal.aborted) return null;
                worker.start();
                return worker;
              };
              if (deferWorkspaceReconcile) {
                void startEncryptedWorkspace()
                  .then((worker) => {
                    if (!worker || currentAbortSignal.aborted) { void worker?.stopAndDrain(); return; }
                    setState((s) => (s.vaultPath === path ? { ...s, syncWorker: worker } : s));
                  })
                  .catch(async (e) => {
                    console.error("[VaultContext] background encrypted workspace start failed", e);
                    const message = e instanceof Error ? e.message : String(e);
                    const errored = { ...activeSecurityStatus, phase: "error" as const, lastError: message.slice(0, 1000) };
                    await saveWorkspaceSecurityStatus(path, errored).catch(() => undefined);
                    syncStatusStore.set(path, { status: "error", message, provider: syncProvider });
                    setState((s) => (s.vaultPath === path ? { ...s, workspaceSecurityStatus: errored } : s));
                  });
              } else {
                syncWorker = await startEncryptedWorkspace();
              }
            }
          } else {
            // Large writes stream from disk instead of travelling through the
            // IPC boundary as a number array (issue #48). The resolver only
            // answers for files past the threshold, and only targets that can
            // stream ever get asked — everything else keeps the buffer path.
            const engine = new SyncEngine(
              syncQueue,
              target,
              vaultAdapter,
              syncRepo,
              createContentRefResolver(path),
            );
            // Profile-sync sideband (opt-in): transports .plainva/sync/settings.json
            // through the same target, outside the file queue/merge path. null when
            // the vault has not opted in.
            const settingsSync = (await buildSettingsSyncStep(path, { pimRuntime, rawVault: backupVaultAdapter })) ?? undefined;
            // The worker writes pulled content through the raw backup adapter (not
            // the queueing/conflict-aware one): it does its own merge and manages
            // sync_state, so routing through the queue would re-enqueue every pull.
            syncWorker = new SyncWorker(engine, target, syncRepo, backupVaultAdapter, syncQueue, intervalMs, { settingsSync });
            firstSyncSettled = false;
            // Reported every cycle, empty included, so a renamed pair takes the
            // card down again by itself. Not on the encrypted worker: that one
            // stores sealed objects under content hashes, so the remote never
            // carries a human file name and two Unicode forms of one cannot
            // exist (finding 2026-08-21).
            syncWorker.onNameCollisions = (collisions) => {
              syncStatusStore.set(path, { collisions });
            };
            syncWorker.onStatusChange = (status, errorMsg, reason, retryAt) => {
              // Store instead of context state (P3/E2): idle→syncing→idle fires
              // every poll cycle and must not re-render the whole app. `reason`
              // (a fatal-protocol kind) rides along so the error dialog can offer
              // a connection-specific encryption reset (Stilllegen P2).
              syncStatusStore.set(path, { status, message: errorMsg || null, reason, retryAt, ...(status !== "syncing" ? { progress: null } : {}) });
            };
            syncWorker.onProgress = (progress) => {
              // Coarse cycle progress for the status bar (WP6); throttled in core.
              syncStatusStore.set(path, { progress });
            };
            syncWorker.onFirstCycleComplete = () => {
              // The vault has its remote content now, so anchored notes exist
              // and can be adopted rather than imported a second time (E7).
              firstSyncSettled = true;
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
              // file tree and search reflect them deterministically. The worker
              // emits in chunks while the cycle runs (and flushes on abort), so the
              // tree fills progressively during a long first sync and an aborted
              // cycle can no longer hide already-written files until a restart.
              indexQueue.enqueue(paths);
              for (const p of paths) {
                if (!p.includes(".CONFLICT")) {
                  window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path: p } }));
                }
              }
            };
            const guardedWorker = syncWorker;
            syncWorker.onMassDeletionPending = ({ pendingDeletes, syncedTotal }) => {
              // The push-side mass-deletion guard tripped: a large share of the
              // synced files is queued for REMOTE deletion (typically the local
              // vault folder was emptied or moved while Plainva knew the vault).
              // Never execute that silently — ask. Cancel/Escape takes the safe
              // branch: the deletes are discarded and the files restored from the
              // remote on the next cycle.
              void (async () => {
                const confirmed = await appConfirm({
                  title: i18n.t("sync.massDeleteTitle"),
                  message: i18n.t("sync.massDeleteBody", { n: pendingDeletes, total: syncedTotal }),
                  kind: "danger",
                  confirmLabel: i18n.t("sync.massDeleteConfirm"),
                  cancelLabel: i18n.t("sync.massDeleteRestore"),
                });
                if (confirmed) {
                  guardedWorker.approveMassDeletion();
                } else {
                  try {
                    const discarded = await guardedWorker.discardMassDeletion();
                    toast.info(i18n.t("sync.massDeleteRestored", { n: discarded }));
                  } catch (e) {
                    console.error("[VaultContext] discardMassDeletion failed", e);
                    toast.error(i18n.t("sync.massDeleteRestoreFailed"));
                  }
                }
              })();
            };
            syncWorker.start();
          }
        }
      } catch (e) {
        console.error("Failed to start SyncWorker", e);
        if (workspaceSecurityStatus) {
          const message = e instanceof Error ? e.message : String(e);
          resolvedWorkspaceSecurityStatus = { ...workspaceSecurityStatus, phase: "error", lastError: message.slice(0, 1000) };
          await saveWorkspaceSecurityStatus(path, resolvedWorkspaceSecurityStatus).catch(() => undefined);
          syncStatusStore.set(path, { status: "error", message, provider: syncProvider });
        }
      }

      if (currentAbortSignal.aborted) return;

      // Preserve the explicit locked status when an encrypted workspace has no
      // key material. The final load-state update below must not turn it idle.
      if (syncWorker || !workspaceSecurityStatus) {
        if (!syncWorker && filesConfiguredWithoutAccess) {
          // Saying nothing here is what made the failure invisible: the card
          // still read "connected", the status bar stayed idle, and only the
          // absence of arriving files gave it away.
          syncStatusStore.set(path, {
            status: "error",
            message: i18n.t("sync.noFileAccess"),
            provider: unusableProvider,
            authRecoverable: true,
          });
        } else {
          syncStatusStore.set(path, { status: "idle", message: null, provider: syncWorker ? syncProvider : null });
        }
      }
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
        workspaceSecurityStatus: resolvedWorkspaceSecurityStatus,
        pimRuntime,
        indexQueue,
        loadingProgress: undefined,
        loadingPath: null,
      }));
      
      if (activeLoadPathRef.current === path) {
        activeLoadPathRef.current = null;
      }
    } catch (error: any) {
      if (currentAbortSignal.aborted) return;
      console.error("Failed to load vault", error);
      setState(s => ({ ...s, isLoading: false, error: error.message || String(error), loadingProgress: undefined }));
      if (activeLoadPathRef.current === path) {
        activeLoadPathRef.current = null;
      }
    }
  };

  // Owner: answer the auxiliary windows' requests. Re-installed per vault,
  // because the adapter chain and the indexer belong to the open vault.
  useEffect(() => {
    if (isClient) return;
    if (!state.vaultPath || !state.vaultAdapter) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    void installOwnerBus({
      vaultPath: state.vaultPath,
      vaultAdapter: state.vaultAdapter,
      indexer: state.indexer,
      pimRuntime: state.pimRuntime,
      refresh: triggerFileTreeUpdate,
      // Through the ref, not captured: the bus is re-installed only when the
      // vault changes, and both of these read state that moves more often than
      // that — a captured `refreshVault` would keep skipping the cloud step
      // because it still held yesterday's sync worker.
      refreshVault: () => vaultOpsRef.current.refreshVault(),
      rebuildIndex: () => vaultOpsRef.current.rebuildIndex(),
      // Same reason, one step further: the worker is created AFTER the vault
      // has loaded, so a captured one would always be the null it was at
      // install time — and "sync now" from another window would do nothing.
      syncWorker: {
        triggerImmediate: () => vaultOpsRef.current.syncWorker?.triggerImmediate(),
        retryFailed: () => vaultOpsRef.current.syncWorker?.retryFailed(),
        noteUserInitiatedDeletion: (paths) => vaultOpsRef.current.syncWorker?.noteUserInitiatedDeletion(paths),
      },
    })
      .then((off) => {
        if (cancelled) off();
        else dispose = off;
      })
      .catch((e) => console.warn("[VaultContext] window bus unavailable (single window?)", e));
    return () => {
      cancelled = true;
      dispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, state.vaultPath, state.vaultAdapter, state.indexer, state.pimRuntime]);

  // Owner: every status the sync worker reaches goes out to the other windows
  // (C3), addressed with the vault it belongs to — a window on another vault
  // would otherwise draw this one's progress bar (stage D).
  useEffect(() => {
    if (isClient || !state.vaultPath) return;
    return installSyncStatusMirror(state.vaultPath);
  }, [isClient, state.vaultPath]);

  // Client: the owner owns the index, so its broadcast is what makes the views
  // in this window refresh. Without it an auxiliary window would show whatever
  // the index held when it opened.
  useEffect(() => {
    if (!isClient) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    const offs: Array<() => void> = [];
    void getWindowBus()
      .then(async (bus) => {
        offs.push(
          await bus.onBroadcast("index-changed", ({ paths, structural }) => {
            triggerFileTreeUpdate(structural || paths.length === 0 ? undefined : paths);
          }),
        );
        // A saved BODY is not an index change (fix C), so it travels on its own
        // channel and is re-dispatched here as the local event the pinboard
        // already listens for — the view code stays identical in both windows.
        offs.push(
          await bus.onBroadcast("note-saved", ({ path }) => {
            window.dispatchEvent(new CustomEvent("plainva-note-saved", { detail: { path } }));
          }),
        );
        // There is one sync worker, in the owner. This window has no way to
        // observe it, so without the mirror its status bar would say "local"
        // for a vault that syncs — honest-looking and wrong (C3).
        offs.push(
          await bus.onBroadcast("sync-status", (s, _from, vault) => {
            // Filed under the vault the OWNER named, not under whatever this
            // window last knew: the two can differ for a moment while a window
            // moves, and a status filed under the wrong vault outlives that
            // moment (stage D).
            if (!vault) return;
            syncStatusStore.set(vault, {
              status: s.status as SyncStatusSnapshot["status"],
              message: s.message ?? null,
              provider: (s.provider ?? null) as SyncStatusSnapshot["provider"],
              // `retryAt` is optional, not nullable: null would type-error and
              // read as "a retry at epoch zero" in the status bar.
              retryAt: s.retryAt ?? undefined,
              progress: s.progress ?? null,
            });
          }),
        );
        // The watcher lives in the owner. Without this an auxiliary window would
        // never learn that the file under its editor changed on disk — the very
        // case the editor's external-update logic exists for.
        offs.push(
          await bus.onBroadcast("file-changed", ({ path }) => {
            window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path } }));
          }),
        );
        if (cancelled) for (const off of offs.splice(0)) off();
        else stop = () => { for (const off of offs.splice(0)) off(); };
      })
      .catch((e) => console.warn("[VaultContext] no window bus in this window", e));
    return () => {
      cancelled = true;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient]);

  /**
   * Client mode: open the vault read-mostly (services/clientVault.ts) and put
   * the services into the same state shape the rest of the app reads. The
   * owner-only slots (indexer, backup adapter, index queue, sync worker, PIM
   * runtime) stay null, which is what keeps the effects below inert.
   */
  /**
   * The vault this window shows. Seeded from the query it was opened with and
   * changed by this window's own switcher (stage D) — a window belongs to the
   * vault it shows and keeps it, whatever any other window does.
   */
  const [clientVault, setClientVault] = useState<string | null>(clientVaultPath);
  useEffect(() => setClientVault(clientVaultPath), [clientVaultPath]);

  /**
   * Client: tell the central window which vault this one holds (stage D).
   *
   * Every runtime lives over there, so a hold that never arrives leaves this
   * window drawing a tree with no indexer, no watcher and no sync worker behind
   * it — correct at the moment it opened and never again. The release on the
   * way out is the other half: a runtime nobody holds has to be able to go.
   */
  useEffect(() => {
    if (!isClient || !windowLabel) return;
    const tell = (vaultPath: string | null) => {
      void getWindowBus()
        .then((bus) => bus.request("hold-vault", { label: windowLabel, vaultPath }))
        .catch(() => {
          /* no bus (browser/test): nothing holds anything there */
        });
    };
    tell(clientVault);
    // Released on the way out, never in the cleanup: this effect re-runs on
    // every switch, and a release there would tear the old runtime down before
    // the new hold arrives — for a switch back to the same vault, twice over.
    const drop = () => tell(null);
    window.addEventListener("beforeunload", drop);
    return () => window.removeEventListener("beforeunload", drop);
  }, [isClient, windowLabel, clientVault]);

  const loadClientVault = async (path: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const bus = await getWindowBus();
      const services = await openClientVault(path, bus);
      clientServicesRef.current = services;
      setState((s) => ({
        ...s,
        vaultPath: path,
        vaultAdapter: services.vaultAdapter,
        dbAdapter: services.dbAdapter,
        queryService: services.queryService,
        graphService: services.graphService,
        // Not null: the editor treats a missing indexer as "vault not ready"
        // and refuses to save, which would make an auxiliary window silently
        // read-only. See remoteIndexer.ts for why every method is a no-op.
        indexer: createRemoteIndexer(),
        // The calendar and task views read the PIM cache from this window's own
        // database connection; only the provider round trips travel to the owner
        // (one refresh token per account since stage B).
        pimRuntime: createClientPimRuntime(services.dbAdapter),
        // Not null either, and for a sharper reason than the indexer: null
        // would make this window claim the vault does not sync at all. See
        // services/clientSyncWorker.ts.
        syncWorker: createClientSyncWorker(),
        isLoading: false,
        error: null,
      }));
    } catch (e) {
      console.error("[VaultContext] client vault failed to open", e);
      setState((s) => ({ ...s, isLoading: false, error: e instanceof Error ? e.message : String(e) }));
    }
  };

  useEffect(() => {
    if (!isClient) return;
    if (!clientVault) {
      // A blank auxiliary window is a legitimate state (a P4 restore can open
      // one before the content is known) — it simply shows nothing yet. The
      // same branch catches the owner closing the vault (C5): the services this
      // window held are disposed by the cleanup below, so the state has to let
      // go of them too. Leaving them would draw a tree over adapters nobody
      // owns any more.
      setState((s) => ({
        ...s,
        vaultPath: null,
        vaultAdapter: null,
        dbAdapter: null,
        queryService: null,
        graphService: null,
        indexer: null,
        pimRuntime: null,
        syncWorker: null,
        fileTreeVersion: 0,
        isLoading: false,
        error: null,
      }));
      return;
    }
    void loadClientVault(clientVault);
    return () => {
      void clientServicesRef.current?.dispose();
      clientServicesRef.current = null;
    };
  }, [isClient, clientVault]);

  useEffect(() => {
    // The owner runs the vault it was mounted for (stage D). The path never
    // changes for an instance: showing a different vault mounts a different
    // provider, which is what makes the teardown below a plain unmount.
    if (isClient) return;
    if (!ownerVaultPath) {
      if (!appBooting) setState(s => ({ ...s, isLoading: false }));
      return;
    }
    void loadVault(ownerVaultPath);
    return () => {
      void teardownVaultRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, ownerVaultPath, appBooting]);

  useEffect(() => {
    if (!state.vaultAdapter || !state.indexQueue) return;
    const indexQueue = state.indexQueue;

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
            // The rescan marker always passes: it means the adapter could NOT
            // attribute a change, and dropping it would lose the change entirely.
            if (e.path === WATCH_RESCAN_MARKER) return true;
            return e.path !== "" && !isInternalPath(e.path);
          });
          if (relevantEvents.length > 0) {
            for (const e of relevantEvents) {
              // "" is the vault root — indexPath classifies it as a directory and
              // the queue escalates to a full reconcile (P1d fail-safe).
              pendingWatchPaths.add(e.path === WATCH_RESCAN_MARKER ? "" : e.path);
            }
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              const batch = Array.from(pendingWatchPaths);
              pendingWatchPaths.clear();
              console.log("[VaultContext] vault watcher detected changes", batch);
              // Incremental per-path indexing (P2.5) — the former full scan
              // walked the ENTIRE vault over IPC after every save echo. The
              // shared queue serializes this with concurrent sync-pull batches.
              indexQueue.enqueue(batch);
            }, 1000);
          }
        });
      } catch (err: any) {
        // Used to land in `state.error`, which nothing renders during normal
        // operation — so a vault silently stopped noticing external changes.
        // The interval net below keeps working; the user just needs to know
        // that changes now arrive late instead of instantly.
        console.error("[VaultContext] vault watcher failed to start", err);
        toast.warning(
          i18n.t("refresh.watcherFailed", {
            defaultValue: "Externe Änderungen werden nicht mehr sofort erkannt. Plainva gleicht jetzt regelmäßig ab — F5 liest sofort neu ein.",
          })
        );
        setState(s => ({ ...s, error: `Watcher error: ${err.message || String(err)}` }));
      }
    };

    startWatching();

    return () => {
      clearTimeout(debounceTimer);
      if (unwatchFn) unwatchFn();
    };
  }, [state.vaultAdapter, state.indexQueue]);

  // Per-vault background backups: daily ZIP + daily snapshot pruning. The
  // scheduler re-reads its settings from the store on every tick, so only the
  // vault switch needs a restart.
  useEffect(() => {
    // Owner-only: a second scheduler would write a second daily ZIP and prune
    // the same snapshot folder from two sides.
    if (isClient) return;
    if (!state.vaultPath || !state.vaultAdapter) return;
    const stop = startBackupScheduler({ vaultPath: state.vaultPath, adapter: state.vaultAdapter });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.vaultPath, state.vaultAdapter]);

  // Reminders belong to the RUNTIME, not to the shell (stage D).
  //
  // They used to hang in AppShell, which only the vault a window SHOWS renders.
  // With two vaults open that meant the one the other window shows had a sync
  // worker, an indexer and a watcher — and no clock: its appointments would
  // simply never have fired. A scheduler that runs where the vault runs cannot
  // be forgotten by whichever window happens to look elsewhere.
  useEffect(() => {
    if (isClient) return;
    const vaultPath = state.vaultPath;
    const adapter = state.vaultAdapter;
    if (!vaultPath || !adapter) return;
    const ownerShows = shownVault === vaultPath;
    const show = (path: string) => {
      void showContentInVaultWindow({ vaultPath, path, ownerShows }).catch((e) =>
        console.warn("[VaultContext] could not show the reminder's note", e),
      );
    };
    const stop = startReminderScheduler({
      vaultPath,
      cache: state.pimRuntime?.cache ?? null,
      vaultAdapter: adapter,
      queryService: state.queryService ?? null,
      openNote: show,
      onNextChanged: (text, at) => reportTrayNext(vaultPath, text, at),
      openCalendar: (day) => {
        // Park the day first: the calendar tab reads it when it mounts, so a
        // tab that is not open yet still lands on the right day.
        requestCalendarDay(day);
        show(CALENDAR_TAB_PATH);
      },
    });
    return () => {
      stop();
      forgetTrayNext(vaultPath);
    };
  }, [isClient, shownVault, state.vaultPath, state.vaultAdapter, state.queryService, state.pimRuntime]);

  // Retention settings changed in the settings modal: push the new policy into
  // the live BackupVaultAdapter without reloading the vault.
  useEffect(() => {
    const handler = async () => {
      if (!state.vaultPath || !state.backupAdapter) return;
      try {
        const store = await getSettingsStore();
        state.backupAdapter.updatePolicy(await loadBackupRetentionSettings(store, state.vaultPath));
      } catch (e) {
        console.warn("[VaultContext] applying backup settings failed", e);
      }
    };
    window.addEventListener("plainva-backup-settings-changed", handler);
    return () => window.removeEventListener("plainva-backup-settings-changed", handler);
  }, [state.vaultPath, state.backupAdapter]);

  useEffect(() => {
    // Owner-only: every handler here reopens the vault or drives the sync
    // worker. In a client window there is neither.
    if (isClient) return;
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

    const handleSettingsSyncToggled = () => {
      // Opt-in changed: rebuild the sideband step and swap it into the running
      // worker (no vault reload), then sync now so the change takes effect at
      // once. With no worker (no cloud sync configured), nothing to do.
      if (!state.vaultPath || !state.syncWorker) return;
      const worker = state.syncWorker;
      if (!(worker instanceof SyncWorker)) {
        loadVault(state.vaultPath);
        return;
      }
      buildSettingsSyncStep(state.vaultPath, { pimRuntime: state.pimRuntime, rawVault: state.backupAdapter, memberId: workspaceRuntimeRef.current?.memberId ?? null })
        .then((step) => {
          worker.setSettingsSync(step ?? undefined);
          if (step) worker.triggerImmediate();
        })
        .catch((err) => console.error("[VaultContext] settings-sync toggle failed", err));
    };

    const handleEncryptionChanged = () => {
      // Encryption state changed (passphrase set / unlocked / locked): reopen so
      // the sync target is (re-)wrapped in the correct mode. An unlock on a second
      // device must rewrap the target to DECRYPT content — a runner swap alone
      // cannot do that. Activation/complete reopen themselves (they do not fire
      // this event, to avoid a double reload).
      if (!state.vaultPath) return;
      if (state.syncWorker) state.syncWorker.stop();
      loadVault(state.vaultPath);
    };

    window.addEventListener("plainva-credentials-saved", handleCredentialsSaved);
    window.addEventListener("plainva-sync-queued", handleSyncQueued);
    window.addEventListener("plainva-settings-sync-toggled", handleSettingsSyncToggled);
    // Encryption state changed (passphrase set/unlocked/locked): reopen the vault
    // so the target is (re-)wrapped. A remote keyfile arriving (locked 2nd device)
    // only needs the runner rebuilt so the "enter passphrase" UI can appear.
    window.addEventListener("plainva-encryption-changed", handleEncryptionChanged);
    window.addEventListener("plainva-keyfile-arrived", handleSettingsSyncToggled);

    return () => {
      window.removeEventListener("plainva-credentials-saved", handleCredentialsSaved);
      window.removeEventListener("plainva-sync-queued", handleSyncQueued);
      window.removeEventListener("plainva-settings-sync-toggled", handleSettingsSyncToggled);
      window.removeEventListener("plainva-encryption-changed", handleEncryptionChanged);
      window.removeEventListener("plainva-keyfile-arrived", handleSettingsSyncToggled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.vaultPath, state.syncWorker, isClient]);

  /**
   * Stops everything this vault runs. Called when the provider unmounts, which
   * happens when the last window showing this vault looks away — closing the
   * vault, switching to another one, or the window going away are all the same
   * event from here, so there is only one teardown path to keep correct.
   */
  const teardownVault = async () => {
    const path = state.vaultPath;
    const worker = state.syncWorker;
    // Stop the CLOCK synchronously, before anything below awaits: the drain at
    // the end of this function takes time, and a timer that is still live would
    // start a fresh cycle right in the middle of it.
    worker?.stop();
    state.pimRuntime?.stop();
    syncTargetRef.current = null;
    syncProviderRef.current = null;
    workspaceStateRef.current = null;
    loadAbortRef.current?.abort();
    activeLoadPathRef.current = null;

    if (state.vaultPath) syncStatusStore.reset(state.vaultPath);
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
      workspaceSecurityStatus: null,
      pimRuntime: null,
      indexQueue: null,
      isLoading: false,
      error: null,
      loadingProgress: undefined,
      loadingPath: null
    }));

    // Drain what is already under way, in this order: a note the editor was
    // still writing when it unmounted must be ON DISK before this vault counts
    // as gone (that write is also what puts the push into the queue), and only
    // then may the running cycle finish. `stop()` alone would leave both
    // hanging in the air while the app keeps running with another vault open.
    //
    // The caller is a React unmount cleanup and cannot await, so the promise is
    // parked: whoever opens this vault next waits for it (`loadVault`).
    const drain = (async () => {
      if (path) await settlePendingWrites(path);
      await worker?.stopAndDrain();
    })();
    if (path) noteVaultTeardown(path, drain);
    await drain;
  };

  // Read through a ref so the unmount cleanup always runs the CURRENT teardown:
  // the effect that owns it is keyed on the vault path, not on every render.
  const teardownVaultRef = useRef(teardownVault);
  useEffect(() => {
    teardownVaultRef.current = teardownVault;
  });

  const bumpTree = () =>
    setState(s => ({
      ...s,
      fileTreeVersion: s.fileTreeVersion + 1,
      treeStructureVersion: s.treeStructureVersion + 1,
      fileTreeVersionPaths: null,
    }));

  /**
   * P1: reconcile the index with the disk and — on a synced vault — ask the
   * cloud for a full listing, then report what happened. Deliberately does NOT
   * take over the loading screen: this runs from F5 and on window focus, and
   * blanking the app on every alt-tab would be worse than the problem.
   */
  const refreshVault = async (opts?: { silent?: boolean; skipCloud?: boolean }): Promise<VaultRefreshResult> => {
    const indexer = state.indexer;
    if (!indexer) {
      return { local: { added: 0, changed: 0, removed: 0, skipped: [], durationMs: 0 }, cloud: "none" };
    }
    if (refreshInFlightRef.current) return refreshInFlightRef.current;
    const run = (async () => {
      try {
        const result = await runVaultRefresh({
          indexer,
          syncWorker: state.syncWorker,
          skipCloud: opts?.skipCloud,
        });
        bumpTree();
        if (!opts?.silent) toast.success(buildRefreshToast(result, i18n.t.bind(i18n)));
        return result;
      } catch (e) {
        console.error("[VaultContext] vault refresh failed", e);
        if (!opts?.silent) {
          toast.error(i18n.t("refresh.failed", { defaultValue: "Vault konnte nicht neu eingelesen werden." }));
        }
        throw e;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = run;
    return run;
  };

  /** Reconcile ONE folder subtree — the fast path when the vault has 20.000 files. */
  const refreshFolder = async (folderPath: string) => {
    const indexer = state.indexer;
    const adapter = state.vaultAdapter;
    if (!indexer || !adapter) return;
    try {
      const entries = await adapter.listDir(folderPath, true);
      let touched = 0;
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const outcome = await indexer.indexPath(entry.path);
        if (outcome === "indexed" || outcome === "removed") touched++;
      }
      bumpTree();
      toast.success(
        i18n.t("refresh.folderDone", {
          defaultValue: "Ordner neu eingelesen · {{n}} Dateien aktualisiert",
          n: touched,
        })
      );
    } catch (e) {
      console.error("[VaultContext] folder refresh failed", e);
      toast.error(i18n.t("refresh.failed", { defaultValue: "Vault konnte nicht neu eingelesen werden." }));
    }
  };

  /**
   * The expensive sibling of refreshVault: drop every indexed row and parse the
   * whole vault again. This is what the maintenance page always CLAIMED to do
   * ("Index neu aufbauen") while actually running the cheap reconcile.
   */
  const rebuildIndex = async () => {
    const indexer = state.indexer;
    const db = state.dbAdapter;
    if (!indexer || !db) return;
    setState(s => ({ ...s, isLoading: true }));
    try {
      // sync_state stays: it carries the remote base for every file, and losing
      // it would make the next cycle re-upload the entire vault.
      await db.execute(`DELETE FROM files`);
      await db.execute(`DELETE FROM fts_notes`);
      await indexer.indexVaultFull();
      bumpTree();
      toast.success(i18n.t("refresh.rebuildDone", { defaultValue: "Index vollständig neu aufgebaut." }));
    } catch (e) {
      console.error("[VaultContext] index rebuild failed", e);
      toast.error(i18n.t("refresh.failed", { defaultValue: "Vault konnte nicht neu eingelesen werden." }));
    } finally {
      setState(s => ({ ...s, isLoading: false }));
    }
  };

  // P1b/P1c: one mechanism, several triggers. The manual ones (F5, the tree
  // button, the command palette) arrive as an event; the automatic ones are
  // window focus and a slow interval net. Both automatic paths are throttled
  // (30 s local, 5 min for the cloud listing) so alt-tabbing costs nothing.
  const stableRefresh = useStableHandler(refreshVault);
  useEffect(() => {
    if (!state.indexer) return;

    const manual = () => {
      void stableRefresh().catch(() => {});
    };
    const auto = () => {
      if (document.hidden) return;
      const now = Date.now();
      const plan = planAutoRefresh(now, autoRefreshMarksRef.current);
      if (!plan.local) return;
      autoRefreshMarksRef.current.local = now;
      if (plan.cloud) autoRefreshMarksRef.current.cloud = now;
      void stableRefresh({ silent: true, skipCloud: !plan.cloud }).catch(() => {});
    };

    window.addEventListener("plainva-refresh-vault", manual);
    window.addEventListener("focus", auto);
    const intervalId = window.setInterval(auto, AUTO_REFRESH_LIMITS.cloudMs / 2);
    return () => {
      window.removeEventListener("plainva-refresh-vault", manual);
      window.removeEventListener("focus", auto);
      window.clearInterval(intervalId);
    };
  }, [state.indexer, stableRefresh]);

  const triggerFileTreeUpdate = (paths?: string[]) => {
    // Every write path ends here, which makes it the one place that cannot
    // forget to tell the other windows. Only the owner broadcasts: a client's
    // own bump is a consequence, not a cause, and re-broadcasting it would
    // bounce between auxiliary windows.
    // Addressed with the vault of THIS runtime (stage D): with two of them in
    // the process, an unaddressed "the index moved" would refresh the other
    // window's tree over a vault that never changed.
    if (!isClient && state.vaultPath)
      broadcastIndexChanged(paths ?? [], !paths || paths.length === 0, state.vaultPath);
    if (paths && paths.length > 0) {
      // File-only refresh (P2.5): no folder-structure walk, and consumers may
      // skip refreshes whose paths cannot affect them (P2.7).
      setState(s => ({ ...s, fileTreeVersion: s.fileTreeVersion + 1, fileTreeVersionPaths: paths }));
    } else {
      setState(s => ({ ...s, fileTreeVersion: s.fileTreeVersion + 1, treeStructureVersion: s.treeStructureVersion + 1, fileTreeVersionPaths: null }));
    }
  };

  // Kept current for the owner bus (C1). Written in an effect, never during
  // render, so the value the handler reads is the one the last render produced.
  const vaultOpsRef = useRef<{
    refreshVault: typeof refreshVault;
    rebuildIndex: typeof rebuildIndex;
    syncWorker: VaultSyncWorker | null;
  }>({ refreshVault, rebuildIndex, syncWorker: null });
  useEffect(() => {
    vaultOpsRef.current = { refreshVault, rebuildIndex, syncWorker: state.syncWorker };
  });

  // Build recovery material before any remote state is created. Activation is a
  // separate, recovery-confirmed step in the Security Center.
  const prepareWorkspace = async (input: { ownerDisplayName: string; deviceDisplayName: string; fallbackPassphrase?: string }) => {
    if (!state.vaultPath || !syncTargetRef.current) throw new Error("workspace-no-connection");
    return preparePersonalWorkspace({ vaultPath: state.vaultPath, ...input });
  };

  const activateWorkspace = async (draftId: string, onProgress?: (done: number, total: number) => void): Promise<{ queued: number; total: number }> => {
    if (!state.vaultPath || !state.dbAdapter || !state.backupAdapter || !syncTargetRef.current || !syncProviderRef.current) {
      throw new Error("workspace-no-connection");
    }
    await state.syncWorker?.stopAndDrain();
    const workspaceState = new SqlWorkspaceStateStore(state.dbAdapter);
    workspaceStateRef.current = workspaceState;
    const result = await activatePreparedPersonalWorkspace({
      draftId,
      vaultPath: state.vaultPath,
      provider: workspaceProviderName(syncProviderRef.current),
      rawTarget: syncTargetRef.current,
      rawVault: state.backupAdapter,
      state: workspaceState,
      onProgress,
    });
    // Keep the legacy queue intact until encrypted initialization succeeds. It
    // is ignored from now on, but clearing it earlier could lose pending work if
    // the selected remote turns out to contain another workspace.
    await state.dbAdapter.execute("DELETE FROM offline_queue");
    await openVault(state.vaultPath);
    return { queued: result.queued, total: result.total };
  };

  const unlockWorkspace = async (passphrase?: string): Promise<void> => {
    if (!state.vaultPath || !state.dbAdapter || !state.workspaceSecurityStatus) throw new Error("workspace-not-configured");
    await unlockWorkspaceRuntime(state.vaultPath, passphrase);
    const workspaceState = workspaceStateRef.current ?? new SqlWorkspaceStateStore(state.dbAdapter);
    const meta = await workspaceState.loadMeta();
    await saveWorkspaceSecurityStatus(state.vaultPath, {
      ...state.workspaceSecurityStatus,
      phase: meta?.phase ?? "migrating",
      lastError: null,
    });
    await openVault(state.vaultPath);
  };

  const lockWorkspace = async (): Promise<void> => {
    if (!state.vaultPath || !state.workspaceSecurityStatus) throw new Error("workspace-not-configured");
    await state.syncWorker?.stopAndDrain();
    lockWorkspaceRuntime(state.vaultPath);
    await saveWorkspaceSecurityStatus(state.vaultPath, { ...state.workspaceSecurityStatus, phase: "locked", lastError: null });
    await openVault(state.vaultPath);
  };

  const cleanupRemotePlaintext = async (onProgress?: (done: number, total: number) => void): Promise<number> => {
    if (!syncTargetRef.current) throw new Error("workspace-no-connection");
    return removeLegacyRemotePlaintext(syncTargetRef.current, onProgress);
  };

  /** Picks an interrupted conversion back up; the key bundle is already on this device. */
  const resumeWorkspaceSetup = async (onProgress?: (done: number, total: number) => void): Promise<{ queued: number; total: number }> => {
    if (!state.vaultPath || !state.dbAdapter || !state.backupAdapter || !syncTargetRef.current || !syncProviderRef.current) {
      throw new Error("workspace-no-connection");
    }
    await state.syncWorker?.stopAndDrain();
    const workspaceState = workspaceStateRef.current ?? new SqlWorkspaceStateStore(state.dbAdapter);
    workspaceStateRef.current = workspaceState;
    const result = await resumePersonalWorkspaceSetup({
      vaultPath: state.vaultPath,
      provider: workspaceProviderName(syncProviderRef.current),
      rawTarget: syncTargetRef.current,
      rawVault: state.backupAdapter,
      state: workspaceState,
      onProgress,
    });
    await openVault(state.vaultPath);
    return { queued: result.queued, total: result.total };
  };

  const changeWorkspacePassphrase = async (currentPassphrase: string, nextPassphrase: string): Promise<void> => {
    if (!state.vaultPath) throw new Error("workspace-not-configured");
    await changeWorkspaceFallbackPassphrase(state.vaultPath, currentPassphrase, nextPassphrase);
  };

  const workspaceKeyStorage = async (): Promise<{ stored: WorkspaceKeyStorage | null; available: WorkspaceKeyStorage }> => {
    if (!state.vaultPath) throw new Error("workspace-not-configured");
    return describeWorkspaceKeyStorage(state.vaultPath);
  };

  const getWorkspaceDiagnostics = async (): Promise<{ meta: WorkspaceRuntimeMeta | null; queuedMutations: number; legacyPlaintextPaths: number; quarantine: number; localForks: number }> => {
    const workspaceState = workspaceStateRef.current;
    const [meta, queuedMutations, quarantine, localForks] = workspaceState
      ? await Promise.all([workspaceState.loadMeta(), workspaceState.listQueue().then((entries) => entries.length), workspaceState.listQuarantine("pending").then((entries) => entries.length), workspaceState.listLocalForks().then((entries) => entries.length)])
      : [null, 0, 0, 0];
    const legacyPlaintextPaths = syncTargetRef.current ? (await listLegacyRemotePlaintext(syncTargetRef.current)).length : 0;
    return { meta, queuedMutations, legacyPlaintextPaths, quarantine, localForks };
  };

  const workspaceControlPlane = () => {
    const runtime = workspaceRuntimeRef.current;
    const workspaceState = workspaceStateRef.current;
    const target = syncTargetRef.current;
    const provider = syncProviderRef.current;
    if (!state.vaultPath || !runtime || !workspaceState || !target || !provider) throw new Error("workspace-unavailable-or-locked");
    return { runtime, workspaceState, store: createProviderWorkspaceObjectStore(workspaceProviderName(provider), target), vaultPath: state.vaultPath };
  };

  const commitGovernance = async (update: WorkspaceGovernanceUpdate): Promise<void> => {
    const { runtime, workspaceState, store, vaultPath } = workspaceControlPlane();
    await publishWorkspaceGovernanceUpdate(store, update);
    applyWorkspaceGovernanceUpdate(runtime, update);
    await updateWorkspaceRuntime(vaultPath, runtime);
    const meta = await workspaceState.loadMeta();
    if (meta) { meta.policyHash = workspaceDocumentHash(update.policy); meta.needsPublication = true; await workspaceState.saveMeta(meta); }
    state.syncWorker?.triggerImmediate();
    window.dispatchEvent(new CustomEvent("plainva-workspace-governance-changed"));
  };

  const getWorkspaceGovernance = async () => {
    await refreshWorkspaceSliceCounts();
    const { runtime, workspaceState } = workspaceControlPlane();
    return {
      memberId: runtime.memberId,
      deviceId: runtime.device.publicIdentity.deviceId,
      members: runtime.policy.payload.members,
      devices: runtime.policy.payload.devices,
      groups: runtime.policy.payload.groups,
      assignments: runtime.policy.payload.assignments,
      slices: runtime.policy.payload.slices,
      brokenSlices: listBrokenWorkspaceSlices(runtime.policy.payload),
      quarantine: await workspaceState.listQuarantine(),
      localForks: await workspaceState.listLocalForks(),
    };
  };

  const approveWorkspaceDevice = async (tokenOrCode: string): Promise<string> => {
    const control = workspaceControlPlane();
    const token = tokenOrCode.trim().startsWith("PVPAIR1.") ? tokenOrCode.trim() : await findWorkspacePairingRequest(control.store, tokenOrCode.trim());
    if (!token) throw new Error("workspace-pairing-request-not-found");
    const previousPolicy = control.runtime.policy;
    const approval = await approveWorkspacePairing({ token, runtime: control.runtime });
    const update: WorkspaceGovernanceUpdate = { policy: approval.policy, grants: approval.grants, groupKeys: control.runtime.groupKeys };
    await commitGovernance(update);
    await publishWorkspacePairingApproval(control.store, { version: 1, genesis: control.runtime.genesis, previousPolicy, approval });
    return approval.request.payload.device.deviceId;
  };

  // Device-JOIN (pairing request) — the counterpart to approve (package C1). A
  // joining device has a sync connection but no workspace runtime yet, so the
  // object store is built directly from the raw target (no control plane).
  const joinObjectStore = () => {
    const target = syncTargetRef.current;
    const provider = syncProviderRef.current;
    if (!state.vaultPath || !target || !provider) throw new Error("workspace-no-connection");
    return { store: createProviderWorkspaceObjectStore(workspaceProviderName(provider), target), vaultPath: state.vaultPath };
  };

  const detectJoinableWorkspace = async (): Promise<{ workspaceId: string; fingerprint: string } | null> => {
    if (!syncTargetRef.current || !syncProviderRef.current || state.workspaceSecurityStatus) return null;
    try { return await detectRemoteWorkspace(joinObjectStore().store); }
    catch (error) { console.warn("[VaultContext] detectJoinableWorkspace failed", error); return null; }
  };

  const beginWorkspaceJoin = async (invite: WorkspaceInvite, deviceName: string): Promise<PendingJoin> => {
    const { store, vaultPath } = joinObjectStore();
    const result = await beginWorkspaceJoinFlow({ vaultPath, store, invite, deviceName });
    return { shortCode: result.shortCode, fingerprint: result.fingerprint, expiresAt: result.expiresAt };
  };

  const pollWorkspaceJoin = async (fallbackPassphrase?: string): Promise<boolean> => {
    const { store, vaultPath } = joinObjectStore();
    const runtime = await completeWorkspaceJoin({ vaultPath, store, fallbackPassphrase });
    if (!runtime) return false;
    await openVault(vaultPath);
    return true;
  };

  const getPendingWorkspaceJoin = async () => (state.vaultPath ? hasPendingWorkspaceJoin(state.vaultPath) : null);
  const cancelPendingWorkspaceJoin = async () => { if (state.vaultPath) await cancelWorkspaceJoin(state.vaultPath); };

  const inspectWorkspacePairingRequest = async (tokenOrCode: string) => {
    const control = workspaceControlPlane();
    const token = tokenOrCode.trim().startsWith("PVPAIR1.") ? tokenOrCode.trim() : await findWorkspacePairingRequest(control.store, tokenOrCode.trim());
    if (!token) throw new Error("workspace-pairing-request-not-found");
    const request = parseWorkspacePairingRequest(token);
    if (request.payload.workspaceId !== control.runtime.workspaceId || request.payload.workspaceFingerprint !== workspaceDocumentHash(control.runtime.genesis)) throw new Error("workspace-pairing-request-mismatch");
    return { token, deviceName: request.payload.device.displayName, platform: request.payload.device.platform, memberId: request.payload.memberId, fingerprint: pairingFingerprint(request), expiresAt: request.payload.expiresAt };
  };

  const removeWorkspaceDevice = async (deviceId: string, reason: string, mode: WorkspaceRekeyMode = "future"): Promise<void> => {
    const { runtime, workspaceState } = workspaceControlPlane();
    if (deviceId === runtime.device.publicIdentity.deviceId) throw new Error("workspace-cannot-revoke-current-device");
    await commitGovernance(await revokeWorkspaceDeviceAndRotate({ runtime, deviceId, reason }));
    await startWorkspaceRekey({ state: workspaceState, mode, subjectKind: "device", subjectId: deviceId });
    state.syncWorker?.triggerImmediate();
  };

  const removeWorkspaceMember = async (memberId: string, reason: string, mode: WorkspaceRekeyMode = "future"): Promise<void> => {
    const { runtime, workspaceState } = workspaceControlPlane();
    if (memberId === runtime.memberId) throw new Error("workspace-cannot-revoke-current-member");
    await commitGovernance(await revokeWorkspaceMemberAndRotate({ runtime, memberId, reason }));
    await startWorkspaceRekey({ state: workspaceState, mode, subjectKind: "member", subjectId: memberId });
    state.syncWorker?.triggerImmediate();
  };

  const addWorkspaceMember = async (displayName: string, role: WorkspaceRole, scopeKind: "workspace" | "slice" | "object" = "workspace", scopeId: string | null = null): Promise<string> => {
    const { runtime } = workspaceControlPlane();
    const result = await inviteWorkspaceMember({ runtime, displayName, role, scopeKind, scopeId });
    await commitGovernance(result);
    return result.memberId;
  };

  const addWorkspaceGroup = async (input: { name: string; memberIds: string[]; role: WorkspaceRole; scopeKind?: "workspace" | "slice" | "object"; scopeId?: string | null }): Promise<string> => {
    const { runtime } = workspaceControlPlane();
    const result = await createWorkspaceGroup({ runtime, ...input });
    await commitGovernance(result);
    return result.groupId;
  };

  const addWorkspaceSlice = async (input: { name: string; definition: { kind: "folder"; folder: string } | { kind: "selection"; objectIds: string[] } | { kind: "dynamic"; definition: WorkspaceDynamicSliceDefinition }; materializedObjectIds: string[]; publication?: { mode: "exact" | "sanitized"; access: "read" | "comment" | "suggest"; provider: "google-drive" | "onedrive" | "nextcloud" | "dropbox" | "webdav" | "s3"; propertyAllowlist?: string[] | null; privateProperties?: string[] } }): Promise<string> => {
    const { runtime } = workspaceControlPlane();
    const result = createWorkspaceSlice({ runtime, ...input });
    await commitGovernance({ policy: result.policy, grants: [], groupKeys: runtime.groupKeys });
    return result.sliceId;
  };

  /**
   * Opens one publication for writing: its own runtime out of the credential
   * store, and the store its objects live in.
   *
   * A publication is a workspace of its own. Its governance successors have to
   * be published INTO it - writing one into the main vault's store would leave
   * the recipients on the policy they were invited under, forever, while the
   * publisher believed the change had landed. The two stores are never
   * interchangeable, so this is the one place that pairs them.
   */
  const publicationControlPlane = async (publicationId: string) => {
    const { runtime, workspaceState, store, vaultPath } = workspaceControlPlane();
    const record = await workspaceState.getPublication(publicationId);
    if (!record) throw new Error("publication-unknown");
    const access = await readPublicationRuntime(vaultPath, publicationId);
    // Three outcomes, three answers. A locked vault locks its publications with
    // it - saying "unknown" there would invite a caller to create a second one.
    // And a record whose key is gone from this device is neither: the
    // publication exists, this machine just cannot speak for it any more.
    if (access.state === "locked") throw new Error("publication-locked");
    if (access.state !== "unlocked") throw new Error("publication-key-missing");
    const publicationRuntime = access.runtime;
    const publicationStore = publicationStoreFor(store, runtime.workspaceId, record.config.sliceId);
    return { vaultPath, workspaceState, record, publicationRuntime, publicationStore };
  };

  /**
   * Turns an existing slice into a publication: its own workspace, its own
   * keys, in a folder that carries no trace of this vault's id.
   *
   * The id is derived inside `createPublication` and comes back on the handle -
   * never passed in, so what is persisted here is what was actually written.
   */
  const addSlicePublication = async (input: { sliceId: string; name: string; mode: "exact" | "sanitized"; access: "read" | "comment" | "suggest"; provider: PublishedSliceProvider; propertyAllowlist?: string[] | null; privateProperties?: string[] }): Promise<string> => {
    const { runtime, workspaceState, store, vaultPath } = workspaceControlPlane();
    if (!evaluateWorkspaceAccess(runtime.policy.payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: "members.invite" }).allowed) throw new Error("workspace-publication-not-permitted");
    const deviceDisplayName = runtime.policy.payload.devices.find((device) => device.deviceId === runtime.device.publicIdentity.deviceId)?.displayName ?? "Desktop";
    const handle = await createPublication({
      runtime,
      store,
      config: {
        sliceId: input.sliceId,
        name: input.name,
        mode: input.mode,
        access: input.access,
        provider: input.provider,
        propertyAllowlist: input.propertyAllowlist ?? null,
        privateProperties: input.privateProperties ?? [],
      },
      deviceDisplayName,
      platform: "desktop",
      minimumClientVersion: WORKSPACE_MINIMUM_CLIENT_VERSION,
    });
    // Key material goes to the OS credential store, like the vault's own - the
    // record that follows carries config and manifest, and nothing openable.
    await persistPublicationRuntime(vaultPath, handle.publicationId, handle.runtime);
    await workspaceState.savePublication({
      publicationId: handle.publicationId,
      sliceId: handle.config.sliceId,
      config: handle.config,
      manifest: emptyPublicationManifest(handle.publicationId),
      lastError: null,
      lastRefreshedAt: null,
      createdAt: handle.config.createdAt,
    });
    // The next cycle fills it: `refreshPublications` runs after the checkpoint,
    // so a publication never hands out a revision the vault has not accepted.
    state.syncWorker?.triggerImmediate();
    window.dispatchEvent(new CustomEvent("plainva-workspace-governance-changed"));
    return handle.publicationId;
  };

  const slicePublications = async (): Promise<WorkspacePublicationRecord[]> => {
    const { workspaceState } = workspaceControlPlane();
    return workspaceState.listPublications();
  };

  /**
   * How far behind each publication is (Stufe B, S7).
   *
   * The record already carries WHEN the last refresh ran and WHY it stopped;
   * what it cannot carry is how much has changed since, because that depends on
   * the vault as it is right now. Core answers it from the slice's materialised
   * list and the manifest - no file reads, so the publication surface can ask on
   * every open.
   *
   * `listObjects()` rather than the enriched `workspaceSliceObjects()`: coverage
   * comes from `materializedObjectIds`, so tags and properties would be work
   * nobody reads here.
   */
  const publicationPendingCounts = async (): Promise<Record<string, number>> => {
    const { runtime, workspaceState } = workspaceControlPlane();
    const records = await workspaceState.listPublications();
    if (records.length === 0) return {};
    const objects = await workspaceState.listObjects();
    const slices = new Map(runtime.policy.payload.slices.map((slice) => [slice.sliceId, slice]));
    const pending: Record<string, number> = {};
    for (const record of records) {
      pending[record.publicationId] = pendingPublicationChanges({ slice: slices.get(record.sliceId), objects, manifest: record.manifest });
    }
    return pending;
  };

  /**
   * Mints a recipient and returns the code that lets them in.
   *
   * The successor is published into the PUBLICATION's store and the updated
   * runtime goes back to the credential store; both have to happen, because a
   * policy the publisher cannot re-sign from is a publication nobody can be
   * added to afterwards.
   */
  const addPublicationRecipient = async (input: { publicationId: string; displayName: string }): Promise<{ memberId: string; invite: string }> => {
    const { vaultPath, publicationRuntime, publicationStore } = await publicationControlPlane(input.publicationId);
    const recipientGroupId = publicationRecipientGroupId(publicationRuntime.policy.payload);
    if (!recipientGroupId) throw new Error("publication-recipient-group-missing");
    const update = await mintPublicationRecipient({ runtime: publicationRuntime, recipientGroupId, displayName: input.displayName });
    await publishWorkspaceGovernanceUpdate(publicationStore, update);
    applyWorkspaceGovernanceUpdate(publicationRuntime, update);
    await persistPublicationRuntime(vaultPath, input.publicationId, publicationRuntime);
    window.dispatchEvent(new CustomEvent("plainva-workspace-governance-changed"));
    return { memberId: update.memberId, invite: update.invite };
  };

  const publicationRecipientList = async (publicationId: string): Promise<PublicationRecipient[]> => {
    const { publicationRuntime } = await publicationControlPlane(publicationId);
    const recipientGroupId = publicationRecipientGroupId(publicationRuntime.policy.payload);
    if (!recipientGroupId) return [];
    return publicationRecipients(publicationRuntime.policy.payload, recipientGroupId);
  };

  /**
   * Takes one recipient back out of a publication.
   *
   * Runs against the PUBLICATION's runtime, never the vault's - the same
   * pairing every other publication operation depends on. `publicationControlPlane`
   * is what guarantees it, which is why the runtime is never passed in.
   *
   * What the caller has to have said BEFORE offering this: the bytes that
   * recipient already downloaded stay readable to them. The object store is
   * put-only, a deletion there is a tombstone rather than an erasure, and no
   * amount of key rotation reaches a copy on someone else's disk. What the
   * rotation does buy is that nothing new ever arrives and the next epoch is
   * unreadable to them. Saying that after the click would be saying it too
   * late.
   */
  const revokePublicationRecipientById = async (input: { publicationId: string; memberId: string; reason: string }): Promise<void> => {
    const { vaultPath, publicationRuntime, publicationStore } = await publicationControlPlane(input.publicationId);
    const update = await revokeRecipientAndRotate({ runtime: publicationRuntime, memberId: input.memberId, reason: input.reason });
    await publishWorkspaceGovernanceUpdate(publicationStore, update);
    applyWorkspaceGovernanceUpdate(publicationRuntime, update);
    await persistPublicationRuntime(vaultPath, input.publicationId, publicationRuntime);
    window.dispatchEvent(new CustomEvent("plainva-workspace-governance-changed"));
  };

  /**
   * Withdraws a publication entirely: tombstones over everything it holds, then
   * the record, then the key.
   *
   * The order is the whole design. Tombstones need the runtime, so the key is
   * cleared LAST - a device that dropped its key first would leave a folder
   * full of readable content and no way left to retract it. And the record is
   * removed only after the tombstones landed, so a run that dies half-way
   * leaves a publication the manifest still describes and the next attempt can
   * finish rather than a record pointing at a folder nobody can reason about.
   *
   * What stays behind, deliberately: the publication's own `.pvws/` objects.
   * The store is put-only; there is no delete. The provider-side share is not
   * touched either - Plainva does not manage other systems' ACLs, and pretending
   * to would be worse than saying so. The surface tells the publisher to remove
   * the share themselves, and that instruction is the last step of this flow,
   * not a footnote under it.
   */
  const removePublication = async (publicationId: string): Promise<{ retracted: number; error: string | null }> => {
    const { vaultPath, workspaceState, record, publicationRuntime, publicationStore } = await publicationControlPlane(publicationId);
    const plan = planPublicationTeardown(record.manifest);
    let manifest = record.manifest;
    let retracted = 0;

    if (plan.length > 0) {
      const result = await runPublicationRefresh({
        handle: { publicationId, runtime: publicationRuntime, store: publicationStore },
        manifest,
        plan,
        // A teardown plan is retractions only, so the runner never reaches this.
        // It throws rather than returning something plausible: if it ever fires,
        // the plan is not a teardown, and publishing invented content into a
        // folder somebody is still reading is the one outcome worth crashing over.
        project: async () => { throw new Error("publication-teardown-projection"); },
        persist: async (next) => { await workspaceState.savePublication({ ...record, manifest: next }); },
      });
      manifest = result.manifest;
      retracted = result.applied.length;
      const { error } = result;
      if (error) {
        // Stop with the record intact. The manifest now describes what actually
        // stayed published, so a second attempt retracts exactly the remainder.
        await workspaceState.savePublication({ ...record, manifest, lastError: error });
        return { retracted, error };
      }
    }

    await workspaceState.deletePublication(publicationId);
    // Last, because it wipes the runtime this function was holding.
    await clearPublicationRuntimes(vaultPath, [publicationId]);
    window.dispatchEvent(new CustomEvent("plainva-workspace-governance-changed"));
    return { retracted, error: null };
  };

  /** Every workspace object with the tags and properties a dynamic slice rule can ask about. */
  const workspaceSliceObjects = async () => {
    const { workspaceState } = workspaceControlPlane();
    return loadWorkspaceSliceObjects(await workspaceState.listObjects(), state.dbAdapter);
  };

  const previewSlice = async (definition: { kind: "folder"; folder: string } | { kind: "selection"; objectIds: string[] } | { kind: "dynamic"; definition: WorkspaceDynamicSliceDefinition }): Promise<Array<{ objectId: string; path: string }>> => {
    const previewObjects = await workspaceSliceObjects();
    const preview = previewWorkspaceSlice({ sliceId: createWorkspaceObjectId(), name: "Preview", kind: definition.kind, definition: createWorkspaceSliceDefinition(definition), materializedObjectIds: definition.kind === "selection" ? [...definition.objectIds].sort() : [] }, previewObjects);
    const matched = new Set(preview.matchedObjectIds);
    return previewObjects.filter((object) => matched.has(object.objectId)).map(({ objectId, path }) => ({ objectId, path }));
  };

  /**
   * What a publication would actually let out of the vault (Stufe B, S7, finding F).
   *
   * The projection core has been able to answer this since S3; nothing called it,
   * so the wizard's last step described a publication in terms of a count and a
   * mode name while staying silent about the one thing the publisher is deciding:
   * which properties, links and embeds leave the vault, and which are removed.
   *
   * Deliberately built from the same pieces the refresh uses, because a preview
   * that computes differently from the run it previews is worse than no preview:
   * the same three filters (`publishableObjects`), and the same default property
   * policy a slice is created with. `mode: "exact"` runs no projection at all and
   * comes back marked unchanged - that IS the honest preview for it.
   *
   * Reads every covered note. That is the cost of an answer about content rather
   * than about ids, so it runs once, on an explicit step, with the reads
   * overlapped and bounded; the pending-count path above stays revision-id-only
   * for exactly this reason.
   */
  const previewSlicePublication = async (input: { objectIds: string[]; mode: PublishedSliceMode }): Promise<PublishedProjectionPreview> => {
    const { workspaceState } = workspaceControlPlane();
    const vaultAdapter = state.vaultAdapter;
    if (!vaultAdapter) throw new Error("workspace-no-connection");
    const records = publishableObjects(input.objectIds, await workspaceState.listObjects());
    const limiter = createLimiter(8);
    const objects = await Promise.all(
      records.map((record) => limiter.run(async () => ({ path: record.path, markdown: await vaultAdapter.readTextFile(record.path) }))),
    );
    return previewPublishedProjection({ mode: input.mode, objects, ...defaultPublishedPropertyPolicy() });
  };

  /**
   * Brings the slice counters back in line with the vault before anyone reads them.
   * `materializeWorkspaceSlices` had no caller since it was written, so a folder slice kept
   * showing the object count it had on the day it was created (finding 2026-08-25).
   * Publishes only when a list actually changed.
   */
  const refreshWorkspaceSliceCounts = async (): Promise<void> => {
    const { runtime } = workspaceControlPlane();
    if (runtime.policy.payload.slices.length === 0) return;
    const refreshed = refreshWorkspaceSliceMaterialization({ runtime, objects: await workspaceSliceObjects() });
    if (!refreshed) return;
    await commitGovernance({ policy: refreshed.policy, grants: [], groupKeys: runtime.groupKeys });
  };

  const restoreWorkspaceRecovery = async (input: { bytes: Uint8Array; recoveryCode: string; deviceDisplayName: string; fallbackPassphrase?: string; revokeOtherDevices?: boolean }): Promise<void> => {
    if (!state.vaultPath || !state.dbAdapter || !state.backupAdapter || !syncTargetRef.current || !syncProviderRef.current) throw new Error("workspace-no-connection");
    await state.syncWorker?.stopAndDrain();
    const store = createProviderWorkspaceObjectStore(workspaceProviderName(syncProviderRef.current), syncTargetRef.current);
    const restored = await restoreWorkspaceFromRecoveryPackage({ bytes: input.bytes, recoveryCode: input.recoveryCode, deviceDisplayName: input.deviceDisplayName, platform: "desktop", revokeOtherDevices: input.revokeOtherDevices, store });
    await publishWorkspaceGovernanceUpdate(store, restored);
    await persistWorkspaceRuntime({ vaultPath: state.vaultPath, runtime: restored.runtime, fingerprint: workspaceDocumentHash(restored.runtime.genesis), recoveryConfirmedAt: new Date().toISOString(), fallbackPassphrase: input.fallbackPassphrase });
    const workspaceState = workspaceStateRef.current ?? new SqlWorkspaceStateStore(state.dbAdapter);
    await initializePersonalWorkspaceMigration({ store, state: workspaceState, vault: state.backupAdapter, runtime: restored.runtime, recoveryConfirmedAt: new Date().toISOString() });
    await openVault(state.vaultPath);
  };

  const rotateWorkspaceRecovery = async (input: { bytes: Uint8Array; recoveryCode: string }): Promise<{ bytes: Uint8Array; recoveryCode: string; activation: RotatedWorkspaceRecovery["anchor"] }> => {
    const { runtime, store } = workspaceControlPlane();
    if (!evaluateWorkspaceAccess(runtime.policy.payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: "recovery.manage" }).allowed) throw new Error("workspace-recovery-manage-not-permitted");
    const rotated = await rotateWorkspaceRecoveryPackage({ ...input, runtime, store });
    return { bytes: rotated.bytes, recoveryCode: rotated.recoveryCode, activation: rotated.anchor };
  };

  const activateWorkspaceRecovery = async (activation: RotatedWorkspaceRecovery["anchor"]): Promise<void> => {
    const { runtime, store } = workspaceControlPlane();
    await publishWorkspaceRecoveryRotation({ runtime, store, anchor: activation });
    state.syncWorker?.triggerImmediate();
  };

  const prepareWorkspaceOwnerTransfer = async (input: { targetMemberId: string; bytes: Uint8Array; recoveryCode: string }) => {
    const { runtime, store } = workspaceControlPlane();
    const transfer = await transferWorkspaceOwnership({ runtime, targetMemberId: input.targetMemberId });
    const rotated = await rotateWorkspaceRecoveryPackage({ bytes: input.bytes, recoveryCode: input.recoveryCode, runtime, store, replacement: { ownerMemberId: transfer.ownerMemberId, ownerGroup: transfer.ownerGroup, policy: transfer.policy, grants: [...runtime.grants, ...transfer.grants] } });
    return { bytes: rotated.bytes, recoveryCode: rotated.recoveryCode, activation: { anchor: rotated.anchor, update: transfer, ownerMemberId: transfer.ownerMemberId } };
  };

  const activateWorkspaceOwnerTransfer = async (activation: { anchor: RotatedWorkspaceRecovery["anchor"]; update: WorkspaceGovernanceUpdate; ownerMemberId: string }): Promise<void> => {
    const { runtime, store, vaultPath } = workspaceControlPlane();
    await publishWorkspaceRecoveryRotation({ runtime, store, anchor: activation.anchor });
    await publishWorkspaceGovernanceUpdate(store, activation.update);
    applyWorkspaceGovernanceUpdate(runtime, activation.update);
    runtime.ownerMemberId = activation.ownerMemberId;
    await updateWorkspaceRuntime(vaultPath, runtime);
    state.syncWorker?.triggerImmediate();
    window.dispatchEvent(new CustomEvent("plainva-workspace-governance-changed"));
  };

  const updateWorkspaceQuarantine = async (quarantineId: string, action: "retry" | "ignore" | "repaired"): Promise<void> => {
    const { workspaceState } = workspaceControlPlane();
    await workspaceState.setQuarantineStatus(quarantineId, action === "repaired" ? "repaired" : action === "ignore" ? "ignored" : "pending");
    if (action === "retry") state.syncWorker?.triggerImmediate();
    window.dispatchEvent(new CustomEvent("plainva-workspace-governance-changed"));
  };

  const exportWorkspaceQuarantine = async (quarantineId: string): Promise<Uint8Array | null> => {
    const { workspaceState } = workspaceControlPlane();
    return new WorkspaceQuarantineService(workspaceState, () => state.syncWorker?.triggerImmediate()).exportCiphertext(quarantineId);
  };

  /**
   * The plain-vault storage path for comments (Stufe D, D4).
   *
   * Deliberately the BACKUP adapter, exactly what the sync worker hands the
   * sideband step: the conflict-aware app adapter would mint sync_state rows and
   * `.CONFLICT` copies of the comment bundle. `BackupVaultAdapter` skips
   * `.plainva` for snapshots anyway, so nothing here lands in the version
   * history either.
   */
  const localCommentContext = (): { vaultPath: string; raw: IVaultAdapter } | null => {
    if (state.workspaceSecurityStatus || !state.vaultPath || !state.backupAdapter) return null;
    return { vaultPath: state.vaultPath, raw: state.backupAdapter };
  };

  const getWorkspaceCapabilities = async (path: string): Promise<WorkspaceCapability[] | null> => {
    // A vault without a workspace still gets the comment surface — the same
    // threads, anchors and suggestions, only stored in the sideband bundle
    // instead of signed objects. Returning null here would switch the whole
    // column off for everyone who never set up an encrypted workspace.
    if (!state.workspaceSecurityStatus) return localCommentContext() ? [...LOCAL_COMMENT_CAPABILITIES] : null;
    const { runtime, workspaceState } = workspaceControlPlane();
    const object = await workspaceState.getObjectByPath(path);
    const objectId = object?.objectId ?? createWorkspaceObjectId();
    const sliceIds = workspaceSliceIdsForObject(runtime.policy.payload, { objectId, path, contentKind: object?.contentKind });
    return effectiveWorkspaceCapabilities(runtime.policy.payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, objectId, sliceIds });
  };

  const listWorkspaceComments = async (path: string): Promise<WorkspaceCommentRecord[]> => {
    if (!state.workspaceSecurityStatus) {
      const local = localCommentContext();
      return local ? listLocalComments(local.vaultPath, local.raw, path) : [];
    }
    const { workspaceState } = workspaceControlPlane();
    const object = await workspaceState.getObjectByPath(path);
    return object ? workspaceState.listComments(object.objectId) : [];
  };

  /**
   * Collects what the recipients of this note's publications wrote back (D7).
   *
   * Which publications carry this note is answered from the manifests already
   * in the local record - no key material, no network - so a note that was
   * never published costs one lookup and stops. Only a publication that really
   * carries it gets unlocked, because unlocking is the expensive half.
   *
   * A publication whose key is gone from this device, or that is locked with
   * the vault, is skipped rather than raised: the column beside the note is not
   * the place to learn that a key is missing - the security surface says that
   * plainly, and failing here would take the note's own comments down with it.
   */
  const listPublicationComments = async (path: string): Promise<PublicationCommentEntry[]> => {
    // A publication only exists inside an encrypted workspace, so a plain vault
    // has nothing to collect - not an error, just an empty answer.
    if (!state.workspaceSecurityStatus) return [];
    const { workspaceState } = workspaceControlPlane();
    const object = await workspaceState.getObjectByPath(path);
    if (!object) return [];
    const collected: PublicationCommentEntry[] = [];
    for (const record of await workspaceState.listPublications()) {
      if (!record.manifest.objects.some((entry) => entry.sourceObjectId === object.objectId)) continue;
      try {
        const { publicationRuntime, publicationStore } = await publicationControlPlane(record.publicationId);
        const found = await collectPublicationComments({
          publicationId: record.publicationId,
          runtime: publicationRuntime,
          store: publicationStore,
          manifest: record.manifest,
          mode: record.config.mode,
          sourceObjectIds: [object.objectId],
        });
        collected.push(...found.map((entry) => ({ ...entry, publicationName: record.config.name })));
      } catch {
        continue;
      }
    }
    return collected;
  };

  const listAllWorkspaceComments = async (): Promise<Map<string, WorkspaceCommentRecord[]>> => {
    if (!state.workspaceSecurityStatus) {
      const local = localCommentContext();
      return local ? listAllLocalComments(local.vaultPath, local.raw) : new Map();
    }
    const { runtime, workspaceState } = workspaceControlPlane();
    // A comment names the object it hangs on, never the path — a renamed note
    // keeps its object and its thread. So the paths come from the objects, and
    // a comment whose object is gone is dropped rather than filed under "".
    //
    // The read right is decided HERE, once per note, off the policy already in
    // memory. Asking `getWorkspaceCapabilities` from the view would be one
    // database round-trip per note; leaving it out would show an overview wider
    // than the note itself does.
    const paths = new Map<string, string>();
    for (const object of await workspaceState.listObjects()) {
      const sliceIds = workspaceSliceIdsForObject(runtime.policy.payload, object);
      const caps = effectiveWorkspaceCapabilities(runtime.policy.payload, {
        memberId: runtime.memberId,
        deviceId: runtime.device.publicIdentity.deviceId,
        objectId: object.objectId,
        sliceIds,
      });
      if (caps.includes("comment.read")) paths.set(object.objectId, object.path);
    }
    const byPath = new Map<string, WorkspaceCommentRecord[]>();
    for (const comment of await workspaceState.listAllComments()) {
      const path = paths.get(comment.targetObjectId);
      if (!path) continue;
      const list = byPath.get(path);
      if (list) list.push(comment);
      else byPath.set(path, [comment]);
    }
    return byPath;
  };

  /**
   * Every remark guests wrote back, across the whole vault (Stufe F, F4).
   *
   * The per-note variant above answers "what came back for THIS note" and pays
   * one unlock per publication carrying it. A notification cycle asks the same
   * question of every note at once, so it must not multiply that: this walks
   * the publications ONCE, unlocking each at most a single time, and hands back
   * every remark keyed by the source note's path.
   *
   * A publication whose key is gone from this device, or that is locked with
   * the vault, is skipped rather than raised - the same rule the column
   * follows. A missing key is something the security surface says plainly; a
   * notification cycle is not the place to learn it.
   */
  const listAllPublicationComments = async (): Promise<Map<string, PublicationCommentEntry[]>> => {
    const byPath = new Map<string, PublicationCommentEntry[]>();
    if (!state.workspaceSecurityStatus) return byPath;
    const { workspaceState } = workspaceControlPlane();
    const pathOf = new Map<string, string>();
    for (const object of await workspaceState.listObjects()) pathOf.set(object.objectId, object.path);
    for (const record of await workspaceState.listPublications()) {
      const sourceObjectIds = record.manifest.objects
        .map((entry) => entry.sourceObjectId)
        .filter((objectId) => pathOf.has(objectId));
      if (sourceObjectIds.length === 0) continue;
      try {
        const { publicationRuntime, publicationStore } = await publicationControlPlane(record.publicationId);
        const found = await collectPublicationComments({
          publicationId: record.publicationId,
          runtime: publicationRuntime,
          store: publicationStore,
          manifest: record.manifest,
          mode: record.config.mode,
          sourceObjectIds,
        });
        for (const entry of found) {
          // `path` is the publisher's own path, filled by core - no second
          // lookup, and no chance of disagreeing with the column's grouping.
          const list = byPath.get(entry.path);
          const withName = { ...entry, publicationName: record.config.name };
          if (list) list.push(withName);
          else byPath.set(entry.path, [withName]);
        }
      } catch {
        continue;
      }
    }
    return byPath;
  };

  /**
   * Notes this member wrote (Stufe F, F4).
   *
   * Feeds the "remarks on my notes" half of level 2 and the "a suggestion is
   * waiting on me" case. An EMPTY `authorMemberId` is not a match: rows written
   * before that column existed carry one, and treating them as mine would
   * notify somebody about every old note in the vault. A plain vault has no
   * members at all and answers with nothing rather than guessing.
   */
  const listOwnedPaths = async (): Promise<Set<string>> => {
    const owned = new Set<string>();
    if (!state.workspaceSecurityStatus) return owned;
    const { runtime, workspaceState } = workspaceControlPlane();
    for (const object of await workspaceState.listObjects()) {
      if (object.authorMemberId && object.authorMemberId === runtime.memberId) owned.add(object.path);
    }
    return owned;
  };

  const listWorkspaceMembers = async (): Promise<WorkspacePolicyMember[]> => {
    if (!state.workspaceSecurityStatus) {
      // Without a policy a DEVICE is the author, and its self-chosen name is the
      // only honest thing to show. Never a claim about who somebody is — just
      // what that device calls itself.
      const local = localCommentContext();
      if (!local) return [];
      const names = await listLocalCommentAuthors(local.vaultPath, local.raw);
      return [...names].map(([memberId, displayName]) => ({ memberId, displayName, state: "active" as const }));
    }
    return workspaceControlPlane().runtime.policy.payload.members;
  };

  const getCommentSelfId = async (): Promise<string | null> => {
    // Two honest answers to one question, and each side owns its own: the
    // workspace signs with the member id, the plain vault writes the device id.
    if (!state.workspaceSecurityStatus) return localCommentContext() ? localCommentSelfId() : null;
    return workspaceControlPlane().runtime.memberId;
  };

  const postWorkspaceCommentRecord = async (path: string, body: string, parentCommentId: string | null = null, resolvedCommentId: string | null = null, anchor: WorkspaceCommentAnchor | null = null, suggestion: { replacement: string } | null = null, suggestionOutcome: "applied" | "declined" | null = null): Promise<void> => {
    const local = localCommentContext();
    if (local) {
      // The reviewer field this vault already carries — the person at this
      // keyboard, device-local — rather than asking the same question twice.
      const authorName = await (await getSettingsStore()).get<string>(verifierNameKey(local.vaultPath));
      await postLocalComment(local.vaultPath, local.raw, { path, body, parentCommentId, resolvedCommentId, anchor, suggestion, suggestionOutcome, authorName });
      state.syncWorker?.triggerImmediate();
      window.dispatchEvent(new CustomEvent("plainva-workspace-comments-changed", { detail: { path } }));
      return;
    }
    const { runtime, workspaceState, store } = workspaceControlPlane();
    const object = await workspaceState.getObjectByPath(path);
    if (!object?.currentRevisionId) throw new Error("workspace-object-not-synced");
    const meta = await workspaceState.loadMeta();
    if (!meta) throw new Error("workspace-state-missing");
    const sliceIds = workspaceSliceIdsForObject(runtime.policy.payload, { objectId: object.objectId, path: object.path, contentKind: object.contentKind });
    if (!evaluateWorkspaceAccess(runtime.policy.payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: "comment.create", objectId: object.objectId, sliceIds }).allowed) throw new Error("workspace-comment-not-permitted");
    const groupIds = workspaceRecipientGroupIds(runtime.policy.payload, { objectId: object.objectId, path: object.path, contentKind: object.contentKind });
    const recipients = groupIds.map((groupId) => { const group = runtime.policy.payload.groups.find((entry) => entry.groupId === groupId)!; return { groupId, keyEpoch: group.keyEpoch, publicKey: decodeBase64Exact(group.hpkePublicKey, 32, "comment recipient key") }; });
    const prepared = await prepareWorkspaceComment({ runtime, policyHash: meta.policyHash, sequence: meta.sequence + 1, previousDeviceOperationHash: meta.previousOperationHash, targetObjectId: object.objectId, targetRevisionId: object.currentRevisionId, body, parentCommentId, resolvedCommentId, anchor, suggestion, suggestionOutcome, recipients });
    await publishWorkspaceComment(store, prepared);
    await commitPublishedWorkspaceComment(workspaceState, prepared, meta);
    state.syncWorker?.triggerImmediate();
    window.dispatchEvent(new CustomEvent("plainva-workspace-comments-changed", { detail: { path } }));
  };

  const postWorkspaceComment = (path: string, body: string, parentCommentId: string | null = null, anchor: WorkspaceCommentAnchor | null = null, suggestion: { replacement: string } | null = null) => postWorkspaceCommentRecord(path, body, parentCommentId, null, anchor, suggestion);
  // A resolve marker is a fact, not a message: it carries no body. The literal
  // English "Resolved" that used to travel here appeared verbatim in all ten
  // languages, on every device, for good — a marker has no text to translate.
  // Accepting and declining close the thread the same way a plain resolve does;
  // the outcome rides ALONG on the marker instead of re-signing the proposal.
  const resolveWorkspaceComment = (path: string, commentId: string, suggestionOutcome: "applied" | "declined" | null = null) => postWorkspaceCommentRecord(path, "", null, commentId, null, null, suggestionOutcome);

  const listWorkspaceRevisions = async (path: string): Promise<WorkspaceRevisionRecord[] | null> => {
    if (!state.workspaceSecurityStatus) return null;
    const { workspaceState } = workspaceControlPlane();
    const object = await workspaceState.getObjectByPath(path);
    return object ? workspaceState.listRevisionsForObject(object.objectId) : [];
  };

  const readWorkspaceRevision = async (revisionId: string): Promise<Uint8Array> => {
    const { runtime, workspaceState, store } = workspaceControlPlane();
    return new WorkspaceRevisionHistoryService(store, workspaceState, runtime.groupKeys).read(revisionId);
  };

  const resetConnectionEncryption = async (): Promise<void> => {
    // Un-brick a content-E2E connection whose remote manifest is gone/invalid:
    // drop the local `knownEncrypted` pin (fail-closed -> trust-on-first-use)
    // and kick a resync. The remote A3 magic-byte guard still blocks a plaintext
    // push into a remote that actually carries sealed content.
    if (!state.vaultPath) return;
    const connectionId = await getActiveConnectionId(state.vaultPath);
    if (!connectionId) return;
    await saveConnectionState({ connectionId, knownEncrypted: false });
    state.syncWorker?.triggerImmediate();
  };

  /**
   * Everything a workspace owns, taken down in the one order that works.
   *
   * The two callers below differed only in how they reopened the vault, and
   * kept five identical steps side by side — which is how the publication
   * slots came to be missing from both at once (finding 2026-08-30). One
   * function now, so a step can no longer be added to one and forgotten in the
   * other.
   *
   * The ordering is the load-bearing part: a publication's credential slot is
   * named after an id that exists ONLY in `workspace_publication`, and
   * `clearWorkspaceState()` drops that table. Read first, clear afterwards —
   * a keychain cannot be enumerated to find a slot whose id is gone.
   */
  const tearDownWorkspace = async (path: string): Promise<void> => {
    // Stop the worker first so no cycle races the teardown.
    await state.syncWorker?.stopAndDrain().catch(() => undefined);
    const publicationIds = await workspaceStateRef.current
      ?.listPublications()
      .then((records) => records.map((record) => record.publicationId))
      .catch(() => [] as string[]);
    await workspaceStateRef.current?.clearWorkspaceState().catch(() => undefined);
    lockWorkspaceRuntime(path);
    await clearPublicationRuntimes(path, publicationIds ?? []);
    await clearWorkspaceRuntime(path);
  };

  const decommissionWorkspace = async (): Promise<void> => {
    const path = state.vaultPath;
    if (!path) return;
    // Drop the local workspace state (SQL) + runtime/status (keychain +
    // settings); reopening re-derives the vault WITHOUT the workspace (plain
    // sync or local). The remote `.pvws/` objects stay (immutable store); the
    // user deletes the cloud folder afterwards — the handbook documents the order.
    await tearDownWorkspace(path);
    await openVault(path);
  };

  const liftWorkspaceEncryption = async (): Promise<void> => {
    const path = state.vaultPath;
    if (!path) return;
    // Same teardown as decommission, but reopen with isNewConnection=true so the
    // plaintext worker enqueues EVERY local file (enqueueAllLocalFiles, gated on
    // the now-null workspaceStateStore) and uploads it to the same cloud folder
    // as plain text — not just local-only files. The `.pvws/` objects are
    // immutable and stay; the user deletes the cloud folder afterwards. This is
    // additive: local files are untouched and no upload deletes anything.
    await tearDownWorkspace(path);
    await loadVault(path, true);
  };

  /**
   * Client mode: the vault lifecycle stays with the central window. These
   * throw instead of quietly doing nothing — an auxiliary window that silently
   * ignored "switch vault" would leave the user staring at the old one.
   */
  const clientLifecycle: VaultLifecycleApi = useMemo(
    () => ({
      selectVault: async () => {
        throw new Error(ownerOnly("selectVault"));
      },
      openVault: async () => {
        throw new Error(ownerOnly("openVault"));
      },
      closeVault: () => {
        throw new Error(ownerOnly("closeVault"));
      },
      // These two are not owner-only in the sense the others are: the ACTION is
      // legitimate from any window, only the writing is not (C1). So the client
      // asks instead of refusing — the button in its tree header would
      // otherwise be a button that throws.
      refreshVault: async () => {
        const bus = await getWindowBus();
        await bus.request("reindex", { scope: "refresh" });
        // The owner reports what it found; this window learns of the result
        // through `index-changed`, so there is nothing local to hand back.
        return { local: { added: 0, changed: 0, removed: 0, skipped: [], durationMs: 0 }, cloud: "none" };
      },
      rebuildIndex: async () => {
        const bus = await getWindowBus();
        await bus.request("reindex", { scope: "rebuild" });
      },
      removeRecentVault: async () => {
        throw new Error(ownerOnly("removeRecentVault"));
      },
      setAutoOpenLastVault: async () => {
        throw new Error(ownerOnly("setAutoOpenLastVault"));
      },
    }),
    [],
  );

  // One value identity per state change: renders of the provider itself (e.g.
  // parent re-renders) must not fan out to every useVault consumer (P3).
  const value = useMemo(
    () => ({ ...state, recentVaults, autoOpenLastVault, selectVault, openVault, refreshVault, refreshFolder, rebuildIndex, triggerFileTreeUpdate, closeVault, removeRecentVault, setAutoOpenLastVault, preparePersonalWorkspace: prepareWorkspace, activatePersonalWorkspace: activateWorkspace, unlockPersonalWorkspace: unlockWorkspace, lockPersonalWorkspace: lockWorkspace, removeRemotePlaintext: cleanupRemotePlaintext, resumePersonalWorkspaceSetup: resumeWorkspaceSetup, changeWorkspacePassphrase, getWorkspaceKeyStorage: workspaceKeyStorage, resetConnectionEncryption, decommissionWorkspace, liftWorkspaceEncryption, getWorkspaceDiagnostics, getWorkspaceGovernance, inspectWorkspacePairingRequest, approveWorkspaceDevice, detectJoinableWorkspace, beginWorkspaceJoin, pollWorkspaceJoin, getPendingWorkspaceJoin, cancelPendingWorkspaceJoin, revokeWorkspaceDevice: removeWorkspaceDevice, revokeWorkspaceMember: removeWorkspaceMember, inviteWorkspaceMember: addWorkspaceMember, createWorkspaceGroup: addWorkspaceGroup, createWorkspaceSlice: addWorkspaceSlice, previewWorkspaceSlice: previewSlice, listWorkspaceSliceObjects: workspaceSliceObjects, createSlicePublication: addSlicePublication, listSlicePublications: slicePublications, listPublicationPendingCounts: publicationPendingCounts, previewSlicePublication, invitePublicationRecipient: addPublicationRecipient, listPublicationRecipients: publicationRecipientList, revokePublicationRecipient: revokePublicationRecipientById, removeSlicePublication: removePublication, restoreWorkspaceRecovery, rotateWorkspaceRecovery, activateWorkspaceRecovery, prepareWorkspaceOwnerTransfer, activateWorkspaceOwnerTransfer, updateWorkspaceQuarantine, exportWorkspaceQuarantine, getWorkspaceCapabilities, listWorkspaceComments, listPublicationComments, listAllWorkspaceComments, listAllPublicationComments, listOwnedPaths, listWorkspaceMembers, getCommentSelfId, postWorkspaceComment, resolveWorkspaceComment, listWorkspaceRevisions, readWorkspaceRevision, ...(isClient ? clientLifecycle : null) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, isClient, clientLifecycle, recentVaults, autoOpenLastVault, selectVault, openVault, closeVault, removeRecentVault, setAutoOpenLastVault]
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
