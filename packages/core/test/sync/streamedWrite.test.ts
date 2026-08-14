import { describe, expect, it, beforeEach } from "vitest";
import { SyncQueue } from "../../src/sync/SyncQueue.ts";
import { SyncEngine, STREAM_UPLOAD_MIN_BYTES } from "../../src/sync/SyncEngine.ts";
import { ISyncTarget, SyncOperation, SyncContentRef } from "../../src/sync/ISyncTarget.ts";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.ts";
import { MockDatabaseAdapter } from "../mocks/MockDatabaseAdapter.ts";

class StreamingTarget implements ISyncTarget {
  public acceptsContentRef = true;
  public pushes: SyncOperation[] = [];
  async push(op: SyncOperation) {
    this.pushes.push(op);
    return { etag: "etag-1" };
  }
  async pull() { return { etagMap: new Map() }; }
  async download() { return new Uint8Array(); }
}

/** A target that has to see the bytes — the encryption wrapper's shape. */
class BufferOnlyTarget extends StreamingTarget {
  public acceptsContentRef = false;
}

class MockVaultAdapter {
  public reads: string[] = [];
  async readBinaryFile(path: string) {
    this.reads.push(path);
    return new TextEncoder().encode("small");
  }
}

const BIG_REF: SyncContentRef = {
  rootId: "root-1",
  relPath: "Attachments/video.mp4",
  size: 90 * 1024 * 1024,
  sha256: "a".repeat(64),
};

describe("streamed writes (issue #48)", () => {
  let db: MockDatabaseAdapter;
  let queue: SyncQueue;
  let vault: MockVaultAdapter;

  beforeEach(() => {
    db = new MockDatabaseAdapter();
    queue = new SyncQueue(db);
    vault = new MockVaultAdapter();
  });

  function queueOneWrite(path = "Attachments/video.mp4") {
    db.mockedResults.push([
      { id: 1, file_path: path, operation: "write", retry_count: 0, next_retry_at: 0, queued_at: 0 },
    ]);
    db.mockedResults.push([]); // getSyncState -> null
  }

  it("hands the target a handle instead of reading 90 MB into memory", async () => {
    const target = new StreamingTarget();
    const engine = new SyncEngine(queue, target, vault as any, new SyncStateRepository(db), async () => BIG_REF);
    queueOneWrite();

    await engine.processQueue();

    expect(vault.reads, "the bytes must never enter the renderer").toEqual([]);
    expect(target.pushes[0].contentRef).toEqual(BIG_REF);
    expect(target.pushes[0].content).toBeUndefined();
  });

  it("advances the merge base of a streamed write", async () => {
    // Without this the next cycle would reconcile against a stale base and push
    // the same file again, forever — the buffer path guarded the base update
    // behind `op.content`, which a streamed write does not have.
    const target = new StreamingTarget();
    const engine = new SyncEngine(queue, target, vault as any, new SyncStateRepository(db), async () => BIG_REF);
    queueOneWrite();

    await engine.processQueue();

    const baseUpsert = db.queries.find(
      (q) => q.query.includes("INSERT INTO sync_state") && q.query.includes("base_sha256 = excluded.base_sha256"),
    );
    expect(baseUpsert, "a streamed write must still advance its base").toBeDefined();
    // The hash comes from the native pass, not from a second read.
    expect((baseUpsert!.params as any[])[1]).toBe(BIG_REF.sha256);
  });

  it("keeps no base_text for a streamed write, but still guards the local hash", async () => {
    const target = new StreamingTarget();
    const bigMarkdown: SyncContentRef = { ...BIG_REF, relPath: "Huge.md" };
    const engine = new SyncEngine(queue, target, vault as any, new SyncStateRepository(db), async () => bigMarkdown);
    queueOneWrite("Huge.md");

    await engine.processQueue();

    // Decoding megabytes just to store them would undo the point of streaming.
    const baseText = db.queries.find((q) => q.query.includes("base_text = excluded.base_text"));
    expect(baseText).toBeUndefined();
    const guarded = db.queries.find((q) => q.query.includes("ELSE sync_state.local_sha256"));
    expect(guarded, "the conflict-race guard still applies").toBeDefined();
    expect((guarded!.params as any[])[1]).toBe(bigMarkdown.sha256);
  });

  it("falls back to the buffer when the target cannot stream", async () => {
    // The content-encryption wrapper has to seal the bytes in hand.
    const target = new BufferOnlyTarget();
    const engine = new SyncEngine(queue, target, vault as any, new SyncStateRepository(db), async () => BIG_REF);
    queueOneWrite();

    await engine.processQueue();

    expect(vault.reads).toEqual(["Attachments/video.mp4"]);
    expect(target.pushes[0].contentRef).toBeUndefined();
    expect(target.pushes[0].content).toBeDefined();
  });

  it("leaves a small file on the buffer path", async () => {
    const target = new StreamingTarget();
    let askedFor: [string, number] | null = null;
    const engine = new SyncEngine(queue, target, vault as any, new SyncStateRepository(db), async (path, min) => {
      askedFor = [path, min];
      return null; // the shell reports: below the threshold
    });
    queueOneWrite("note.md");

    await engine.processQueue();

    expect(askedFor).toEqual(["note.md", STREAM_UPLOAD_MIN_BYTES]);
    expect(vault.reads).toEqual(["note.md"]);
    expect(target.pushes[0].content).toBeDefined();
  });

  it("keeps working without a resolver at all", async () => {
    const target = new StreamingTarget();
    const engine = new SyncEngine(queue, target, vault as any, new SyncStateRepository(db));
    queueOneWrite("note.md");

    await engine.processQueue();

    expect(target.pushes[0].content).toBeDefined();
  });
});
