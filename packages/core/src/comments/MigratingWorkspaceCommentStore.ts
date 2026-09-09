import { WorkspaceCommentStore, type WorkspaceCommentStoreDeps } from "./WorkspaceCommentStore.js";
import { type BundleCommentStore, type CommentPathMove, type CommentStoreState } from "./store.js";
import { resolveCommentPath, sortedCommentMoves } from "./commentsBundle.js";
import { commentAuthorKey, importedCommentFields, legacyCommentId, sameLegacyComment, type LegacyCommentOrigin } from "./legacyCommentImport.js";
import { effectiveWorkspaceCapabilities, evaluateWorkspaceAccess } from "../workspace/authorization.js";
import { workspaceSliceIdsForObject } from "../workspace/slices.js";
import { outboxEntryAsCommentRecord, type WorkspaceCommentRecord, type WorkspaceCommentOutboxEntry } from "../workspace/state.js";
import { projectCommentRecords } from "./commentProjection.js";

/** Both shells retain readable sideband history while publishing new facts
 * through the signed workspace. Source files are never removed by an import. */
export class MigratingWorkspaceCommentStore extends WorkspaceCommentStore {
  private reading: Promise<Map<string, WorkspaceCommentRecord[]>> | null = null;

  constructor(deps: WorkspaceCommentStoreDeps, readonly legacy: BundleCommentStore) { super(deps); }

  override async state(): Promise<CommentStoreState> {
    const current = await super.state();
    return current.mode === "locked" ? current : { ...current, legacyLocked: (await this.legacy.state()).mode === "locked" };
  }

  override async list(path: string): Promise<WorkspaceCommentRecord[]> { return (await this.listAll()).get(path) ?? []; }

  override listAll(): Promise<Map<string, WorkspaceCommentRecord[]>> {
    if (this.reading) return this.reading;
    const reading = this.readHistory();
    this.reading = reading;
    const clear = () => { if (this.reading === reading) this.reading = null; };
    void reading.then(clear, clear);
    return reading;
  }

  override async authors(): Promise<Map<string, string>> {
    const authors = await super.authors();
    for (const comments of (await this.listAll()).values()) for (const comment of comments) {
      if (comment.legacyOrigin?.authorName) authors.set(commentAuthorKey(comment), comment.legacyOrigin.authorName);
    }
    return authors;
  }

  override async recordMoves(moves: readonly CommentPathMove[] = []): Promise<void> { await this.legacy.recordMoves(moves); }

  private async readHistory(): Promise<Map<string, WorkspaceCommentRecord[]>> {
    if ((await super.state()).mode === "locked") return new Map();
    const { runtime, workspaceState } = this.deps.plane();
    const who = { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId };
    const objects = await workspaceState.listObjects();
    const byObject = new Map(objects.map(object => [object.objectId, object]));
    const byPath = new Map(objects.filter(object => !object.deleted).map(object => [object.path, object]));
    const caps = (path: string, objectId?: string) => effectiveWorkspaceCapabilities(runtime.policy.payload, {
      ...who, objectId, sliceIds: workspaceSliceIdsForObject(runtime.policy.payload, { objectId: objectId ?? "", path,
        contentKind: objectId ? byObject.get(objectId)?.contentKind : undefined }),
    });
    const queuedBefore = await workspaceState.listCommentOutbox();
    const receipts = new Map<string, WorkspaceCommentRecord | WorkspaceCommentOutboxEntry>(queuedBefore.map(entry => [entry.commentId, entry]));
    for (const record of await workspaceState.listRawComments()) receipts.set(record.commentId, record);
    const legacy = await this.legacy.legacySnapshot();
    const fallback = new Map<string, { path: string; record: WorkspaceCommentRecord }>();
    if (legacy) {
      const moves = sortedCommentMoves(legacy.bundle);
      const canImport = evaluateWorkspaceAccess(runtime.policy.payload, { ...who, capability: "workspace.manage" }).allowed;
      for (const source of Object.values(legacy.bundle.comments)) {
        const origin: LegacyCommentOrigin = { format: "plainva-comments", version: 1, workspaceId: runtime.workspaceId,
          record: source, authorName: legacy.bundle.authors[source.authorId ?? source.authorDeviceId]?.name ?? null };
        const fields = importedCommentFields(origin);
        const receipt = receipts.get(fields.commentId);
        const path = resolveCommentPath(moves, source.path, source.createdAt, legacy.missing);
        // An existing receipt permanently pins the historical target, even
        // after deletion or when another note reuses its former pathname.
        const object = receipt ? byObject.get(receipt.targetObjectId) : byPath.get(path);
        if (receipt && (!object || object.deleted)) continue;
        const currentPath = object?.path ?? path;
        if (!caps(currentPath, object?.objectId).includes("comment.read")) continue;
        let record: WorkspaceCommentRecord = { ...fields, targetObjectId: object?.objectId ?? currentPath,
          authorMemberId: `legacy:${source.authorId ?? source.authorDeviceId}`, authorDeviceId: source.authorDeviceId,
          createdAt: source.createdAt, suggestion: source.suggestion ? { ...source.suggestion, appliedAt: null, appliedBy: null, declinedAt: null } : null,
          resolvedAt: null, legacyOrigin: origin, legacyPending: true,
        };
        if (receipt && sameLegacyComment(receipt, record)) continue;
        if (receipt) {
          // Keep a conflicting local source visible without replacing or
          // impersonating the already acknowledged signed fact.
          record = { ...record, commentId: legacyCommentId(runtime.workspaceId, JSON.stringify(source), "conflicting-source") };
        } else if (canImport && object?.currentRevisionId && caps(currentPath, object.objectId).includes("comment.create")) {
          try { await this.importLegacy(currentPath, origin, object.objectId); }
          catch { /* Source stays visible and untouched; a later read retries. */ }
        }
        fallback.set(record.commentId, { path: currentPath, record });
      }
    }
    // Queue before records: publication saves the signed fact before retiring
    // its queue entry. Readers cannot fall between those two writes.
    const queued = await workspaceState.listCommentOutbox();
    const stored = await workspaceState.listRawComments();
    const records = new Map([...fallback].map(([id, value]) => [id, value.record]));
    for (const entry of queued) records.set(entry.commentId, outboxEntryAsCommentRecord(entry, runtime.memberId, who.deviceId));
    for (const record of stored) records.set(record.commentId, record);
    const result = new Map<string, WorkspaceCommentRecord[]>();
    for (const record of projectCommentRecords([...records.values()])) {
      const object = byObject.get(record.targetObjectId);
      const path = object && !object.deleted ? object.path : record.legacyPending ? fallback.get(record.commentId)?.path : undefined;
      if (!path || !caps(path, object?.objectId).includes("comment.read")) continue;
      const comments = result.get(path) ?? []; comments.push(record); result.set(path, comments);
    }
    return result;
  }
}
