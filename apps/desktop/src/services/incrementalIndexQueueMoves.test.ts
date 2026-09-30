import { describe, expect, it, vi } from "vitest";
import {
  createIncrementalIndexQueue,
  type FolderReconcileLike,
  type IncrementalIndexerLike,
  type IndexBatchResult,
  type IndexPathOutcome,
} from "./incrementalIndexQueue";

/**
 * Issue 110 (E8): on macOS the two sides of a move arrive unpaired, and a
 * side can be missing. A rename or removal that changed the index therefore
 * also reconciles its PARENT folder flat — the row of a file whose own event
 * never came is removed there.
 */

const noReconcile: FolderReconcileLike = { indexed: [], removed: [], foldersRemoved: false };

function harness(outcomes: Record<string, IndexPathOutcome>, reconcile?: (folder: string) => Promise<FolderReconcileLike>) {
  const indexer: IncrementalIndexerLike & { reconcileFolder: ReturnType<typeof vi.fn> } = {
    indexPath: vi.fn(async (p: string) => outcomes[p] ?? "unchanged"),
    indexVaultFull: vi.fn(async () => {}),
    reconcileFolder: vi.fn(async (folder: string) => (reconcile ? reconcile(folder) : noReconcile)),
  };
  const results: IndexBatchResult[] = [];
  const queue = createIncrementalIndexQueue({ indexer, exists: async () => true, onBatchDone: (r) => results.push(r) });
  return { indexer, queue, results };
}

describe("rename and removal events reconcile their parent folder", () => {
  it("an event carrying only the target path still clears the old row beside it", async () => {
    // Renamed in place in Finder; FSEvents named only the new side.
    const h = harness({ "4 blog/link-50.md": "indexed" }, async () => ({
      indexed: [], removed: ["4 blog/draft.md"], foldersRemoved: false,
    }));
    h.queue.enqueue([], { moved: ["4 blog/link-50.md"] });
    await h.queue.whenIdle();
    expect(h.indexer.reconcileFolder).toHaveBeenCalledWith("4 blog", { recursive: false });
    expect(h.results).toEqual([{ fullScan: false, anyChange: true, paths: ["4 blog/link-50.md", "4 blog/draft.md"] }]);
  });

  it("reconciles both parents when both sides arrive, each once", async () => {
    const h = harness({ "blog/n.md": "removed", "blog/taken/n.md": "indexed", "blog/taken/m.md": "indexed" });
    h.queue.enqueue(["blog/taken/m.md"], { moved: ["blog/n.md", "blog/taken/n.md", "blog/taken/m.md"] });
    await h.queue.whenIdle();
    const folders = h.indexer.reconcileFolder.mock.calls.map((c) => c[0]).sort();
    expect(folders).toEqual(["blog", "blog/taken"]);
  });

  it("the vault root is a parent like any other", async () => {
    const h = harness({ "top.md": "removed" });
    h.queue.enqueue([], { moved: ["top.md"] });
    await h.queue.whenIdle();
    expect(h.indexer.reconcileFolder).toHaveBeenCalledWith("", { recursive: false });
  });

  it("costs nothing for the app's own atomic save — the echo changed nothing", async () => {
    const h = harness({ "notes/a.md": "unchanged", "notes/.plainva-tmp-1-2-a.md": "unchanged" });
    h.queue.enqueue([], { moved: ["notes/a.md", "notes/.plainva-tmp-1-2-a.md"] });
    await h.queue.whenIdle();
    expect(h.indexer.reconcileFolder).not.toHaveBeenCalled();
    expect(h.results[0].anyChange).toBe(false);
  });

  it("a plain modification never lists its folder", async () => {
    const h = harness({ "notes/a.md": "indexed" });
    h.queue.enqueue(["notes/a.md"]);
    await h.queue.whenIdle();
    expect(h.indexer.reconcileFolder).not.toHaveBeenCalled();
  });

  it("a subfolder found gone marks the structure as changed", async () => {
    const h = harness({ "p/x.md": "removed" }, async () => ({ indexed: [], removed: ["p/old/a.md"], foldersRemoved: true }));
    h.queue.enqueue([], { moved: ["p/x.md"] });
    await h.queue.whenIdle();
    expect(h.results[0]).toMatchObject({ fullScan: false, structureChanged: true });
  });

  it("falls back to the full scan when a reconcile fails", async () => {
    const h = harness({ "p/x.md": "removed" }, async () => { throw new Error("listing failed"); });
    h.queue.enqueue([], { moved: ["p/x.md"] });
    await h.queue.whenIdle();
    expect(h.indexer.indexVaultFull).toHaveBeenCalledTimes(1);
    expect(h.results[0].fullScan).toBe(true);
  });

  it("keeps the large-batch rule: past 50 paths the full scan replaces every reconcile", async () => {
    const paths = Array.from({ length: 51 }, (_, i) => `n/${i}.md`);
    const h = harness(Object.fromEntries(paths.map((p) => [p, "removed" as const])));
    h.queue.enqueue([], { moved: paths });
    await h.queue.whenIdle();
    expect(h.indexer.indexPath).not.toHaveBeenCalled();
    expect(h.indexer.reconcileFolder).not.toHaveBeenCalled();
    expect(h.indexer.indexVaultFull).toHaveBeenCalledTimes(1);
  });
});
