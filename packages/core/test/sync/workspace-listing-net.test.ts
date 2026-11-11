import { describe, expect, it, vi } from "vitest";
import { SyncWorker } from "../../src/sync/SyncWorker.js";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import { byteExactDav } from "../helpers/byteExactDav.js";

/**
 * The folder's own listing is the probe (R8, third review): a plain vault pays
 * nothing for the rule that keeps it from writing next to an encrypted
 * workspace. Its worker makes no request it did not make before the rule - not
 * at start, not per cycle, not to `.pvws` - and a server that refuses hidden
 * paths (nginx/Apache `deny` on `/\.`) cannot stop it. A genesis that shows up
 * in a listing stops the worker before its next write, the deletion journal
 * included.
 */
function plainWorld(opts: { denyDot?: boolean } = {}) {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const dav = byteExactDav();
  dav.files.set("note.md", { bytes: new TextEncoder().encode("hello"), etag: "e1" });
  const log: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = decodeURIComponent(new URL(url).pathname);
    log.push(`${(init?.method ?? "GET").toUpperCase()} ${path}`);
    // A hardened server: every hidden path refused.
    if (opts.denyDot && /\/\.(?!$)/.test(path.replace(new URL(dav.url).pathname, "/"))) return new Response("", { status: 403 });
    return dav.fetch(input, init);
  };
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, fetch);
  const engine = { processQueue: vi.fn().mockResolvedValue(undefined) };
  const stateRepo = {
    getAllStates: vi.fn().mockResolvedValue(new Map([["note.md", { path: "note.md", remote_etag: '"e1"', local_sha256: "x", base_sha256: "x", last_sync_ts: 1 }]])),
    getSyncState: vi.fn().mockResolvedValue(null),
    recordSyncedBase: vi.fn(), updateLocalHash: vi.fn(), updateLocalHashGuarded: vi.fn(), updateRemoteState: vi.fn(), recordPulledVersion: vi.fn(),
    clearPendingPushSha: vi.fn(), deleteSyncState: vi.fn(), getBaseText: vi.fn().mockResolvedValue(null),
  };
  const vault = { exists: vi.fn().mockResolvedValue(true), readTextFile: vi.fn().mockResolvedValue("hello"), readBinaryFile: vi.fn().mockResolvedValue(new TextEncoder().encode("hello")), writeTextFile: vi.fn(), deleteItem: vi.fn() };
  const queue = {
    queueWrite: vi.fn(), resetStuckOperations: vi.fn(), hasPendingOperation: vi.fn().mockResolvedValue(false), hasPendingStructuralOp: vi.fn().mockResolvedValue(false),
    getPendingStructuralPaths: vi.fn().mockResolvedValue([]), getPendingDeletePaths: vi.fn().mockResolvedValue([]), getPendingDeleteOperations: vi.fn().mockResolvedValue([]),
    markDeletesJournaled: vi.fn(), discardPendingDeletes: vi.fn().mockResolvedValue([]),
  };
  const journal = { sync: vi.fn().mockResolvedValue(undefined), load: vi.fn(), activePathEntries: () => [], recordPathEntries: vi.fn(), explainsPath: () => null, retractPaths: vi.fn().mockResolvedValue([]), recordPaths: vi.fn() };
  const reasons: Array<string | undefined> = [];
  const worker = new SyncWorker(engine as never, target, stateRepo as never, vault as never, queue as never, 60_000, { deletionJournal: journal as never });
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  worker.onStatusChange = (_s, _m, reason) => reasons.push(reason);
  return { dav, log, worker, engine, journal, reasons };
}

describe("a plain vault and the encrypted-workspace rule (R8)", () => {
  it("makes no request to .pvws in any cycle, and an idle cycle makes only its listing's requests", async () => {
    const w = plainWorld();
    await w.worker.runCycle();
    const first = w.log.splice(0);
    await w.worker.runCycle();
    const second = w.log.splice(0);
    expect([...first, ...second].some((line) => line.toLowerCase().includes(".pvws"))).toBe(false);
    // What a cycle asked before the rule existed: the PROPFIND walk of the listing, nothing more.
    const listing = (lines: string[]) => lines.filter((line) => line.startsWith("PROPFIND"));
    expect(listing(second)).toEqual(listing(first));
    expect(second.filter((line) => !line.startsWith("PROPFIND") && !line.startsWith("GET"))).toEqual([]);
    expect(w.engine.processQueue).toHaveBeenCalledTimes(2);
  });

  it("syncs as always on a server that refuses every hidden path", async () => {
    const w = plainWorld({ denyDot: true });
    await w.worker.runCycle();
    await w.worker.runCycle();
    expect(w.engine.processQueue).toHaveBeenCalledTimes(2);
    expect(w.reasons).not.toContain("encrypted-workspace");
    expect(w.log.some((line) => line.toLowerCase().includes(".pvws"))).toBe(false);
  });

  it("a genesis that appears mid-session stops the worker before its next write, the journal included", async () => {
    const w = plainWorld();
    await w.worker.runCycle();
    expect(w.journal.sync).toHaveBeenCalledTimes(1);
    w.dav.folders.add(".pvws");
    w.dav.files.set(".pvws/genesis.pvgen", { bytes: new Uint8Array([1, 2, 3]), etag: "g1" });
    await w.worker.runCycle();
    expect(w.journal.sync).toHaveBeenCalledTimes(1);
    expect(w.engine.processQueue).toHaveBeenCalledTimes(1);
    expect(w.reasons).toContain("encrypted-workspace");
    // Halted: no further cycle, no settings push.
    await w.worker.runCycle();
    await w.worker.pushSettingsNow();
    expect(w.engine.processQueue).toHaveBeenCalledTimes(1);
  });
});
