import { describe, expect, it } from "vitest";
import {
  ROUTINES_MAX,
  ROUTINE_NAME_MAX,
  ROUTINE_RUN_LIMITS,
  dueMoment,
  isRoutineSchedule,
  latestMoment,
  localStamp,
  nextMoment,
  parseRoutines,
  readRoutines,
  routineDays,
  routineDraftOf,
  routineDraftProblems,
  routineFailureOf,
  routineMinutes,
  routineNoteTitle,
  routineSkillFits,
  routineSkillHash,
  routineTools,
  serializeRoutines,
  type Routine,
  type RoutineDraft,
} from "./routines.js";
import { conversationTitleFrom } from "./history.js";
import { DEFAULT_RUN_LIMITS } from "./orchestrator.js";
import { TOOL_MANIFESTS, toolByName } from "./tools.js";
import { isEffectTool } from "./ruleOfTwo.js";

/**
 * Routines without IO (plan KI-Harness P8, ADR 0033): what a run without its
 * user may carry, when one is due in the clock its user sees, and how the
 * list is read back. Every date here is built from calendar parts in the
 * machine's own time, as the scheduler builds them — the tests say the same
 * thing in every time zone.
 */

// October 2026: the 5th is a Monday, the 9th a Friday, the 10th a Saturday.
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes);
const weekdays = () => ({ days: [1, 2, 3, 4, 5] as Routine["schedule"]["days"], time: "07:00" });
const routine = (patch: Partial<Routine> = {}): Routine => ({
  id: "r1",
  name: "Morning brief",
  skill: "plainva:daily-orientation",
  skillHash: "plainva",
  request: "",
  schedule: weekdays(),
  missed: "catch-up",
  onlyWhenChanged: false,
  choice: { providerId: "ollama", model: "granite3.3:8b" },
  scope: null,
  paused: false,
  createdAt: at(1, 12).toISOString(),
  ...patch,
});

