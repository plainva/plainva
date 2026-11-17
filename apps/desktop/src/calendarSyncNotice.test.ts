import { describe, expect, it } from "vitest";
import type { PimCycleInfo, PimSyncProblem } from "@plainva/core";
import { describeSyncProblems, needsTaskDatabase, taskListProblemsOf, withoutTaskDatabaseLines, syncProblemsFor, TASK_NOTE_PROBLEM_PREFIX, formatPimCycle, planAllDayRows, hiddenBeyondDots, syncProblemReason, syncProblemSince, withoutUrlPaths, SYNC_PROBLEM_LINES } from "@plainva/ui";
import en from "../../../packages/ui/src/locales/en.json";

/**
 * The calendar's line about what is not fresh, the cycle line of the
 * diagnostics log and the all-day row's count (plan Befunde 2026-10-06,
 * K1/K2). All three are sentences or numbers DERIVED from state — what has to
 * hold is the derivation: which words, which count, and what stays out.
 */

/** The English catalogue with i18next's `{{name}}` interpolation. */
const t = (key: string, vars: Record<string, unknown> = {}): string => {
  const [ns, name] = key.split(".");
  const template = (en as unknown as Record<string, Record<string, string>>)[ns!]?.[name!];
  if (template === undefined) throw new Error(`missing locale key ${key}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_m, v: string) => String(vars[v]));
};

const NOW = new Date(2026, 9, 6, 14, 30).getTime();
const at = (h: number, m: number, day = 6) => new Date(2026, 9, day, h, m).getTime();

function problem(over: Partial<PimSyncProblem> = {}): PimSyncProblem {
  return { accountId: "a1", accountLabel: "Work (iCloud)", provider: "caldav", since: at(10, 42), error: "caldav propfind 503", signIn: false, ...over };
}

describe("the line above the calendar", () => {
  it("is absent while everything is fresh", () => {
    expect(describeSyncProblems([], t, "en", NOW)).toBeNull();
  });

  it("names the account, since when and why — and that the events are the last state", () => {
    const notice = describeSyncProblems([problem({ error: "error sending request for url (https://caldav.icloud.com/123/calendars/)" })], t, "en-GB", NOW)!;
    expect(notice.lines).toEqual([
      { key: "a1/", text: "“Work (iCloud)” has not been synced since 10:42: The server is not answering. The events below are the last known state." },
    ]);
    expect(notice.more).toBe(0);
  });

  it("names a calendar together with its account", () => {
    const notice = describeSyncProblems([problem({ calendarId: "c7", calendarName: "Team", error: "google api 403 forbidden" })], t, "en-GB", NOW)!;
    expect(notice.lines[0]!.key).toBe("a1/c7");
    expect(notice.lines[0]!.text).toContain("“Team (Work (iCloud))” has not been synced since 10:42: google api 403 forbidden.");
  });

  it("says so when an account has never synced, without inventing a time", () => {
    const notice = describeSyncProblems([problem({ since: null, signIn: true, error: "invalid_grant" })], t, "en", NOW)!;
    expect(notice.lines[0]!.text).toBe("“Work (iCloud)” has not been synced yet: The sign-in is no longer accepted.");
  });

  it("gives the date as well once it was not today", () => {
    expect(syncProblemSince(at(10, 42), "en-GB", NOW)).toBe("10:42");
    const yesterday = syncProblemSince(at(22, 5, 5), "en-GB", NOW);
    expect(yesterday).toContain("22:05");
    expect(yesterday).toMatch(/5 Oct/);
  });

  it("spells out three and counts the rest", () => {
    const many = Array.from({ length: 5 }, (_, i) => problem({ accountId: `a${i}`, accountLabel: `Account ${i}` }));
    const notice = describeSyncProblems(many, t, "en", NOW)!;
    expect(notice.lines).toHaveLength(SYNC_PROBLEM_LINES);
    expect(notice.more).toBe(2);
  });

  it("puts the reason in words where it can, and otherwise shows the provider's — never an address path", () => {
    expect(syncProblemReason(problem({ error: "local calendar cache: database is locked" }), t)).toBe("The local database was busy.");
    expect(syncProblemReason(problem({ error: "network timeout" }), t)).toBe("The server is not answering.");
    expect(syncProblemReason(problem({ signIn: true, error: "anything" }), t)).toBe("The sign-in is no longer accepted.");
    const raw = syncProblemReason(problem({ error: "google api 403 forbidden for https://www.googleapis.com/calendar/v3/calendars/someone%40example.com/events?maxResults=250" }), t);
    expect(raw).toBe("google api 403 forbidden for https://www.googleapis.com/…");
    expect(raw).not.toContain("someone");
    expect(syncProblemReason(problem({ error: "x".repeat(400) }), t).length).toBeLessThan(170);
  });
});

describe("the line above the task views (B2, 19.10.)", () => {
  it("names a task list with its account and speaks of tasks, not of events", () => {
    const notice = describeSyncProblems([problem({ taskListId: "l1", taskListName: "Einkauf", error: "google api 500" })], t, "en-GB", NOW)!;
    expect(notice.lines[0]!.text).toBe("“Einkauf (Work (iCloud))” has not been synced since 10:42: google api 500. The tasks are the last known state.");
  });

  it("names the listing of the task lists by its account", () => {
    const notice = describeSyncProblems([problem({ taskListId: "", since: null })], t, "en", NOW)!;
    expect(notice.lines[0]!.text).toBe("“Task lists of Work (iCloud)” has not been synced yet: caldav propfind 503.");
  });

  it("says in the reader's words why a provider tick did not reach the note - and not that the list is not synced", () => {
    const failing = problem({ taskListId: "l1", taskListName: "Einkauf", since: null, error: `${TASK_NOTE_PROBLEM_PREFIX}no-done-column` });
    expect(syncProblemReason(failing, t)).toBe(en.pim.problemTaskNoDoneColumn);
    expect(describeSyncProblems([failing], t, "en", NOW)!.lines[0]!.text).toBe(
      `Changes to “Einkauf (Work (iCloud))” at the provider do not reach their notes: ${en.pim.problemTaskNoDoneColumn}`,
    );
  });

  it("gives each surface its own problems: calendars to the calendar, lists to the task views, accounts to both", () => {
    const all = [problem(), problem({ calendarId: "c1", calendarName: "Team" }), problem({ taskListId: "l1", taskListName: "Einkauf" })];
    expect(syncProblemsFor(all, "calendar")).toEqual([all[0], all[1]]);
    expect(syncProblemsFor(all, "tasks")).toEqual([all[0], all[2]]);
  });
});

describe("the cycle line of the diagnostics log", () => {
  const base: PimCycleInfo = { cause: "timer", ms: 812.4, wroteData: true, hadError: false, coalesced: 0, accounts: [] };

  it("says how many events each account handed over", () => {
    expect(formatPimCycle({ ...base, accounts: [{ provider: "google", events: 412 }, { provider: "caldav", events: 1 }] })).toBe(
      "cycle timer, 812 ms, wrote data; google#1: 412 events read; caldav#2: 1 event read",
    );
  });

  it("carries the error of an account that had one, and how many calendars failed", () => {
    const line = formatPimCycle({
      ...base,
      wroteData: false,
      hadError: true,
      accounts: [
        { provider: "google", events: 12, calendarErrors: 1 },
        { provider: "caldav", events: 0, error: "local calendar cache: database is locked" },
        { provider: "microsoft", events: 0, skipped: "parked" },
        { provider: "caldav", events: 0, skipped: "waiting", error: "caldav propfind 500" },
      ],
    });
    expect(line).toBe(
      "cycle timer, 812 ms, no change, with errors; google#1: 12 events read, 1 calendar failed; " +
        "caldav#2: 0 events read, error: local calendar cache: database is locked; " +
        "microsoft#3: not asked (parked); caldav#4: not asked (waiting), error: caldav propfind 500",
    );
  });

  it("never carries a calendar id: an address keeps its host and loses its path", () => {
    const line = formatPimCycle({
      ...base,
      hadError: true,
      accounts: [{ provider: "google", events: 0, error: "error sending request for url (https://www.googleapis.com/calendar/v3/calendars/someone%40example.com/events?maxResults=250)" }],
    });
    expect(line).toContain("error sending request for url (https://www.googleapis.com/…)");
    expect(line).not.toContain("someone");
    expect(withoutUrlPaths("no address here")).toBe("no address here");
    expect(withoutUrlPaths("see https://example.com and http://a.b/c d")).toBe("see https://example.com and http://a.b/… d");
  });

  it("reads a cycle from before the accounts were reported", () => {
    const old = { cause: "manual", ms: 5, wroteData: false, hadError: true, coalesced: 1 } as unknown as PimCycleInfo;
    expect(formatPimCycle(old)).toBe("cycle manual, 5 ms, no change, with errors, answered 1 more request");
  });
});

describe("the all-day row", () => {
  const noBars: Array<{ lane: number; startCol: number; endCol: number }> = [];

  it("shows everything up to five rows", () => {
    const plan = planAllDayRows({ laneCount: 1, bars: [{ lane: 0, startCol: 0, endCol: 2 }], itemCounts: [4, 2, 0], expanded: false });
    expect(plan).toEqual({ overflow: false, visibleLanes: 1, days: [{ visibleItems: 4, hidden: 0 }, { visibleItems: 2, hidden: 0 }, { visibleItems: 0, hidden: 0 }] });
  });

  it("gives the fifth row of a fuller day to its count, and leaves the other days alone", () => {
    // The mockup's Monday: six entries -> four and "+ 2 more".
    const plan = planAllDayRows({ laneCount: 0, bars: noBars, itemCounts: [6, 3, 2], expanded: false });
    expect(plan.overflow).toBe(true);
    expect(plan.days).toEqual([{ visibleItems: 4, hidden: 2 }, { visibleItems: 3, hidden: 0 }, { visibleItems: 2, hidden: 0 }]);
  });

  it("counts the rows of multi-day bars, which every day shares", () => {
    const bars = [{ lane: 0, startCol: 0, endCol: 1 }, { lane: 1, startCol: 0, endCol: 0 }];
    const plan = planAllDayRows({ laneCount: 2, bars, itemCounts: [4, 3], expanded: false });
    // Day 0: 2 lanes + 4 entries = 6 rows -> 2 lanes, 2 entries, the count.
    expect(plan.visibleLanes).toBe(2);
    expect(plan.days).toEqual([{ visibleItems: 2, hidden: 2 }, { visibleItems: 3, hidden: 0 }]);
  });

  it("hides whole lanes when the bars alone do not fit, and counts them on the days they cross", () => {
    const bars = Array.from({ length: 6 }, (_, lane) => ({ lane, startCol: 0, endCol: lane < 5 ? 1 : 0 }));
    const plan = planAllDayRows({ laneCount: 6, bars, itemCounts: [1, 0], expanded: false });
    expect(plan.visibleLanes).toBe(4);
    expect(plan.days).toEqual([{ visibleItems: 0, hidden: 3 }, { visibleItems: 0, hidden: 1 }]);
  });

  it("opened, shows everything and still knows that it can be closed", () => {
    const plan = planAllDayRows({ laneCount: 0, bars: noBars, itemCounts: [6, 3], expanded: true });
    expect(plan).toEqual({ overflow: true, visibleLanes: 0, days: [{ visibleItems: 6, hidden: 0 }, { visibleItems: 3, hidden: 0 }] });
  });

  it("the month cell of the phone counts what lies beyond its dots", () => {
    expect(hiddenBeyondDots(3, 3)).toBe(0);
    expect(hiddenBeyondDots(9, 3)).toBe(6);
    expect(hiddenBeyondDots(0, 3)).toBe(0);
  });
});

describe("a task list that cannot reach the notes (issue 172)", () => {
  const list = (code: string, over: Partial<PimSyncProblem> = {}) =>
    problem({ accountLabel: "Nextcloud", taskListId: "l1", taskListName: "Inbox", error: `${TASK_NOTE_PROBLEM_PREFIX}${code}`, ...over });

  it("says each silence in a sentence of its own", () => {
    const text = (code: string) => describeSyncProblems([list(code)], t, "en", NOW)!.lines[0]!.text;
    expect(text("no-task-db")).toBe(
      "Changes to “Inbox (Nextcloud)” at the provider do not reach their notes: No “Standard task database” is set, and tasks from a provider become notes in it. Choose one in the settings or create one."
    );
    expect(text("task-db-unreadable")).toContain(": The standard task database could not be read.");
    expect(text("task-db-no-folder")).toContain(": The standard task database names no folder for new notes.");
    expect(text("not-created")).toContain(": A note for a new task could not be created in the folder of the standard task database.");
    expect(text("no-index")).toContain(": The vault's index is not open on this device, so tasks from a provider cannot be matched to their notes.");
  });

  it("the yellow notice leaves the missing database to the quiet hint, and keeps the real faults", () => {
    const missing = [list("no-task-db"), list("no-task-db", { taskListId: "l2", taskListName: "Work" })];
    const faults = [list("task-db-unreadable", { taskListId: "l3" }), list("not-created", { taskListId: "l4" }), list("no-index", { taskListId: "l5" })];
    const listing = problem({ taskListId: "", error: "caldav propfind 503" });
    expect(withoutTaskDatabaseLines([...missing, ...faults, listing])).toEqual([...faults, listing]);
  });

  it("offers to create a database only where one is missing", () => {
    expect(needsTaskDatabase([list("no-task-db")])).toBe(true);
    expect(needsTaskDatabase([list("task-db-unreadable"), list("no-done-column")])).toBe(false);
  });

  it("the account card reads its own lists only, not the account line or other accounts", () => {
    const mine = list("no-task-db");
    const other = list("no-task-db", { accountId: "a2" });
    const accountLine = problem();
    expect(taskListProblemsOf([mine, other, accountLine], "a1")).toEqual([mine]);
  });

  it("the account card leaves the failed listing to its own banner, and shows a list whose pull failed, once", () => {
    const mine = list("no-task-db");
    const listing = problem({ taskListId: "", error: "caldav propfind 503" });
    const pull = problem({ taskListId: "l2", taskListName: "Work", error: "caldav report 500" });
    expect(taskListProblemsOf([mine, listing, pull], "a1")).toEqual([mine, pull]);
  });
});

