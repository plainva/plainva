// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * A quiet reconcile announces nothing (F21). The phone runs it at the end of
 * every provider cycle, and each "m-task-sync-done" reloads the task screen,
 * the calendar's due tasks, the account page and the widgets - every two
 * minutes, with nothing new. What is news is pinned by taskSyncNews.test.ts
 * in @plainva/ui; this pins that the runtime asks it, on every way out.
 */

let result = { createdNotes: [] as string[], changedNotes: [] as string[], adoptedNotes: [] as string[], deletedNotes: [] as string[], duplicateAnchors: 0, deferredCreates: 0, pushed: 0, conflicts: 0, deletedRemote: 0, errors: [] as string[], notApplied: 0 };

vi.mock("@plainva/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plainva/ui")>();
  return {
    ...actual,
    runTaskSync: async () => result,
    reportTaskListsBlocked: async () => {},
    plainvaProducer: async (component: string) => `plainva-${component}/test`,
    logDiagnostic: () => {},
  };
});

let settings = { taskDatabase: "Aufgaben.base", defaultNoteType: "Task" };
vi.mock("./services/mobileSettings", () => ({ getMobileSettings: () => settings }));
vi.mock("./services/syncService", () => ({ firstSyncSettled: () => true, currentDeletionJournal: () => null }));
vi.mock("./services/templateVault", () => ({ phoneTemplateVault: async () => undefined }));

import { startTaskSyncRuntime, runMobileTaskSync, markPimDataChanged, __resetTaskSyncRuntimeForTest } from "./services/pim/taskSyncRuntime";
import type { MobileVault } from "./services/vaultService";

const vault = (withIndex = true) =>
  ({
    files: { readTextFile: async () => "", writeTextFile: async () => {}, exists: async () => true, createDir: async () => {} },
    queryService: withIndex ? { listNotes: async () => [], getTaskAnchors: async () => new Map() } : null,
    indexSettled: () => true,
    reindexPaths: async () => {},
    vaultId: "v1",
  }) as unknown as MobileVault;

describe("mobile task sync runtime: a quiet reconcile announces nothing (F21)", () => {
  let done: number;
  beforeEach(() => {
    __resetTaskSyncRuntimeForTest();
    settings = { taskDatabase: "Aufgaben.base", defaultNoteType: "Task" };
    result = { ...result, changedNotes: [] };
    done = 0;
    window.addEventListener("m-task-sync-done", count);
  });
  afterEach(() => window.removeEventListener("m-task-sync-done", count));
  const count = () => done++;

  const cache = () => ({ listSyncProblems: async () => [] }) as never;

  it("announces the first run and a run with news, not the quiet ones", async () => {
    const c = cache();
    startTaskSyncRuntime({ vault: vault(), cache: c, buildTarget: async () => null });
    await runMobileTaskSync();
    await runMobileTaskSync();
    await runMobileTaskSync();
    expect(done).toBe(1);
    result = { ...result, changedNotes: ["Aufgaben/A.md"] };
    await runMobileTaskSync();
    expect(done).toBe(2);
    result = { ...result, changedNotes: [] };
    markPimDataChanged(c);
    await runMobileTaskSync();
    expect(done).toBe(3);
    await runMobileTaskSync();
    expect(done).toBe(3);
  });

  it("without a task database or an index, too", async () => {
    settings = { taskDatabase: "", defaultNoteType: "Task" };
    startTaskSyncRuntime({ vault: vault(), cache: cache(), buildTarget: async () => null });
    await runMobileTaskSync();
    await runMobileTaskSync();
    expect(done).toBe(1);
    settings = { taskDatabase: "Aufgaben.base", defaultNoteType: "Task" };
    startTaskSyncRuntime({ vault: vault(false), cache: cache(), buildTarget: async () => null });
    await runMobileTaskSync();
    await runMobileTaskSync();
    expect(done).toBe(2);
  });
});
