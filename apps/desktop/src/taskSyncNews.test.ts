import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PimCacheRepository, PimSyncProblem } from "@plainva/core";
import { markTaskSyncInputChanged, taskSyncHasNews } from "@plainva/ui";
import type { TaskSyncResult } from "@plainva/ui";

/**
 * "Task sync done" only when it is news (F21): the reconcile runs at the end
 * of every provider cycle, and every announcement reloads the task views, the
 * calendar's due tasks, the account page and the phone's widgets.
 */

function fakeCache(problems: () => PimSyncProblem[]): PimCacheRepository {
  return { listSyncProblems: async () => problems() } as unknown as PimCacheRepository;
}

const quiet = (): TaskSyncResult => ({
  createdNotes: [],
  changedNotes: [],
  adoptedNotes: [],
  duplicateAnchors: 0,
  deferredCreates: 0,
  pushed: 0,
  conflicts: 0,
  deletedRemote: 0,
  deletedNotes: [],
  errors: [],
  notApplied: 0,
});

const problem: PimSyncProblem = { accountId: "a1", accountLabel: "Work", provider: "caldav", since: 1, error: "503", signIn: false };

describe("taskSyncHasNews (F21)", () => {
  it("the first run is news, a quiet run after it is not", async () => {
    const cache = fakeCache(() => []);
    expect(await taskSyncHasNews(cache, quiet())).toBe(true);
    expect(await taskSyncHasNews(cache, quiet())).toBe(false);
    expect(await taskSyncHasNews(cache, null)).toBe(false);
  });

  it("a run that did something is news", async () => {
    const cache = fakeCache(() => []);
    await taskSyncHasNews(cache, quiet());
    expect(await taskSyncHasNews(cache, { ...quiet(), changedNotes: ["Tasks/A.md"] })).toBe(true);
    expect(await taskSyncHasNews(cache, { ...quiet(), pushed: 1 })).toBe(true);
    expect(await taskSyncHasNews(cache, quiet())).toBe(false);
  });

  it("a provider cycle that changed data makes the next run news, once", async () => {
    const cache = fakeCache(() => []);
    await taskSyncHasNews(cache, quiet());
    markTaskSyncInputChanged(cache);
    expect(await taskSyncHasNews(cache, quiet())).toBe(true);
    expect(await taskSyncHasNews(cache, quiet())).toBe(false);
  });

  it("a sync problem that comes or goes is news", async () => {
    let problems: PimSyncProblem[] = [];
    const cache = fakeCache(() => problems);
    await taskSyncHasNews(cache, quiet());
    problems = [problem];
    expect(await taskSyncHasNews(cache, quiet())).toBe(true);
    expect(await taskSyncHasNews(cache, quiet())).toBe(false);
    problems = [];
    expect(await taskSyncHasNews(cache, quiet())).toBe(true);
  });

  it("each cache keeps its own record", async () => {
    const one = fakeCache(() => []);
    const two = fakeCache(() => []);
    await taskSyncHasNews(one, quiet());
    expect(await taskSyncHasNews(two, quiet())).toBe(true);
  });

  it("problems that cannot be read are news", async () => {
    const cache = { listSyncProblems: async () => { throw new Error("locked"); } } as unknown as PimCacheRepository;
    expect(await taskSyncHasNews(cache, quiet())).toBe(true);
    expect(await taskSyncHasNews(cache, quiet())).toBe(true);
  });
});

/**
 * Every way the reconcile ends in either shell asks first (F21). Desktop: the
 * vault context; phone: its task sync runtime. A dispatch of the event on any
 * other line would bring the reload every two minutes back.
 */
describe("both shells announce the reconcile only when it is news (F21)", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const shells = [
    { name: "desktop", text: read("./contexts/VaultContext.tsx"), event: "plainva-task-sync-done" },
    { name: "phone", text: read("../../mobile/src/services/pim/taskSyncRuntime.ts"), event: "m-task-sync-done" },
  ];
  for (const shell of shells) {
    it(shell.name, () => {
      const dispatches = shell.text.split("\n").filter((line) => line.includes(`new CustomEvent("${shell.event}")`));
      expect(dispatches.length).toBeGreaterThan(0);
      for (const line of dispatches) expect(line).toMatch(/if \(await taskSyncHasNews\(/);
    });
  }
  it("both mark a provider cycle that changed data", () => {
    expect(read("./services/pim/pimRuntime.ts")).toMatch(/onDataChanged: \(\) => \{[^}]*markTaskSyncInputChanged\(cache\)/);
    expect(read("../../mobile/src/services/pim/pimRuntime.ts")).toMatch(/onDataChanged: \(\) => \{[^}]*markPimDataChanged\(cache\)/);
  });
});
