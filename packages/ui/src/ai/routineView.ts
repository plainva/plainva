import {
  AI_PROFILE_IDS,
  choiceOnDevice,
  dueMoment,
  folderLogPath,
  logFolder,
  nextMoment,
  providerById,
  routineMinutes,
  routineSkillFits,
  routineSkillHash,
  type AiAppSettings,
  type InstructionEntry,
  type ModelChoice,
  type Routine,
  type RoutineDay,
  type RoutineNeed,
  type RoutineSchedule,
} from "@plainva/core";
import { skillView } from "./aiSkills";

/**
 * How routines read on screen (plan KI-Harness P8, mockup chapter 24): one
 * definition for the desktop's card and the phone's section — what a routine
 * does and when, how its last run ended, when the next one stands, and what
 * it needs from its user. Texts come from the catalog; times and days from
 * the language's own conventions.
 */

type Translate = (key: string, vars?: Record<string, unknown>) => string;

const WORKING_DAYS: readonly RoutineDay[] = [1, 2, 3, 4, 5];

/**
 * "Now" for a list that stays open, from the two clocks the app keeps as
 * state — today's day key (`useTodayKey`) and the minute (`useMinuteClock`):
 * the same value for the same state, so a render stays pure, and a new one
 * every minute.
 */
export const routineNow = (day: string, clock: string): Date => new Date(`${day}T${clock}:00`);

/** A time of day as the language writes it ("07:00", "7:00 AM"). */
export function routineClock(time: string, locale: string): string {
  const minutes = routineMinutes(time);
  if (minutes === null) return time;
  try {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(2026, 0, 5, Math.floor(minutes / 60), minutes % 60));
  } catch {
    return time;
  }
}

/** A day of the week by its name in the language; 2026-01-04 was a Sunday. */
export function routineDayName(day: RoutineDay, locale: string, width: "short" | "long" = "short"): string {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: width }).format(new Date(2026, 0, 4 + day));
  } catch {
    return String(day);
  }
}

/** The days of a week in the order this user's week runs. */
export function routineWeek(weekStart: number): RoutineDay[] {
  return [0, 1, 2, 3, 4, 5, 6].map((offset) => ((weekStart + offset) % 7) as RoutineDay);
}

/** "Weekdays 07:00", "Every day 07:00", "Friday 16:00", "Mon, Wed 07:00". */
export function routineScheduleText(t: Translate, schedule: RoutineSchedule, locale: string, weekStart = 1): string {
  const days = schedule.days;
  const named =
    days.length === 7
      ? t("ai.routines.everyDay")
      : days.length === WORKING_DAYS.length && WORKING_DAYS.every((day) => days.includes(day))
        ? t("ai.routines.weekdays")
        : days.length === 1
          ? routineDayName(days[0]!, locale, "long")
          : routineWeek(weekStart)
              .filter((day) => days.includes(day))
              .map((day) => routineDayName(day, locale))
              .join(", ");
  return t("ai.routines.schedule", { days: named, time: routineClock(schedule.time, locale) });
}

/** A moment near now, as one says it: "today 07:02", "Mon 07:00", "12 Oct 07:00". */
export function routineWhen(moment: Date, now: Date, locale: string): string {
  const clock = routineClock(`${String(moment.getHours()).padStart(2, "0")}:${String(moment.getMinutes()).padStart(2, "0")}`, locale);
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((day(moment) - day(now)) / 86_400_000);
  try {
    if (Math.abs(diff) <= 1) return `${new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(diff, "day")} ${clock}`;
    if (Math.abs(diff) <= 6) return `${new Intl.DateTimeFormat(locale, { weekday: "short" }).format(moment)} ${clock}`;
    return `${new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(moment)} ${clock}`;
  } catch {
    return clock;
  }
}

/** "now", as the language says it: when a routine runs whose moment has come — at the next look, once nothing else is running. */
export function routineSoon(locale: string): string {
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "second");
  } catch {
    return "…";
  }
}

/** A skill a routine can run: active on this device, and one that only reads. */
export interface RoutineSkillOption {
  id: string;
  title: string;
  /** The skill's own request — what a routine says when its own sentence is left empty. */
  request: string;
}

export function routineSkillOptions(t: Translate, entries: readonly InstructionEntry[]): RoutineSkillOption[] {
  return entries
    .filter((entry) => entry.status === "active" && entry.source.kind === "skill" && entry.source.skill && routineSkillFits(entry.source.skill))
    .map((entry) => {
      const view = skillView(t, entry);
      return { id: view.id, title: view.title, request: view.start };
    });
}

/**
 * The folders a routine can keep the log of (plan P8-2), as the vault's index
 * knows them: each once, sorted, none of the hidden roots — and the one a
 * routine names already, where the index no longer has it, so that what was
 * set up stays what is shown. The vault itself (`""`) is the form's own
 * first choice and is not in this list.
 */
export function routineLogFolders(folders: readonly string[], current: string | null = null): string[] {
  const kept = new Set<string>();
  for (const folder of folders) {
    const valid = logFolder(folder);
    if (valid) kept.add(valid);
  }
  if (current) kept.add(current);
  return [...kept].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0));
}

/** A model a routine can be given: one of the profiles of this device. */
export interface RoutineModelOption {
  /** `providerId/model` — what the select holds. */
  value: string;
  label: string;
  choice: ModelChoice;
}

export const routineChoiceKey = (choice: ModelChoice) => `${choice.providerId}/${choice.model}`;

/**
 * The profiles that name a model, each once; and the routine's own choice
 * where no profile names it any more — it stays what the routine was
 * confirmed with until its user changes it.
 */
