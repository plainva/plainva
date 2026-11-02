import { describe, expect, it, vi } from "vitest";
import type { MobileVault } from "../vaultService";

/**
 * An entry put in the calendar follows its appointment on the phone too
 * (open-items plan 3.87 no. 16). Both shells could put an entry into a
 * calendar; only the desktop let it follow - on the phone nobody called the
 * reconcile, so an entry kept only from the phone kept its old date.
 *
 * The reconcile itself is shared and tested with the desktop's suite
 * (`runEntryEventSync`, apps/desktop/src/services/pim/entryEventSync.test.ts);
 * this pins the phone's wiring: the end of every PIM cycle runs it, through
 * the vault's sync chain, and what it changed is indexed again.
 */

const { runEntryEventSync, captured } = vi.hoisted(() => ({
  runEntryEventSync: vi.fn(async () => ({ changedNotes: ["Projects/Release.md"], errors: [] as string[] })),
  captured: { onStatusChange: null as null | ((status: string) => void) },
}));

vi.mock("@plainva/ui", () => ({
  runEntryEventSync,
  entryEventWindow: () => ({ startDay: "2026-09-01", endDay: "2027-12-01" }),
  runTaskSync: vi.fn(),
  pendingTaskDeletions: () => [],
  taskDeletionsInFlight: () => [],
  resolveTaskDeletion: vi.fn(),
  initTaskDeletion: vi.fn(),
  cancelInFlightTaskDeletion: vi.fn(),
  plainvaProducer: async () => "test",
  afterTaskSyncResume: vi.fn(),
  formatTaskSync: () => "",
  logDiagnostic: vi.fn(),
}));
vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })) } }));
vi.mock("../mobileSettings", () => ({ getMobileSettings: () => ({ taskDatabase: "" }) }));
vi.mock("../newNote", () => ({ configuredNoteType: () => "Note" }));
vi.mock("../templateVault", () => ({ phoneTemplateVault: async () => null }));
vi.mock("../syncService", () => ({ currentDeletionJournal: () => null, firstSyncSettled: () => true }));
vi.mock("../reminderScheduler", () => ({ rescheduleReminders: vi.fn() }));
vi.mock("@plainva/core", () => {
  class FakeCache {
    listAccounts = async () => [];
    setScopeState = async () => {};
  }
  class FakeWorker {
    constructor(opts: { onStatusChange: (status: string) => void }) {
      captured.onStatusChange = opts.onStatusChange;
    }
    start() {}
    stop() {}
    triggerImmediate() { return Promise.resolve(); }
  }
  return { PimCacheRepository: FakeCache, PimWorker: FakeWorker, updateVaultText: vi.fn() };
});

describe("the phone lets an entry follow its appointment (3.87 no. 16)", () => {
  it("runs the shared reconcile at the end of every PIM cycle, through the sync chain", async () => {
    const reindexPaths = vi.fn(async () => undefined);
    const files = { readTextFile: vi.fn() };
    const db = { query: vi.fn(async () => []) };
    const vault = { vaultId: "v1", db, files, reindexPaths } as unknown as MobileVault;
    const pim = await import("./pimRuntime");
    await pim.startPimRuntime(vault, {
      buildTarget: async () => null,
      accountAuthRevision: async () => undefined,
      parkedMessage: "sign-in required",
      onCycle: () => {},
    });

    captured.onStatusChange!("syncing");
    expect(runEntryEventSync).not.toHaveBeenCalled();

    captured.onStatusChange!("idle");
    await vi.waitFor(() => expect(reindexPaths).toHaveBeenCalledWith(["Projects/Release.md"]));
    expect(runEntryEventSync).toHaveBeenCalledTimes(1);
    const deps = (runEntryEventSync.mock.calls[0] as unknown[])[0] as { adapter: unknown; db: unknown; window: unknown };
    expect(deps.adapter).toBe(files);
    expect(deps.db).toBe(db);
    expect(deps.window).toEqual({ startDay: "2026-09-01", endDay: "2027-12-01" });
  });
});
