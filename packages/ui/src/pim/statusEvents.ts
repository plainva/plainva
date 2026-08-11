/**
 * Google's status events, presented as what they are (S24, plan P8b).
 *
 * A working location, a focus-time block and an out-of-office entry all arrive
 * through the same API as appointments, and drawing them as appointments is
 * what makes a calendar unreadable: "Home" is not a meeting, and a day with
 * three status entries and one meeting should not look like four meetings.
 *
 * So the rule is one line long, and both shells share it: a status event does
 * not compete with appointments for the same visual weight. The desktop draws
 * it as a quiet band behind the day; the phone gives it a row with its own mark
 * in the day list, because a list has no behind.
 *
 * Plainva READS these and never writes them. Creating an out-of-office entry
 * has provider-side consequences — Google auto-declines invitations for it —
 * and a calendar view has no business triggering that as a side effect of
 * dragging something.
 */

export type StatusKind = "workingLocation" | "focusTime" | "outOfOffice";

export interface StatusEventLike {
  statusKind?: StatusKind;
  workingLocation?: string;
  title?: string;
}

/** Whether an event is a status entry rather than an appointment. */
export function isStatusEvent(e: StatusEventLike): boolean {
  return e.statusKind !== undefined;
}

/**
 * The i18n key for a status event's label.
 *
 * A working location says WHERE — and Google's two fixed values (`homeOffice`,
 * and an office without a label) deserve words rather than the raw token. A
 * custom label is the user's own text and is shown verbatim.
 */
export function statusLabelKey(e: StatusEventLike): string | null {
  if (e.statusKind === "focusTime") return "pim.statusFocusTime";
  if (e.statusKind === "outOfOffice") return "pim.statusOutOfOffice";
  if (e.statusKind !== "workingLocation") return null;
  if (e.workingLocation === "homeOffice") return "pim.statusHome";
  if (!e.workingLocation) return "pim.statusOffice";
  return null; // a custom label: shown as-is, not translated
}

/** The text to show, given a translator. Falls back to the event's own title. */
export function statusLabel(e: StatusEventLike, t: (key: string) => string): string {
  const key = statusLabelKey(e);
  if (key) return t(key);
  return e.workingLocation || e.title || "";
}

/**
 * Which of the day's status entries to show, in display order.
 *
 * Ordered so the most consequential comes first: being away outranks a focus
 * block, which outranks where one is sitting. Deduplicated by kind and label —
 * Google emits a working location per calendar, and three identical "Home"
 * bands are noise, not information.
 */
const RANK: Record<StatusKind, number> = { outOfOffice: 0, focusTime: 1, workingLocation: 2 };

export function orderStatusEvents<T extends StatusEventLike>(events: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of events) {
    if (!e.statusKind) continue;
    // The separator is an ESCAPE, never a raw byte — a literal NUL makes git
    // treat the file as binary (the encoding guard catches exactly this).
    const key = `${e.statusKind}\u0000${e.workingLocation ?? e.title ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => RANK[a.statusKind!] - RANK[b.statusKind!]);
}

/** Splits a day's events into the two kinds a surface draws differently. */
export function partitionStatus<T extends StatusEventLike>(events: readonly T[]): { appointments: T[]; status: T[] } {
  const appointments: T[] = [];
  const status: T[] = [];
  for (const e of events) (e.statusKind ? status : appointments).push(e);
  return { appointments, status: orderStatusEvents(status) };
}
