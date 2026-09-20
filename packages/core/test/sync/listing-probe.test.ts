import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SyncWorker, pickProbeSample, syncErrorReason, type ListingIncompleteInfo, type ListingReport } from "../../src/sync/SyncWorker.js";
import { SyncRootMissingError } from "../../src/sync/errorKind.js";
import { DeletionJournal } from "../../src/sync/deletionJournal.js";
import { OwnDeletionRegister } from "../../src/sync/ownDeletions.js";
import type { RemotePresence, RemoteProbe } from "../../src/sync/ISyncTarget.js";
import { addConflictFixture } from "../helpers/conflictFixture.js";

/**
 * The incident of 2026-09-20, from start to finish.
 *
 * After a new sign-in the first full Drive listing came back with HTTP 200 and
 * 168 of 1142 known files. The worker asked "delete the other 974 here too?",
 * the maintainer said yes to try it, some 900 local files went to the trash —
 * and because the shell could not tell the worker's deletions from the user's,
 * they came back as 898 queued REMOTE deletions and a second danger dialog. Both
 * confirmations were written to the synced deletion journal at the click.
 *
 * Every test below is one link of that chain, broken.
 */

async function sha(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function journalFor(deviceId: string, now: () => number = () => 5_000) {
  const files = new Map<string, string>();
  const journalVault = {
    exists: async (p: string) => files.has(p),
    readTextFile: async (p: string) => files.get(p) ?? "",
    writeTextFile: async (p: string, c: string) => void files.set(p, c),
  };
  return new DeletionJournal(journalVault as any, deviceId, { now });
}

describe("a listing is a claim, not a fact (finding 2026-09-20)", () => {
  let engine: any;
  let target: any;
  let stateRepo: any;
  let vault: any;
  let queue: any;
  let worker: SyncWorker;
  let states: Map<string, any>;
  /** What the remote REALLY holds — the listing may say less. */
  let remoteAlive: Set<string>;
  let probes: RemoteProbe[];

  const known = Array.from({ length: 40 }, (_, i) => `notes/note-${i}.md`);

  afterEach(() => { worker?.stop(); });

  function build(options: ConstructorParameters<typeof SyncWorker>[6] = {}) {
    worker = new SyncWorker(engine, target, stateRepo, vault, queue, 100, options);
    worker["isRunning"] = true;
  }

  beforeEach(async () => {
    const baseSha = await sha("same");
    states = new Map(known.map((p, i) => [p, { path: p, remote_etag: "etag-old", base_sha256: baseSha, remote_id: `id-${i}`, last_sync_ts: 1_000 }]));
    remoteAlive = new Set(known);
    probes = [];
    engine = { processQueue: vi.fn().mockResolvedValue(undefined) };
    target = {
      pull: vi.fn(),
      download: vi.fn().mockResolvedValue(new TextEncoder().encode("same")),
      push: vi.fn().mockResolvedValue(undefined),
      probeExists: vi.fn(async (probe: RemoteProbe): Promise<RemotePresence> => {
        probes.push(probe);
        return remoteAlive.has(probe.path) ? "present" : "absent";
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
      exists: vi.fn().mockResolvedValue(true),
      readTextFile: vi.fn().mockResolvedValue("same"),
      writeTextFile: vi.fn().mockResolvedValue(undefined),
      deleteItem: vi.fn().mockResolvedValue(undefined),
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
  });

  /** The listing carries only the first `n` files. */
  function listOnly(n: number) {
    target.pull.mockResolvedValue({ etagMap: new Map(known.slice(0, n).map((p) => [p, "etag-old"])) });
  }

  /** The answer triggers a cycle of its own; the tests run theirs by hand, in a known order. */
  function approveWithoutAutoCycle() {
    worker["isRunning"] = false;
    worker.approveSuspendedDeletions();
    worker["isRunning"] = true;
  }

  it("asks nobody and deletes nothing when the missing files exist", async () => {
    build();
    listOnly(6);
    const asked = vi.fn();
    const incomplete = vi.fn();
    const status = vi.fn();
    worker.onDeletionMirroringSuspended = asked;
    worker.onListingIncomplete = incomplete;
    worker.onStatusChange = status;

    await worker.runCycle();

    expect(vault.deleteItem).not.toHaveBeenCalled();
    expect(asked).not.toHaveBeenCalled();
    const info = incomplete.mock.calls[0][0] as ListingIncompleteInfo;
    expect(info).toMatchObject({ missing: 34, confirmed: 40, probed: 20, present: 20, empty: false });
    expect(status.mock.calls.at(-1)?.[0]).toBe("error");
    expect(status.mock.calls.at(-1)?.[1]).toContain("incomplete");
    // Asked by the id this device recorded, never by a search.
    expect(probes.every((p) => typeof p.remoteId === "string" && p.remoteId.startsWith("id-"))).toBe(true);
  });

  it("adopts no cursor from a listing its own files contradict, and lowers the flag once a listing holds", async () => {
    target.getStartCursor = vi.fn().mockResolvedValue("c1");
    build();
    listOnly(6);
    const incomplete = vi.fn();
    const trusted = vi.fn();
    worker.onListingIncomplete = incomplete;
    worker.onFullListingTrusted = trusted;

    await worker.runCycle();
    expect(worker["cursor"]).toBeUndefined();
    expect(trusted).not.toHaveBeenCalled();

    listOnly(40);
    await worker.runCycle();
    expect(incomplete.mock.calls.at(-1)?.[0]).toBeNull();
    expect(worker["cursor"]).toBe("c1");
    expect(trusted).toHaveBeenCalledTimes(1);
  });

  it("asks — with the probe result — when the missing files really are gone", async () => {
    build();
    listOnly(6);
    remoteAlive = new Set(known.slice(0, 6));
    const asked = vi.fn();
    worker.onDeletionMirroringSuspended = asked;

    await worker.runCycle();

    expect(vault.deleteItem).not.toHaveBeenCalled();
    expect(asked).toHaveBeenCalledWith({ missing: 34, confirmed: 40, probed: 20, absent: 20 });
  });

  it("carries out exactly what the question showed, journals it AFTER the act, and never at the click", async () => {
    const journal = journalFor("device-a");
    build({ deletionJournal: journal });
    // The question is about twenty files.
    listOnly(20);
    remoteAlive = new Set(known.slice(0, 20));
    const asked = vi.fn();
    worker.onDeletionMirroringSuspended = asked;
    await worker.runCycle();
    expect(asked).toHaveBeenCalledWith({ missing: 20, confirmed: 40, probed: 20, absent: 20 });

    approveWithoutAutoCycle();
    // The click alone writes nothing (it used to write every path at once).
    await Promise.resolve();
    expect(journal.list()).toHaveLength(0);

    // By the next listing FOURTEEN more are missing. The yes covered twenty.
    listOnly(6);
    remoteAlive = new Set(known.slice(0, 6));
    await worker.runCycle();

    const deleted = vault.deleteItem.mock.calls.map((c: any[]) => c[0]);
    expect(deleted.sort()).toEqual(known.slice(20).sort());
    expect(asked).toHaveBeenLastCalledWith({ missing: 14, confirmed: 40, probed: 20, absent: 20 });
    expect(journal.activePathEntries().map((e) => e.path).sort()).toEqual(known.slice(20).sort());
  });

  it("stops on the spot when a file turns out to be alive halfway through an approved deletion", async () => {
    const journal = journalFor("device-a");
    build({ deletionJournal: journal });
    listOnly(6);
    remoteAlive = new Set(known.slice(0, 6));
    worker.onDeletionMirroringSuspended = vi.fn();
    await worker.runCycle();
    approveWithoutAutoCycle();

    // Between the question and the act the remote turns out to hold one after all.
    const survivor = known[20];
    remoteAlive.add(survivor);
    const incomplete = vi.fn();
    worker.onListingIncomplete = incomplete;
    await worker.runCycle();

    expect(vault.deleteItem).not.toHaveBeenCalledWith(survivor);
    expect(incomplete).toHaveBeenCalled();
    expect((incomplete.mock.calls[0][0] as ListingIncompleteInfo).present).toBeGreaterThan(0);
  });

  it("verifies a small deletion per file, too — the guard's thresholds are not the safeguard", async () => {
    build();
    listOnly(37); // three missing: far below MASS_DELETE_MIN
    remoteAlive = new Set([...known.slice(0, 37), known[38]]);
    const incomplete = vi.fn();
    worker.onListingIncomplete = incomplete;

    await worker.runCycle();

    // One of the three is alive: the listing is wrong, none of them goes.
    expect(vault.deleteItem).not.toHaveBeenCalled();
    expect(incomplete).toHaveBeenCalled();
  });

  it("mirrors a small, real deletion without asking", async () => {
    build();
    listOnly(37);
    remoteAlive = new Set(known.slice(0, 37));

    await worker.runCycle();

    expect(vault.deleteItem.mock.calls.map((c: any[]) => c[0]).sort()).toEqual(known.slice(37).sort());
  });

  it("does not let a journal alone delete a large share: uncorroborated entries are asked about", async () => {
    // The journal of 2026-09-20: entries for files that are alive. On a device
    // whose rows carry no id an id-based provider can only answer "unknown".
    const journal = journalFor("device-b");
    await journal.recordPaths(known.slice(6));
    for (const s of states.values()) s.remote_id = null;
    target.probeExists = vi.fn(async (): Promise<RemotePresence> => "unknown");
    build({ deletionJournal: journal });
    listOnly(6);
    const asked = vi.fn();
    worker.onDeletionMirroringSuspended = asked;

    await worker.runCycle();

    expect(vault.deleteItem).not.toHaveBeenCalled();
    expect(asked).toHaveBeenCalledWith({ missing: 34, confirmed: 40, probed: 20, absent: 0 });
  });

  it("still mirrors what the journal explains once a probe found a file definitely gone", async () => {
    const journal = journalFor("device-b", () => 9_000);
    await journal.recordPaths(known.slice(6));
    build({ deletionJournal: journal });
    listOnly(6);
    remoteAlive = new Set(known.slice(0, 6));
    const asked = vi.fn();
    worker.onDeletionMirroringSuspended = asked;

    await worker.runCycle();

    expect(asked).not.toHaveBeenCalled();
    expect(vault.deleteItem).toHaveBeenCalledTimes(34);
  });

  it("takes a journal entry back when the remote lists the file (after the grace period)", async () => {
    const day = 24 * 60 * 60 * 1000;
    let clock = 1_000_000;
    const journal = journalFor("device-a", () => clock);
    await journal.recordPaths([known[1], known[2]]);
    build({ deletionJournal: journal });
    listOnly(40);

    // Fresh entries are left alone: the deleting device journals BEFORE its DELETE runs.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(clock + 60_000);
      await worker.runCycle();
      expect(journal.activePathEntries()).toHaveLength(2);

      clock += 2 * day;
      vi.setSystemTime(clock);
      await worker.runCycle();
      expect(journal.activePathEntries()).toHaveLength(0);
      expect(journal.explainsPath(known[1])).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks its own deletions so the shell does not send them back up as the user's", async () => {
    const own = new OwnDeletionRegister();
    build({ ownDeletions: own });
    listOnly(37);
    remoteAlive = new Set(known.slice(0, 37));

    await worker.runCycle();

    // What a shell's onLocalFileDeleted does: ask once, then queue nothing.
    expect(own.consume(known[38])).toBe(true);
    expect(own.consume(known[38])).toBe(false);
    expect(own.consume(known[0])).toBe(false);
  });

  it("records provider ids from the listing for rows that have none", async () => {
    for (const s of states.values()) s.remote_id = null;
    build();
    target.pull.mockResolvedValue({
      etagMap: new Map(known.map((p) => [p, "etag-old"])),
      idMap: new Map(known.map((p, i) => [p, `drive-${i}`])),
    });

    await worker.runCycle();
    expect(stateRepo.updateRemoteId).toHaveBeenCalledTimes(40);
    expect(stateRepo.updateRemoteId).toHaveBeenCalledWith(known[3], "drive-3");

    // The snapshot now carries the ids: a second listing writes nothing.
    for (const [i, p] of known.entries()) states.get(p).remote_id = `drive-${i}`;
    stateRepo.updateRemoteId.mockClear();
    await worker.runCycle();
    expect(stateRepo.updateRemoteId).not.toHaveBeenCalled();
  });

  it("leaves numbers behind, never a name", async () => {
    build();
    listOnly(6);
    const reports: ListingReport[] = [];
    worker.onListingMetrics = (r) => reports.push(r);

    await worker.runCycle();

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ files: 6, known: 40, missing: 34, firstOfSession: true });
    expect(reports[0].worstFolders).toEqual([{ key: expect.stringMatching(/^[0-9a-f]{6}$/), missing: 34 }]);
    expect(JSON.stringify(reports[0])).not.toContain("note-");
    expect(JSON.stringify(reports[0])).not.toContain("notes");
  });

  it("treats an empty listing like any other once the target can be asked", async () => {
    build();
    target.pull.mockResolvedValue({ etagMap: new Map() });
    const incomplete = vi.fn();
    worker.onListingIncomplete = incomplete;

    await worker.runCycle();
    expect(vault.deleteItem).not.toHaveBeenCalled();
    expect((incomplete.mock.calls[0][0] as ListingIncompleteInfo).empty).toBe(true);

    // Really empty: a question, never a silent mass delete — however few files there are.
    remoteAlive = new Set();
    const asked = vi.fn();
    worker.onDeletionMirroringSuspended = asked;
    await worker.runCycle();
    expect(vault.deleteItem).not.toHaveBeenCalled();
    expect(asked).toHaveBeenCalledWith({ missing: 40, confirmed: 40, probed: 20, absent: 20 });
  });

  it("checks the journal on request and takes back what is alive", async () => {
    const journal = journalFor("device-a");
    await journal.recordPaths([known[1], known[2], "gone/really.md"]);
    build({ deletionJournal: journal });
    const progress = vi.fn();

    const result = await worker.verifyDeletionJournal(progress);

    expect(result).toEqual({ checked: 3, retracted: 2, absent: 1, unknown: 0 });
    expect(journal.activePathEntries().map((e) => e.path)).toEqual(["gone/really.md"]);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });

  it("names a missing root as its own reason", () => {
    expect(syncErrorReason(new SyncRootMissingError("Plainva", "Google Drive"))).toBe("root-missing");
  });
});

describe("pickProbeSample", () => {
  const item = (path: string, id: string | null) => ({ path, state: { remote_id: id } });

  it("asks about everything when there is little to ask", () => {
    const few = [item("a", null), item("b", "1")];
    expect(pickProbeSample(few, 20)).toHaveLength(2);
  });

  it("prefers files with a recorded id — the only definitive answer of an id-based provider", () => {
    const many = [
      ...Array.from({ length: 30 }, (_, i) => item(`legacy-${i}`, null)),
      ...Array.from({ length: 5 }, (_, i) => item(`known-${i}`, `id-${i}`)),
    ];
    const sample = pickProbeSample(many, 10, () => 0.5);
    expect(sample).toHaveLength(10);
    expect(sample.filter((s) => s.state.remote_id).length).toBe(5);
  });
});
