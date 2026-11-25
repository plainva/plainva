import { useEffect, useMemo, useSyncExternalStore } from "react";
import { sameStoredValue, type PimEventDraft, type PimEventRow } from "@plainva/core";

/**
 * What the user just did to a calendar event, shown BEFORE the provider has
 * answered (issue 119).
 *
 * `eventWrite.ts` promised "a just-written event appears at once", but its row
 * only existed after the provider call had returned — and the phone threw even
 * that row away and waited for a whole sync cycle. Between the tap on Save and
 * the event on screen there was nothing at all, which is the moment a user
 * decides it did not work and enters it again.
 *
 * So a write has two lives here, and neither shell keeps its own copy of them:
 *
 *  - SENDING: the change is laid over the cached rows at once and marked
 *    `pending`. If the provider refuses, the overlay is dropped and the view is
 *    back where it was — the caller reports why.
 *  - SETTLED: the provider accepted it, but the cache does not know yet (the
 *    cycle that fetches it is still running, or one that started earlier is
 *    about to land and would take the event away again). The overlay stays
 *    until the cached rows agree with it, then it leaves on its own.
 *
 * The overlay is never written to the cache: the cache holds what the provider
 * said, and a cycle arriving mid-flight can neither duplicate an overlaid event
 * (it is matched by its ref once it has one) nor swallow it.
 */

export interface PendingEventRef {
  accountId: string;
  calendarId: string;
  uid: string;
}

export type PendingEventChange =
  | CreatedEventChange
  | { kind: "update"; ref: PendingEventRef; patch: Partial<PimEventRow> }
  | { kind: "delete"; ref: PendingEventRef }
  | EtagStamp;

/**
 * A created event (issue 119). `row` is the event itself - for a series its
 * own row, which the day views never draw. A series is drawn by
 * `occurrences`: the ones the series has, expanded the way a pull expands it
 * (`createChange`), so the screen shows from the start what the next sync
 * shows. `draft` is what the person typed, kept for "Try again" should the
 * provider turn out not to hold the event after all.
 */
export interface CreatedEventChange {
  kind: "create";
  row: PimEventRow;
  occurrences?: PimEventRow[];
  draft?: PimEventDraft;
}

/**
 * The etag a write left an event with (issue 119, R2).
 *
 * Every write changes the etag of what it wrote, and the provider names the
 * new one in its answer. The rows the views hold kept the OLD one until the
 * next pull - so the next delete or edit, sent with it, was refused as
 * "changed elsewhere", and only a second try a minute later went through.
 *
 * A stamp replaces `from` by `etag` on the rows that still carry `from`:
 *
 *  - by `href` where there is one. A CalDAV object holds a whole series, and
 *    its master and every occurrence share its etag - deleting or moving ONE
 *    occurrence leaves all the others behind,
 *  - by the event's ref otherwise (Google and Microsoft give every occurrence
 *    its own etag).
 *
 * A row whose etag is no longer `from` has been pulled since, and the pull is
 * the newer word: the stamp leaves it alone, and leaves altogether once no row
 * carries `from` any more.
 */
export interface EtagStamp {
  kind: "stamp";
  ref: PendingEventRef;
  href?: string;
  /** The etag the write was sent against; `undefined` for a row that had none. */
  from?: string;
  etag: string;
}

export type PendingEventWrite = PendingEventChange & {
  id: number;
  state: "sending" | "settled";
  /** Set when the provider accepted it; a settled overlay does not wait forever. */
  settledAt?: number;
  /** A created event no sync listed yet: when the provider was last asked whether it holds it. */
  checkedAt?: number;
};

/** A cached row as the views show it: `pending` while its write is on the way. */
export type ShownEventRow = PimEventRow & { pending?: true };

/** The uid of an event that has no provider id yet. Never sent anywhere. */
export const PENDING_EVENT_UID_PREFIX = "pending:";

export const isPendingEventUid = (uid: string): boolean => uid.startsWith(PENDING_EVENT_UID_PREFIX);

