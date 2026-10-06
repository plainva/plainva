import {
  PimConflictError,
  PimRequestError,
  sameBlockRef,
  uniqueBlockRefs,
  type IPimTarget,
  type PimBlockRef,
  type PimEventDraft,
  type PimEventRow,
} from "@plainva/core";
import { markdownToHtml } from "../lib/markdownToHtml";
import { logDiagnostic } from "../services/diagnosticsLog";
import { deleteCalendarEvent, draftToRow, updateCalendarEvent, type EventTargets, type EventWriteOutcome } from "./eventWrite";
import { pendingEventWrites, writeEventOptimistically, type PendingEventWrites } from "./pendingEventWrites";

/**
 * Blockers follow their event (K3, plan Befunde 2026-10-06).
 *
 * "Block in other calendars" writes a copy of an event into other calendars.
 * Until now that copy knew its event (`blockOf`) and nothing else followed from
 * it: move the event and the blockers stood where they were, delete it and they
 * stayed, move a blocker and the two drifted apart without a word.
 *
 * A blocker is a mirror, not a second appointment. So:
 *
 *  - the event carries the list of its blockers itself (`blocks`, stored at the
 *    provider), because the cache only holds the calendars that are shown and
 *    a blocker in a hidden one could otherwise not be found at all,
 *  - moving, changing or deleting the event is passed on — the time always,
 *    title, place and description only to a blocker made "with details",
 *  - a blocker that is moved or changed asks once what was meant,
 *  - all of it lands on screen with the event's own change, through the same
 *    overlay, and none of it is decided twice: both shells call this file.
 *
 * The list on the event is a hint that makes blockers findable, never the truth
 * about them. A blocker that is gone answers 404 and is passed over; one that
 * no longer points back has been detached and is left alone.
 */

/** What the two shells have to supply: targets, and two questions to the cache. */
export interface BlockFollowDeps {
  targets: EventTargets;
  /** Cached rows that name one of the uids as the event they block — any calendar, shown or not. */
  blockersOf(uids: readonly string[]): Promise<PimEventRow[]>;
  /** Cached rows of one provider event id: the row and, for a series, its occurrences. */
  eventsByUid(uid: string): Promise<PimEventRow[]>;
  /** The title of a "Busy" blocker, for one whose row is not in the cache. */
  busyLabel: string;
  store?: PendingEventWrites;
}

export interface ResolvedBlocker {
  ref: PimBlockRef;
  /** The cached row, or null for a blocker in a calendar the cache does not hold. */
  row: PimEventRow | null;
  mode: "busy" | "details";
}

export interface BlockFollowFailure {
  ref: PimBlockRef;
  reason: string;
  /** HTTP status where the provider answered; null for a local failure. */
  status: number | null;
  /** The blocker exists but cannot be addressed from here: its calendar is not shown. */
  hidden?: true;
}

export interface BlockFollowReport {
  followed: PimBlockRef[];
  failed: BlockFollowFailure[];
}

const NO_BLOCKERS: BlockFollowReport = { followed: [], failed: [] };

type EventRef = Pick<PimEventRow, "accountId" | "calendarId" | "uid">;

const sameRef = (a: EventRef, b: EventRef): boolean => a.accountId === b.accountId && a.calendarId === b.calendarId && a.uid === b.uid;

const sameStart = (a: PimEventRow, b: PimEventRow): boolean => a.allDay === b.allDay && a.start.ts === b.start.ts;

/** What a blocker names: the series for an occurrence, the event itself otherwise. */
export const blockLinkKey = (event: Pick<PimEventRow, "uid" | "seriesMaster">): string => event.seriesMaster ?? event.uid;

const pointsAt = (row: PimEventRow, source: PimEventRow): boolean =>
  !!row.blockOf && (row.blockOf === blockLinkKey(source) || row.blockOf === source.uid);

/**
 * A blocker made "with details" carries its event's title; a "Busy" one does
 * not. That is how the two are told apart where the event's own list does not
 * say — every blocker written before the list existed.
 */
