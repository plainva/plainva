import { describe, it, expect, vi, afterEach } from "vitest";
import { SyncWorker, type ListingIncompleteInfo } from "../../src/sync/SyncWorker.js";
import type { RemotePresence, RemoteProbe } from "../../src/sync/ISyncTarget.js";
import { addConflictFixture } from "../helpers/conflictFixture.js";

/**
 * A rename made on another device reaches this one as a MOVE (plan Befunde
 * 2026-09-24, E12).
 *
 * The file sync pushes a rename as a rename — Drive keeps the file's id, a
 * path store moves the object. What this device then sees is a listing
 * without the old name and with a new one. Until now that read as "one file
 * deleted, one created", and the deletion guard of 20.09. treated it as such:
 *
 * - Drive: the probe asks for the old file by its ID, the id is alive under
 *   the new name — "present", so the listing was declared incomplete, nothing
 *   was mirrored, and the old name stayed here next to the new one, cycle
 *   after cycle.
 * - A path store: the old name is really gone, so a dozen renames at once in
 *   a small vault looked like a broken listing and asked the person whether
 *   to delete them.
 *
 * A move is recognised by the provider's id (the listing carries the old
 * file's id under the new name) or — for stores without ids — by content: a
 * name the listing brings for the first time whose bytes here are exactly
 * what the missing name held at the last agreement. The old copy goes only
 * after the new one is here, and only when it carries no unsynced edits.
 */