/**
 * How long a settled overlay waits for the cache to catch up. A provider that
 * accepted a write and then never lists it (a calendar hidden in between, an
 * account switched off) must not leave a ghost on screen.
 *
 * Not for a created event (issue 119): the provider confirmed it holds it, and
 * an event that vanished because a sync had not listed it yet was exactly the
 * report. After this long unlisted it is asked about (`checkUnlistedCreates`)
 * - and asked again every such interval - and leaves only when the provider
 * says it is not there, with a message.
 */
export const SETTLED_EVENT_WRITE_TTL_MS = 3 * 60_000;

const sameRef = (row: PendingEventRef, ref: PendingEventRef): boolean =>
  row.accountId === ref.accountId && row.calendarId === ref.calendarId && row.uid === ref.uid;

/**
 * Whether a row is an occurrence of the series `ref` names (issue 119, R7).
 *
 * "Delete all events" and "change all events" are written against the SERIES -
 * its own row, or its id where the cache lacks that row (`seriesDeleteSubject`).
 * The views never show that row: they show occurrences (`uid#...` on CalDAV,
 * the provider's own ids elsewhere), each carrying the series as
 * `seriesMaster`. Matched by uid alone, a deleted series stood on screen until
 * a pull removed it - and where the first pull after the delete still listed
 * it (a server slow to show its own writes), until the one after. The person
 * saw nothing happen, deleted again, and the second delete "worked".
 */
const occurrenceOf = (row: PimEventRow, ref: PendingEventRef): boolean =>
  !!row.seriesMaster && row.seriesMaster === ref.uid && row.accountId === ref.accountId && row.calendarId === ref.calendarId;

/** A delete or an update reaches the event itself and, for a series, every occurrence of it. */
const reaches = (row: PimEventRow, ref: PendingEventRef): boolean => sameRef(row, ref) || occurrenceOf(row, ref);

/**
 * What a change to a whole series says about each of its occurrences. Not its
 * time: an occurrence keeps its own date, and a new start or rule is known per
 * occurrence only after the provider has expanded the series again - until then
 * the occurrences stay where they were, marked as on their way.
 */
const SERIES_WIDE_FIELDS = ["title", "location", "description", "color", "attendees"] as const satisfies ReadonlyArray<keyof PimEventRow>;

function seriesWidePatch(patch: Partial<PimEventRow>): Partial<PimEventRow> {
  const out: Partial<PimEventRow> = {};
  for (const key of SERIES_WIDE_FIELDS) if (key in patch) (out as Record<string, unknown>)[key] = patch[key];
  return out;
}

/** Whether a stamp speaks about this row: the same object (or event), still at the etag the write replaced. */
const stamps = (row: PimEventRow, stamp: EtagStamp): boolean =>
  (stamp.href
    ? row.accountId === stamp.ref.accountId && row.calendarId === stamp.ref.calendarId && row.href === stamp.href
    : sameRef(row, stamp.ref)) && (row.etag ?? undefined) === stamp.from;

/**
 * Whether the cache lists a created event. A SERIES never appears under its
 * own uid in a day query - the views read occurrences (`uid#…`, carrying the
 * series as `seriesMaster`), and the master row stays out of the grid. Asked by
 * uid alone, a new weekly meeting was "not there yet" for the overlay's whole
 * life and stood on screen twice on its first day (issue 119).
 */
const listsCreated = (rows: readonly PimEventRow[], created: PimEventRow): boolean =>
  rows.some(
    (row) =>
      sameRef(row, created) ||
      (row.accountId === created.accountId && row.calendarId === created.calendarId && row.seriesMaster === created.uid),
  );

// An absent field and a null one are the same statement about a cached row.
const sameValue = (a: unknown, b: unknown): boolean => a === b || sameStoredValue(a ?? null, b ?? null);

/** True when the cached row already carries every field the patch set. */
function patchApplied(row: PimEventRow, patch: Partial<PimEventRow>): boolean {
  return (Object.keys(patch) as Array<keyof PimEventRow>).every((key) => sameValue(row[key], patch[key]));
}

/**
 * The cached rows with every pending write laid over them. `range` is the
 * window the caller shows: a created series is drawn by its occurrences in it
 * (without a window, by all of them the overlay holds).
 */
