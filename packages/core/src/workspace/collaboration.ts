import { canonicalJson } from "../settingsSync/canonicalJson.js";
import type { WorkspaceObjectStore } from "./objectStore.js";
import { createWorkspaceObjectId, createWorkspaceRevisionId, type WorkspaceGroupKeyEpoch } from "./identity.js";
import { encodeWorkspaceDocument, signWorkspaceDocument, workspaceDocumentHash, type WorkspaceOperationPayload, type WorkspaceSignedDocument } from "./documents.js";
import { openPvc1Chunk, openPvo1Frame, sealInlinePvo1, verifyChunkedPlaintextHash, type Pvo1Recipient } from "./pvo1.js";
import { assertWorkspaceCommentAnchor, type WorkspaceCommentAnchor } from "./commentAnchor.js";
import { protocolAssert, WorkspaceProtocolError } from "./errors.js";
import { decodeBase64Exact, fromBase64, sha256Hex, toBase64, utf8DecodeFatal, utf8Encode } from "./encoding.js";
import { evaluateWorkspaceAccess } from "./authorization.js";
import { workspaceRecipientGroupIds, workspaceSliceIdsForObject } from "./slices.js";
import type { WorkspacePolicyPayload } from "./documents.js";
import type { PersonalWorkspaceRuntime } from "./personal.js";
import type { WorkspaceCommentOutboxEntry, WorkspaceCommentRecord, WorkspaceQuarantineStatus, WorkspaceRevisionRecord, WorkspaceRuntimeMeta, WorkspaceStateStore } from "./state.js";

export interface WorkspaceCommentBody {
  version: 1;
  commentId: string;
  targetObjectId: string;
  targetRevisionId: string;
  parentCommentId: string | null;
  body: string;
  /**
   * Where in the note the comment sits, or null for the note as a whole.
   *
   * Absent on comments written before anchors existed - those mean the whole
   * note too. Because canonicalJson sorts keys, adding the field neither moves
   * the others nor changes an older comment's bytes: no protocol version bump.
   */
  anchor?: WorkspaceCommentAnchor | null;
  /**
   * A proposed replacement for the anchored passage, or null for a plain remark.
   *
   * The proposal only ever describes a change - it never touches the note. That
   * is what keeps "Markdown stays Markdown" true: until someone accepts, the
   * file on disk is exactly what it was and a foreign editor sees no trace. An
   * empty string is a deletion. Optional for the same reason as anchor.
   */
  suggestion?: { replacement: string } | null;
  /**
   * What became of the suggestion this marker closes - only ever set together
   * with resolvedCommentId. Accepting and declining both resolve the thread;
   * without this field a second device could not tell them apart, because the
   * write that accepting produces is an ordinary note revision with nothing in
   * it that points back here.
   */
  suggestionOutcome?: "applied" | "declined" | null;
  resolvedCommentId: string | null;
  createdAt: string;
}

/**
 * A suggestion needs a passage to replace, and an outcome needs a suggestion to
 * be about. Both rules live here rather than in the UI because a device that
 * accepted a suggestion without a range would have to guess where to write.
 */
