import {
  buildDailyNotePath,
  finalizeTemplate,
  resolveTemplate,
  resolveTemplateForNewNote,
  type TemplateContext,
} from "@plainva/ui";
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
 * `weekStart` is deliberately left unset: the phone has no first-day-of-week
 * setting yet, so `{{weekday:…}}` falls back to the engine's Monday. Wiring a
 * value the person never chose would be a guess, and a wrong one every Sunday.
 *
 * The clipboard is read ONLY when the template carries the token — reading it
 * on every note creation is an overreach (and a permission prompt on iOS) for
 * something almost no template uses.
 */
export async function withShellContext(raw: string, ctx: TemplateContext): Promise<TemplateContext> {
  const next: TemplateContext = { ...ctx };
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
  const trimmed = name.trim().replace(/^[/\\]+/, "");
  if (!trimmed) return "";
  // A rule may name the file alone ("Projekt.md") or a full vault path; a
  // missing extension is completed — Plainva templates are markdown files.
  const named = /\.[a-z0-9]+$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
  if (named.includes("/")) return named;
  const folder = (getMobileSettings().templateFolder || "Templates").replace(/[/\\]+$/, "");
  return folder ? `${folder}/${named}` : named;
}

export interface NewNoteContent {
  /** Full file content, OKF frontmatter included. */
  content: string;
  /** Caret offset in that content from `{{cursor}}`, or null. */
  caret: number | null;
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
  /** Body used when no template applies (`# Title`, the OKF skeleton, …). */
  fallbackBody: string;
}): Promise<NewNoteContent | null> {
  const ms = getMobileSettings();
  const name = opts.explicitTemplate?.trim() || templateForNewNote(opts.folder, opts.type);
  const path = name ? templatePathOf(name) : "";

  let body = opts.fallbackBody;
  if (path && (await opts.exists(path).catch(() => false))) {
    const raw = await opts.read(path);
    const now = new Date();
    const answered = await applyTemplateInteractive(raw, {
      title: opts.title,
      now,
      folder: opts.folder,
      vaultName: opts.vaultName,
      dailyLink: (offset) => {
        const d = new Date(now);
        d.setDate(d.getDate() + offset);
        const rel = buildDailyNotePath(d, ms.dailyFormat, ms.dailyFolder).fullPath.replace(/\.md$/i, "");
        return `[[${rel}]]`;
      },
    });
    if (!answered) return null;
    body = answered.text;
    const secured = ensureOkf(body, opts.type);
    return { content: secured, caret: answered.cursor === null ? null : answered.cursor + (secured.length - body.length) };
  }
  return { content: ensureOkf(body, opts.type), caret: null };
}

/** Prepends the OKF header unless the text already carries frontmatter. */
function ensureOkf(text: string, type: string): string {
  if (/^---\r?\n/.test(text)) return text;
  return `---\ntype: ${type}\nokf_version: "1.0"\n---\n\n${text.replace(/^\n+/, "")}`;
}
