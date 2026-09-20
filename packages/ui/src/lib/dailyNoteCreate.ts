/**
 * Resolve-or-create for the daily note — ONE building block for both shells
 * (plan Journal, J2).
 *
 * The desktop had `resolveOrCreateDailyNote`, the phone its own `ensureDailyNote`,
 * and the two had drifted: the phone interpolated the template against "now"
 * (so `{{date}}` in a note opened for LAST Tuesday said today), ignored the
 * configured note type when there was no template, and only added frontmatter
 * to a template that had none at all. This is the desktop's rule for both.
 *
 * Two ways to run it:
 *   - with `resolveTemplate`: a person opens the note, so the questions a
 *     template contains (`{{prompt:…}}`) are asked;
 *   - without: a quick capture creates the note on the way (decision E4) — the
 *     questions resolve to nothing and `{{cursor}}` is removed. A capture that
 *     wants a dialog answered first is not a quick capture.
 */
import { applyTemplatePlaceholders } from "../base/templateFiles";
import type { TemplateContext } from "../base/templateEngine";
import { buildDailyNotePath } from "./dailyNotePath";
import { DEFAULT_DAILY_NOTE_FORMAT } from "./dailyNotes";
import { withOkfDefaults } from "./newNoteContent";

export interface DailyNoteCreateConfig {
  /** Vault-relative folder of the daily notes, "" for the root. */
  folder: string;
  /** Moment-style format of the file name; empty falls back to ISO. */
  format: string;
  /** Folder the templates live in. */
  templateFolder: string;
  /** File name of the daily template inside that folder; "" = none. */
  template: string;
  /** The `type` a daily note gets when its template names none. */
  noteType: string;
}

export interface DailyNoteFiles {
  exists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
  /** Writes a note that does not exist yet, creating the folders it needs. */
  createNote(path: string, content: string): Promise<void>;
}

export interface EnsureDailyNoteOptions {
  /** The moment of creation. `{{time}}` means now, even in a note for another day. */
  now?: Date;
  /** Asked before a missing note is created; `false` creates nothing. */
  confirmCreate?: (path: string) => Promise<boolean>;
  /** Asks the template's questions; `null` = cancelled, nothing is created. Omitted = headless. */
  resolveTemplate?: (raw: string, ctx: { title: string; now: Date; folder: string }) => Promise<{ text: string; cursor: number | null } | null>;
  /** More context for the headless run (vault name, `{{daily+1}}`). */
  templateContext?: Omit<Partial<TemplateContext>, "title" | "now">;
}

export interface EnsuredDailyNote {
  path: string;
  /** The date as the file name spells it — the title of a blank daily note. */
  title: string;
  created: boolean;
  /** What was written; `null` when the note already existed. */
  content: string | null;
  /** Offset of `{{cursor}}` in the written file, when the template had one and was asked interactively. */
  cursor: number | null;
}

/**
 * The reference instant a daily-note template interpolates against: the day the
 * note is FOR, carrying the CURRENT wall-clock time. Both halves matter —
 * `{{date}}` (and `{{date+N}}`) must follow the note's day even when a past or
 * future daily is created, while `{{time}}` means the moment of creation.
 * Passing the raw midnight `date` would turn every `{{time}}` into "00:00".
 */
export function noteStamp(date: Date, now: Date = new Date()): Date {
  const stamp = new Date(date);
  stamp.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return stamp;
}

/** Path of the template file a config names, or "" when it names none. */
export function dailyTemplatePath(config: Pick<DailyNoteCreateConfig, "templateFolder" | "template">): string {
  const name = config.template.trim();
  if (!name) return "";
  const folder = config.templateFolder.trim().replace(/[/\\]+$/, "");
  return folder ? `${folder}/${name}` : name;
}

/**
 * Returns the daily note for `date`, creating it when it is missing. `null`
 * means the person declined — the create question or the template's questions.
 */
export async function ensureDailyNote(
  date: Date,
  config: DailyNoteCreateConfig,
  files: DailyNoteFiles,
  options: EnsureDailyNoteOptions = {},
): Promise<EnsuredDailyNote | null> {
  const folder = config.folder.trim();
  const { fullPath: path, dateStr: title } = buildDailyNotePath(date, config.format.trim() || DEFAULT_DAILY_NOTE_FORMAT, folder);
  if (await files.exists(path)) return { path, title, created: false, content: null, cursor: null };
  if (options.confirmCreate && !(await options.confirmCreate(path))) return null;

  let body = "";
  let caret: number | null = null;
  const templatePath = dailyTemplatePath(config);
  // A template that is named but missing falls back to the blank note below.
  if (templatePath && (await files.exists(templatePath))) {
    const raw = await files.readTextFile(templatePath);
    const stamp = noteStamp(date, options.now);
    if (options.resolveTemplate) {
      const answered = await options.resolveTemplate(raw, { title, now: stamp, folder });
      if (!answered) return null;
      body = answered.text;
      caret = answered.cursor;
    } else {
      body = applyTemplatePlaceholders(raw, title, stamp, { folder, ...options.templateContext });
    }
  }
  // A blank daily note gets an H1 with the date, as every new note does; a
  // template, when there is one, defines the whole body instead.
  if (!body) body = `# ${title}\n`;

  // OKF write rule: a template's own `type` wins, missing pieces are added.
  const content = withOkfDefaults(body, config.noteType);
  await files.createNote(path, content);
  // `{{cursor}}` was measured in the template body; the file may carry
  // frontmatter in front of it.
  return { path, title, created: true, content, cursor: caret === null ? null : caret + (content.length - body.length) };
}
