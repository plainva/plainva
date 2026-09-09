import { projectCommentRecords } from "./commentProjection.js";
/** Shared sealed comment store. The shell supplies its captured runtime and worker. */
import { createWorkspaceObjectId } from "../workspace/identity.js";
import { effectiveWorkspaceCapabilities, evaluateWorkspaceAccess } from "../workspace/authorization.js";
import { outboxEntryAsCommentRecord, type WorkspaceCommentOutboxEntry, type WorkspaceCommentRecord, type WorkspaceStateStore } from "../workspace/state.js";
import { workspaceSliceIdsForObject } from "../workspace/slices.js";
import { CommentStoreLockedError, type CommentPostInput, type CommentStore, type CommentStoreState } from "./store.js";
import type { PersonalWorkspaceRuntime } from "../workspace/personal.js";
import type { WorkspaceCapability } from "../workspace/documents.js";
import { commentWriteIdentity, CommentIdentityConflictError, sameCommentContent } from "./commentIdentity.js";
import { importedCommentFields, sameLegacyComment, type LegacyCommentOrigin } from "./legacyCommentImport.js";

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
    suggestionOutcome: record.suggestionOutcome, decisionProof: record.decisionProof, retractsCommentId: record.retractsCommentId,
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
  const byId = new Map(queued.map((entry) => [entry.commentId,
    outboxEntryAsCommentRecord(entry, runtime.memberId, runtime.device.publicIdentity.deviceId)]));
  // Publication saves the signed record before retiring its outbox entry.
  // The same ID is one fact, with the confirmed record taking precedence.
  for (const record of stored) byId.set(record.commentId, record);
  return projectCommentRecords([...byId.values()]);
}

export class WorkspaceCommentStore implements CommentStore {
  constructor(protected readonly deps: WorkspaceCommentStoreDeps) {}

  async writerKey(): Promise<string> {
    const { runtime } = this.deps.plane();
    return JSON.stringify(["workspace", runtime.workspaceId, runtime.memberId, runtime.device.publicIdentity.deviceId]);
  }

  async captureTarget(path: string): Promise<string> {
    const { workspaceState } = this.deps.plane();
    const object = await workspaceState.getObjectByPath(path);
    if (!object || object.deleted || !object.currentRevisionId) throw new Error("workspace-object-not-synced");
    return object.objectId;
  }

  async resolvePath(path: string, _createdAt: string, targetObjectId?: string): Promise<string> {
    const { workspaceState } = this.deps.plane();
    const object = targetObjectId ? await workspaceState.getObjectById(targetObjectId) : await workspaceState.getObjectByPath(path);
    if (!object || object.deleted || !object.currentRevisionId) throw new Error("workspace-object-not-synced");
    return object.path;
  }

  async state(): Promise<CommentStoreState> {
    try { this.deps.plane(); }
    catch (error) { if (error instanceof CommentStoreLockedError) return { mode: "locked", hasOutbox: true }; throw error; }
    return { mode: "workspace", hasOutbox: true };
  }

