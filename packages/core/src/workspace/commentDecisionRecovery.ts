import { openWorkspaceComment, workspaceCommentRecord } from "./collaboration.js";
import { parseWorkspaceDocument, workspaceDocumentHash, type WorkspaceOperationPayload, type WorkspaceSignedDocument } from "./documents.js";
import { fromBase64 } from "./encoding.js";
import { protocolAssert } from "./errors.js";
import type { WorkspaceObjectStore } from "./objectStore.js";
import type { PersonalWorkspaceRuntime } from "./personal.js";
import type { WorkspaceStateStore } from "./state.js";

/**
 * Older SQL versions kept only the derived outcome on the proposal. Recover
 * the immutable facts from the original object and its already observed
 * operation, without changing signatures or re-authorizing accepted history.
 * Missing keys, transport failures and incomplete records leave recovery open.
 */
export async function recoverWorkspaceCommentDecisions(input: {
  state: WorkspaceStateStore; store: WorkspaceObjectStore; runtime: PersonalWorkspaceRuntime; signal?: AbortSignal;
}): Promise<{ recoveredObjectIds: string[]; pendingIds: string[] }> {
  const { state, store, runtime, signal } = input;
  const recovered = new Set<string>();
  const pendingIds: string[] = [];
  for (const old of await state.listCommentsNeedingDecisionRecovery()) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    try {
      protocolAssert(!!old.operationHash && !!old.payloadHash, "integrity", "old comment provenance is unavailable");
      const document = await state.getOperationDocument(old.operationHash);
      protocolAssert(document !== null, "integrity", "observed comment operation is unavailable");
      const parsed = parseWorkspaceDocument(fromBase64(document));
      protocolAssert(parsed.kind === "operation" && parsed.workspaceId === runtime.workspaceId
        && workspaceDocumentHash(parsed) === old.operationHash, "integrity", "observed comment operation binding changed");
      const operation = parsed as WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>;
      protocolAssert(operation.payload.objectId === old.commentId && operation.payload.payloadHash === old.payloadHash
        && operation.payload.memberId === old.authorMemberId && operation.payload.deviceId === old.authorDeviceId,
      "integrity", "old comment author or object binding changed");
      const bytes = await store.get(`.pvws/objects/${old.commentId}/${old.payloadHash}.pvobj`, { signal });
      protocolAssert(bytes !== null, "integrity", "old comment object is unavailable");
      const body = await openWorkspaceComment({ objectBytes: bytes, operation, readerKeys: runtime.groupKeys });
      protocolAssert(body.targetObjectId === old.targetObjectId && body.targetRevisionId === old.targetRevisionId
        && body.resolvedCommentId === old.resolvedCommentId && body.parentCommentId === old.parentCommentId
        && body.body === old.body && body.createdAt === old.createdAt, "integrity", "old comment content binding changed");
      await state.recoverCommentDecision(workspaceCommentRecord(body, operation, old.operationHash));
      recovered.add(body.targetObjectId);
    } catch {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      // Do not invent an outcome or erase the legacy columns on failed reads.
      // The unchanged format marker makes this operation resumable next cycle.
      pendingIds.push(old.commentId);
    }
  }
  return { recoveredObjectIds: [...recovered].sort(), pendingIds };
}
