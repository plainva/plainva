import { canonicalJson } from "../settingsSync/canonicalJson.js";
import { isTextFile } from "../sync/fileType.js";
import type { SyncProgress, SyncStatus } from "../sync/SyncWorker.js";
import { IVaultAdapter } from "../vault/IVaultAdapter.js";
import { createWorkspaceCatalog } from "./catalog.js";
import {
  encodeWorkspaceDocument,
  parseWorkspaceDocument,
  signWorkspaceDocument,
  verifyWorkspaceDocumentSignatures,
  WorkspaceDocumentSigner,
  WorkspaceOperationName,
  WorkspaceOperationPayload,
  WorkspacePolicyPayload,
  WorkspaceSignedDocument,
  workspaceDocumentHash,
} from "./documents.js";
import {
  createWorkspaceObjectId,
  createWorkspaceRevisionId,
} from "./identity.js";
import {
  decodeBase64Exact,
  fromBase64,
  sha256Hex,
  toBase64,
  utf8Encode,
} from "./encoding.js";
import { WorkspaceObjectStore } from "./objectStore.js";
import {
  openPvc1Chunk,
  openPvo1Frame,
  sealChunkedPvo1,
  sealInlinePvo1,
  splitPvo1Chunks,
  verifyChunkedPlaintextHash,
} from "./pvo1.js";
import { PersonalWorkspaceRuntime } from "./personal.js";
import { assertCanonicalVaultPath } from "./path.js";
import { protocolAssert, WorkspaceProtocolError } from "./errors.js";
import {
  PreparedWorkspaceMutation,
  WorkspaceObjectRecord,
  WorkspacePendingPublication,
  WorkspaceQueuedMutation,
  WorkspaceRevisionRecord,
  WorkspaceRuntimeMeta,
  WorkspaceStateStore,
} from "./state.js";
import { MAX_INLINE_PLAINTEXT_BYTES } from "./constants.js";

const STAGING_ROOT = ".plainva/workspace/staging";
const DEFAULT_INTERVAL_MS = 15_000;

function deviceSigner(runtime: PersonalWorkspaceRuntime): WorkspaceDocumentSigner {
  return { algorithm: "Ed25519", signerId: runtime.device.publicIdentity.deviceId, signerKind: "device" };
}

function nowIso(): string { return new Date().toISOString(); }

function operationCapability(operation: WorkspaceOperationName): WorkspaceOperationPayload["capability"] {
  switch (operation) {
    case "create": case "mkdir": return "content.create";
    case "write": case "resolve": return "content.write";
    case "rename": return "content.rename";
    case "delete": return "content.delete";
    case "comment": return "comment.create";
  }
}

