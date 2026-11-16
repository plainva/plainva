import { isLocalStoreBusy, isRequestSendFailure, type PimSyncProblem } from "@plainva/core";
import { classifyAuthError } from "../lib/authErrors";
import { withoutUrlPaths } from "../services/pimCycleReport";

/**
 * The line above the calendar (plan Befunde 2026-10-06, K1).
 *
 * A calendar that is not being synced used to look exactly like one that is:
 * the events stayed (or, before this plan, did not), a chip in the corner said
 * "Sync error" and the reason sat in a tooltip. The line says it in a
 * sentence — which account or calendar, since when, and why — and both shells
 * build it here, so the desktop and the phone cannot word it differently.
 *
 * Pure: the problems come from `PimCacheRepository.listSyncProblems()`, the
 * translator and the clock are passed in.
 */

/** How many are spelled out; the rest are counted. A person with twelve
 * calendars on one dead server needs the reason once, not twelve times. */
export const SYNC_PROBLEM_LINES = 3;

export interface SyncProblemLine {
  /** Stable per account/calendar — a React key and a test handle. */
  key: string;
  text: string;
}

export interface SyncProblemNotice {
  lines: SyncProblemLine[];
  /** Problems beyond the lines shown. */
  more: number;
}

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** What a `tasknotes:` row says (B2): the task reconciler's own reason, as a code the line translates. */
export const TASK_NOTE_PROBLEM_PREFIX = "plainva:task-note:";

/** Why, in a sentence. A reason this cannot name is shown in the provider's own
 * words — shortened and without the path of any address, never withheld. */
export function syncProblemReason(problem: PimSyncProblem, t: Translate): string {
  if (problem.signIn) return t("pim.problemSignIn");
  // What the task reconciler could not carry into the notes (B2): Plainva's
  // own reason, said in the reader's language.
  if (problem.error.startsWith(TASK_NOTE_PROBLEM_PREFIX)) {
    const code = problem.error.slice(TASK_NOTE_PROBLEM_PREFIX.length);
    if (code === "no-done-column") return t("pim.problemTaskNoDoneColumn");
    if (code === "no-due-column") return t("pim.problemTaskNoDueColumn");
    // The ways the reconcile could not start or create: each used to leave
    // the lists empty in silence (issue 172).
    if (code === "no-task-db") return t("pim.problemTaskNoDatabase");
    if (code === "task-db-unreadable") return t("pim.problemTaskDatabaseUnreadable");
    if (code === "task-db-no-folder") return t("pim.problemTaskDatabaseNoFolder");
    if (code === "not-created") return t("pim.problemTaskNotCreated");
    if (code === "no-index") return t("pim.problemTaskNoIndex");
    return t("pim.problemTaskNotWritten");
  }
  if (isLocalStoreBusy(problem.error)) return t("pim.problemBusy");
  if (isRequestSendFailure(problem.error) || classifyAuthError(problem.error) === "network") return t("pim.problemNoAnswer");
  const raw = withoutUrlPaths(problem.error).split("\n")[0]!.trim();
  const text = raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/** The clock time for today, date and time for any other day. */
export function syncProblemSince(since: number, locale: string, now: number): string {
  const then = new Date(since);
  const today = new Date(now);
  const sameDay = then.getFullYear() === today.getFullYear() && then.getMonth() === today.getMonth() && then.getDate() === today.getDate();
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat(locale, options).format(then);
  } catch {
    return new Intl.DateTimeFormat("en", options).format(then);
  }
}

/**
 * The problems one surface has to name (B2, 19.10.). The calendar is about
 * events: its accounts and its calendars. The task views are about tasks:
 * the accounts again — an account that does not sign in has neither — and
 * the task lists. A task list that fails used to leave no line anywhere.
 */
export function syncProblemsFor(problems: readonly PimSyncProblem[], surface: "calendar" | "tasks"): PimSyncProblem[] {
  return problems.filter((p) => (surface === "calendar" ? p.taskListId === undefined : p.calendarId === undefined));
}

export function describeSyncProblems(
  problems: readonly PimSyncProblem[],
  t: Translate,
  locale: string,
  now: number = Date.now()
): SyncProblemNotice | null {
  if (problems.length === 0) return null;
  const lines = problems.slice(0, SYNC_PROBLEM_LINES).map((p) => {
    // A calendar or list is named WITH its account: "Team" exists in three of them.
    const name =
      p.calendarName !== undefined
        ? `${p.calendarName} (${p.accountLabel})`
        : p.taskListName !== undefined
          ? `${p.taskListName} (${p.accountLabel})`
          : p.taskListId === ""
            ? t("pim.taskListsOf", { account: p.accountLabel })
            : p.accountLabel;
    const reason = syncProblemReason(p, t);
    // A task list's line speaks of tasks: "the events below" would be wrong there.
    const tasks = p.taskListId !== undefined;
    // A list that syncs but cannot write into its notes is not "not synced".
    const text = p.error.startsWith(TASK_NOTE_PROBLEM_PREFIX)
      ? t("pim.taskNotesNotCarried", { name, reason })
      : p.since === null
        ? t(tasks ? "pim.taskListNotSyncedYet" : "pim.notSyncedYet", { name, reason })
        : t(tasks ? "pim.taskListNotSyncedSince" : "pim.notSyncedSince", { name, since: syncProblemSince(p.since, locale, now), reason });
    const scope = p.error.startsWith(TASK_NOTE_PROBLEM_PREFIX) ? "tasknotes" : "tasks";
    return { key: `${p.accountId}/${p.calendarId ?? ""}${tasks ? `/${scope}/${p.taskListId}` : ""}`, text };
  });
  return { lines, more: Math.max(0, problems.length - SYNC_PROBLEM_LINES) };
}

/**
 * The task-list lines of one account, for its card in the settings (issue
 * 172): a list switched on there that does not reach the notes says why right
 * under the switch, not only in the tasks area. Only the `tasknotes:` lines:
 * a listing or pull that failed already has the card's own banner, and one
 * cause gets one notice.
 */
export function taskListProblemsOf(problems: readonly PimSyncProblem[], accountId: string): PimSyncProblem[] {
  return problems.filter((p) => p.accountId === accountId && p.taskListId !== undefined && p.error.startsWith(TASK_NOTE_PROBLEM_PREFIX));
}

/** True when a line asks for a standard task database: the card then offers to create one. */
export function needsTaskDatabase(problems: readonly PimSyncProblem[]): boolean {
  return problems.some((p) => p.error === `${TASK_NOTE_PROBLEM_PREFIX}no-task-db`);
}

/**
 * The problems for the yellow notice: everything but the lines that only say
 * "no standard task database". Those are no fault and get the quiet
 * `TaskDatabaseHint` instead, once, not one warning per list (issue 172).
 */
export function withoutTaskDatabaseLines(problems: readonly PimSyncProblem[]): PimSyncProblem[] {
  return problems.filter((p) => p.error !== `${TASK_NOTE_PROBLEM_PREFIX}no-task-db`);
}
