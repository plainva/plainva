import { describe, expect, it } from "vitest";
import type { ISyncTarget, PullResult, PushResult, SyncOperation } from "../src/sync/ISyncTarget.js";
import {
  createProviderWorkspaceObjectStore,
  DropboxWorkspaceObjectStore,
  FakeWorkspaceObjectStore,
  GoogleDriveWorkspaceObjectStore,
  ImmutableObjectConflictError,
  OneDriveWorkspaceObjectStore,
  S3WorkspaceObjectStore,
  WebDavWorkspaceObjectStore,
  workspaceSha256Hex,
  type WorkspaceObjectStore,
} from "../src/index.js";

class MemorySyncTarget implements ISyncTarget {
  protected readonly entries = new Map<string, { bytes: Uint8Array; revision: number }>();
  protected revision = 0;
  private raceBytes: Uint8Array | null = null;
  private raceKey: string | null = null;
  private raceArmed = false;

  protected etag(entry: { bytes: Uint8Array; revision: number }): string {
    return `r${entry.revision}-${workspaceSha256Hex(entry.bytes).slice(0, 12)}`;
  }

  seed(key: string, bytes: Uint8Array): void {
    this.entries.set(key, { bytes: new Uint8Array(bytes), revision: ++this.revision });
  }

  raceAfterNextPush(key: string, bytes: Uint8Array): void {
    this.raceKey = key;
    this.raceBytes = new Uint8Array(bytes);
  }

  async push(op: SyncOperation): Promise<PushResult | void> {
    if (op.operation !== "write" || !op.content) throw new Error("memory target accepts writes only");
    const entry = { bytes: new Uint8Array(op.content), revision: ++this.revision };
    this.entries.set(op.file_path, entry);
    if (this.raceKey === op.file_path && this.raceBytes) this.raceArmed = true;
    return { etag: this.etag(entry) };
  }

  async pull(): Promise<PullResult> {
    if (this.raceArmed && this.raceKey && this.raceBytes) {
      this.entries.set(this.raceKey, { bytes: this.raceBytes, revision: ++this.revision });
      this.raceArmed = false;
      this.raceBytes = null;
      this.raceKey = null;
    }
    return {
      etagMap: new Map([...this.entries].map(([key, entry]) => [key, this.etag(entry)])),
      mtimeMap: new Map([...this.entries].map(([key, entry]) => [key, entry.revision])),
    };
  }

  async download(filePath: string): Promise<Uint8Array | null> {
    const entry = this.entries.get(filePath);
    return entry ? new Uint8Array(entry.bytes) : null;
  }
}

class DelayedMemorySyncTarget extends MemorySyncTarget {
  override async download(filePath: string): Promise<Uint8Array | null> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return super.download(filePath);
  }
}

const adapters: Array<[string, (target: ISyncTarget) => WorkspaceObjectStore]> = [
  ["WebDAV", (target) => new WebDavWorkspaceObjectStore(target)],
  ["Google Drive", (target) => new GoogleDriveWorkspaceObjectStore(target)],
  ["S3", (target) => new S3WorkspaceObjectStore(target)],
  ["OneDrive", (target) => new OneDriveWorkspaceObjectStore(target)],
  ["Dropbox", (target) => new DropboxWorkspaceObjectStore(target)],
];

function objectBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function objectKey(index: number): string {
  return `.pvws/objects/${index.toString().padStart(4, "0")}.pvo`;
}

