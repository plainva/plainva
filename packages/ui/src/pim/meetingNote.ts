import { trimChars } from "@plainva/core";
import {
  upsertFrontmatterKeys,
  readFrontmatterPath,
  setFrontmatterPath,
  type PimEvent,
  type PimEventRow,
} from "@plainva/core";
import { buildNewNoteContent, withOkfDefaults } from "../lib/newNoteContent";
import { taskDbFileStem } from "../lib/taskDatabase";
import {
  resolveTemplateForNewNote,
  templateFilePath,
  type FolderTemplateRule,
  type TypeTemplateRule,
} from "../lib/folderTemplates";
import { resolveTemplate, type TemplateContext, type TemplateEvent } from "../base/templateEngine";
import { finalizeTemplate, withoutTemplateOnlyKeys } from "../base/templateFiles";
import { noteStamp } from "../lib/dailyNoteCreate";
import { shiftDayKey } from "./calendarForm";

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
 *
 * Shared with the phone (S27). The anchor is the interesting part: it is what
 * stage 3 reconciles against, so a second implementation writing a slightly
 * different one would break the link between an event and its note on the very
 * devices that are supposed to see the same vault.
 *
 * A new note can start from a template (plan Befunde 24.09., E24): the vault's
 * "meeting note template" setting, else the folder and type rules every other
 * new note follows — before, this was the one way of creating a note that went
 * around them. The template shapes the note; the event's anchor, date,
 * location and attendees are written AFTER it has rendered, so no template can
 * break the link to its event. Without a template the note is exactly what it
 * always was.
 */

const MAX_TITLE_STEM = 80;

/** The placeholders a meeting-note template can use, as both settings pages
 *  list them. `{{title}}` is the event's title; the rest exist only here. */
export const MEETING_TEMPLATE_TOKENS: readonly string[] = [
  "title",
  "start",
  "end",
  "location",
  "attendees",
  "organizer",
  "link",
  "description",
];

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

/** Where a vault keeps what decides a meeting note's template. */
export interface MeetingTemplateSettings {
  /** The setting "Meeting note template": a template name or vault path; "" = none. */
  template: string;
  /** Folder → template rules (Vorlagen-Engine P4). */
  folderRules: readonly FolderTemplateRule[];
  /** Type → template rules (Vorlagen-Engine P4b). */
  typeRules: readonly TypeTemplateRule[];
  /** The vault's templates folder — where a bare template name is looked up. */
  templateFolder: string;
}

/** An interactive template run: the shell asks the template's questions. */
export type MeetingTemplateAsk = (
  raw: string,
  ctx: TemplateContext
) => Promise<{ text: string; cursor: number | null } | null>;

export interface ResolveMeetingNoteOptions {
  adapter: MeetingNoteAdapter;
  event: PimEventRow;
  /** Local day key (YYYY-MM-DD) of the event's first day (`eventStartDayKey`). */
  dayKey: string;
  /** Vault-relative meetings folder (default "Meetings"). */
  folder: string;
  /** OKF `type` for a freshly created note. */
  noteType: string;
  /** Template settings; omitted = the built-in note, as before E24. */
  templates?: MeetingTemplateSettings;
  /**
   * Asks the template's questions (`{{prompt:…}}`) — a person clicked, so the
   * questions are asked, as for every other note a person creates. `null`
   * from it means cancelled: nothing is created. Omitted = headless.
   */
  resolveTemplate?: MeetingTemplateAsk;
  /** More context for the template: vault name, `{{daily}}`, week start. */
  templateContext?: Omit<Partial<TemplateContext>, "title" | "now" | "folder" | "event">;
  /** The moment of creation — `{{time}}`; `{{date}}` follows the event's day. */
  now?: Date;
}

export interface ResolveMeetingNoteResult {
  path: string;
  created: boolean;
  /** Offset of the template's `{{cursor}}` in the written file, when it had one. */
  cursor?: number;
}

