import { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import { runStatementsAtomic } from "../db/batch.js";
import type { WorkspaceCommentAnchor } from "./commentAnchor.js";
import type { PublicationManifest } from "./publication.js";
import type { PublishedSliceConfig } from "./publishedSlices.js";

export type WorkspaceLifecyclePhase = "preparing" | "migrating" | "active" | "locked" | "error";
export type WorkspaceQueueOperation = "write" | "mkdir" | "rename" | "delete";

export interface WorkspaceObjectRecord {
  objectId: string;
  path: string;
  currentRevisionId: string | null;
  payloadHash: string | null;
  plaintextSha256: string | null;
  contentKind: "text" | "binary" | "directory";
  deleted: boolean;
  /** Member who created the object. Empty for rows written before the column existed. */
  authorMemberId: string;
  createdAt: string;
  modifiedAt: string;
}

export interface WorkspaceRevisionRecord {
  revisionId: string;
  objectId: string;
  payloadHash: string | null;
  parentRevisionIds: string[];
  operationHash: string;
  deviceId: string;
  sequence: number;
  materializedPath: string | null;
  plaintextSha256: string | null;
  createdAt?: string;
}

export interface WorkspaceCommentRecord {
  commentId: string;
  targetObjectId: string;
  targetRevisionId: string;
  parentCommentId: string | null;
  authorMemberId: string;
  authorDeviceId: string;
  operationHash: string;
  payloadHash: string;
  body: string;
  /** Where in the note it sits, or null for the note as a whole. */
  anchor: WorkspaceCommentAnchor | null;
  createdAt: string;
  /**
   * A proposal for the anchored passage. `appliedAt`/`declinedAt` are the local
   * verdict, written when the closing marker arrives - the sealed body carries
   * only the replacement, so the outcome never has to be re-signed.
   */
  suggestion: { replacement: string; appliedAt: string | null; appliedBy: string | null; declinedAt: string | null } | null;
  /** Present only on an immutable resolution marker that closes a suggestion. */
  suggestionOutcome?: "applied" | "declined" | null;
  /** Present only on an immutable resolution marker. */
  resolvedCommentId: string | null;
  resolvedAt: string | null;
  /** Present only on a retraction marker (K7); the list functions never return one. */
  retractsCommentId?: string | null;
  /** The round a proposal was sent in (Vorschlagsmodus, V1), with its position and the round's note. */
  suggestionBatchId?: string | null;
  batchIndex?: number | null;
  batchNote?: string | null;
  /** Set on a comment a valid retraction has reached; such a record is never listed. */
  retractedAt?: string | null;
  /**
   * Set only on a remark that is still in this device's outbox (K6, finding
   * 2026-09-03): written the moment somebody pressed send, published by the
   * worker afterwards. Never stored - the shell merges it in from the outbox so
   * the column shows the remark at once instead of after two verified uploads.
   */
  pending?: { outboxId: string; attempts: number; lastError: string | null };
}

/**
 * A remark waiting to be published (K6).
 *
 * Posting used to mean: seal, upload the object, upload the operation - each
 * upload read back twice and listed once - and only then show the card. On a
 * slow store that was seconds of nothing. The outbox turns the order around:
 * the record is written locally first and the worker publishes it in its next
 * cycle (triggered at once), in order, one device sequence at a time.
 *
 * `commentId` is assigned when the entry is queued, so a reply typed while
 * its parent is still in the outbox can already name that parent, and the
 * card the reader sees keeps its id when the publish lands.
 */
export interface WorkspaceCommentOutboxEntry {
  outboxId: string;
  commentId: string;
  path: string;
  targetObjectId: string;
  body: string;
  parentCommentId: string | null;
  resolvedCommentId: string | null;
  anchor: WorkspaceCommentAnchor | null;
  suggestion: { replacement: string } | null;
  suggestionOutcome: "applied" | "declined" | null;
  retractsCommentId?: string | null;
  suggestionBatchId?: string | null;
  batchIndex?: number | null;
  batchNote?: string | null;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

/** The queued remark as the column shows it - the same shape as a stored one, plus `pending`. */
export function outboxEntryAsCommentRecord(entry: WorkspaceCommentOutboxEntry, authorMemberId: string, authorDeviceId: string): WorkspaceCommentRecord {
  return {
    commentId: entry.commentId,
    targetObjectId: entry.targetObjectId,
    targetRevisionId: "",
    parentCommentId: entry.parentCommentId,
    authorMemberId,
    authorDeviceId,
    operationHash: "",
    payloadHash: "",
    body: entry.body,
    anchor: entry.anchor,
    createdAt: entry.createdAt,
    suggestion: entry.suggestion ? { replacement: entry.suggestion.replacement, appliedAt: null, appliedBy: null, declinedAt: null } : null,
    suggestionOutcome: entry.suggestionOutcome,
    resolvedCommentId: entry.resolvedCommentId,
    retractsCommentId: entry.retractsCommentId ?? null,
    suggestionBatchId: entry.suggestionBatchId ?? null,
    batchIndex: entry.batchIndex ?? null,
    batchNote: entry.batchNote ?? null,
    resolvedAt: null,
    pending: { outboxId: entry.outboxId, attempts: entry.attempts, lastError: entry.lastError },
  };
}

/**
 * `resolved` is the worker's own verdict (finding 2026-09-03): the artifact
 * validated on a later pull, or it is gone from the remote. Before, nothing
 * ever closed an entry - a retry that succeeded left the row standing as
 * "pending", and the list only grew.
 */
export type WorkspaceQuarantineStatus = "pending" | "ignored" | "repaired" | "resolved";
export interface WorkspaceQuarantineRecord {
  quarantineId: string;
  artifactKind: "policy" | "recovery" | "operation" | "object" | "catalog" | "checkpoint" | "head" | "grant";
  remoteKey: string;
  /** Original remote bytes. They are protocol ciphertext/control data, never opened plaintext. */
  artifactBase64: string;
  artifactSha256: string;
  errorCode: string;
  /**
   * A stable cause, `<kind>.<family>` (see `quarantineReasons.ts`), so a
   * screen can name it in the person's language and group what belongs
   * together. `reason` stays the raw diagnostic sentence.
   */
  reasonCode: string;
  reason: string;
  /** What the check knew: device, sequence numbers, policy hashes - for the explanation. */
  details: Record<string, unknown> | null;
  firstSeenAt: string;
  lastTriedAt: string;
  status: WorkspaceQuarantineStatus;
  resolvedAt: string | null;
}

export interface WorkspaceLocalForkRecord {
  forkId: string;
  originalPath: string;
  forkPath: string;
  reason: "permission-denied" | "parallel-write" | "path-collision";
  createdAt: string;
}

/**
 * What the publisher remembers about one published slice (S4b).
 *
 * Two fields, two different reasons. The `manifest` is the durable half of the
 * refresh: it says what the publication currently holds, and a plan is derived
 * from it - which is why there is no pending counter here. "Up to date" and
 * "N changes pending" are `planPublicationRefresh(...).length`, and a stored
 * count would be the second copy of a truth that can fall out of step with the
 * first. `lastError` cannot be derived: a refresh fails inside a background
 * cycle, and if nobody writes the reason down the UI later sees only that
 * something is pending, never why it stopped.
 *
 * No key material: the publication's own runtime (device key, group keys) goes
 * to the OS credential store, never into a synchronised database.
 */
export interface WorkspacePublicationRecord {
  publicationId: string;
  sliceId: string;
  /** The config exactly as `createSlicePublication` returned it. */
  config: PublishedSliceConfig;
  manifest: PublicationManifest;
  /** Why the last refresh stopped, or null when it ran to the end. */
  lastError: string | null;
  lastRefreshedAt: string | null;
  createdAt: string;
}

/**
 * Sweep-owned probe cache entry: "the local file at `path` had plaintext hash
 * `plaintextSha256` when its stat read (mtime, size)". Lets the open-time
 * reconcile sweep skip re-reading unchanged files. Purely local bookkeeping —
 * never uploaded, never signed; a stale entry only costs one extra hash.
 */
export interface WorkspaceLocalProbe {
  path: string;
  mtime: number;
  size: number;
  plaintextSha256: string;
}

export interface WorkspaceStagedChunk {
  localPath: string;
  remoteKey: string;
  sha256: string;
}

export interface PreparedWorkspaceMutation {
  operationHash: string;
  operationDocument: string;
  operationRemoteKey: string;
  objectRemoteKey: string | null;
  objectLocalPath: string | null;
  objectSha256: string | null;
  chunks: WorkspaceStagedChunk[];
  /** Later queue entries folded into this immutable mutation. */
  absorbedQueueIds: number[];
  object: WorkspaceObjectRecord;
  revision: WorkspaceRevisionRecord | null;
}

export interface WorkspaceQueuedMutation {
  id: number;
  operation: WorkspaceQueueOperation;
  path: string;
  newPath: string | null;
  queuedAt: number;
  retryCount: number;
  lastError: string | null;
  prepared: PreparedWorkspaceMutation | null;
}

export interface WorkspacePendingPublication {
  catalogs?: Array<{ groupId: string; keyEpoch: number; version: number; hash: string; document: string; remoteKey: string }>;
  catalogHash: string;
  catalogDocument: string;
  catalogRemoteKey: string;
  checkpointHash: string;
  checkpointDocument: string;
  checkpointRemoteKey: string;
  headDocument: string | null;
  headRemoteKey: string | null;
  operationHash: string | null;
  sequence: number;
  catalogVersion: number;
  checkpointVersion: number;
}

export interface WorkspaceRuntimeMeta {
  workspaceId: string;
  memberId: string;
  deviceId: string;
  groupId: string;
  keyEpoch: number;
  policyHash: string;
  phase: WorkspaceLifecyclePhase;
  recoveryConfirmedAt: string;
  sequence: number;
  previousOperationHash: string | null;
  catalogVersion: number;
  previousCatalogHash: string | null;
  catalogHeads?: Record<string, { version: number; hash: string }>;
  checkpointVersion: number;
  previousCheckpointHash: string | null;
  remoteHeadEtag: string | null;
  migrationTotal: number;
  migrationCompleted: number;
  migrationInventoryComplete: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  operationHeads: Record<string, { sequence: number; operationHash: string }>;
  needsPublication: boolean;
  pendingPublication: WorkspacePendingPublication | null;
  /** Durable full-rekey cursor. Optional so pre-P8 local state remains readable. */
  rekeyJob?: WorkspaceRekeyJob | null;
}

export type WorkspaceRekeyMode = "future" | "full";
export type WorkspaceRekeyPhase = "queued" | "rewriting" | "complete" | "failed";

export interface WorkspaceRekeyItem {
  objectId: string;
  path: string;
  baselineRevisionId: string | null;
  complete: boolean;
}

export interface WorkspaceRekeyJob {
  jobId: string;
  mode: WorkspaceRekeyMode;
  subjectKind: "device" | "member" | "owner-transfer" | "manual";
  subjectId: string;
  phase: WorkspaceRekeyPhase;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  total: number;
  completed: number;
  items: WorkspaceRekeyItem[];
  lastError: string | null;
}

export interface CommitWorkspaceMutation {
  object: WorkspaceObjectRecord;
  revision: WorkspaceRevisionRecord | null;
  operationHash: string;
  operationDocument: string;
  deviceId: string;
  sequence: number;
}

export interface WorkspaceStateStore {
  loadMeta(): Promise<WorkspaceRuntimeMeta | null>;
  saveMeta(meta: WorkspaceRuntimeMeta): Promise<void>;
  /**
   * Drops ALL local workspace state (meta, objects, revisions, operations,
   * comments, quarantine, forks, probes, publications, queue). Used to decommission a
   * workspace on this device (Stilllegen P4): without it, re-enabling a workspace
   * on the same vault would trip `requireMeta`'s "belongs to another workspace"
   * guard on the stale meta. Does NOT touch remote objects or the vault files.
   */
  clearWorkspaceState(): Promise<void>;
  listObjects(includeDeleted?: boolean): Promise<WorkspaceObjectRecord[]>;
  getObjectByPath(path: string): Promise<WorkspaceObjectRecord | null>;
  getObjectById(objectId: string): Promise<WorkspaceObjectRecord | null>;
  getRevision(revisionId: string): Promise<WorkspaceRevisionRecord | null>;
  listRevisionsForObject(objectId: string): Promise<WorkspaceRevisionRecord[]>;
  listComments(targetObjectId: string): Promise<WorkspaceCommentRecord[]>;
  /**
   * Every unresolved-marker-free comment of the workspace, for the vault-wide
   * overview (D9). The per-object variant above cannot answer this without one
   * query per object, and a vault has as many objects as it has notes.
   */
  listAllComments(): Promise<WorkspaceCommentRecord[]>;
  saveComment(comment: WorkspaceCommentRecord): Promise<void>;
  /**
   * Applies a retraction the worker has verified against the policy (K7): a
   * moderator's marker. The author's own marker needs no such call - the
   * stores apply it themselves when marker and comment carry one author.
   */
  retractComment(commentId: string, at: string): Promise<void>;
  /** The remarks this device has not published yet (K6), oldest first. */
  listCommentOutbox(): Promise<WorkspaceCommentOutboxEntry[]>;
  enqueueCommentOutbox(entry: WorkspaceCommentOutboxEntry): Promise<void>;
  updateCommentOutbox(outboxId: string, patch: { attempts: number; lastError: string | null }): Promise<void>;
  deleteCommentOutbox(outboxId: string): Promise<void>;
  listQuarantine(status?: WorkspaceQuarantineStatus): Promise<WorkspaceQuarantineRecord[]>;
  saveQuarantine(record: WorkspaceQuarantineRecord): Promise<void>;
  setQuarantineStatus(quarantineId: string, status: WorkspaceQuarantineStatus): Promise<void>;
  /** Closes every open entry for this remote artifact; returns the ids it closed. */
  resolveQuarantine(artifactKind: WorkspaceQuarantineRecord["artifactKind"], remoteKey: string, at: string): Promise<string[]>;
  listLocalForks(): Promise<WorkspaceLocalForkRecord[]>;
  saveLocalFork(record: WorkspaceLocalForkRecord): Promise<void>;
  listPublications(): Promise<WorkspacePublicationRecord[]>;
  getPublication(publicationId: string): Promise<WorkspacePublicationRecord | null>;
  savePublication(record: WorkspacePublicationRecord): Promise<void>;
  deletePublication(publicationId: string): Promise<void>;
  listLocalProbes(): Promise<WorkspaceLocalProbe[]>;
  upsertLocalProbes(probes: WorkspaceLocalProbe[]): Promise<void>;
  deleteLocalProbes(paths: string[]): Promise<void>;
  hasOperation(operationHash: string): Promise<boolean>;
  hasPendingForPath(path: string): Promise<boolean>;
  /** Every path referenced by a queued mutation (path + rename target), for bulk pending checks. */
  listQueuedPaths(): Promise<string[]>;
  enqueue(operation: WorkspaceQueueOperation, path: string, newPath?: string | null): Promise<number>;
  listQueue(limit?: number): Promise<WorkspaceQueuedMutation[]>;
  reservePrepared(queueId: number, prepared: PreparedWorkspaceMutation, meta: WorkspaceRuntimeMeta): Promise<void>;
  discardQueue(queueId: number): Promise<void>;
  markQueueFailed(queueId: number, message: string): Promise<void>;
  retryFailed(): Promise<void>;
  commitQueued(queueId: number, mutation: CommitWorkspaceMutation, meta: WorkspaceRuntimeMeta, absorbedQueueIds?: number[]): Promise<void>;
  recordIncoming(mutation: CommitWorkspaceMutation, setCurrent: boolean, meta: WorkspaceRuntimeMeta): Promise<void>;
  recordObservedOperation(operationHash: string, operationDocument: string, deviceId: string, sequence: number, meta: WorkspaceRuntimeMeta): Promise<void>;
}

/**
 * One place turns a comment row into a record. Two call sites read comments
 * (per object and vault-wide); a second copy of this mapping is a second
 * chance for the two to drift.
 */
function commentFromRow(row: CommentRow): WorkspaceCommentRecord {
  return { commentId: row.comment_id, targetObjectId: row.target_object_id, targetRevisionId: row.target_revision_id, parentCommentId: row.parent_comment_id, authorMemberId: row.author_member_id, authorDeviceId: row.author_device_id, operationHash: row.operation_hash, payloadHash: row.payload_hash, body: row.body, anchor: parseCommentAnchor(row.anchor), suggestion: row.suggestion === null ? null : { replacement: row.suggestion, appliedAt: row.suggestion_applied_at, appliedBy: row.suggestion_applied_by, declinedAt: row.suggestion_declined_at }, createdAt: row.created_at, resolvedCommentId: row.resolved_comment_id, resolvedAt: row.resolved_at, retractsCommentId: row.retracts_comment_id ?? null, retractedAt: row.retracted_at ?? null, suggestionBatchId: row.suggestion_batch_id ?? null, batchIndex: row.batch_index === null || row.batch_index === undefined ? null : Number(row.batch_index), batchNote: row.batch_note ?? null };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Deterministic repository used by worker, crash-resume and two-device tests. */
export class MemoryWorkspaceStateStore implements WorkspaceStateStore {
  private meta: WorkspaceRuntimeMeta | null = null;
  private readonly objects = new Map<string, WorkspaceObjectRecord>();
  private readonly revisions = new Map<string, WorkspaceRevisionRecord>();
  private readonly operations = new Map<string, CommitWorkspaceMutation>();
  private readonly comments = new Map<string, WorkspaceCommentRecord>();
  private readonly commentOutbox = new Map<string, WorkspaceCommentOutboxEntry>();
  private readonly quarantine = new Map<string, WorkspaceQuarantineRecord>();
  private readonly forks = new Map<string, WorkspaceLocalForkRecord>();
  private readonly publications = new Map<string, WorkspacePublicationRecord>();
  private readonly probes = new Map<string, WorkspaceLocalProbe>();
  private readonly queue: WorkspaceQueuedMutation[] = [];
  private nextQueueId = 1;

  async loadMeta(): Promise<WorkspaceRuntimeMeta | null> { return this.meta ? clone(this.meta) : null; }
  async saveMeta(meta: WorkspaceRuntimeMeta): Promise<void> { this.meta = clone(meta); }
  async clearWorkspaceState(): Promise<void> {
    this.meta = null;
    this.objects.clear();
    this.revisions.clear();
    this.operations.clear();
    this.comments.clear();
    this.commentOutbox.clear();
    this.quarantine.clear();
    this.forks.clear();
    this.publications.clear();
    this.probes.clear();
    this.queue.length = 0;
    this.nextQueueId = 1;
  }
  async listObjects(includeDeleted = false): Promise<WorkspaceObjectRecord[]> {
    return [...this.objects.values()].filter((value) => includeDeleted || !value.deleted).map(clone).sort((a, b) => a.path.localeCompare(b.path));
  }
  async getObjectByPath(path: string): Promise<WorkspaceObjectRecord | null> {
    return clone([...this.objects.values()].find((value) => value.path === path) ?? null);
  }
  async getObjectById(objectId: string): Promise<WorkspaceObjectRecord | null> { return clone(this.objects.get(objectId) ?? null); }
  async getRevision(revisionId: string): Promise<WorkspaceRevisionRecord | null> { return clone(this.revisions.get(revisionId) ?? null); }
  async listRevisionsForObject(objectId: string): Promise<WorkspaceRevisionRecord[]> {
    return [...this.revisions.values()].filter((entry) => entry.objectId === objectId).map(clone).sort((a, b) => b.sequence - a.sequence || a.revisionId.localeCompare(b.revisionId));
  }
  async listComments(targetObjectId: string): Promise<WorkspaceCommentRecord[]> {
    return (await this.listAllComments()).filter((entry) => entry.targetObjectId === targetObjectId);
  }
  async listAllComments(): Promise<WorkspaceCommentRecord[]> {
    // Markers of either kind are facts about other records, never cards; a
    // retracted comment is gone, and so is every reply under it (K7) - a reply
    // without its root would otherwise surface as a root of its own.
    const retracted = new Set([...this.comments.values()].filter((entry) => entry.retractedAt).map((entry) => entry.commentId));
    return [...this.comments.values()]
      .filter((entry) => !entry.resolvedCommentId && !entry.retractsCommentId && !entry.retractedAt && !(entry.parentCommentId && retracted.has(entry.parentCommentId)))
      .map(clone)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.commentId.localeCompare(b.commentId));
  }
  async retractComment(commentId: string, at: string): Promise<void> {
    const target = this.comments.get(commentId);
    if (target) target.retractedAt = at;
  }
  async listCommentOutbox(): Promise<WorkspaceCommentOutboxEntry[]> {
    return [...this.commentOutbox.values()].map(clone).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.outboxId.localeCompare(b.outboxId));
  }
  async enqueueCommentOutbox(entry: WorkspaceCommentOutboxEntry): Promise<void> { this.commentOutbox.set(entry.outboxId, clone(entry)); }
  async updateCommentOutbox(outboxId: string, patch: { attempts: number; lastError: string | null }): Promise<void> {
    const entry = this.commentOutbox.get(outboxId);
    if (entry) { entry.attempts = patch.attempts; entry.lastError = patch.lastError; }
  }
  async deleteCommentOutbox(outboxId: string): Promise<void> { this.commentOutbox.delete(outboxId); }
  async saveComment(comment: WorkspaceCommentRecord): Promise<void> {
    this.comments.set(comment.commentId, clone(comment));
    // The author's own retraction applies in either arrival order: marker
    // first or comment first. A stranger's marker does nothing here - the
    // worker applies a moderator's through `retractComment` after checking
    // the policy, which this store cannot read.
    if (comment.retractsCommentId) {
      const target = this.comments.get(comment.retractsCommentId);
      if (target && target.authorMemberId === comment.authorMemberId) target.retractedAt = comment.createdAt;
      return;
    }
    const retraction = [...this.comments.values()].find((entry) => entry.retractsCommentId === comment.commentId && entry.authorMemberId === comment.authorMemberId);
    if (retraction) this.comments.get(comment.commentId)!.retractedAt = retraction.createdAt;
    if (comment.resolvedCommentId) {
      const target = this.comments.get(comment.resolvedCommentId);
      if (target) target.resolvedAt = comment.createdAt;
    } else {
      const resolution = [...this.comments.values()].filter((entry) => entry.resolvedCommentId === comment.commentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (resolution) this.comments.get(comment.commentId)!.resolvedAt = resolution.createdAt;
    }
  }
  async listQuarantine(status?: WorkspaceQuarantineStatus): Promise<WorkspaceQuarantineRecord[]> {
    return [...this.quarantine.values()].filter((entry) => !status || entry.status === status).map(clone).sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));
  }
  async saveQuarantine(record: WorkspaceQuarantineRecord): Promise<void> {
    const existing = this.quarantine.get(record.quarantineId);
    // Same upsert as the SQL store: an ignored entry stays ignored, a
    // re-quarantined one reopens.
    const status = existing?.status === "ignored" ? "ignored" : record.status;
    this.quarantine.set(record.quarantineId, clone({ ...record, firstSeenAt: existing?.firstSeenAt ?? record.firstSeenAt, status, resolvedAt: status === "resolved" ? record.resolvedAt : null }));
  }
  async setQuarantineStatus(quarantineId: string, status: WorkspaceQuarantineStatus): Promise<void> {
    const record = this.quarantine.get(quarantineId);
    if (record) { record.status = status; if (status === "pending") record.resolvedAt = null; }
  }
  async resolveQuarantine(artifactKind: WorkspaceQuarantineRecord["artifactKind"], remoteKey: string, at: string): Promise<string[]> {
    const resolved: string[] = [];
    for (const record of this.quarantine.values()) {
      if (record.artifactKind !== artifactKind || record.remoteKey !== remoteKey || (record.status !== "pending" && record.status !== "repaired")) continue;
      record.status = "resolved"; record.resolvedAt = at; resolved.push(record.quarantineId);
    }
    return resolved;
  }
  async listLocalForks(): Promise<WorkspaceLocalForkRecord[]> { return [...this.forks.values()].map(clone).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async saveLocalFork(record: WorkspaceLocalForkRecord): Promise<void> { this.forks.set(record.forkId, clone(record)); }
  async listPublications(): Promise<WorkspacePublicationRecord[]> { return [...this.publications.values()].map(clone).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async getPublication(publicationId: string): Promise<WorkspacePublicationRecord | null> { return clone(this.publications.get(publicationId) ?? null); }
  async savePublication(record: WorkspacePublicationRecord): Promise<void> {
    // Keep the original creation moment, exactly as the SQL upsert does: a
    // caller that re-derives the record has no reason to carry it forward,
    // and two stores that disagree here would let a test pass on one and
    // fail on the other.
    const existing = this.publications.get(record.publicationId);
    this.publications.set(record.publicationId, clone({ ...record, createdAt: existing?.createdAt ?? record.createdAt }));
  }
  async deletePublication(publicationId: string): Promise<void> { this.publications.delete(publicationId); }
  async listLocalProbes(): Promise<WorkspaceLocalProbe[]> { return [...this.probes.values()].map(clone).sort((a, b) => a.path.localeCompare(b.path)); }
  async upsertLocalProbes(probes: WorkspaceLocalProbe[]): Promise<void> {
    for (const probe of probes) this.probes.set(probe.path, clone(probe));
  }
  async deleteLocalProbes(paths: string[]): Promise<void> {
    for (const path of paths) this.probes.delete(path);
  }
  async hasOperation(operationHash: string): Promise<boolean> { return this.operations.has(operationHash); }
  async hasPendingForPath(path: string): Promise<boolean> {
    return this.queue.some((entry) => entry.path === path || entry.newPath === path);
  }
  async listQueuedPaths(): Promise<string[]> {
    return this.queue.flatMap((entry) => (entry.newPath ? [entry.path, entry.newPath] : [entry.path]));
  }
  async enqueue(operation: WorkspaceQueueOperation, path: string, newPath: string | null = null): Promise<number> {
    const item: WorkspaceQueuedMutation = { id: this.nextQueueId++, operation, path, newPath, queuedAt: Date.now(), retryCount: 0, lastError: null, prepared: null };
    this.queue.push(item);
    return item.id;
  }
  async listQueue(limit = Number.MAX_SAFE_INTEGER): Promise<WorkspaceQueuedMutation[]> {
    return this.queue.slice(0, limit).map(clone);
  }
  async reservePrepared(queueId: number, prepared: PreparedWorkspaceMutation, meta: WorkspaceRuntimeMeta): Promise<void> {
    const item = this.queue.find((entry) => entry.id === queueId);
    if (!item) throw new Error("workspace queue item disappeared");
    item.prepared = clone(prepared);
    this.meta = clone(meta);
  }
  async discardQueue(queueId: number): Promise<void> {
    const index = this.queue.findIndex((entry) => entry.id === queueId);
    if (index >= 0) this.queue.splice(index, 1);
  }
  async markQueueFailed(queueId: number, message: string): Promise<void> {
    const item = this.queue.find((entry) => entry.id === queueId);
    if (!item) return;
    item.retryCount += 1;
    item.lastError = message;
  }
  async retryFailed(): Promise<void> {
    for (const item of this.queue) item.lastError = null;
  }
  async commitQueued(queueId: number, mutation: CommitWorkspaceMutation, meta: WorkspaceRuntimeMeta, absorbedQueueIds: number[] = []): Promise<void> {
    this.commitMutation(mutation, true);
    const completed = new Set([queueId, ...absorbedQueueIds]);
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (completed.has(this.queue[index].id)) this.queue.splice(index, 1);
    }
    this.meta = clone(meta);
  }
  async recordIncoming(mutation: CommitWorkspaceMutation, setCurrent: boolean, meta: WorkspaceRuntimeMeta): Promise<void> {
    this.commitMutation(mutation, setCurrent);
    this.meta = clone(meta);
  }
  async recordObservedOperation(operationHash: string, operationDocument: string, deviceId: string, sequence: number, meta: WorkspaceRuntimeMeta): Promise<void> {
    this.operations.set(operationHash, { operationHash, operationDocument, deviceId, sequence, object: {} as WorkspaceObjectRecord, revision: null });
    this.meta = clone(meta);
  }
  private commitMutation(mutation: CommitWorkspaceMutation, setCurrent: boolean): void {
    this.operations.set(mutation.operationHash, clone(mutation));
    if (mutation.revision) this.revisions.set(mutation.revision.revisionId, clone(mutation.revision));
    if (setCurrent) this.objects.set(mutation.object.objectId, clone(mutation.object));
  }
}

interface ObjectRow {
  object_id: string;
  path: string;
  current_revision_id: string | null;
  payload_hash: string | null;
  plaintext_sha256: string | null;
  content_kind: WorkspaceObjectRecord["contentKind"];
  deleted: number;
  author_member_id?: string | null;
  created_at: string;
  modified_at: string;
}

interface RevisionRow {
  revision_id: string;
  object_id: string;
  payload_hash: string | null;
  parent_revision_ids: string;
  operation_hash: string;
  device_id: string;
  sequence: number;
  materialized_path: string | null;
  plaintext_sha256: string | null;
  created_at?: string | null;
}

interface QueueRow {
  id: number;
  operation: WorkspaceQueueOperation;
  path: string;
  new_path: string | null;
  queued_at: number;
  retry_count: number;
  last_error: string | null;
  prepared_json: string | null;
}

/** A stored anchor, or null. A row written before anchors existed has none. */
function parseCommentAnchor(value: string | null): WorkspaceCommentAnchor | null {
  if (!value) return null;
  try { return JSON.parse(value) as WorkspaceCommentAnchor; }
  catch { return null; }
}

interface CommentRow {
  comment_id: string; target_object_id: string; target_revision_id: string; parent_comment_id: string | null;
  author_member_id: string; author_device_id: string; operation_hash: string; payload_hash: string;
  body: string; anchor: string | null; suggestion: string | null; suggestion_applied_at: string | null; suggestion_applied_by: string | null; suggestion_declined_at: string | null; created_at: string; resolved_comment_id: string | null; resolved_at: string | null;
  retracts_comment_id?: string | null; retracted_at?: string | null;
  suggestion_batch_id?: string | null; batch_index?: number | null; batch_note?: string | null;
}

interface CommentOutboxRow {
  outbox_id: string; comment_id: string; path: string; target_object_id: string; body: string;
  parent_comment_id: string | null; resolved_comment_id: string | null; anchor: string | null; suggestion: string | null;
  suggestion_outcome: "applied" | "declined" | null; created_at: string; attempts: number; last_error: string | null;
  retracts_comment_id?: string | null;
  suggestion_batch_id?: string | null; batch_index?: number | null; batch_note?: string | null;
}

function commentOutboxFromRow(row: CommentOutboxRow): WorkspaceCommentOutboxEntry {
  return {
    outboxId: row.outbox_id, commentId: row.comment_id, path: row.path, targetObjectId: row.target_object_id, body: row.body,
    parentCommentId: row.parent_comment_id, resolvedCommentId: row.resolved_comment_id, anchor: parseCommentAnchor(row.anchor),
    // JSON rather than the bare replacement: an empty replacement is a deletion, and "" is not null.
    suggestion: row.suggestion === null ? null : (JSON.parse(row.suggestion) as { replacement: string }),
    suggestionOutcome: row.suggestion_outcome, retractsCommentId: row.retracts_comment_id ?? null,
    suggestionBatchId: row.suggestion_batch_id ?? null, batchIndex: row.batch_index === null || row.batch_index === undefined ? null : Number(row.batch_index), batchNote: row.batch_note ?? null,
    createdAt: row.created_at, attempts: Number(row.attempts), lastError: row.last_error,
  };
}

interface QuarantineRow {
  quarantine_id: string; artifact_kind: WorkspaceQuarantineRecord["artifactKind"]; remote_key: string;
  artifact_base64: string; artifact_sha256: string; error_code: string; reason_code: string | null; reason: string;
  details_json: string | null; first_seen_at: string; last_tried_at: string; status: WorkspaceQuarantineStatus; resolved_at: string | null;
}

function parseQuarantineDetails(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface ForkRow {
  fork_id: string; original_path: string; fork_path: string; reason: WorkspaceLocalForkRecord["reason"]; created_at: string;
}

interface PublicationRow {
  publication_id: string; slice_id: string; config_json: string; manifest_json: string;
  last_error: string | null; last_refreshed_at: string | null; created_at: string;
}

function publicationFromRow(row: PublicationRow): WorkspacePublicationRecord {
  return {
    publicationId: row.publication_id,
    sliceId: row.slice_id,
    config: JSON.parse(row.config_json) as PublishedSliceConfig,
    manifest: JSON.parse(row.manifest_json) as PublicationManifest,
    lastError: row.last_error,
    lastRefreshedAt: row.last_refreshed_at,
    createdAt: row.created_at,
  };
}

function objectFromRow(row: ObjectRow): WorkspaceObjectRecord {
  return {
    objectId: row.object_id,
    path: row.path,
    currentRevisionId: row.current_revision_id,
    payloadHash: row.payload_hash,
    plaintextSha256: row.plaintext_sha256,
    contentKind: row.content_kind,
    deleted: row.deleted === 1,
    createdAt: row.created_at,
    authorMemberId: row.author_member_id ?? "",
    modifiedAt: row.modified_at,
  };
}

function revisionFromRow(row: RevisionRow): WorkspaceRevisionRecord {
  return {
    revisionId: row.revision_id,
    objectId: row.object_id,
    payloadHash: row.payload_hash,
    parentRevisionIds: JSON.parse(row.parent_revision_ids) as string[],
    operationHash: row.operation_hash,
    deviceId: row.device_id,
    sequence: row.sequence,
    materializedPath: row.materialized_path,
    plaintextSha256: row.plaintext_sha256,
    createdAt: row.created_at ?? undefined,
  };
}

function objectWrite(record: WorkspaceObjectRecord) {
  return {
    // author_member_id is deliberately absent from DO UPDATE, like created_at: who made an
    // object never changes, and a later writer must not be able to claim authorship of it.
    sql: `INSERT INTO workspace_object
      (object_id,path,current_revision_id,payload_hash,plaintext_sha256,content_kind,deleted,author_member_id,created_at,modified_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(object_id) DO UPDATE SET path=excluded.path,current_revision_id=excluded.current_revision_id,
        payload_hash=excluded.payload_hash,plaintext_sha256=excluded.plaintext_sha256,content_kind=excluded.content_kind,
        deleted=excluded.deleted,modified_at=excluded.modified_at`,
    params: [record.objectId, record.path, record.currentRevisionId, record.payloadHash, record.plaintextSha256, record.contentKind, record.deleted ? 1 : 0, record.authorMemberId, record.createdAt, record.modifiedAt],
  };
}

function revisionWrite(record: WorkspaceRevisionRecord) {
  return {
    sql: `INSERT OR IGNORE INTO workspace_revision
      (revision_id,object_id,payload_hash,parent_revision_ids,operation_hash,device_id,sequence,materialized_path,plaintext_sha256,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
    params: [record.revisionId, record.objectId, record.payloadHash, JSON.stringify(record.parentRevisionIds), record.operationHash, record.deviceId, record.sequence, record.materializedPath, record.plaintextSha256, record.createdAt ?? new Date(0).toISOString()],
  };
}

/** SQLite-backed crash-safe P3 repository. Private keys never enter these tables. */
export class SqlWorkspaceStateStore implements WorkspaceStateStore {
  constructor(private readonly db: IDatabaseAdapter) {}

  async loadMeta(): Promise<WorkspaceRuntimeMeta | null> {
    const row = await this.db.queryOne<{ state_json: string }>(`SELECT state_json FROM workspace_meta WHERE id = 1`);
    return row ? JSON.parse(row.state_json) as WorkspaceRuntimeMeta : null;
  }
  async saveMeta(meta: WorkspaceRuntimeMeta): Promise<void> {
    await this.db.execute(
      `INSERT INTO workspace_meta (id,state_json) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json`,
      [JSON.stringify(meta)]
    );
  }
  async clearWorkspaceState(): Promise<void> {
    await runStatementsAtomic(
      this.db,
      [
        "workspace_meta",
        "workspace_object",
        "workspace_revision",
        "workspace_operation",
        "workspace_comment",
        "workspace_comment_outbox",
        "workspace_quarantine",
        "workspace_local_fork",
        "workspace_local_probe",
        "workspace_publication",
        "workspace_queue",
        "workspace_checkpoint",
      ].map((table) => ({ sql: `DELETE FROM ${table}`, params: [] }))
    );
  }
  async listObjects(includeDeleted = false): Promise<WorkspaceObjectRecord[]> {
    const rows = await this.db.query<ObjectRow>(`SELECT * FROM workspace_object ${includeDeleted ? "" : "WHERE deleted = 0"} ORDER BY path`);
    return rows.map(objectFromRow);
  }
  async getObjectByPath(path: string): Promise<WorkspaceObjectRecord | null> {
    const row = await this.db.queryOne<ObjectRow>(`SELECT * FROM workspace_object WHERE path = ? LIMIT 1`, [path]);
    return row ? objectFromRow(row) : null;
  }
  async getObjectById(objectId: string): Promise<WorkspaceObjectRecord | null> {
    const row = await this.db.queryOne<ObjectRow>(`SELECT * FROM workspace_object WHERE object_id = ? LIMIT 1`, [objectId]);
    return row ? objectFromRow(row) : null;
  }
  async getRevision(revisionId: string): Promise<WorkspaceRevisionRecord | null> {
    const row = await this.db.queryOne<RevisionRow>(`SELECT * FROM workspace_revision WHERE revision_id = ? LIMIT 1`, [revisionId]);
    return row ? revisionFromRow(row) : null;
  }
  async listRevisionsForObject(objectId: string): Promise<WorkspaceRevisionRecord[]> {
    return (await this.db.query<RevisionRow>(`SELECT * FROM workspace_revision WHERE object_id = ? ORDER BY sequence DESC, revision_id`, [objectId])).map(revisionFromRow);
  }
  async listComments(targetObjectId: string): Promise<WorkspaceCommentRecord[]> {
    const rows = await this.db.query<CommentRow>(`SELECT comment_id,target_object_id,target_revision_id,parent_comment_id,author_member_id,author_device_id,operation_hash,payload_hash,body,anchor,suggestion,suggestion_applied_at,suggestion_applied_by,suggestion_declined_at,created_at,resolved_comment_id,resolved_at,retracts_comment_id,retracted_at,suggestion_batch_id,batch_index,batch_note FROM workspace_comment WHERE target_object_id = ? AND resolved_comment_id IS NULL AND retracts_comment_id IS NULL AND retracted_at IS NULL AND (parent_comment_id IS NULL OR parent_comment_id NOT IN (SELECT comment_id FROM workspace_comment WHERE retracted_at IS NOT NULL)) ORDER BY created_at, comment_id`, [targetObjectId]);
    return rows.map(commentFromRow);
  }
  async listAllComments(): Promise<WorkspaceCommentRecord[]> {
    const rows = await this.db.query<CommentRow>(`SELECT comment_id,target_object_id,target_revision_id,parent_comment_id,author_member_id,author_device_id,operation_hash,payload_hash,body,anchor,suggestion,suggestion_applied_at,suggestion_applied_by,suggestion_declined_at,created_at,resolved_comment_id,resolved_at,retracts_comment_id,retracted_at,suggestion_batch_id,batch_index,batch_note FROM workspace_comment WHERE resolved_comment_id IS NULL AND retracts_comment_id IS NULL AND retracted_at IS NULL AND (parent_comment_id IS NULL OR parent_comment_id NOT IN (SELECT comment_id FROM workspace_comment WHERE retracted_at IS NOT NULL)) ORDER BY created_at, comment_id`);
    return rows.map(commentFromRow);
  }
  async retractComment(commentId: string, at: string): Promise<void> {
    await this.db.execute(`UPDATE workspace_comment SET retracted_at = ? WHERE comment_id = ?`, [at, commentId]);
  }
  async listCommentOutbox(): Promise<WorkspaceCommentOutboxEntry[]> {
    const rows = await this.db.query<CommentOutboxRow>(`SELECT outbox_id,comment_id,path,target_object_id,body,parent_comment_id,resolved_comment_id,retracts_comment_id,anchor,suggestion,suggestion_outcome,created_at,attempts,last_error,suggestion_batch_id,batch_index,batch_note FROM workspace_comment_outbox ORDER BY created_at, outbox_id`);
    return rows.map(commentOutboxFromRow);
  }
  async enqueueCommentOutbox(entry: WorkspaceCommentOutboxEntry): Promise<void> {
    await this.db.execute(`INSERT INTO workspace_comment_outbox (outbox_id,comment_id,path,target_object_id,body,parent_comment_id,resolved_comment_id,retracts_comment_id,anchor,suggestion,suggestion_outcome,created_at,attempts,last_error,suggestion_batch_id,batch_index,batch_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [entry.outboxId, entry.commentId, entry.path, entry.targetObjectId, entry.body, entry.parentCommentId, entry.resolvedCommentId, entry.retractsCommentId ?? null, entry.anchor ? JSON.stringify(entry.anchor) : null, entry.suggestion ? JSON.stringify(entry.suggestion) : null, entry.suggestionOutcome, entry.createdAt, entry.attempts, entry.lastError, entry.suggestionBatchId ?? null, entry.batchIndex ?? null, entry.batchNote ?? null]);
  }
  async updateCommentOutbox(outboxId: string, patch: { attempts: number; lastError: string | null }): Promise<void> {
    await this.db.execute(`UPDATE workspace_comment_outbox SET attempts = ?, last_error = ? WHERE outbox_id = ?`, [patch.attempts, patch.lastError, outboxId]);
  }
  async deleteCommentOutbox(outboxId: string): Promise<void> {
    await this.db.execute(`DELETE FROM workspace_comment_outbox WHERE outbox_id = ?`, [outboxId]);
  }
  async saveComment(comment: WorkspaceCommentRecord): Promise<void> {
    await this.db.execute(`INSERT INTO workspace_comment (comment_id,target_object_id,target_revision_id,parent_comment_id,author_member_id,author_device_id,operation_hash,payload_hash,body,anchor,suggestion,created_at,resolved_comment_id,resolved_at,retracts_comment_id,suggestion_batch_id,batch_index,batch_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(comment_id) DO UPDATE SET resolved_at=excluded.resolved_at`, [comment.commentId, comment.targetObjectId, comment.targetRevisionId, comment.parentCommentId, comment.authorMemberId, comment.authorDeviceId, comment.operationHash, comment.payloadHash, comment.body, comment.anchor ? JSON.stringify(comment.anchor) : null, comment.suggestion ? comment.suggestion.replacement : null, comment.createdAt, comment.resolvedCommentId, comment.resolvedAt, comment.retractsCommentId ?? null, comment.suggestionBatchId ?? null, comment.batchIndex ?? null, comment.batchNote ?? null]);
    // The author's own retraction, in either arrival order (K7). A moderator's
    // goes through `retractComment` once the worker has checked the policy.
    if (comment.retractsCommentId) {
      await this.db.execute(`UPDATE workspace_comment SET retracted_at = ? WHERE comment_id = ? AND author_member_id = ?`, [comment.createdAt, comment.retractsCommentId, comment.authorMemberId]);
      return;
    }
    await this.db.execute(`UPDATE workspace_comment SET retracted_at = (SELECT MIN(created_at) FROM workspace_comment r WHERE r.retracts_comment_id = ? AND r.author_member_id = ?) WHERE comment_id = ? AND EXISTS (SELECT 1 FROM workspace_comment r WHERE r.retracts_comment_id = ? AND r.author_member_id = ?)`, [comment.commentId, comment.authorMemberId, comment.commentId, comment.commentId, comment.authorMemberId]);
    if (comment.resolvedCommentId) {
      await this.db.execute(`UPDATE workspace_comment SET resolved_at = ? WHERE comment_id = ?`, [comment.createdAt, comment.resolvedCommentId]);
      // Accepting and declining both resolve; only the outcome tells a second
      // device which of the two happened, because the accepted write itself
      // carries nothing that points back at the suggestion.
      if (comment.suggestionOutcome === "applied") await this.db.execute(`UPDATE workspace_comment SET suggestion_applied_at = ?, suggestion_applied_by = ? WHERE comment_id = ?`, [comment.createdAt, comment.authorMemberId, comment.resolvedCommentId]);
      else if (comment.suggestionOutcome === "declined") await this.db.execute(`UPDATE workspace_comment SET suggestion_declined_at = ? WHERE comment_id = ?`, [comment.createdAt, comment.resolvedCommentId]);
    }
    else await this.db.execute(`UPDATE workspace_comment SET resolved_at = (SELECT MAX(created_at) FROM workspace_comment WHERE resolved_comment_id = ?) WHERE comment_id = ? AND EXISTS (SELECT 1 FROM workspace_comment WHERE resolved_comment_id = ?)`, [comment.commentId, comment.commentId, comment.commentId]);
  }
  async listQuarantine(status?: WorkspaceQuarantineStatus): Promise<WorkspaceQuarantineRecord[]> {
    const rows = await this.db.query<QuarantineRow>(`SELECT * FROM workspace_quarantine ${status ? "WHERE status = ?" : ""} ORDER BY first_seen_at DESC`, status ? [status] : []);
    // An entry written before the cause code existed carries none; the
    // screens then fall back to the raw sentence.
    return rows.map((row) => ({ quarantineId: row.quarantine_id, artifactKind: row.artifact_kind, remoteKey: row.remote_key, artifactBase64: row.artifact_base64, artifactSha256: row.artifact_sha256, errorCode: row.error_code, reasonCode: row.reason_code ?? "unknown", reason: row.reason, details: parseQuarantineDetails(row.details_json), firstSeenAt: row.first_seen_at, lastTriedAt: row.last_tried_at, status: row.status, resolvedAt: row.resolved_at ?? null }));
  }
  async saveQuarantine(record: WorkspaceQuarantineRecord): Promise<void> {
    // A re-quarantined artifact reopens (resolved_at cleared) unless the
    // person ignored it - that verdict outlives every retry.
    await this.db.execute(`INSERT INTO workspace_quarantine (quarantine_id,artifact_kind,remote_key,artifact_base64,artifact_sha256,error_code,reason_code,reason,details_json,first_seen_at,last_tried_at,status,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(quarantine_id) DO UPDATE SET last_tried_at=excluded.last_tried_at,error_code=excluded.error_code,reason_code=excluded.reason_code,reason=excluded.reason,details_json=excluded.details_json,status=CASE WHEN workspace_quarantine.status='ignored' THEN 'ignored' ELSE excluded.status END,resolved_at=CASE WHEN workspace_quarantine.status='ignored' THEN workspace_quarantine.resolved_at ELSE excluded.resolved_at END`, [record.quarantineId, record.artifactKind, record.remoteKey, record.artifactBase64, record.artifactSha256, record.errorCode, record.reasonCode, record.reason, record.details ? JSON.stringify(record.details) : null, record.firstSeenAt, record.lastTriedAt, record.status, record.resolvedAt]);
  }
  async setQuarantineStatus(quarantineId: string, status: WorkspaceQuarantineStatus): Promise<void> {
    await this.db.execute(`UPDATE workspace_quarantine SET status = ?, resolved_at = CASE WHEN ? = 'pending' THEN NULL ELSE resolved_at END WHERE quarantine_id = ?`, [status, status, quarantineId]);
  }
  async resolveQuarantine(artifactKind: WorkspaceQuarantineRecord["artifactKind"], remoteKey: string, at: string): Promise<string[]> {
    const rows = await this.db.query<{ quarantine_id: string }>(`SELECT quarantine_id FROM workspace_quarantine WHERE artifact_kind = ? AND remote_key = ? AND status IN ('pending','repaired')`, [artifactKind, remoteKey]);
    if (rows.length === 0) return [];
    await this.db.execute(`UPDATE workspace_quarantine SET status = 'resolved', resolved_at = ? WHERE artifact_kind = ? AND remote_key = ? AND status IN ('pending','repaired')`, [at, artifactKind, remoteKey]);
    return rows.map((row) => row.quarantine_id);
  }
  async listLocalForks(): Promise<WorkspaceLocalForkRecord[]> {
    const rows = await this.db.query<ForkRow>(`SELECT * FROM workspace_local_fork ORDER BY created_at DESC`);
    return rows.map((row) => ({ forkId: row.fork_id, originalPath: row.original_path, forkPath: row.fork_path, reason: row.reason, createdAt: row.created_at }));
  }
  async saveLocalFork(record: WorkspaceLocalForkRecord): Promise<void> {
    await this.db.execute(`INSERT OR REPLACE INTO workspace_local_fork (fork_id,original_path,fork_path,reason,created_at) VALUES (?,?,?,?,?)`, [record.forkId, record.originalPath, record.forkPath, record.reason, record.createdAt]);
  }
  async listPublications(): Promise<WorkspacePublicationRecord[]> {
    const rows = await this.db.query<PublicationRow>(`SELECT * FROM workspace_publication ORDER BY created_at, publication_id`);
    return rows.map(publicationFromRow);
  }
  async getPublication(publicationId: string): Promise<WorkspacePublicationRecord | null> {
    const row = await this.db.queryOne<PublicationRow>(`SELECT * FROM workspace_publication WHERE publication_id = ? LIMIT 1`, [publicationId]);
    return row ? publicationFromRow(row) : null;
  }
  async savePublication(record: WorkspacePublicationRecord): Promise<void> {
    // `created_at` is deliberately not updated: a publication keeps the moment
    // it was created, and every later save is a refresh of what it holds.
    await this.db.execute(
      `INSERT INTO workspace_publication (publication_id,slice_id,config_json,manifest_json,last_error,last_refreshed_at,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(publication_id) DO UPDATE SET slice_id=excluded.slice_id,config_json=excluded.config_json,manifest_json=excluded.manifest_json,last_error=excluded.last_error,last_refreshed_at=excluded.last_refreshed_at`,
      [record.publicationId, record.sliceId, JSON.stringify(record.config), JSON.stringify(record.manifest), record.lastError, record.lastRefreshedAt, record.createdAt]
    );
  }
  async deletePublication(publicationId: string): Promise<void> {
    await this.db.execute(`DELETE FROM workspace_publication WHERE publication_id = ?`, [publicationId]);
  }
  async listLocalProbes(): Promise<WorkspaceLocalProbe[]> {
    const rows = await this.db.query<{ path: string; mtime: number; size: number; plaintext_sha256: string }>(`SELECT * FROM workspace_local_probe ORDER BY path`);
    return rows.map((row) => ({ path: row.path, mtime: row.mtime, size: row.size, plaintextSha256: row.plaintext_sha256 }));
  }
  async upsertLocalProbes(probes: WorkspaceLocalProbe[]): Promise<void> {
    // Chunked multi-row upserts: the sweep may refresh thousands of probes in
    // one pass and a statement per row would pay one IPC round-trip each.
    const CHUNK = 200;
    for (let start = 0; start < probes.length; start += CHUNK) {
      const chunk = probes.slice(start, start + CHUNK);
      const values = chunk.map(() => "(?,?,?,?)").join(",");
      await this.db.execute(
        `INSERT INTO workspace_local_probe (path,mtime,size,plaintext_sha256) VALUES ${values}
         ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime,size=excluded.size,plaintext_sha256=excluded.plaintext_sha256`,
        chunk.flatMap((probe) => [probe.path, probe.mtime, probe.size, probe.plaintextSha256])
      );
    }
  }
  async deleteLocalProbes(paths: string[]): Promise<void> {
    const CHUNK = 400;
    for (let start = 0; start < paths.length; start += CHUNK) {
      const chunk = paths.slice(start, start + CHUNK);
      await this.db.execute(`DELETE FROM workspace_local_probe WHERE path IN (${chunk.map(() => "?").join(",")})`, chunk);
    }
  }
  async hasOperation(operationHash: string): Promise<boolean> {
    return (await this.db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM workspace_operation WHERE operation_hash = ?`, [operationHash]))?.n === 1;
  }
  async hasPendingForPath(path: string): Promise<boolean> {
    return ((await this.db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM workspace_queue WHERE path = ? OR new_path = ?`, [path, path]))?.n ?? 0) > 0;
  }
  async listQueuedPaths(): Promise<string[]> {
    const rows = await this.db.query<{ path: string; new_path: string | null }>(`SELECT path, new_path FROM workspace_queue`);
    return rows.flatMap((row) => (row.new_path ? [row.path, row.new_path] : [row.path]));
  }
  async enqueue(operation: WorkspaceQueueOperation, path: string, newPath: string | null = null): Promise<number> {
    await this.db.execute(`INSERT INTO workspace_queue (operation,path,new_path,queued_at) VALUES (?,?,?,?)`, [operation, path, newPath, Date.now()]);
    const row = await this.db.queryOne<{ id: number }>(`SELECT id FROM workspace_queue ORDER BY id DESC LIMIT 1`);
    if (!row) throw new Error("workspace queue insert did not return an id");
    return row.id;
  }
  async listQueue(limit = Number.MAX_SAFE_INTEGER): Promise<WorkspaceQueuedMutation[]> {
    const safeLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 100_000)) : 100_000;
    const rows = await this.db.query<QueueRow>(`SELECT * FROM workspace_queue ORDER BY id ASC LIMIT ?`, [safeLimit]);
    return rows.map((row) => ({
      id: row.id,
      operation: row.operation,
      path: row.path,
      newPath: row.new_path,
      queuedAt: row.queued_at,
      retryCount: row.retry_count,
      lastError: row.last_error,
      prepared: row.prepared_json ? JSON.parse(row.prepared_json) as PreparedWorkspaceMutation : null,
    }));
  }
  async reservePrepared(queueId: number, prepared: PreparedWorkspaceMutation, meta: WorkspaceRuntimeMeta): Promise<void> {
    await runStatementsAtomic(this.db, [
      { sql: `UPDATE workspace_queue SET prepared_json = ?, last_error = NULL WHERE id = ?`, params: [JSON.stringify(prepared), queueId] },
      { sql: `INSERT INTO workspace_meta (id,state_json) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json`, params: [JSON.stringify(meta)] },
    ]);
  }
  async discardQueue(queueId: number): Promise<void> {
    await this.db.execute(`DELETE FROM workspace_queue WHERE id = ?`, [queueId]);
  }
  async markQueueFailed(queueId: number, message: string): Promise<void> {
    await this.db.execute(`UPDATE workspace_queue SET retry_count = retry_count + 1, last_error = ? WHERE id = ?`, [message.slice(0, 1000), queueId]);
  }
  async retryFailed(): Promise<void> {
    await this.db.execute(`UPDATE workspace_queue SET last_error = NULL`);
  }
  async commitQueued(queueId: number, mutation: CommitWorkspaceMutation, meta: WorkspaceRuntimeMeta, absorbedQueueIds: number[] = []): Promise<void> {
    const completed = [...new Set([queueId, ...absorbedQueueIds])];
    await this.commitMutation(mutation, true, meta, completed.map((id) => ({ sql: `DELETE FROM workspace_queue WHERE id = ?`, params: [id] })));
  }
  async recordIncoming(mutation: CommitWorkspaceMutation, setCurrent: boolean, meta: WorkspaceRuntimeMeta): Promise<void> {
    await this.commitMutation(mutation, setCurrent, meta, []);
  }
  async recordObservedOperation(operationHash: string, operationDocument: string, deviceId: string, sequence: number, meta: WorkspaceRuntimeMeta): Promise<void> {
    await runStatementsAtomic(this.db, [
      { sql: `INSERT OR IGNORE INTO workspace_operation (operation_hash,device_id,sequence,document_json) VALUES (?,?,?,?)`, params: [operationHash, deviceId, sequence, operationDocument] },
      { sql: `INSERT INTO workspace_meta (id,state_json) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json`, params: [JSON.stringify(meta)] },
    ]);
  }
  private async commitMutation(
    mutation: CommitWorkspaceMutation,
    setCurrent: boolean,
    meta: WorkspaceRuntimeMeta,
    trailing: Array<{ sql: string; params?: unknown[] }>
  ): Promise<void> {
    await runStatementsAtomic(this.db, [
      ...(mutation.revision ? [revisionWrite(mutation.revision)] : []),
      {
        sql: `INSERT OR IGNORE INTO workspace_operation (operation_hash,device_id,sequence,document_json) VALUES (?,?,?,?)`,
        params: [mutation.operationHash, mutation.deviceId, mutation.sequence, mutation.operationDocument],
      },
      ...(setCurrent ? [objectWrite(mutation.object)] : []),
      ...trailing,
      { sql: `INSERT INTO workspace_meta (id,state_json) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json`, params: [JSON.stringify(meta)] },
    ]);
  }
}
