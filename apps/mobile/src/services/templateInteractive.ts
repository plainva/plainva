import {
  buildDailyNotePath,
  finalizeTemplate,
  resolveTemplate,
  resolveTemplateForNewNote,
  templateAsNewNote,
  templateFilePath,
  withOkfDefaults,
  type TemplateContext,
} from "@plainva/ui";
import { getWeekStartSetting, weekStartDayOf } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { mTemplateAnswers } from "./mobileDialogs";
import { getMobileSettings } from "./mobileSettings";
import { readEditorSelection } from "./editorSelection";

/**
 * The interactive half of the template pipeline on the phone
 * (plan Vorlagen-Engine, P6) — the mobile twin of the desktop service.
 *
 * Same three steps, same contract: resolve → ask once → finalize, and
 * cancelling returns null so the caller writes nothing. What differs is only
 * the shell: the questions arrive as a bottom sheet, and the clipboard is the
 * web API rather than Tauri's.
 *
 * Background paths (sync, task promotion, mail capture) deliberately keep
 * calling the headless `applyTemplatePlaceholders` — a dialog inside a sync
 * cycle would be worse than an unresolved placeholder.
 */

export interface InteractiveTemplateResult {
  text: string;
  /** Caret offset from `{{cursor}}`, relative to `text`. */
  cursor: number | null;
}

/**
 * Fills in the context pieces the mobile shell owns.
 *
 * `weekStart` comes from the shared setting since S26. It used to be left
 * unset — the phone had no first-day-of-week preference, so `{{weekday:…}}`
 * fell back to Monday, which is a guess and a wrong one every Sunday for
 * anyone whose week starts elsewhere.
 *
 * The clipboard is read ONLY when the template carries the token — reading it
 * on every note creation is an overreach (and a permission prompt on iOS) for
 * something almost no template uses.
 */
export async function withShellContext(raw: string, ctx: TemplateContext): Promise<TemplateContext> {
  const next: TemplateContext = { ...ctx };
  if (next.weekStart === undefined) next.weekStart = weekStartDayOf(await getWeekStartSetting());
  if (next.selection === undefined) next.selection = () => readEditorSelection();
  if (next.clipboardLabel === undefined) {
    next.clipboardLabel = i18n.t("templatePicker.clipboardLabel", { defaultValue: "Zwischenablage" });
  }
  if (next.clipboard === undefined && raw.includes("{{clipboard")) {
    let text: string | null = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = null; // denied or empty — the token reports itself unresolved
    }
    next.clipboard = () => text;
  }
  return next;
}

/** Runs the pipeline; null = cancelled, and the caller creates nothing. */
export async function applyTemplateInteractive(
  raw: string,
  ctx: TemplateContext,
): Promise<InteractiveTemplateResult | null> {
  const resolved = resolveTemplate(raw, await withShellContext(raw, ctx), "interactive");
  let answers: Record<string, string> = {};
  if (resolved.requests.length > 0) {
    const given = await mTemplateAnswers({
      title: i18n.t("templatePicker.answersTitle", { defaultValue: "Angaben für die Vorlage" }),
      fields: resolved.requests,
    });
    if (given === null) return null;
    answers = given;
  }
  return finalizeTemplate(resolved.text, answers);
}

/**
 * The template a new note in `folder` starts from, or `""` when no rule
 * matches (plan Vorlagen-Engine P4/P4b).
 *
 * The rules are set on the desktop and travel through the settings profile;
 * the phone only applies them. That is the whole point — a note created in
 * `Projekte/` has to start the same way whichever device is at hand.
 */
export function templateForNewNote(folder: string, type: string): string {
  const ms = getMobileSettings();
  return resolveTemplateForNewNote(ms.folderTemplates, ms.typeTemplates, folder, type) ?? "";
}

/** Vault-relative path of a template named by a rule or picked by hand. */
export function templatePathOf(name: string): string {
  // The naming rule is shared with the desktop and the meeting-note template.
  return templateFilePath(name, getMobileSettings().templateFolder || "Templates");
}

export interface NewNoteContent {
  /** Full file content, OKF frontmatter included. */
  content: string;
  /** Caret offset in that content from `{{cursor}}`, or null. */
  caret: number | null;
}

