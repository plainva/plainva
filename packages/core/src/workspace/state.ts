import { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import { runStatementsAtomic } from "../db/batch.js";

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
  createdAt: string;
  /** Present only on an immutable resolution marker. */
  resolvedCommentId: string | null;
  resolvedAt: string | null;
}

export type WorkspaceQuarantineStatus = "pending" | "ignored" | "repaired";
export interface WorkspaceQuarantineRecord {
  quarantineId: string;
  artifactKind: "policy" | "recovery" | "operation" | "object" | "catalog" | "checkpoint" | "head" | "grant";
  remoteKey: string;
  /** Original remote bytes. They are protocol ciphertext/control data, never opened plaintext. */
  artifactBase64: string;
  artifactSha256: string;
  errorCode: string;
  reason: string;
  firstSeenAt: string;
  lastTriedAt: string;
  status: WorkspaceQuarantineStatus;
}

export interface WorkspaceLocalForkRecord {
  forkId: string;
  originalPath: string;
  forkPath: string;
  reason: "permission-denied" | "parallel-write" | "path-collision";
  createdAt: string;
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
  listObjects(includeDeleted?: boolean): Promise<WorkspaceObjectRecord[]>;
  getObjectByPath(path: string): Promise<WorkspaceObjectRecord | null>;
  getObjectById(objectId: string): Promise<WorkspaceObjectRecord | null>;
  getRevision(revisionId: string): Promise<WorkspaceRevisionRecord | null>;
  listRevisionsForObject(objectId: string): Promise<WorkspaceRevisionRecord[]>;
  listComments(targetObjectId: string): Promise<WorkspaceCommentRecord[]>;
  saveComment(comment: WorkspaceCommentRecord): Promise<void>;
  listQuarantine(status?: WorkspaceQuarantineStatus): Promise<WorkspaceQuarantineRecord[]>;
  saveQuarantine(record: WorkspaceQuarantineRecord): Promise<void>;
  setQuarantineStatus(quarantineId: string, status: WorkspaceQuarantineStatus): Promise<void>;
  listLocalForks(): Promise<WorkspaceLocalForkRecord[]>;
  saveLocalFork(record: WorkspaceLocalForkRecord): Promise<void>;
  hasOperation(operationHash: string): Promise<boolean>;
  hasPendingForPath(path: string): Promise<boolean>;
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
  private readonly quarantine = new Map<string, WorkspaceQuarantineRecord>();
  private readonly forks = new Map<string, WorkspaceLocalForkRecord>();
  private readonly queue: WorkspaceQueuedMutation[] = [];
  private nextQueueId = 1;

