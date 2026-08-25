import {
  createPersonalWorkspaceBootstrap,
  createProviderWorkspaceObjectStore,
  createWorkspaceRecoveryPackage,
  initializePersonalWorkspaceMigration,
  personalWorkspaceRuntime,
  wipeWorkspaceRuntimeSecrets,
  workspaceDocumentHash,
  type ISyncTarget,
  type IVaultAdapter,
  type PersonalWorkspaceRuntime,
  type WorkspaceProviderName,
  type WorkspaceStateStore,
} from "@plainva/core";
import { credentialManager } from "../CredentialManager";
import {
  getWorkspaceSecurityStatus,
  persistWorkspaceRuntime,
  readWorkspaceRuntime,
  saveWorkspaceSecurityStatus,
  WORKSPACE_FALLBACK_PASSPHRASE_MIN_LENGTH,
  type WorkspaceSecurityPublicStatus,
} from "./workspaceKeychain";

interface WorkspaceDraft {
  vaultPath: string;
  runtime: PersonalWorkspaceRuntime;
  fingerprint: string;
  recoveryConfirmedAt: string;
  fallbackPassphrase?: string;
  expiresAt: number;
}

export interface PreparedPersonalWorkspace {
  draftId: string;
  recoveryPackage: Uint8Array;
  recoveryCode: string;
  fingerprint: string;
  requiresFallbackPassphrase: boolean;
}

const drafts = new Map<string, WorkspaceDraft>();
const DRAFT_TTL_MS = 30 * 60 * 1000;

function destroyDraft(draft: WorkspaceDraft): void {
  // Shared with locking, so an abandoned draft and a locked workspace forget the same set of
  // keys. Hand-listing them here missed every group epoch beyond the owner's (finding
  // 2026-08-25, B6).
  wipeWorkspaceRuntimeSecrets(draft.runtime);
  draft.fallbackPassphrase = undefined;
}

export function discardPreparedPersonalWorkspace(draftId: string): void {
  const draft = drafts.get(draftId);
  if (!draft) return;
  drafts.delete(draftId);
  destroyDraft(draft);
}

export async function preparePersonalWorkspace(input: {
  vaultPath: string;
  ownerDisplayName: string;
  deviceDisplayName: string;
  fallbackPassphrase?: string;
}): Promise<PreparedPersonalWorkspace> {
  for (const [draftId, draft] of drafts) {
    if (draft.vaultPath === input.vaultPath || draft.expiresAt <= Date.now()) discardPreparedPersonalWorkspace(draftId);
  }
  const keychainMode = await credentialManager.checkKeychainStatus();
  if (keychainMode === "fallback" && (!input.fallbackPassphrase || input.fallbackPassphrase.length < WORKSPACE_FALLBACK_PASSPHRASE_MIN_LENGTH)) {
    throw new Error("workspace-fallback-passphrase-required");
  }
  const bootstrap = await createPersonalWorkspaceBootstrap({
    ownerDisplayName: input.ownerDisplayName.trim(),
    deviceDisplayName: input.deviceDisplayName.trim(),
    platform: "desktop",
    minimumClientVersion: "0.4.1",
  });
  const recoveryConfirmedAt = new Date().toISOString();
  const recovery = createWorkspaceRecoveryPackage(bootstrap, { now: recoveryConfirmedAt });
  const fingerprint = workspaceDocumentHash(bootstrap.genesis);
  const draftId = crypto.randomUUID();
  drafts.set(draftId, {
    vaultPath: input.vaultPath,
    runtime: personalWorkspaceRuntime(bootstrap),
    fingerprint,
    recoveryConfirmedAt,
    fallbackPassphrase: input.fallbackPassphrase,
    expiresAt: Date.now() + DRAFT_TTL_MS,
  });
  return {
    draftId,
    recoveryPackage: recovery.bytes,
    recoveryCode: recovery.recoveryCode,
    fingerprint,
    requiresFallbackPassphrase: keychainMode === "fallback",
  };
}

/**
 * The key bundle is written BEFORE the vault is converted, and that order is deliberate.
 *
 * Sweeping first would leave an encrypted remote with no local key — recoverable only from
 * the recovery file, which is strictly worse than a half-converted vault. So the half state
 * is made to explain itself instead: it is saved as `setup-incomplete`, which the Security
 * Center offers to resume (finding 2026-08-25, B7). Previously the same interruption left
 * `preparing` (silence) or `error` (which offers to decommission — the opposite of what a
 * device holding a perfectly good key bundle needs).
 */
export async function activatePreparedPersonalWorkspace(input: {
  draftId: string;
  vaultPath: string;
  provider: WorkspaceProviderName;
  rawTarget: ISyncTarget;
  rawVault: IVaultAdapter;
  state: WorkspaceStateStore;
  onProgress?: (done: number, total: number) => void;
  /** Set once the user confirmed that the key bundle moves between keychain and passphrase. */
  acceptStorageChange?: boolean;
}): Promise<{ runtime: PersonalWorkspaceRuntime; queued: number; total: number }> {
  const draft = drafts.get(input.draftId);
  if (!draft || draft.vaultPath !== input.vaultPath || draft.expiresAt <= Date.now()) {
    if (draft) discardPreparedPersonalWorkspace(input.draftId);
    throw new Error("workspace-draft-expired");
  }
  await persistWorkspaceRuntime({
    vaultPath: input.vaultPath,
    runtime: draft.runtime,
    fingerprint: draft.fingerprint,
    recoveryConfirmedAt: draft.recoveryConfirmedAt,
    fallbackPassphrase: draft.fallbackPassphrase,
    acceptStorageChange: input.acceptStorageChange,
    phase: "setup-incomplete",
  });
  const result = await runWorkspaceMigration({
    vaultPath: input.vaultPath,
    provider: input.provider,
    rawTarget: input.rawTarget,
    rawVault: input.rawVault,
    state: input.state,
    runtime: draft.runtime,
    fingerprint: draft.fingerprint,
    recoveryConfirmedAt: draft.recoveryConfirmedAt,
    onProgress: input.onProgress,
  });
  // The draft is only forgotten once the conversion ran; until then it is the one copy of the
  // fallback passphrase a resume would need if persisting had to be repeated.
  drafts.delete(input.draftId);
  return { runtime: draft.runtime, ...result };
}

