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
      (revision_id,object_id,payload_hash,parent_revision_ids,operation_hash,device_id,sequence,materialized_path,plaintext_sha256)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    params: [record.revisionId, record.objectId, record.payloadHash, JSON.stringify(record.parentRevisionIds), record.operationHash, record.deviceId, record.sequence, record.materializedPath, record.plaintextSha256],
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
