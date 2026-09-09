import { assertCommentsBundleStructure, type LocalCommentRecord } from "./commentsBundle.js";
import { canonicalJson } from "../settingsSync/canonicalJson.js";
import { sha256Hex, utf8Encode } from "../workspace/encoding.js";
import type { WorkspaceCommentRecord } from "../workspace/state.js";

/** The current signature certifies an import, never the original authorship. */
export interface LegacyCommentOrigin {
  format: "plainva-comments";
  version: 1;
  workspaceId: string;
  record: LocalCommentRecord;
  authorName: string | null;
}

/** Namespace old IDs so an unsigned history cannot name a native workspace fact. */
export function legacyCommentId(workspaceId: string, sourceId: string, kind = "comment"): string {
  return sha256Hex(utf8Encode(JSON.stringify(["plainva-comment-import-v1", workspaceId, kind, sourceId]))).slice(0, 32);
}

export function assertLegacyCommentOrigin(value: unknown): asserts value is LegacyCommentOrigin {
  const origin = value as LegacyCommentOrigin | null;
  if (!origin || origin.format !== "plainva-comments" || origin.version !== 1
    || typeof origin.workspaceId !== "string" || !/^[a-f0-9]{32}$/.test(origin.workspaceId)
    || !origin.record || (origin.authorName !== null && (typeof origin.authorName !== "string" || origin.authorName.length > 1024)))
    throw new Error("Invalid legacy comment origin");
  // Apply the original format's complete validator, including anchors and
  // decisions. Keeping the source record makes this receipt independently readable.
  assertCommentsBundleStructure({ format: "plainva-comments", version: 1, updatedAt: origin.record.createdAt,
    comments: { [origin.record.commentId]: origin.record }, authors: {} });
}

/** Fields carried by the signed import. Its timestamp is the current import;
 * the original timestamp stays in the receipt and is used for presentation. */
export function importedCommentFields(origin: LegacyCommentOrigin) {
  assertLegacyCommentOrigin(origin);
  const { record, workspaceId } = origin;
  const reference = (id: string | null | undefined) => id ? legacyCommentId(workspaceId, id) : null;
  return {
    commentId: legacyCommentId(workspaceId, record.commentId),
    body: record.body, parentCommentId: reference(record.parentCommentId),
    resolvedCommentId: reference(record.resolvedCommentId), retractsCommentId: reference(record.retractsCommentId),
    anchor: record.anchor, suggestion: record.suggestion, suggestionOutcome: record.suggestionOutcome,
    decisionProof: record.decisionProof ? { ...record.decisionProof,
      operationId: legacyCommentId(workspaceId, record.decisionProof.operationId, "operation"),
      supersedes: record.decisionProof.supersedes.map(id => legacyCommentId(workspaceId, id)),
    } : null,
    suggestionBatchId: record.suggestionBatchId ? legacyCommentId(workspaceId, record.suggestionBatchId, "batch") : null,
    batchIndex: record.batchIndex ?? null, batchNote: record.batchNote ?? null,
  };
}

/** No envelope may mix an old provenance claim with unrelated native fields. */
export function assertImportedCommentBinding(workspaceId: string, input: object): void {
  const body = input as Record<string, unknown>;
  if (body.legacyOrigin == null) return;
  assertLegacyCommentOrigin(body.legacyOrigin);
  if (body.legacyOrigin.workspaceId !== workspaceId) throw new Error("Legacy comment workspace changed");
  for (const [key, expected] of Object.entries(importedCommentFields(body.legacyOrigin))) {
    if (canonicalJson(body[key] ?? null) !== canonicalJson(expected)) throw new Error("Legacy comment content changed");
  }
}

/** Two managers may carry the same historical fact. A different signer is
 * another valid import receipt, not another historical author or comment. */
export function sameLegacyComment(a: Pick<WorkspaceCommentRecord, "legacyOrigin" | "targetObjectId">,
  b: Pick<WorkspaceCommentRecord, "legacyOrigin" | "targetObjectId">): boolean {
  return !!a.legacyOrigin && !!b.legacyOrigin && a.targetObjectId === b.targetObjectId
    && a.legacyOrigin.workspaceId === b.legacyOrigin.workspaceId
    && canonicalJson(a.legacyOrigin.record) === canonicalJson(b.legacyOrigin.record);
}

/** Display identity is deliberately separate from the member who signed. */
export function commentAuthorKey(comment: Pick<WorkspaceCommentRecord, "authorMemberId" | "legacyOrigin">): string {
  const source = comment.legacyOrigin?.record;
  return source ? `legacy:${source.authorId ?? source.authorDeviceId}` : comment.authorMemberId;
}

export function commentCreatedAt(comment: Pick<WorkspaceCommentRecord, "createdAt" | "legacyOrigin">): string {
  return comment.legacyOrigin?.record.createdAt ?? comment.createdAt;
}

/** Historical markers address only historical facts. Their writer claims are
 * compared within that unsigned history, never against workspace membership. */
export function sameRetractionAuthor(marker: WorkspaceCommentRecord, target: WorkspaceCommentRecord,
  identity: "member" | "device" = "member"): boolean {
  if (marker.legacyOrigin) return !!target.legacyOrigin
    && marker.legacyOrigin.record.authorDeviceId === target.legacyOrigin.record.authorDeviceId;
  return identity === "device" ? marker.authorDeviceId === target.authorDeviceId : marker.authorMemberId === target.authorMemberId;
}
