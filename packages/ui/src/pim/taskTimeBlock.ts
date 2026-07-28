import {
  setFrontmatterPath,
  readFrontmatterPath,
  wikiTargetForPath,
  type IVaultAdapter,
  type IPimTarget,
  type PimEventDraft,
} from "@plainva/core";
import { markdownToHtml } from "../lib/markdownToHtml";

/**
 * "Block time" on a task (issue #34, wave 3; shared by both shells since S24).
 *
 * The reporter asked for time windows on tasks ("1 h", "13:00–15:00"). Tasks in
 * Plainva are day-granular on purpose — an EVENT is the object that owns a time
 * RANGE, with collision rendering in the grid, provider sync and reminders. So
 * a task keeps its due DATE and gains an event that carries its title.
 *
 * The link is written on BOTH ends, each in the form its side can actually read:
 *   - the event carries a wiki link in its description (readable in Google
 *     Calendar and Outlook too, and rendered as Markdown by Plainva),
 *   - the note carries `plainva.blocks[]` — the `plainva:` namespace is
 *     Obsidian-inert, and this is a DIFFERENT key from `plainva.pim`, which is
 *     already the anchor of a mirrored remote task and of a meeting note.
 *     Writing blocks into that anchor would confuse the task reconciler.
 *
 * A checkbox task has no note of its own, so it only gets the event; the
 * description then points at the note the checkbox lives in.
 */

/** The calendars an event may be WRITTEN into. Visibility (`selected`) is not a
 * write permission — blocking time into a calendar you don't currently display
 * is valid — so only the read-only flag and the account's enabled state gate it.
 * The single source of this rule for every surface offering a calendar picker. */
export function writableCalendarsOf<T extends { id: string; accountId: string; readOnly?: boolean }>(
  calendars: T[],
  enabledAccountIds: ReadonlySet<string>
): T[] {
  return calendars.filter((c) => !c.readOnly && enabledAccountIds.has(c.accountId));
}

/** Calendar picker options ("<accountId> <calendarId>" -> label). The account
 * name is only appended when more than one account exists, so a single-account
 * setup stays uncluttered. Pure. */
export function calendarPickerOptions<T extends { id: string; name: string; accountId: string }>(
  calendars: T[],
  accountLabel: Map<string, string>,
  multiAccount: boolean
): Array<{ value: string; label: string }> {
  return calendars.map((c) => ({
    value: `${c.accountId} ${c.id}`,
    label: multiAccount ? `${c.name} · ${accountLabel.get(c.accountId) ?? ""}` : c.name,
  }));
}

/** The preferred default calendar when it is still an offered option, else the
 * first one. Pure. */
export function resolveDefaultCalendarKey(options: Array<{ value: string }>, preferred: string): string {
  return options.some((o) => o.value === preferred) ? preferred : options[0]?.value ?? "";
}

/** Splits a "<accountId> <calendarId>" picker key. A calendar id may itself
 * contain spaces (CalDAV hrefs do), so only the FIRST space separates. */
export function splitCalendarKey(key: string): { accountId: string; calendarId: string } | null {
  const [accountId, ...rest] = key.split(" ");
  const calendarId = rest.join(" ");
  return accountId && calendarId ? { accountId, calendarId } : null;
}

/** Start of the next half hour as minutes since midnight, capped so a block
 * started late in the evening still begins on the same day. Pure. */
export function nextHalfHourMinutes(now: Date): number {
  const raw = now.getHours() * 60 + now.getMinutes();
  return Math.min(Math.ceil(raw / 30) * 30, 23 * 60);
}

