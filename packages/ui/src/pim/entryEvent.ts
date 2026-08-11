import {
  setFrontmatterPath,
  readFrontmatterPath,
  wikiTargetForPath,
  type IVaultAdapter,
  type PimEventDraft,
  type PimEventRow,
} from "@plainva/core";
import { markdownToHtml } from "../lib/markdownToHtml";
import { splitCalendarKey } from "./taskTimeBlock";

/**
 * Putting a database entry in the calendar for real (S19, plan P9b).
 *
 * "Block time" on a task (issue #34, wave 3) already does this shape, and the
 * hard decisions it made hold here too: the link is written on BOTH ends, each
 * in the form its side can read — the event carries a wiki link in its
 * description (readable in Google Calendar and Outlook as well), the note an
 * anchor in the Obsidian-inert `plainva` namespace. And the EVENT is the
 * delivery: if the anchor cannot be written the function says so rather than
 * hiding an appointment that already exists.
 *
 * It is a DIFFERENT anchor from both neighbours, and the difference is the
 * point rather than tidiness:
 *
 *  - `plainva.pim` belongs to the task reconciler and the meeting note. A
 *    foreign entry there confuses the mirror.
 *  - `plainva.blocks` means "I reserved time for this": many per note, and the
 *    note's own date never moves.
 *  - `plainva.events` means "this entry IS this appointment". That is a
 *    stronger claim, and it is what earns the write-back below: move the
 *    appointment at the provider and the entry's date column follows.
 */

export const ENTRY_EVENT_PATH = ["plainva", "events"] as const;

export interface EntryEventAnchor {
  uid: string;
  account: string;
  calendar: string;
  /** The column the entry's date lives in — so a moved appointment knows what
   * to write back. Without it the write-back would have to guess. */
  dateField: string;
  /** Local start (YYYY-MM-DD, plus HH:MM when the entry carries a time) —
   * human-readable in the properties panel, and the value the write-back
   * compares against. */
  start: string;
}

/** Anchors of one note. Anything malformed is ignored rather than thrown: a
 * hand-edited frontmatter must never break scheduling or deleting. */
export function readEntryEvents(content: string): EntryEventAnchor[] {
  const raw = readFrontmatterPath(content, [...ENTRY_EVENT_PATH]);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is EntryEventAnchor =>
      !!a &&
      typeof a === "object" &&
      typeof (a as EntryEventAnchor).uid === "string" &&
      (a as EntryEventAnchor).uid.length > 0 &&
      typeof (a as EntryEventAnchor).dateField === "string"
  );
}

/** The draft for an entry's appointment. All-day when the entry names no time —
 * an entry that says "the 12th" must not claim to start at nine. Pure. */
export function buildEntryEventDraft(opts: {
  title: string;
  day: string;
  /** Minutes into the day; absent = all-day. */
  minutes?: number;
  durationMinutes?: number;
  noteTarget?: string;
}): PimEventDraft {
  const description = opts.noteTarget ? `[[${opts.noteTarget}]]` : undefined;
  const common = {
    title: opts.title,
    description,
    descriptionHtml: description ? markdownToHtml(description) : undefined,
  };
  if (opts.minutes === undefined) {
    // End date is EXCLUSIVE for all-day events (the calendar core's contract).
    const next = new Date(`${opts.day}T00:00:00`);
    next.setDate(next.getDate() + 1);
    const iso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    return {
      ...common,
      allDay: true,
      start: { ts: Date.parse(`${opts.day}T00:00:00Z`), date: opts.day },
      end: { ts: Date.parse(`${iso}T00:00:00Z`), date: iso },
    };
  }
  const hh = String(Math.floor(opts.minutes / 60)).padStart(2, "0");
  const mm = String(opts.minutes % 60).padStart(2, "0");
  const startTs = new Date(`${opts.day}T${hh}:${mm}:00`).getTime();
  const endTs = startTs + Math.max(5, Math.round(opts.durationMinutes ?? 60)) * 60 * 1000;
  return { ...common, allDay: false, start: { ts: startTs }, end: { ts: endTs } };
}

export interface CreateEntryEventOptions {
  adapter: IVaultAdapter;
  /**
   * Writes the appointment. A CALLBACK, not a provider target, because each
   * shell reaches the calendar its own way — the desktop through its runtime,
   * the phone through `createPimEvent`, which carries the shared write rules
   * (conflict guard, error surface, immediate re-pull). Everything that decides
   * what the LINK means stays here.
   */
  createEvent: (calendarKey: string, draft: PimEventDraft) => Promise<{ uid: string }>;
  /** "<accountId> <calendarId>" as picked. */
  calendarKey: string;
  notePath: string;
  title: string;
  day: string;
  minutes?: number;
  durationMinutes?: number;
  /** The column the entry's date lives in — stored in the anchor. */
  dateField: string;
  allPaths?: string[];
}

export interface CreateEntryEventResult {
  uid: string;
  accountId: string;
  calendarId: string;
  /** False when the appointment exists but the note could not be anchored. A
   * warning, never a failure: the appointment is the delivery. */
  anchored: boolean;
}

