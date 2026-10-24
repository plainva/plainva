import { sha256Hex, utf8Encode } from "../workspace/encoding.js";
import type { ApprovedScope } from "./context/manifest.js";
import { logFolder } from "./folderLog.js";
import type { RunLimits, RunStop } from "./orchestrator.js";
import type { ModelChoice } from "./registry.js";
import type { InstructionSource } from "./skills/sources.js";
import type { SkillDefinition } from "./skills/skillFile.js";
import { toolByName } from "./tools.js";

/**
 * Routines (plan KI-Harness P8, §20; ADR 0033): a skill the app starts at a
 * time its user set, with nobody at the keyboard. Such a run gets less than a
 * run a person starts — it only reads, it has a smaller budget, and where it
 * would need a yes that nobody is there to give, it stops and says so. What
 * it leaves is a note.
 *
 * This module is the part without IO: what a routine is, what it may carry,
 * when one is due, and how the list of them is read back. A routine belongs
 * to the device it was set up on — it is kept in the app's data per vault,
 * never in the vault, or every device that syncs the vault would run it and
 * write the same note.
 *
 * Time is the clock its user sees. A schedule names days of the week and a
 * time of day, and a moment is kept as that wall-clock time
 * ("2026-10-09T07:00"), not as an instant: a routine set for seven in the
 * morning runs at seven in the morning wherever the device is. No exact time
 * is promised — the app has no service in the background, so a routine runs
 * at the first tick after its moment while the app is open, and otherwise
 * by the rule it was given for a run that was missed.
 */

/** A day of the week as `Date#getDay` counts it: 0 is Sunday. */
export type RoutineDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface RoutineSchedule {
  /** The days it runs on: sorted, each once, at least one. */
  days: RoutineDay[];
  /** The time of day in the device's own time, "HH:MM". */
  time: string;
}

/** What becomes of a run whose moment passed while the app was closed: one run at the next occasion, or none. */
export type RoutineMissed = "catch-up" | "skip";

/**
 * Why a routine stopped without sending anything: something only its user
 * can decide. `skill`: the skill is gone, switched off, no longer one that
 * only reads, or not as it was confirmed; `scope`: more would go to the
 * model than was confirmed; `confirm`: the device asks before every request;
 * `model`: the model's provider is gone or has no key; `local`: the device is
 * fully local and the model is not on it; `rules`: the user's rules keep the
 * folder of a log from its model.
 */
export type RoutineNeed = "skill" | "scope" | "confirm" | "model" | "local" | "rules";

/**
 * How a run ended. `answered`: the note was written. `unchanged`: nothing in
 * the vault changed since the last note, so no model was asked. `needs-you`:
 * see `RoutineNeed`. `failed`: see `RoutineFailure`. `stopped`: the user
 * pressed STOP.
 */
export type RoutineOutcome = "answered" | "unchanged" | "needs-you" | "failed" | "stopped";

/**
 * Why a run that was sent left no note — a kind, never a text of the
 * provider's: the conversation of the run is in the history and says the
 * rest. `budget`: the run spent what a routine may spend; `declined`: the
 * model declined to answer; `key`: the provider's key is missing or not
 * valid; `unreachable`: the model could not be reached or broke off;
 * `length`: the request did not fit the model; `note`: the answer came, the
 * note could not be written; `other`: anything else.
 */
export type RoutineFailure = "budget" | "declined" | "key" | "unreachable" | "length" | "note" | "other";

export interface RoutineRun {
  /** The moment this run stood for, as the wall-clock time it was set to; a run started by hand names the minute it was started. */
  scheduledFor: string;
  /** When it ended (an instant). */
  at: string;
  outcome: RoutineOutcome;
  need?: RoutineNeed;
  failure?: RoutineFailure;
  /** The note it wrote, by its path in the vault, and under which name. */
  note?: string;
  noteTitle?: string;
}

