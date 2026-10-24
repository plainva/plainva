import { describe, it, expect, vi } from "vitest";
import {
  createIncrementalIndexQueue,
  IncrementalIndexerLike,
  IndexBatchResult,
  IndexPathOutcome,
} from "./incrementalIndexQueue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const indexerOf = (
  indexPath: (p: string) => Promise<IndexPathOutcome>,
  indexVaultFull: () => Promise<void> = async () => {}
): IncrementalIndexerLike => ({ indexPath, indexVaultFull });

describe("incrementalIndexQueue", () => {
  it("drains the active write but discards queued work after its vault closes", async () => {
    const gate = deferred();
    const indexPath = vi.fn(async () => { await gate.promise; return "indexed" as const; });
    const onBatchDone = vi.fn();
    const queue = createIncrementalIndexQueue({ indexer: indexerOf(indexPath), exists: async () => true, onBatchDone });
    queue.enqueue(["a.md"]);
    queue.enqueue(["b.md"]);
    queue.stop();
    queue.enqueue(["c.md"]);
    let idle = false;
    const drained = queue.whenIdle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);
    gate.resolve();
    await drained;
    expect(indexPath).toHaveBeenCalledTimes(1);
    expect(onBatchDone).not.toHaveBeenCalled();
  });
  it("never runs two batches concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const queue = createIncrementalIndexQueue({
      indexer: indexerOf(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 0));
        active--;
        return "indexed";
      }),
      exists: async () => true,
      onBatchDone: () => {},
    });

    queue.enqueue(["a.md", "b.md"]);
    queue.enqueue(["c.md"]);
    queue.enqueue(["d.md"]);
    await queue.whenIdle();

    expect(maxActive).toBe(1);
  });

  it("merges paths enqueued during a run into one follow-up batch", async () => {
    const batches: Array<string[] | null> = [];
    const gate = deferred();
    let calls = 0;
    const queue = createIncrementalIndexQueue({
      indexer: indexerOf(async () => {
        calls++;
        if (calls === 1) await gate.promise; // hold batch 1 open
        return "indexed";
      }),
      exists: async () => true,
      onBatchDone: (r) => batches.push(r.paths),
    });

    queue.enqueue(["a.md"]);
    queue.enqueue(["b.md"]);
    queue.enqueue(["c.md"]);
    gate.resolve();
    await queue.whenIdle();

    expect(batches).toEqual([["a.md"], ["b.md", "c.md"]]);
  });

  it("collapses full scans stacked up during a running scan", async () => {
    let fullScans = 0;
    const gate = deferred();
    const queue = createIncrementalIndexQueue({
      indexer: indexerOf(
        async () => "needs-full-scan",
        async () => {
          fullScans++;
          if (fullScans === 1) await gate.promise; // a slow first scan
        }
      ),
      exists: async () => true,
      onBatchDone: () => {},
    });

    queue.enqueue(["folder-a"]); // -> full scan 1 (held open)
    queue.enqueue(["folder-b"]); // arrives mid-scan...
    queue.enqueue(["folder-c"]); // ...and coalesces with it
    gate.resolve();
    await queue.whenIdle();

    // One running + ONE follow-up scan — not one scan per folder event (the
    // pre-queue first-sync behavior).
    expect(fullScans).toBe(2);
  });

  it("routes an oversized batch straight to one full scan without per-path work", async () => {
    const indexPath = vi.fn(async (): Promise<IndexPathOutcome> => "indexed");
    let fullScans = 0;
    const results: IndexBatchResult[] = [];
    const queue = createIncrementalIndexQueue({
      indexer: indexerOf(indexPath, async () => {
        fullScans++;
      }),
      exists: async () => true,
      onBatchDone: (r) => results.push(r),
    });

    queue.enqueue(Array.from({ length: 51 }, (_, i) => `n-${i}.md`));
    await queue.whenIdle();

    expect(indexPath).not.toHaveBeenCalled();
    expect(fullScans).toBe(1);
    expect(results).toEqual([{ fullScan: true, anyChange: true, paths: null, structureChanged: true }]);
  });

  it("reports a pure echo batch with anyChange=false and no full scan", async () => {
    const indexVaultFull = vi.fn(async () => {});
    const results: IndexBatchResult[] = [];
    const queue = createIncrementalIndexQueue({
      indexer: indexerOf(async () => "unchanged", indexVaultFull),
      exists: async () => true,
      onBatchDone: (r) => results.push(r),
    });

    queue.enqueue(["a.md", "b.md"]);
    await queue.whenIdle();

    expect(indexVaultFull).not.toHaveBeenCalled();
    expect(results).toEqual([{ fullScan: false, anyChange: false, paths: ["a.md", "b.md"] }]);
  });

  it("falls back to a full scan on needs-full-scan and on indexPath errors", async () => {
    let fullScans = 0;
    const dirQueue = createIncrementalIndexQueue({
      indexer: indexerOf(
        async () => "needs-full-scan",
        async () => {
          fullScans++;
        }
      ),
      exists: async () => true,
      onBatchDone: () => {},
    });
    dirQueue.enqueue(["folder"]);
    await dirQueue.whenIdle();
    expect(fullScans).toBe(1);

    // A path that keeps failing: tried once more, then the full scan.
    let attempts = 0;
    const throwingQueue = createIncrementalIndexQueue({
      indexer: indexerOf(
        async () => {
          attempts++;
          throw new Error("db locked");
        },
        async () => {
          fullScans++;
        }
      ),
      exists: async () => true,
      onBatchDone: () => {},
      retryDelayMs: 0,
    });
    throwingQueue.enqueue(["x.md"]);
    await throwingQueue.whenIdle();
    expect(attempts).toBe(2);
    expect(fullScans).toBe(2);
  });

  it("gives a path that failed once a second attempt before anything escalates (issue 122)", async () => {
    // A file another program still holds open, or one that vanished between
    // the look and the read: fine a moment later, and a full scan would have
    // met the very same file.
    let attempts = 0;
    let fullScans = 0;
    const results: IndexBatchResult[] = [];
    const escalations: string[] = [];
    const queue = createIncrementalIndexQueue({
      indexer: indexerOf(
        async (p) => {
          if (p === "locked.pdf" && attempts++ === 0) throw new Error("sharing violation");
          return "indexed";
        },
        async () => {
          fullScans++;
        }
      ),
      exists: async () => true,
      onBatchDone: (r) => results.push(r),
      onEscalation: (e) => escalations.push(e.reason),
      retryDelayMs: 0,
    });
    queue.enqueue(["locked.pdf", "fine.md"]);
    await queue.whenIdle();
    expect(fullScans).toBe(0);
    expect(escalations).toEqual([]);
    expect(attempts).toBe(2);
    // The rest of the first batch was not held up; the retry is a batch of its own.
    expect(results).toEqual([
      { fullScan: false, anyChange: true, paths: ["locked.pdf", "fine.md"] },
      { fullScan: false, anyChange: true, paths: ["locked.pdf"] },
    ]);
  });

  it("a stopped queue forgets a pending second attempt", async () => {
    const indexPath = vi.fn(async (): Promise<IndexPathOutcome> => { throw new Error("locked"); });
    const queue = createIncrementalIndexQueue({ indexer: indexerOf(indexPath), exists: async () => true, onBatchDone: () => {}, retryDelayMs: 5 });
    queue.enqueue(["a.md"]);
    await new Promise((r) => setTimeout(r, 0));
    queue.stop();
    await queue.whenIdle();
    await new Promise((r) => setTimeout(r, 15));
    expect(indexPath).toHaveBeenCalledTimes(1);
  });

  describe("a folder path (issue 122)", () => {
    const folderHarness = (report?: unknown) => {
      const reconcileFolder = vi.fn(async () => ({ indexed: [] as string[], removed: [] as string[], foldersRemoved: false }));
      const indexVaultFull = vi.fn(async (_trigger?: string) => report);
      const indexer: IncrementalIndexerLike = {
        indexPath: async () => "needs-full-scan",
        inspectPath: async (p) => (p.endsWith(".md") ? "unchanged" : p === "gone" ? "folder-gone" : "directory"),
        indexVaultFull,
        reconcileFolder,
      };
      const results: IndexBatchResult[] = [];
      const escalations: Array<{ reason: string; sources: string[]; paths: number }> = [];
      const queue = createIncrementalIndexQueue({
        indexer, exists: async () => true, onBatchDone: (r) => results.push(r), onEscalation: (e) => escalations.push(e),
      });
      return { queue, results, escalations, reconcileFolder, indexVaultFull };
    };

    it("that was only modified gets a flat look, not a full scan", async () => {
      const h = folderHarness();
      h.queue.enqueue([], { modifiedOnly: ["Projects/Sub", "Projects/Sub/note.md"], source: "watcher" });
      await h.queue.whenIdle();
      expect(h.indexVaultFull).not.toHaveBeenCalled();
      expect(h.reconcileFolder.mock.calls).toEqual([["Projects/Sub", { recursive: false }]]);
      expect(h.results).toEqual([{ fullScan: false, anyChange: false, paths: ["Projects/Sub", "Projects/Sub/note.md"] }]);
    });

    it("named without a kind — by a sync pull, by any caller that knows no event — escalates as before", async () => {
      const h = folderHarness();
      h.queue.enqueue(["Projects/Sub"], { source: "sync" });
      await h.queue.whenIdle();
      expect(h.indexVaultFull).toHaveBeenCalledWith("sync: folder created or renamed");
      expect(h.escalations).toEqual([{ reason: "folder created or renamed", sources: ["sync"], paths: 1 }]);
    });

    it("counts as the stronger kind when it was modified AND named otherwise, in whatever order", async () => {
      for (const order of ["weak-first", "strong-first", "one-call"] as const) {
        const h = folderHarness();
        // The runner is busy with this one, so what follows lands in ONE pending batch.
        h.queue.enqueue(["hold.md"]);
        if (order === "weak-first") {
          h.queue.enqueue([], { modifiedOnly: ["Projects/New"] });
          h.queue.enqueue([], { moved: ["Projects/New"] });
        } else if (order === "strong-first") {
          h.queue.enqueue(["Projects/New"]);
          h.queue.enqueue([], { modifiedOnly: ["Projects/New"] });
        } else {
          h.queue.enqueue(["Projects/New"], { modifiedOnly: ["Projects/New"] });
        }
        await h.queue.whenIdle();
        expect(h.indexVaultFull, order).toHaveBeenCalledTimes(1);
        expect(h.reconcileFolder, order).not.toHaveBeenCalled();
      }
    });

    it("that vanished with indexed files below it escalates even when it was only modified", async () => {
      const h = folderHarness();
      h.queue.enqueue([], { modifiedOnly: ["gone"], source: "watcher" });
      await h.queue.whenIdle();
      expect(h.indexVaultFull).toHaveBeenCalledWith("watcher: folder removed or moved away");
    });

    it("a full scan that reports no change reloads nothing; one that reports files or folders says which", async () => {
      const quiet = folderHarness({ added: 0, changed: 0, removed: 0, foldersChanged: false });
      quiet.queue.enqueue([""]);
      await quiet.queue.whenIdle();
      expect(quiet.indexVaultFull).toHaveBeenCalledWith("index queue: rescan requested");
      expect(quiet.results).toEqual([{ fullScan: true, anyChange: false, paths: null }]);

      const files = folderHarness({ added: 1, changed: 0, removed: 0, foldersChanged: false });
      files.queue.enqueue([""]);
      await files.queue.whenIdle();
      expect(files.results).toEqual([{ fullScan: true, anyChange: true, paths: null }]);

      const folders = folderHarness({ added: 0, changed: 0, removed: 0, foldersChanged: true });
      folders.queue.enqueue([""]);
      await folders.queue.whenIdle();
      expect(folders.results).toEqual([{ fullScan: true, anyChange: true, paths: null, structureChanged: true }]);
    });

    it("a flat look that finds the folder list changed marks the structure", async () => {
      const h = folderHarness();
      h.reconcileFolder.mockResolvedValueOnce({ indexed: [], removed: [], foldersRemoved: false, foldersChanged: true } as never);
      h.queue.enqueue([], { modifiedOnly: ["Projects"] });
      await h.queue.whenIdle();
      expect(h.results).toEqual([{ fullScan: false, anyChange: false, paths: ["Projects"], structureChanged: true }]);
    });
  });

  it("indexes parents before children within a batch", async () => {
    const order: string[] = [];
    const queue = createIncrementalIndexQueue({
      indexer: indexerOf(async (p) => {
        order.push(p);
        return "unchanged";
      }),
      exists: async () => true,
      onBatchDone: () => {},
    });

    queue.enqueue(["f/sub/a.md", "f", "f/sub"]);
    await queue.whenIdle();

    // A deleted folder's own event must be classified BEFORE its child deletions
    // remove the rows the folder's child-prefix check relies on.
    expect(order).toEqual(["f", "f/sub", "f/sub/a.md"]);
  });

  it("escalates to a full scan when a removed file's parent folder vanished", async () => {
    let fullScans = 0;
    const results: IndexBatchResult[] = [];
    const queue = createIncrementalIndexQueue({
      indexer: indexerOf(
        async () => "removed",
        async () => {
          fullScans++;
        }
      ),
      exists: async () => false, // the parent folder is gone from disk too
      onBatchDone: (r) => results.push(r),
    });

    queue.enqueue(["gone-folder/a.md"]);
    await queue.whenIdle();

    expect(fullScans).toBe(1);
    expect(results).toEqual([{ fullScan: true, anyChange: true, paths: null, structureChanged: true }]);
  });

  it("keeps removed files with a live parent incremental and never probes the root", async () => {
    const exists = vi.fn(async () => true);
    const indexVaultFull = vi.fn(async () => {});
    const results: IndexBatchResult[] = [];
    const queue = createIncrementalIndexQueue({
      indexer: indexerOf(async () => "removed", indexVaultFull),
      exists,
      onBatchDone: (r) => results.push(r),
    });

    queue.enqueue(["root-note.md", "notes/a.md"]);
    await queue.whenIdle();

    expect(indexVaultFull).not.toHaveBeenCalled();
    expect(results).toEqual([
      { fullScan: false, anyChange: true, paths: ["root-note.md", "notes/a.md"] },
    ]);
    // The root-level file has no parent folder to probe ("" is skipped).
    expect(exists).toHaveBeenCalledTimes(1);
    expect(exists).toHaveBeenCalledWith("notes");
  });
});