const modeOf = (row: PimEventRow, source: PimEventRow, listed?: PimBlockRef): "busy" | "details" =>
  listed?.mode ?? (row.title === source.title ? "details" : "busy");

/**
 * Of `rows`, the ones that are the blocker of exactly THIS event.
 *
 * A series is followed at the series: an occurrence is mirrored by the blocker
 * occurrence that starts when it does, the master by the blocker's master.
 */
export function blockerRowsOf(source: PimEventRow, rows: readonly PimEventRow[]): PimEventRow[] {
  const mine = rows.filter((row) => pointsAt(row, source) && !sameRef(row, source));
  // A blocker written from a single occurrence (its series could not be read)
  // names that occurrence and is an ordinary event.
  if (source.seriesMaster) return mine.filter((row) => (row.seriesMaster ? sameStart(row, source) : row.blockOf === source.uid && !row.recurrence));
  if (source.recurrence) return mine.filter((row) => !row.seriesMaster);
  return mine.filter((row) => !row.seriesMaster && !row.recurrence);
}

/**
 * Adds the derived reverse linkage the views draw the chain mark from: an
 * event is "blocked in" whatever loaded blocker points at it, and whatever its
 * own list at the provider names — so the mark also shows for a blocker in a
 * calendar that is not on screen.
 */
export function linkCalendarBlocks<T extends PimEventRow>(events: readonly T[]): T[] {
  const loaded = new Map<string, PimBlockRef[]>();
  for (const event of events) {
    if (!event.blockOf) continue;
    const list = loaded.get(event.blockOf) ?? [];
    list.push({ accountId: event.accountId, calendarId: event.calendarId, uid: event.uid });
    loaded.set(event.blockOf, list);
  }
  // An occurrence may arrive without its series' list (CalDAV overrides, a
  // delta page): the master row, where it is loaded, answers for it.
  const listed = new Map<string, PimBlockRef[]>();
  for (const event of events) if (event.blocks?.length && !event.blockOf) listed.set(blockLinkKey(event), event.blocks);
  return events.map((event) => {
    if (event.blockOf) return event;
    const key = blockLinkKey(event);
    const refs = uniqueBlockRefs([
      ...(loaded.get(key) ?? []),
      ...(key === event.uid ? [] : loaded.get(event.uid) ?? []),
      ...(event.blocks ?? listed.get(key) ?? []),
    ]).map(({ accountId, calendarId, uid }) => ({ accountId, calendarId, uid }));
    return refs.length > 0 ? { ...event, blockedIn: refs } : event;
  });
}

/**
 * Every blocker of an event that can be found: the ones its own list names and
 * the ones the cache holds — which is how a blocker from before the list
 * existed is picked up the next time its event is touched.
 *
 * `hidden` are blockers that exist but cannot be addressed: an occurrence of a
 * blocker series in a calendar that is not shown has no row, and without the
 * row there is no id to write against.
 */