export interface Routine {
  id: string;
  name: string;
  /** The skill it runs, by the id of its instructions, and what that skill was when the routine was confirmed (`routineSkillHash`). */
  skill: string;
  skillHash: string;
  /** What is said to the skill each time; empty for the skill's own request. */
  request: string;
  schedule: RoutineSchedule;
  missed: RoutineMissed;
  /** Ask no model while no note changed since the last note it left. */
  onlyWhenChanged: boolean;
  /** Who answers, as confirmed. */
  choice: ModelChoice;
  /** What was confirmed to go to that model; null for a model on this device, which is sent nothing that leaves. */
  scope: ApprovedScope | null;
  paused: boolean;
  /** When it was confirmed first (an instant): no moment before that is ever run. */
  createdAt: string;
  /** When it was last taken off pause (an instant): no moment before that is run either — what was paused is not caught up. */
  resumedAt?: string;
  /** When it last left a note (an instant): "only when changed" looks from here. */
  answeredAt?: string;
  /** The conversation of its last run that was sent: the history keeps one per routine, and it makes room for the next. */
  conversationId?: string;
  last?: RoutineRun;
  /**
   * A folder's log instead of a skill (plan P8-2, `folderLog.ts`): the folder
   * whose `log.md` this routine keeps, `""` for the vault itself. Such a
   * routine names no skill and says nothing to one; it looks whether anything
   * changed before every run.
   */
  log?: { folder: string };
}

/**
 * What a run without its user may spend: less than a run a person starts.
 * The output budget is the whole run's — its calls and a reasoning model's
 * thinking come out of it —, so it leaves room for a note of a page.
 */
export const ROUTINE_RUN_LIMITS: RunLimits = { maxSteps: 8, maxToolCalls: 12, maxOutputTokens: 6_000 };
/** More routines than this are not kept: each is a standing permission to ask a model. */
export const ROUTINES_MAX = 20;
/**
 * A routine's name is part of the name of every note it leaves ("<name> – 2026-10-09"), and a note's title is cut at
 * sixty characters: a longer name would lose the day, and with it what tells two runs' notes apart.
 */
export const ROUTINE_NAME_MAX = 40;
export const ROUTINE_REQUEST_MAX = 500;

// ------------------------------------------------------------ what it may carry

/** The tools that find or load something further: a routine carries what its skill names, and nothing it comes across. */
const ROUTINE_NEVER: ReadonlySet<string> = new Set(["find_tools", "call_tool", "use_skill"]);

/**
 * Of these tools, the ones a run without its user may carry: the ones that
 * read. None that proposes, drafts or plans a change, none that moves the
 * app, none whose call is itself a way out (the internet), and none that
 * reaches for further tools. With private notes and a stranger's text in one
 * run and nobody to ask, the third thing — an effect — is never there (the
 * Rule of Two, ADR 0019).
 */
export function routineTools(names: readonly string[]): string[] {
  return names.filter((name) => {
    const tool = toolByName(name);
    return tool !== undefined && tool.risk === "read" && tool.outward !== true && !ROUTINE_NEVER.has(name);
  });
}

/**
 * Whether a skill can be a routine: it names no tool a routine does not
 * carry — a routine does what its skill says, or it is not offered. A skill
 * that names no tools uses whatever a run has; as a routine, what a routine
 * has. A name Plainva does not know is no tool here either way.
 */
export function routineSkillFits(skill: Pick<SkillDefinition, "allowedTools">): boolean {
  const listed = skill.allowedTools;
  if (listed === null) return true;
  const known = listed.filter((name) => toolByName(name) !== undefined);
  return routineTools(known).length === known.length;
}

/**
 * What a skill is, in one value: every file of it by path and hash. A
 * routine is confirmed for this — a skill of the vault that changed since
 * rests its routines until each was looked at again, even after the skill
 * itself was approved anew. A skill that comes with the app is the app's: an
 * update is no change somebody else made, and what a routine may do with it
 * stays what a routine may do.
 */