describe("what a run without its user may carry (the gate: unattended means read-only)", () => {
  it("carries the tools that read, and none that has an effect, moves the app or reaches further", () => {
    const all = TOOL_MANIFESTS.map((tool) => tool.name);
    const carried = routineTools(all);
    // Every tool of the app is either carried or kept out for one of the reasons below — a tool added later is decided here.
    for (const name of all) {
      const tool = toolByName(name)!;
      const out = tool.risk !== "read" || tool.outward === true || ["find_tools", "call_tool", "use_skill"].includes(name);
      expect(carried.includes(name), name).toBe(!out);
    }
    // The Rule of Two: private notes and a stranger's text are in such a run — an effect never is.
    for (const name of carried) expect(isEffectTool(toolByName(name)!), name).toBe(false);
    expect(carried).toEqual(expect.arrayContaining(["search_vault", "read_note", "get_tasks", "get_calendar", "get_recent"]));
    for (const never of ["run_command", "open_in_app", "fetch_url", "web_search", "propose_edit", "create_note", "create_task", "remember", "forget", "draft_mail", "delete_note", "find_tools", "call_tool", "use_skill"]) {
      expect(carried, never).not.toContain(never);
    }
  });

  it("drops a name that is no tool of the app", () => {
    expect(routineTools(["read_note", "Bash(git:*)", "mcp__files__read"])).toEqual(["read_note"]);
  });

  it("offers a skill as a routine only when every tool it names is one a routine carries", () => {
    expect(routineSkillFits({ allowedTools: ["get_tasks", "get_calendar", "read_note", "search_vault"] })).toBe(true);
    // Names nothing: uses what a run has — as a routine, what a routine has.
    expect(routineSkillFits({ allowedTools: null })).toBe(true);
    expect(routineSkillFits({ allowedTools: [] })).toBe(true);
    // A name the app does not know is no tool here either way.
    expect(routineSkillFits({ allowedTools: ["read_note", "Bash(git:*)"] })).toBe(true);
    for (const more of ["propose_edit", "create_task", "fetch_url", "web_search", "run_command", "find_tools", "remember"]) {
      expect(routineSkillFits({ allowedTools: ["read_note", more] }), more).toBe(false);
    }
  });

  it("knows a skill of the vault by every file of it, and a skill of the app as the app's", () => {
    const files = [
      { path: "SKILL.md", bytes: 10, sha256: "aa" },
      { path: "references/terms.md", bytes: 4, sha256: "bb" },
    ];
    const hash = routineSkillHash({ origin: "vault", files });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(routineSkillHash({ origin: "vault", files: [...files].reverse() })).toBe(hash);
    expect(routineSkillHash({ origin: "vault", files: [files[0]!, { ...files[1]!, sha256: "bc" }] })).not.toBe(hash);
    expect(routineSkillHash({ origin: "vault", files: [files[0]!] })).not.toBe(hash);
    expect(routineSkillHash({ origin: "vault", files: [...files, { path: "extra.md", bytes: 1, sha256: "cc" }] })).not.toBe(hash);
    // An update of the app is no change somebody else made.
    expect(routineSkillHash({ origin: "plainva", files })).toBe(routineSkillHash({ origin: "plainva", files: [] }));
  });

  it("names why a run left no note by a kind, never by a provider's words", () => {
    expect(routineFailureOf({ kind: "limit", which: "maxSteps" })).toBe("budget");
    expect(routineFailureOf({ kind: "max_tokens" })).toBe("budget");
    expect(routineFailureOf({ kind: "loop", tool: "read_note" })).toBe("budget");
    expect(routineFailureOf({ kind: "circuit_breaker", tool: "read_note" })).toBe("budget");
    expect(routineFailureOf({ kind: "refusal" })).toBe("declined");
    expect(routineFailureOf({ kind: "failed", failure: { kind: "no_key" } })).toBe("key");
    expect(routineFailureOf({ kind: "failed", failure: { kind: "invalid_key", status: 401 } })).toBe("key");
    expect(routineFailureOf({ kind: "failed", failure: { kind: "offline", message: "ECONNREFUSED 127.0.0.1" } })).toBe("unreachable");
    expect(routineFailureOf({ kind: "failed", failure: { kind: "stream_broken", message: "x" } })).toBe("unreachable");
    expect(routineFailureOf({ kind: "failed", failure: { kind: "context_too_long", status: 400 } })).toBe("length");
    expect(routineFailureOf({ kind: "failed", failure: { kind: "provider_error", message: "a provider's own words" } })).toBe("other");
    expect(routineFailureOf({ kind: "cancelled" })).toBe("other");
  });

  it("spends less than a run a person starts", () => {
    expect(ROUTINE_RUN_LIMITS.maxSteps).toBeLessThan(DEFAULT_RUN_LIMITS.maxSteps);
    expect(ROUTINE_RUN_LIMITS.maxToolCalls).toBeLessThan(DEFAULT_RUN_LIMITS.maxToolCalls);
    expect(ROUTINE_RUN_LIMITS.maxOutputTokens).toBeLessThan(DEFAULT_RUN_LIMITS.maxOutputTokens);
  });
});

describe("a time of day and the days of a week", () => {
  it("reads a time written as hours and minutes, and nothing else", () => {
    expect(routineMinutes("07:00")).toBe(420);
    expect(routineMinutes("00:00")).toBe(0);
    expect(routineMinutes("23:59")).toBe(1439);
    for (const bad of ["7:00", "24:00", "07:60", "07.00", "0700", "ab:cd", " 7:00", "07:0x", "07:00 ", "-1:00", ""]) expect(routineMinutes(bad), bad).toBeNull();
  });

  it("keeps the days each once, in the order of the week", () => {
    expect(routineDays([5, 1, 1, 3])).toEqual([1, 3, 5]);
    expect(routineDays([7, -1, "1", 0])).toEqual([0]);
    expect(isRoutineSchedule({ days: [1], time: "07:00" })).toBe(true);
    expect(isRoutineSchedule({ days: [], time: "07:00" })).toBe(false);
    expect(isRoutineSchedule({ days: [8], time: "07:00" })).toBe(false);
    expect(isRoutineSchedule({ days: [1], time: "7" })).toBe(false);
    expect(isRoutineSchedule(null)).toBe(false);
  });

  it("keeps a moment as the wall-clock time it names", () => {
    expect(localStamp(at(9, 7))).toBe("2026-10-09T07:00");
    expect(localStamp(new Date(2026, 0, 5, 16, 5))).toBe("2026-01-05T16:05");
  });
});

