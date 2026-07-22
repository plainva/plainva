import { canonicalJson } from "../settingsSync/canonicalJson.js";
import type { WorkspaceObjectStore } from "./objectStore.js";
import { createWorkspaceObjectId, createWorkspaceRevisionId, type WorkspaceGroupKeyEpoch } from "./identity.js";
import { encodeWorkspaceDocument, signWorkspaceDocument, workspaceDocumentHash, type WorkspaceOperationPayload, type WorkspaceSignedDocument } from "./documents.js";
import { openPvc1Chunk, openPvo1Frame, sealInlinePvo1, verifyChunkedPlaintextHash, type Pvo1Recipient } from "./pvo1.js";
import { protocolAssert, WorkspaceProtocolError } from "./errors.js";
import { fromBase64, sha256Hex, toBase64, utf8DecodeFatal, utf8Encode } from "./encoding.js";
import type { PersonalWorkspaceRuntime } from "./personal.js";
import type { WorkspaceCommentRecord, WorkspaceQuarantineStatus, WorkspaceRevisionRecord, WorkspaceRuntimeMeta, WorkspaceStateStore } from "./state.js";

export interface WorkspaceCommentBody {
  version: 1;
  commentId: string;
  targetObjectId: string;
  targetRevisionId: string;
  parentCommentId: string | null;
  body: string;
  resolvedCommentId: string | null;
  createdAt: string;
}

export interface PreparedWorkspaceComment {
  comment: WorkspaceCommentBody;
  operation: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>;
  operationHash: string;
  operationRemoteKey: string;
  objectBytes: Uint8Array;
  objectHash: string;
  objectRemoteKey: string;
}

export async function prepareWorkspaceComment(input: {
  runtime: PersonalWorkspaceRuntime;
  policyHash: string;
  sequence: number;
  previousDeviceOperationHash: string | null;
  targetObjectId: string;
  targetRevisionId: string;
  body: string;
  parentCommentId?: string | null;
  resolvedCommentId?: string | null;
  recipients: Pvo1Recipient[];
  now?: string;
}): Promise<PreparedWorkspaceComment> {
  const now = input.now ?? new Date().toISOString();
  protocolAssert(utf8Encode(input.body).length >= 1 && utf8Encode(input.body).length <= 64 * 1024, "bounds", "comment body size is invalid");
  protocolAssert(input.sequence >= 1 && (input.sequence === 1 ? input.previousDeviceOperationHash === null : input.previousDeviceOperationHash !== null), "integrity", "comment device sequence is invalid");
  const commentId = createWorkspaceObjectId();
  const revisionId = createWorkspaceRevisionId();
  const comment: WorkspaceCommentBody = { version: 1, commentId, targetObjectId: input.targetObjectId, targetRevisionId: input.targetRevisionId, parentCommentId: input.parentCommentId ?? null, body: input.body, resolvedCommentId: input.resolvedCommentId ?? null, createdAt: now };
  const plaintext = utf8Encode(canonicalJson(comment));
  const objectBytes = await sealInlinePvo1({
    workspaceId: input.runtime.workspaceId,
    objectId: commentId,
    revisionId,
    recipients: input.recipients,
    metadata: { path: `.plainva/workspace/comments/${input.targetObjectId}/${commentId}.pvcomment`, mime: "application/vnd.plainva.comment+json", parentObjectId: input.targetObjectId, createdAt: now, modifiedAt: now, contentKind: "text" },
    plaintext,
  });
  const objectHash = sha256Hex(objectBytes);
  const payload: WorkspaceOperationPayload = {
    operationId: createWorkspaceObjectId(), deviceId: input.runtime.device.publicIdentity.deviceId, memberId: input.runtime.memberId,
    sequence: input.sequence, previousDeviceOperationHash: input.previousDeviceOperationHash, policyHash: input.policyHash,
    capability: "comment.create", operation: "comment", objectId: commentId, revisionId,
    parentRevisionIds: [input.targetRevisionId], payloadHash: objectHash, createdAt: now,
  };
  const operation = signWorkspaceDocument({ kind: "operation", protocolVersion: 1, workspaceId: input.runtime.workspaceId, payload }, { algorithm: "Ed25519", signerId: input.runtime.device.publicIdentity.deviceId, signerKind: "device" }, input.runtime.device.secrets.signing.privateKey);
  const operationHash = workspaceDocumentHash(operation);
  return { comment, operation, operationHash, operationRemoteKey: `.pvws/operations/${payload.deviceId}/${payload.sequence}-${operationHash}.pvop`, objectBytes, objectHash, objectRemoteKey: `.pvws/objects/${commentId}/${objectHash}.pvobj` };
}

export async function publishWorkspaceComment(store: WorkspaceObjectStore, prepared: PreparedWorkspaceComment, signal?: AbortSignal): Promise<void> {
  await store.putImmutable(prepared.objectRemoteKey, prepared.objectBytes, prepared.objectHash, { signal });
  await store.putImmutable(prepared.operationRemoteKey, encodeWorkspaceDocument(prepared.operation), prepared.operationHash, { signal });
}