export function routineSkillHash(source: Pick<InstructionSource, "origin" | "files">): string {
  if (source.origin === "plainva") return "plainva";
  const listed = [...source.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((file) => `${file.path}\n${file.sha256}`);
  return sha256Hex(utf8Encode(listed.join("\n\n")));
}

/** Why a run that ended without an answer left no note. */
export function routineFailureOf(stop: RunStop): RoutineFailure {
  switch (stop.kind) {
    case "limit":
    case "max_tokens":
    case "loop":
    case "circuit_breaker":
      return "budget";
    case "refusal":
      return "declined";
    case "failed":
      switch (stop.failure.kind) {
        case "no_key":
        case "invalid_key":
          return "key";
        case "offline":
        case "stream_broken":
        case "overloaded":
        case "rate_limited":
        case "platform_unavailable":
        case "unknown_endpoint":
        case "not_found":
          return "unreachable";
        case "context_too_long":
        case "window_too_small":
          return "length";
        default:
          return "other";
      }
    default:
      return "other";
  }
}

// ------------------------------------------------------------------- its time

const DAYS: readonly RoutineDay[] = [0, 1, 2, 3, 4, 5, 6];
const isDay = (value: unknown): value is RoutineDay => typeof value === "number" && (DAYS as readonly number[]).includes(value);
const two = (value: number) => String(value).padStart(2, "0");

/** "07:00" as minutes of the day; null for anything that is no time of day written that way. */
export function routineMinutes(time: string): number | null {
  if (time.length !== 5 || time[2] !== ":") return null;
  for (const char of time.slice(0, 2) + time.slice(3)) if (char < "0" || char > "9") return null;
  const hours = Number(time.slice(0, 2));
  const minutes = Number(time.slice(3));
  return hours > 23 || minutes > 59 ? null : hours * 60 + minutes;
}

/** The days of a schedule as they are kept: each once, in the order of the week as `Date` counts it. */
export function routineDays(days: readonly unknown[]): RoutineDay[] {
  return DAYS.filter((day) => days.includes(day));
}

export function isRoutineSchedule(value: unknown): value is RoutineSchedule {
  if (!value || typeof value !== "object") return false;
  const schedule = value as { days?: unknown; time?: unknown };
  return Array.isArray(schedule.days) && schedule.days.length > 0 && schedule.days.every(isDay) && typeof schedule.time === "string" && routineMinutes(schedule.time) !== null;
}

/**
 * A moment as it is kept: the wall-clock time of the device, to the minute
 * ("2026-10-09T07:00"). Two stamps compare as texts.
 */
export function localStamp(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** The schedule's moment on the day `offset` days from `from`, or null when the schedule does not name that day. */
function momentOn(schedule: RoutineSchedule, from: Date, offset: number): Date | null {
  const minutes = routineMinutes(schedule.time);
  if (minutes === null) return null;
  // Built from the calendar's own parts: a day is a day of the calendar, whatever the clocks did in the night.
  const moment = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, Math.floor(minutes / 60), minutes % 60, 0, 0);
  return schedule.days.includes(moment.getDay() as RoutineDay) ? moment : null;
}

/** The latest moment of a schedule that is not after `now`; null for a schedule that names no day. */
export function latestMoment(schedule: RoutineSchedule, now: Date): Date | null {
  for (let back = 0; back <= 7; back++) {
    const moment = momentOn(schedule, now, -back);
    if (moment && moment.getTime() <= now.getTime()) return moment;
  }
  return null;
}

/** The first moment of a schedule after `now`; null for a schedule that names no day. */
export function nextMoment(schedule: RoutineSchedule, now: Date): Date | null {
  for (let ahead = 0; ahead <= 7; ahead++) {
    const moment = momentOn(schedule, now, ahead);
    if (moment && moment.getTime() > now.getTime()) return moment;
  }
  return null;
}

/**
 * The moment a routine is due for now, or null.
 *
 * It is due for the latest moment of its schedule that has passed, when it
 * has not run for that moment yet and the moment is not older than the
 * routine itself — setting a routine up at eight for seven o'clock does not
 * run it at once — nor older than the end of its last pause. However many
 * moments were missed, at most one run follows: with "catch-up" for the
 * latest of them, with "skip" only when that moment was today — yesterday's
 * brief is no use this morning.
 *
 * A run that ended in any way counts for its moment: a routine that needs its
 * user, or failed, does not try again every few minutes.
 */
export function dueMoment(routine: Pick<Routine, "schedule" | "missed" | "paused" | "createdAt" | "resumedAt" | "last">, now: Date): Date | null {
  if (routine.paused) return null;
  const latest = latestMoment(routine.schedule, now);
  if (!latest) return null;
  const stamp = localStamp(latest);
  const stampOf = (instant: string | undefined): string => {
    const date = instant ? new Date(instant) : null;
    return date && !Number.isNaN(date.getTime()) ? localStamp(date) : "";
  };
  // The latest of: the moment it last ran for, when it was set up, when it came off pause. Stamps compare as texts.
  const since = [routine.last?.scheduledFor ?? "", stampOf(routine.createdAt), stampOf(routine.resumedAt)].reduce((a, b) => (a > b ? a : b));
  if (stamp <= since) return null;
  if (routine.missed === "skip" && !sameDay(latest, now)) return null;
  return latest;
}

/** The note a run leaves is called after the routine and the day: "Morning brief – 2026-10-09". */
export function routineNoteTitle(name: string, day: Date): string {
  return `${name} – ${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}`;
}

// ---------------------------------------------------------------- as it is kept

const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() && value.length <= max ? value : null);
const STAMP_LENGTH = "2026-10-09T07:00".length;
const OUTCOMES: readonly RoutineOutcome[] = ["answered", "unchanged", "needs-you", "failed", "stopped"];
const NEEDS: readonly RoutineNeed[] = ["skill", "scope", "confirm", "model", "local", "rules"];
const FAILURES: readonly RoutineFailure[] = ["budget", "declined", "key", "unreachable", "length", "note", "other"];
const isInstant = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && !Number.isNaN(new Date(value).getTime());

