import { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import type { PimCalendar, PimEvent, PimProviderId, PimTask, PimTaskList } from "./types.js";

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
  /** Non-secret JSON config (server URL, user name, BYO client id …). */
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
    await this.db.execute(`DELETE FROM pim_events WHERE account_id = ?`, [accountId]);
    await this.db.execute(`DELETE FROM pim_tasks WHERE account_id = ?`, [accountId]);
    await this.db.execute(`DELETE FROM pim_state WHERE account_id = ?`, [accountId]);
    await this.db.execute(`DELETE FROM pim_task_state WHERE account_id = ?`, [accountId]);
    await this.db.execute(`DELETE FROM pim_accounts WHERE id = ?`, [accountId]);
  }

  // ---- calendars ----------------------------------------------------------

  async replaceCalendars(accountId: string, calendars: PimCalendar[]): Promise<void> {
    // Keep the user's selection across refreshes: capture, replace, re-apply.
    const prev = await this.db.query<{ cal_id: string; selected: number }>(
      `SELECT cal_id, selected FROM pim_calendars WHERE account_id = ?`,
      [accountId]
    );
    const prevSel = new Map(prev.map((r) => [r.cal_id, r.selected !== 0]));
    await this.db.execute(`DELETE FROM pim_calendars WHERE account_id = ?`, [accountId]);
    for (const group of chunk(calendars, CHUNK)) {
      const values: unknown[] = [];
      for (const c of group) {
        values.push(accountId, c.id, c.name, c.color ?? null, (prevSel.get(c.id) ?? true) ? 1 : 0, c.readOnly ? 1 : 0);
      }
      await this.db.execute(
        `INSERT INTO pim_calendars (account_id, cal_id, name, color, selected, read_only) VALUES ` +
          group.map(() => `(?, ?, ?, ?, ?, ?)`).join(", "),
        values
      );
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
          e.href ?? null
        );
      }
      await this.db.execute(
        `INSERT OR REPLACE INTO pim_events (account_id, cal_id, uid, title, start_ts, end_ts, start_date, end_date, all_day, location, description, attendees, status, etag, series_master, recurrence, href) VALUES ` +
          group.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(", "),
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
              e.location, e.description, e.attendees, e.status, e.etag, e.series_master, e.recurrence, e.href
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
    }));
  }

  // ---- task lists / tasks (read cache; the note reconcile is stage 3) ------

  async replaceTaskLists(accountId: string, lists: PimTaskList[]): Promise<void> {
    const prev = await this.db.query<{ list_id: string; selected: number }>(
      `SELECT list_id, selected FROM pim_tasklists WHERE account_id = ?`,
      [accountId]
    );
    const prevSel = new Map(prev.map((r) => [r.list_id, r.selected !== 0]));
    await this.db.execute(`DELETE FROM pim_tasklists WHERE account_id = ?`, [accountId]);
    for (const group of chunk(lists, CHUNK)) {
      const values: unknown[] = [];
      for (const l of group) values.push(accountId, l.id, l.name, (prevSel.get(l.id) ?? false) ? 1 : 0);
      await this.db.execute(
        `INSERT INTO pim_tasklists (account_id, list_id, name, selected) VALUES ` +
          group.map(() => `(?, ?, ?, ?)`).join(", "),
        values
      );
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
              e.location, e.description, e.attendees, e.status, e.etag, e.series_master, e.recurrence, e.href
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

  async setScopeState(accountId: string, scope: string, opts: { cursor?: string | null; lastSyncTs?: number; lastError?: string | null }): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO pim_state (account_id, scope, cursor, last_sync_ts, last_error) VALUES (?, ?, ?, ?, ?)`,
      [accountId, scope, opts.cursor ?? null, opts.lastSyncTs ?? Date.now(), opts.lastError ?? null]
    );
  }

  async getScopeState(accountId: string, scope: string): Promise<{ cursor: string | null; lastSyncTs: number | null; lastError: string | null } | null> {
    const row = await this.db.queryOne<{ cursor: string | null; last_sync_ts: number | null; last_error: string | null }>(
      `SELECT cursor, last_sync_ts, last_error FROM pim_state WHERE account_id = ? AND scope = ?`,
      [accountId, scope]
    );
    return row ? { cursor: row.cursor, lastSyncTs: row.last_sync_ts, lastError: row.last_error } : null;
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