/**
 * The template a new meeting note starts from, as a vault path; `""` = none.
 *
 * The order (E24):
 *   1. the setting "Meeting note template" — naming a template for exactly
 *      this kind of note is the most deliberate statement there is;
 *   2. a folder rule covering the meetings folder;
 *   3. a type rule for the note's type ("Meeting").
 * The first one that NAMES a template decides. When that file is missing the
 * note falls back to the built-in content, not to the next rule — the same
 * rule every other new note follows (a renamed template must not quietly swap
 * in a different one).
 */
export function meetingTemplatePath(settings: MeetingTemplateSettings, folder: string, noteType: string): string {
  const name =
    settings.template.trim() ||
    resolveTemplateForNewNote(settings.folderRules, settings.typeRules, folder, noteType) ||
    "";
  return name ? templateFilePath(name, settings.templateFolder) : "";
}

function dayKeyDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * What a template can read from an event. An all-day event's end is its LAST
 * day — the providers store the day after, and `{{end}}` saying "Friday" for a
 * meeting that ends on Thursday is a wrong statement, not a convention. The
 * organizer is the person the event's own attendee list marks as such — the
 * same one the preview shows.
 */
export function meetingTemplateEvent(event: PimEvent): TemplateEvent {
  let start: Date;
  let end: Date;
  if (event.allDay && event.start.date) {
    const first = event.start.date;
    const last = event.end.date && event.end.date > first ? shiftDayKey(event.end.date, -1) : first;
    start = dayKeyDate(first);
    end = dayKeyDate(last);
  } else {
    start = new Date(event.start.ts);
    end = new Date(event.end.ts);
  }
  const organizer = event.rsvps?.find((a) => a.organizer);
  return {
    start,
    end,
    allDay: event.allDay,
    location: event.location || undefined,
    attendees: event.attendees ?? [],
    organizer: organizer ? organizer.name || organizer.email || undefined : undefined,
    link: event.meetingUrl || undefined,
    description: event.description || undefined,
  };
}

export interface MeetingNoteContent {
  content: string;
  /** Offset of `{{cursor}}` in `content`, or null. */
  cursor: number | null;
}

/**
 * The event's own fields, written over whatever the template produced: the
 * anchor (`plainva.pim`), the date, and — when the event has them — location
 * and attendees, as the built-in note carries them.
 *
 * The anchor goes in by PATH, so other `plainva` keys of the template (icon,
 * header colour) survive; a template whose `plainva` is not a map at all loses
 * it to the anchor. Returns null when the frontmatter cannot be written or the
 * anchor does not read back — the caller then writes the built-in note, because
 * a meeting note without its anchor is the one outcome that must not happen:
 * the next click would not find it and create a second one.
 */
function withEventFields(text: string, event: PimEventRow, dayKey: string): string | null {
  const anchor = { uid: event.uid, account: event.accountId, calendar: event.calendarId };
  let out: string;
  try {
    out = setFrontmatterPath(text, ["plainva", "pim"], anchor);
  } catch {
    try {
      out = upsertFrontmatterKeys(text, { plainva: { pim: anchor } });
    } catch {
      return null;
    }
  }
  const updates: Record<string, unknown> = { date: dayKey };
  if (event.location) updates.location = event.location;
  if (event.attendees && event.attendees.length > 0) updates.attendees = event.attendees;
  try {
    out = upsertFrontmatterKeys(out, updates);
  } catch {
    return null;
  }
  return readFrontmatterPath(out, ["plainva", "pim", "uid"]) === event.uid ? out : null;
}

/**
 * A new meeting note from a template. `null` = the person cancelled the
 * template's questions; a template that cannot carry the anchor yields the
 * built-in note instead (see `withEventFields`).
 */