export function applyPendingEventWrites(
  rows: readonly PimEventRow[],
  writes: readonly PendingEventWrite[],
  range?: { startTs: number; endTs: number },
): ShownEventRow[] {
  if (writes.length === 0) return rows as ShownEventRow[];
  let shown: ShownEventRow[] = rows.slice();
  for (const write of writes) {
    const sending = write.state === "sending";
    if (write.kind === "delete") {
      shown = shown.filter((row) => !reaches(row, write.ref));
    } else if (write.kind === "stamp") {
      shown = shown.map((row) => (stamps(row, write) ? { ...row, etag: write.etag } : row));
    } else if (write.kind === "update") {
      const mark = sending ? { pending: true as const } : {};
      const wide = seriesWidePatch(write.patch);
      shown = shown.map((row) =>
        sameRef(row, write.ref) ? { ...row, ...write.patch, ...mark } : occurrenceOf(row, write.ref) ? { ...row, ...wide, ...mark } : row,
      );
    } else if (!listsCreated(shown, write.row)) {
      // A settled create carries its real uid: once the cache lists that
      // event, the cached row is the one shown and this one steps aside.
      const drawn = write.occurrences
        ? write.occurrences.filter((row) => !range || (row.start.ts < range.endTs && row.end.ts >= range.startTs))
        : [write.row];
      for (const row of drawn) shown.push(sending ? { ...row, pending: true } : row);
    }
  }
  return shown;
}

/** The writes that still have something to say, given what the cache holds now. */
export function unsettledEventWrites(rows: readonly PimEventRow[], writes: readonly PendingEventWrite[], now: number): PendingEventWrite[] {
  return writes.filter((write) => {
    if (write.state === "sending") return true;
    // A created event stays until a sync lists it, or the provider says it
    // is not there (`checkUnlistedCreates`).
    if (write.kind === "create") return !listsCreated(rows, write.row);
    if (now - (write.settledAt ?? now) > SETTLED_EVENT_WRITE_TTL_MS) return false;
    if (write.kind === "stamp") return rows.some((row) => stamps(row, write));
    // A deleted series waits until none of its occurrences is listed (R7).
    if (write.kind === "delete") return rows.some((row) => reaches(row, write.ref));
    const cached = rows.find((row) => sameRef(row, write.ref));
    if (cached) return !patchApplied(cached, write.patch);
    // A changed series whose own row is not among `rows` (the views never hold
    // it): settled once an occurrence carries what the change said about all
    // of them - the pull that brought it brought the whole series.
    const occurrences = rows.filter((row) => occurrenceOf(row, write.ref));
    if (occurrences.length === 0) return false; // An event that left the cache has nothing to patch any more.
    const wide = seriesWidePatch(write.patch);
    return !occurrences.some((row) => patchApplied(row, wide));
  });
}

/**
 * A patch says only what it sets. A draft leaves a field `undefined` to mean
 * "do not touch" (the provider keeps its description, its attendees), and a
 * patch built from such a draft carried those keys along: laid over the cached
 * row they blanked the description on screen, and because the cache never
 * agrees with "undefined" the overlay then stayed until it timed out.
 */
function statedChange(change: PendingEventChange): PendingEventChange {
  if (change.kind !== "update") return change;
  const patch = Object.fromEntries(Object.entries(change.patch).filter(([, value]) => value !== undefined)) as Partial<PimEventRow>;
  return { ...change, patch };
}

export class PendingEventWrites {
  private writes: readonly PendingEventWrite[] = [];
  private readonly listeners = new Set<() => void>();
  private nextId = 1;

  /** Stable until something changes, so it can feed `useSyncExternalStore`. */
  snapshot = (): readonly PendingEventWrite[] => this.writes;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(next: readonly PendingEventWrite[]): void {
    this.writes = next;
    for (const listener of this.listeners) listener();
  }

  /** The id a create's placeholder row should carry as its uid. */
  reserve(): number {
    return this.nextId++;
  }

  begin(change: PendingEventChange, id: number = this.reserve()): number {
    this.set([...this.writes, { ...statedChange(change), id, state: "sending" }]);
    return id;
  }

