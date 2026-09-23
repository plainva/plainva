import { calendarDay } from "./today";
import type { PlannerRow, TaskPriority } from "./taskPlanner";

/**
 * What a home-screen widget gets to see (plan Widgets, W1/E2).
 *
 * A widget cannot compute anything. There is no JavaScript running when the
 * app is closed, so the Today screen's arithmetic — which task is due, which
 * appointment is next — is simply not available to it. Everything a widget
 * shows therefore has to be written down by the app while it was last open:
 * this is that snapshot, and the native side only reads it.
 *
 * Three rules follow from that, and they are the whole design:
 *
 * 1. **Seven days of supply.** Someone who does not open Plainva for two days
 *    must still see something true on Wednesday. The snapshot carries the
 *    overdue count plus the next week, and the widget works out "today" from
 *    the day keys itself — so it turns the page at midnight without the app.
 * 2. **No note text and no path.** A row carries a title, a day, a time, a
 *    priority and an index. The index is how a tap says which row it means;
 *    resolving it back to a note is the app's job, because a home screen is a
 *    place other people look at.
 * 3. **Locked means empty.** A sealed workspace writes a snapshot with no
 *    rows at all, not a snapshot the widget is asked to hide. A file that
 *    never held the titles cannot leak them.
 *
 * The few fixed words travel in the app's language; dates and times are
 * formatted natively, in the system's language, because that is what the rest
 * of the home screen does.
 */

/** Bumped when the shape changes; a native reader that sees a higher one shows "open Plainva". */
export const WIDGET_SNAPSHOT_VERSION = 1;

/** How many days of supply the snapshot carries beyond today. */
export const WIDGET_SNAPSHOT_DAYS = 7;

/** The ceiling on rows — a widget shows a handful; the rest is ballast in a file two processes read. */
export const WIDGET_SNAPSHOT_MAX_ROWS = 60;

export type WidgetRowKind = "task" | "event";

export interface WidgetRow {
  /**
   * Position in this snapshot, from 0. A tap travels as
   * `com.plainva.app://widget/open/<index>`; the app resolves it against the
   * snapshot it last wrote. Never a title, never a path.
   */
  index: number;
  kind: WidgetRowKind;
  /** Empty when the device asked for counters only (E4). */
  title: string;
  /** Day key `YYYY-MM-DD`. */
  day: string;
  /** Minutes after midnight, or null for something that has no time of day. */
  minutes: number | null;
  /** 0 = none, 3 = highest. Events carry 0. */
  priority: TaskPriority;
  /** A task that has been ticked in the widget and is waiting for the app (E3). */
  pending?: boolean;
}

export interface WidgetSnapshot {
  version: number;
  /** When the app wrote this, as an epoch in ms — the widget's "as of" line. */
  writtenAt: number;
  /** The vault this belongs to, for the widget's header. */
  vaultName: string;
  /** A sealed workspace: no rows, and the widget says so instead of showing nothing. */
  locked: boolean;
  /** How many tasks are due before today. A number, never a list. */
  overdue: number;
  rows: WidgetRow[];
  /** The handful of words the widget shows, in the app's language. */
  labels: WidgetLabels;
}

/**
 * Where a row leads — deliberately NOT part of the snapshot.
 *
 * The snapshot file is read by another process and drawn on a screen other
 * people look at, so it carries an index and never a path. The app keeps the
 * matching paths in its own private storage, in the same order and of the same
 * length, and that is how a tap on row 3 becomes a note.
 */
export interface WidgetRowRef {
  path: string;
  /** Checkbox ordinal inside the note; absent for a database row. */
  ordinal?: number;
}

/** What the builder answers: the file, and the paths that stay behind. */
export interface WidgetSnapshotResult {
  snapshot: WidgetSnapshot;
  /** Parallel to `snapshot.rows`; null where a row is an appointment. */
  refs: (WidgetRowRef | null)[];
}

export interface WidgetLabels {
  today: string;
  overdue: string;
  empty: string;
  locked: string;
  pending: string;
  newTask: string;
  newJournal: string;
}

export interface WidgetSnapshotInput {
  vaultName: string;
  /** Sealed and not unlocked: nothing but the lock notice travels. */
  locked?: boolean;
  /** The planner's rows — the same ones the tasks view shows. */
  tasks?: readonly PlannerRow[];
  /** Appointments, already flattened to a day and a time by the caller. */
  events?: readonly WidgetEventInput[];
  /** Device setting (E4): off = counters only, no titles leave the app. */
  showTitles?: boolean;
  /** Device setting: appointments may be left out entirely. */
  showEvents?: boolean;
  labels: WidgetLabels;
  /** Injected in tests; the vault's own clock otherwise. */
  now?: Date;
}

export interface WidgetEventInput {
  title: string;
  /** Day key `YYYY-MM-DD`. */
  day: string;
  /** Minutes after midnight; null for an all-day appointment. */
  minutes: number | null;
}

const OPEN_STATES = new Set(["open", "progress"]);

/** `YYYY-MM-DD` plus `days`, on the calendar rather than on a timestamp. */
function dayPlus(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return calendarDay(new Date(year, (month ?? 1) - 1, (date ?? 1) + days, 12));
}

/**
 * A row's rank within its day: what someone glancing at a home screen wants at
 * the top. Timed things before untimed ones (they are the ones that pass),
 * earlier before later, then priority, then tasks before appointments — a task
 * is something you do, an appointment is something that happens.
 */
