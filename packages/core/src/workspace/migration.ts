import { IVaultAdapter } from "../vault/IVaultAdapter.js";
import { encodeWorkspaceDocument, workspaceDocumentHash } from "./documents.js";
import { sha256Hex } from "./encoding.js";
import { WorkspaceObjectStore } from "./objectStore.js";
import { PersonalWorkspaceRuntime } from "./personal.js";
import { isWorkspaceLocalOnlyPath } from "./queueingVaultAdapter.js";
import { WorkspaceProtocolError, protocolAssert } from "./errors.js";
import { WorkspaceLocalProbe, WorkspaceRuntimeMeta, WorkspaceStateStore } from "./state.js";

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
  /** Reports queue-building progress over the vault inventory so the first-run
   * setup UI can show a determinate bar while every file is hashed. */
  onProgress?: (done: number, total: number) => void;
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
  let processed = 0;
  const progressStep = Math.max(1, Math.ceil(inventory.length / 100));
  input.onProgress?.(0, inventory.length);
  const localPaths = new Set(inventory.map((entry) => entry.path));
  // Per-RUN lookups instead of per-file round-trips (the indexer's bulk-pass
  // treatment): one object map, one pending-path set, one probe map.
  const objectsByPath = new Map((await input.state.listObjects(true)).map((object) => [object.path, object]));
  const pendingPaths = new Set(await input.state.listQueuedPaths());
  const probesByPath = new Map((await input.state.listLocalProbes()).map((probe) => [probe.path, probe]));
  const probeUpserts: WorkspaceLocalProbe[] = [];
  for (const entry of inventory) {
    if (input.signal?.aborted) throw new DOMException("Encrypted workspace migration aborted", "AbortError");
    processed += 1;
    if (processed === inventory.length || processed % progressStep === 0) input.onProgress?.(processed, inventory.length);
    const existing = objectsByPath.get(entry.path);
    if (pendingPaths.has(entry.path)) { queued += 1; continue; }
    if (existing && !existing.deleted) {
      let unchanged: boolean;
      if (entry.isDirectory) {
        unchanged = existing.contentKind === "directory";
      } else if (existing.contentKind === "directory") {
        unchanged = false;
      } else {
        // mtime skip: a probe that still matches the stat (mtime AND size, and a
        // real mtime — network mounts may report 0) carries the plaintext hash,
        // so unchanged files cost no read. Anything else falls back to hashing
        // once and refreshes the probe for the next open.
        const probe = probesByPath.get(entry.path);
        let sha: string;
        if (probe && entry.mtime > 0 && probe.mtime === entry.mtime && probe.size === entry.size) {
          sha = probe.plaintextSha256;
        } else {
          sha = sha256Hex(await input.vault.readBinaryFile(entry.path));
          probeUpserts.push({ path: entry.path, mtime: entry.mtime, size: entry.size, plaintextSha256: sha });
        }
        unchanged = existing.plaintextSha256 === sha;
      }
      if (unchanged) { completed += 1; continue; }
    }
    await input.state.enqueue(entry.isDirectory ? "mkdir" : "write", entry.path);
    queued += 1;
  }
  // The watcher cannot observe changes made while Plainva was closed. Reconcile
  // the durable object map against the startup inventory so offline edits and
  // deletions enter the same signed queue before the first pull.
  const missingObjects = [...objectsByPath.values()].filter((object) => !object.deleted && !localPaths.has(object.path));
  for (const object of missingObjects) {
    if (input.signal?.aborted) throw new DOMException("Encrypted workspace migration aborted", "AbortError");
    if (pendingPaths.has(object.path)) { queued += 1; continue; }
    await input.state.enqueue("delete", object.path);
    queued += 1;
  }
  const staleProbes = [...probesByPath.keys()].filter((path) => !localPaths.has(path));
  if (probeUpserts.length) await input.state.upsertLocalProbes(probeUpserts);
  if (staleProbes.length) await input.state.deleteLocalProbes(staleProbes);
  meta.migrationTotal = inventory.length + missingObjects.length;
  meta.migrationCompleted = completed;
  meta.migrationInventoryComplete = true;
  meta.lastError = null;
  await input.state.saveMeta(meta);
  return { total: inventory.length, alreadyCompleted: completed, queued };
}