export async function resolveBlockers(
  deps: BlockFollowDeps,
  source: PimEventRow,
  loaded: readonly PimEventRow[] = [],
): Promise<{ blockers: ResolvedBlocker[]; hidden: PimBlockRef[] }> {
  const key = blockLinkKey(source);
  // Filtered again here: what points at this event is this file's decision, not
  // a property of whoever answers the query.
  const cached = (await deps.blockersOf([...new Set([key, source.uid])])).filter((row) => pointsAt(row, source));
  const known = [...cached, ...loaded.filter((row) => pointsAt(row, source) && !cached.some((have) => sameRef(have, row)))];
  const rows = blockerRowsOf(source, known);

  let listed = source.blocks ?? [];
  if (listed.length === 0 && source.seriesMaster) {
    const master = (await deps.eventsByUid(key)).find((row) => row.uid === key && row.accountId === source.accountId && row.calendarId === source.calendarId);
    listed = master?.blocks ?? [];
  }

  const blockers: ResolvedBlocker[] = [];
  const hidden: PimBlockRef[] = [];
  const add = (blocker: ResolvedBlocker) => {
    if (!blockers.some((have) => sameBlockRef(have.ref, blocker.ref))) blockers.push(blocker);
  };

  for (const row of rows) {
    // The list names a blocker SERIES; its occurrence is recognised by it.
    const entry = listed.find((ref) => ref.accountId === row.accountId && ref.calendarId === row.calendarId && (ref.uid === row.uid || ref.uid === row.seriesMaster));
    add({
      ref: { accountId: row.accountId, calendarId: row.calendarId, uid: row.uid, ...(row.href ? { href: row.href } : {}), mode: modeOf(row, source, entry) },
      row,
      mode: modeOf(row, source, entry),
    });
  }

  for (const entry of listed) {
    const reached = rows.some((row) => row.accountId === entry.accountId && row.calendarId === entry.calendarId && (row.uid === entry.uid || row.seriesMaster === entry.uid));
    if (reached) continue;
    if (source.seriesMaster) {
      // The blocker series is in the cache, only no occurrence of it starts
      // when this one does: that occurrence was moved on its own, and goes on
      // standing where it was put. Without any row the series is out of reach.
      const seriesCached = known.some((row) => row.accountId === entry.accountId && row.calendarId === entry.calendarId && (row.uid === entry.uid || row.seriesMaster === entry.uid));
      if (!seriesCached) hidden.push(entry);
      continue;
    }
    // In the cache but no longer pointing here: it was detached. Leave it be.
    const elsewhere = (await deps.eventsByUid(entry.uid)).find((row) => sameRef(row, entry));
    if (elsewhere) continue;
    add({ ref: entry, row: null, mode: entry.mode ?? "busy" });
  }
  return { blockers, hidden };
}

/** The list an event should carry for the blockers that were found. */
const refsOf = (blockers: readonly ResolvedBlocker[]): PimBlockRef[] => blockers.map((blocker) => ({ ...blocker.ref, mode: blocker.mode }));

function sameRefList(a: readonly PimBlockRef[], b: readonly PimBlockRef[]): boolean {
  return a.length === b.length && a.every((ref) => b.some((other) => sameBlockRef(ref, other) && (ref.mode ?? "busy") === (other.mode ?? "busy") && (ref.href ?? "") === (other.href ?? "")));
}

/**
 * What a blocker takes over from its event's new state (E4): the time always;
 * title, place and description only when it was made "with details". A "Busy"
 * blocker keeps what it says.
 */
export function blockerDraftFor(blocker: ResolvedBlocker, draft: PimEventDraft, busyLabel: string, blockOf?: string): PimEventDraft {
  const details = blocker.mode === "details";
  return {
    title: details ? draft.title : blocker.row?.title ?? busyLabel,
    allDay: draft.allDay,
    start: draft.start,
    end: draft.end,
    location: details ? draft.location : blocker.row?.location ?? undefined,
    description: details ? draft.description : undefined,
    descriptionHtml: details ? draft.descriptionHtml : undefined,
    // The blocker's own colour: a draft without one would reset it.
    color: blocker.row?.color,
    // A changed rule of the series is the series' blockers' rule too.
    recurrence: draft.recurrence,
    ...(blockOf ? { blockOf } : {}),
  };
}

/** The same, as the fields the overlay lays over the blocker's row. */
function blockerPatchFor(blocker: ResolvedBlocker, draft: PimEventDraft, busyLabel: string): Partial<PimEventRow> {
  const next = blockerDraftFor(blocker, draft, busyLabel);
  return {
    start: next.start,
    end: next.end,
    allDay: next.allDay,
    ...(blocker.mode === "details" ? { title: next.title, location: next.location, description: next.description } : {}),
  };
}

const isGone = (error: unknown): boolean => error instanceof PimRequestError && (error.status === 404 || error.status === 410);

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * One write against a blocker. A stale etag is not a conflict to report here:
 * the blocker mirrors its event, so the event's state is the one that counts
 * and the write is repeated without the guard.
 */