describe("the moments of a schedule", () => {
  it("finds the latest moment that has passed: today's once its time has come, else the last day named", () => {
    expect(localStamp(latestMoment(weekdays(), at(9, 7, 0))!)).toBe("2026-10-09T07:00");
    expect(localStamp(latestMoment(weekdays(), at(9, 6, 59))!)).toBe("2026-10-08T07:00");
    // Over a weekend: Friday's.
    expect(localStamp(latestMoment(weekdays(), at(11, 12))!)).toBe("2026-10-09T07:00");
    // A weekly one looks back as far as a week.
    expect(localStamp(latestMoment({ days: [5], time: "16:00" }, at(9, 15, 59))!)).toBe("2026-10-02T16:00");
    expect(latestMoment({ days: [], time: "07:00" }, at(9, 12))).toBeNull();
  });

  it("finds the next moment: today's while its time is ahead, else the next day named", () => {
    expect(localStamp(nextMoment(weekdays(), at(9, 6, 59))!)).toBe("2026-10-09T07:00");
    expect(localStamp(nextMoment(weekdays(), at(9, 7, 0))!)).toBe("2026-10-12T07:00");
    expect(localStamp(nextMoment({ days: [5], time: "16:00" }, at(9, 16, 0))!)).toBe("2026-10-16T16:00");
    expect(nextMoment({ days: [], time: "07:00" }, at(9, 12))).toBeNull();
  });
});

describe("when a routine is due", () => {
  it("is due once its moment has passed, and not again for the same moment", () => {
    const fresh = routine();
    expect(dueMoment(fresh, at(9, 6, 59))).not.toBeNull(); // Thursday's was never run: caught up
    expect(localStamp(dueMoment(fresh, at(9, 7, 0))!)).toBe("2026-10-09T07:00");
    const ran = routine({ last: { scheduledFor: "2026-10-09T07:00", at: at(9, 7, 2).toISOString(), outcome: "answered" } });
    expect(dueMoment(ran, at(9, 7, 5))).toBeNull();
    expect(dueMoment(ran, at(9, 23, 59))).toBeNull();
    // The next working day's moment.
    expect(localStamp(dueMoment(ran, at(12, 7, 0))!)).toBe("2026-10-12T07:00");
  });

  it("never runs for a moment older than itself: set up at eight for seven, it waits for tomorrow", () => {
    const fresh = routine({ createdAt: at(9, 8).toISOString() });
    expect(dueMoment(fresh, at(9, 8, 1))).toBeNull();
    expect(dueMoment(fresh, at(9, 23))).toBeNull();
    expect(localStamp(dueMoment(fresh, at(12, 7, 0))!)).toBe("2026-10-12T07:00");
  });

  it("with \"catch up\" runs once for the latest missed moment, however many were missed", () => {
    const ran = routine({ last: { scheduledFor: "2026-10-05T07:00", at: at(5, 7, 1).toISOString(), outcome: "answered" } });
    // Opened again on Sunday: four moments were missed — one run, for Friday's.
    expect(localStamp(dueMoment(ran, at(11, 10))!)).toBe("2026-10-09T07:00");
    const caught = routine({ last: { scheduledFor: "2026-10-09T07:00", at: at(11, 10, 1).toISOString(), outcome: "answered" } });
    expect(dueMoment(caught, at(11, 10, 5))).toBeNull();
  });

  it("with \"skip\" runs only for today's moment: yesterday's brief is no use this morning", () => {
    const ran = routine({ missed: "skip", last: { scheduledFor: "2026-10-05T07:00", at: at(5, 7, 1).toISOString(), outcome: "answered" } });
    expect(dueMoment(ran, at(11, 10))).toBeNull(); // Sunday: Friday's is skipped
    expect(dueMoment(ran, at(9, 6))).toBeNull(); // before today's, Thursday's is skipped
    expect(localStamp(dueMoment(ran, at(9, 21))!)).toBe("2026-10-09T07:00"); // late on the day itself still counts
  });

  it("counts a run that ended in any way: a routine that needs its user, or failed, does not try again at every tick", () => {
    for (const outcome of ["needs-you", "failed", "stopped", "unchanged"] as const) {
      const ended = routine({ last: { scheduledFor: "2026-10-09T07:00", at: at(9, 7, 1).toISOString(), outcome } });
      expect(dueMoment(ended, at(9, 7, 10)), outcome).toBeNull();
      expect(dueMoment(ended, at(12, 7, 0)), outcome).not.toBeNull();
    }
  });

  it("is never due while it is paused, and a run started by hand does not use up a moment still ahead", () => {
    expect(dueMoment(routine({ paused: true }), at(9, 12))).toBeNull();
    const byHand = routine({ last: { scheduledFor: "2026-10-09T06:30", at: at(9, 6, 31).toISOString(), outcome: "answered" } });
    expect(localStamp(dueMoment(byHand, at(9, 7, 0))!)).toBe("2026-10-09T07:00");
  });

  it("does not catch up what was paused: taken off pause at ten, it waits for its next moment", () => {
    const ran = routine({ last: { scheduledFor: "2026-10-05T07:00", at: at(5, 7, 1).toISOString(), outcome: "answered" } });
    // Paused from Tuesday on, switched on again on Friday at ten: Friday's seven o'clock lies before that.
    const resumed = { ...ran, resumedAt: at(9, 10).toISOString() };
    expect(dueMoment(resumed, at(9, 10, 1))).toBeNull();
    expect(dueMoment(resumed, at(11, 12))).toBeNull();
    expect(localStamp(dueMoment(resumed, at(12, 7, 0))!)).toBe("2026-10-12T07:00");
    // Taken off pause before its time, it runs at its time.
    expect(localStamp(dueMoment({ ...ran, resumedAt: at(9, 6).toISOString() }, at(9, 7, 0))!)).toBe("2026-10-09T07:00");
    // A value that is no instant holds nothing back.
    expect(localStamp(dueMoment({ ...ran, resumedAt: "soon" }, at(9, 7, 0))!)).toBe("2026-10-09T07:00");
  });

  it("is open again for the moment it needed its user, once that run is taken away by a new confirmation", () => {
    const needed = routine({ last: { scheduledFor: "2026-10-09T07:00", at: at(9, 7, 1).toISOString(), outcome: "needs-you", need: "scope" } });
    expect(dueMoment(needed, at(9, 9))).toBeNull();
    expect(localStamp(dueMoment({ ...needed, last: undefined }, at(9, 9))!)).toBe("2026-10-09T07:00");
  });
});