function workspaceStoreContract(name: string, create: () => WorkspaceObjectStore): void {
  describe(name, () => {
    it("implements immutable, idempotent content-addressed puts", async () => {
      const store = create();
      const key = objectKey(1);
      const bytes = objectBytes("immutable");
      const hash = workspaceSha256Hex(bytes);
      await expect(store.putImmutable(key, bytes, hash)).resolves.toMatchObject({ alreadyExisted: false });
      await expect(store.putImmutable(key, bytes, hash)).resolves.toMatchObject({ alreadyExisted: true });
      await expect(store.putImmutable(key, objectBytes("different"), workspaceSha256Hex(objectBytes("different"))))
        .rejects.toBeInstanceOf(ImmutableObjectConflictError);
    });

    it("supports head, full get and the bounded range fallback", async () => {
      const store = create();
      const bytes = objectBytes("0123456789");
      await store.putImmutable(objectKey(2), bytes, workspaceSha256Hex(bytes));
      await expect(store.head(objectKey(2))).resolves.toMatchObject({ key: objectKey(2), size: 10 });
      await expect(store.get(objectKey(2))).resolves.toEqual(bytes);
      await expect(store.getRange(objectKey(2), 2, 6)).resolves.toEqual(objectBytes("2345"));
      await expect(store.getRange(objectKey(2), 2, 20)).rejects.toMatchObject({ code: "bounds" });
      await expect(store.get(objectKey(999))).resolves.toBeNull();
    });

    it("paginates a stable listing and binds cursors to its snapshot", async () => {
      const store = create();
      for (let index = 0; index < 5; index += 1) {
        const bytes = objectBytes(String(index));
        await store.putImmutable(objectKey(index), bytes, workspaceSha256Hex(bytes));
      }
      const first = await store.list(".pvws/objects/", undefined, { pageSize: 2 });
      expect(first.items.map((item) => item.key)).toEqual([objectKey(0), objectKey(1)]);
      expect(first.cursor).toBeTypeOf("string");
      const second = await store.list(".pvws/objects/", first.cursor, { pageSize: 2 });
      expect(second.items.map((item) => item.key)).toEqual([objectKey(2), objectKey(3)]);
      const extra = objectBytes("late");
      await store.putImmutable(objectKey(8), extra, workspaceSha256Hex(extra));
      await expect(store.list(".pvws/objects/", second.cursor, { pageSize: 2 })).rejects.toMatchObject({ code: "conflict" });
      await expect(store.list(".pvws/chunks/", first.cursor, { pageSize: 2 })).rejects.toMatchObject({ code: "integrity" });
    });

    it("performs optimistic pointer compare-and-swap", async () => {
      const store = create();
      const key = ".pvws/heads/10101010101010101010101010101010.pvhead";
      const first = await store.compareAndSwapPointer(key, objectBytes("v1"), null);
      expect(first.swapped).toBe(true);
      await expect(store.compareAndSwapPointer(key, objectBytes("stale"), "invalid-etag")).resolves.toMatchObject({ swapped: false });
      const second = await store.compareAndSwapPointer(key, objectBytes("v2"), first.etag ?? null);
      expect(second.swapped).toBe(true);
      await expect(store.get(key)).resolves.toEqual(objectBytes("v2"));
    });

    it("fails fast for invalid protocol keys and cancellation", async () => {
      const store = create();
      await expect(store.get("Projects/secret.md")).rejects.toMatchObject({ code: "format" });
      const controller = new AbortController();
      controller.abort();
      await expect(store.list(".pvws/objects/", undefined, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    });
  });
}

workspaceStoreContract("FakeWorkspaceObjectStore contract", () => new FakeWorkspaceObjectStore());
for (const [name, factory] of adapters) {
  workspaceStoreContract(`${name} workspace adapter contract`, () => factory(new MemorySyncTarget()));
}

describe("provider adapter race and factory behaviour", () => {
  it.each(adapters)("%s detects an observed CAS race", async (_name, factory) => {
    const target = new MemorySyncTarget();
    const store = factory(target);
    const key = ".pvws/heads/10101010101010101010101010101010.pvhead";
    target.raceAfterNextPush(key, objectBytes("racer"));
    await expect(store.compareAndSwapPointer(key, objectBytes("ours"), null)).resolves.toMatchObject({ swapped: false });
    await expect(store.get(key)).resolves.toEqual(objectBytes("racer"));
  });

  it.each([
    ["webdav", WebDavWorkspaceObjectStore],
    ["google-drive", GoogleDriveWorkspaceObjectStore],
    ["s3", S3WorkspaceObjectStore],
    ["onedrive", OneDriveWorkspaceObjectStore],
    ["dropbox", DropboxWorkspaceObjectStore],
  ] as const)("constructs the %s adapter", (provider, expectedClass) => {
    expect(createProviderWorkspaceObjectStore(provider, new MemorySyncTarget())).toBeInstanceOf(expectedClass);
  });

  it("cancels an in-flight caller-visible transport operation", async () => {
    const target = new DelayedMemorySyncTarget();
    target.seed(objectKey(1), objectBytes("slow"));
    const store = new WebDavWorkspaceObjectStore(target);
    const controller = new AbortController();
    const pending = store.get(objectKey(1), { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
