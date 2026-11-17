import { describe, expect, it } from "vitest";
import { shippedSources } from "./test-sourceTree";
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
 * Nothing in either shell announces "task sync done" without asking first
 * (F21), except the places named below. The scan reads every shipped source
 * of both shells and both packages and finds the event by its name, however
 * the dispatch is written; a new place fails here until it asks or is named.
 */
const EVENTS = ["plainva-task-sync-done", "m-task-sync-done"];
/** Places that announce without asking, and why. Each must still exist. */
const UNASKED: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: "apps/mobile/src/services/pim/taskToProvider.ts",
    why: "a task the person just sent to a provider list: their own action, once, never per cycle",
  },
];
/** Places that name the event only to listen for it, in a form the scan does not read as a listener. */
const LISTENING: ReadonlyArray<{ file: string; why: string }> = [
  { file: "apps/mobile/src/services/widgetService.ts", why: "subscribes to a list of event names in a loop" },
];

describe("both shells announce the reconcile only when it is news (F21)", () => {
  const sources = shippedSources();
  const mentions = sources.flatMap(({ rel, text }) =>
    text.split("\n").flatMap((line, i) =>
      EVENTS.some((name) => line.includes(`"${name}"`)) && !/\b(add|remove)EventListener\(/.test(line) ? [{ rel, line: i + 1, text: line }] : []
    )
  );

  it("every place that names the event to send it asks taskSyncHasNews, or is named with its reason", () => {
    const named = [...UNASKED, ...LISTENING];
    const unasked = mentions.filter((m) => !/if \(await taskSyncHasNews\(/.test(m.text) && !named.some((u) => u.file === m.rel));
    expect(unasked.map((m) => `${m.rel}:${m.line}: ${m.text.trim()}`)).toEqual([]);
  });

  it("the shells' reconciles are among the places that ask", () => {
    const asking = new Set(mentions.filter((m) => /taskSyncHasNews/.test(m.text)).map((m) => m.rel));
    expect([...asking].sort()).toEqual(["apps/desktop/src/contexts/VaultContext.tsx", "apps/mobile/src/services/pim/taskSyncRuntime.ts"]);
  });

  it("every named exception still names the event", () => {
    for (const u of [...UNASKED, ...LISTENING]) expect(mentions.some((m) => m.rel === u.file), u.file).toBe(true);
  });

  it("both mark a provider cycle that changed data", () => {
    const text = (rel: string) => sources.find((s) => s.rel === rel)?.text ?? "";
    expect(text("apps/desktop/src/services/pim/pimRuntime.ts")).toMatch(/onDataChanged: \(\) => \{[^}]*markTaskSyncInputChanged\(cache\)/);
    expect(text("apps/mobile/src/services/pim/pimRuntime.ts")).toMatch(/onDataChanged: \(\) => \{[^}]*markPimDataChanged\(cache\)/);
  });
});