describe("the list as it is kept", () => {
  it("comes back as it was written", () => {
    const full = routine({
      scope: { recipients: ["anthropic/m-1"], dataClasses: ["notes", "tasks"], folders: ["Projects"], tools: ["search_vault"], web: false, maxTokens: 1200, instructions: ["skill:x"] },
      choice: { providerId: "anthropic", model: "m-1" },
      resumedAt: at(8, 9).toISOString(),
      answeredAt: at(9, 7, 2).toISOString(),
      conversationId: "c1",
      last: { scheduledFor: "2026-10-09T07:00", at: at(9, 7, 2).toISOString(), outcome: "answered", note: "Inbox/Morning brief – 2026-10-09.md", noteTitle: "Morning brief – 2026-10-09" },
    });
    const needs = routine({ id: "r2", name: "Weekly", last: { scheduledFor: "2026-10-09T16:00", at: at(9, 16, 1).toISOString(), outcome: "needs-you", need: "scope" } });
    const failed = routine({ id: "r3", name: "Threads", conversationId: "c3", last: { scheduledFor: "2026-10-05T08:00", at: at(5, 8, 1).toISOString(), outcome: "failed", failure: "unreachable" } });
    expect(parseRoutines(serializeRoutines([full, needs, failed]))).toEqual([full, needs, failed]);
  });

  it("holds no routine where the file is missing or damaged", () => {
    expect(parseRoutines(null)).toEqual([]);
    expect(parseRoutines("")).toEqual([]);
    expect(parseRoutines("{not json")).toEqual([]);
    expect(parseRoutines("[]")).toEqual([]);
  });

  it("leaves out what is not whole — half a standing permission is none", () => {
    const good = routine();
    const broken: unknown[] = [
      { ...good, id: "" },
      { ...good, id: "x1", name: "" },
      { ...good, id: "x2", skill: "" },
      { ...good, id: "x3", skillHash: undefined },
      { ...good, id: "x4", schedule: { days: [], time: "07:00" } },
      { ...good, id: "x5", schedule: { days: [1], time: "25:00" } },
      { ...good, id: "x6", choice: { providerId: "ollama" } },
      { ...good, id: "x7", createdAt: "yesterday" },
      { ...good, id: "x8", request: "x".repeat(501) },
      { ...good }, // the same id twice
      null,
      "routine",
    ];
    expect(readRoutines({ version: 1, routines: [good, ...broken] })).toEqual([good]);
    expect(readRoutines(null)).toEqual([]);
    expect(readRoutines({ routines: "all" })).toEqual([]);
  });

  it("reads a scope it cannot read as none, never the internet into one, and a last run that is none as no run", () => {
    const stored = { ...routine(), scope: { recipients: ["anthropic/m-1"], dataClasses: ["notes"], folders: [], tools: [], web: true, maxTokens: 10 }, last: { outcome: "answered" }, answeredAt: "then" };
    const [read] = readRoutines({ routines: [stored] });
    expect(read!.scope).toEqual({ recipients: ["anthropic/m-1"], dataClasses: ["notes"], folders: [], tools: [], web: false, maxTokens: 10 });
    expect(read!.last).toBeUndefined();
    expect(read!.answeredAt).toBeUndefined();
    expect(readRoutines({ routines: [{ ...routine(), scope: { recipients: "all" } }] })[0]!.scope).toBeNull();
    // A need or a failure the app does not know is dropped; the run itself stays.
    const odd = readRoutines({ routines: [{ ...routine(), last: { scheduledFor: "2026-10-09T07:00", at: at(9, 7, 1).toISOString(), outcome: "failed", need: "money", failure: "a provider's own words" } }] })[0]!;
    expect(odd.last).toEqual({ scheduledFor: "2026-10-09T07:00", at: at(9, 7, 1).toISOString(), outcome: "failed" });
  });

  it("keeps no more routines than it names", () => {
    const many = Array.from({ length: ROUTINES_MAX + 5 }, (_, index) => routine({ id: `r${index}` }));
    expect(readRoutines({ routines: many })).toHaveLength(ROUTINES_MAX);
    expect(parseRoutines(serializeRoutines(many))).toHaveLength(ROUTINES_MAX);
  });
});

