import type { DevicePimPort } from "@plainva/core";
import { withoutUrlPaths } from "./pimCycleReport";

/**
 * Diagnostics for the way from a task in Plainva to the provider's list and
 * back (plan Befunde 2026-10-06, T4).
 *
 * Two TestFlight reports call the reminders on the iPhone unreliable or slow,
 * and nothing on record could say which part of the way was meant: the cycle
 * that asks the provider is logged (`formatPimCycle`), but what the reconciler
 * did with the answer, and what the device's store answered when it was
 * written to, was only ever a `console.warn` nobody can export. These lines
 * close that: one per reconcile that did or refused something, one per call
 * into the device's calendar and reminder store.
 *
 * Still no data: counts and durations, never a title, a list name or a note
 * path. An error keeps the provider's words minus the path of every address in
 * them; secrets are taken out by `logDiagnostic` itself.
 */

/** What a reconcile reports; the shape `runTaskSync` returns, read loosely. */
export interface TaskSyncReport {
  createdNotes: readonly string[];
  changedNotes: readonly string[];
  adoptedNotes: readonly string[];
  deferredCreates: number;
  pushed: number;
  conflicts: number;
  deletedRemote: number;
  deletedNotes: readonly string[];
  errors: readonly string[];
  paused?: boolean;
}

/** Why a reconcile did not run at all. */
export type TaskSyncSkip = "no task database" | "no index" | "already running, queued";

/**
 * The line for one reconcile, or null when it had nothing to do and nothing to
 * complain about - the common case every two minutes, which would otherwise
 * push everything else out of a 200-line buffer.
 */
export function formatTaskSync(result: TaskSyncReport, ms: number, mayCreateNotes: boolean): string | null {
  if (result.paused) return "paused (task notes are being renamed)";
  const counts: Array<[string, number]> = [
    ["pushed to provider", result.pushed],
    ["notes created", result.createdNotes.length],
    ["notes changed", result.changedNotes.length],
    ["notes adopted", result.adoptedNotes.length],
    ["deleted at provider", result.deletedRemote],
    ["notes deleted", result.deletedNotes.length],
    ["conflicts", result.conflicts],
    ["creations deferred", result.deferredCreates],
  ];
  const said = counts.filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`);
  if (said.length === 0 && result.errors.length === 0) return null;
  const parts = [`${Math.round(ms)} ms`, ...said];
  // A deferred creation is only explained by this flag: the vault was still
  // filling up, so importing now would have made duplicates.
  if (result.deferredCreates > 0 && !mayCreateNotes) parts.push("vault not settled yet");
  if (result.errors.length > 0) {
    parts.push(`${result.errors.length} error${result.errors.length === 1 ? "" : "s"}: ${withoutUrlPaths(result.errors[0]!)}`);
  }
  return parts.join(", ");
}

/**
 * The device's store with a stopwatch on every call that matters for the
 * question "did it arrive, and how long did the system take": reading a list,
 * and every write. The line names the operation, the duration and the answer -
 * for a read the number of records, for a failed call the system's message.
 *
 * Event reads are left alone: they run once per calendar and cycle and are
 * already counted by the cycle line.
 */
export function timedDevicePimPort(
  port: DevicePimPort,
  log: (line: string) => void,
  now: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
): DevicePimPort {
  const timed = async <T>(what: string, call: () => Promise<T>, answer: (value: T) => string): Promise<T> => {
    const started = now();
    try {
      const value = await call();
      log(`${what}: ${Math.round(now() - started)} ms, ${answer(value)}`);
      return value;
    } catch (e) {
      log(`${what}: ${Math.round(now() - started)} ms, refused: ${withoutUrlPaths(e instanceof Error ? e.message : String(e))}`);
      throw e;
    }
  };
  const ok = () => "ok";
  return {
    supportsReminders: port.supportsReminders,
    listCollections: () => port.listCollections(),
    events: (calendarId, fromTs, toTs) => port.events(calendarId, fromTs, toTs),
    event: (handle) => port.event(handle),
    createEvent: (calendarId, draft) => timed("event create", () => port.createEvent(calendarId, draft), ok),
    updateEvent: (handle, draft) => timed("event update", () => port.updateEvent(handle, draft), ok),
    deleteEvent: (handle) => timed("event delete", () => port.deleteEvent(handle), ok),
    reminders: (listId) => timed("reminders read", () => port.reminders(listId), (list) => `${list.length} item${list.length === 1 ? "" : "s"}`),
    reminder: (id) => timed("reminder read", () => port.reminder(id), (r) => (r ? "found" : "not found")),
    createReminder: (listId, draft) => timed("reminder create", () => port.createReminder(listId, draft), ok),
    updateReminder: (id, draft) => timed("reminder update", () => port.updateReminder(id, draft), ok),
    deleteReminder: (id) => timed("reminder delete", () => port.deleteReminder(id), ok),
  };
}