function rank(row: WidgetRow): number[] {
  return [
    row.minutes === null ? 1 : 0,
    row.minutes ?? 0,
    3 - row.priority,
    row.kind === "task" ? 0 : 1,
  ];
}

function compareRows(a: WidgetRow, b: WidgetRow): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  const left = rank(a);
  const right = rank(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/**
 * Builds the snapshot, and beside it the paths that must not be in it. Pure:
 * the same input gives the same file, which is what makes it testable and what
 * keeps the native side free of judgement calls.
 */
export function buildWidgetSnapshot(input: WidgetSnapshotInput): WidgetSnapshotResult {
  const now = input.now ?? new Date();
  const labels = input.labels;
  const base: WidgetSnapshot = {
    version: WIDGET_SNAPSHOT_VERSION,
    writtenAt: now.getTime(),
    vaultName: input.vaultName,
    locked: input.locked === true,
    overdue: 0,
    rows: [],
    labels,
  };
  // A locked workspace writes an EMPTY snapshot, not a full one the widget is
  // trusted to hide: the file is read by another process, and a file that
  // never held the titles cannot leak them.
  if (base.locked) return { snapshot: base, refs: [] };

  const today = calendarDay(now);
  const last = dayPlus(today, WIDGET_SNAPSHOT_DAYS);
  const withTitles = input.showTitles !== false;

  const open = (input.tasks ?? []).filter((task) => OPEN_STATES.has(task.state) && task.due);
  base.overdue = open.filter((task) => task.due! < today).length;

  // Row and ref travel together until the cut, so the two lists cannot drift
  // apart — which they would the moment anyone rebuilt the mapping afterwards.
  const draft: { row: Omit<WidgetRow, "index">; ref: WidgetRowRef | null }[] = [];
  for (const task of open) {
    const day = task.due!;
    if (day < today || day > last) continue;
    draft.push({
      row: {
        kind: "task",
        title: withTitles ? task.title : "",
        day,
        minutes: task.dueMinutes,
        priority: task.priority,
      },
      ref: task.ordinal === undefined ? { path: task.path } : { path: task.path, ordinal: task.ordinal },
    });
  }
  if (input.showEvents !== false) {
    for (const event of input.events ?? []) {
      if (event.day < today || event.day > last) continue;
      draft.push({
        row: {
          kind: "event",
          title: withTitles ? event.title : "",
          day: event.day,
          minutes: event.minutes,
          priority: 0,
        },
        // An appointment lives at the provider, not in a note.
        ref: null,
      });
    }
  }

  // Sorted first, THEN cut: the ceiling must drop the far end of the week, not
  // an arbitrary handful of whatever the caller happened to pass first.
  draft.sort((a, b) => compareRows({ ...a.row, index: 0 }, { ...b.row, index: 0 }));
  const kept = draft.slice(0, WIDGET_SNAPSHOT_MAX_ROWS);
  base.rows = kept.map(({ row }, index) => ({ ...row, index }));
  return { snapshot: base, refs: kept.map(({ ref }) => ref) };
}

/** The snapshot as the bytes the bridge writes. */
export function serializeWidgetSnapshot(snapshot: WidgetSnapshot): string {
  return JSON.stringify(snapshot);
}

/**
 * Reads a snapshot back — used by the app to resolve `widget/open/<index>`,
 * and by the tests. A file from a newer version, or one that does not parse,
 * answers `null`: the caller then opens the app rather than guessing.
 */
export function parseWidgetSnapshot(raw: string): WidgetSnapshot | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<WidgetSnapshot>;
  if (snapshot.version !== WIDGET_SNAPSHOT_VERSION) return null;
  if (!Array.isArray(snapshot.rows)) return null;
  return snapshot as WidgetSnapshot;
}

/** One ticked-in-the-widget task, as the native queue holds it (E3). */
export interface WidgetPendingAction {
  /** Which row of the snapshot named below. */
  index: number;
  /** The snapshot this index belongs to; a stale action is dropped rather than applied to the wrong row. */
  snapshotAt: number;
  /** When the tap happened. */
  at: number;
}

/**
 * Which actions still mean something, and which are stale.
 *
 * An index only means a row within ONE snapshot. If the app wrote a new one
 * between the tap and the app opening — a sync ran, a task was added — the
 * index may now point at a different row, and applying it would tick the wrong
 * task. Such an action is dropped, silently: the alternative is a dialogue
 * about a tap someone made yesterday on a home screen.
 *
 * Generic on purpose: the native queue puts an id on each order so that
 * clearing it can name the ones it drops, and the caller gets its own rows
 * back rather than a copy stripped down to this model.
 */
export function usableWidgetActions<T extends WidgetPendingAction>(
  actions: readonly T[],
  snapshot: WidgetSnapshot | null,
): T[] {
  if (!snapshot) return [];
  const seen = new Set<number>();
  const out: T[] = [];
  for (const action of actions) {
    if (action.snapshotAt !== snapshot.writtenAt) continue;
    const row = snapshot.rows[action.index];
    if (!row || row.kind !== "task") continue;
    // The same row tapped twice is one tick, not two.
    if (seen.has(action.index)) continue;
    seen.add(action.index);
    out.push(action);
  }
  return out;
}
