import { setFrontmatterPath, readFrontmatterPath, wikiTargetForPath, type IVaultAdapter, type IPimTarget } from "@plainva/core";
import { buildTaskBlockDraft, splitCalendarKey, type TaskBlockValues } from "./calendarModel";

/**
 * "Block time" on a task (issue #34, wave 3): creates an ordinary calendar
 * event for a task instead of teaching the task model about times.
 *
 * The reporter asked for time windows on tasks ("1 h", "13:00–15:00"). Tasks in
 * Plainva are day-granular on purpose — an event is the object that owns a time
 * RANGE, with collision rendering in the grid, provider sync and reminders. So
 * a task keeps its due DATE and gains an event that carries its title.
 *
 * The link is written on BOTH ends, each in the form its side can actually read:
 *   - the event carries a wiki link in its description (readable in Google
 *     Calendar and Outlook too, and rendered as Markdown by Plainva),
 *   - the note carries `plainva.blocks[]` — the `plainva:` namespace is
 *     Obsidian-inert, and this is a DIFFERENT key from `plainva.pim`, which is
 *     already the anchor of a mirrored remote task (taskSync.ts) and of a
 *     meeting note. Writing blocks into that anchor would confuse the task
 *     reconciler.
 *
 * A checkbox task has no note of its own, so it only gets the event; the
 * description then points at the note the checkbox lives in.
 */

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
      // anchor of a mirrored remote task (caught by the test below).
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