/** "HH:MM" from minutes since midnight. Pure. */
export function minutesToTime(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes since midnight from "HH:MM"; null for anything unparseable. Pure. */
export function timeToMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export interface TaskBlockValues {
  /** Local civil day the block sits on (YYYY-MM-DD). */
  dayKey: string;
  /** Start as "HH:MM" local wall clock. */
  startTime: string;
  /** Length in minutes. */
  durationMinutes: number;
}

/**
 * Builds the event draft for "block time" on a task. The link is a wiki link in
 * the description rather than a provider-private property: it stays readable in
 * Google Calendar and Outlook, and Plainva renders event descriptions as
 * Markdown. Pure.
 */
export function buildTaskBlockDraft(opts: {
  title: string;
  values: TaskBlockValues;
  /** Vault wiki target of the task note; omitted for a task without a note. */
  noteTarget?: string;
}): PimEventDraft {
  const startMin = timeToMinutes(opts.values.startTime) ?? 9 * 60;
  const startTs = new Date(`${opts.values.dayKey}T${minutesToTime(startMin)}:00`).getTime();
  const endTs = startTs + Math.max(5, Math.round(opts.values.durationMinutes)) * 60 * 1000;
  const description = opts.noteTarget ? `[[${opts.noteTarget}]]` : undefined;
  return {
    title: opts.title,
    allDay: false,
    start: { ts: startTs },
    end: { ts: endTs },
    description,
    descriptionHtml: description ? markdownToHtml(description) : undefined,
  };
}

export interface TaskBlockAnchor {
  uid: string;
  account: string;
  calendar: string;
  /** Local start (YYYY-MM-DD HH:MM) — human-readable in the properties panel. */
  start: string;
}

export interface CreateTaskTimeBlockOptions {
  adapter: IVaultAdapter;
  /** Provider target for the chosen calendar's account. */
  target: IPimTarget;
  /** "<accountId> <calendarId>" as picked in the dialog. */
  calendarKey: string;
  title: string;
  values: TaskBlockValues;
  /** Note that owns the task (task-database entry) — gets the anchor. */
  notePath?: string;
  /** Note the block should link to (the task note, or the note a checkbox lives
   * in). Absent = no link in the description. */
  linkPath?: string;
  /** All vault paths, for the shortest unambiguous wiki target. */
  allPaths?: string[];
}

export interface CreateTaskTimeBlockResult {
  uid: string;
  accountId: string;
  calendarId: string;
  /** False when the event was created but the note anchor could not be written
   * — the block exists, so this is a warning, never a failure. */
  anchored: boolean;
}

export async function createTaskTimeBlock(opts: CreateTaskTimeBlockOptions): Promise<CreateTaskTimeBlockResult> {
  const key = splitCalendarKey(opts.calendarKey);
  if (!key) throw new Error("no calendar selected");

  const noteTarget = opts.linkPath ? wikiTargetForPath(opts.linkPath, opts.allPaths ?? [opts.linkPath]) : undefined;
  const draft = buildTaskBlockDraft({ title: opts.title, values: opts.values, noteTarget });
  const res = await opts.target.createEvent(key.calendarId, draft);

  let anchored = false;
  if (opts.notePath) {
    // The event is already live; a note that cannot be written (locked, gone)
    // must not roll it back — the block is the thing the user asked for.
    try {
      const content = await opts.adapter.readTextFile(opts.notePath);
      const anchor: TaskBlockAnchor = {
        uid: res.uid,
        account: key.accountId,
        calendar: key.calendarId,
        start: `${opts.values.dayKey} ${opts.values.startTime}`,
      };
      // setFrontmatterPath, NOT upsertFrontmatterKeys: the latter replaces the
      // whole `plainva` map, which would silently drop the sibling `plainva.pim`
      // anchor of a mirrored remote task.
      const next = setFrontmatterPath(content, ["plainva", "blocks"], [...readTaskBlocks(content), anchor]);
      await opts.adapter.writeTextFile(opts.notePath, next);
      anchored = true;
    } catch {
      anchored = false;
    }
  }

  return { uid: res.uid, accountId: key.accountId, calendarId: key.calendarId, anchored };
}

/** Existing blocks of a task note; anything malformed is ignored rather than
 * throwing — a hand-edited frontmatter must never break blocking. */
export function readTaskBlocks(content: string): TaskBlockAnchor[] {
  const raw = readFrontmatterPath(content, ["plainva", "blocks"]);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (b): b is TaskBlockAnchor =>
      !!b && typeof b === "object" && typeof (b as TaskBlockAnchor).uid === "string" && (b as TaskBlockAnchor).uid.length > 0
  );
}
