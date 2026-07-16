import { describe, it, expect, vi, beforeEach } from "vitest";
import { SyncWorker, isLocalOnlyPath, dropCoveredDeletePaths } from "../../src/sync/SyncWorker.js";

describe("dropCoveredDeletePaths", () => {
  it("drops children covered by an ancestor and exact duplicates", () => {
    expect(dropCoveredDeletePaths(["a", "a/b/c.md", "a/d.md", "x.md", "a"]).sort()).toEqual(["a", "x.md"]);
  });

  it("keeps siblings whose name merely starts with the ancestor's name", () => {
    expect(dropCoveredDeletePaths(["a", "ab.md", "a!b.md"]).sort()).toEqual(["a", "a!b.md", "ab.md"]);
  });

  it("covers grandchildren through any ancestor level", () => {
    expect(dropCoveredDeletePaths(["deep/nest/leaf.md", "deep"])).toEqual(["deep"]);
  });
});

describe("SyncWorker", () => {
  let engine: any;
  let target: any;
  let stateRepo: any;
  let vault: any;
  let queue: any;
  let worker: SyncWorker;

  beforeEach(() => {
    engine = { processQueue: vi.fn().mockResolvedValue(undefined) };
    target = {
      pull: vi.fn().mockResolvedValue({ etagMap: new Map() }),
      download: vi.fn().mockResolvedValue(new Uint8Array())
    };
    stateRepo = {
      // The worker reads the whole per-cycle state through ONE snapshot (P2.2).
      getAllStates: vi.fn().mockResolvedValue(new Map()),
      updateLocalHashAndBaseText: vi.fn().mockResolvedValue(undefined),
      updateLocalHashAndBaseTextGuarded: vi.fn().mockResolvedValue(undefined),
      updateLocalHash: vi.fn().mockResolvedValue(undefined),
      updateLocalHashGuarded: vi.fn().mockResolvedValue(undefined),
      updateRemoteState: vi.fn().mockResolvedValue(undefined),
      updateBaseState: vi.fn().mockResolvedValue(undefined),
      deleteSyncState: vi.fn().mockResolvedValue(undefined),
      getBaseText: vi.fn().mockResolvedValue(null)
    };
    vault = {
      exists: vi.fn().mockResolvedValue(false),
      readTextFile: vi.fn().mockResolvedValue(""),
      writeTextFile: vi.fn().mockResolvedValue(undefined),
      deleteItem: vi.fn().mockResolvedValue(undefined)
    };
    queue = {
      queueWrite: vi.fn().mockResolvedValue(undefined),
      resetStuckOperations: vi.fn().mockResolvedValue(undefined),
      hasPendingOperation: vi.fn().mockResolvedValue(false),
      hasPendingStructuralOp: vi.fn().mockResolvedValue(false),
      getPendingStructuralPaths: vi.fn().mockResolvedValue([]),
      getPendingDeletePaths: vi.fn().mockResolvedValue([]),
      discardPendingDeletes: vi.fn().mockResolvedValue([])
    };

    worker = new SyncWorker(engine, target, stateRepo, vault, queue, 100);
    worker["isRunning"] = true;
  });

  it("should pull from target and write new files to vault", async () => {
    target.pull.mockResolvedValueOnce({
      etagMap: new Map([["test.md", "12345"]])
    });
    target.download.mockResolvedValueOnce(new TextEncoder().encode("hello world"));

    await worker.runCycle();

    expect(target.pull).toHaveBeenCalled();
    expect(target.download).toHaveBeenCalledWith("test.md");
    expect(vault.writeTextFile).toHaveBeenCalledWith("test.md", "hello world");
    expect(stateRepo.updateRemoteState).toHaveBeenCalled();
    expect(engine.processQueue).toHaveBeenCalled();
  });

  it("emits pull progress carrying the remote listing size, then clears it (WP6)", async () => {
    target.pull.mockResolvedValueOnce({ etagMap: new Map([["a.md", "1"], ["b.md", "2"]]) });
    target.download.mockResolvedValue(new TextEncoder().encode("x"));
    const progress: Array<{ phase: string; current: number; total: number } | null> = [];
    worker.onProgress = (p) => progress.push(p);

    await worker.runCycle();

    const pullTicks = progress.filter((p): p is { phase: string; current: number; total: number } => p?.phase === "pull");
    expect(pullTicks.length).toBeGreaterThan(0);
    expect(pullTicks.every((p) => p.total === 2)).toBe(true);
    expect(pullTicks[pullTicks.length - 1].current).toBe(2);
    // The cycle clears progress with a terminal null.
    expect(progress[progress.length - 1]).toBeNull();
  });

  it("passes an abort + progress callback into the push engine (WP6)", async () => {
    await worker.runCycle();
    expect(engine.processQueue).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ skipDeletes: false })
    );
  });

  it("should skip re-downloading when the remote etag is unchanged", async () => {
    target.pull.mockResolvedValueOnce({
      etagMap: new Map([["stable.md", "etag-1"]])
    });
    stateRepo.getAllStates.mockResolvedValueOnce(new Map([["stable.md", {
      local_sha256: "x",
      base_sha256: "x",
      remote_etag: "etag-1"
    }]]));

    await worker.runCycle();

    expect(target.download).not.toHaveBeenCalled();
    expect(vault.writeTextFile).not.toHaveBeenCalled();
  });

  it("adopts the local marker only while unchanged when reconcile did not rewrite the file (P1)", async () => {
    // Remote equals local -> writeNeeded=false -> the guarded update must carry
    // the hash read locally, so a save landing mid-reconcile keeps its newer marker.
    target.pull.mockResolvedValueOnce({ etagMap: new Map([["same.md", "etag-2"]]) });
    target.download.mockResolvedValueOnce(new TextEncoder().encode("same content"));
    stateRepo.getAllStates.mockResolvedValueOnce(new Map([["same.md", {
      local_sha256: "whatever",
      base_sha256: "whatever",
      remote_etag: "etag-1"
    }]]));
    vault.exists.mockResolvedValueOnce(true);
    vault.readTextFile.mockResolvedValueOnce("same content");

    await worker.runCycle();

    expect(vault.writeTextFile).not.toHaveBeenCalled();
    expect(stateRepo.updateLocalHashAndBaseText).not.toHaveBeenCalled();
    expect(stateRepo.updateLocalHashAndBaseTextGuarded).toHaveBeenCalledTimes(1);
    const [path, newSha, baseText, expected] = stateRepo.updateLocalHashAndBaseTextGuarded.mock.calls[0];
    expect(path).toBe("same.md");
    expect(baseText).toBe("same content");
    expect(expected).toBe(newSha); // no-write case: the guard is the locally read hash
  });

  it("updates the local marker unconditionally when the reconcile wrote the file (P1)", async () => {
    target.pull.mockResolvedValueOnce({ etagMap: new Map([["new.md", "e1"]]) });
    target.download.mockResolvedValueOnce(new TextEncoder().encode("remote content"));

    await worker.runCycle();

    expect(vault.writeTextFile).toHaveBeenCalledWith("new.md", "remote content");
    expect(stateRepo.updateLocalHashAndBaseText).toHaveBeenCalledTimes(1);
    expect(stateRepo.updateLocalHashAndBaseTextGuarded).not.toHaveBeenCalled();
  });

  it("should handle conflicts when local has pending edits", async () => {
    target.pull.mockResolvedValueOnce({
      etagMap: new Map([["conflict.md", "new-etag"]])
    });
    target.download.mockResolvedValueOnce(new TextEncoder().encode("remote line"));

    // Simulate local edits with a known base.
    stateRepo.getAllStates.mockResolvedValueOnce(new Map([["conflict.md", {
      local_sha256: "local-hash",
      base_sha256: "base-hash",
      remote_etag: "old-etag"
    }]]));
    vault.exists.mockResolvedValueOnce(true);
    vault.readTextFile.mockResolvedValueOnce("local line");
    stateRepo.getBaseText.mockResolvedValueOnce("base line");

    await worker.runCycle();

    // The local version must be preserved as a .CONFLICT file.
    expect(vault.writeTextFile).toHaveBeenCalled();
    const callArgs = vault.writeTextFile.mock.calls[0];
    expect(callArgs[0]).toMatch(/\.CONFLICT-.*\.md$/);
    expect(callArgs[1]).toBe("local line");
  });

  it("should preserve local edits as a conflict on first connect with no base", async () => {
    // No sync_state yet (first connection) but a divergent local file exists.
    target.pull.mockResolvedValueOnce({
      etagMap: new Map([["note.md", "remote-etag"]])
    });
    target.download.mockResolvedValueOnce(new TextEncoder().encode("remote content"));
    // default empty state map: no sync_state yet
    vault.exists.mockResolvedValueOnce(true); // local file exists
    vault.readTextFile.mockResolvedValueOnce("local content"); // and differs

    await worker.runCycle();

    const calls = vault.writeTextFile.mock.calls;
    // First write preserves the local version as a conflict file (no data loss).
    expect(calls[0][0]).toMatch(/note\.CONFLICT-.*\.md$/);
    expect(calls[0][1]).toBe("local content");
    // Second write adopts the remote version as the canonical local file.
    expect(calls[1]).toEqual(["note.md", "remote content"]);
  });

  it("merges disjoint local + remote edits instead of dropping the local change", async () => {
    const base = "Line 1\n\nLine 2\n\nLine 3";
    const local = "Line 1 (local)\n\nLine 2\n\nLine 3";
    const remote = "Line 1\n\nLine 2 (external)\n\nLine 3";
    const baseSha = await sha(base);
    const localSha = await sha(local);

    target.pull.mockResolvedValueOnce({ etagMap: new Map([["note.md", "etag-remote"]]) });
    target.download.mockResolvedValueOnce(new TextEncoder().encode(remote));
    stateRepo.getAllStates.mockResolvedValueOnce(new Map([["note.md", {
      local_sha256: localSha,
      base_sha256: baseSha,
      remote_etag: "etag-old"
    }]]));
    stateRepo.getBaseText.mockResolvedValueOnce(base);
    vault.exists.mockResolvedValueOnce(true);
    vault.readTextFile.mockResolvedValueOnce(local);

    await worker.runCycle();

    // The merged content keeps BOTH edits; the local change must not be lost.
    const writeCall = vault.writeTextFile.mock.calls.find((c: any[]) => c[0] === "note.md");
    expect(writeCall).toBeDefined();
    expect(writeCall![1]).toContain("Line 1 (local)");
    expect(writeCall![1]).toContain("Line 2 (external)");
    // The merge result is queued so it propagates back to the remote.
    expect(queue.queueWrite).toHaveBeenCalledWith("note.md");
  });

  it("does not rewrite the local file when reconciled content equals local (no echo)", async () => {
    const base = "A\n\nB\n\nC";
    const local = "A\n\nB-mine\n\nC";
    const remote = base; // remote still has the base version (e.g. our own etag flux)
    const baseSha = await sha(base);

    target.pull.mockResolvedValueOnce({ etagMap: new Map([["note.md", "etag-new"]]) });
    target.download.mockResolvedValueOnce(new TextEncoder().encode(remote));
    stateRepo.getAllStates.mockResolvedValueOnce(new Map([["note.md", {
      local_sha256: await sha(local),
      base_sha256: baseSha,
      remote_etag: "etag-old"
    }]]));
    stateRepo.getBaseText.mockResolvedValueOnce(base);
    vault.exists.mockResolvedValueOnce(true);
    vault.readTextFile.mockResolvedValueOnce(local);

    await worker.runCycle();

    // merge(base, local, remote=base) = local -> nothing new for disk (no echo),
    // but the still-unsynced local change is queued for push.
    const wroteNote = vault.writeTextFile.mock.calls.some((c: any[]) => c[0] === "note.md");
    expect(wroteNote).toBe(false);
    expect(queue.queueWrite).toHaveBeenCalledWith("note.md");
  });

  it("reconciles a pending-write file against a changed remote instead of clobbering it (3a)", async () => {
    // The user edited a file locally (a WRITE is queued) AND the remote changed
    // concurrently. The old blanket skip let processQueue push the stale local version
    // straight over the newer remote with no .CONFLICT (the reported data loss). The
    // worker must reconcile it: with no reliable base to merge (e.g. after a DB rebuild),
    // it preserves the local copy as a .CONFLICT and adopts the remote — nothing is lost.
    target.pull.mockResolvedValueOnce({ etagMap: new Map([["note.md", "etag-new"]]) });
    target.download.mockResolvedValueOnce(new TextEncoder().encode("remote edit"));
    stateRepo.getAllStates.mockResolvedValueOnce(new Map([["note.md", {
      local_sha256: "local-hash",
      base_sha256: null,        // no reliable base
      remote_etag: "etag-old",  // differs -> reconcile
    }]]));
    queue.hasPendingOperation.mockResolvedValue(true);       // a write is queued...
    queue.hasPendingStructuralOp.mockResolvedValue(false);   // ...but not a delete/rename
    vault.exists.mockResolvedValueOnce(true);
    vault.readTextFile.mockResolvedValueOnce("local edit");

    await worker.runCycle();

    const calls = vault.writeTextFile.mock.calls;
    // Local preserved as .CONFLICT, remote adopted as the canonical local. No silent clobber.
    expect(calls[0][0]).toMatch(/note\.CONFLICT-.*\.md$/);
    expect(calls[0][1]).toBe("local edit");
    expect(calls.some((c: any[]) => c[0] === "note.md" && c[1] === "remote edit")).toBe(true);
    expect(engine.processQueue).toHaveBeenCalled();
  });

  it("still skips reconcile for a file with a pending DELETE/RENAME (no resurrection) (3a)", async () => {
    // A pending structural op must still short-circuit reconcile — re-downloading and
    // rewriting a file the user is deleting/renaming would resurrect it. Only pending
    // WRITES now fall through to reconcile.
    target.pull.mockResolvedValueOnce({ etagMap: new Map([["gone.md", "etag-new"]]) });
    stateRepo.getAllStates.mockResolvedValueOnce(new Map([["gone.md", {
      local_sha256: "x",
      base_sha256: "x",
      remote_etag: "etag-old", // differs -> would reconcile if not for the pending delete
    }]]));
    queue.hasPendingStructuralOp.mockResolvedValueOnce(true);
    // The prefetcher consults the batch query (P3.3): the same pending
    // delete/rename must also keep the SPECULATIVE download from starting.
    queue.getPendingStructuralPaths.mockResolvedValueOnce(["gone.md"]);

    await worker.runCycle();

    expect(queue.hasPendingStructuralOp).toHaveBeenCalledWith("gone.md");
    expect(target.download).not.toHaveBeenCalled();
    expect(vault.writeTextFile).not.toHaveBeenCalled();
    expect(engine.processQueue).toHaveBeenCalled(); // the push (delete/rename) still runs
  });

  it("excludes device-local paths from the pull progress count (2a)", async () => {
    // A desktop client mirroring the same folder uploads .plainva/**; those entries are
    // skipped during reconcile and must not inflate "Sync x/y" — only real files count.
    target.pull.mockResolvedValueOnce({ etagMap: new Map([
      [".plainva/backups/note.md.bak", "b1"],
      [".plainva/vault.db", "b2"],
      ["note.md", "etag-note"],
    ]) });
    target.download.mockResolvedValue(new TextEncoder().encode("x"));
    const totals = new Set<number>();
    worker.onProgress = (p) => { if (p?.phase === "pull") totals.add(p.total); };

    await worker.runCycle();

    // Only the single real file is counted (not the two device-local entries).
    expect([...totals]).toEqual([1]);
  });

  it("fires onFirstCycleComplete once after the first successful cycle (3c)", async () => {
    const spy = vi.fn();
    worker.onFirstCycleComplete = spy;

    await worker.runCycle();
    await worker.runCycle();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("should mirror a remote deletion when the local copy is unchanged", async () => {
    // gone.md still exists locally and is unchanged vs its recorded base.
    const goneSha = await sha("orphan");

    // Remote listing has one file; a previously synced file is gone remotely.
    target.pull.mockResolvedValueOnce({
      etagMap: new Map([["kept.md", "etag-kept"]])
    });
    target.download.mockResolvedValueOnce(new TextEncoder().encode("kept content"));
    stateRepo.getAllStates.mockResolvedValueOnce(new Map([
      ["gone.md", { remote_etag: "etag-old", base_sha256: goneSha }],
      // kept.md has no recorded state -> reconciled as a new remote file
    ]));
    vault.exists.mockImplementation(async (p: string) => p === "gone.md");
    vault.readTextFile.mockResolvedValue("orphan");

    await worker.runCycle();

    expect(vault.deleteItem).toHaveBeenCalledWith("gone.md");
    expect(stateRepo.deleteSyncState).toHaveBeenCalledWith("gone.md");
  });

  it("suspends deletion mirroring when the listing looks incomplete (P1.4)", async () => {
    // 12 previously synced files, but the listing suddenly contains only one:
    // that smells like a broken/partial listing, not a genuine mass deletion.
    const known = Array.from({ length: 12 }, (_, i) => `note-${i}.md`);
    const baseSha = await sha("same");

    target.pull.mockResolvedValueOnce({
      etagMap: new Map([["note-0.md", "etag-0"]])
    });
    stateRepo.getAllStates.mockResolvedValueOnce(
      new Map(known.map((p) => [p, { remote_etag: "etag-old", base_sha256: baseSha }]))
    );
    vault.exists.mockResolvedValue(true);
    vault.readTextFile.mockResolvedValue("same");
    target.download.mockResolvedValue(new TextEncoder().encode("same"));
    const statusSpy = vi.fn();
    worker.onStatusChange = statusSpy;

    await worker.runCycle();

    // NOTHING got deleted locally, and the cycle surfaced a sync error.
    expect(vault.deleteItem).not.toHaveBeenCalled();
    const errorCall = statusSpy.mock.calls.find(([status]) => status === "error");
    expect(errorCall).toBeDefined();
    expect(String(errorCall![1])).toContain("suspended");
  });

  it("still mirrors deletions below the suspicion threshold", async () => {
    // 12 known files, 1 missing: plausible single deletion -> mirrored.
    const known = Array.from({ length: 12 }, (_, i) => `note-${i}.md`);
    const listed = known.slice(0, 11); // note-11.md missing
    const baseSha = await sha("same");

    target.pull.mockResolvedValueOnce({
      etagMap: new Map(listed.map((p, i) => [p, `etag-${i}`]))
    });
    stateRepo.getAllStates.mockResolvedValueOnce(
      new Map(known.map((p) => [p, { remote_etag: "etag-old", base_sha256: baseSha }]))
    );
    // Reconcile path would try to download the 11 listed files; keep them unchanged.
    target.download.mockResolvedValue(new TextEncoder().encode("same"));
    vault.exists.mockResolvedValue(true);
    vault.readTextFile.mockResolvedValue("same");

    await worker.runCycle();

    expect(vault.deleteItem).toHaveBeenCalledWith("note-11.md");
  });

  it("never pulls device-local state (.plainva/vault.db) from the remote (index-corruption guard)", async () => {
    // A Google Drive / Dropbox / OneDrive desktop client that independently mirrors the
    // same folder uploads the SQLite index. If the worker pulled it back over the live
    // local DB the index corrupts ("database disk image is malformed"). The pull side
    // must skip .plainva just like the push side already does.
    target.pull.mockResolvedValueOnce({
      etagMap: new Map([
        [".plainva/vault.db", "etag-db"],
        ["note.md", "etag-note"],
      ]),
    });
    target.download.mockResolvedValue(new TextEncoder().encode("hello"));

    await worker.runCycle();

    // The real note is pulled; the device-local index DB is never even downloaded.
    expect(target.download).toHaveBeenCalledWith("note.md");
    expect(target.download).not.toHaveBeenCalledWith(".plainva/vault.db");
    const touchedPlainva = vault.writeTextFile.mock.calls.some((c: any[]) => String(c[0]).includes(".plainva"));
    expect(touchedPlainva).toBe(false);
    const wroteConflict = vault.writeTextFile.mock.calls.some((c: any[]) => String(c[0]).includes(".CONFLICT"));
    expect(wroteConflict).toBe(false);
  });

  it("never deletion-mirrors a device-local file absent from the remote listing", async () => {
    // .plainva/graph.json can linger in sync_state from an older build; a remote that no
    // longer lists it must not make the worker delete the local device-local file.
    target.pull.mockResolvedValueOnce({
      etagMap: new Map([["kept.md", "etag-kept"]]),
    });
    target.download.mockResolvedValueOnce(new TextEncoder().encode("kept"));
    stateRepo.getAllStates.mockResolvedValueOnce(new Map([
      [".plainva/graph.json", { remote_etag: "etag-old", base_sha256: await sha("pins") }],
    ]));
    vault.exists.mockResolvedValue(true);
    vault.readTextFile.mockResolvedValue("pins");

    await worker.runCycle();

    expect(vault.deleteItem).not.toHaveBeenCalledWith(".plainva/graph.json");
  });

  it("isLocalOnlyPath classifies device-local and conflict paths", () => {
    expect(isLocalOnlyPath(".plainva/vault.db")).toBe(true);
    expect(isLocalOnlyPath(".plainva/graph.json")).toBe(true);
    expect(isLocalOnlyPath("notes/a.CONFLICT-2026-07-08T00-00-00-000Z.md")).toBe(true);
    expect(isLocalOnlyPath("notes/index.md")).toBe(false);
    expect(isLocalOnlyPath("Projects.base")).toBe(false);
  });

  it("does a full listing first, then pulls incrementally with the seeded cursor (1a)", async () => {
    target.getStartCursor = vi.fn().mockResolvedValue("cursor-A");
    target.download.mockResolvedValue(new TextEncoder().encode("x"));
    // Cycle 1: full listing (no cursor yet) -> seeds the cursor.
    target.pull.mockResolvedValueOnce({ etagMap: new Map([["a.md", "e1"]]) });
    await worker.runCycle();
    // Cycle 2: incremental pull with the seeded cursor.
    target.pull.mockResolvedValueOnce({ etagMap: new Map(), deleted: [], nextCursor: "cursor-B" });
    await worker.runCycle();

    expect(target.getStartCursor).toHaveBeenCalledTimes(1); // only before the full listing
    expect(target.pull.mock.calls[0][0]).toBeUndefined();   // cycle 1 = full listing
    expect(target.pull.mock.calls[1][0]).toBe("cursor-A");  // cycle 2 = incremental
  });

  it("an incremental cycle deletes only explicit deleted[] paths, never missing-from-listing (1a safety)", async () => {
    // Force incremental mode (cursor already seeded). Two previously-synced files exist
    // locally, unchanged vs base: in a FULL listing an empty etagMap would make BOTH look
    // "missing" and delete them. The incremental path must ignore that and delete ONLY the
    // explicitly-deleted one.
    worker["cursor"] = "c0";
    const sameSha = await sha("same");
    stateRepo.getAllStates.mockResolvedValueOnce(new Map([
      ["keep.md", { remote_etag: "e-keep", base_sha256: sameSha }],
      ["gone.md", { remote_etag: "e-gone", base_sha256: sameSha }],
    ]));
    vault.exists.mockResolvedValue(true);
    vault.readTextFile.mockResolvedValue("same");
    target.pull.mockResolvedValueOnce({ etagMap: new Map(), deleted: ["gone.md"], nextCursor: "c1" });

    await worker.runCycle();

    expect(target.pull).toHaveBeenCalledWith("c0"); // incremental
    expect(vault.deleteItem).toHaveBeenCalledWith("gone.md");
    expect(vault.deleteItem).not.toHaveBeenCalledWith("keep.md");
  });

  it("runs a periodic full listing after N incremental cycles (1a)", async () => {
    worker["cursor"] = "c0";
    worker["cyclesSinceFull"] = 20; // at the threshold -> the next cycle must be a full listing
    target.getStartCursor = vi.fn().mockResolvedValue("c-fresh");
    target.pull.mockResolvedValueOnce({ etagMap: new Map() });

    await worker.runCycle();

    expect(target.getStartCursor).toHaveBeenCalled(); // full listing re-seeds the cursor
    expect(target.pull.mock.calls[0][0]).toBeUndefined(); // full pull (no cursor arg)
    expect(worker["cyclesSinceFull"]).toBe(0);
    expect(worker["cursor"]).toBe("c-fresh");
  });

  it("stays on full listings when the target has no getStartCursor (1a fallback)", async () => {
    // The shared mock has no getStartCursor (like WebDAV/S3/OneDrive/Dropbox).
    target.download.mockResolvedValue(new TextEncoder().encode("x"));
    target.pull.mockResolvedValueOnce({ etagMap: new Map([["a.md", "e1"]]) });
    target.pull.mockResolvedValueOnce({ etagMap: new Map([["a.md", "e1"]]) });
    await worker.runCycle();
    await worker.runCycle();

    expect(target.pull.mock.calls[0][0]).toBeUndefined();
    expect(target.pull.mock.calls[1][0]).toBeUndefined();
    expect(worker["cursor"]).toBeUndefined();
  });

  it("drops the cursor after a failed pull so the next cycle re-syncs via full listing (1a self-heal)", async () => {
    // A stale/expired change token (Drive 410) or any pull error must not wedge the worker
    // on a broken cursor forever — the cursor is reset so the next cycle does a full listing.
    worker["cursor"] = "stale-token";
    target.pull.mockRejectedValueOnce(new Error("410 change token expired"));

    await worker.runCycle();

    expect(target.pull).toHaveBeenCalledWith("stale-token"); // it did try the incremental pull
    expect(worker["cursor"]).toBeUndefined();                // ...and reset the cursor on failure
  });

  describe("chunked, loss-proof onFilesChanged (tree-refresh fix)", () => {
    it("emits onFilesChanged in chunks during the cycle and never double-reports", async () => {
      const paths = Array.from({ length: 60 }, (_, i) => `note-${String(i).padStart(2, "0")}.md`);
      target.pull.mockResolvedValueOnce({ etagMap: new Map(paths.map((p, i) => [p, `e${i}`])) });
      target.download.mockResolvedValue(new TextEncoder().encode("x"));
      const batches: string[][] = [];
      worker.onFilesChanged = (p) => batches.push(p);

      await worker.runCycle();

      // 60 written files -> chunks of <= 25, at least two of them mid-cycle.
      expect(batches.length).toBeGreaterThanOrEqual(2);
      expect(batches.every((b) => b.length <= 25)).toBe(true);
      const flat = batches.flat();
      expect(flat.length).toBe(60);
      expect(new Set(flat).size).toBe(60); // no double-reporting
      expect(new Set(flat)).toEqual(new Set(paths));
    });

    it("reports pulled files even when the push phase fails (the reported bug)", async () => {
      // THE reported failure mode: files were written and their sync_state advanced,
      // then the cycle errored -> the old end-of-cycle emission never ran and the next
      // cycle skipped the files via the etag match. They stayed invisible until restart.
      const paths = ["a.md", "b.md", "c.md", "d.md", "e.md"];
      target.pull.mockResolvedValueOnce({ etagMap: new Map(paths.map((p, i) => [p, `e${i}`])) });
      target.download.mockResolvedValue(new TextEncoder().encode("x"));
      engine.processQueue.mockRejectedValueOnce(new Error("push exploded"));
      const batches: string[][] = [];
      worker.onFilesChanged = (p) => batches.push(p);
      const statusSpy = vi.fn();
      worker.onStatusChange = statusSpy;

      await worker.runCycle();

      expect(new Set(batches.flat())).toEqual(new Set(paths));
      expect(statusSpy.mock.calls.some(([s]) => s === "error")).toBe(true);
    });

    it("reports files written before a mid-pull abort (finally flush)", async () => {
      // a+b download fine, then three consecutive failures trip the breaker and abort
      // the cycle. The finally flush must still deliver a+b.
      const paths = ["a.md", "b.md", "c.md", "d.md", "e.md"];
      target.pull.mockResolvedValueOnce({ etagMap: new Map(paths.map((p, i) => [p, `e${i}`])) });
      target.download.mockImplementation(async (p: string) => {
        if (p === "a.md" || p === "b.md") return new TextEncoder().encode("x");
        throw new Error("503 unavailable");
      });
      const batches: string[][] = [];
      worker.onFilesChanged = (p) => batches.push(p);

      await worker.runCycle();

      expect(target.download).toHaveBeenCalledTimes(5); // a, b ok; c, d, e fail -> abort
      expect(batches.flat()).toEqual(["a.md", "b.md"]);
      expect(worker["consecutiveFailures"]).toBe(1); // the abort engages the backoff
    });

    it("reports pulled files when the worker is stopped mid-cycle", async () => {
      target.pull.mockResolvedValueOnce({ etagMap: new Map([["a.md", "e1"], ["b.md", "e2"]]) });
      target.download.mockResolvedValue(new TextEncoder().encode("x"));
      vault.writeTextFile.mockImplementation(async () => {
        worker["isRunning"] = false; // stop() lands right after the first write
      });
      const batches: string[][] = [];
      worker.onFilesChanged = (p) => batches.push(p);

      await worker.runCycle();

      expect(batches.flat()).toEqual(["a.md"]);
      expect(engine.processQueue).not.toHaveBeenCalled(); // the cycle really did stop early
    });

    it("a throwing onFilesChanged consumer does not fail the cycle", async () => {
      target.pull.mockResolvedValueOnce({ etagMap: new Map([["a.md", "e1"]]) });
      target.download.mockResolvedValue(new TextEncoder().encode("x"));
      worker.onFilesChanged = () => { throw new Error("consumer bug"); };
      const statusSpy = vi.fn();
      worker.onStatusChange = statusSpy;

      await worker.runCycle();

      expect(statusSpy.mock.calls.at(-1)?.[0]).toBe("idle");
      expect(worker["consecutiveFailures"]).toBe(0);
    });
  });

  describe("per-file pull resilience", () => {
    it("continues past a single failing download and does not adopt the seeded cursor", async () => {
      target.getStartCursor = vi.fn().mockResolvedValue("cursor-A");
      target.pull.mockResolvedValueOnce({ etagMap: new Map([["a.md", "e1"], ["b.md", "e2"], ["c.md", "e3"]]) });
      target.download.mockImplementation(async (p: string) => {
        if (p === "b.md") throw new Error("403 rate limited");
        return new TextEncoder().encode("x");
      });
      const batches: string[][] = [];
      worker.onFilesChanged = (p) => batches.push(p);
      const statusSpy = vi.fn();
      worker.onStatusChange = statusSpy;

      await worker.runCycle();

      // The neighbors were pulled and reported; the poisoned file was skipped.
      expect(new Set(batches.flat())).toEqual(new Set(["a.md", "c.md"]));
      expect(stateRepo.updateRemoteState.mock.calls.every((c: any[]) => c[0] !== "b.md")).toBe(true);
      // The seeded cursor is NOT adopted -> the next cycle full-lists and retries b.md.
      expect(worker["cursor"]).toBeUndefined();
      const errorCall = statusSpy.mock.calls.find(([s]) => s === "error");
      expect(String(errorCall?.[1])).toContain("1 file(s)");
      // A completed cycle with partial failures must NOT engage the backoff.
      expect(worker["consecutiveFailures"]).toBe(0);
    });

    it("aborts the pull after 3 consecutive file failures and resets the cursor", async () => {
      worker["cursor"] = "c0";
      const paths = ["a.md", "b.md", "c.md", "d.md", "e.md"];
      target.pull.mockResolvedValueOnce({
        etagMap: new Map(paths.map((p, i) => [p, `e${i}`])),
        nextCursor: "c1",
      });
      target.download.mockRejectedValue(new Error("network down"));
      const statusSpy = vi.fn();
      worker.onStatusChange = statusSpy;

      await worker.runCycle();

      // Breaker semantics: the cycle aborts after 3 CONSUMED consecutive
      // failures (outage, not per-file poison). The prefetcher may have
      // STARTED more speculative downloads than were consumed — the abort is
      // observable through the backoff/cursor/status, not the start count.
      expect(target.download.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(worker["cursor"]).toBeUndefined();          // catch resets -> full-listing self-heal
      expect(worker["consecutiveFailures"]).toBe(1);     // backoff engaged
      expect(statusSpy.mock.calls.some(([s]) => s === "error")).toBe(true);
    });

    it("prefetches downloads but PROCESSES files strictly in listing order (P3.3)", async () => {
      const order = ["a.md", "b.md", "c.md", "d.md"];
      target.pull.mockResolvedValueOnce({
        etagMap: new Map(order.map((p, i) => [p, `e${i}`])),
      });
      // First download resolves LAST — with naive parallel processing d.md
      // would finish first; the worker must still write in listing order.
      const resolvers = new Map<string, (b: Uint8Array) => void>();
      target.download.mockImplementation(
        (p: string) =>
          new Promise<Uint8Array>((resolve) => {
            resolvers.set(p, resolve);
            if (p !== "a.md") resolve(new TextEncoder().encode(`content ${p}`));
          })
      );
      const cycle = worker.runCycle();
      // Let the prefetcher start, then release the slow head-of-line file.
      await new Promise((r) => setTimeout(r, 10));
      resolvers.get("a.md")?.(new TextEncoder().encode("content a.md"));
      await cycle;

      const writtenOrder = vault.writeTextFile.mock.calls.map((c: any[]) => c[0]);
      expect(writtenOrder).toEqual(order);
    });

    it("keeps the incremental cursor for replay when a file failed", async () => {
      worker["cursor"] = "c0";
      target.pull.mockResolvedValueOnce({
        etagMap: new Map([["a.md", "e1"], ["b.md", "e2"]]),
        nextCursor: "c1",
      });
      target.download.mockImplementation(async (p: string) => {
        if (p === "b.md") throw new Error("timeout");
        return new TextEncoder().encode("x");
      });

      await worker.runCycle();

      // Replaying the SAME cursor next cycle re-lists exactly the failed file.
      expect(worker["cursor"]).toBe("c0");
      expect(worker["cyclesSinceFull"]).toBe(0);
    });

    it("keeps the cursor when an explicit deletion fails to mirror", async () => {
      worker["cursor"] = "c0";
      const sameSha = await sha("same");
      target.pull.mockResolvedValueOnce({ etagMap: new Map(), deleted: ["a.md", "b.md"], nextCursor: "c1" });
      stateRepo.getAllStates.mockResolvedValueOnce(new Map([
        ["a.md", { remote_etag: "ea", base_sha256: sameSha }],
        ["b.md", { remote_etag: "eb", base_sha256: sameSha }],
      ]));
      vault.exists.mockResolvedValue(true);
      vault.readTextFile.mockResolvedValue("same");
      vault.deleteItem.mockImplementation(async (p: string) => {
        if (p === "a.md") throw new Error("locked");
      });
      const statusSpy = vi.fn();
      worker.onStatusChange = statusSpy;

      await worker.runCycle();

      // The other deletion still ran; the unadvanced cursor replays the failed one.
      expect(vault.deleteItem).toHaveBeenCalledWith("b.md");
      expect(worker["cursor"]).toBe("c0");
      expect(statusSpy.mock.calls.some(([s]) => s === "error")).toBe(true);
    });

    it("defers onFirstCycleComplete until a cycle with zero pull failures", async () => {
      // A failed reconcile leaves that file without a remote base; enqueueLocalOnlyFiles
      // would misclassify it as local-only and push it over a possibly newer remote (3c).
      const spy = vi.fn();
      worker.onFirstCycleComplete = spy;
      target.pull.mockResolvedValueOnce({ etagMap: new Map([["a.md", "e1"]]) });
      target.download.mockRejectedValueOnce(new Error("flaky"));

      await worker.runCycle();
      expect(spy).not.toHaveBeenCalled();

      target.pull.mockResolvedValueOnce({ etagMap: new Map() });
      await worker.runCycle();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("push-side mass-deletion guard", () => {
    const syncedBaseline = (n: number) =>
      new Map(Array.from({ length: n }, (_, i) => [`s-${i}.md`, { remote_etag: `e${i}` }]));

    it("holds queued remote deletes and signals the host exactly once", async () => {
      // 12 queued deletes against 20 synced files: > 10 AND > 20% -> a local mass
      // deletion (e.g. the vault folder was emptied). Executing it would wipe the
      // remote copy — exactly the abandoned-vault incident this guard prevents.
      queue.getPendingDeletePaths.mockResolvedValue(
        Array.from({ length: 12 }, (_, i) => `del-${i}.md`)
      );
      stateRepo.getAllStates.mockResolvedValue(syncedBaseline(20));
      const pendingSpy = vi.fn();
      worker.onMassDeletionPending = pendingSpy;
      const statusSpy = vi.fn();
      worker.onStatusChange = statusSpy;

      await worker.runCycle();
      await worker.runCycle();

      const calls = engine.processQueue.mock.calls;
      expect(calls[0][2]).toEqual({ skipDeletes: true });
      expect(calls[1][2]).toEqual({ skipDeletes: true });
      expect(pendingSpy).toHaveBeenCalledTimes(1); // no re-prompt every poll cycle
      expect(pendingSpy).toHaveBeenCalledWith({ pendingDeletes: 12, syncedTotal: 20 });
      const errorCall = statusSpy.mock.calls.find(([s]) => s === "error");
      expect(String(errorCall?.[1])).toContain("queued for remote deletion");
    });

    it("lets small, plausible deletions through untouched", async () => {
      queue.getPendingDeletePaths.mockResolvedValue(["one.md", "two.md"]);
      stateRepo.getAllStates.mockResolvedValue(syncedBaseline(20));
      const pendingSpy = vi.fn();
      worker.onMassDeletionPending = pendingSpy;

      await worker.runCycle();

      expect(engine.processQueue.mock.calls[0][2]).toEqual({ skipDeletes: false });
      expect(pendingSpy).not.toHaveBeenCalled();
    });

    it("deletions confirmed in-app bypass the guard (session allowlist, E2)", async () => {
      // A deliberate folder deletion confirmed in the app: 1 folder op + 11
      // child ops. The guard must neither hold nor prompt — the in-app flow
      // already ran its own (double) confirmation.
      queue.getPendingDeletePaths.mockResolvedValue([
        "proj",
        ...Array.from({ length: 11 }, (_, i) => `proj/f-${i}.md`),
      ]);
      stateRepo.getAllStates.mockResolvedValue(syncedBaseline(20));
      const pendingSpy = vi.fn();
      worker.onMassDeletionPending = pendingSpy;

      worker.noteUserInitiatedDeletion(["proj"]);
      await worker.runCycle();

      expect(engine.processQueue.mock.calls[0][2]).toEqual({ skipDeletes: false });
      expect(pendingSpy).not.toHaveBeenCalled();
    });

    it("children covered by a queued ancestor folder delete do not inflate the count", async () => {
      // Even WITHOUT the session allowlist (e.g. after a restart), one folder
      // deletion is ONE unexplained deletion, not twelve — the N+1 inflation
      // used to trip the guard on ordinary folders.
      queue.getPendingDeletePaths.mockResolvedValue([
        "folder",
        ...Array.from({ length: 11 }, (_, i) => `folder/f-${i}.md`),
      ]);
      stateRepo.getAllStates.mockResolvedValue(syncedBaseline(20));
      const pendingSpy = vi.fn();
      worker.onMassDeletionPending = pendingSpy;

      await worker.runCycle();

      expect(engine.processQueue.mock.calls[0][2]).toEqual({ skipDeletes: false });
      expect(pendingSpy).not.toHaveBeenCalled();
    });

    it("a genuine external mass deletion still trips the guard despite unrelated user deletions", async () => {
      queue.getPendingDeletePaths.mockResolvedValue([
        "user-folder",
        ...Array.from({ length: 12 }, (_, i) => `ext-${i}.md`),
      ]);
      stateRepo.getAllStates.mockResolvedValue(syncedBaseline(20));
      const pendingSpy = vi.fn();
      worker.onMassDeletionPending = pendingSpy;

      worker.noteUserInitiatedDeletion(["user-folder"]);
      await worker.runCycle();

      expect(engine.processQueue.mock.calls[0][2]).toEqual({ skipDeletes: true });
      // The prompt reports what the two buttons would act on: ALL queued deletes.
      expect(pendingSpy).toHaveBeenCalledWith({ pendingDeletes: 13, syncedTotal: 20 });
    });

    it("approveMassDeletion executes the held deletes on the next cycle", async () => {
      queue.getPendingDeletePaths.mockResolvedValue(
        Array.from({ length: 12 }, (_, i) => `del-${i}.md`)
      );
      stateRepo.getAllStates.mockResolvedValue(syncedBaseline(20));

      await worker.runCycle();
      expect(engine.processQueue.mock.calls.at(-1)![2]).toEqual({ skipDeletes: true });

      worker["isRunning"] = false; // keep triggerImmediate from racing the unit test
      worker.approveMassDeletion();
      worker["isRunning"] = true;
      await worker.runCycle();

      expect(engine.processQueue.mock.calls.at(-1)![2]).toEqual({ skipDeletes: false });
    });

    it("discardMassDeletion drops the deletes, clears their sync_state and forces a full listing", async () => {
      queue.discardPendingDeletes.mockResolvedValue(["a.md", "b.md"]);
      worker["cursor"] = "c0";
      worker["isRunning"] = false; // triggerImmediate is a no-op in the unit test

      const discarded = await worker.discardMassDeletion();

      expect(discarded).toBe(2);
      // Clearing sync_state is what makes the restore work: the reconcile skips
      // paths whose recorded remote_etag still matches, so a stale row would
      // block the re-download forever.
      expect(stateRepo.deleteSyncState).toHaveBeenCalledWith("a.md");
      expect(stateRepo.deleteSyncState).toHaveBeenCalledWith("b.md");
      expect(worker["cursor"]).toBeUndefined(); // next cycle full-lists -> immediate restore
    });
  });

  it("triggerFullListing drops the cursor so the next cycle lists everything", async () => {
    // Cursor-mode provider: seed a cursor via getStartCursor + full listing.
    target.getStartCursor = vi.fn().mockResolvedValue("cursor-1");
    target.pull = vi.fn().mockResolvedValue({ etagMap: new Map() });
    await worker["runCycle"]();
    // Steady state: the next cycle pulls INCREMENTALLY with the cursor.
    await worker["runCycle"]();
    expect(target.pull).toHaveBeenLastCalledWith("cursor-1");

    // A user-facing "sync now" must see brand-new remote files, which only
    // a full listing can deliver — triggerFullListing drops the cursor.
    worker.triggerFullListing();
    await worker["runCycle"]();
    // The full-listing branch calls pull() with no argument at all.
    expect(target.pull.mock.calls.at(-1)).toEqual([]);
  });

  describe("mobile responsiveness + freeze recovery (2026-07-16)", () => {
    it("fullResync resets stuck queue ops, drops the cursor and full-lists immediately", async () => {
      worker["cursor"] = "c1";

      await worker.fullResync();
      await worker["currentCycle"];
      worker.stop();

      expect(queue.resetStuckOperations).toHaveBeenCalled();
      expect(target.pull).toHaveBeenCalledTimes(1);
      expect(target.pull.mock.calls[0]).toEqual([]); // full listing, not pull("c1")
    });

    it("forces a full listing once the last one is older than the wall-clock ceiling", async () => {
      // The cycle counter freezes with the WebView in the background; wall-clock
      // time does not — a stale cursor session must re-list on the first cycle back.
      worker["cursor"] = "c1";
      worker["lastFullListingAt"] = Date.now() - 11 * 60_000;
      await worker.runCycle();
      expect(target.pull.mock.calls[0]).toEqual([]);
    });

    it("stays on the cheap cursor pull while the last full listing is fresh", async () => {
      worker["cursor"] = "c1";
      worker["lastFullListingAt"] = Date.now() - 60_000;
      target.pull.mockResolvedValueOnce({ etagMap: new Map(), deleted: [], nextCursor: "c2" });
      await worker.runCycle();
      expect(target.pull.mock.calls[0]).toEqual(["c1"]);
    });

    it("drops the cursor and queues an immediate follow-up when the cursor pull could not resolve a change", async () => {
      worker["cursor"] = "c1";
      worker["lastFullListingAt"] = Date.now();
      target.pull.mockResolvedValueOnce({
        etagMap: new Map(),
        deleted: [],
        nextCursor: "c2",
        needsFullListing: true,
      });

      await worker.runCycle();

      expect(worker["cursor"]).toBeUndefined();
      expect(worker["pendingSyncRequest"]).toBe(true);
    });

    it("watchdog warns on a stuck cycle, abandons it after the inactivity ceiling and revives the worker", async () => {
      vi.useFakeTimers();
      try {
        let pullCalls = 0;
        // A request the platform never answers: the pull promise never settles,
        // which used to leave isSyncing=true forever (only a force-close helped).
        target.pull = vi.fn(() => {
          pullCalls++;
          return new Promise(() => {});
        });
        const statuses: Array<{ s: string; e?: string }> = [];
        worker.onStatusChange = (s, e) => statuses.push({ s, e });
        worker["isRunning"] = false; // start() guards on an already-running worker
        worker.start();
        await vi.advanceTimersByTimeAsync(0); // flush resetStuckOperations -> first cycle
        expect(pullCalls).toBe(1);
        expect(worker["isSyncing"]).toBe(true);

        // 10 min of inactivity: warn, but do not abandon yet.
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(statuses.some((x) => x.s === "error" && /stuck/i.test(x.e ?? ""))).toBe(true);
        expect(worker["isSyncing"]).toBe(true);

        // 15 min of inactivity: the cycle is written off and the worker frees
        // itself (checked exactly at the abandon tick, before the fresh cycle
        // scheduled right after starts and re-enters syncing).
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(statuses.some((x) => x.s === "error" && /abandoned/i.test(x.e ?? ""))).toBe(true);
        expect(worker["isSyncing"]).toBe(false);
        expect(worker["cursor"]).toBeUndefined();

        // A fresh cycle was scheduled — the worker is responsive again without a restart.
        await vi.advanceTimersByTimeAsync(200);
        expect(pullCalls).toBe(2);
        worker.stop();
      } finally {
        vi.useRealTimers();
      }
    });

    it("a healthy long first sync never trips the watchdog (activity resets the idle clock)", async () => {
      vi.useFakeTimers();
      try {
        // pull resolves promptly; the cycle then reconciles files one by one,
        // each step taking 5 min of wall clock but BUMPING cycle activity.
        target.pull = vi.fn().mockResolvedValue({
          etagMap: new Map([
            ["a.md", "e1"],
            ["b.md", "e2"],
            ["c.md", "e3"],
            ["d.md", "e4"],
          ]),
        });
        target.download = vi.fn(
          () =>
            new Promise<Uint8Array>((resolve) => {
              setTimeout(() => resolve(new TextEncoder().encode("x")), 5 * 60_000);
            })
        );
        const statuses: Array<{ s: string; e?: string }> = [];
        worker.onStatusChange = (s, e) => statuses.push({ s, e });
        worker["isRunning"] = false;
        worker.start();
        await vi.advanceTimersByTimeAsync(0);

        // 4 files x 5 min = 20 min total cycle time, activity every 5 min.
        await vi.advanceTimersByTimeAsync(21 * 60_000);

        expect(statuses.some((x) => /abandoned/i.test(x.e ?? ""))).toBe(false);
        expect(statuses.some((x) => x.s === "idle")).toBe(true); // the cycle completed
        worker.stop();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

async function sha(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