  async capabilities(path: string): Promise<WorkspaceCapability[] | null> {
    if ((await this.state()).mode === "locked") return [];
    const { runtime, workspaceState } = this.deps.plane();
    const object = await workspaceState.getObjectByPath(path);
    const objectId = object?.objectId ?? createWorkspaceObjectId();
    const sliceIds = workspaceSliceIdsForObject(runtime.policy.payload, { objectId, path, contentKind: object?.contentKind });
    return effectiveWorkspaceCapabilities(runtime.policy.payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, objectId, sliceIds });
  }

  async list(path: string): Promise<WorkspaceCommentRecord[]> {
    if ((await this.state()).mode === "locked") return [];
    const { runtime, workspaceState } = this.deps.plane();
    const object = await workspaceState.getObjectByPath(path);
    if (!object || object.deleted || !(await this.capabilities(path))?.includes("comment.read")) return [];
    const queued = (await workspaceState.listCommentOutbox()).filter((entry) => entry.targetObjectId === object.objectId);
    const stored = await workspaceState.listRawComments(object.objectId);
    return mergeCommentOutbox(stored, queued, runtime);
  }

  async listAll(): Promise<Map<string, WorkspaceCommentRecord[]>> {
    if ((await this.state()).mode === "locked") return new Map();
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
      if (object.deleted) continue;
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
    const queued = await workspaceState.listCommentOutbox();
    const records = mergeCommentOutbox(await workspaceState.listRawComments(), queued, runtime);
    for (const comment of records) {
      const path = paths.get(comment.targetObjectId);
      if (!path) continue;
      const list = byPath.get(path);
      if (list) list.push(comment);
      else byPath.set(path, [comment]);
    }
    return byPath;
  }

  async authors(): Promise<Map<string, string>> {
    if ((await this.state()).mode === "locked") return new Map();
    return new Map(this.deps.plane().runtime.policy.payload.members.map((member) => [member.memberId, member.displayName]));
  }

  /** The workspace signs with the member id; that is what "mine" means here. */
  async selfId(): Promise<string | null> {
    if ((await this.state()).mode === "locked") return null;
    return this.deps.plane().runtime.memberId;
  }

  async post(input: CommentPostInput): Promise<void> {
    return this.enqueue(input);
  }

  /** Only this separate entry point can attach unsigned historical provenance. */
  async importLegacy(path: string, origin: LegacyCommentOrigin, targetObjectId?: string): Promise<void> {
    const fields = importedCommentFields(origin);
    return this.enqueue({ ...fields, path, targetObjectId,
      identity: { commentId: fields.commentId, createdAt: new Date().toISOString() },
      batch: fields.suggestionBatchId ? { batchId: fields.suggestionBatchId, index: fields.batchIndex ?? 0, note: fields.batchNote } : null,
    }, origin);
  }

  private async enqueue(input: CommentPostInput, legacyOrigin?: LegacyCommentOrigin): Promise<void> {
    const { runtime, workspaceState } = this.deps.plane();
    if (legacyOrigin && legacyOrigin.workspaceId !== runtime.workspaceId) throw new Error("Legacy comment workspace changed");
    const identity = commentWriteIdentity(input.identity);
    await withIdentityWrite(workspaceState, identity.commentId, async () => {
      const object = input.targetObjectId ? await workspaceState.getObjectById(input.targetObjectId) : await workspaceState.getObjectByPath(input.path);
      if (!object?.currentRevisionId || object.deleted) throw new Error("workspace-object-not-synced");
      // The right is checked HERE, before anything is queued: a refusal must be
      // immediate and its own, not a "not sent" card a cycle later.
      const sliceIds = workspaceSliceIdsForObject(runtime.policy.payload, { objectId: object.objectId, path: object.path, contentKind: object.contentKind });
      if (!evaluateWorkspaceAccess(runtime.policy.payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: "comment.create", objectId: object.objectId, sliceIds }).allowed) throw new Error("workspace-comment-not-permitted");
      if (legacyOrigin && !evaluateWorkspaceAccess(runtime.policy.payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: "workspace.manage" }).allowed)
        throw new Error("workspace-comment-import-not-permitted");
      // Into the outbox, not onto the network (K6, finding 2026-09-03). Sealing
      // and the two verified uploads happen in the worker's next cycle, which is
      // triggered right away; the column shows the card now, with a "sending"
      // state, and a failure comes back as a reason on that card.
      const entry: WorkspaceCommentOutboxEntry = {
        outboxId: createWorkspaceObjectId(), commentId: identity.commentId, path: object.path, targetObjectId: object.objectId,
        body: input.body, parentCommentId: input.parentCommentId ?? null, resolvedCommentId: input.resolvedCommentId ?? null,
        anchor: input.anchor ?? null, suggestion: input.suggestion ?? null, suggestionOutcome: input.suggestionOutcome ?? null,
        ...(input.decisionProof ? { decisionProof: input.decisionProof } : {}),
        ...(legacyOrigin ? { legacyOrigin: structuredClone(legacyOrigin) } : {}),
        retractsCommentId: input.retractsCommentId ?? null,
        suggestionBatchId: input.batch?.batchId ?? null, batchIndex: input.batch?.index ?? null, batchNote: input.batch?.note ?? null,
        createdAt: identity.createdAt, attempts: 0, lastError: null,
      };
      // Read the outbox FIRST. The worker saves the immutable record before
      // removing its outbox entry, so a completed publication cannot fall into
      // a gap between these two reads and become another queued publication.
      const queued = (await workspaceState.listCommentOutbox()).find((candidate) => candidate.commentId === entry.commentId);
      if (queued) {
        if (legacyOrigin || queued.legacyOrigin ? !sameLegacyComment(queued, entry)
          : !sameCommentContent(immutableFields(queued), immutableFields(entry))) throw new CommentIdentityConflictError(entry.commentId);
        this.publish();
        return;
      }
      const stored = await workspaceState.getComment(entry.commentId);
      if (stored) {
        if (legacyOrigin || stored.legacyOrigin ? !sameLegacyComment(stored, entry)
          : stored.authorMemberId !== runtime.memberId || stored.authorDeviceId !== runtime.device.publicIdentity.deviceId
          || !sameCommentContent(immutableFields(stored), immutableFields(entry))) throw new CommentIdentityConflictError(entry.commentId);
        return;
      }
      const live = this.deps.plane();
      if (live.workspaceState !== workspaceState || live.runtime !== runtime) throw new Error("workspace-comment-runtime-changed");
      await workspaceState.enqueueCommentOutbox(entry);
      this.publish();
      this.deps.changed(entry.path);
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
