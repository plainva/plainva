import {
  createPersonalWorkspaceBootstrap,
  createProviderWorkspaceObjectStore,
  createWorkspaceRecoveryPackage,
  initializePersonalWorkspaceMigration,
  personalWorkspaceRuntime,
  workspaceDocumentHash,
  type ISyncTarget,
  type IVaultAdapter,
  type PersonalWorkspaceRuntime,
  type WorkspaceProviderName,
  type WorkspaceStateStore,
} from "@plainva/core";
import { credentialManager } from "../CredentialManager";
import {
  persistWorkspaceRuntime,
  saveWorkspaceSecurityStatus,
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
  draft.runtime.device.secrets.signing.privateKey.fill(0);
  draft.runtime.device.secrets.hpke.privateKey.fill(0);
  draft.runtime.ownerGroup.hpke.privateKey.fill(0);
  draft.runtime.ownerGroup.catalogKey.fill(0);
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
  if (keychainMode === "fallback" && (!input.fallbackPassphrase || input.fallbackPassphrase.length < 10)) {
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

export async function activatePreparedPersonalWorkspace(input: {
  draftId: string;
  vaultPath: string;
  provider: WorkspaceProviderName;
  rawTarget: ISyncTarget;
  rawVault: IVaultAdapter;
  state: WorkspaceStateStore;
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
  });
  try {
    const migration = await initializePersonalWorkspaceMigration({
      store: createProviderWorkspaceObjectStore(input.provider, input.rawTarget),
      state: input.state,
      vault: input.rawVault,
      runtime: draft.runtime,
      recoveryConfirmedAt: draft.recoveryConfirmedAt,
    });
    const status: WorkspaceSecurityPublicStatus = {
      version: 1,
      workspaceId: draft.runtime.workspaceId,
      fingerprint: draft.fingerprint,
      phase: "migrating",
      recoveryConfirmedAt: draft.recoveryConfirmedAt,
      keyStorage: await credentialManager.checkKeychainStatus() === "native" ? "native" : "passphrase",
      deviceName: draft.runtime.device.publicIdentity.displayName,
      lastError: null,
    };
    await saveWorkspaceSecurityStatus(input.vaultPath, status);
    drafts.delete(input.draftId);
    return { runtime: draft.runtime, queued: migration.queued, total: migration.total };
  } catch (error) {
    await saveWorkspaceSecurityStatus(input.vaultPath, {
      version: 1,
      workspaceId: draft.runtime.workspaceId,
      fingerprint: draft.fingerprint,
      phase: "error",
      recoveryConfirmedAt: draft.recoveryConfirmedAt,
      keyStorage: await credentialManager.checkKeychainStatus() === "native" ? "native" : "passphrase",
      deviceName: draft.runtime.device.publicIdentity.displayName,
      lastError: error instanceof Error ? error.message : String(error),
    });
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

/** Called only after the Security Center's explicit destructive confirmation. */
export async function removeLegacyRemotePlaintext(rawTarget: ISyncTarget): Promise<number> {
  const paths = await listLegacyRemotePlaintext(rawTarget);
  let id = 1;
  for (const path of paths) {
    await rawTarget.push({
      id: id++,
      file_path: path,
      operation: "delete",
      retry_count: 0,
      next_retry_at: 0,
      queued_at: Date.now(),
    });
  }
  const remaining = await listLegacyRemotePlaintext(rawTarget);
  if (remaining.length) throw new Error("workspace-plaintext-cleanup-incomplete");
  return paths.length;
}
