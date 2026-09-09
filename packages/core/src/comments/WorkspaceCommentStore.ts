/** Shared sealed comment store. The shell supplies its captured runtime and worker. */
import { createWorkspaceObjectId } from "../workspace/identity.js";
import { effectiveWorkspaceCapabilities, evaluateWorkspaceAccess } from "../workspace/authorization.js";
import { outboxEntryAsCommentRecord, type WorkspaceCommentOutboxEntry, type WorkspaceCommentRecord, type WorkspaceStateStore } from "../workspace/state.js";
import { workspaceSliceIdsForObject } from "../workspace/slices.js";
import type { CommentPostInput, CommentStore, CommentStoreState } from "./store.js";
import type { PersonalWorkspaceRuntime } from "../workspace/personal.js";
import type { WorkspaceCapability } from "../workspace/documents.js";
import { commentWriteIdentity, CommentIdentityConflictError, sameCommentContent } from "./commentIdentity.js";

export interface WorkspaceCommentStoreDeps {
  /** The unlocked runtime and state store; throws while the workspace is locked or absent. */
  plane(): { runtime: PersonalWorkspaceRuntime; workspaceState: WorkspaceStateStore };
  /**
   * The running worker, if any. The encrypted workspace worker publishes the
   * queued remark alone; a plain worker only knows a whole cycle.
   */
  worker(): { triggerImmediate(): void; publishQueuedComments?: () => Promise<void> } | null;
  /** Fired after every write, so the column beside the note re-reads. */
  changed(path: string): void;
}