function readRun(value: unknown): RoutineRun | undefined {
  if (!value || typeof value !== "object") return undefined;
  const run = value as Record<string, unknown>;
  if (typeof run.scheduledFor !== "string" || run.scheduledFor.length !== STAMP_LENGTH || !isInstant(run.at)) return undefined;
  if (!OUTCOMES.includes(run.outcome as RoutineOutcome)) return undefined;
  return {
    scheduledFor: run.scheduledFor,
    at: run.at,
    outcome: run.outcome as RoutineOutcome,
    ...(NEEDS.includes(run.need as RoutineNeed) ? { need: run.need as RoutineNeed } : {}),
    ...(FAILURES.includes(run.failure as RoutineFailure) ? { failure: run.failure as RoutineFailure } : {}),
    ...(typeof run.note === "string" && run.note.length <= 500 ? { note: run.note } : {}),
    ...(typeof run.noteTitle === "string" && run.noteTitle.length <= 200 ? { noteTitle: run.noteTitle } : {}),
  };
}

const strings = (value: unknown): string[] | null => (Array.isArray(value) && value.every((entry) => typeof entry === "string") ? (value as string[]) : null);

/** A confirmed scope as it was stored, or null when it is none: a routine without a readable scope has to be confirmed again. */
function readScope(value: unknown): ApprovedScope | null {
  if (!value || typeof value !== "object") return null;
  const scope = value as Record<string, unknown>;
  const recipients = strings(scope.recipients);
  const dataClasses = strings(scope.dataClasses);
  const folders = strings(scope.folders);
  const tools = strings(scope.tools);
  if (!recipients || !dataClasses || !folders || !tools || typeof scope.maxTokens !== "number" || !Number.isFinite(scope.maxTokens)) return null;
  const sensitive = strings(scope.sensitive);
  const instructions = strings(scope.instructions);
  return {
    recipients,
    dataClasses: dataClasses as ApprovedScope["dataClasses"],
    folders,
    tools,
    // A routine never reaches the internet, whatever a file says.
    web: false,
    maxTokens: scope.maxTokens,
    ...(sensitive ? { sensitive: sensitive as NonNullable<ApprovedScope["sensitive"]> } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

/**
 * The routines as they were stored. A list that cannot be read is no list;
 * an entry that is not whole is left out — a routine is a standing
 * permission, and half of one is none.
 */
export function readRoutines(value: unknown): Routine[] {
  const list = value && typeof value === "object" && Array.isArray((value as { routines?: unknown }).routines) ? (value as { routines: unknown[] }).routines : [];
  const out: Routine[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (out.length >= ROUTINES_MAX) break;
    if (!entry || typeof entry !== "object") continue;
    const routine = entry as Record<string, unknown>;
    const id = text(routine.id, 80);
    const name = text(routine.name, ROUTINE_NAME_MAX);
    // A folder's log names a folder in place of a skill; one whose folder cannot be read is no routine.
    const kept = routine.log === undefined ? undefined : routine.log && typeof routine.log === "object" ? logFolder((routine.log as { folder?: unknown }).folder) : null;
    if (kept === null) continue;
    const skill = kept === undefined ? text(routine.skill, 300) : "";
    const skillHash = kept === undefined ? text(routine.skillHash, 200) : "";
    const choice = routine.choice as { providerId?: unknown; model?: unknown } | null | undefined;
    if (!id || seen.has(id) || !name || skill === null || skillHash === null || !isRoutineSchedule(routine.schedule)) continue;
    if (!choice || typeof choice.providerId !== "string" || !choice.providerId || typeof choice.model !== "string" || !choice.model) continue;
    if (!isInstant(routine.createdAt)) continue;
    if (typeof routine.request !== "string" || routine.request.length > ROUTINE_REQUEST_MAX) continue;
    seen.add(id);
    const last = readRun(routine.last);
    out.push({
      id,
      name,
      skill,
      skillHash,
      request: routine.request,
      schedule: { days: routineDays(routine.schedule.days), time: routine.schedule.time },
      missed: routine.missed === "skip" ? "skip" : "catch-up",
      onlyWhenChanged: kept !== undefined || routine.onlyWhenChanged === true,
      choice: { providerId: choice.providerId, model: choice.model },
      scope: readScope(routine.scope),
      paused: routine.paused === true,
      createdAt: routine.createdAt,
      ...(isInstant(routine.resumedAt) ? { resumedAt: routine.resumedAt } : {}),
      ...(isInstant(routine.answeredAt) ? { answeredAt: routine.answeredAt } : {}),
      ...(typeof routine.conversationId === "string" && routine.conversationId && routine.conversationId.length <= 200 ? { conversationId: routine.conversationId } : {}),
      ...(last ? { last } : {}),
      ...(kept !== undefined ? { log: { folder: kept } } : {}),
    });
  }
  return out;
}

/** The file the routines of a vault are kept in, in the app's data for that vault. */
export const ROUTINES_FILE = "routines.json";

/** The file's text as it was written, read back; a file that is missing or damaged holds no routine. */
export function parseRoutines(raw: string | null): Routine[] {
  if (raw === null) return [];
  try {
    return readRoutines(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function serializeRoutines(routines: readonly Routine[]): string {
  return JSON.stringify({ version: 1, routines: routines.slice(0, ROUTINES_MAX) });
}

// --------------------------------------------------------- before it is confirmed

/** What a form for a routine holds before it is confirmed. */
export interface RoutineDraft {
  name: string;
  skill: string;
  request: string;
  days: readonly RoutineDay[];
  time: string;
  missed: RoutineMissed;
  onlyWhenChanged: boolean;
  choice: ModelChoice | null;
  /** A folder's log instead of a skill: the folder (`""` is the vault). The skill and the sentence then count for nothing. */
  log?: { folder: string } | null;
}

export type RoutineDraftProblem = "name" | "skill" | "folder" | "days" | "time" | "request" | "model";

/** What keeps a form from being confirmed; empty when it can be. */
export function routineDraftProblems(draft: RoutineDraft): RoutineDraftProblem[] {
  const problems: RoutineDraftProblem[] = [];
  if (!draft.name.trim() || draft.name.trim().length > ROUTINE_NAME_MAX) problems.push("name");
  if (draft.log) {
    if (logFolder(draft.log.folder) === null) problems.push("folder");
  } else if (!draft.skill) problems.push("skill");
  if (routineDays(draft.days).length === 0) problems.push("days");
  if (routineMinutes(draft.time) === null) problems.push("time");
  if (!draft.log && draft.request.length > ROUTINE_REQUEST_MAX) problems.push("request");
  if (!draft.choice || !draft.choice.providerId || !draft.choice.model) problems.push("model");
  return problems;
}

/** The draft a form starts with for a routine that exists. */
export function routineDraftOf(routine: Routine): RoutineDraft {
  return {
    name: routine.name,
    skill: routine.skill,
    request: routine.request,
    days: [...routine.schedule.days],
    time: routine.schedule.time,
    missed: routine.missed,
    onlyWhenChanged: routine.onlyWhenChanged,
    choice: { ...routine.choice },
    ...(routine.log ? { log: { ...routine.log } } : {}),
  };
}
