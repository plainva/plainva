import { ISyncTarget, SyncOperation } from "../sync/ISyncTarget.js";
import { bytesEqual, sha256Hex } from "./encoding.js";
import { assertWorkspaceObjectKey } from "./path.js";
import { ImmutableObjectConflictError, protocolAssert, WorkspaceProtocolError } from "./errors.js";

export interface WorkspaceObjectInfo {
  key: string;
  etag?: string;
  size: number;
  modifiedAt?: number;
}

export interface WorkspaceListPage {
  items: WorkspaceObjectInfo[];
  cursor?: string;
}

export interface PutImmutableResult {
  etag?: string;
  alreadyExisted: boolean;
}

export interface WorkspaceRequestOptions {
  signal?: AbortSignal;
  pageSize?: number;
}

export interface WorkspaceObjectStore {
  list(prefix: string, cursor?: string, options?: WorkspaceRequestOptions): Promise<WorkspaceListPage>;
  get(key: string, options?: WorkspaceRequestOptions): Promise<Uint8Array | null>;
  getRange(key: string, start: number, endExclusive: number, options?: WorkspaceRequestOptions): Promise<Uint8Array | null>;
  head(key: string, options?: WorkspaceRequestOptions): Promise<WorkspaceObjectInfo | null>;
  putImmutable(key: string, bytes: Uint8Array, expectedSha256: string, options?: WorkspaceRequestOptions): Promise<PutImmutableResult>;
  compareAndSwapPointer(
    key: string,
    bytes: Uint8Array,
    previousEtag: string | null,
    options?: WorkspaceRequestOptions
  ): Promise<{ etag?: string; swapped: boolean }>;
}

export type WorkspaceProviderName = "webdav" | "google-drive" | "s3" | "onedrive" | "dropbox";

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The workspace object-store operation was aborted", "AbortError");
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("The workspace object-store operation was aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => { cleanup(); resolve(value); },
      (error: unknown) => { cleanup(); reject(error); }
    );
  });
}

function makeWriteOperation(key: string, bytes: Uint8Array): SyncOperation {
  return {
    id: 0,
    file_path: key,
    operation: "write",
    content: bytes,
    retry_count: 0,
    next_retry_at: 0,
    queued_at: 0,
  };
}

function encodeCursor(prefix: string, listingHash: string, offset: number): string {
  return `${sha256Hex(new TextEncoder().encode(prefix)).slice(0, 16)}.${listingHash}.${offset.toString(36)}`;
}

function decodeCursor(prefix: string, cursor: string): { listingHash: string; offset: number } {
  const parts = cursor.split(".");
  protocolAssert(parts.length === 3, "format", "invalid workspace list cursor");
  protocolAssert(parts[0] === sha256Hex(new TextEncoder().encode(prefix)).slice(0, 16), "integrity", "workspace list cursor belongs to another prefix");
  protocolAssert(/^[0-9a-f]{64}$/.test(parts[1]), "format", "invalid workspace list cursor hash");
  const offset = Number.parseInt(parts[2], 36);
  protocolAssert(Number.isSafeInteger(offset) && offset >= 0, "format", "invalid workspace list cursor offset");
  return { listingHash: parts[1], offset };
}

function listingDigest(entries: Array<[string, string]>): string {
  return sha256Hex(new TextEncoder().encode(entries.map(([key, etag]) => `${key}\0${etag}\n`).join("")));
}

/**
 * Compatibility object store over the five existing provider transports.
 * Provider transports retain their production retry, timeout, pagination and
 * authentication logic; this adapter adds immutable/CAS verification and the
 * opaque `.pvws/` coordinate system.
 */
export class SyncTargetWorkspaceObjectStore implements WorkspaceObjectStore {
  constructor(
    protected readonly target: ISyncTarget,
    public readonly provider: WorkspaceProviderName
  ) {}

