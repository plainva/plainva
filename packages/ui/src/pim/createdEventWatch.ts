import { useEffect } from "react";
import { NOT_SHOWN_YET_MS, type IPimTarget, type PimAccountRow, type PimCalendar, type PimEventDraft, type PimEventRow } from "@plainva/core";
import i18n from "../i18n";
import { logDiagnostic } from "../services/diagnosticsLog";
import { eventWriteRefusalText } from "../lib/errorText";
import { toast } from "../services/toastStore";
import { createCalendarEvent, createChange, draftToRow, type SeriesExpansion } from "./eventWrite";
import { pendingEventRow, pendingEventWrites, SETTLED_EVENT_WRITE_TTL_MS, writeEventOptimistically, type CreatedEventChange, type PendingEventWrites } from "./pendingEventWrites";

/**
 * A created event the views still draw from the overlay, settled where the
 * vault lives - not in a view, and never by time alone (issue 119).
 *
 * A provider may show a new event late (iCloud answers 404 for a while after
 * a create). That is not absence, so the overlay ends only on evidence:
 *
 *  - a sync has it - the cache, by the event's id, whatever range a view
 *    shows: the overlay ends; from then on the cache is the truth, so an event
 *    deleted elsewhere later is never reported as lost. A cache that cannot
 *    be read is no evidence either way: the event stays and is not asked
 *    about in that round,
 *  - its account or its calendar is gone from the cache (removed, not just
 *    switched off or hidden): the overlay ends without a word,
 *  - the provider says it does not have it - asked with the read-back's
 *    patience, at most every `CREATED_EVENT_ASK_EVERY_MS`, and only the third
 *    "no" in a row counts: it leaves with a message that names it.
 *
 * Hidden calendars and switched-off accounts keep their events here (the
 * views do not draw them) and are asked about all the same; sleep, a provider
 * that does not answer, or one that wants a sign-in end nothing. The device's
 * own calendars are not asked (their target has no `eventExists`): the store
 * takes a create at once and the next run lists it, so such an event stays
 * until that run. Closing the vault empties the overlay (the shells do that);
 * restarting the runtime in the same vault does not.
 *
 * Google and Microsoft are asked by the id they gave the event in their answer
 * (`row.uid`), so their "no" is about exactly this event; "Try again" creating
 * it anew there cannot duplicate one they still hold.
 */
export const CREATED_EVENT_ASK_EVERY_MS = SETTLED_EVENT_WRITE_TTL_MS;
export const CREATED_EVENT_DENIALS = 3;

export interface CreatedEventWatchCache {
  findEventsByUid(uid: string): Promise<PimEventRow[]>;
  listAccounts(): Promise<PimAccountRow[]>;
  listCalendars(): Promise<Array<PimCalendar & { accountId: string; selected: boolean }>>;
}

export interface CreatedEventWatchDeps {
  cache: CreatedEventWatchCache;
  targetFor(accountId: string): Promise<IPimTarget | null>;
  /** A created event the provider does not have. Default: the message that names it, with "Try again" for one typed into the form. */
  onGone?(created: CreatedEventChange): void;
  /**
   * Whether this watch still belongs to the open vault (issue 119). Asked
   * after every wait and before anything is said, written or created - a
   * round in flight when the vault is left must not speak in the next one.
   * `watchCreatedEvents` sets it; it ends with its stop.
   */
  current?(): boolean;
  /** The series expansion, where it can be loaded, for "Try again" to draw a series by its occurrences. */
  expand?(): Promise<SeriesExpansion | undefined>;
  /** Hands over every message the watch shows; `watchCreatedEvents` takes them down with its stop - a button that can no longer act is not left standing. */
  track?(toastId: number): void;
}

/** The one check every step of a watch makes after a wait (see `current`). */
const stillCurrent = (deps: Pick<CreatedEventWatchDeps, "current">): boolean => deps.current?.() !== false;

/** A round still applies to a created event: its watch is current, and the event is still in the overlay (a vault left empties it). */
const roundApplies = (store: PendingEventWrites, deps: Pick<CreatedEventWatchDeps, "current">, id: number): boolean =>
  stillCurrent(deps) && store.settledCreates().some((write) => write.id === id);

export async function settleCreatedEvents(store: PendingEventWrites, deps: CreatedEventWatchDeps, now: number = Date.now()): Promise<void> {
  const writes = store.settledCreates();
  if (writes.length === 0) return;
  const [accounts, calendars] = await Promise.all([deps.cache.listAccounts(), deps.cache.listCalendars()]);
  for (const created of writes) {
    if (!stillCurrent(deps)) return;
    const { row } = created;
    const cached = await deps.cache.findEventsByUid(row.uid).catch(() => null);
    if (!stillCurrent(deps)) return;
    if (!roundApplies(store, deps, created.id) || cached === null) continue;
    if (cached.some((cachedRow) => cachedRow.accountId === row.accountId && cachedRow.calendarId === row.calendarId)) {
      store.dropCreated(row);
      continue;
    }
    const accountGone = !accounts.some((a) => a.id === row.accountId);
    const calendarGone = !calendars.some((c) => c.accountId === row.accountId && c.id === row.calendarId);
    if (accountGone || calendarGone) {
      store.dropCreated(row);
      continue;
    }
    if (now - (created.checkedAt ?? created.settledAt) < CREATED_EVENT_ASK_EVERY_MS) continue;
    let held: boolean;
    try {
      const target = await deps.targetFor(row.accountId);
      // The vault may have been left while the target was built: its provider is not asked any more.
      if (!roundApplies(store, deps, created.id)) {
        if (!stillCurrent(deps)) return;
        continue;
      }
      if (!target?.eventExists) {
        store.markAsked(created.id, now, null);
        continue;
      }
      held = await target.eventExists({ calendarId: row.calendarId, uid: row.uid, etag: row.etag, href: row.href });
    } catch {
      if (!stillCurrent(deps)) return;
      if (roundApplies(store, deps, created.id)) store.markAsked(created.id, now, null);
      continue;
    }
    // The vault may have been left while the provider was asked.
    if (!stillCurrent(deps)) return;
    if (!roundApplies(store, deps, created.id)) continue;
    // One clock with the target (`NOT_SHOWN_YET_MS`): while it still takes a
    // 404 for "not shown yet", a "not there" here does not count either.
    const counts = now - created.settledAt >= NOT_SHOWN_YET_MS;
    store.markAsked(created.id, now, held ? false : counts ? true : null);
    if (held || !counts || created.denials + 1 < CREATED_EVENT_DENIALS) continue;
    store.dropCreated(row);
    (deps.onGone ?? ((gone) => reportCreatedEventGone(store, deps, gone)))(created);
  }
}

