import {
  entryDateValue,
  eventDayKeys,
  readEntryEvents,
  reconcileEntryEvents,
  writeNoteProperty,
  type EntryEventAnchor,
} from "@plainva/ui";
import { setFrontmatterPath, PLAINVA_NAMESPACE_KEY, type IVaultAdapter, type PimEventRow } from "@plainva/core";

/**
 * The write-back of the writing connection (S19, plan P9b): an entry that was
 * put in the calendar follows its appointment.
 *
 * It runs on the same hook as the task reconciler (after every completed PIM
 * cycle) and touches ONLY notes that carry a `plainva.events` anchor — found in
 * the INDEX, so a vault without a single scheduled entry costs one query and no
 * file reads at all.
 *
 * Two rules keep it from destroying anything:
 *
 *  - It never deletes a note. A vanished appointment drops the anchor and
 *    leaves everything else — the date column keeps its value.
 *  - "I did not look there" is not "it is gone": accounts that were not loaded,
 *    and days outside the cached window, keep their anchors (see
 *    `reconcileEntryEvents`).
 */

export interface EntryEventSyncDeps {
  adapter: IVaultAdapter;
  /** Raw index access — the anchors are read from the indexed `plainva`
   * namespace, not from disk. */
  db: { query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> };
  cache: {
    listAccounts(): Promise<{ id: string; enabled?: boolean }[]>;
    getEventByUid(accountId: string, calId: string, uid: string): Promise<PimEventRow | null>;
  };
  /** The day range the event cache was filled for. */
  window: { startDay: string; endDay: string };
}

export interface EntryEventSyncResult {
  /** Notes whose frontmatter changed — for the index queue. */
  changedNotes: string[];
  errors: string[];
}

/** Path -> anchors, straight from the index. Malformed namespace JSON is
 * skipped, never thrown: a hand-edited frontmatter must not stop the cycle. */
export async function loadAnchoredNotes(
  db: EntryEventSyncDeps["db"]
): Promise<Map<string, EntryEventAnchor[]>> {
  const rows = await db.query(
    `SELECT f.path AS path, p.value AS value
       FROM properties p JOIN files f ON f.id = p.file_id
      WHERE p.key = ?`,
    [PLAINVA_NAMESPACE_KEY]
  );
  const out = new Map<string, EntryEventAnchor[]>();
  for (const row of rows) {
    const path = String(row.path ?? row.PATH ?? "");
    const raw = row.value ?? row.VALUE;
    if (!path || typeof raw !== "string" || !raw.includes("events")) continue;
    try {
      const ns = JSON.parse(raw) as Record<string, unknown>;
      const list = ns.events;
      if (!Array.isArray(list)) continue;
      const anchors = list.filter(
        (a): a is EntryEventAnchor =>
          !!a &&
          typeof a === "object" &&
          typeof (a as EntryEventAnchor).uid === "string" &&
          (a as EntryEventAnchor).uid.length > 0 &&
          typeof (a as EntryEventAnchor).dateField === "string"
      );
      if (anchors.length > 0) out.set(path, anchors);
    } catch {
      /* malformed namespace JSON — this note has no usable anchors */
    }
  }
  return out;
}

export async function runEntryEventSync(deps: EntryEventSyncDeps): Promise<EntryEventSyncResult> {
  const result: EntryEventSyncResult = { changedNotes: [], errors: [] };
  const anchored = await loadAnchoredNotes(deps.db);
  if (anchored.size === 0) return result;

  const accounts = await deps.cache.listAccounts();
  const known = new Set(accounts.filter((a) => a.enabled !== false).map((a) => a.id));

  for (const [path, anchors] of anchored) {
    try {
      // Look each anchor's appointment up by uid — NOT through the visible
      // event list: an unselected calendar is hidden, not deleted.
      const events: PimEventRow[] = [];
      for (const a of anchors) {
        if (!known.has(a.account)) continue;
        const row = await deps.cache.getEventByUid(a.account, a.calendar, a.uid);
        if (row) events.push(row);
      }
      const out = reconcileEntryEvents(
        anchors,
        events,
        known,
        (row) => eventDayKeys(row)[0] ?? "",
        (row) => {
          if (row.allDay || row.start.ts === undefined) return undefined;
          const d = new Date(row.start.ts);
          return d.getHours() * 60 + d.getMinutes();
        },
        deps.window
      );
      if (out.moves.length === 0 && out.dropped.length === 0) continue;

      // Dates first, anchors after: if the date write fails, the anchor still
      // says the old value and the next cycle tries again — the opposite order
      // would forget the move.
      for (const move of out.moves) {
        await writeNoteProperty(deps.adapter, path, move.dateField, entryDateValue(move));
      }
      const content = await deps.adapter.readTextFile(path);
      const next = setFrontmatterPath(
        content,
        ["plainva", "events"],
        out.keep.length > 0 ? out.keep : undefined
      );
      await deps.adapter.writeTextFile(path, next);
      result.changedNotes.push(path);
    } catch (e) {
      result.errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

/** The anchors a note carries, read from DISK — for the cascade deletion plan,
 * which must show what a delete would leave behind at the provider even for a
 * note the index has not caught up with. */
export async function entryEventsOf(adapter: IVaultAdapter, path: string): Promise<EntryEventAnchor[]> {
  try {
    return readEntryEvents(await adapter.readTextFile(path));
  } catch {
    return [];
  }
}