async function writeBlocker<T>(blocker: ResolvedBlocker, call: (etag: string | undefined) => Promise<T>): Promise<T> {
  try {
    return await call(blocker.row?.etag);
  } catch (error) {
    if (error instanceof PimConflictError && blocker.row?.etag) return call(undefined);
    throw error;
  }
}

const blockerRef = (blocker: ResolvedBlocker, etag: string | undefined) => ({
  calendarId: blocker.ref.calendarId,
  uid: blocker.ref.uid,
  etag,
  href: blocker.row?.href ?? blocker.ref.href,
});

async function targetOf(deps: BlockFollowDeps, accountId: string): Promise<IPimTarget> {
  const target = await deps.targets.targetFor(accountId);
  if (!target) throw new Error("no writable target for this account");
  return target;
}

export type FollowedWriteOutcome = EventWriteOutcome & { blockers: BlockFollowReport };

export interface FollowWriteOptions {
  moveTo?: { accountId: string; calendarId: string } | null;
  /** The rows the view has loaded: their blockers move in the same instant, before anything is awaited. */
  loaded?: readonly PimEventRow[];
}

/**
 * Updates an event and passes the change on to its blockers.
 *
 * In order, and the order is the point:
 *
 *  1. the event and every blocker the view shows are laid over the cached rows
 *     at once — nothing is awaited before that,
 *  2. the blockers are looked up (the cache, a local read) and the event is
 *     written with the list of them, so a blocker found only through the cache
 *     is on the list from then on,
 *  3. each blocker is written. One that fails is named in the report and its
 *     overlay is taken back; the others are unaffected.
 *
 * A refused or conflicting write of the event itself moves nothing.
 */
export async function updateEventWithBlockers(
  deps: BlockFollowDeps,
  source: PimEventRow,
  draft: PimEventDraft,
  options: FollowWriteOptions = {},
): Promise<FollowedWriteOutcome> {
  const store = deps.store ?? pendingEventWrites;
  const moveTo = options.moveTo ?? null;
  const moving = !!moveTo && (moveTo.accountId !== source.accountId || moveTo.calendarId !== source.calendarId);
  const loaded = options.loaded ?? [];

  // 1 — on screen now.
  const shown = blockerRowsOf(source, loaded).map((row) => {
    const blocker: ResolvedBlocker = { ref: { accountId: row.accountId, calendarId: row.calendarId, uid: row.uid }, row, mode: modeOf(row, source, source.blocks?.find((ref) => sameRef(ref, row))) };
    return { row, id: store.begin({ kind: "update", ref: row, patch: blockerPatchFor(blocker, draft, deps.busyLabel) }) };
  });
  const dropShown = () => shown.forEach((entry) => store.drop(entry.id));

  const { uid: _uid, ...patch } = draftToRow(moving ? moveTo!.accountId : source.accountId, moving ? moveTo!.calendarId : source.calendarId, source.uid, draft);
  let resolved: { blockers: ResolvedBlocker[]; hidden: PimBlockRef[] } = { blockers: [], hidden: [] };
  let out: EventWriteOutcome;
  try {
    out = await writeEventOptimistically(
      store,
      { kind: "update", ref: source, patch },
      async () => {
        // 2 — the event, with its list.
        resolved = await resolveBlockers(deps, source, loaded);
        const refs = refsOf(resolved.blockers);
        // An occurrence never carries the list: it belongs to the series. And
        // an event without blockers is written exactly as it always was.
        const withList = !source.seriesMaster && !sameRefList(refs, source.blocks ?? []);
        return updateCalendarEvent(deps.targets, source, withList || (moving && refs.length > 0) ? { ...draft, blocks: refs } : draft, moveTo);
      },
      (result) => {
        if (result.kind === "conflict") return [];
        if (!moving) return undefined;
        const created = result.rows.map((row) => ({ kind: "create" as const, row }));
        return result.kind === "written" ? [...created, { kind: "delete" as const, ref: source }] : created;
      },
    );
  } catch (error) {
    dropShown();
    throw error;
  }
  if (out.kind === "conflict") {
    dropShown();
    return { ...out, blockers: NO_BLOCKERS };
  }

  // 3 — the blockers. A moved event has a new id, and they have to name it.
  const blockOf = moving ? out.rows[0]?.uid : undefined;
  const report: BlockFollowReport = { followed: [], failed: [] };
  for (const blocker of resolved.blockers) {
    const overlay = shown.find((entry) => sameRef(entry.row, blocker.ref));
    try {
      const target = await targetOf(deps, blocker.ref.accountId);
      const next = blockerDraftFor(blocker, draft, deps.busyLabel, blockOf);
      await writeBlocker(blocker, (etag) => target.updateEvent(blockerRef(blocker, etag), next));
      if (overlay) store.settle(overlay.id);
      report.followed.push(blocker.ref);
    } catch (error) {
      if (overlay) store.drop(overlay.id);
      // Deleted elsewhere: there is nothing left to follow, and nothing to report.
      if (!isGone(error)) report.failed.push({ ref: blocker.ref, reason: reasonOf(error), status: error instanceof PimRequestError ? error.status : null });
    }
  }
  // A row that looked like a blocker on screen but did not resolve as one.
  for (const entry of shown) if (!resolved.blockers.some((blocker) => sameRef(entry.row, blocker.ref))) store.drop(entry.id);
  for (const ref of resolved.hidden) report.failed.push({ ref, reason: "calendar not shown", status: null, hidden: true });
  logFollow("update", report);
  return { ...out, blockers: report };
}

