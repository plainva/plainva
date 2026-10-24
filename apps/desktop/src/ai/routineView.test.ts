// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_APP_SETTINGS, appSkillSource, resolveInstructions, EMPTY_INSTRUCTION_APPROVALS, type InstructionEntry, type InstructionSource, type Routine } from "@plainva/core";
import {
  AiRoutines,
  APP_SKILL_SOURCES,
  routineClock,
  routineDayName,
  routineModelOptions,
  routineNeed,
  routineRows,
  routineScheduleText,
  routineSkillOptions,
  routineWeek,
  routineWhen,
  startRoutineScheduler,
  watchRoutineReady,
  type RoutineReady,
  type RoutineStore,
} from "@plainva/ui";

/**
 * How routines read on screen, and the two small machines around them (plan
 * KI-Harness P8): the list as both shells show it, the list as this device
 * keeps it, and the clock that looks at it. Dates are built from calendar
 * parts in the machine's own time; texts are the keys with their values, so
 * a test reads what goes where without a catalog.
 */

const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.entries(vars).map(([name, value]) => `${name}=${String(value)}`).join(",")})` : key);
// October 2026: the 5th is a Monday, the 9th a Friday.
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes);
const ENTRIES: InstructionEntry[] = resolveInstructions(APP_SKILL_SOURCES, EMPTY_INSTRUCTION_APPROVALS);
const SETTINGS = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, profiles: { balanced: { providerId: "anthropic", model: "m-1" }, local: { providerId: "ollama", model: "granite3.3:8b" } } };
/** A skill of the vault's own that only reads, as a scan of `.agent/skills/lookback` finds it. */
const OWN: InstructionSource = {
  ...appSkillSource("lookback", "---\nname: lookback\ndescription: Says what changed in the vault lately. Use when asked for a short look back.\nallowed-tools: search_vault read_note\n---\n\n# lookback\n\nSay what changed.\n"),
  id: ".agent/skills/lookback",
  origin: "vault",
  root: ".agent/skills/lookback",
};
const routine = (patch: Partial<Routine> = {}): Routine => ({
  id: "r1",
  name: "Morning brief",
  skill: "plainva:daily-orientation",
  skillHash: "plainva",
  request: "",
  schedule: { days: [1, 2, 3, 4, 5], time: "07:00" },
  missed: "catch-up",
  onlyWhenChanged: false,
  choice: { providerId: "ollama", model: "granite3.3:8b" },
  scope: null,
  paused: false,
  createdAt: at(1, 12).toISOString(),
  ...patch,
});

describe("a schedule and a moment, as one says them", () => {
  it("names the working days, every day, one day in full and several in short — in the order of the user's week", () => {
    expect(routineScheduleText(t, { days: [1, 2, 3, 4, 5], time: "07:00" }, "en-GB")).toBe("ai.routines.schedule(days=ai.routines.weekdays,time=07:00)");
    expect(routineScheduleText(t, { days: [0, 1, 2, 3, 4, 5, 6], time: "07:00" }, "en-GB")).toBe("ai.routines.schedule(days=ai.routines.everyDay,time=07:00)");
    expect(routineScheduleText(t, { days: [5], time: "16:00" }, "en-GB")).toBe("ai.routines.schedule(days=Friday,time=16:00)");
    expect(routineScheduleText(t, { days: [0, 1, 3], time: "08:30" }, "en-GB", 1)).toBe("ai.routines.schedule(days=Mon, Wed, Sun,time=08:30)");
    expect(routineScheduleText(t, { days: [0, 1, 3], time: "08:30" }, "en-GB", 0)).toBe("ai.routines.schedule(days=Sun, Mon, Wed,time=08:30)");
    expect(routineScheduleText(t, { days: [5], time: "16:00" }, "de")).toBe("ai.routines.schedule(days=Freitag,time=16:00)");
  });

  it("writes a time of day the way the language does, and leaves what is no time alone", () => {
    expect(routineClock("07:00", "de")).toBe("07:00");
    expect(routineClock("16:05", "en-GB")).toBe("16:05");
    expect(routineClock("16:05", "en-US")).toMatch(/^0?4:05\sPM$/);
    expect(routineClock("soon", "de")).toBe("soon");
    expect(routineDayName(1, "de", "long")).toBe("Montag");
    expect(routineDayName(0, "en-GB")).toBe("Sun");
    expect(routineWeek(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(routineWeek(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(routineWeek(6)).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });

  it("says a moment near now by its day: today, tomorrow, the weekday, then the date", () => {
    const now = at(9, 12);
    expect(routineWhen(at(9, 7, 2), now, "en-GB")).toBe("today 07:02");
    expect(routineWhen(at(10, 7), now, "en-GB")).toBe("tomorrow 07:00");
    expect(routineWhen(at(8, 16), now, "en-GB")).toBe("yesterday 16:00");
    expect(routineWhen(at(12, 7), now, "en-GB")).toBe("Mon 07:00");
    expect(routineWhen(at(5, 8, 1), now, "en-GB")).toBe("Mon 08:01");
    expect(routineWhen(at(23, 7), now, "en-GB")).toBe("23 Oct 07:00");
    expect(routineWhen(at(9, 7, 2), now, "de")).toBe("heute 07:02");
  });
});

describe("what a routine can be made of", () => {
  it("offers the skills that are active and only read, with their own request", () => {
    const options = routineSkillOptions(t, ENTRIES);
    const ids = options.map((option) => option.id);
    expect(ids).toEqual(expect.arrayContaining(["plainva:daily-orientation", "plainva:weekly-review", "plainva:project-status"]));
    // Research reaches the internet, memory care writes the memory.
    for (const never of ["plainva:research", "plainva:memory-care"]) expect(ids, never).not.toContain(never);
    expect(options.find((option) => option.id === "plainva:daily-orientation")).toEqual({ id: "plainva:daily-orientation", title: "ai.skills.daily.title", request: "ai.skills.daily.prompt" });
    // Switched off on this device: not offered.
    const off = resolveInstructions(APP_SKILL_SOURCES, { approved: [], off: ["plainva:daily-orientation"] });
    expect(routineSkillOptions(t, off).map((option) => option.id)).not.toContain("plainva:daily-orientation");
    // A skill of the vault that arrived and nobody approved on this device is none either, however little it does.
    const arrived = resolveInstructions([...APP_SKILL_SOURCES, OWN], EMPTY_INSTRUCTION_APPROVALS);
    expect(arrived.find((entry) => entry.source.id === OWN.id)!.status).toBe("new");
    expect(routineSkillOptions(t, arrived).map((option) => option.id)).not.toContain(OWN.id);
  });

  it("offers each profile's model once, and keeps a routine's own model that no profile names any more", () => {
    const same = { ...SETTINGS, profiles: { ...SETTINGS.profiles, fast: { providerId: "anthropic", model: "m-1" } } };
    expect(routineModelOptions(t, same).map((option) => [option.value, option.label])).toEqual([
      ["anthropic/m-1", "ai.routines.form.profile(profile=ai.profile.fast,provider=Anthropic,model=m-1)"],
      ["ollama/granite3.3:8b", "ai.routines.form.profile(profile=ai.profile.local,provider=Ollama,model=granite3.3:8b)"],
    ]);
    const kept = routineModelOptions(t, SETTINGS, { providerId: "anthropic", model: "m-old" });
    expect(kept[kept.length - 1]).toEqual({ value: "anthropic/m-old", label: "Anthropic · m-old", choice: { providerId: "anthropic", model: "m-old" } });
    expect(routineModelOptions(t, { ...SETTINGS, profiles: {} })).toEqual([]);
  });
});

describe("the list as both shells show it", () => {
  const input = (list: Routine[], more: Partial<Parameters<typeof routineRows>[1]> = {}) => ({ list, running: null, entries: ENTRIES, settings: SETTINGS, ...more });
  const row = (list: Routine[], more: Partial<Parameters<typeof routineRows>[1]> = {}, now = at(9, 12), locale = "en-GB") => routineRows(t, input(list, more), now, locale)[0]!;

  it("says what it does and when, how the last run ended and when the next stands", () => {
    const answered = row([routine({ last: { scheduledFor: "2026-10-09T07:00", at: at(9, 7, 2).toISOString(), outcome: "answered", note: "Inbox/n.md", noteTitle: "Morning brief – 2026-10-09" } })]);
    expect(answered).toMatchObject({ id: "r1", name: "Morning brief", need: null, paused: false, running: false });
    expect(answered.line).toBe("ai.routines.line(schedule=ai.routines.schedule(days=ai.routines.weekdays,time=07:00),skill=ai.skills.daily.title,provider=Ollama,model=granite3.3:8b)");
    expect(answered.status).toBe("ai.routines.last.answered(when=today 07:02,note=Morning brief – 2026-10-09) · ai.routines.next(when=Mon 07:00)");
    expect(row([routine({ createdAt: at(9, 5).toISOString() })], {}, at(9, 6)).status).toBe("ai.routines.last.never · ai.routines.next(when=today 07:00)");
    expect(row([routine({ last: { scheduledFor: "2026-10-09T07:00", at: at(9, 7, 1).toISOString(), outcome: "unchanged" } })]).status).toContain("ai.routines.last.unchanged(when=today 07:01)");
    expect(row([routine({ last: { scheduledFor: "2026-10-09T07:00", at: at(9, 7, 1).toISOString(), outcome: "stopped" } })]).status).toContain("ai.routines.last.stopped(when=today 07:01)");
    expect(row([routine({ last: { scheduledFor: "2026-10-09T07:00", at: at(9, 7, 1).toISOString(), outcome: "failed", failure: "unreachable" } })]).status).toContain("ai.routines.last.failed(when=today 07:01,reason=ai.routines.reason.unreachable)");
    expect(row([routine({ last: { scheduledFor: "2026-10-09T07:00", at: at(9, 7, 1).toISOString(), outcome: "failed" } })]).status).toContain("reason=ai.routines.reason.other");
  });

  it("says of a moment that has come that it runs now, says a paused one is paused, and a running one that it runs", () => {
    // Opened at noon with seven o'clock missed, or on Friday at six with Thursday's run missed: the run that is about
    // to be caught up is named by no day — "yesterday 07:00" is no next run.
    expect(row([routine({ createdAt: at(1, 12).toISOString() })]).status).toBe("ai.routines.last.never · ai.routines.next(when=now)");
    expect(row([routine({ createdAt: at(1, 12).toISOString() })], {}, at(9, 6)).status).toBe("ai.routines.last.never · ai.routines.next(when=now)");
    expect(row([routine({ createdAt: at(1, 12).toISOString() })], {}, at(9, 6), "de").status).toBe("ai.routines.last.never · ai.routines.next(when=jetzt)");
    // With "skip", yesterday's moment is gone: the next one is today's.
    expect(row([routine({ createdAt: at(1, 12).toISOString(), missed: "skip" })], {}, at(9, 6)).status).toBe("ai.routines.last.never · ai.routines.next(when=today 07:00)");
    expect(row([routine({ paused: true })])).toMatchObject({ paused: true, status: "ai.routines.last.never · ai.routines.paused" });
    expect(row([routine()], { running: { id: "r1" } })).toMatchObject({ running: true, need: null, status: "ai.routines.runningNow" });
  });

  it("says instead what a routine needs, as far as the device can tell without running it", () => {
    const cloud = routine({ choice: { providerId: "anthropic", model: "m-1" }, scope: { recipients: ["anthropic/m-1"], dataClasses: [], folders: [], tools: [], web: false, maxTokens: 0 } });
    expect(routineNeed(routine(), ENTRIES, SETTINGS)).toBeNull();
    // The skill: gone, switched off, or — for one of the vault — not what was confirmed.
    expect(row([routine({ skill: "plainva:gone" })])).toMatchObject({ need: "skill", status: "ai.routines.needs.skill" });
    expect(row([routine({ skill: "plainva:gone" })]).line).toContain("skill=ai.routines.skillGone");
    expect(routineNeed(routine(), resolveInstructions(APP_SKILL_SOURCES, { approved: [], off: ["plainva:daily-orientation"] }), SETTINGS)).toBe("skill");
    expect(routineNeed(routine({ skill: "plainva:research" }), ENTRIES, SETTINGS)).toBe("skill");
    // The model: its provider gone, or without a key here.
    expect(routineNeed(routine({ choice: { providerId: "gone", model: "m" } }), ENTRIES, SETTINGS)).toBe("model");
    expect(routineNeed(cloud, ENTRIES, SETTINGS, { anthropic: false })).toBe("model");
    expect(routineNeed(cloud, ENTRIES, SETTINGS, { anthropic: true })).toBeNull();
    expect(routineNeed(routine(), ENTRIES, SETTINGS, {})).toBeNull(); // a server on this computer needs no key
    // The device: fully local, or asking before every request — neither matters to a model on it.
    expect(routineNeed(cloud, ENTRIES, { ...SETTINGS, localOnly: true })).toBe("local");
    expect(routineNeed(cloud, ENTRIES, { ...SETTINGS, confirmEveryRequest: true })).toBe("confirm");
    expect(routineNeed(routine(), ENTRIES, { ...SETTINGS, localOnly: true, confirmEveryRequest: true })).toBeNull();
    // What only a run can find stays until the routine is confirmed again.
    const grew = { ...cloud, last: { scheduledFor: "2026-10-09T07:00", at: at(9, 7, 1).toISOString(), outcome: "needs-you" as const, need: "scope" as const } };
    expect(row([grew])).toMatchObject({ need: "scope", status: "ai.routines.needs.scope" });
    // A need that is over is history: the row says when it did not run, and when it runs next.
    const was = { ...cloud, last: { scheduledFor: "2026-10-09T07:00", at: at(9, 7, 1).toISOString(), outcome: "needs-you" as const, need: "local" as const } };
    expect(row([was])).toMatchObject({ need: null, status: "ai.routines.last.needed(when=today 07:01) · ai.routines.next(when=Mon 07:00)" });
  });
});

describe("the list as this device keeps it", () => {
  const store = (initial: Routine[] = []) => {
    let kept = initial;
    let saves = 0;
    const api: RoutineStore = { load: async () => kept.map((entry) => ({ ...entry })), save: async (list) => void ((kept = [...list]), (saves += 1)) };
    return { api, kept: () => kept, saves: () => saves };
  };

  it("reads a vault's list when it is attached, and holds nothing of the last vault", async () => {
    const published: unknown[] = [];
    const routines = new AiRoutines((state) => published.push(state));
    expect(routines.available()).toBe(false);
    const first = store([routine()]);
    routines.attach(first.api);
    expect(routines.state).toMatchObject({ available: true, loaded: false, list: [] });
    await routines.reload();
    expect(routines.state).toMatchObject({ loaded: true, list: [routine()] });
    routines.setRunning({ id: "r1", name: "Morning brief" });
    routines.setReady({ id: "r1", name: "Morning brief", note: "Inbox/n.md", title: "n" });
    routines.attach(null);
    expect(routines.state).toEqual({ loaded: false, available: false, list: [], running: null, ready: null });
    expect(await routines.reload()).toEqual([]);
    expect(await routines.put(routine())).toBeNull();
    expect(published.length).toBeGreaterThan(3);
  });

  it("changes one thing at a time against what is stored, so a run that ends and a switch that is flipped both land", async () => {
    const backing = store([routine(), routine({ id: "r2", name: "Weekly" })]);
    const routines = new AiRoutines(() => undefined);
    routines.attach(backing.api);
    const run = { scheduledFor: "2026-10-09T07:00", at: at(9, 7, 2).toISOString(), outcome: "answered" as const };
    await Promise.all([routines.patch("r1", (stored) => ({ ...stored, last: run })), routines.patch("r1", (stored) => ({ ...stored, paused: true })), routines.patch("r2", (stored) => ({ ...stored, name: "Weekly review" }))]);
    expect(backing.kept()).toEqual([routine({ last: run, paused: true }), routine({ id: "r2", name: "Weekly review" })]);
    expect(routines.state.list).toEqual(backing.kept());
    // Another window removed one in between: a change to it lands nowhere.
    await backing.api.save([routine({ id: "r2", name: "Weekly review" })]);
    expect(await routines.patch("r1", (stored) => ({ ...stored, paused: false }))).toBeNull();
    expect(await routines.fresh("r1")).toBeNull();
    expect((await routines.fresh("r2"))!.name).toBe("Weekly review");
    expect(await routines.remove("r2")).toEqual([]);
    expect(await routines.remove("r2")).toBeNull();
  });

  it("puts a routine in the place of the one with its id, adds a new one at the end, and keeps no more than the device may", async () => {
    const many = Array.from({ length: 19 }, (_, index) => routine({ id: `r${index}` }));
    const backing = store(many);
    const routines = new AiRoutines(() => undefined);
    routines.attach(backing.api);
    expect(await routines.put(routine({ id: "r3", name: "Changed" }))).toHaveLength(19);
    expect(backing.kept()[3]!.name).toBe("Changed");
    expect(await routines.put(routine({ id: "new" }))).toHaveLength(20);
    expect(backing.kept()[backing.kept().length - 1]!.id).toBe("new");
    expect(await routines.put(routine({ id: "one-too-many" }))).toBeNull();
    expect(backing.kept()).toHaveLength(20);
  });
});

describe("the clock that looks at them", () => {
  afterEach(() => vi.useRealTimers());

  it("looks shortly after the vault opened, then at its tick, and when the app comes back — one look at a time", async () => {
    vi.useFakeTimers();
    let looks = 0;
    let release: (() => void) | null = null;
    const runDue = () =>
      new Promise<void>((resolve) => {
        looks += 1;
        release = resolve;
      });
    const stop = startRoutineScheduler(runDue, { firstMs: 1_000, tickMs: 5_000 });
    expect(looks).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(looks).toBe(1);
    // The first look is still running: neither the tick nor coming back starts a second one.
    await vi.advanceTimersByTimeAsync(5_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(looks).toBe(1);
    release!();
    await vi.advanceTimersByTimeAsync(0);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(looks).toBe(2);
    release!();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(looks).toBe(3);
    release!();
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(looks).toBe(3);
  });

  it("goes on looking after a look that failed", async () => {
    vi.useFakeTimers();
    let looks = 0;
    const stop = startRoutineScheduler(
      async () => {
        looks += 1;
        throw new Error("the store could not be read");
      },
      { firstMs: 10, tickMs: 100 },
    );
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(100);
    expect(looks).toBe(2);
    stop();
  });

  it("tells the shell once per note that a run left one", () => {
    let ready: RoutineReady | null = null;
    const listeners = new Set<() => void>();
    const publish = (next: RoutineReady | null) => {
      ready = next;
      listeners.forEach((listener) => listener());
    };
    const told: string[] = [];
    const stop = watchRoutineReady({ subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)), ready: () => ready }, (note) => told.push(note.title));
    publish(null);
    publish({ id: "r1", name: "Brief", note: "Inbox/a.md", title: "a" });
    publish({ id: "r1", name: "Brief", note: "Inbox/a.md", title: "a" }); // the state was published again: not a second note
    publish(null); // seen
    publish({ id: "r1", name: "Brief", note: "Inbox/b.md", title: "b" });
    expect(told).toEqual(["a", "b"]);
    stop();
    publish({ id: "r1", name: "Brief", note: "Inbox/c.md", title: "c" });
    expect(told).toEqual(["a", "b"]);
  });
});
