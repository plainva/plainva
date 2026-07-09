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
    expect(results).toEqual([{ fullScan: true, anyChange: true, paths: null }]);
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

    const throwingQueue = createIncrementalIndexQueue({
      indexer: indexerOf(
        async () => {
          throw new Error("db locked");
        },
        async () => {
          fullScans++;
        }
      ),
      exists: async () => true,
      onBatchDone: () => {},
    });
    throwingQueue.enqueue(["x.md"]);
    await throwingQueue.whenIdle();
    expect(fullScans).toBe(2);
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
    expect(results).toEqual([{ fullScan: true, anyChange: true, paths: null }]);
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