export async function createEntryEvent(opts: CreateEntryEventOptions): Promise<CreateEntryEventResult> {
  const key = splitCalendarKey(opts.calendarKey);
  if (!key) throw new Error("no calendar selected");

  const noteTarget = wikiTargetForPath(opts.notePath, opts.allPaths ?? [opts.notePath]);
  const draft = buildEntryEventDraft({
    title: opts.title,
    day: opts.day,
    minutes: opts.minutes,
    durationMinutes: opts.durationMinutes,
    noteTarget,
  });
  const res = await opts.createEvent(opts.calendarKey, draft);

  // `anchored` is decided here and nowhere else: the appointment already
  // exists, so a note that cannot be written is a warning, not a rollback.
  let anchored: boolean;
  try {
    const content = await opts.adapter.readTextFile(opts.notePath);
    const anchor: EntryEventAnchor = {
      uid: res.uid,
      account: key.accountId,
      calendar: key.calendarId,
      dateField: opts.dateField,
      start: opts.minutes === undefined
        ? opts.day
        : `${opts.day} ${String(Math.floor(opts.minutes / 60)).padStart(2, "0")}:${String(opts.minutes % 60).padStart(2, "0")}`,
    };
    // setFrontmatterPath, NOT upsertFrontmatterKeys: the latter replaces the
    // whole `plainva` map and would drop a sibling `plainva.pim` or
    // `plainva.blocks` anchor.
    const next = setFrontmatterPath(content, [...ENTRY_EVENT_PATH], [...readEntryEvents(content), anchor]);
    await opts.adapter.writeTextFile(opts.notePath, next);
    anchored = true;
  } catch {
    anchored = false;
  }

  return { uid: res.uid, accountId: key.accountId, calendarId: key.calendarId, anchored };
}

/** What one note's anchors imply after looking at the loaded events. */
export interface EntryEventReconcile {
  /** The appointment moved: write this day into the entry's date column. */
  moves: { dateField: string; day: string; minutes?: number }[];
  /** Anchors whose appointment is gone at the provider — drop them. The NOTE
   * stays: a deleted appointment is not a deleted entry, and silently removing
   * someone's note because a calendar changed would be indefensible. */
  dropped: EntryEventAnchor[];
  /** The anchors that survive, in order, for writing back. */
  keep: EntryEventAnchor[];
}

/**
 * Compares a note's anchors against the loaded appointments.
 *
 * `known` names the accounts whose events are actually IN `events`, `window`
 * the day range they were loaded for. An anchor of an account that was not
 * loaded — or of a day outside the window — is left alone — "I did not look there" and
 * "it is gone" are different answers, and treating the first as the second
 * would drop anchors every time an account is briefly unreachable. Pure.
 */
export function reconcileEntryEvents(
  anchors: readonly EntryEventAnchor[],
  events: readonly PimEventRow[],
  known: ReadonlySet<string>,
  dayKeyOf: (row: PimEventRow) => string,
  minutesOf: (row: PimEventRow) => number | undefined,
  window?: { startDay: string; endDay: string }
): EntryEventReconcile {
  const byUid = new Map<string, PimEventRow>();
  for (const e of events) byUid.set(`${e.accountId} ${e.uid}`, e);

  const moves: EntryEventReconcile["moves"] = [];
  const dropped: EntryEventAnchor[] = [];
  const keep: EntryEventAnchor[] = [];

  for (const a of anchors) {
    const row = byUid.get(`${a.account} ${a.uid}`);
    if (!row) {
      // Same distinction as the unknown account, one layer down: the cache only
      // holds a WINDOW of the calendar (past 60d / future 400d). An anchor whose
      // own day lies outside it was never looked for, so its absence says
      // nothing. Without this every appointment older than two months would
      // quietly lose its link on the next cycle.
      const outside = window ? a.start.slice(0, 10) < window.startDay || a.start.slice(0, 10) > window.endDay : false;
      if (known.has(a.account) && !outside) dropped.push(a);
      else keep.push(a);
      continue;
    }
    const day = dayKeyOf(row);
    const minutes = minutesOf(row);
    const start = minutes === undefined
      ? day
      : `${day} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    if (start !== a.start) {
      moves.push({ dateField: a.dateField, day, ...(minutes !== undefined ? { minutes } : {}) });
      keep.push({ ...a, start });
    } else {
      keep.push(a);
    }
  }
  return { moves, dropped, keep };
}

/** The date value to write into the entry's column for a move. Keeps the time
 * only when the appointment has one — writing "T00:00" onto an all-day entry
 * would turn a day into a midnight appointment. Pure. */
export function entryDateValue(move: { day: string; minutes?: number }): string {
  if (move.minutes === undefined) return move.day;
  const hh = String(Math.floor(move.minutes / 60)).padStart(2, "0");
  const mm = String(move.minutes % 60).padStart(2, "0");
  return `${move.day}T${hh}:${mm}`;
}