export function routineModelOptions(t: Translate, settings: Pick<AiAppSettings, "profiles" | "custom">, current: ModelChoice | null = null): RoutineModelOption[] {
  const options: RoutineModelOption[] = [];
  const seen = new Set<string>();
  const label = (choice: ModelChoice) => providerById(choice.providerId, settings.custom)?.label ?? choice.providerId;
  for (const profile of AI_PROFILE_IDS) {
    const choice = settings.profiles[profile];
    if (!choice || seen.has(routineChoiceKey(choice))) continue;
    seen.add(routineChoiceKey(choice));
    options.push({ value: routineChoiceKey(choice), choice: { providerId: choice.providerId, model: choice.model }, label: t("ai.routines.form.profile", { profile: t(`ai.profile.${profile}`), provider: label(choice), model: choice.model }) });
  }
  if (current && !seen.has(routineChoiceKey(current))) options.push({ value: routineChoiceKey(current), choice: current, label: `${label(current)} · ${current.model}` });
  return options;
}

/** One routine as a row of the list. */
export interface RoutineRow {
  id: string;
  name: string;
  /** When, which skill, which model. */
  line: string;
  /** How the last run ended and when the next stands — or, instead, what it needs. */
  status: string;
  /** It rests or needs its user: the row leads to the confirmation instead of only saying when it runs next. */
  need: RoutineNeed | null;
  paused: boolean;
  running: boolean;
}

/**
 * What a routine needs from its user right now, as far as the device can
 * tell without running it: the skill is gone, off, no longer one that only
 * reads, or changed since the routine was confirmed; the model's provider
 * is gone or has no key here; the device is fully local and the model is not
 * on it; the device asks before every request and the model is not on it.
 * What only a run can find — more would go than was confirmed, or the rules
 * keep a folder's log from its model — is what the last run says, until the
 * routine is confirmed again. A folder's log names no skill, so it needs none.
 */
export function routineNeed(
  routine: Routine,
  entries: readonly InstructionEntry[],
  settings: Pick<AiAppSettings, "custom" | "localOnly" | "confirmEveryRequest">,
  keys: Readonly<Record<string, boolean>> | null = null,
): RoutineNeed | null {
  if (!routine.log) {
    const entry = entries.find((candidate) => candidate.source.id === routine.skill);
    if (!entry || entry.status !== "active" || !entry.source.skill || !routineSkillFits(entry.source.skill) || routineSkillHash(entry.source) !== routine.skillHash) return "skill";
  }
  const provider = providerById(routine.choice.providerId, settings.custom);
  if (!provider || (keys !== null && provider.endpoint.needsKey && !keys[provider.id])) return "model";
  const here = choiceOnDevice(settings, routine.choice);
  if (settings.localOnly && !here) return "local";
  if (settings.confirmEveryRequest && !here) return "confirm";
  const found = routine.last?.outcome === "needs-you" ? routine.last.need : undefined;
  return found === "scope" || found === "rules" ? found : null;
}

function lastText(t: Translate, routine: Routine, now: Date, locale: string): string {
  const last = routine.last;
  if (!last) return t("ai.routines.last.never");
  const when = routineWhen(new Date(last.at), now, locale);
  switch (last.outcome) {
    case "answered":
      // A folder's log leaves an entry in its file, not a note of its own.
      return routine.log ? t("ai.routines.last.logged", { when, file: last.noteTitle ?? folderLogPath(routine.log.folder) }) : t("ai.routines.last.answered", { when, note: last.noteTitle ?? "" });
    case "unchanged":
      return t("ai.routines.last.unchanged", { when });
    case "stopped":
      return t("ai.routines.last.stopped", { when });
    case "failed":
      return t("ai.routines.last.failed", { when, reason: t(`ai.routines.reason.${last.failure ?? "other"}`) });
    case "needs-you":
      return t("ai.routines.last.needed", { when });
  }
}

export function routineRows(
  t: Translate,
  input: {
    list: readonly Routine[];
    running: { id: string } | null;
    entries: readonly InstructionEntry[];
    settings: Pick<AiAppSettings, "custom" | "localOnly" | "confirmEveryRequest">;
    /** Which providers have a key on this device; absent, a missing key shows only when a run found it. */
    keys?: Readonly<Record<string, boolean>>;
  },
  now: Date,
  locale: string,
  weekStart = 1,
): RoutineRow[] {
  return input.list.map((routine) => {
    const entry = routine.log ? undefined : input.entries.find((candidate) => candidate.source.id === routine.skill);
    // What it does: its skill — or, for a folder's log, the file it keeps.
    const skill = routine.log ? folderLogPath(routine.log.folder) : entry ? skillView(t, entry).title : t("ai.routines.skillGone");
    const provider = providerById(routine.choice.providerId, input.settings.custom)?.label ?? routine.choice.providerId;
    const need = routineNeed(routine, input.entries, input.settings, input.keys ?? null);
    const running = input.running?.id === routine.id;
    // A moment that has come is not named by its day — "yesterday 07:00" is no next run —: it runs now.
    const due = !routine.paused && dueMoment(routine, now) !== null;
    const next = routine.paused || due ? null : nextMoment(routine.schedule, now);
    const upcoming = due ? routineSoon(locale) : next ? routineWhen(next, now, locale) : "";
    const status = running
      ? t("ai.routines.runningNow")
      : need
        ? t(`ai.routines.needs.${need}`)
        : [lastText(t, routine, now, locale), routine.paused ? t("ai.routines.paused") : upcoming ? t("ai.routines.next", { when: upcoming }) : ""].filter(Boolean).join(" · ");
    return {
      id: routine.id,
      name: routine.name,
      line: t("ai.routines.line", { schedule: routineScheduleText(t, routine.schedule, locale, weekStart), skill, provider, model: routine.choice.model }),
      status,
      need: running ? null : need,
      paused: routine.paused,
      running,
    };
  });
}
