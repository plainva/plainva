import {
  resolveTemplateForNewNote,
  runTemplateInteractive,
  templateAsNewNote,
  templateFilePath,
  withOkfDefaults,
  type TemplateContext,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { mTemplateAnswers } from "./mobileDialogs";
import { getMobileSettings } from "./mobileSettings";
import { readEditorSelection } from "./editorSelection";
import { phoneTemplateVault } from "./templateVault";

/**
 * The interactive half of the template pipeline on the phone
 * (plan Vorlagen-Engine, P6) — the same pipeline as the desktop's, shared
 * (`runTemplateInteractive`).
 *
 * Same steps, same contract: the full context → resolve → ask once →
 * finalize, and cancelling returns null so the caller writes nothing. What
 * differs is only the shell: the questions arrive as a bottom sheet, and the
 * vault's pieces come from the phone's settings.
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
 * Runs the pipeline; null = cancelled, and the caller creates nothing.
 *
 * The vault's pieces — its name, its daily notes, this device's week start —
 * and what a person brings — the selection, the clipboard, read only when the
 * template carries the token — are added here, so no way can leave them out.
 * The daily note left out its daily links (Sammelplan § 3.97). A piece the
 * caller set itself stays.
 */
export async function applyTemplateInteractive(
  raw: string,
  ctx: TemplateContext,
): Promise<InteractiveTemplateResult | null> {
  return runTemplateInteractive(raw, ctx, {
    vault: await phoneTemplateVault(ctx.vaultName),
    person: {
      selection: () => readEditorSelection(),
      readClipboard: () => navigator.clipboard.readText(),
      clipboardLabel: i18n.t("templatePicker.clipboardLabel", { defaultValue: "Zwischenablage" }),
    },
    ask: (fields) =>
      mTemplateAnswers({ title: i18n.t("templatePicker.answersTitle", { defaultValue: "Angaben für die Vorlage" }), fields }),
  });
}

/**
 * The template a new note in `folder` starts from, or `""` when no rule
 * matches (plan Vorlagen-Engine P4/P4b).
 *
 * The rules travel through the settings profile and are set on either
 * device — on the phone under the vault's settings (`TemplateRules`). That is
 * the whole point: a note created in `Projekte/` has to start the same way
 * whichever device is at hand.
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
  const answered = await applyTemplateInteractive(opts.raw, {
    title: opts.title,
    now: new Date(),
    folder: opts.folder,
    vaultName: opts.vaultName,
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
  return applyTemplateInteractive(await opts.read(path), {
    title: opts.title,
    now: new Date(),
    folder: opts.folder,
    vaultName: opts.vaultName,
  });
}