describe("a routine before it is confirmed", () => {
  const draft = (patch: Partial<RoutineDraft> = {}): RoutineDraft => ({ name: "Morning brief", skill: "plainva:daily-orientation", request: "", days: [1, 2, 3, 4, 5], time: "07:00", missed: "catch-up", onlyWhenChanged: false, choice: { providerId: "ollama", model: "m" }, ...patch });

  it("can be confirmed when it names a skill, a day, a time and a model", () => {
    expect(routineDraftProblems(draft())).toEqual([]);
    expect(routineDraftProblems(draft({ name: " ", skill: "", days: [], time: "7", request: "x".repeat(501), choice: null }))).toEqual(["name", "skill", "days", "time", "request", "model"]);
  });

  it("starts an edit from the routine as it is", () => {
    const existing = routine({ request: "What is due?", missed: "skip", onlyWhenChanged: true });
    expect(routineDraftOf(existing)).toEqual({ name: "Morning brief", skill: "plainva:daily-orientation", request: "What is due?", days: [1, 2, 3, 4, 5], time: "07:00", missed: "skip", onlyWhenChanged: true, choice: { providerId: "ollama", model: "granite3.3:8b" } });
    expect(routineDraftProblems(routineDraftOf(existing))).toEqual([]);
  });

  it("is called after its routine and the day — and the longest name still leaves the day in a note's title", () => {
    expect(routineNoteTitle("Morning brief", at(9, 7))).toBe("Morning brief – 2026-10-09");
    const longest = routineNoteTitle("x".repeat(ROUTINE_NAME_MAX), at(9, 7));
    expect(conversationTitleFrom(longest, "")).toBe(longest);
    expect(routineDraftProblems(draft({ name: "x".repeat(ROUTINE_NAME_MAX) }))).toEqual([]);
    expect(routineDraftProblems(draft({ name: "x".repeat(ROUTINE_NAME_MAX + 1) }))).toEqual(["name"]);
  });
});