/**
 * Deletes an event and — where the user left the box ticked — its blockers.
 * `blockers` is what {@link resolveBlockers} found and the confirmation named;
 * an empty list deletes the event alone and leaves its blockers standing.
 */
export async function deleteEventWithBlockers(
  deps: BlockFollowDeps,
  source: PimEventRow,
  blockers: readonly ResolvedBlocker[],
): Promise<BlockFollowReport> {
  const store = deps.store ?? pendingEventWrites;
  // A deleted blocker leaves its event's list. Looked up before the delete:
  // afterwards the row that names the event is on its way out of the cache.
  const mirrored = source.blockOf && !source.seriesMaster ? await sourceOfBlocker(deps, source).catch(() => null) : null;
  // Gone from view with the confirmation, all of them.
  const shown = blockers.filter((blocker) => blocker.row).map((blocker) => ({ blocker, id: store.begin({ kind: "delete", ref: blocker.row! }) }));
  try {
    await writeEventOptimistically(store, { kind: "delete", ref: source }, () => deleteCalendarEvent(deps.targets, source));
  } catch (error) {
    shown.forEach((entry) => store.drop(entry.id));
    throw error;
  }
  const report: BlockFollowReport = { followed: [], failed: [] };
  for (const blocker of blockers) {
    const overlay = shown.find((entry) => entry.blocker === blocker);
    try {
      const target = await targetOf(deps, blocker.ref.accountId);
      await writeBlocker(blocker, (etag) => target.deleteEvent(blockerRef(blocker, etag)));
      if (overlay) store.settle(overlay.id);
      report.followed.push(blocker.ref);
    } catch (error) {
      if (overlay) store.drop(overlay.id);
      if (!isGone(error)) report.failed.push({ ref: blocker.ref, reason: reasonOf(error), status: error instanceof PimRequestError ? error.status : null });
    }
  }
  if (mirrored) await unlistBlocker(deps, source, mirrored);
  logFollow("delete", report);
  return report;
}

function logFollow(what: string, report: BlockFollowReport): void {
  if (report.followed.length === 0 && report.failed.length === 0) return;
  logDiagnostic("pim", `blockers ${what}: ${report.followed.length} followed, ${report.failed.length} not`);
  for (const failure of report.failed) logDiagnostic("pim", `blocker not followed: ${failure.reason}`);
}

