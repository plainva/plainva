import { bytesEqual, sha256Hex } from "./encoding.js";
import {
  PutImmutableResult,
  WorkspaceListPage,
  WorkspaceObjectInfo,
  WorkspaceObjectStore,
  WorkspaceRequestOptions,
} from "./objectStore.js";
import { assertWorkspaceObjectKey } from "./path.js";
import { ImmutableObjectConflictError, protocolAssert } from "./errors.js";

interface FakeEntry {
  bytes: Uint8Array;
  revision: number;
  modifiedAt: number;
}

function fakeEtag(entry: FakeEntry): string {
  return `v${entry.revision}-${sha256Hex(entry.bytes).slice(0, 16)}`;
}

function throwIfAborted(options?: WorkspaceRequestOptions): void {
  if (options?.signal?.aborted) throw new DOMException("The workspace object-store operation was aborted", "AbortError");
}

function fakeListingDigest(entries: Array<[string, FakeEntry]>): string {
  return sha256Hex(new TextEncoder().encode(entries.map(([key, entry]) => `${key}\0${fakeEtag(entry)}\n`).join("")));
}

function fakeCursor(prefix: string, digest: string, offset: number): string {
  const prefixHash = sha256Hex(new TextEncoder().encode(prefix)).slice(0, 16);
  return `${prefixHash}.${digest}.${offset.toString(36)}`;
}

function parseFakeCursor(prefix: string, cursor: string): { digest: string; offset: number } {
  const parts = cursor.split(".");
  protocolAssert(parts.length === 3, "format", "invalid fake-store cursor");
  protocolAssert(parts[0] === sha256Hex(new TextEncoder().encode(prefix)).slice(0, 16), "integrity", "fake-store cursor belongs to another prefix");
  protocolAssert(/^[0-9a-f]{64}$/.test(parts[1]), "format", "invalid fake-store cursor hash");
  const offset = Number.parseInt(parts[2], 36);
  protocolAssert(Number.isSafeInteger(offset) && offset >= 0, "format", "invalid fake-store cursor offset");
  return { digest: parts[1], offset };
}

/** Deterministic in-memory contract implementation used by protocol and worker tests. */
export class FakeWorkspaceObjectStore implements WorkspaceObjectStore {
  private readonly entries = new Map<string, FakeEntry>();
  private revision = 0;

  async list(prefix: string, cursor?: string, options?: WorkspaceRequestOptions): Promise<WorkspaceListPage> {
    throwIfAborted(options);
    assertWorkspaceObjectKey(prefix);
    const pageSize = options?.pageSize ?? 200;
    protocolAssert(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 1000, "bounds", "workspace list page size is invalid");
    const all = [...this.entries.entries()].filter(([key]) => key.startsWith(prefix)).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    const digest = fakeListingDigest(all);
    const decoded = cursor === undefined ? { digest, offset: 0 } : parseFakeCursor(prefix, cursor);
    protocolAssert(decoded.digest === digest, "conflict", "fake-store listing changed between pages");
    const offset = decoded.offset;
    protocolAssert(offset <= all.length, "format", "fake-store cursor exceeds listing");
    const selected = all.slice(offset, offset + pageSize);
    const items = selected.map(([key, entry]): WorkspaceObjectInfo => ({ key, etag: fakeEtag(entry), size: entry.bytes.length, modifiedAt: entry.modifiedAt }));
    const next = offset + selected.length;
    return { items, ...(next < all.length ? { cursor: fakeCursor(prefix, digest, next) } : {}) };
  }

  async get(key: string, options?: WorkspaceRequestOptions): Promise<Uint8Array | null> {
    throwIfAborted(options);
    assertWorkspaceObjectKey(key);
    const entry = this.entries.get(key);
    return entry ? new Uint8Array(entry.bytes) : null;
  }

  async getRange(key: string, start: number, endExclusive: number, options?: WorkspaceRequestOptions): Promise<Uint8Array | null> {
    const bytes = await this.get(key, options);
    if (!bytes) return null;
    protocolAssert(Number.isSafeInteger(start) && Number.isSafeInteger(endExclusive) && start >= 0 && endExclusive >= start && endExclusive <= bytes.length, "bounds", "invalid fake-store range");
    return bytes.slice(start, endExclusive);
  }

  async head(key: string, options?: WorkspaceRequestOptions): Promise<WorkspaceObjectInfo | null> {
    throwIfAborted(options);
    assertWorkspaceObjectKey(key);
    const entry = this.entries.get(key);
    return entry ? { key, etag: fakeEtag(entry), size: entry.bytes.length, modifiedAt: entry.modifiedAt } : null;
  }

  async putImmutable(key: string, bytes: Uint8Array, expectedSha256: string, options?: WorkspaceRequestOptions): Promise<PutImmutableResult> {
    throwIfAborted(options);
    assertWorkspaceObjectKey(key);
    protocolAssert(/^[0-9a-f]{64}$/.test(expectedSha256), "format", "expected immutable hash is invalid");
    protocolAssert(sha256Hex(bytes) === expectedSha256, "integrity", "immutable bytes do not match expected hash");
    const current = this.entries.get(key);
    if (current) {
      if (!bytesEqual(current.bytes, bytes)) throw new ImmutableObjectConflictError();
      return { etag: fakeEtag(current), alreadyExisted: true };
    }
    const entry: FakeEntry = { bytes: new Uint8Array(bytes), revision: ++this.revision, modifiedAt: this.revision };
    this.entries.set(key, entry);
    return { etag: fakeEtag(entry), alreadyExisted: false };
  }

  async compareAndSwapPointer(
    key: string,
    bytes: Uint8Array,
    previousEtag: string | null,
    options?: WorkspaceRequestOptions
  ): Promise<{ etag?: string; swapped: boolean }> {
    throwIfAborted(options);
    assertWorkspaceObjectKey(key);
    const current = this.entries.get(key);
    const etag = current ? fakeEtag(current) : undefined;
    if (previousEtag === null ? current !== undefined : etag !== previousEtag) return { etag, swapped: false };
    const next: FakeEntry = { bytes: new Uint8Array(bytes), revision: ++this.revision, modifiedAt: this.revision };
    this.entries.set(key, next);
    return { etag: fakeEtag(next), swapped: true };
  }

  /** Test-only adversarial mutation that bypasses immutability. */
  tamper(key: string, bytes: Uint8Array): void {
    assertWorkspaceObjectKey(key);
    this.entries.set(key, { bytes: new Uint8Array(bytes), revision: ++this.revision, modifiedAt: this.revision });
  }
}