async function sha(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("renames from another device arrive as moves", () => {
  let engine: any;
  let target: any;
  let stateRepo: any;
  let vault: any;
  let queue: any;
  let worker: SyncWorker;
  let states: Map<string, any>;
  /** Local files on this device. */
  let files: Map<string, string>;
  /** What the remote holds: path -> { content, id }. */
  let remote: Map<string, { content: string; id: string }>;
  let probes: RemoteProbe[];

  const known = Array.from({ length: 40 }, (_, i) => `notes/note-${i}.md`);
  const body = (i: number) => `# Note ${i}\n`;

  afterEach(() => { worker?.stop(); });

  async function build(opts: { ids: boolean }) {
    states = new Map();
    files = new Map();
    remote = new Map();
    for (const [i, p] of known.entries()) {
      states.set(p, { path: p, remote_etag: `etag-${i}`, base_sha256: await sha(body(i)), remote_id: opts.ids ? `id-${i}` : null, last_sync_ts: 1_000 });
      files.set(p, body(i));
      remote.set(p, { content: body(i), id: `id-${i}` });
    }
    probes = [];
    engine = { processQueue: vi.fn().mockResolvedValue(undefined) };
    target = {
      pull: vi.fn(async () => ({
        etagMap: new Map([...remote].map(([p, r]) => [p, `etag-${r.id.slice(3)}`])),
        ...(opts.ids ? { idMap: new Map([...remote].map(([p, r]) => [p, r.id])) } : {}),
      })),
      download: vi.fn(async (p: string) => (remote.has(p) ? new TextEncoder().encode(remote.get(p)!.content) : null)),
      push: vi.fn().mockResolvedValue(undefined),
      probeExists: vi.fn(async (probe: RemoteProbe): Promise<RemotePresence> => {
        probes.push(probe);
        if (probe.remoteId) return [...remote.values()].some((r) => r.id === probe.remoteId) ? "present" : "absent";
        return remote.has(probe.path) ? "present" : "absent";
      }),
    };
    stateRepo = {
      getAllStates: vi.fn(async () => new Map(states)),
      getSyncState: vi.fn(async (path: string) => states.get(path) ?? null),
      updateLocalHashAndBaseText: vi.fn().mockResolvedValue(undefined),
      updateLocalHashAndBaseTextGuarded: vi.fn().mockResolvedValue(undefined),
      updateLocalHash: vi.fn().mockResolvedValue(undefined),
      updateLocalHashGuarded: vi.fn().mockResolvedValue(undefined),
      updateRemoteState: vi.fn().mockResolvedValue(undefined),
      updateRemoteId: vi.fn().mockResolvedValue(undefined),
      updateBaseState: vi.fn().mockResolvedValue(undefined),
      updateBaseText: vi.fn().mockResolvedValue(undefined),
      clearPendingPushSha: vi.fn().mockResolvedValue(undefined),
      deleteSyncState: vi.fn(async (path: string) => void states.delete(path)),
      getBaseText: vi.fn().mockResolvedValue(null),
    };
    vault = {
      exists: vi.fn(async (p: string) => files.has(p)),
      readTextFile: vi.fn(async (p: string) => {
        if (!files.has(p)) throw new Error(`missing ${p}`);
        return files.get(p)!;
      }),
      writeTextFile: vi.fn(async (p: string, c: string) => void files.set(p, c)),
      deleteItem: vi.fn(async (p: string) => void files.delete(p)),
    };
    queue = {
      queueWrite: vi.fn().mockResolvedValue(undefined),
      resetStuckOperations: vi.fn().mockResolvedValue(undefined),
      hasPendingOperation: vi.fn().mockResolvedValue(false),
      hasPendingStructuralOp: vi.fn().mockResolvedValue(false),
      getPendingStructuralPaths: vi.fn().mockResolvedValue([]),
      getPendingDeletePaths: vi.fn().mockResolvedValue([]),
      getPendingDeleteOperations: vi.fn().mockResolvedValue([]),
      markDeletesJournaled: vi.fn().mockResolvedValue(undefined),
      discardPendingDeletes: vi.fn().mockResolvedValue([]),
    };
    addConflictFixture(stateRepo, vault);
    worker = new SyncWorker(engine, target, stateRepo, vault, queue, 100);
    worker["isRunning"] = true;
  }

  /** Another device renamed the first `n` notes: the remote holds them under new names. */
  function renameRemotely(n: number) {
    for (let i = 0; i < n; i++) {
      const from = known[i]!;
      const entry = remote.get(from)!;
      remote.delete(from);
      remote.set(`notes/renamed-${i}.md`, entry);
    }
  }

  function watch() {
    const asked = vi.fn();
    const incomplete = vi.fn();
    worker.onDeletionMirroringSuspended = asked;
    worker.onListingIncomplete = incomplete;
    return { asked, incomplete };
  }

  it("follows a Drive rename by its id instead of declaring the listing incomplete", async () => {
    await build({ ids: true });
    renameRemotely(3);
    const { asked, incomplete } = watch();

    await worker.runCycle();

    expect(incomplete).not.toHaveBeenCalled();
    expect(asked).not.toHaveBeenCalled();
    for (let i = 0; i < 3; i++) {
      expect(files.has(known[i]!), `old name ${i} still here`).toBe(false);
      expect(files.get(`notes/renamed-${i}.md`)).toBe(body(i));
    }
    expect(files.size).toBe(40);
    // Nobody asked the provider about the moved files: the listing said where they are.
    expect(probes).toEqual([]);
  });

  it("does not ask about a batch of renames on a store without ids", async () => {
    // 15 of 40 at once: the mass guard's own threshold (more than 10 and more
    // than a fifth). As deletions this asks the person; as moves it must not.
    await build({ ids: false });
    renameRemotely(15);
    const { asked, incomplete } = watch();

    await worker.runCycle();

    expect(asked).not.toHaveBeenCalled();
    expect(incomplete).not.toHaveBeenCalled();
    for (let i = 0; i < 15; i++) {
      expect(files.has(known[i]!)).toBe(false);
      expect(files.get(`notes/renamed-${i}.md`)).toBe(body(i));
    }
    expect(files.size).toBe(40);
    // A move by content is an inference: each old name was asked about once before it went.
    expect(probes.map((p) => p.path).sort()).toEqual(known.slice(0, 15).sort());
  });

  it("does not take a copy made elsewhere for a move while the provider still has the original", async () => {
    // Another device duplicated a note; this listing lost the original. The
    // bytes match, the name is new — and the old name is still there when
    // asked. That is a short listing, not a rename.
    await build({ ids: false });
    remote.set("notes/copy-0.md", { content: body(0), id: "id-copy" });
    const listed = target.pull.getMockImplementation();
    target.pull.mockImplementation(async () => {
      const res = await listed();
      res.etagMap.delete(known[0]!);
      return res;
    });
    const { asked, incomplete } = watch();

    await worker.runCycle();

    expect(files.get(known[0]!)).toBe(body(0));
    expect(files.get("notes/copy-0.md")).toBe(body(0));
    expect(vault.deleteItem).not.toHaveBeenCalled();
    expect(asked).not.toHaveBeenCalled();
    const info = incomplete.mock.calls[0]?.[0] as ListingIncompleteInfo | undefined;
    expect(info?.present).toBe(1);
  });

  it("keeps the old name when it carries edits this device has not synced", async () => {
    await build({ ids: true });
    renameRemotely(1);
    files.set(known[0]!, body(0) + "typed here\n");
    const { asked, incomplete } = watch();
    const reports: any[] = [];
    worker.onDeletionReport = (r) => reports.push(r);

    await worker.runCycle();

    expect(files.get(known[0]!)).toBe(body(0) + "typed here\n");
    expect(files.get("notes/renamed-0.md")).toBe(body(0));
    expect(asked).not.toHaveBeenCalled();
    expect(incomplete).not.toHaveBeenCalled();
    expect(reports.at(-1)?.keptLocalEdits).toEqual([known[0]]);
  });

  it("never removes the old name before the new one is here", async () => {
    await build({ ids: true });
    renameRemotely(1);
    const download = target.download.getMockImplementation();
    target.download.mockImplementation(async (p: string) => {
      if (p === "notes/renamed-0.md") throw new Error("HTTP 503");
      return download(p);
    });
    const { asked, incomplete } = watch();

    await worker.runCycle();

    expect(files.get(known[0]!)).toBe(body(0));
    expect(files.has("notes/renamed-0.md")).toBe(false);
    expect(asked).not.toHaveBeenCalled();
    expect(incomplete).not.toHaveBeenCalled();
  });

  it("does not take a missing file for moved because another KNOWN file has the same bytes", async () => {
    // A short listing of a vault full of identical notes (empty daily notes,
    // one template) must still read as a short listing: only a name the
    // listing brings for the first time can be where a file went.
    await build({ ids: false });
    for (const p of known) files.set(p, "same");
    for (const [p, s] of states) states.set(p, { ...s, base_sha256: await sha("same") });
    for (const p of known.slice(6)) remote.delete(p);
    const { asked } = watch();

    await worker.runCycle();

    // 34 of 40 missing, probes find them gone (a path store's answer): the guard asks.
    expect(asked).toHaveBeenCalledTimes(1);
    expect(vault.deleteItem).not.toHaveBeenCalled();
  });

  it("still reports an incomplete listing when the missing files are alive under their own names", async () => {
    await build({ ids: true });
    // The listing omits six files, the provider still has them — and one real
    // rename happens at the same time.
    renameRemotely(1);
    const listed = target.pull.getMockImplementation();
    target.pull.mockImplementation(async () => {
      const res = await listed();
      for (const p of known.slice(34)) {
        res.etagMap.delete(p);
        res.idMap.delete(p);
      }
      return res;
    });
    const { incomplete } = watch();

    await worker.runCycle();

    const info = incomplete.mock.calls[0]?.[0] as ListingIncompleteInfo | undefined;
    expect(info?.missing).toBe(6);
    for (const p of known.slice(34)) expect(files.has(p)).toBe(true);
    // The move is proven on its own (the id is listed under the new name) and follows regardless.
    expect(files.has(known[0]!)).toBe(false);
    expect(files.get("notes/renamed-0.md")).toBe(body(0));
  });
});