/** Runs `settleCreatedEvents` every minute until the returned stop. */
export function watchCreatedEvents(store: PendingEventWrites, deps: CreatedEventWatchDeps, everyMs = 60_000): () => void {
  let running = false;
  let live = true;
  const shown = new Set<number>();
  const scoped: CreatedEventWatchDeps = {
    ...deps,
    current: () => live && stillCurrent(deps),
    track: (toastId) => {
      shown.add(toastId);
      deps.track?.(toastId);
    },
  };
  const run = () => {
    if (running || !live) return;
    running = true;
    void settleCreatedEvents(store, scoped)
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(run, everyMs);
  return () => {
    live = false;
    clearInterval(timer);
    for (const toastId of shown) toast.dismiss(toastId);
    shown.clear();
  };
}

/**
 * The message for a created event the provider does not have, naming what it
 * was. A new event typed into the form offers "Try again", which creates
 * exactly it again under the same uid. A blocker and the copy a move made say
 * so, without "Try again".
 */
export function reportCreatedEventGone(store: PendingEventWrites, deps: Pick<CreatedEventWatchDeps, "targetFor" | "current" | "expand" | "track">, created: CreatedEventChange): void {
  if (!stillCurrent(deps)) return;
  const { accountId, calendarId, title } = created.row;
  logDiagnostic("pim", `created ${created.what ?? "new"} event not held by the provider`);
  const say = (text: string, action?: { label: string; run: () => void }) => {
    const toastId = toast.error(text, action);
    deps.track?.(toastId);
  };
  if (created.what === "blocker") {
    say(i18n.t("pim.blockerCreateLost", { title }));
    return;
  }
  // The copy a move made: after the move its source is deleted, so a copy the
  // provider does not have is, as a rule, an event lost. Said - nothing about
  // the source (its delete may have failed), and no "Try again".
  if (created.what === "moved") {
    say(i18n.t("pim.eventMoveLost", { title }));
    return;
  }
  const draft = created.draft;
  if (!draft?.createAs) return;
  // A later try of the same create: the earlier one sent this same draft.
  const { createAs: _as, createSent: _sent, ...sent } = draft as PimEventDraft & { createAs: string; createSent?: unknown };
  const create = { ...sent, createAs: draft.createAs, createSent: [sent] };
  const fail = (error: unknown) => {
    if (stillCurrent(deps)) say(eventWriteRefusalText(error, "save"), { label: i18n.t("pim.eventWriteRetry"), run: again });
  };
  const write = (expand: SeriesExpansion | undefined) => {
    if (!stillCurrent(deps)) return;
    const id = store.reserve();
    const { uid: _uid, ...shown } = draftToRow(accountId, calendarId, "", create);
    void writeEventOptimistically(
      store,
      createChange(pendingEventRow(id, shown), create, expand),
      () => createCalendarEvent({ targetFor: deps.targetFor }, accountId, calendarId, create),
      (out) => out.rows.map((written) => createChange(written, create, expand)),
      id,
    ).catch(fail);
  };
  const again = () => {
    // The button outlives a vault that was left: then it does nothing.
    if (!stillCurrent(deps)) return;
    // Shown at once where nothing is to be loaded; else once the expansion is there.
    if (!deps.expand) return write(undefined);
    void deps.expand().catch(() => undefined).then(write);
  };
  say(i18n.t("pim.eventCreateLost", { title }), { label: i18n.t("pim.eventWriteRetry"), run: again });
}

/** What `useCreatedEventWatch` needs of a vault's calendar runtime. */
export interface CreatedEventWatchRuntime {
  cache: CreatedEventWatchCache;
  /** The target the sync uses for an account. */
  syncTarget(account: PimAccountRow): Promise<IPimTarget | null>;
}

/**
 * The watch of created events for a window that shows a vault (issue 119):
 * it runs while the vault's calendar runtime does, in every window - an
 * auxiliary window's runtime asks through the central one - and the overlay
 * is emptied when the window leaves the vault, never when the runtime is made
 * anew for the same vault. `vaultKey` names the vault; `expand` loads the
 * series expansion for "Try again" (stable across renders).
 */
export function useCreatedEventWatch(
  vaultKey: string | null,
  runtime: CreatedEventWatchRuntime | null,
  expand?: () => Promise<SeriesExpansion | undefined>,
  store: PendingEventWrites = pendingEventWrites,
): void {
  useEffect(() => () => store.clear(), [vaultKey, store]);
  useEffect(() => {
    if (!runtime) return;
    return watchCreatedEvents(store, {
      cache: runtime.cache,
      targetFor: async (accountId) => {
        const account = (await runtime.cache.listAccounts()).find((a) => a.id === accountId);
        return account ? runtime.syncTarget(account) : null;
      },
      ...(expand ? { expand } : {}),
    });
  }, [runtime, expand, store]);
}
