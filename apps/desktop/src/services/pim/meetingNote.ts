import { upsertFrontmatterKeys, readFrontmatterPath, type PimEventRow } from "@plainva/core";
import { buildNewNoteContent } from "../newNote";
import { taskDbFileStem } from "../taskDatabase";

/**
 * "Termin → Meeting-Notiz" (PIM stage 2c): resolves the vault note belonging to
 * a calendar event, creating it on first use. The note is a NORMAL note that
 * rides the existing file sync; the link back to the event is a frontmatter
 * anchor in the note's `plainva:` namespace (`plainva.pim`) — Obsidian-inert,
 * and stage 3 uses the same anchor for two-way task/event reconciliation.
 *
 * Resolution is anchor-first: the deterministic name (`YYYY-MM-DD Title.md` in
 * the meetings folder) is only the starting point — an existing file at that
 * name is reused when its anchor matches the event's uid, otherwise numbered
 * siblings are probed so two same-titled events on one day never share a note.
 */

const MAX_TITLE_STEM = 80;

export interface MeetingNoteAdapter {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
}

/** File-name stem for a meeting note: `YYYY-MM-DD Title`, sanitized and capped. */
export function meetingNoteStem(dayKey: string, title: string): string {
  const clean = taskDbFileStem(title) ?? "";
  const capped = clean.length > MAX_TITLE_STEM ? clean.slice(0, MAX_TITLE_STEM).trim() : clean;
  return capped ? `${dayKey} ${capped}` : dayKey;
}

export interface ResolveMeetingNoteOptions {
  adapter: MeetingNoteAdapter;
  event: PimEventRow;
  /** Local day key (YYYY-MM-DD) of the day the user clicked the event on. */
  dayKey: string;
  /** Vault-relative meetings folder (default "Meetings"). */
  folder: string;
  /** OKF `type` for a freshly created note. */
  noteType: string;
}

export interface ResolveMeetingNoteResult {
  path: string;
  created: boolean;
}

export async function resolveOrCreateMeetingNote(opts: ResolveMeetingNoteOptions): Promise<ResolveMeetingNoteResult> {
  const { adapter, event, dayKey, folder, noteType } = opts;
  const dir = folder.replace(/^\/+|\/+$/g, "");
  const prefix = dir ? dir + "/" : "";
  const stem = meetingNoteStem(dayKey, event.title || dayKey);

  // Probe the deterministic name and its numbered siblings: reuse on anchor
  // match, create at the first free slot. A same-named foreign note (no or
  // different anchor) is never touched.
  for (let n = 1; n < 50; n++) {
    const path = prefix + (n === 1 ? stem : `${stem} ${n}`) + ".md";
    if (!(await adapter.exists(path))) {
      if (dir) await adapter.createDir(dir).catch(() => undefined);
      await adapter.writeTextFile(path, buildMeetingNoteContent(event, dayKey, noteType));
      return { path, created: true };
    }
    try {
      const existing = await adapter.readTextFile(path);
      if (readFrontmatterPath(existing, ["plainva", "pim", "uid"]) === event.uid) {
        return { path, created: false };
      }
    } catch {
      /* unreadable sibling — skip to the next slot */
    }
  }
  // Pathological fallback: uid-suffixed name is collision-free by construction.
  const path = prefix + `${stem} ${event.uid.slice(0, 8)}.md`;
  if (!(await adapter.exists(path))) {
    if (dir) await adapter.createDir(dir).catch(() => undefined);
    await adapter.writeTextFile(path, buildMeetingNoteContent(event, dayKey, noteType));
    return { path, created: true };
  }
  return { path, created: false };
}

/** Fresh meeting-note content: OKF frontmatter + H1 + structured event fields. */
export function buildMeetingNoteContent(event: PimEventRow, dayKey: string, noteType: string): string {
  const base = buildNewNoteContent(noteType, event.title || dayKey);
  const updates: Record<string, unknown> = {
    date: dayKey,
    plainva: { pim: { uid: event.uid, account: event.accountId, calendar: event.calendarId } },
  };
  if (event.location) updates.location = event.location;
  if (event.attendees && event.attendees.length > 0) updates.attendees = event.attendees;
  try {
    return upsertFrontmatterKeys(base, updates);
  } catch {
    return base;
  }
}
