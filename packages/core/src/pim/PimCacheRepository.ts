import { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import type { PimAttendee, PimAttendeeStatus, PimCalendar, PimEvent, PimProviderId, PimTask, PimTaskList } from "./types.js";
import type { SyncErrorKind } from "../sync/errorKind.js";

/**
 * SQL layer of the PIM cache (index DB, appData — never the vault). Events are
 * replaced per (account, calendar, window) in one shot: the windowed full
 * refresh keeps reconcile logic trivial and cannot leak deleted remote events.
 * All statements are chunked multi-row inserts (the sqlx pool round-trips per
 * execute — same lesson as the indexer's P2.4 batching).
 */

export interface PimAccountRow {
  id: string;
  provider: PimProviderId;
  label: string;
  /** Non-secret JSON config; OAuth compatibility fields are device-local and never shared. */
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface PimEventRow extends PimEvent {
  accountId: string;
}

/** The reconciled field surface of a task note (stage 3 three-way merge). */
export interface PimTaskFields {
  title: string;
  due: string | null;
  completed: boolean;
}

/** Reconcile bookkeeping of one remote task <-> vault note pair. A row with
 * `notePath: null` is a TOMBSTONE: the note was deleted locally, the remote
 * task stays untouched and is never re-imported. */
export interface PimTaskStateRow {
  accountId: string;
  listId: string;
  uid: string;
  notePath: string | null;
  remoteEtag: string | null;
  baseFields: PimTaskFields | null;
}

export interface PimAccountCacheSnapshot {
  version: 1;
  accountId: string;
  tables: Record<PimAccountCacheTable, Array<Record<string, unknown>>>;
}

type PimAccountCacheTable =
  | "pim_accounts"
  | "pim_calendars"
  | "pim_events"
  | "pim_tasklists"
  | "pim_tasks"
  | "pim_state"
  | "pim_task_state";

const ACCOUNT_CACHE_TABLES: ReadonlyArray<{
  name: PimAccountCacheTable;
  accountColumn: "id" | "account_id";
  columns: readonly string[];
}> = [
  { name: "pim_accounts", accountColumn: "id", columns: ["id", "provider", "label", "config", "enabled"] },
  { name: "pim_calendars", accountColumn: "account_id", columns: ["account_id", "cal_id", "name", "color", "selected", "read_only"] },
  {
    name: "pim_events",
    accountColumn: "account_id",
    columns: [
      "account_id", "cal_id", "uid", "title", "start_ts", "end_ts", "start_date", "end_date",
      "all_day", "location", "description", "attendees", "status", "etag", "series_master",
      "recurrence", "href", "color", "rsvps", "block_of",
    ],
  },
  { name: "pim_tasklists", accountColumn: "account_id", columns: ["account_id", "list_id", "name", "selected"] },
  {
    name: "pim_tasks",
    accountColumn: "account_id",
    columns: ["account_id", "list_id", "uid", "title", "notes", "due", "completed", "etag", "updated_ts", "href"],
  },
  { name: "pim_state", accountColumn: "account_id", columns: ["account_id", "scope", "cursor", "last_sync_ts", "last_error"] },
  {
    name: "pim_task_state",
    accountColumn: "account_id",
    columns: ["account_id", "list_id", "uid", "note_path", "remote_etag", "base_fields", "last_sync_ts"],
  },
];

const CHUNK = 80;

export class PimCacheRepository {
  constructor(private db: IDatabaseAdapter) {}

  // ---- accounts -----------------------------------------------------------

  async listAccounts(): Promise<PimAccountRow[]> {
    const rows = await this.db.query<{ id: string; provider: string; label: string | null; config: string | null; enabled: number }>(
      `SELECT id, provider, label, config, enabled FROM pim_accounts ORDER BY label`
    );
    return rows.map((r) => {
      const parsed = safeJson(r.config);
      return {
        id: r.id,
        provider: r.provider as PimProviderId,
        label: r.label ?? "",
        config: parsed && !Array.isArray(parsed) ? parsed : {},
        enabled: r.enabled !== 0,
      };
    });
  }

  async upsertAccount(row: PimAccountRow): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO pim_accounts (id, provider, label, config, enabled) VALUES (?, ?, ?, ?, ?)`,
      [row.id, row.provider, row.label, JSON.stringify(row.config ?? {}), row.enabled ? 1 : 0]
    );
  }

  /** Removes the account and every cached object belonging to it. The
   * calendars/tasklists rows cascade; events/tasks/state are keyed loosely and
   * are swept explicitly. */
  async deleteAccount(accountId: string): Promise<void> {
    await this.db.transaction(async () => {
      for (const table of [...ACCOUNT_CACHE_TABLES].reverse()) {
        await this.db.execute(`DELETE FROM ${table.name} WHERE ${table.accountColumn} = ?`, [accountId]);
      }
    });
  }

  /**
   * Captures the complete non-secret local PIM state before a confirmed
   * account repair removes an orphan. The snapshot is device-local and must
   * never be written to the shared profile or diagnostics.
   */
  async snapshotAccount(accountId: string): Promise<PimAccountCacheSnapshot> {
    const tables = {} as PimAccountCacheSnapshot["tables"];
    for (const table of ACCOUNT_CACHE_TABLES) {
      tables[table.name] = await this.db.query<Record<string, unknown>>(
        `SELECT ${table.columns.join(", ")} FROM ${table.name} WHERE ${table.accountColumn} = ?`,
        [accountId],
      );
    }
    return { version: 1, accountId, tables };
  }

  /** Restores a snapshot exactly, including selection and sync cursors. */
  async restoreAccount(snapshot: PimAccountCacheSnapshot): Promise<void> {
    if (snapshot.version !== 1) throw new Error("unsupported-pim-account-cache-snapshot");
    await this.db.transaction(async () => {
      for (const table of [...ACCOUNT_CACHE_TABLES].reverse()) {
        await this.db.execute(`DELETE FROM ${table.name} WHERE ${table.accountColumn} = ?`, [snapshot.accountId]);
      }
      for (const table of ACCOUNT_CACHE_TABLES) {
        const rows = snapshot.tables[table.name] ?? [];
        for (const row of rows) {
          await this.db.execute(
            `INSERT OR REPLACE INTO ${table.name} (${table.columns.join(", ")}) VALUES (${table.columns.map(() => "?").join(", ")})`,
            table.columns.map((column) => row[column] ?? null),
          );
        }
      }
    });
  }

  /**
   * Removes cached rows whose account no longer exists.
   *
   * `deleteAccount` above is thorough, but it is not the only way an account
   * leaves: the settings profile replaces the account list wholesale when it
   * arrives from another device, and an id that changes on reconnect leaves the
   * old one behind. A vault was found holding 1918 events and their state rows
   * from two accounts that were long gone (finding 2026-07-30).
   *
   * They hurt nothing while every query filters by account — which is exactly
   * what makes this the dangerous kind of leftover. The moment one query widens
   * its view (a search across calendars, a count, an "all calendars" list, the
   * way "all inboxes" widened the mail list), ghosts from deleted accounts would
   * appear as real entries. Sweeping by subquery rather than by a passed-in list
   * keeps it honest even if the caller's idea of "known accounts" is wrong.
   */
  async pruneOrphanedRows(): Promise<void> {
    for (const table of ["pim_events", "pim_tasks", "pim_state", "pim_task_state", "pim_calendars", "pim_tasklists"]) {
      await this.db.execute(`DELETE FROM ${table} WHERE account_id NOT IN (SELECT id FROM pim_accounts)`);
    }
  }

  // ---- calendars ----------------------------------------------------------

  async replaceCalendars(accountId: string, calendars: PimCalendar[]): Promise<void> {
    // Keep the user's selection across refreshes: capture, replace, re-apply.
    const prev = await this.db.query<{ cal_id: string; selected: number }>(
      `SELECT cal_id, selected FROM pim_calendars WHERE account_id = ?`,
      [accountId]
    );
    const prevSel = new Map(prev.map((r) => [r.cal_id, r.selected !== 0]));
    const account = await this.db.queryOne<{ config: string | null }>(`SELECT config FROM pim_accounts WHERE id = ?`, [accountId]);
    const config = safeJson(account?.config ?? null) as Record<string, unknown> | null;
    const pending = config?.plainvaPendingCalendarSelections as Record<string, unknown> | undefined;
    await this.db.execute(`DELETE FROM pim_calendars WHERE account_id = ?`, [accountId]);
    for (const group of chunk(calendars, CHUNK)) {
      const values: unknown[] = [];
      for (const c of group) {
        const pendingSelected = typeof pending?.[c.id] === "boolean" ? pending[c.id] as boolean : undefined;
        values.push(accountId, c.id, c.name, c.color ?? null, (pendingSelected ?? prevSel.get(c.id) ?? true) ? 1 : 0, c.readOnly ? 1 : 0);
      }
      await this.db.execute(
        `INSERT INTO pim_calendars (account_id, cal_id, name, color, selected, read_only) VALUES ` +
          group.map(() => `(?, ?, ?, ?, ?, ?)`).join(", "),
        values
      );
    }
    if (config && pending) {
      delete config.plainvaPendingCalendarSelections;
      await this.db.execute(`UPDATE pim_accounts SET config = ? WHERE id = ?`, [JSON.stringify(config), accountId]);
    }
  }

  async listCalendars(accountId?: string): Promise<Array<PimCalendar & { accountId: string; selected: boolean }>> {
    const rows = await this.db.query<{ account_id: string; cal_id: string; name: string | null; color: string | null; selected: number; read_only: number }>(
      accountId
        ? `SELECT account_id, cal_id, name, color, selected, read_only FROM pim_calendars WHERE account_id = ? ORDER BY name`
        : `SELECT account_id, cal_id, name, color, selected, read_only FROM pim_calendars ORDER BY name`,
      accountId ? [accountId] : []
    );
    return rows.map((r) => ({
      accountId: r.account_id,
      id: r.cal_id,
      name: r.name ?? "",
      color: r.color ?? undefined,
      selected: r.selected !== 0,
      readOnly: r.read_only !== 0,
    }));
  }

  async setCalendarSelected(accountId: string, calId: string, selected: boolean): Promise<void> {
    await this.db.execute(`UPDATE pim_calendars SET selected = ? WHERE account_id = ? AND cal_id = ?`, [
      selected ? 1 : 0,
      accountId,
      calId,
    ]);
  }

  // ---- events -------------------------------------------------------------

  /** Replaces every cached event of (account, calendar) whose start lies in
   * [windowStartTs, windowEndTs) with the fresh pull — one delete + chunked
   * inserts. Rows outside the window (older cache) stay untouched. */
  async replaceEventWindow(
    accountId: string,
    calId: string,
    windowStartTs: number,
    windowEndTs: number,
    events: PimEvent[]
  ): Promise<void> {
    await this.db.execute(
      `DELETE FROM pim_events WHERE account_id = ? AND cal_id = ? AND start_ts >= ? AND start_ts < ?`,
      [accountId, calId, windowStartTs, windowEndTs]
    );
    await this.upsertEvents(accountId, calId, events);
  }

  /**
   * Applies ONE incremental step (C2/S18).
   *
   * The whole difference to `replaceEventWindow` is the deletion rule: there a
   * window is cleared and rewritten, here nothing is removed except the uids
   * the provider explicitly named. An event that is merely absent from this
   * page stays — it is unchanged, not gone, and a delta feed has no way to say
   * "still there" for every row it did not send.
   */
  async applyEventDelta(
    accountId: string,
    calId: string,
    events: PimEvent[],
    deletedUids: string[],
    deletedHrefs: string[] = []
  ): Promise<void> {
    await this.upsertEvents(accountId, calId, events);
    for (const group of chunk(deletedUids, CHUNK)) {
      if (group.length === 0) continue;
      await this.db.execute(
        `DELETE FROM pim_events WHERE account_id = ? AND cal_id = ? AND uid IN (${group.map(() => "?").join(", ")})`,
        [accountId, calId, ...group]
      );
    }
    // A CalDAV resource can hold several VEVENTs (a series and its overrides),
    // so one removed href drops every row that came from it.
    for (const group of chunk(deletedHrefs, CHUNK)) {
      if (group.length === 0) continue;
      await this.db.execute(
        `DELETE FROM pim_events WHERE account_id = ? AND cal_id = ? AND href IN (${group.map(() => "?").join(", ")})`,
        [accountId, calId, ...group]
      );
    }
  }

  /** The insert both paths share — one column list, so a new field cannot
   * reach a full refresh and miss a delta. */
  private async upsertEvents(accountId: string, calId: string, events: PimEvent[]): Promise<void> {
    for (const group of chunk(events, CHUNK)) {
      const values: unknown[] = [];
      for (const e of group) {
        values.push(
          accountId,
          calId,
          e.uid,
          e.title,
          e.start.ts,
          e.end.ts,
          e.start.date ?? null,
          e.end.date ?? null,
          e.allDay ? 1 : 0,
          e.location ?? null,
          e.description ?? null,
          e.attendees && e.attendees.length > 0 ? JSON.stringify(e.attendees) : null,
          e.status ?? null,
          e.etag ?? null,
          e.seriesMaster ?? null,
          e.recurrence ?? null,
          e.href ?? null,
          e.color ?? null,
          e.rsvps && e.rsvps.length > 0 ? JSON.stringify(e.rsvps) : null,
          e.blockOf ?? null,
          // `[]` is stored as "[]", not as NULL: the event said "no reminder",
          // which is a different statement from "the event said nothing".
          e.reminders ? JSON.stringify(e.reminders) : null,
          e.busy ?? null,
          e.meetingUrl ?? null,
          e.categories && e.categories.length > 0 ? JSON.stringify(e.categories) : null,
          e.statusKind ?? null,
          e.workingLocation ?? null
        );
      }
      await this.db.execute(
        `INSERT OR REPLACE INTO pim_events (account_id, cal_id, uid, title, start_ts, end_ts, start_date, end_date, all_day, location, description, attendees, status, etag, series_master, recurrence, href, color, rsvps, block_of, reminders, busy, meeting_url, categories, status_kind, working_loc) VALUES ` +
          group.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(", "),
        values
      );
    }
  }

  /** Event instances overlapping [rangeStartTs, rangeEndTs), selected
   * calendars of enabled accounts only, masters-without-instances excluded
   * (they exist purely to carry the recurrence text). */
  async listEvents(rangeStartTs: number, rangeEndTs: number): Promise<PimEventRow[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT e.account_id, e.cal_id, e.uid, e.title, e.start_ts, e.end_ts, e.start_date, e.end_date, e.all_day,
              e.location, e.description, e.attendees, e.status, e.etag, e.series_master, e.recurrence, e.href, e.color, e.rsvps, e.block_of,
              e.reminders, e.busy, e.meeting_url, e.categories, e.status_kind, e.working_loc
       FROM pim_events e
       JOIN pim_calendars c ON c.account_id = e.account_id AND c.cal_id = e.cal_id
       JOIN pim_accounts a ON a.id = e.account_id
       WHERE a.enabled = 1 AND c.selected = 1
         AND e.end_ts > ? AND e.start_ts < ?
         AND (e.status IS NULL OR e.status != 'cancelled')
         AND e.recurrence IS NULL
       ORDER BY e.start_ts`,
      [rangeStartTs, rangeEndTs]
    );
    return rows.map((r) => ({
      accountId: String(r.account_id),
      calendarId: String(r.cal_id),
      uid: String(r.uid),
      title: String(r.title ?? ""),
      start: { ts: Number(r.start_ts), date: r.start_date ? String(r.start_date) : undefined },
      end: { ts: Number(r.end_ts), date: r.end_date ? String(r.end_date) : undefined },
      allDay: Number(r.all_day) !== 0,
      location: r.location ? String(r.location) : undefined,
      description: r.description ? String(r.description) : undefined,
      attendees: r.attendees ? (safeJson(String(r.attendees)) as string[] | null) ?? undefined : undefined,
      status: (r.status as PimEvent["status"]) ?? undefined,
      etag: r.etag ? String(r.etag) : undefined,
      seriesMaster: r.series_master ? String(r.series_master) : undefined,
      recurrence: r.recurrence ? String(r.recurrence) : undefined,
      href: r.href ? String(r.href) : undefined,
      color: r.color ? String(r.color) : undefined,
      blockOf: r.block_of ? String(r.block_of) : undefined,
      // `r.reminders` is NULL only when the event said nothing; "[]" round-trips
      // as the empty array, which means "no reminder" (S9).
      reminders: r.reminders != null ? (safeJson(String(r.reminders)) as number[] | null) ?? undefined : undefined,
      busy: (r.busy as PimEvent["busy"]) ?? undefined,
      meetingUrl: r.meeting_url ? String(r.meeting_url) : undefined,
      categories: r.categories ? (safeJson(String(r.categories)) as string[] | null) ?? undefined : undefined,
      statusKind: (r.status_kind as PimEvent["statusKind"]) ?? undefined,
      workingLocation: r.working_loc ? String(r.working_loc) : undefined,
      ...rsvpFields(r.rsvps),
    }));
  }

  // ---- task lists / tasks (read cache; the note reconcile is stage 3) ------

  async replaceTaskLists(accountId: string, lists: PimTaskList[]): Promise<void> {
    const prev = await this.db.query<{ list_id: string; selected: number }>(
      `SELECT list_id, selected FROM pim_tasklists WHERE account_id = ?`,
      [accountId]
    );
    const prevSel = new Map(prev.map((r) => [r.list_id, r.selected !== 0]));
    const account = await this.db.queryOne<{ config: string | null }>(`SELECT config FROM pim_accounts WHERE id = ?`, [accountId]);
    const config = safeJson(account?.config ?? null) as Record<string, unknown> | null;
    const pending = config?.plainvaPendingTaskListSelections as Record<string, unknown> | undefined;
    await this.db.execute(`DELETE FROM pim_tasklists WHERE account_id = ?`, [accountId]);
    for (const group of chunk(lists, CHUNK)) {
      const values: unknown[] = [];
      for (const l of group) {
        const pendingSelected = typeof pending?.[l.id] === "boolean" ? pending[l.id] as boolean : undefined;
        values.push(accountId, l.id, l.name, (pendingSelected ?? prevSel.get(l.id) ?? false) ? 1 : 0);
      }
      await this.db.execute(
        `INSERT INTO pim_tasklists (account_id, list_id, name, selected) VALUES ` +
          group.map(() => `(?, ?, ?, ?)`).join(", "),
        values
      );
    }
    if (config && pending) {
      delete config.plainvaPendingTaskListSelections;
      await this.db.execute(`UPDATE pim_accounts SET config = ? WHERE id = ?`, [JSON.stringify(config), accountId]);
    }
  }

  async listTaskLists(accountId?: string): Promise<Array<PimTaskList & { accountId: string; selected: boolean }>> {
    const rows = await this.db.query<{ account_id: string; list_id: string; name: string | null; selected: number }>(
      accountId
        ? `SELECT account_id, list_id, name, selected FROM pim_tasklists WHERE account_id = ? ORDER BY name`
        : `SELECT account_id, list_id, name, selected FROM pim_tasklists ORDER BY name`,
      accountId ? [accountId] : []
    );
    return rows.map((r) => ({ accountId: r.account_id, id: r.list_id, name: r.name ?? "", selected: r.selected !== 0 }));
  }

  async setTaskListSelected(accountId: string, listId: string, selected: boolean): Promise<void> {
    await this.db.execute(`UPDATE pim_tasklists SET selected = ? WHERE account_id = ? AND list_id = ?`, [
      selected ? 1 : 0,
      accountId,
      listId,
    ]);
  }

  async replaceTasks(accountId: string, listId: string, tasks: PimTask[]): Promise<void> {
    await this.db.execute(`DELETE FROM pim_tasks WHERE account_id = ? AND list_id = ?`, [accountId, listId]);
    for (const group of chunk(tasks, CHUNK)) {
      const values: unknown[] = [];
      for (const t of group) {
        values.push(accountId, listId, t.uid, t.title, t.notes ?? null, t.due ?? null, t.completed ? 1 : 0, t.etag ?? null, t.updatedTs ?? null, t.href ?? null);
      }
      await this.db.execute(
        `INSERT INTO pim_tasks (account_id, list_id, uid, title, notes, due, completed, etag, updated_ts, href) VALUES ` +
          group.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(", "),
        values
      );
    }
  }

  async listTasks(accountId: string, listId: string): Promise<PimTask[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT uid, title, notes, due, completed, etag, updated_ts, href FROM pim_tasks WHERE account_id = ? AND list_id = ? ORDER BY title`,
      [accountId, listId]
    );
    return rows.map((r) => ({
      uid: String(r.uid),
      listId,
      title: String(r.title ?? ""),
      notes: r.notes ? String(r.notes) : undefined,
      due: r.due ? String(r.due) : undefined,
      completed: Number(r.completed) !== 0,
      etag: r.etag ? String(r.etag) : undefined,
      updatedTs: r.updated_ts != null ? Number(r.updated_ts) : undefined,
      href: r.href ? String(r.href) : undefined,
    }));
  }

  /** Single cached event row by key — series-scope actions ("all events")
   * need the MASTER row (etag/href for the write), which listEvents excludes. */
  async getEventByUid(accountId: string, calId: string, uid: string): Promise<PimEventRow | null> {
    const r = await this.db.queryOne<Record<string, unknown>>(
      `SELECT e.account_id, e.cal_id, e.uid, e.title, e.start_ts, e.end_ts, e.start_date, e.end_date, e.all_day,
              e.location, e.description, e.attendees, e.status, e.etag, e.series_master, e.recurrence, e.href, e.color, e.rsvps, e.block_of,
              e.reminders, e.busy, e.meeting_url, e.categories, e.status_kind, e.working_loc
       FROM pim_events e WHERE e.account_id = ? AND e.cal_id = ? AND e.uid = ?`,
      [accountId, calId, uid]
    );
    if (!r) return null;
    return {
      accountId: String(r.account_id),
      calendarId: String(r.cal_id),
      uid: String(r.uid),
      title: String(r.title ?? ""),
      start: { ts: Number(r.start_ts), date: r.start_date ? String(r.start_date) : undefined },
      end: { ts: Number(r.end_ts), date: r.end_date ? String(r.end_date) : undefined },
      allDay: Number(r.all_day) !== 0,
      location: r.location ? String(r.location) : undefined,
      description: r.description ? String(r.description) : undefined,
      attendees: r.attendees ? (safeJson(String(r.attendees)) as string[] | null) ?? undefined : undefined,
      status: (r.status as PimEvent["status"]) ?? undefined,
      etag: r.etag ? String(r.etag) : undefined,
      seriesMaster: r.series_master ? String(r.series_master) : undefined,
      recurrence: r.recurrence ? String(r.recurrence) : undefined,
      href: r.href ? String(r.href) : undefined,
      color: r.color ? String(r.color) : undefined,
      blockOf: r.block_of ? String(r.block_of) : undefined,
      // `r.reminders` is NULL only when the event said nothing; "[]" round-trips
      // as the empty array, which means "no reminder" (S9).
      reminders: r.reminders != null ? (safeJson(String(r.reminders)) as number[] | null) ?? undefined : undefined,
      busy: (r.busy as PimEvent["busy"]) ?? undefined,
      meetingUrl: r.meeting_url ? String(r.meeting_url) : undefined,
      categories: r.categories ? (safeJson(String(r.categories)) as string[] | null) ?? undefined : undefined,
      statusKind: (r.status_kind as PimEvent["statusKind"]) ?? undefined,
      workingLocation: r.working_loc ? String(r.working_loc) : undefined,
      ...rsvpFields(r.rsvps),
    };
  }

  // ---- task <-> note reconcile state (stage 3) ----------------------------

  async getTaskStates(accountId: string, listId: string): Promise<PimTaskStateRow[]> {
    const rows = await this.db.query<{ uid: string; note_path: string | null; remote_etag: string | null; base_fields: string | null }>(
      `SELECT uid, note_path, remote_etag, base_fields FROM pim_task_state WHERE account_id = ? AND list_id = ?`,
      [accountId, listId]
    );
    return rows.map((r) => ({
      accountId,
      listId,
      uid: r.uid,
      notePath: r.note_path,
      remoteEtag: r.remote_etag,
      baseFields: r.base_fields ? (safeJson(r.base_fields) as unknown as PimTaskFields | null) : null,
    }));
  }

  async upsertTaskState(row: PimTaskStateRow): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO pim_task_state (account_id, list_id, uid, note_path, remote_etag, base_fields, last_sync_ts) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.accountId, row.listId, row.uid, row.notePath, row.remoteEtag, row.baseFields ? JSON.stringify(row.baseFields) : null, Date.now()]
    );
  }

  async deleteTaskState(accountId: string, listId: string, uid: string): Promise<void> {
    await this.db.execute(`DELETE FROM pim_task_state WHERE account_id = ? AND list_id = ? AND uid = ?`, [accountId, listId, uid]);
  }

  // ---- per-account sync bookkeeping ---------------------------------------

  /**
   * Writes one scope's bookkeeping.
   *
   * `cursor` distinguishes THREE cases, and the distinction is the point (S18):
   * omitted means "leave whatever is there", `null` means "throw it away, the
   * next cycle does a full refresh", a string means "continue from here". Until
   * S18 the column had no reader, so `INSERT OR REPLACE` with a null default was
   * harmless — the moment it has one, every one of the eight callers that only
   * records an error would silently wipe it, and the delta would never survive
   * a single cycle.
   */
  async setScopeState(
    accountId: string,
    scope: string,
    opts: { cursor?: string | null; lastSyncTs?: number; lastError?: string | null; lastErrorKind?: SyncErrorKind | null }
  ): Promise<void> {
    const cursor =
      opts.cursor === undefined ? (await this.getScopeState(accountId, scope))?.cursor ?? null : opts.cursor;
    await this.db.execute(
      `INSERT OR REPLACE INTO pim_state (account_id, scope, cursor, last_sync_ts, last_error, last_error_kind) VALUES (?, ?, ?, ?, ?, ?)`,
      [accountId, scope, cursor, opts.lastSyncTs ?? Date.now(), opts.lastError ?? null, opts.lastErrorKind ?? null]
    );
  }

  async getScopeState(
    accountId: string,
    scope: string
  ): Promise<{ cursor: string | null; lastSyncTs: number | null; lastError: string | null; lastErrorKind: SyncErrorKind | null } | null> {
    const row = await this.db.queryOne<{
      cursor: string | null;
      last_sync_ts: number | null;
      last_error: string | null;
      last_error_kind: string | null;
    }>(
      `SELECT cursor, last_sync_ts, last_error, last_error_kind FROM pim_state WHERE account_id = ? AND scope = ?`,
      [accountId, scope]
    );
    if (!row) return null;
    // Anything but the two known words reads as unknown, so a row written by an
    // older build is retried rather than parked.
    const kind = row.last_error_kind === "fatal" || row.last_error_kind === "transient" ? row.last_error_kind : null;
    return { cursor: row.cursor, lastSyncTs: row.last_sync_ts, lastError: row.last_error, lastErrorKind: kind };
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function safeJson(raw: string | null): Record<string, unknown> | string[] | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Parses the cached RSVP JSON and derives the account user's own status. */
function rsvpFields(raw: unknown): { rsvps?: PimAttendee[]; selfResponse?: PimAttendeeStatus } {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return {};
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return {};
  const rsvps = parsed as PimAttendee[];
  return { rsvps, selfResponse: rsvps.find((a) => a.self)?.status };
}