  /**
   * The provider answered. Without `after` the write itself stays as settled;
   * with it, those changes take its place — a create returns the row under its
   * real uid, a move becomes "there now, gone here", a conflict becomes nothing.
   */
  settle(id: number, after?: readonly PendingEventChange[], now: number = Date.now()): void {
    const current = this.writes.find((write) => write.id === id);
    if (!current) return;
    const replaced: PendingEventChange[] = after ? after.map(statedChange) : [current];
    const settled = replaced.map((change, index): PendingEventWrite => ({ ...change, id: index === 0 ? id : this.reserve(), state: "settled", settledAt: now }));
    this.set(foldIntoCreates(this.writes.flatMap((write) => (write.id === id ? settled : [write])), settled));
  }

  /** The provider refused: the view goes back to what the cache says. */
  drop(id: number): void {
    if (this.writes.some((write) => write.id === id)) this.set(this.writes.filter((write) => write.id !== id));
  }

  /** Lets settled writes go once the cache agrees with them. */
  reconcile(rows: readonly PimEventRow[], now: number = Date.now()): void {
    const kept = unsettledEventWrites(rows, this.writes, now);
    if (kept.length !== this.writes.length) this.set(kept);
  }

  clear(): void {
    if (this.writes.length > 0) this.set([]);
  }

  /**
   * The created events no sync has listed for `SETTLED_EVENT_WRITE_TTL_MS`
   * since they were written or last asked about - each marked as asked now,
   * so two runs never ask twice.
   */
  takeUnlistedCreates(now: number = Date.now()): CreatedEventChange[] {
    const due = this.writes.filter(
      (write): write is PendingEventWrite & CreatedEventChange =>
        write.kind === "create" && write.state === "settled" && now - (write.checkedAt ?? write.settledAt ?? now) > SETTLED_EVENT_WRITE_TTL_MS,
    );
    if (due.length === 0) return [];
    const ids = new Set(due.map((write) => write.id));
    this.writes = this.writes.map((write) => (ids.has(write.id) ? { ...write, checkedAt: now } : write));
    return due.map(({ row, occurrences, draft }) => ({ kind: "create", row, ...(occurrences ? { occurrences } : {}), ...(draft ? { draft } : {}) }));
  }

  /** A created event the provider says it does not hold: it leaves the screen. */
  dropCreated(ref: PendingEventRef): void {
    const kept = this.writes.filter((write) => !(write.kind === "create" && sameRef(write.row, ref)));
    if (kept.length !== this.writes.length) this.set(kept);
  }
}

/**
 * Asks the provider about every created event no sync has listed for a while
 * (issue 119). A create counts as written only once the provider holds it, so
 * such an event is not taken off the screen for not being listed: a sync may
 * not have reached it. Held - it stays, and is asked about again later. Not
 * there - it leaves, and `onGone` says so (with what the person typed, for
 * "Try again"). A provider that cannot be asked, or does not answer, keeps it.
 */
export async function checkUnlistedCreates(
  store: PendingEventWrites,
  targetFor: (accountId: string) => Promise<{ eventExists?: (ref: { calendarId: string; uid: string; etag?: string; href?: string }) => Promise<boolean> } | null>,
  onGone: (created: CreatedEventChange) => void,
  now: number = Date.now(),
): Promise<void> {
  for (const created of store.takeUnlistedCreates(now)) {
    const { row } = created;
    let held: boolean;
    try {
      const target = await targetFor(row.accountId);
      if (!target?.eventExists) continue;
      held = await target.eventExists({ calendarId: row.calendarId, uid: row.uid, etag: row.etag, href: row.href });
    } catch {
      continue;
    }
    if (held) continue;
    store.dropCreated(row);
    onGone(created);
  }
}

/**
 * Writes the provider already accepted, shown until the cache has them - for
 * the few writes that did not go through `writeEventOptimistically` (a block
 * created in other calendars, the list an event gains). Laid over the cached
 * rows like every other settled write: a view that keeps its own copy of what
 * it wrote loses it to the first reload from a cycle that started earlier,
 * which is how an event appeared, vanished and came back (issue 119).
 */
export function showWrittenEvents(store: PendingEventWrites, changes: readonly PendingEventChange[]): void {
  for (const change of changes) store.settle(store.begin(change));
}

