import type { IPimTarget, PimAccountRow, PimCalendar, PimEventRow } from "@plainva/core";
import i18n from "../i18n";
import { logDiagnostic } from "../services/diagnosticsLog";
import { refusalReason } from "../lib/errorText";
import { toast } from "../services/toastStore";
import { createCalendarEvent, createChange, draftToRow } from "./eventWrite";
import { pendingEventRow, SETTLED_EVENT_WRITE_TTL_MS, writeEventOptimistically, type CreatedEventChange, type PendingEventWrites } from "./pendingEventWrites";

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
}

export async function settleCreatedEvents(store: PendingEventWrites, deps: CreatedEventWatchDeps, now: number = Date.now()): Promise<void> {
  const writes = store.settledCreates();
  if (writes.length === 0) return;
  const [accounts, calendars] = await Promise.all([deps.cache.listAccounts(), deps.cache.listCalendars()]);
  for (const created of writes) {
    const { row } = created;
    const cached = await deps.cache.findEventsByUid(row.uid).catch(() => null);
    if (cached === null) continue;
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
      if (!target?.eventExists) {
        store.markAsked(created.id, now, null);
        continue;
      }
      held = await target.eventExists({ calendarId: row.calendarId, uid: row.uid, etag: row.etag, href: row.href });
    } catch {
      store.markAsked(created.id, now, null);
      continue;
    }
    store.markAsked(created.id, now, !held);
    if (held || created.denials + 1 < CREATED_EVENT_DENIALS) continue;
    store.dropCreated(row);
    (deps.onGone ?? ((gone) => reportCreatedEventGone(store, deps, gone)))(created);
  }
}

/** Runs `settleCreatedEvents` every minute until the returned stop. */
export function watchCreatedEvents(store: PendingEventWrites, deps: CreatedEventWatchDeps, everyMs = 60_000): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void settleCreatedEvents(store, deps)
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(run, everyMs);
  return () => clearInterval(timer);
}

/**
 * The message for a created event the provider does not have, naming what it
 * was. A new event typed into the form offers "Try again", which creates
 * exactly it again under the same uid. A blocker and the copy a move made say
 * so, without "Try again".
 */
export function reportCreatedEventGone(store: PendingEventWrites, deps: Pick<CreatedEventWatchDeps, "targetFor">, created: CreatedEventChange): void {
  const { accountId, calendarId, title } = created.row;
  logDiagnostic("pim", `created ${created.what ?? "new"} event not held by the provider`);
  if (created.what === "blocker") {
    toast.error(i18n.t("pim.blockerCreateLost", { title }));
    return;
  }
  // The copy a move made: after the move its source is deleted, so a copy the
  // provider does not have is, as a rule, an event lost. Said - nothing about
  // the source (its delete may have failed), and no "Try again".
  if (created.what === "moved") {
    toast.error(i18n.t("pim.eventMoveLost", { title }));
    return;
  }
  const draft = created.draft;
  if (!draft?.createAs) return;
  const create = { ...draft, createAs: draft.createAs };
  const again = () => {
    const id = store.reserve();
    const { uid: _uid, ...shown } = draftToRow(accountId, calendarId, "", create);
    void writeEventOptimistically(
      store,
      createChange(pendingEventRow(id, shown), create),
      () => createCalendarEvent({ targetFor: deps.targetFor }, accountId, calendarId, create),
      (out) => out.rows.map((written) => createChange(written, create)),
      id,
    ).catch((error: unknown) => toast.error(i18n.t("pim.eventWriteRefused", { reason: refusalReason(error) }), { label: i18n.t("pim.eventWriteRetry"), run: again }));
  };
  toast.error(i18n.t("pim.eventCreateLost", { title }), { label: i18n.t("pim.eventWriteRetry"), run: again });
}