export async function commitPublishedWorkspaceComment(state: WorkspaceStateStore, prepared: PreparedWorkspaceComment, meta: WorkspaceRuntimeMeta): Promise<void> {
  await state.saveComment(workspaceCommentRecord(prepared.comment, prepared.operation, prepared.operationHash));
  meta.sequence = prepared.operation.payload.sequence;
  meta.previousOperationHash = prepared.operationHash;
  meta.operationHeads[prepared.operation.payload.deviceId] = { sequence: prepared.operation.payload.sequence, operationHash: prepared.operationHash };
  meta.needsPublication = true;
  await state.recordObservedOperation(prepared.operationHash, toBase64(encodeWorkspaceDocument(prepared.operation)), prepared.operation.payload.deviceId, prepared.operation.payload.sequence, meta);
}

export async function openWorkspaceComment(input: {
  objectBytes: Uint8Array;
  operation: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>;
  readerKeys: WorkspaceGroupKeyEpoch[];
}): Promise<WorkspaceCommentBody> {
  protocolAssert(input.operation.payload.operation === "comment" && input.operation.payload.payloadHash === sha256Hex(input.objectBytes), "integrity", "comment operation binding is invalid");
  const opened = await openPvo1Frame(input.objectBytes, input.readerKeys.map((key) => ({ groupId: key.groupId, keyEpoch: key.keyEpoch, privateKey: key.hpke.privateKey })));
  protocolAssert(opened.plaintext !== undefined && opened.metadata.mime === "application/vnd.plainva.comment+json", "integrity", "comment payload is invalid");
  const text = utf8DecodeFatal(opened.plaintext);
  let body: WorkspaceCommentBody;
  try { body = JSON.parse(text) as WorkspaceCommentBody; }
  catch (cause) { throw new WorkspaceProtocolError("format", "comment payload is not JSON", { cause }); }
  protocolAssert(canonicalJson(body) === text && body.version === 1 && body.commentId === input.operation.payload.objectId && body.targetRevisionId === input.operation.payload.parentRevisionIds[0], "integrity", "comment content binding is invalid");
  protocolAssert(typeof body.body === "string" && utf8Encode(body.body).length <= 64 * 1024, "bounds", "comment body is too large");
  return body;
}

export function workspaceCommentRecord(body: WorkspaceCommentBody, operation: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>, operationHash: string): WorkspaceCommentRecord {
  return { commentId: body.commentId, targetObjectId: body.targetObjectId, targetRevisionId: body.targetRevisionId, parentCommentId: body.parentCommentId, authorMemberId: operation.payload.memberId, authorDeviceId: operation.payload.deviceId, operationHash, payloadHash: operation.payload.payloadHash!, body: body.body, createdAt: body.createdAt, resolvedCommentId: body.resolvedCommentId, resolvedAt: null };
}

export class WorkspaceRevisionHistoryService {
  constructor(private readonly store: WorkspaceObjectStore, private readonly state: WorkspaceStateStore, private readonly keys: WorkspaceGroupKeyEpoch[]) {}
  list(objectId: string): Promise<WorkspaceRevisionRecord[]> { return this.state.listRevisionsForObject(objectId); }
  async read(revisionId: string, signal?: AbortSignal): Promise<Uint8Array> {
    const revision = await this.state.getRevision(revisionId);
    protocolAssert(!!revision?.payloadHash, "integrity", "revision payload is unavailable");
    const key = `.pvws/objects/${revision.objectId}/${revision.payloadHash}.pvobj`;
    const bytes = await this.store.get(key, { signal });
    protocolAssert(!!bytes && sha256Hex(bytes) === revision.payloadHash, "integrity", "revision object is missing or changed");
    const opened = await openPvo1Frame(bytes, this.keys.map((entry) => ({ groupId: entry.groupId, keyEpoch: entry.keyEpoch, privateKey: entry.hpke.privateKey })));
    if (opened.plaintext) return opened.plaintext;
    protocolAssert(!!opened.manifest, "integrity", "revision has no plaintext or chunk manifest");
    const chunks: Uint8Array[] = [];
    for (const reference of opened.manifest.chunks) {
      const chunk = await this.store.get(`.pvws/chunks/${revision.objectId}/${revision.revisionId}/${reference.index}-${reference.sha256}.pvchunk`, { signal });
      protocolAssert(!!chunk, "integrity", "revision chunk is missing");
      chunks.push(openPvc1Chunk({ bytes: chunk, expected: reference, frame: opened }));
    }
    protocolAssert(verifyChunkedPlaintextHash(opened, chunks), "integrity", "revision chunk hash is invalid");
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0); const result = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  }
}

export class WorkspaceQuarantineService {
  constructor(private readonly state: WorkspaceStateStore, private readonly retrySync: () => void) {}
  list(status?: WorkspaceQuarantineStatus) { return this.state.listQuarantine(status); }
  async retry(quarantineId: string): Promise<void> { await this.state.setQuarantineStatus(quarantineId, "pending"); this.retrySync(); }
  ignore(quarantineId: string): Promise<void> { return this.state.setQuarantineStatus(quarantineId, "ignored"); }
  markRepaired(quarantineId: string): Promise<void> { return this.state.setQuarantineStatus(quarantineId, "repaired"); }
  async exportCiphertext(quarantineId: string): Promise<Uint8Array | null> {
    const record = (await this.state.listQuarantine()).find((entry) => entry.quarantineId === quarantineId);
    return record ? fromBase64(record.artifactBase64) : null;
  }
}