  async list(prefix: string, cursor?: string, options?: WorkspaceRequestOptions): Promise<WorkspaceListPage> {
    assertWorkspaceObjectKey(prefix);
    const pageSize = options?.pageSize ?? 200;
    protocolAssert(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 1000, "bounds", "workspace list page size is invalid");
    const pulled = await abortable(this.target.pull(), options?.signal);
    throwIfAborted(options?.signal);
    const entries = [...pulled.etagMap.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    const digest = listingDigest(entries);
    const decoded = cursor ? decodeCursor(prefix, cursor) : { listingHash: digest, offset: 0 };
    protocolAssert(decoded.listingHash === digest, "conflict", "workspace listing changed between pages");
    protocolAssert(decoded.offset <= entries.length, "format", "workspace list cursor offset exceeds listing");
    const pageEntries = entries.slice(decoded.offset, decoded.offset + pageSize);
    const items: WorkspaceObjectInfo[] = [];
    for (const [key, etag] of pageEntries) {
      throwIfAborted(options?.signal);
      const bytes = await abortable(this.target.download(key), options?.signal);
      protocolAssert(bytes !== null, "conflict", "workspace object disappeared during listing");
      items.push({ key, etag: etag || `sha256:${sha256Hex(bytes)}`, size: bytes.length, ...(pulled.mtimeMap?.has(key) ? { modifiedAt: pulled.mtimeMap.get(key) } : {}) });
    }
    const nextOffset = decoded.offset + pageEntries.length;
    return {
      items,
      ...(nextOffset < entries.length ? { cursor: encodeCursor(prefix, digest, nextOffset) } : {}),
    };
  }

  async get(key: string, options?: WorkspaceRequestOptions): Promise<Uint8Array | null> {
    assertWorkspaceObjectKey(key);
    const bytes = await abortable(this.target.download(key), options?.signal);
    throwIfAborted(options?.signal);
    return bytes ? new Uint8Array(bytes) : null;
  }

  async getRange(key: string, start: number, endExclusive: number, options?: WorkspaceRequestOptions): Promise<Uint8Array | null> {
    protocolAssert(Number.isSafeInteger(start) && Number.isSafeInteger(endExclusive) && start >= 0 && endExclusive >= start, "bounds", "invalid workspace byte range");
    const bytes = await this.get(key, options);
    if (!bytes) return null;
    protocolAssert(endExclusive <= bytes.length, "bounds", "workspace byte range exceeds object size");
    return new Uint8Array(bytes.slice(start, endExclusive));
  }

  async head(key: string, options?: WorkspaceRequestOptions): Promise<WorkspaceObjectInfo | null> {
    assertWorkspaceObjectKey(key);
    const pulled = await abortable(this.target.pull(), options?.signal);
    const etag = pulled.etagMap.get(key);
    if (etag === undefined) return null;
    const bytes = await abortable(this.target.download(key), options?.signal);
    if (!bytes) return null;
    return { key, etag: etag || `sha256:${sha256Hex(bytes)}`, size: bytes.length, ...(pulled.mtimeMap?.has(key) ? { modifiedAt: pulled.mtimeMap.get(key) } : {}) };
  }

  async putImmutable(key: string, bytes: Uint8Array, expectedSha256: string, options?: WorkspaceRequestOptions): Promise<PutImmutableResult> {
    assertWorkspaceObjectKey(key);
    protocolAssert(/^[0-9a-f]{64}$/.test(expectedSha256), "format", "expected immutable hash is invalid");
    protocolAssert(sha256Hex(bytes) === expectedSha256, "integrity", "immutable bytes do not match expected hash");
    const existing = await this.get(key, options);
    if (existing) {
      if (sha256Hex(existing) !== expectedSha256 || !bytesEqual(existing, bytes)) throw new ImmutableObjectConflictError();
      return { etag: (await this.head(key, options))?.etag, alreadyExisted: true };
    }
    const pushed = await abortable(Promise.resolve(this.target.push(makeWriteOperation(key, bytes))), options?.signal);
    const firstRead = await this.get(key, options);
    const after = await this.head(key, options);
    const secondRead = await this.get(key, options);
    if (
      !firstRead || !secondRead ||
      sha256Hex(firstRead) !== expectedSha256 || sha256Hex(secondRead) !== expectedSha256 ||
      !bytesEqual(firstRead, bytes) || !bytesEqual(secondRead, bytes) ||
      (pushed?.etag !== undefined && after?.etag !== pushed.etag)
    ) throw new ImmutableObjectConflictError();
    return { etag: after?.etag, alreadyExisted: false };
  }

  async compareAndSwapPointer(
    key: string,
    bytes: Uint8Array,
    previousEtag: string | null,
    options?: WorkspaceRequestOptions
  ): Promise<{ etag?: string; swapped: boolean }> {
    assertWorkspaceObjectKey(key);
    const before = await this.head(key, options);
    if (previousEtag === null ? before !== null : before?.etag !== previousEtag) return { etag: before?.etag, swapped: false };
    const pushed = await abortable(Promise.resolve(this.target.push(makeWriteOperation(key, bytes))), options?.signal);
    const firstRead = await this.get(key, options);
    const after = await this.head(key, options);
    const secondRead = await this.get(key, options);
    if (
      !firstRead || !secondRead ||
      !bytesEqual(firstRead, bytes) || !bytesEqual(secondRead, bytes) ||
      (pushed?.etag !== undefined && after?.etag !== pushed.etag)
    ) return { etag: after?.etag, swapped: false };
    return { etag: after?.etag, swapped: true };
  }
}

export class WebDavWorkspaceObjectStore extends SyncTargetWorkspaceObjectStore {
  constructor(target: ISyncTarget) { super(target, "webdav"); }
}

export class GoogleDriveWorkspaceObjectStore extends SyncTargetWorkspaceObjectStore {
  constructor(target: ISyncTarget) { super(target, "google-drive"); }
}

export class S3WorkspaceObjectStore extends SyncTargetWorkspaceObjectStore {
  constructor(target: ISyncTarget) { super(target, "s3"); }
}

export class OneDriveWorkspaceObjectStore extends SyncTargetWorkspaceObjectStore {
  constructor(target: ISyncTarget) { super(target, "onedrive"); }
}

export class DropboxWorkspaceObjectStore extends SyncTargetWorkspaceObjectStore {
  constructor(target: ISyncTarget) { super(target, "dropbox"); }
}

export function createProviderWorkspaceObjectStore(provider: WorkspaceProviderName, target: ISyncTarget): WorkspaceObjectStore {
  switch (provider) {
    case "webdav": return new WebDavWorkspaceObjectStore(target);
    case "google-drive": return new GoogleDriveWorkspaceObjectStore(target);
    case "s3": return new S3WorkspaceObjectStore(target);
    case "onedrive": return new OneDriveWorkspaceObjectStore(target);
    case "dropbox": return new DropboxWorkspaceObjectStore(target);
    default: throw new WorkspaceProtocolError("unsupported", "unsupported workspace provider");
  }
}
