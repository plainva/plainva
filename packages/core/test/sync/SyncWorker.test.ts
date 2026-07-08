import { describe, it, expect, vi, beforeEach } from "vitest";
import { SyncWorker, isLocalOnlyPath } from "../../src/sync/SyncWorker.js";

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
      hasPendingStructuralOp: vi.fn().mockResolvedValue(false)
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
    expect(engine.processQueue).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
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
});

async function sha(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
