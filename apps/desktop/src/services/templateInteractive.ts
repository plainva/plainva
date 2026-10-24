import { runTemplateInteractive, type TemplateContext } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { appTemplateAnswers } from "./appDialogs";
import { readEditorSelection } from "./editorSelection";
import { templateVaultOf } from "./dailyNotes";

/**
 * The interactive half of the template pipeline (plan Vorlagen-Engine, P3):
 * the full context → resolve → ask (once, in one dialog) → finalize. The
 * pipeline itself is shared with the phone (`runTemplateInteractive`); this
 * shell hands it its vault, its selection, its clipboard and its dialog.
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
 * `vaultPath` is the vault the template belongs to, and a caller has to name
 * it (null only where no vault is open): the vault's name, its daily notes
 * and this device's week start come from here, as the selection and the
 * clipboard do, so no way can leave them out. Each caller used to add them
 * itself, and three ways — the daily note, a database's "+ Entry" and the
 * pinboard entry — never got the week start or the clipboard (Sammelplan
 * § 3.97). A piece the caller sets itself stays.
 *
 * A template without questions never opens a dialog — creating an entry stays
 * a single click (decision E3). The clipboard is read ONLY when the template
 * carries the token: reading it on every note creation would be an overreach
 * (and on some platforms a permission prompt) for a feature almost no template
 * uses.
 */
export async function applyTemplateInteractive(
  raw: string,
  ctx: TemplateContext & { vaultPath: string | null },
  dialogTitle: string
): Promise<InteractiveTemplateResult | null> {
  const { vaultPath, ...base } = ctx;
  return runTemplateInteractive(raw, base, {
    vault: vaultPath ? await templateVaultOf(vaultPath) : null,
    person: {
      selection: () => readEditorSelection(),
      readClipboard: () => navigator.clipboard.readText(),
      clipboardLabel: i18n.t("templatePicker.clipboardLabel", { defaultValue: "Zwischenablage" }),
    },
    ask: (fields) => appTemplateAnswers({ title: dialogTitle, fields }),
  });
}

/**
 * Pokes an already-mounted editor after the note was opened. The caret itself
 * is parked with the shared `parkTemplateCaret`, on this shell as on the phone.
 */
export function pokeTemplateCaret(path: string): void {
  window.dispatchEvent(new CustomEvent("plainva-template-caret", { detail: { path } }));
}