/**
 * Picks a `setup-incomplete` conversion back up, using the key bundle already on this device.
 *
 * The sweep skips what it has already encrypted, so resuming is the same call as starting.
 */
export async function resumePersonalWorkspaceSetup(input: {
  vaultPath: string;
  provider: WorkspaceProviderName;
  rawTarget: ISyncTarget;
  rawVault: IVaultAdapter;
  state: WorkspaceStateStore;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ runtime: PersonalWorkspaceRuntime; queued: number; total: number }> {
  const access = await readWorkspaceRuntime(input.vaultPath);
  if (access.state === "locked") throw new Error("workspace-locked");
  if (access.state === "absent") throw new Error("workspace-key-bundle-missing");
  const status = await getWorkspaceSecurityStatus(input.vaultPath);
  if (!status) throw new Error("workspace-key-bundle-missing");
  const result = await runWorkspaceMigration({
    vaultPath: input.vaultPath,
    provider: input.provider,
    rawTarget: input.rawTarget,
    rawVault: input.rawVault,
    state: input.state,
    runtime: access.runtime,
    fingerprint: status.fingerprint,
    recoveryConfirmedAt: status.recoveryConfirmedAt,
    onProgress: input.onProgress,
  });
  return { runtime: access.runtime, ...result };
}

async function runWorkspaceMigration(input: {
  vaultPath: string;
  provider: WorkspaceProviderName;
  rawTarget: ISyncTarget;
  rawVault: IVaultAdapter;
  state: WorkspaceStateStore;
  runtime: PersonalWorkspaceRuntime;
  fingerprint: string;
  recoveryConfirmedAt: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ queued: number; total: number }> {
  const base = {
    version: 1 as const,
    workspaceId: input.runtime.workspaceId,
    fingerprint: input.fingerprint,
    recoveryConfirmedAt: input.recoveryConfirmedAt,
    keyStorage: (await credentialManager.checkKeychainStatus()) === "native" ? ("native" as const) : ("passphrase" as const),
    deviceName: input.runtime.device.publicIdentity.displayName,
  };
  try {
    const migration = await initializePersonalWorkspaceMigration({
      store: createProviderWorkspaceObjectStore(input.provider, input.rawTarget),
      state: input.state,
      vault: input.rawVault,
      runtime: input.runtime,
      recoveryConfirmedAt: input.recoveryConfirmedAt,
      onProgress: input.onProgress,
    });
    await saveWorkspaceSecurityStatus(input.vaultPath, { ...base, phase: "migrating", lastError: null } satisfies WorkspaceSecurityPublicStatus);
    return { queued: migration.queued, total: migration.total };
  } catch (error) {
    // Resumable, not orphaned: the key bundle is on this device and the remote is reachable
    // enough to try again. `error` stays reserved for a workspace nobody here can open.
    await saveWorkspaceSecurityStatus(input.vaultPath, {
      ...base,
      phase: "setup-incomplete",
      lastError: error instanceof Error ? error.message : String(error),
    } satisfies WorkspaceSecurityPublicStatus);
    throw error;
  }
}

export function workspaceProviderName(provider: "webdav" | "drive" | "onedrive" | "dropbox" | "s3"): WorkspaceProviderName {
  return provider === "drive" ? "google-drive" : provider;
}

/** Content-shaped remote paths left from the plaintext sync mode. */
export async function listLegacyRemotePlaintext(rawTarget: ISyncTarget): Promise<string[]> {
  const listing = await rawTarget.pull();
  return [...new Set([...listing.etagMap.keys(), ...(listing.folders ?? [])])]
    .filter((path) => path !== ".pvws" && !path.startsWith(".pvws/") && path !== ".plainva" && !path.startsWith(".plainva/"))
    .filter(Boolean)
    .sort((left, right) => right.split("/").length - left.split("/").length || right.localeCompare(left));
}

export class WorkspacePlaintextCleanupIncompleteError extends Error {
  constructor(readonly deleted: number, readonly remaining: number) {
    super("workspace-plaintext-cleanup-incomplete");
    this.name = "WorkspacePlaintextCleanupIncompleteError";
  }
}

/**
 * Called only after the Security Center's explicit destructive confirmation.
 *
 * Reports progress: a large vault used to delete hundreds of remote paths in silence
 * (finding 2026-08-25, B7), and a run that leaves something behind now says how much.
 */
export async function removeLegacyRemotePlaintext(
  rawTarget: ISyncTarget,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const paths = await listLegacyRemotePlaintext(rawTarget);
  onProgress?.(0, paths.length);
  let id = 1;
  let done = 0;
  for (const path of paths) {
    await rawTarget.push({
      id: id++,
      file_path: path,
      operation: "delete",
      retry_count: 0,
      next_retry_at: 0,
      queued_at: Date.now(),
    });
    onProgress?.(++done, paths.length);
  }
  const remaining = await listLegacyRemotePlaintext(rawTarget);
  if (remaining.length) throw new WorkspacePlaintextCleanupIncompleteError(paths.length - remaining.length, remaining.length);
  return paths.length;
}
