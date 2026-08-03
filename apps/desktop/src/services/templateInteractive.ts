import {
  finalizeTemplate,
  resolveTemplate,
  setPendingTemplateCaret,
  type TemplateContext,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { appTemplateAnswers } from "./appDialogs";
import { readEditorSelection } from "./editorSelection";
import { getWeekStartSetting, weekStartDayOf } from "@plainva/ui";

/**
 * The interactive half of the template pipeline (plan Vorlagen-Engine, P3):
 * resolve → ask (once, in one dialog) → finalize.
 *
 * Every place where a PERSON triggered the creation goes through here, so the
 * behaviour is identical whether the note comes from the file tree, a database
 * button, the daily note or the insert command. The background paths
 * (taskSync, taskPromotion, mail capture) deliberately do NOT: they keep
 * calling `applyTemplatePlaceholders`, which is headless and never asks.
 *
 * Cancelling returns null and the caller aborts — no half-answered note.
 */

export interface InteractiveTemplateResult {
  text: string;
  /** Caret offset from `{{cursor}}`, relative to `text`. */
  cursor: number | null;
}

/**
 * Runs the pipeline. `title` in `ctx` is what `{{title}}` becomes; `dialogTitle`
 * is what the question dialog is called.
 *
 * A template without questions never opens a dialog — creating an entry stays
 * a single click (decision E3).
 */
/**
 * Fills in the context pieces the desktop shell owns — clipboard, selection,
 * first day of the week — for a template that actually asks for them.
 *
 * The clipboard is read ONLY when the template carries the token. Reading it on
 * every note creation would be an overreach (and on some platforms a permission
 * prompt) for a feature almost no template uses.
 */
export async function withShellContext(raw: string, ctx: TemplateContext): Promise<TemplateContext> {
  const next: TemplateContext = { ...ctx };
  if (next.weekStart === undefined) {
    try {
      next.weekStart = weekStartDayOf(await getWeekStartSetting());
    } catch {
      /* the default (Monday) is fine — a template must not fail over this */
    }
  }
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

export async function applyTemplateInteractive(
  raw: string,
  ctx: TemplateContext,
  dialogTitle: string
): Promise<InteractiveTemplateResult | null> {
  const resolved = resolveTemplate(raw, ctx, "interactive");
  let answers: Record<string, string> = {};
  if (resolved.requests.length > 0) {
    const given = await appTemplateAnswers({ title: dialogTitle, fields: resolved.requests });
    if (given === null) return null; // cancelled → the caller writes nothing
    answers = given;
  }
  return finalizeTemplate(resolved.text, answers);
}

/**
 * Parks the caret for a note that is about to be opened. `offset` is measured
 * in the template body; `prefixLength` accounts for whatever the write path put
 * in front of it (OKF frontmatter, an H1), so the caret lands where the
 * template said even though the file starts differently.
 */
export function parkTemplateCaret(path: string, offset: number | null, prefixLength = 0): void {
  if (offset === null) return;
  setPendingTemplateCaret({ path, offset: offset + prefixLength });
}

/** Pokes an already-mounted editor after the note was opened. */
export function pokeTemplateCaret(path: string): void {
  window.dispatchEvent(new CustomEvent("plainva-template-caret", { detail: { path } }));
}
