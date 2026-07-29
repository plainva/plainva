import {
  finalizeTemplate,
  resolveTemplate,
  setPendingTemplateCaret,
  type TemplateContext,
} from "@plainva/ui";
import { appTemplateAnswers } from "./appDialogs";

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