  async loadMeta(): Promise<WorkspaceRuntimeMeta | null> { return this.meta ? clone(this.meta) : null; }
  async saveMeta(meta: WorkspaceRuntimeMeta): Promise<void> { this.meta = clone(meta); }
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
    return [...this.comments.values()].filter((entry) => entry.targetObjectId === targetObjectId && !entry.resolvedCommentId).map(clone).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.commentId.localeCompare(b.commentId));
  }
  async saveComment(comment: WorkspaceCommentRecord): Promise<void> {
    this.comments.set(comment.commentId, clone(comment));
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
  async saveQuarantine(record: WorkspaceQuarantineRecord): Promise<void> { this.quarantine.set(record.quarantineId, clone(record)); }
  async setQuarantineStatus(quarantineId: string, status: WorkspaceQuarantineStatus): Promise<void> {
    const record = this.quarantine.get(quarantineId); if (record) record.status = status;
  }
  async listLocalForks(): Promise<WorkspaceLocalForkRecord[]> { return [...this.forks.values()].map(clone).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async saveLocalFork(record: WorkspaceLocalForkRecord): Promise<void> { this.forks.set(record.forkId, clone(record)); }
  async hasOperation(operationHash: string): Promise<boolean> { return this.operations.has(operationHash); }
  async hasPendingForPath(path: string): Promise<boolean> {
    return this.queue.some((entry) => entry.path === path || entry.newPath === path);
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

interface CommentRow {
  comment_id: string; target_object_id: string; target_revision_id: string; parent_comment_id: string | null;
  author_member_id: string; author_device_id: string; operation_hash: string; payload_hash: string;
  body: string; created_at: string; resolved_comment_id: string | null; resolved_at: string | null;
}

interface QuarantineRow {
  quarantine_id: string; artifact_kind: WorkspaceQuarantineRecord["artifactKind"]; remote_key: string;
  artifact_base64: string; artifact_sha256: string; error_code: string; reason: string; first_seen_at: string;
  last_tried_at: string; status: WorkspaceQuarantineStatus;
}

interface ForkRow {
  fork_id: string; original_path: string; fork_path: string; reason: WorkspaceLocalForkRecord["reason"]; created_at: string;
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
    sql: `INSERT INTO workspace_object
      (object_id,path,current_revision_id,payload_hash,plaintext_sha256,content_kind,deleted,created_at,modified_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(object_id) DO UPDATE SET path=excluded.path,current_revision_id=excluded.current_revision_id,
        payload_hash=excluded.payload_hash,plaintext_sha256=excluded.plaintext_sha256,content_kind=excluded.content_kind,
        deleted=excluded.deleted,modified_at=excluded.modified_at`,
    params: [record.objectId, record.path, record.currentRevisionId, record.payloadHash, record.plaintextSha256, record.contentKind, record.deleted ? 1 : 0, record.createdAt, record.modifiedAt],
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
    const rows = await this.db.query<CommentRow>(`SELECT * FROM workspace_comment WHERE target_object_id = ? AND resolved_comment_id IS NULL ORDER BY created_at, comment_id`, [targetObjectId]);
    return rows.map((row) => ({ commentId: row.comment_id, targetObjectId: row.target_object_id, targetRevisionId: row.target_revision_id, parentCommentId: row.parent_comment_id, authorMemberId: row.author_member_id, authorDeviceId: row.author_device_id, operationHash: row.operation_hash, payloadHash: row.payload_hash, body: row.body, createdAt: row.created_at, resolvedCommentId: row.resolved_comment_id, resolvedAt: row.resolved_at }));
  }
  async saveComment(comment: WorkspaceCommentRecord): Promise<void> {
    await this.db.execute(`INSERT INTO workspace_comment (comment_id,target_object_id,target_revision_id,parent_comment_id,author_member_id,author_device_id,operation_hash,payload_hash,body,created_at,resolved_comment_id,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(comment_id) DO UPDATE SET resolved_at=excluded.resolved_at`, [comment.commentId, comment.targetObjectId, comment.targetRevisionId, comment.parentCommentId, comment.authorMemberId, comment.authorDeviceId, comment.operationHash, comment.payloadHash, comment.body, comment.createdAt, comment.resolvedCommentId, comment.resolvedAt]);
    if (comment.resolvedCommentId) await this.db.execute(`UPDATE workspace_comment SET resolved_at = ? WHERE comment_id = ?`, [comment.createdAt, comment.resolvedCommentId]);
    else await this.db.execute(`UPDATE workspace_comment SET resolved_at = (SELECT MAX(created_at) FROM workspace_comment WHERE resolved_comment_id = ?) WHERE comment_id = ? AND EXISTS (SELECT 1 FROM workspace_comment WHERE resolved_comment_id = ?)`, [comment.commentId, comment.commentId, comment.commentId]);
  }
  async listQuarantine(status?: WorkspaceQuarantineStatus): Promise<WorkspaceQuarantineRecord[]> {
    const rows = await this.db.query<QuarantineRow>(`SELECT * FROM workspace_quarantine ${status ? "WHERE status = ?" : ""} ORDER BY first_seen_at DESC`, status ? [status] : []);
    return rows.map((row) => ({ quarantineId: row.quarantine_id, artifactKind: row.artifact_kind, remoteKey: row.remote_key, artifactBase64: row.artifact_base64, artifactSha256: row.artifact_sha256, errorCode: row.error_code, reason: row.reason, firstSeenAt: row.first_seen_at, lastTriedAt: row.last_tried_at, status: row.status }));
  }
  async saveQuarantine(record: WorkspaceQuarantineRecord): Promise<void> {
    await this.db.execute(`INSERT INTO workspace_quarantine (quarantine_id,artifact_kind,remote_key,artifact_base64,artifact_sha256,error_code,reason,first_seen_at,last_tried_at,status) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(quarantine_id) DO UPDATE SET last_tried_at=excluded.last_tried_at,error_code=excluded.error_code,reason=excluded.reason,status=CASE WHEN workspace_quarantine.status='ignored' THEN 'ignored' ELSE excluded.status END`, [record.quarantineId, record.artifactKind, record.remoteKey, record.artifactBase64, record.artifactSha256, record.errorCode, record.reason, record.firstSeenAt, record.lastTriedAt, record.status]);
  }
  async setQuarantineStatus(quarantineId: string, status: WorkspaceQuarantineStatus): Promise<void> { await this.db.execute(`UPDATE workspace_quarantine SET status = ? WHERE quarantine_id = ?`, [status, quarantineId]); }
  async listLocalForks(): Promise<WorkspaceLocalForkRecord[]> {
    const rows = await this.db.query<ForkRow>(`SELECT * FROM workspace_local_fork ORDER BY created_at DESC`);
    return rows.map((row) => ({ forkId: row.fork_id, originalPath: row.original_path, forkPath: row.fork_path, reason: row.reason, createdAt: row.created_at }));
  }
  async saveLocalFork(record: WorkspaceLocalForkRecord): Promise<void> {
    await this.db.execute(`INSERT OR REPLACE INTO workspace_local_fork (fork_id,original_path,fork_path,reason,created_at) VALUES (?,?,?,?,?)`, [record.forkId, record.originalPath, record.forkPath, record.reason, record.createdAt]);
  }
  async hasOperation(operationHash: string): Promise<boolean> {
    return (await this.db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM workspace_operation WHERE operation_hash = ?`, [operationHash]))?.n === 1;
  }
  async hasPendingForPath(path: string): Promise<boolean> {
    return ((await this.db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM workspace_queue WHERE path = ? OR new_path = ?`, [path, path]))?.n ?? 0) > 0;
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