export async function buildMeetingNoteFromTemplate(
  raw: string,
  opts: Pick<ResolveMeetingNoteOptions, "event" | "dayKey" | "noteType" | "resolveTemplate" | "templateContext" | "now"> & { folder: string }
): Promise<MeetingNoteContent | null> {
  const { event, dayKey, noteType } = opts;
  const ctx: TemplateContext = {
    ...opts.templateContext,
    title: event.title || dayKey,
    // `{{date}}` is the meeting's day, `{{time}}` the moment of writing — the
    // same split the daily note makes.
    now: noteStamp(dayKeyDate(dayKey), opts.now),
    folder: opts.folder,
    event: meetingTemplateEvent(event),
  };

  let body: string;
  let cursor: number | null = null;
  if (opts.resolveTemplate) {
    const answered = await opts.resolveTemplate(raw, ctx);
    if (!answered) return null;
    body = answered.text;
    cursor = answered.cursor;
  } else {
    // Headless: questions take their default, `{{cursor}}` is removed.
    body = finalizeTemplate(resolveTemplate(raw, ctx, "headless").text).text;
  }

  const content = withEventFields(withOkfDefaults(withoutTemplateOnlyKeys(body), noteType), event, dayKey);
  if (content === null) return { content: buildMeetingNoteContent(event, dayKey, noteType), cursor: null };
  // Everything above rewrote the frontmatter only; `{{cursor}}` was measured
  // in the body, which moved by exactly what grew in front of it.
  const shifted = cursor === null ? null : cursor + (content.length - body.length);
  return { content, cursor: shifted !== null && shifted >= 0 && shifted <= content.length ? shifted : null };
}

/** The content a new note gets: from its template, else the built-in one. */
async function newMeetingNoteContent(opts: ResolveMeetingNoteOptions, folder: string): Promise<MeetingNoteContent | null> {
  const { adapter, event, dayKey, noteType, templates } = opts;
  const builtIn = (): MeetingNoteContent => ({ content: buildMeetingNoteContent(event, dayKey, noteType), cursor: null });
  const templatePath = templates ? meetingTemplatePath(templates, folder, noteType) : "";
  if (!templatePath) return builtIn();
  let raw: string;
  try {
    // A template that has since been renamed or deleted must not stop the note.
    if (!(await adapter.exists(templatePath))) return builtIn();
    raw = await adapter.readTextFile(templatePath);
  } catch {
    return builtIn();
  }
  return buildMeetingNoteFromTemplate(raw, { ...opts, folder });
}

/**
 * Without a question-asker nothing can be cancelled, so the result is always a
 * note; with one, `null` means the person cancelled and nothing was written.
 */
export function resolveOrCreateMeetingNote(
  opts: ResolveMeetingNoteOptions & { resolveTemplate?: undefined }
): Promise<ResolveMeetingNoteResult>;
export function resolveOrCreateMeetingNote(opts: ResolveMeetingNoteOptions): Promise<ResolveMeetingNoteResult | null>;
export async function resolveOrCreateMeetingNote(opts: ResolveMeetingNoteOptions): Promise<ResolveMeetingNoteResult | null> {
  const { adapter, event, dayKey, folder } = opts;
  const dir = trimChars(folder, "/");
  const prefix = dir ? dir + "/" : "";
  const stem = meetingNoteStem(dayKey, event.title || dayKey);

  const create = async (path: string): Promise<ResolveMeetingNoteResult | null> => {
    // The content first: a cancelled question must leave no folder behind.
    const built = await newMeetingNoteContent(opts, dir);
    if (!built) return null;
    if (dir) await adapter.createDir(dir).catch(() => undefined);
    await adapter.writeTextFile(path, built.content);
    return built.cursor === null ? { path, created: true } : { path, created: true, cursor: built.cursor };
  };

  // Probe the deterministic name and its numbered siblings: reuse on anchor
  // match, create at the first free slot. A same-named foreign note (no or
  // different anchor) is never touched.
  for (let n = 1; n < 50; n++) {
    const path = prefix + (n === 1 ? stem : `${stem} ${n}`) + ".md";
    if (!(await adapter.exists(path))) return create(path);
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
  if (!(await adapter.exists(path))) return create(path);
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