/**
 * Writes the reverse link after "Block in other calendars" made new blockers:
 * the event's list gains them. Through `linkEvent`, which touches nothing else
 * about the event. A provider without it, an event the user may not write and a
 * refused write all leave the blockers working through the cache as before —
 * so this reports nothing and only notes a failure in the diagnostics log.
 */
export async function recordBlockers(deps: BlockFollowDeps, source: PimEventRow, created: readonly PimBlockRef[]): Promise<boolean> {
  if (created.length === 0) return false;
  try {
    const target = await deps.targets.targetFor(source.accountId);
    if (!target?.linkEvent) return false;
    const link = target.linkEvent.bind(target);
    const { blockers } = await resolveBlockers(deps, source);
    const blocks = uniqueBlockRefs([...(source.blocks ?? []), ...refsOf(blockers), ...created]);
    const ref = { calendarId: source.calendarId, uid: source.uid, href: source.href };
    try {
      await link({ ...ref, etag: source.etag }, { blocks });
    } catch (error) {
      if (!(error instanceof PimConflictError)) throw error;
      await link(ref, { blocks });
    }
    return true;
  } catch (error) {
    logDiagnostic("pim", `blocker list not written: ${reasonOf(error)}`);
    return false;
  }
}

// ---- a blocker is moved or changed ------------------------------------------

/**
 * The event a blocker mirrors, where the cache holds it — or null, and then the
 * blocker is an ordinary entry as far as anyone can tell: its event is gone, or
 * in a calendar that is not shown.
 */
export async function sourceOfBlocker(deps: Pick<BlockFollowDeps, "eventsByUid">, blocker: PimEventRow): Promise<PimEventRow | null> {
  const key = blocker.blockOf;
  if (!key) return null;
  const rows = (await deps.eventsByUid(key)).filter((row) => !row.blockOf && !sameRef(row, blocker) && (row.uid === key || row.seriesMaster === key));
  if (blocker.seriesMaster) return rows.find((row) => row.seriesMaster === key && sameStart(row, blocker)) ?? null;
  if (blocker.recurrence) return rows.find((row) => row.uid === key && !!row.recurrence) ?? null;
  return rows.find((row) => row.uid === key && !row.recurrence) ?? null;
}

/**
 * Whether the user may change this event. An invitation of somebody else is
 * theirs to move: Plainva then writes the user's blockers, never the event.
 */
export function mayChangeEvent(event: PimEventRow, writableCalendarKeys: ReadonlySet<string>): boolean {
  return writableCalendarKeys.has(`${event.accountId} ${event.calendarId}`) && event.selfResponse === undefined;
}

/**
 * "Change the event" chosen on a blocker: what the blocker's edit means for the
 * event it mirrors. The mirror image of {@link blockerDraftFor} — the time
 * always, the rest only where the blocker is a copy with details. A "Busy"
 * blocker's title is not the event's.
 */
export function sourceDraftFromBlockerEdit(source: PimEventRow, blocker: PimEventRow, draft: PimEventDraft): PimEventDraft {
  const details = modeOf(blocker, source) === "details";
  return {
    title: details ? draft.title : source.title,
    allDay: draft.allDay,
    start: draft.start,
    end: draft.end,
    location: details ? draft.location : source.location ?? undefined,
    description: details ? draft.description : undefined,
    descriptionHtml: details ? draft.descriptionHtml : undefined,
    color: source.color,
    recurrence: draft.recurrence,
  };
}

/**
 * "Only this blocker" chosen: the blocker is written and stops being one — its
 * link is removed, and it is taken off its event's list, so that it is not
 * moved again the next time the event is. An occurrence of a blocker series is
 * only written: the link belongs to the series, which goes on mirroring.
 */
