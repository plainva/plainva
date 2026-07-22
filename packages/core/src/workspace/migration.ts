import { IVaultAdapter } from "../vault/IVaultAdapter.js";
import { encodeWorkspaceDocument, workspaceDocumentHash } from "./documents.js";
import { sha256Hex } from "./encoding.js";
import { WorkspaceObjectStore } from "./objectStore.js";
import { PersonalWorkspaceRuntime } from "./personal.js";
import { isWorkspaceLocalOnlyPath } from "./queueingVaultAdapter.js";
import { WorkspaceProtocolError, protocolAssert } from "./errors.js";
import { WorkspaceRuntimeMeta, WorkspaceStateStore } from "./state.js";

export interface PersonalWorkspaceMigrationResult {
  total: number;
  alreadyCompleted: number;
  queued: number;
}

function initialMeta(runtime: PersonalWorkspaceRuntime, recoveryConfirmedAt: string): WorkspaceRuntimeMeta {
  return {
    workspaceId: runtime.workspaceId,
    memberId: runtime.memberId,
    deviceId: runtime.device.publicIdentity.deviceId,
    groupId: runtime.ownerGroup.groupId,
    keyEpoch: runtime.ownerGroup.keyEpoch,
    policyHash: workspaceDocumentHash(runtime.policy),
    phase: "preparing",
    recoveryConfirmedAt,
    sequence: 0,
    previousOperationHash: null,
    catalogVersion: 0,
    previousCatalogHash: null,
    catalogHeads: {},
    checkpointVersion: 0,
    previousCheckpointHash: null,
    remoteHeadEtag: null,
    migrationTotal: 0,
    migrationCompleted: 0,
    migrationInventoryComplete: false,
    lastSyncAt: null,
    lastError: null,
    operationHeads: {},
    needsPublication: true,
    pendingPublication: null,
  };
}

async function putBootstrap(store: WorkspaceObjectStore, runtime: PersonalWorkspaceRuntime, signal?: AbortSignal): Promise<void> {
  const policyBytes = encodeWorkspaceDocument(runtime.policy);
  const policyHash = workspaceDocumentHash(runtime.policy);
  await store.putImmutable(`.pvws/policies/${policyHash}.pvpol`, policyBytes, policyHash, { signal });
  for (const grant of runtime.grants) {
    const bytes = encodeWorkspaceDocument(grant);
    const hash = workspaceDocumentHash(grant);
    const recipient = (grant.payload as { recipientDeviceId: string }).recipientDeviceId;
    await store.putImmutable(`.pvws/grants/${recipient}/${hash}.pvgrant`, bytes, hash, { signal });
  }
  const genesisBytes = encodeWorkspaceDocument(runtime.genesis);
  const existing = await store.get(".pvws/genesis.pvgen", { signal });
  if (existing && sha256Hex(existing) !== sha256Hex(genesisBytes)) {
    throw new WorkspaceProtocolError("conflict", "the selected remote already contains another encrypted workspace");
  }
  await store.putImmutable(".pvws/genesis.pvgen", genesisBytes, sha256Hex(genesisBytes), { signal });
}

/**
 * Builds `.pvws/` side by side and fills the durable queue. Existing remote
 * plaintext is deliberately untouched; the desktop asks for an explicit,
 * separately confirmed cleanup only after the encrypted checkpoint is active.
 */
export async function initializePersonalWorkspaceMigration(input: {
  store: WorkspaceObjectStore;
  state: WorkspaceStateStore;
  vault: IVaultAdapter;
  runtime: PersonalWorkspaceRuntime;
  recoveryConfirmedAt: string;
  signal?: AbortSignal;
}): Promise<PersonalWorkspaceMigrationResult> {
  let meta = await input.state.loadMeta();
  if (!meta) {
    meta = initialMeta(input.runtime, input.recoveryConfirmedAt);
    await input.state.saveMeta(meta);
  }
  protocolAssert(meta.workspaceId === input.runtime.workspaceId, "conflict", "local state belongs to another encrypted workspace");
  await putBootstrap(input.store, input.runtime, input.signal);
  meta.phase = "migrating";

  const inventory = (await input.vault.listDir("", true))
    .filter((entry) => entry.path && !isWorkspaceLocalOnlyPath(entry.path))
    .sort((left, right) => {
      const leftDepth = left.path.split("/").length;
      const rightDepth = right.path.split("/").length;
      return leftDepth - rightDepth || Number(right.isDirectory) - Number(left.isDirectory) || left.path.localeCompare(right.path);
    });
  let queued = 0;
  let completed = 0;
  const localPaths = new Set(inventory.map((entry) => entry.path));
  for (const entry of inventory) {
    if (input.signal?.aborted) throw new DOMException("Encrypted workspace migration aborted", "AbortError");
    const existing = await input.state.getObjectByPath(entry.path);
    if (await input.state.hasPendingForPath(entry.path)) { queued += 1; continue; }
    if (existing && !existing.deleted) {
      const unchanged = entry.isDirectory
        ? existing.contentKind === "directory"
        : existing.contentKind !== "directory" && existing.plaintextSha256 === sha256Hex(await input.vault.readBinaryFile(entry.path));
      if (unchanged) { completed += 1; continue; }
    }
    await input.state.enqueue(entry.isDirectory ? "mkdir" : "write", entry.path);
    queued += 1;
  }
  // The watcher cannot observe changes made while Plainva was closed. Reconcile
  // the durable object map against the startup inventory so offline edits and
  // deletions enter the same signed queue before the first pull.
  const missingObjects = (await input.state.listObjects()).filter((object) => !localPaths.has(object.path));
  for (const object of missingObjects) {
    if (input.signal?.aborted) throw new DOMException("Encrypted workspace migration aborted", "AbortError");
    if (await input.state.hasPendingForPath(object.path)) { queued += 1; continue; }
    await input.state.enqueue("delete", object.path);
    queued += 1;
  }
  meta.migrationTotal = inventory.length + missingObjects.length;
  meta.migrationCompleted = completed;
  meta.migrationInventoryComplete = true;
  meta.lastError = null;
  await input.state.saveMeta(meta);
  return { total: inventory.length, alreadyCompleted: completed, queued };
}