/**
 * A template's text as the content of a new note titled `title` in `folder`:
 * its questions asked, the OKF header on it, `{{cursor}}` found in the result.
 * `null`: the questions were cancelled, and nothing is created.
 *
 * The ONE place the phone turns a template into a note. The template a rule
 * or a database names (`buildNewNoteFromTemplate`) and the one picked by hand
 * (`vaultOps.createNoteFromTemplate`) both end here, and the header is the
 * shared writer's (`templateAsNewNote`), as on the desktop: `type` goes into
 * the block the template carries, a `type` of its own wins, and the text
 * arrives byte for byte.
 *
 * Both places used to set a header string of their own (finding 2026-10-09),
 * and only in front of a text without a properties block: a template whose
 * block named no `type` — also the empty block — made a note without one, and
 * a blank line stood between header and text that the desktop does not write.
 */
export async function buildNewNoteFromTemplateText(opts: {
  /** The template as it was read, placeholders unresolved. */
  raw: string;
  vaultName: string;
  folder: string;
  title: string;
  type: string;
}): Promise<NewNoteContent | null> {
  const ms = getMobileSettings();
  const now = new Date();
  const answered = await applyTemplateInteractive(opts.raw, {
    title: opts.title,
    now,
    folder: opts.folder,
    vaultName: opts.vaultName,
    dailyPath: (offset) => {
      const d = new Date(now);
      d.setDate(d.getDate() + offset);
      return buildDailyNotePath(d, ms.dailyFormat, ms.dailyFolder).fullPath.replace(/\.md$/i, "");
    },
  });
  return answered ? templateAsNewNote(answered, opts.type) : null;
}

/**
 * Content for a new note, template rules applied (plan Vorlagen-Engine P6).
 *
 * Returns `null` when the person cancelled the template's questions — the
 * caller then creates nothing at all, rather than a note with empty answers.
 * A rule pointing at a template that has since been renamed or deleted must
 * not stop the note from being created: it falls back to the plain skeleton.
 */
export async function buildNewNoteFromTemplate(opts: {
  read: (path: string) => Promise<string>;
  exists: (path: string) => Promise<boolean>;
  vaultName: string;
  folder: string;
  title: string;
  type: string;
  /** Template chosen explicitly; beats every rule. */
  explicitTemplate?: string;
  /** Text used when no template applies (`# Title`); it gets its header here, like a template's. */
  fallbackBody: string;
}): Promise<NewNoteContent | null> {
  const name = opts.explicitTemplate?.trim() || templateForNewNote(opts.folder, opts.type);
  const path = name ? templatePathOf(name) : "";
  if (path && (await opts.exists(path).catch(() => false))) {
    return buildNewNoteFromTemplateText({
      raw: await opts.read(path),
      vaultName: opts.vaultName,
      folder: opts.folder,
      title: opts.title,
      type: opts.type,
    });
  }
  return { content: withOkfDefaults(opts.fallbackBody, opts.type), caret: null };
}

/**
 * One named template, resolved with its questions for a note titled `title`
 * in `folder` — the pinboard entry's default template (plan Befunde
 * 2026-09-24, E16). `undefined`: no such file, the entry starts empty;
 * `null`: the questions were cancelled, and nothing is created.
 */
export async function answerTemplateFile(opts: {
  read: (path: string) => Promise<string>;
  exists: (path: string) => Promise<boolean>;
  vaultName: string;
  folder: string;
  title: string;
  template: string;
}): Promise<InteractiveTemplateResult | null | undefined> {
  const path = templatePathOf(opts.template);
  if (!path || !(await opts.exists(path).catch(() => false))) return undefined;
  const ms = getMobileSettings();
  const now = new Date();
  return applyTemplateInteractive(await opts.read(path), {
    title: opts.title,
    now,
    folder: opts.folder,
    vaultName: opts.vaultName,
    dailyPath: (offset) => {
      const d = new Date(now);
      d.setDate(d.getDate() + offset);
      return buildDailyNotePath(d, ms.dailyFormat, ms.dailyFolder).fullPath.replace(/\.md$/i, "");
    },
  });
}