export async function detachBlockerAndUpdate(
  deps: BlockFollowDeps,
  blocker: PimEventRow,
  draft: PimEventDraft,
  options: { moveTo?: { accountId: string; calendarId: string } | null; source?: PimEventRow | null } = {},
): Promise<EventWriteOutcome> {
  const store = deps.store ?? pendingEventWrites;
  const moveTo = options.moveTo ?? null;
  const moving = !!moveTo && (moveTo.accountId !== blocker.accountId || moveTo.calendarId !== blocker.calendarId);
  const detach = !blocker.seriesMaster;
  // A copy in another calendar starts without a link; in place the link is removed.
  const written: PimEventDraft = detach && !moving ? { ...draft, blockOf: null } : draft;
  const { uid: _uid, ...patch } = draftToRow(moving ? moveTo!.accountId : blocker.accountId, moving ? moveTo!.calendarId : blocker.calendarId, blocker.uid, written);
  const out = await writeEventOptimistically(
    store,
    { kind: "update", ref: blocker, patch },
    () => updateCalendarEvent(deps.targets, blocker, written, moveTo),
    (result) => {
      if (result.kind === "conflict") return [];
      if (!moving) return undefined;
      const created = result.rows.map((row) => ({ kind: "create" as const, row }));
      return result.kind === "written" ? [...created, { kind: "delete" as const, ref: blocker }] : created;
    },
  );
  if (out.kind !== "conflict" && detach) await unlistBlocker(deps, blocker, options.source ?? null);
  return out;
}

/**
 * Takes a blocker off its event's list — after it was detached or deleted —
 * so that the event does not go on writing to an entry that is no longer its
 * mirror. Through `linkEvent`, which touches nothing else. Best effort: a
 * stale entry is passed over anyway once the cache has seen the change.
 */
async function unlistBlocker(deps: BlockFollowDeps, blocker: PimEventRow, source: PimEventRow | null): Promise<void> {
  if (!source?.blocks?.some((ref) => sameRef(ref, blocker))) return;
  try {
    const target = await deps.targets.targetFor(source.accountId);
    if (!target?.linkEvent) return;
    // No etag: the list is ours alone, and the event may have been written since.
    await target.linkEvent({ calendarId: source.calendarId, uid: source.uid, href: source.href }, { blocks: source.blocks.filter((ref) => !sameRef(ref, blocker)) });
  } catch (error) {
    logDiagnostic("pim", `blocker list not pruned: ${reasonOf(error)}`);
  }
}

// ---- undo ---------------------------------------------------------------------

/**
 * The draft that puts an event back to how `before` shows it, or null where
 * that cannot be done faithfully: the cache holds attendees as display names
 * and a series' rule in the provider's own words, so a write that changed
 * either is not offered for undoing rather than undone wrongly.
 */
export function undoDraftFor(before: PimEventRow, written: PimEventDraft): PimEventDraft | null {
  if (written.attendees !== undefined || written.recurrence !== undefined) return null;
  return {
    title: before.title,
    allDay: before.allDay,
    start: before.start,
    end: before.end,
    location: before.location ?? undefined,
    // Only what the write touched: an untouched description stays the provider's.
    description: written.description !== undefined ? before.description ?? "" : undefined,
    descriptionHtml: written.description !== undefined ? (before.description ? markdownToHtml(before.description) : "") : undefined,
    color: before.color,
  };
}

/** True when the write changed when the event is, not only what it says. */
export function movedInTime(before: PimEventRow, draft: PimEventDraft): boolean {
  return before.allDay !== draft.allDay || before.start.ts !== draft.start.ts || before.end.ts !== draft.end.ts;
}

/** "15:00", or the day for an all-day event or one that changed its day — for the message that names where it went. */
export function describeNewStart(before: PimEventRow, draft: PimEventDraft, locale: string): string {
  if (draft.allDay) {
    const [y, m, d] = (draft.start.date ?? new Date(draft.start.ts).toISOString().slice(0, 10)).split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(new Date(y, (m ?? 1) - 1, d ?? 1));
  }
  const start = new Date(draft.start.ts);
  const sameDay = !before.allDay && new Date(before.start.ts).toDateString() === start.toDateString();
  return new Intl.DateTimeFormat(locale, sameDay ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(start);
}
