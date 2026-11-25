import type { IPimTarget, PimAccountRow, PimCalendar, PimEventRow } from "@plainva/core";
import i18n from "../i18n";
import { logDiagnostic } from "../services/diagnosticsLog";
import { refusalReason } from "../lib/errorText";
import { toast } from "../services/toastStore";
import { createCalendarEvent, createChange, draftToRow } from "./eventWrite";
import { pendingEventRow, SETTLED_EVENT_WRITE_TTL_MS, writeEventOptimistically, type CreatedEventChange, type PendingEventWrites } from "./pendingEventWrites";

/**
 * A created event the views still draw from the overlay, settled where the
 * vault lives - not in a view (issue 119).
 *
 * A create counts as written once the provider accepted it; the overlay draws
 * it until a sync has it. A view knows only the rows of its range, so this
 * asks the cache itself, by the event's id, whatever range is shown, on both
 * shells alike:
 *
 *  - a sync has it: the overlay ends. From then on the cache is the truth - an
 *    event deleted elsewhere later is simply gone, never "lost",
 *  - its account is off or gone, or its calendar is hidden: it is not to be
 *    shown here, and the overlay ends without a word,
 *  - no sync has it after `SETTLED_EVENT_WRITE_TTL_MS`: the provider is asked
 *    (`eventExists`). Held - it stays, asked again after another such time.
 *    Not there - it leaves with a message and "Try again" with what the person
 *    typed. A provider that cannot be asked (the device's own calendars) ends
 *    the overlay as before; one that does not answer keeps it,
 *  - and nothing stays longer than `CREATED_EVENT_GIVE_UP_MS`: a full refresh
 *    runs at least hourly, so an event no refresh has listed by then is left to
 *    the sync and its problems line, not drawn from here.
 */
export const CREATED_EVENT_GIVE_UP_MS = 75 * 60_000;

export interface CreatedEventWatchCache {
  findEventsByUid(uid: string): Promise<PimEventRow[]>;
  listAccounts(): Promise<PimAccountRow[]>;
  listCalendars(): Promise<Array<PimCalendar & { accountId: string; selected: boolean }>>;
}

export interface CreatedEventWatchDeps {
  cache: CreatedEventWatchCache;
  targetFor(accountId: string): Promise<Pick<IPimTarget, "eventExists" | "createEvent" | "provider"> | null>;
  /** A created event the provider does not hold. Default: the message with "Try again". */
  onGone?(created: CreatedEventChange): void;
}

export async function settleCreatedEvents(store: PendingEventWrites, deps: CreatedEventWatchDeps, now: number = Date.now()): Promise<void> {
  const writes = store.settledCreates();
  if (writes.length === 0) return;
  const [accounts, calendars] = await Promise.all([deps.cache.listAccounts(), deps.cache.listCalendars()]);
  for (const created of writes) {
    const { row } = created;
    const cached = await deps.cache.findEventsByUid(row.uid).catch(() => []);
    if (cached.some((cachedRow) => cachedRow.accountId === row.accountId && cachedRow.calendarId === row.calendarId)) {
      store.dropCreated(row);
      continue;
    }
    const account = accounts.find((a) => a.id === row.accountId);
    const calendar = calendars.find((c) => c.accountId === row.accountId && c.id === row.calendarId);
    if (!account || !account.enabled || (calendar && !calendar.selected) || now - created.settledAt > CREATED_EVENT_GIVE_UP_MS) {
      store.dropCreated(row);
      continue;
    }
    if (now - (created.checkedAt ?? created.settledAt) <= SETTLED_EVENT_WRITE_TTL_MS) continue;
    store.markChecked(created.id, now);
    let held: boolean;
    try {
      const target = await deps.targetFor(row.accountId);
      if (!target) continue;
      if (!target.eventExists) {
        store.dropCreated(row);
        continue;
      }
      held = await target.eventExists({ calendarId: row.calendarId, uid: row.uid, etag: row.etag, href: row.href });
    } catch {
      continue;
    }
    if (held) continue;
    store.dropCreated(row);
    (deps.onGone ?? ((gone) => reportCreatedEventGone(store, deps, gone)))(created);
  }
}

/** Runs `settleCreatedEvents` every minute until the returned stop; the store is emptied with it (a vault that closes takes its overlay along). */
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
  return () => {
    clearInterval(timer);
    store.clear();
  };
}

/** The message for a created event the provider does not hold, with "Try again" that creates it anew. */
export function reportCreatedEventGone(store: PendingEventWrites, deps: Pick<CreatedEventWatchDeps, "targetFor">, created: CreatedEventChange): void {
  logDiagnostic("pim", "created event not held by the provider");
  const draft = created.draft;
  const { accountId, calendarId, title } = created.row;
  const again = () => {
    if (!draft?.createAs) return;
    const create = { ...draft, createAs: draft.createAs };
    const id = store.reserve();
    const { uid: _uid, ...shown } = draftToRow(accountId, calendarId, "", create);
    void writeEventOptimistically(
      store,
      createChange(pendingEventRow(id, shown), create),
      () => createCalendarEvent({ targetFor: async (account) => (await deps.targetFor(account)) as IPimTarget | null }, accountId, calendarId, create),
      (out) => out.rows.map((written) => createChange(written, create)),
      id,
    ).catch((error: unknown) => toast.error(i18n.t("pim.eventWriteRefused", { reason: refusalReason(error) }), { label: i18n.t("pim.eventWriteRetry"), run: again }));
  };
  toast.error(i18n.t("pim.eventCreateLost", { title }), draft?.createAs ? { label: i18n.t("pim.eventWriteRetry"), run: again } : undefined);
}