function mimeForPath(path: string, directory: boolean): string {
  if (directory) return "inode/directory";
  const extension = path.split(".").pop()?.toLowerCase();
  const known: Record<string, string> = {
    md: "text/markdown", txt: "text/plain", json: "application/json", yaml: "application/yaml", yml: "application/yaml",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    pdf: "application/pdf", mp3: "audio/mpeg", mp4: "video/mp4", base: "application/yaml",
  };
  return extension ? known[extension] ?? "application/octet-stream" : "application/octet-stream";
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

function conflictPath(path: string, operationHash: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const suffix = `.CONFLICT-${operationHash.slice(0, 8)}`;
  return dot > slash ? `${path.slice(0, dot)}${suffix}${path.slice(dot)}` : `${path}${suffix}`;
}

async function listAll(store: WorkspaceObjectStore, prefix: string, signal?: AbortSignal) {
  const items: Awaited<ReturnType<WorkspaceObjectStore["list"]>>["items"] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list(prefix, cursor, { signal, pageSize: 500 });
    items.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return items;
}

export interface EncryptedWorkspaceWorkerOptions {
  intervalMs?: number;
  sideband?: () => Promise<void>;
}

/**
 * Personal encrypted-workspace pull/push engine. Immutable payloads and signed
 * operations are authoritative; mutable heads are verified acceleration only.
 * Remote absence never deletes local material.
 */
export class EncryptedWorkspaceWorker {
  private running = false;
  private syncing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private pendingImmediate = false;
  public onStatusChange?: (status: SyncStatus, error?: string) => void;
  public onProgress?: (progress: SyncProgress | null) => void;
  public onFilesChanged?: (paths: string[]) => void;

  constructor(
    private readonly objectStore: WorkspaceObjectStore,
    private readonly state: WorkspaceStateStore,
    private readonly vault: IVaultAdapter,
    private readonly runtime: PersonalWorkspaceRuntime,
    private readonly options: EncryptedWorkspaceWorkerOptions = {}
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.triggerImmediate();
  }

  stop(): void {
    this.running = false;
    this.pendingImmediate = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
  }

  async stopAndDrain(): Promise<void> {
    this.stop();
    await this.syncing?.catch(() => undefined);
  }

  triggerImmediate(): void {
    if (!this.running) return;
    if (this.syncing) { this.pendingImmediate = true; return; }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.runScheduled();
  }

  retryFailed(): void {
    void this.state.retryFailed().then(() => this.triggerImmediate());
  }

  noteUserInitiatedDeletion(_paths: string[]): void {
    // Deletes are signed tombstones and only enter this queue after the app's
    // existing deletion confirmation; no second mass-delete inference is used.
  }

  async listPendingOperations(limit = 20): Promise<{ total: number; items: Array<{ operation: string; file_path: string; retry_count: number }> }> {
    const all = await this.state.listQueue(100_000);
    return {
      total: all.length,
      items: all.slice(0, limit).map((entry) => ({ operation: entry.operation, file_path: entry.newPath ?? entry.path, retry_count: entry.retryCount })),
    };
  }

  async runCycle(signal?: AbortSignal): Promise<void> {
    await this.verifyBootstrap(signal);
    // A prepared mutation has already consumed a device sequence and is an
    // immutable local branch. Finish it before pulling so an operation uploaded
    // immediately before a crash is not mistaken for an incoming remote edit.
    await this.resumePreparedMutations(signal);
    const changed = await this.pull(signal);
    if (changed.length) this.onFilesChanged?.(changed);
    await this.push(signal);
    await this.publishCheckpoint(signal);
    await this.options.sideband?.();
    const meta = await this.requireMeta();
    meta.lastSyncAt = nowIso();
    meta.lastError = null;
    if (meta.phase === "migrating" && (await this.state.listQueue(1)).length === 0 && !meta.pendingPublication) meta.phase = "active";
    await this.state.saveMeta(meta);
  }

  private async runScheduled(): Promise<void> {
    this.abort = new AbortController();
    this.onStatusChange?.("syncing");
    this.syncing = this.runCycle(this.abort.signal).then(
      () => this.onStatusChange?.("idle"),
      async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const meta = await this.state.loadMeta().catch(() => null);
        if (meta) { meta.lastError = message.slice(0, 1000); await this.state.saveMeta(meta).catch(() => undefined); }
        if (!(error instanceof DOMException && error.name === "AbortError")) this.onStatusChange?.("error", message);
      }
    ).finally(() => {
      this.onProgress?.(null);
      this.syncing = null;
      this.abort = null;
      if (!this.running) return;
      if (this.pendingImmediate) { this.pendingImmediate = false; this.triggerImmediate(); return; }
      this.timer = setTimeout(() => this.triggerImmediate(), this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    });
    await this.syncing;
  }

  private async requireMeta(): Promise<WorkspaceRuntimeMeta> {
    const meta = await this.state.loadMeta();
    if (!meta) throw new WorkspaceProtocolError("integrity", "workspace local state is missing");
    protocolAssert(meta.workspaceId === this.runtime.workspaceId, "integrity", "workspace local state belongs to another workspace");
    return meta;
  }

  private async verifyBootstrap(signal?: AbortSignal): Promise<WorkspacePolicyPayload> {
    const expectedGenesis = encodeWorkspaceDocument(this.runtime.genesis);
    const remoteGenesis = await this.objectStore.get(".pvws/genesis.pvgen", { signal });
    protocolAssert(remoteGenesis !== null && sha256Hex(remoteGenesis) === sha256Hex(expectedGenesis), "integrity", "remote workspace genesis is missing or changed");
    const genesis = parseWorkspaceDocument(remoteGenesis);
    protocolAssert(genesis.kind === "genesis" && genesis.workspaceId === this.runtime.workspaceId, "integrity", "remote genesis binding mismatch");
    const genesisPayload = genesis.payload as typeof this.runtime.genesis.payload;
    const policyHash = (genesisPayload as { initialPolicyHash: string }).initialPolicyHash;
    const policyBytes = await this.objectStore.get(`.pvws/policies/${policyHash}.pvpol`, { signal });
    protocolAssert(policyBytes !== null && sha256Hex(policyBytes) === policyHash, "integrity", "initial policy is missing or changed");
    const policy = parseWorkspaceDocument(policyBytes);
    protocolAssert(policy.kind === "policy" && policy.workspaceId === this.runtime.workspaceId, "integrity", "remote policy binding mismatch");
    const ownerDevice = (genesis.payload as { initialOwnerDevice: { deviceId: string; signingPublicKey: string }; recovery: { recoveryId: string; signingPublicKey: string } }).initialOwnerDevice;
    const recovery = (genesis.payload as { recovery: { recoveryId: string; signingPublicKey: string } }).recovery;
    protocolAssert(verifyWorkspaceDocumentSignatures(genesis, (entry) => {
      if (entry.signerKind === "device" && entry.signerId === ownerDevice.deviceId) return decodeBase64Exact(ownerDevice.signingPublicKey, 32, "owner signing key");
      if (entry.signerKind === "recovery" && entry.signerId === recovery.recoveryId) return decodeBase64Exact(recovery.signingPublicKey, 32, "recovery signing key");
      return null;
    }), "crypto", "remote genesis signature verification failed");
    const payload = policy.payload as WorkspacePolicyPayload;
    protocolAssert(verifyWorkspaceDocumentSignatures(policy, (entry) => {
      if (entry.signerKind === "recovery" && entry.signerId === recovery.recoveryId) return decodeBase64Exact(recovery.signingPublicKey, 32, "recovery signing key");
      const device = payload.devices.find((candidate) => candidate.deviceId === entry.signerId);
      return device ? decodeBase64Exact(device.signingPublicKey, 32, "device signing key") : null;
    }), "crypto", "remote policy signature verification failed");
    return payload;
  }

  private async pull(signal?: AbortSignal): Promise<string[]> {
    const policy = await this.verifyBootstrap(signal);
    const meta = await this.requireMeta();
    const operationInfos = await listAll(this.objectStore, ".pvws/operations/", signal);
    const operations: Array<{ document: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>; hash: string }> = [];
    for (const info of operationInfos) {
      const bytes = await this.objectStore.get(info.key, { signal });
      protocolAssert(bytes !== null, "conflict", "operation disappeared during pull");
      const parsed = parseWorkspaceDocument(bytes);
      protocolAssert(parsed.kind === "operation" && parsed.workspaceId === meta.workspaceId, "integrity", "operation workspace binding mismatch");
      const document = parsed as WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>;
      const hash = workspaceDocumentHash(document);
      protocolAssert(info.key.endsWith(`-${hash}.pvop`), "integrity", "operation path hash mismatch");
      const device = policy.devices.find((entry) => entry.deviceId === document.payload.deviceId && entry.memberId === document.payload.memberId && entry.state === "active");
      protocolAssert(!!device, "authorization", "operation author is not an active policy device");
      protocolAssert(document.payload.policyHash === meta.policyHash, "authorization", "operation uses an unaccepted policy");
      protocolAssert(policy.assignments.some((entry) => entry.subjectKind === "member" && entry.subjectId === device.memberId && entry.scopeKind === "workspace" && entry.capabilities.includes(document.payload.capability)), "authorization", "operation capability is not granted");
      protocolAssert(verifyWorkspaceDocumentSignatures(document, (entry) => entry.signerId === device.deviceId ? decodeBase64Exact(device.signingPublicKey, 32, "device signing key") : null), "crypto", "operation signature verification failed");
      operations.push({ document, hash });
    }
    this.validateDeviceChains(operations);

    const pending = operations.sort((left, right) => left.hash.localeCompare(right.hash));
    const changed: string[] = [];
    let progress = true;
    while (pending.length && progress) {
      progress = false;
      for (let index = 0; index < pending.length;) {
        const entry = pending[index];
        if (await this.state.hasOperation(entry.hash)) { pending.splice(index, 1); progress = true; continue; }
        const parentsKnown = await Promise.all(entry.document.payload.parentRevisionIds.map((parent) => this.state.getRevision(parent)));
        if (parentsKnown.some((parent) => !parent)) { index += 1; continue; }
        const appliedPaths = await this.applyIncoming(entry.document, entry.hash, meta, signal);
        changed.push(...appliedPaths);
        pending.splice(index, 1);
        progress = true;
      }
    }
    protocolAssert(pending.length === 0, "integrity", "operation graph contains missing revision parents");
    await this.verifyRemoteHeads(meta, policy, signal);
    return changed;
  }

  private validateDeviceChains(operations: Array<{ document: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>; hash: string }>): void {
    const byDevice = new Map<string, Array<{ document: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>; hash: string }>>();
    for (const operation of operations) {
      const items = byDevice.get(operation.document.payload.deviceId) ?? [];
      items.push(operation);
      byDevice.set(operation.document.payload.deviceId, items);
    }
    for (const items of byDevice.values()) {
      items.sort((left, right) => left.document.payload.sequence - right.document.payload.sequence);
      for (let index = 0; index < items.length; index += 1) {
        protocolAssert(items[index].document.payload.sequence === index + 1, "integrity", "device operation sequence has a gap");
        protocolAssert(items[index].document.payload.previousDeviceOperationHash === (index === 0 ? null : items[index - 1].hash), "integrity", "device operation predecessor mismatch");
      }
    }
  }

  private async applyIncoming(
    document: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>,
    operationHash: string,
    meta: WorkspaceRuntimeMeta,
    signal?: AbortSignal
  ): Promise<string[]> {
    const operation = document.payload;
    const current = await this.state.getObjectById(operation.objectId);
    const incomingHead = { sequence: operation.sequence, operationHash };
    meta.operationHeads[operation.deviceId] = incomingHead;
    meta.needsPublication = true;
    if (operation.operation === "delete") {
      const setCurrent = !!current && !!current.currentRevisionId && operation.parentRevisionIds.includes(current.currentRevisionId);
      if (setCurrent && current) await this.materializeDelete(current, operationHash);
      const object: WorkspaceObjectRecord = current
        ? { ...current, currentRevisionId: null, payloadHash: null, deleted: true, modifiedAt: operation.createdAt }
        : { objectId: operation.objectId, path: `deleted-${operation.objectId}`, currentRevisionId: null, payloadHash: null, plaintextSha256: null, contentKind: "binary", deleted: true, createdAt: operation.createdAt, modifiedAt: operation.createdAt };
      await this.state.recordIncoming({ object, revision: null, operationHash, operationDocument: toBase64(encodeWorkspaceDocument(document)), deviceId: operation.deviceId, sequence: operation.sequence }, setCurrent, meta);
      return setCurrent ? [object.path] : [];
    }

    protocolAssert(operation.payloadHash !== null && operation.revisionId !== null, "integrity", "content operation is missing payload references");
    const objectKey = `.pvws/objects/${operation.objectId}/${operation.payloadHash}.pvobj`;
    const objectBytes = await this.objectStore.get(objectKey, { signal });
    protocolAssert(objectBytes !== null && sha256Hex(objectBytes) === operation.payloadHash, "integrity", "operation payload object is missing or changed");
    const opened = await openPvo1Frame(objectBytes, [{ groupId: this.runtime.ownerGroup.groupId, keyEpoch: this.runtime.ownerGroup.keyEpoch, privateKey: this.runtime.ownerGroup.hpke.privateKey }]);
    protocolAssert(opened.workspaceId === meta.workspaceId && opened.objectId === operation.objectId && opened.revisionId === operation.revisionId, "integrity", "PVO1 operation binding mismatch");
    let plaintext = opened.plaintext;
    if (!plaintext && opened.manifest) {
      const chunks: Uint8Array[] = [];
      for (const reference of opened.manifest.chunks) {
        const chunkKey = `.pvws/chunks/${operation.objectId}/${operation.revisionId}/${reference.index}-${reference.sha256}.pvchunk`;
        const chunkBytes = await this.objectStore.get(chunkKey, { signal });
        protocolAssert(chunkBytes !== null, "integrity", "PVO1 chunk is missing");
        chunks.push(openPvc1Chunk({ bytes: chunkBytes, expected: reference, frame: opened }));
      }
      protocolAssert(verifyChunkedPlaintextHash(opened, chunks), "integrity", "chunked plaintext hash mismatch");
      plaintext = joinChunks(chunks);
    }
    protocolAssert(plaintext !== undefined, "integrity", "PVO1 payload did not yield plaintext");
    const targetPath = assertCanonicalVaultPath(opened.metadata.path);
    const isDirectory = opened.metadata.mime === "inode/directory";
    const fastForward = !current || (current.currentRevisionId !== null && operation.parentRevisionIds.includes(current.currentRevisionId));
    const pathOwner = await this.state.getObjectByPath(targetPath);
    const pathCollision = !!pathOwner && pathOwner.objectId !== operation.objectId && !pathOwner.deleted;
    const locallyChanged = current ? await this.localContentChanged(current) : false;
    const pendingLocal = current ? await this.state.hasPendingForPath(current.path) : false;
    const setCurrent = fastForward && !pathCollision && !locallyChanged && !pendingLocal;
    const materializedPath = setCurrent ? targetPath : conflictPath(targetPath, operationHash);
    await this.materializeContent(current, materializedPath, plaintext, isDirectory, setCurrent);
    const object: WorkspaceObjectRecord = {
      objectId: operation.objectId,
      path: targetPath,
      currentRevisionId: operation.revisionId,
      payloadHash: operation.payloadHash,
      plaintextSha256: opened.metadata.plaintextSha256,
      contentKind: isDirectory ? "directory" : opened.metadata.contentKind,
      deleted: false,
      createdAt: opened.metadata.createdAt,
      modifiedAt: opened.metadata.modifiedAt,
    };
    const revision: WorkspaceRevisionRecord = {
      revisionId: operation.revisionId,
      objectId: operation.objectId,
      payloadHash: operation.payloadHash,
      parentRevisionIds: operation.parentRevisionIds,
      operationHash,
      deviceId: operation.deviceId,
      sequence: operation.sequence,
      materializedPath,
      plaintextSha256: opened.metadata.plaintextSha256,
    };
    await this.state.recordIncoming({ object, revision, operationHash, operationDocument: toBase64(encodeWorkspaceDocument(document)), deviceId: operation.deviceId, sequence: operation.sequence }, setCurrent, meta);
    return setCurrent && current && current.path !== materializedPath
      ? [current.path, materializedPath]
      : [materializedPath];
  }

  private async localContentChanged(object: WorkspaceObjectRecord): Promise<boolean> {
    if (object.deleted || !(await this.vault.exists(object.path))) return false;
    if (object.contentKind === "directory") return false;
    if (!object.plaintextSha256) return true;
    return sha256Hex(await this.vault.readBinaryFile(object.path)) !== object.plaintextSha256;
  }

  private async materializeContent(current: WorkspaceObjectRecord | null, path: string, plaintext: Uint8Array, directory: boolean, replaceCurrent: boolean): Promise<void> {
    if (directory) {
      await this.vault.createDir(path);
      return;
    }
    if (replaceCurrent && current && current.path !== path && await this.vault.exists(current.path) && !(await this.vault.exists(path))) {
      await this.vault.renameItem(current.path, path);
    }
    await this.vault.writeBinaryFile(path, plaintext);
  }

  private async materializeDelete(current: WorkspaceObjectRecord, operationHash: string): Promise<void> {
    if (!(await this.vault.exists(current.path))) return;
    if (await this.localContentChanged(current) || await this.state.hasPendingForPath(current.path)) {
      const preserved = conflictPath(current.path, operationHash);
      await this.vault.renameItem(current.path, preserved);
      return;
    }
    await this.vault.deleteItem(current.path, current.contentKind === "directory");
  }

  private async push(signal?: AbortSignal): Promise<void> {
    let queue = await this.state.listQueue(100_000);
    const absorbed = new Set<number>();
    let current = 0;
    for (const item of queue) {
      if (absorbed.has(item.id)) continue;
      if (signal?.aborted) throw new DOMException("Encrypted workspace push aborted", "AbortError");
      this.onProgress?.({ phase: "push", current: ++current, total: queue.length });
      try {
        let prepared = item.prepared;
        if (!prepared) prepared = await this.prepareMutation(item, queue);
        if (!prepared) { await this.state.discardQueue(item.id); continue; }
        for (const queueId of prepared.absorbedQueueIds) absorbed.add(queueId);
        await this.uploadPrepared(item, prepared, signal);
      } catch (error) {
        await this.state.markQueueFailed(item.id, error instanceof Error ? error.message : String(error));
        throw error;
      }
    }
    queue = await this.state.listQueue(1);
    if (queue.length === 0) this.onProgress?.(null);
  }

  private async resumePreparedMutations(signal?: AbortSignal): Promise<void> {
    const queue = await this.state.listQueue(100_000);
    const absorbed = new Set<number>();
    for (const item of queue) {
      if (absorbed.has(item.id) || !item.prepared) continue;
      for (const queueId of item.prepared.absorbedQueueIds ?? []) absorbed.add(queueId);
      await this.uploadPrepared(item, { ...item.prepared, absorbedQueueIds: item.prepared.absorbedQueueIds ?? [] }, signal);
    }
  }

  private async resolveRenameChain(
    item: WorkspaceQueuedMutation,
    queue: WorkspaceQueuedMutation[]
  ): Promise<{ item: WorkspaceQueuedMutation; absorbedQueueIds: number[] }> {
    if (item.operation !== "rename" || !item.newPath) return { item, absorbedQueueIds: [] };
    let destination = item.newPath;
    const absorbedQueueIds: number[] = [];
    const seen = new Set([item.path]);
    while (!(await this.vault.exists(destination))) {
      protocolAssert(!seen.has(destination), "conflict", "workspace rename queue contains a cycle");
      seen.add(destination);
      const next = queue.find((candidate) =>
        candidate.id > item.id && !candidate.prepared && !absorbedQueueIds.includes(candidate.id) &&
        candidate.path === destination && (candidate.operation === "rename" || candidate.operation === "delete")
      );
      if (!next) break;
      absorbedQueueIds.push(next.id);
      if (next.operation === "delete") {
        return { item: { ...item, operation: "delete", newPath: null }, absorbedQueueIds };
      }
      protocolAssert(!!next.newPath, "format", "rename queue item is missing its destination");
      destination = next.newPath;
    }
    return { item: { ...item, newPath: destination }, absorbedQueueIds };
  }

  private async prepareMutation(item: WorkspaceQueuedMutation, queue: WorkspaceQueuedMutation[]): Promise<PreparedWorkspaceMutation | null> {
    const resolved = await this.resolveRenameChain(item, queue);
    item = resolved.item;
    const meta = await this.requireMeta();
    const source = await this.state.getObjectByPath(item.path);
    const targetPath = item.operation === "rename" ? item.newPath : item.path;
    if (!targetPath) throw new WorkspaceProtocolError("format", "rename queue item is missing its destination");
    if (item.operation === "delete" && !source?.currentRevisionId) return null;
    if (item.operation !== "delete" && !(await this.vault.exists(targetPath))) return null;
    const info = item.operation === "delete" ? null : await this.vault.getFileInfo(targetPath);
    const directory = item.operation === "mkdir" || info?.isDirectory === true;
    const objectId = source?.objectId ?? createWorkspaceObjectId();
    const revisionId = item.operation === "delete" ? null : createWorkspaceRevisionId();
    const plaintext = item.operation === "delete" || directory ? new Uint8Array() : await this.vault.readBinaryFile(targetPath);
    const createdAt = source?.createdAt ?? nowIso();
    const modifiedAt = nowIso();
    let objectLocalPath: string | null = null;
    let objectRemoteKey: string | null = null;
    let objectSha256: string | null = null;
    const chunks: PreparedWorkspaceMutation["chunks"] = [];
    if (revisionId) {
      const metadata = {
        path: assertCanonicalVaultPath(targetPath),
        mime: mimeForPath(targetPath, directory),
        parentObjectId: null,
        createdAt,
        modifiedAt,
        contentKind: (directory || isTextFile(targetPath) ? "text" : "binary") as "text" | "binary",
      };
      let objectBytes: Uint8Array;
      if (plaintext.length <= MAX_INLINE_PLAINTEXT_BYTES) {
        objectBytes = await sealInlinePvo1({
          workspaceId: meta.workspaceId,
          objectId,
          revisionId,
          recipients: [{ groupId: this.runtime.ownerGroup.groupId, keyEpoch: this.runtime.ownerGroup.keyEpoch, publicKey: this.runtime.ownerGroup.hpke.publicKey }],
          metadata,
          plaintext,
        });
      } else {
        const sealed = await sealChunkedPvo1({
          workspaceId: meta.workspaceId,
          objectId,
          revisionId,
          recipients: [{ groupId: this.runtime.ownerGroup.groupId, keyEpoch: this.runtime.ownerGroup.keyEpoch, publicKey: this.runtime.ownerGroup.hpke.publicKey }],
          metadata,
          chunks: splitPvo1Chunks(plaintext),
        });
        objectBytes = sealed.object;
        await this.vault.createDir(`${STAGING_ROOT}/${revisionId}/chunks`);
        for (let index = 0; index < sealed.chunks.length; index += 1) {
          const sha = sealed.manifest.chunks[index].sha256;
          const localPath = `${STAGING_ROOT}/${revisionId}/chunks/${index}-${sha}.pvchunk`;
          await this.vault.writeBinaryFile(localPath, sealed.chunks[index]);
          chunks.push({ localPath, remoteKey: `.pvws/chunks/${objectId}/${revisionId}/${index}-${sha}.pvchunk`, sha256: sha });
        }
      }
      objectSha256 = sha256Hex(objectBytes);
      objectLocalPath = `${STAGING_ROOT}/${revisionId}/${objectSha256}.pvobj`;
      objectRemoteKey = `.pvws/objects/${objectId}/${objectSha256}.pvobj`;
      await this.vault.createDir(`${STAGING_ROOT}/${revisionId}`);
      await this.vault.writeBinaryFile(objectLocalPath, objectBytes);
    }
    const operationName: WorkspaceOperationName = item.operation === "write"
      ? source ? "write" : "create"
      : item.operation === "mkdir"
        ? source ? "write" : "mkdir"
        : item.operation === "rename" && !source
          ? directory ? "mkdir" : "create"
          : item.operation;
    const sequence = meta.sequence + 1;
    const payload: WorkspaceOperationPayload = {
      operationId: createWorkspaceObjectId(),
      deviceId: meta.deviceId,
      memberId: meta.memberId,
      sequence,
      previousDeviceOperationHash: meta.previousOperationHash,
      policyHash: meta.policyHash,
      capability: operationCapability(operationName),
      operation: operationName,
      objectId,
      revisionId,
      parentRevisionIds: source?.currentRevisionId ? [source.currentRevisionId] : [],
      payloadHash: objectSha256,
      createdAt: modifiedAt,
    };
    const operationDocument = signWorkspaceDocument(
      { kind: "operation", protocolVersion: 1, workspaceId: meta.workspaceId, payload },
      deviceSigner(this.runtime),
      this.runtime.device.secrets.signing.privateKey
    );
    const operationHash = workspaceDocumentHash(operationDocument);
    const object: WorkspaceObjectRecord = item.operation === "delete"
      ? { ...source!, currentRevisionId: null, payloadHash: null, plaintextSha256: null, deleted: true, modifiedAt }
      : {
          objectId,
          path: targetPath,
          currentRevisionId: revisionId,
          payloadHash: objectSha256,
          plaintextSha256: sha256Hex(plaintext),
          contentKind: directory ? "directory" : isTextFile(targetPath) ? "text" : "binary",
          deleted: false,
          createdAt,
          modifiedAt,
        };
    const revision: WorkspaceRevisionRecord | null = revisionId ? {
      revisionId,
      objectId,
      payloadHash: objectSha256,
      parentRevisionIds: payload.parentRevisionIds,
      operationHash,
      deviceId: meta.deviceId,
      sequence,
      materializedPath: targetPath,
      plaintextSha256: sha256Hex(plaintext),
    } : null;
    const prepared: PreparedWorkspaceMutation = {
      operationHash,
      operationDocument: toBase64(encodeWorkspaceDocument(operationDocument)),
      operationRemoteKey: `.pvws/operations/${meta.deviceId}/${sequence}-${operationHash}.pvop`,
      objectRemoteKey,
      objectLocalPath,
      objectSha256,
      chunks,
      absorbedQueueIds: resolved.absorbedQueueIds,
      object,
      revision,
    };
    meta.sequence = sequence;
    meta.previousOperationHash = operationHash;
    meta.operationHeads[meta.deviceId] = { sequence, operationHash };
    await this.state.reservePrepared(item.id, prepared, meta);
    return prepared;
  }

  private async uploadPrepared(item: WorkspaceQueuedMutation, prepared: PreparedWorkspaceMutation, signal?: AbortSignal): Promise<void> {
    for (const chunk of prepared.chunks) {
      const bytes = await this.vault.readBinaryFile(chunk.localPath);
      await this.objectStore.putImmutable(chunk.remoteKey, bytes, chunk.sha256, { signal });
    }
    if (prepared.objectLocalPath && prepared.objectRemoteKey && prepared.objectSha256) {
      const bytes = await this.vault.readBinaryFile(prepared.objectLocalPath);
      await this.objectStore.putImmutable(prepared.objectRemoteKey, bytes, prepared.objectSha256, { signal });
    }
    const operationBytes = fromBase64(prepared.operationDocument);
    await this.objectStore.putImmutable(prepared.operationRemoteKey, operationBytes, prepared.operationHash, { signal });
    const meta = await this.requireMeta();
    if (meta.phase === "migrating") meta.migrationCompleted = Math.min(meta.migrationTotal, meta.migrationCompleted + 1);
    meta.needsPublication = true;
    await this.state.commitQueued(item.id, {
      object: prepared.object,
      revision: prepared.revision,
      operationHash: prepared.operationHash,
      operationDocument: prepared.operationDocument,
      deviceId: meta.deviceId,
      sequence: prepared.revision?.sequence ?? meta.sequence,
    }, meta, prepared.absorbedQueueIds ?? []);
    if (prepared.objectLocalPath) {
      const folder = prepared.objectLocalPath.split("/").slice(0, -1).join("/");
      await this.vault.deleteItem(folder, true).catch(() => undefined);
    }
  }

  private async publishCheckpoint(signal?: AbortSignal): Promise<void> {
    const meta = await this.requireMeta();
    if (!meta.needsPublication && !meta.pendingPublication) return;
    if (!meta.pendingPublication) meta.pendingPublication = await this.preparePublication(meta);
    await this.state.saveMeta(meta);
    const publication = meta.pendingPublication;
    await this.objectStore.putImmutable(publication.catalogRemoteKey, fromBase64(publication.catalogDocument), publication.catalogHash, { signal });
    await this.objectStore.putImmutable(publication.checkpointRemoteKey, fromBase64(publication.checkpointDocument), publication.checkpointHash, { signal });
    if (publication.headDocument && publication.headRemoteKey) {
      const headBytes = fromBase64(publication.headDocument);
      const result = await this.objectStore.compareAndSwapPointer(publication.headRemoteKey, headBytes, meta.remoteHeadEtag, { signal });
      if (!result.swapped) {
        const current = await this.objectStore.get(publication.headRemoteKey, { signal });
        protocolAssert(current !== null && sha256Hex(current) === sha256Hex(headBytes), "conflict", "workspace head changed concurrently");
      }
      meta.remoteHeadEtag = result.etag ?? (await this.objectStore.head(publication.headRemoteKey, { signal }))?.etag ?? null;
    }
    meta.catalogVersion = publication.catalogVersion;
    meta.previousCatalogHash = publication.catalogHash;
    meta.checkpointVersion = publication.checkpointVersion;
    meta.previousCheckpointHash = publication.checkpointHash;
    meta.pendingPublication = null;
    meta.needsPublication = false;
    await this.state.saveMeta(meta);
  }

  private async preparePublication(meta: WorkspaceRuntimeMeta): Promise<WorkspacePendingPublication> {
    const refs = (await this.state.listObjects())
      .filter((object) => object.currentRevisionId && object.payloadHash)
      .map((object) => ({ objectId: object.objectId, revisionId: object.currentRevisionId!, payloadHash: object.payloadHash! }))
      .sort((left, right) => `${left.objectId}:${left.revisionId}:${left.payloadHash}`.localeCompare(`${right.objectId}:${right.revisionId}:${right.payloadHash}`));
    const catalogVersion = meta.catalogVersion + 1;
    const catalog = createWorkspaceCatalog({
      workspaceId: meta.workspaceId,
      groupId: meta.groupId,
      keyEpoch: meta.keyEpoch,
      catalogVersion,
      previousCatalogHash: meta.previousCatalogHash,
      catalogKey: this.runtime.ownerGroup.catalogKey,
      objectRefs: refs,
      signer: deviceSigner(this.runtime),
      signerPrivateKey: this.runtime.device.secrets.signing.privateKey,
    });
    const catalogHash = workspaceDocumentHash(catalog);
    const checkpointVersion = meta.checkpointVersion + 1;
    const operationHeads = Object.entries(meta.operationHeads)
      .map(([deviceId, value]) => ({ deviceId, sequence: value.sequence, operationHash: value.operationHash }))
      .sort((left, right) => left.deviceId.localeCompare(right.deviceId));
    const checkpoint = signWorkspaceDocument({
      kind: "checkpoint",
      protocolVersion: 1,
      workspaceId: meta.workspaceId,
      payload: {
        checkpointVersion,
        policyHash: meta.policyHash,
        operationHeads,
        objectRootHash: sha256Hex(utf8Encode(canonicalJson(refs))),
        createdAt: nowIso(),
      },
    }, deviceSigner(this.runtime), this.runtime.device.secrets.signing.privateKey);
    const checkpointHash = workspaceDocumentHash(checkpoint);
    const ownHead = meta.operationHeads[meta.deviceId];
    const head = ownHead ? signWorkspaceDocument({
      kind: "head",
      protocolVersion: 1,
      workspaceId: meta.workspaceId,
      payload: { deviceId: meta.deviceId, sequence: ownHead.sequence, operationHash: ownHead.operationHash, checkpointHash },
    }, deviceSigner(this.runtime), this.runtime.device.secrets.signing.privateKey) : null;
    return {
      catalogHash,
      catalogDocument: toBase64(encodeWorkspaceDocument(catalog)),
      catalogRemoteKey: `.pvws/catalogs/${meta.groupId}/${meta.keyEpoch}/${catalogHash}.pvcat`,
      checkpointHash,
      checkpointDocument: toBase64(encodeWorkspaceDocument(checkpoint)),
      checkpointRemoteKey: `.pvws/checkpoints/${checkpointHash}.pvcheck`,
      headDocument: head ? toBase64(encodeWorkspaceDocument(head)) : null,
      headRemoteKey: head ? `.pvws/heads/${meta.deviceId}.pvhead` : null,
      operationHash: ownHead?.operationHash ?? null,
      sequence: ownHead?.sequence ?? 0,
      catalogVersion,
      checkpointVersion,
    };
  }

  private async verifyRemoteHeads(meta: WorkspaceRuntimeMeta, policy: WorkspacePolicyPayload, signal?: AbortSignal): Promise<void> {
    const infos = await listAll(this.objectStore, ".pvws/heads/", signal);
    const seen = new Set<string>();
    for (const info of infos) {
      const bytes = await this.objectStore.get(info.key, { signal });
      protocolAssert(bytes !== null, "conflict", "workspace head disappeared during pull");
      const parsed = parseWorkspaceDocument(bytes);
      protocolAssert(parsed.kind === "head" && parsed.workspaceId === meta.workspaceId, "integrity", "workspace head binding mismatch");
      const payload = parsed.payload as { deviceId: string; sequence: number; operationHash: string; checkpointHash: string | null };
      const device = policy.devices.find((entry) => entry.deviceId === payload.deviceId);
      protocolAssert(!!device && verifyWorkspaceDocumentSignatures(parsed, (entry) => entry.signerId === device.deviceId ? decodeBase64Exact(device.signingPublicKey, 32, "head signing key") : null), "crypto", "workspace head signature verification failed");
      const observed = meta.operationHeads[payload.deviceId];
      protocolAssert(!observed || payload.sequence >= observed.sequence, "rollback", "remote workspace head rolled back below the locally observed sequence");
      protocolAssert(await this.state.hasOperation(payload.operationHash), "integrity", "workspace head references an unavailable operation");
      if (payload.checkpointHash) {
        const checkpointBytes = await this.objectStore.get(`.pvws/checkpoints/${payload.checkpointHash}.pvcheck`, { signal });
        protocolAssert(checkpointBytes !== null && sha256Hex(checkpointBytes) === payload.checkpointHash, "integrity", "workspace head checkpoint is missing or changed");
        const checkpoint = parseWorkspaceDocument(checkpointBytes);
        protocolAssert(checkpoint.kind === "checkpoint" && verifyWorkspaceDocumentSignatures(checkpoint, (entry) => {
          if (entry.signerKind === "device") {
            const signerDevice = policy.devices.find((candidate) => candidate.deviceId === entry.signerId);
            return signerDevice ? decodeBase64Exact(signerDevice.signingPublicKey, 32, "checkpoint signing key") : null;
          }
          return null;
        }), "crypto", "workspace checkpoint signature verification failed");
      }
      meta.operationHeads[payload.deviceId] = { sequence: payload.sequence, operationHash: payload.operationHash };
      seen.add(payload.deviceId);
    }
    if (meta.phase === "active") {
      for (const [deviceId, head] of Object.entries(meta.operationHeads)) {
        if (head.sequence > 0) protocolAssert(seen.has(deviceId), "rollback", "previously observed workspace head is missing");
      }
    }
    await this.state.saveMeta(meta);
  }
}