export function assertWorkspaceSuggestion(suggestion: { replacement: string } | null | undefined, anchor: WorkspaceCommentAnchor | null | undefined, outcome: "applied" | "declined" | null | undefined, resolvedCommentId: string | null): void {
  if (suggestion !== null && suggestion !== undefined) {
    protocolAssert(typeof suggestion.replacement === "string" && utf8Encode(suggestion.replacement).length <= 64 * 1024, "bounds", "suggestion replacement is invalid");
    protocolAssert(!!anchor, "integrity", "a suggestion needs an anchored passage");
    protocolAssert(resolvedCommentId === null, "integrity", "a suggestion cannot also resolve a thread");
  }
  if (outcome !== null && outcome !== undefined) {
    protocolAssert(outcome === "applied" || outcome === "declined", "format", "suggestion outcome is invalid");
    protocolAssert(resolvedCommentId !== null, "integrity", "a suggestion outcome needs the suggestion it closes");
  }
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
  anchor?: WorkspaceCommentAnchor | null;
  suggestion?: { replacement: string } | null;
  suggestionOutcome?: "applied" | "declined" | null;
  resolvedCommentId?: string | null;
  recipients: Pvo1Recipient[];
  now?: string;
  /** Given by the outbox (K6): the id the card already carries. Fresh otherwise. */
  commentId?: string;
}): Promise<PreparedWorkspaceComment> {
  const now = input.now ?? new Date().toISOString();
  const resolvedCommentId = input.resolvedCommentId ?? null;
  // A resolve marker carries no text of its own. Demanding one forced the UI to
  // invent a word - which is how the literal English "Resolved" ended up in
  // every language. The READER has never required a non-empty body (see
  // openWorkspaceComment below), so an older device opens such a marker
  // unchanged: this relaxes the writer, it does not change the protocol.
  const bodyBytes = utf8Encode(input.body).length;
  const suggestion = input.suggestion ?? null;
  protocolAssert(bodyBytes <= 64 * 1024 && (bodyBytes >= 1 || resolvedCommentId !== null || suggestion !== null), "bounds", "comment body size is invalid");
  if (input.anchor) assertWorkspaceCommentAnchor(input.anchor);
  assertWorkspaceSuggestion(suggestion, input.anchor, input.suggestionOutcome, resolvedCommentId);
  protocolAssert(input.sequence >= 1 && (input.sequence === 1 ? input.previousDeviceOperationHash === null : input.previousDeviceOperationHash !== null), "integrity", "comment device sequence is invalid");
  const commentId = input.commentId ?? createWorkspaceObjectId();
  const revisionId = createWorkspaceRevisionId();
  const comment: WorkspaceCommentBody = { version: 1, commentId, targetObjectId: input.targetObjectId, targetRevisionId: input.targetRevisionId, parentCommentId: input.parentCommentId ?? null, body: input.body, anchor: input.anchor ?? null, suggestion, suggestionOutcome: input.suggestionOutcome ?? null, resolvedCommentId, createdAt: now };
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

/**
 * Publishes one queued remark (K6): the access check, the sealing, the two
 * uploads and the local commit that the desktop shell used to run before it
 * showed anything. The worker calls this per outbox entry, in order, so the
 * device sequence stays monotonic; a failure leaves the entry in the outbox
 * with its reason and the shell shows it as "not sent".
 */
export async function publishQueuedWorkspaceComment(input: {
  runtime: PersonalWorkspaceRuntime;
  policy: WorkspacePolicyPayload;
  state: WorkspaceStateStore;
  store: WorkspaceObjectStore;
  entry: WorkspaceCommentOutboxEntry;
  signal?: AbortSignal;
}): Promise<WorkspaceCommentRecord> {
  const { runtime, policy, state, store, entry } = input;
  const object = await state.getObjectById(entry.targetObjectId);
  if (!object?.currentRevisionId) throw new Error("workspace-object-not-synced");
  const meta = await state.loadMeta();
  if (!meta) throw new Error("workspace-state-missing");
  const sliceObject = { objectId: object.objectId, path: object.path, contentKind: object.contentKind };
  const sliceIds = workspaceSliceIdsForObject(policy, sliceObject);
  if (!evaluateWorkspaceAccess(policy, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: "comment.create", objectId: object.objectId, sliceIds }).allowed) {
    throw new Error("workspace-comment-not-permitted");
  }
  const recipients: Pvo1Recipient[] = workspaceRecipientGroupIds(policy, sliceObject).map((groupId) => {
    const group = policy.groups.find((candidate) => candidate.groupId === groupId)!;
    return { groupId, keyEpoch: group.keyEpoch, publicKey: decodeBase64Exact(group.hpkePublicKey, 32, "comment recipient key") };
  });
  const prepared = await prepareWorkspaceComment({
    runtime,
    policyHash: meta.policyHash,
    sequence: meta.sequence + 1,
    previousDeviceOperationHash: meta.previousOperationHash,
    targetObjectId: object.objectId,
    targetRevisionId: object.currentRevisionId,
    commentId: entry.commentId,
    body: entry.body,
    parentCommentId: entry.parentCommentId,
    resolvedCommentId: entry.resolvedCommentId,
    anchor: entry.anchor,
    suggestion: entry.suggestion,
    suggestionOutcome: entry.suggestionOutcome,
    recipients,
    // The moment the person pressed send, not the moment the network allowed it.
    now: entry.createdAt,
  });
  await publishWorkspaceComment(store, prepared, input.signal);
  await commitPublishedWorkspaceComment(state, prepared, meta);
  return workspaceCommentRecord(prepared.comment, prepared.operation, prepared.operationHash);
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
  if (body.anchor !== undefined && body.anchor !== null) assertWorkspaceCommentAnchor(body.anchor);
  assertWorkspaceSuggestion(body.suggestion, body.anchor, body.suggestionOutcome, body.resolvedCommentId);
  return body;
}

export function workspaceCommentRecord(body: WorkspaceCommentBody, operation: WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>, operationHash: string): WorkspaceCommentRecord {
  return { commentId: body.commentId, targetObjectId: body.targetObjectId, targetRevisionId: body.targetRevisionId, parentCommentId: body.parentCommentId, authorMemberId: operation.payload.memberId, authorDeviceId: operation.payload.deviceId, operationHash, payloadHash: operation.payload.payloadHash!, body: body.body, anchor: body.anchor ?? null, suggestion: body.suggestion ? { replacement: body.suggestion.replacement, appliedAt: null, appliedBy: null, declinedAt: null } : null, suggestionOutcome: body.suggestionOutcome ?? null, createdAt: body.createdAt, resolvedCommentId: body.resolvedCommentId, resolvedAt: null };
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
