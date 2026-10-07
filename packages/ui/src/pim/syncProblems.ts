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

/** Why, in a sentence. A reason this cannot name is shown in the provider's own
 * words — shortened and without the path of any address, never withheld. */
export function syncProblemReason(problem: PimSyncProblem, t: Translate): string {
  if (problem.signIn) return t("pim.problemSignIn");
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

export function describeSyncProblems(
  problems: readonly PimSyncProblem[],
  t: Translate,
  locale: string,
  now: number = Date.now()
): SyncProblemNotice | null {
  if (problems.length === 0) return null;
  const lines = problems.slice(0, SYNC_PROBLEM_LINES).map((p) => {
    // A calendar is named WITH its account: "Team" exists in three of them.
    const name = p.calendarName !== undefined ? `${p.calendarName} (${p.accountLabel})` : p.accountLabel;
    const reason = syncProblemReason(p, t);
    const text =
      p.since === null
        ? t("pim.notSyncedYet", { name, reason })
        : t("pim.notSyncedSince", { name, since: syncProblemSince(p.since, locale, now), reason });
    return { key: `${p.accountId}/${p.calendarId ?? ""}`, text };
  });
  return { lines, more: Math.max(0, problems.length - SYNC_PROBLEM_LINES) };
}