const identityWrites = new WeakMap<WorkspaceStateStore, Map<string, Promise<void>>>();
function withIdentityWrite(state: WorkspaceStateStore, id: string, work: () => Promise<void>): Promise<void> {
  let lanes = identityWrites.get(state);
  if (!lanes) { lanes = new Map(); identityWrites.set(state, lanes); }
  const run = (lanes.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
  lanes.set(id, run);
  const clear = () => { if (lanes!.get(id) === run) lanes!.delete(id); };
  void run.then(clear, clear);
  return run;
}
function immutableFields(record: WorkspaceCommentOutboxEntry | WorkspaceCommentRecord) {
  return {
    commentId: record.commentId, targetObjectId: record.targetObjectId, body: record.body,
    parentCommentId: record.parentCommentId, resolvedCommentId: record.resolvedCommentId,
    anchor: record.anchor, suggestion: record.suggestion ? { replacement: record.suggestion.replacement } : null,
    suggestionOutcome: record.suggestionOutcome, retractsCommentId: record.retractsCommentId,
    suggestionBatchId: record.suggestionBatchId, batchIndex: record.batchIndex, batchNote: record.batchNote,
    createdAt: record.createdAt,
  };
}

type RuntimeIdentity = { memberId: string; device: { publicIdentity: { deviceId: string } } };

/**
 * What the outbox adds to a note's list (K6): queued remarks as pending
 * records, and a queued resolve marker applied to the record it closes - a
 * thread somebody just resolved must not stay open until the upload lands.
 */
export function mergeCommentOutbox(stored: WorkspaceCommentRecord[], queued: WorkspaceCommentOutboxEntry[], runtime: RuntimeIdentity): WorkspaceCommentRecord[] {
  if (queued.length === 0) return stored;
  const byId = new Map(stored.map((record) => [record.commentId, { ...record }]));
  for (const entry of queued) {
    // A queued deletion takes the remark off the screen now, with every reply
    // under it (K7) - the marker itself is never a card.
    if (entry.retractsCommentId) {
      byId.delete(entry.retractsCommentId);
      for (const [id, record] of [...byId]) if (record.parentCommentId === entry.retractsCommentId) byId.delete(id);
      continue;
    }
    if (!entry.resolvedCommentId) { byId.set(entry.commentId, outboxEntryAsCommentRecord(entry, runtime.memberId, runtime.device.publicIdentity.deviceId)); continue; }
    const target = byId.get(entry.resolvedCommentId);
    if (!target) continue;
    target.resolvedAt = entry.createdAt;
    if (target.suggestion && entry.suggestionOutcome === "applied") target.suggestion = { ...target.suggestion, appliedAt: entry.createdAt, appliedBy: runtime.memberId };
    if (target.suggestion && entry.suggestionOutcome === "declined") target.suggestion = { ...target.suggestion, declinedAt: entry.createdAt };
  }
  return [...byId.values()];
}

export class WorkspaceCommentStore implements CommentStore {
  constructor(private readonly deps: WorkspaceCommentStoreDeps) {}

  async state(): Promise<CommentStoreState> {
    return { mode: "workspace", hasOutbox: true };
  }

  async capabilities(path: string): Promise<WorkspaceCapability[] | null> {
    const { runtime, workspaceState } = this.deps.plane();
    const object = await workspaceState.getObjectByPath(path);
    const objectId = object?.objectId ?? createWorkspaceObjectId();
    const sliceIds = workspaceSliceIdsForObject(runtime.policy.payload, { objectId, path, contentKind: object?.contentKind });
    return effectiveWorkspaceCapabilities(runtime.policy.payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, objectId, sliceIds });
  }

  async list(path: string): Promise<WorkspaceCommentRecord[]> {
    const { runtime, workspaceState } = this.deps.plane();
    const object = await workspaceState.getObjectByPath(path);
    if (!object) return [];
    const stored = await workspaceState.listComments(object.objectId);
    const queued = (await workspaceState.listCommentOutbox()).filter((entry) => entry.targetObjectId === object.objectId);
    return mergeCommentOutbox(stored, queued, runtime);
  }

  async listAll(): Promise<Map<string, WorkspaceCommentRecord[]>> {
    const { runtime, workspaceState } = this.deps.plane();
    // A comment names the object it hangs on, never the path - a renamed note
    // keeps its object and its thread. So the paths come from the objects, and
    // a comment whose object is gone is dropped rather than filed under "".
    //
    // The read right is decided HERE, once per note, off the policy already in
    // memory. Asking `capabilities` from the view would be one database
    // round-trip per note; leaving it out would show an overview wider than
    // the note itself does.
    const paths = new Map<string, string>();
    for (const object of await workspaceState.listObjects()) {
      const sliceIds = workspaceSliceIdsForObject(runtime.policy.payload, object);
      const caps = effectiveWorkspaceCapabilities(runtime.policy.payload, {
        memberId: runtime.memberId,
        deviceId: runtime.device.publicIdentity.deviceId,
        objectId: object.objectId,
        sliceIds,
      });
      if (caps.includes("comment.read")) paths.set(object.objectId, object.path);
    }
    const byPath = new Map<string, WorkspaceCommentRecord[]>();
    for (const comment of await workspaceState.listAllComments()) {
      const path = paths.get(comment.targetObjectId);
      if (!path) continue;
      const list = byPath.get(path);
      if (list) list.push(comment);
      else byPath.set(path, [comment]);
    }
    // The queued ones too (K6): the overview must not miss what was just sent.
    const queued = await workspaceState.listCommentOutbox();
    for (const [path, list] of byPath) byPath.set(path, mergeCommentOutbox(list, queued.filter((entry) => entry.path === path), runtime));
    for (const entry of queued) {
      if (byPath.has(entry.path) || entry.resolvedCommentId || entry.retractsCommentId) continue;
      byPath.set(entry.path, mergeCommentOutbox([], queued.filter((candidate) => candidate.path === entry.path), runtime));
    }
    return byPath;
  }

  async authors(): Promise<Map<string, string>> {
    return new Map(this.deps.plane().runtime.policy.payload.members.map((member) => [member.memberId, member.displayName]));
  }

  /** The workspace signs with the member id; that is what "mine" means here. */
  async selfId(): Promise<string> {
    return this.deps.plane().runtime.memberId;
  }

  async post(input: CommentPostInput): Promise<void> {
    const { runtime, workspaceState } = this.deps.plane();
    const identity = commentWriteIdentity(input.identity);
    await withIdentityWrite(workspaceState, identity.commentId, async () => {
      const object = await workspaceState.getObjectByPath(input.path);
      if (!object?.currentRevisionId) throw new Error("workspace-object-not-synced");
      // The right is checked HERE, before anything is queued: a refusal must be
      // immediate and its own, not a "not sent" card a cycle later.
      const sliceIds = workspaceSliceIdsForObject(runtime.policy.payload, { objectId: object.objectId, path: object.path, contentKind: object.contentKind });
      if (!evaluateWorkspaceAccess(runtime.policy.payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: "comment.create", objectId: object.objectId, sliceIds }).allowed) throw new Error("workspace-comment-not-permitted");
      // Into the outbox, not onto the network (K6, finding 2026-09-03). Sealing
      // and the two verified uploads happen in the worker's next cycle, which is
      // triggered right away; the column shows the card now, with a "sending"
      // state, and a failure comes back as a reason on that card.
      const entry: WorkspaceCommentOutboxEntry = {
        outboxId: createWorkspaceObjectId(), commentId: identity.commentId, path: input.path, targetObjectId: object.objectId,
        body: input.body, parentCommentId: input.parentCommentId ?? null, resolvedCommentId: input.resolvedCommentId ?? null,
        anchor: input.anchor ?? null, suggestion: input.suggestion ?? null, suggestionOutcome: input.suggestionOutcome ?? null,
        retractsCommentId: input.retractsCommentId ?? null,
        suggestionBatchId: input.batch?.batchId ?? null, batchIndex: input.batch?.index ?? null, batchNote: input.batch?.note ?? null,
        createdAt: identity.createdAt, attempts: 0, lastError: null,
      };
      // Read the outbox FIRST. The worker saves the immutable record before
      // removing its outbox entry, so a completed publication cannot fall into
      // a gap between these two reads and become another queued publication.
      const queued = (await workspaceState.listCommentOutbox()).find((candidate) => candidate.commentId === entry.commentId);
      if (queued) {
        if (!sameCommentContent(immutableFields(queued), immutableFields(entry))) throw new CommentIdentityConflictError(entry.commentId);
        this.publish();
        return;
      }
      const stored = await workspaceState.getComment(entry.commentId);
      if (stored) {
        if (stored.authorMemberId !== runtime.memberId || stored.authorDeviceId !== runtime.device.publicIdentity.deviceId
          || !sameCommentContent(immutableFields(stored), immutableFields(entry))) throw new CommentIdentityConflictError(entry.commentId);
        return;
      }
      const live = this.deps.plane();
      if (live.workspaceState !== workspaceState || live.runtime !== runtime) throw new Error("workspace-comment-runtime-changed");
      await workspaceState.enqueueCommentOutbox(entry);
      this.publish();
      this.deps.changed(input.path);
    });
  }

  async retry(outboxId: string): Promise<void> {
    const { workspaceState } = this.deps.plane();
    const entry = (await workspaceState.listCommentOutbox()).find((candidate) => candidate.outboxId === outboxId);
    if (!entry) return;
    await workspaceState.updateCommentOutbox(outboxId, { attempts: entry.attempts, lastError: null });
    this.publish();
    this.deps.changed(entry.path);
  }

  async discard(outboxId: string): Promise<void> {
    const { workspaceState } = this.deps.plane();
    const entry = (await workspaceState.listCommentOutbox()).find((candidate) => candidate.outboxId === outboxId);
    if (!entry) return;
    await workspaceState.deleteCommentOutbox(outboxId);
    this.deps.changed(entry.path);
  }

  /** A workspace comment names its OBJECT, and a renamed note keeps its object: nothing to record. */
  async recordMoves(): Promise<void> {}

  /** The remark alone, now - not a whole cycle with a remote listing in front of it (finding 2026-09-03). */
  private publish(): void {
    const worker = this.deps.worker();
    if (worker?.publishQueuedComments) void worker.publishQueuedComments();
    else worker?.triggerImmediate();
  }
}
