import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The gate on note CREATION, and the single-flight around it.
 *
 * Everything here is built around what the reconciler is ALLOWED to do, not
 * what it does — the reconcile itself is pinned by taskSync.test.ts. The one
 * thing that can only go wrong out here is letting an import run while the
 * vault is still filling up, which produces exactly the duplicate the anchor
 * exists to prevent.
 */

const runTaskSyncCalls: Array<{
  mayCreateNotes: boolean;
  taskDbPath: string;
  noteType: string;
  pendingDeletions: unknown[];
  deletionsInFlight: unknown[];
  generatedBy?: string;
}> = [];
let resolveRun: (() => void) | null = null;

vi.mock("@plainva/ui", () => ({
  runTaskSync: (opts: {
    mayCreateNotes: boolean;
    taskDbPath: string;
    noteType: string;
    pendingDeletions: unknown[];
    deletionsInFlight: unknown[];
    generatedBy?: string;
  }) => {
    runTaskSyncCalls.push({
      mayCreateNotes: opts.mayCreateNotes,
      taskDbPath: opts.taskDbPath,
      noteType: opts.noteType,
      pendingDeletions: opts.pendingDeletions,
      deletionsInFlight: opts.deletionsInFlight,
      generatedBy: opts.generatedBy,
    });
    return new Promise((res) => {
      const done = () => res({ createdNotes: [], changedNotes: [], errors: [] });
      if (resolveRun === null) done();
      else resolveRun = done;
    });
  },
  pendingTaskDeletions: () => [{ uid: "armed" }],
  taskDeletionsInFlight: () => [{ uid: "waiting" }],
  resolveTaskDeletion: () => {},
  initTaskDeletion: () => {},
  cancelInFlightTaskDeletion: () => {},
  // OKF 0.2 provenance (plan P3b): the runtime asks the shared helper for the
  // producer name; the real helper reads the app version from PlatformServices.
  plainvaProducer: async (component: string) => `plainva-${component}/test`,
}));

let settings = { taskDatabase: "Aufgaben.base", defaultNoteType: "Task" };
vi.mock("./services/mobileSettings", () => ({
  getMobileSettings: () => settings,
}));

let syncSettled = true;
vi.mock("./services/syncService", () => ({
  firstSyncSettled: () => syncSettled,
  currentDeletionJournal: () => null,
}));

import { startTaskSyncRuntime, runMobileTaskSync, __resetTaskSyncRuntimeForTest } from "./services/pim/taskSyncRuntime";
import type { MobileVault } from "./services/vaultService";

let indexDone = true;
const reindexed: string[][] = [];

function fakeVault(): MobileVault {
  return {
    files: {
      readTextFile: async () => "",
      writeTextFile: async () => {},
      exists: async () => true,
      createDir: async () => {},
    },
    queryService: {
      listNotes: async () => [{ path: "Aufgaben/A.md" }],
      getTaskAnchors: async () => new Map(),
    },
    indexSettled: () => indexDone,
    reindexPaths: async (paths: string[]) => {
      reindexed.push(paths);
    },
  } as unknown as MobileVault;
}

describe("mobile task sync runtime", () => {
  beforeEach(() => {
    runTaskSyncCalls.length = 0;
    reindexed.length = 0;
    resolveRun = null;
    settings = { taskDatabase: "Aufgaben.base", defaultNoteType: "Task" };
    syncSettled = true;
    indexDone = true;
    __resetTaskSyncRuntimeForTest();
  });

  it("may create notes once the first sync AND the index have settled", async () => {
    startTaskSyncRuntime({ vault: fakeVault(), cache: {} as never, buildTarget: async () => null });
    await runMobileTaskSync();
    expect(runTaskSyncCalls).toHaveLength(1);
    expect(runTaskSyncCalls[0].mayCreateNotes).toBe(true);
    expect(runTaskSyncCalls[0].taskDbPath).toBe("Aufgaben.base");
    expect(runTaskSyncCalls[0].noteType).toBe("Task");
    // The phone stamps created notes with the same producer form as the desktop
    // (`plainva-task-sync/<version>`) — one actor name for both shells.
    expect(runTaskSyncCalls[0].generatedBy).toBe("plainva-task-sync/test");
  });

  it("does NOT create notes while the vault is still pulling", async () => {
    syncSettled = false;
    startTaskSyncRuntime({ vault: fakeVault(), cache: {} as never, buildTarget: async () => null });
    await runMobileTaskSync();
    // It still RUNS — pushing local edits is safe and wanted; only importing is
    // held back, because a note that has not arrived yet is not a missing task.
    expect(runTaskSyncCalls).toHaveLength(1);
    expect(runTaskSyncCalls[0].mayCreateNotes).toBe(false);
  });

  it("does NOT create notes while the index pass is still running", async () => {
    indexDone = false;
    startTaskSyncRuntime({ vault: fakeVault(), cache: {} as never, buildTarget: async () => null });
    await runMobileTaskSync();
    expect(runTaskSyncCalls[0].mayCreateNotes).toBe(false);
  });

  it("tells the reconciler about deletions that are still WAITING", async () => {
    // The trap the desktop already stepped in: a cycle inside the undo window
    // sees a state row whose note is gone and writes "never import this again".
    // Undo then hands the note back as an orphan — present in the vault,
    // ignored by every later cycle. Passing the in-flight list is what stops
    // that, and dropping it fails nowhere visibly.
    startTaskSyncRuntime({ vault: fakeVault(), cache: {} as never, buildTarget: async () => null });
    await runMobileTaskSync();
    expect(runTaskSyncCalls[0].deletionsInFlight).toEqual([{ uid: "waiting" }]);
    expect(runTaskSyncCalls[0].pendingDeletions).toEqual([{ uid: "armed" }]);
  });

  it("does nothing without a task database", async () => {
    settings = { taskDatabase: "  ", defaultNoteType: "Task" };
    startTaskSyncRuntime({ vault: fakeVault(), cache: {} as never, buildTarget: async () => null });
    await runMobileTaskSync();
    expect(runTaskSyncCalls).toEqual([]);
  });

  it("queues exactly one follow-up instead of stacking runs", async () => {
    startTaskSyncRuntime({ vault: fakeVault(), cache: {} as never, buildTarget: async () => null });
    resolveRun = () => {}; // hold the first run open
    const first = runMobileTaskSync();
    await Promise.resolve();
    // Three cycles end while the first reconcile is still in flight.
    void runMobileTaskSync();
    void runMobileTaskSync();
    void runMobileTaskSync();
    const done = resolveRun!;
    resolveRun = null;
    done();
    await first;
    await new Promise((r) => setTimeout(r, 0));
    // One run, one follow-up — not four.
    expect(runTaskSyncCalls).toHaveLength(2);
  });
});