/**
 * A settled write against an event the cache does not list yet - one created a
 * moment ago, shown only by its `create` overlay - is folded INTO that overlay
 * (issue 119, R2).
 *
 * Laid beside it, it was let go at the first reconcile: an update, a stamp or a
 * delete waits for the cache to agree, and a cache that has never seen the
 * event agrees with nothing. So a new event that was recoloured lost its new
 * etag at once, and one that was deleted came back from its create overlay for
 * up to three minutes.
 */
function foldIntoCreates(writes: readonly PendingEventWrite[], settled: readonly PendingEventWrite[]): PendingEventWrite[] {
  let out = writes.slice();
  for (const change of settled) {
    if (change.kind === "create") continue;
    const created = (write: PendingEventWrite): write is Extract<PendingEventWrite, { kind: "create" }> =>
      write.kind === "create" && write.state === "settled" && write.id !== change.id;
    if (change.kind === "delete") {
      // Gone: nothing of it is to be shown any more - or, for one occurrence
      // of a new series, that occurrence.
      out = out
        .filter((write) => !(created(write) && reaches(write.row, change.ref)))
        .map((write) => (created(write) && write.occurrences ? { ...write, occurrences: write.occurrences.filter((row) => !sameRef(row, change.ref)) } : write));
    } else if (change.kind === "update") {
      const touches = (write: PendingEventWrite): boolean =>
        created(write) && (sameRef(write.row, change.ref) || !!write.occurrences?.some((row) => sameRef(row, change.ref)));
      if (!out.some(touches)) continue;
      const wide = seriesWidePatch(change.patch);
      out = out
        .map((write) =>
          created(write) && touches(write)
            ? {
                ...write,
                row: sameRef(write.row, change.ref) ? { ...write.row, ...change.patch } : write.row,
                ...(write.occurrences
                  ? { occurrences: write.occurrences.map((row) => (sameRef(row, change.ref) ? { ...row, ...change.patch } : occurrenceOf(row, change.ref) ? { ...row, ...wide } : row)) }
                  : {}),
              }
            : write,
        )
        .filter((write) => write.id !== change.id);
    } else {
      const stamp = (row: PimEventRow): PimEventRow => (stamps(row, change) ? { ...row, etag: change.etag } : row);
      out = out.map((write) =>
        created(write) ? { ...write, row: stamp(write.row), ...(write.occurrences ? { occurrences: write.occurrences.map(stamp) } : {}) } : write,
      );
    }
  }
  return out;
}

/** One overlay per app: the editor that writes and the views that show are different components. */
export const pendingEventWrites = new PendingEventWrites();

/** The placeholder a create shows until the provider has given the event its id. */
export function pendingEventRow(id: number, row: Omit<PimEventRow, "uid">): PimEventRow {
  return { ...row, uid: `${PENDING_EVENT_UID_PREFIX}${id}` } as PimEventRow;
}

/**
 * Runs a provider write with its change on screen from the first moment.
 *
 * `after` turns the provider's answer into what stays overlaid until the cache
 * catches up (see {@link PendingEventWrites.settle}); returning nothing keeps
 * the change itself. A rejected write drops the overlay and rethrows.
 */
export async function writeEventOptimistically<T>(
  store: PendingEventWrites,
  change: PendingEventChange,
  write: () => Promise<T>,
  after?: (result: T) => readonly PendingEventChange[] | undefined,
  id?: number,
): Promise<T> {
  const writeId = store.begin(change, id);
  try {
    const result = await write();
    store.settle(writeId, after?.(result));
    return result;
  } catch (error) {
    store.drop(writeId);
    throw error;
  }
}

/** The cached rows as a view should draw them, kept current while writes come and go. */
export function useShownEvents(
  rows: readonly PimEventRow[],
  store: PendingEventWrites = pendingEventWrites,
  range?: { startTs: number; endTs: number },
): ShownEventRow[] {
  const writes = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => {
    store.reconcile(rows);
  }, [rows, writes, store]);
  const startTs = range?.startTs;
  const endTs = range?.endTs;
  return useMemo(
    () => applyPendingEventWrites(rows, writes, startTs !== undefined && endTs !== undefined ? { startTs, endTs } : undefined),
    [rows, writes, startTs, endTs],
  );
}
