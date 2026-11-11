import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { planBlockLink, wikiLinkText } from "@plainva/core";
import i18n from "../i18n";
import { toast } from "../services/toastStore";
import { copyLinkText, noteLinkUrlFor } from "../lib/noteLinks";

/**
 * "Copy link" and "Copy block link" at a line of the open note (F2, ADR 0037),
 * the same in both shells: the desktop's block menu and right-click menu, the
 * phone's block sheet.
 *
 * At a heading both copy a link to that heading. Anywhere else the line's
 * block gets an id if it has none — written into the EDITOR, as a keystroke
 * would be, so the save, the undo history and the write chain see an
 * ordinary edit (never a write of the file behind the editor's back) — and
 * the link names it:
 *
 *   "url"   plainva://open?vault=…&path=…&block=…   for other apps
 *   "wiki"  [[Note#^id]]                            for other notes
 */
export interface LineLinkContext {
  /** The note's vault path. */
  notePath: string;
  /** The vault's name as the person sees it; `null` leaves it out of the address. */
  vaultName: string | null;
  /** What the link rule leads to this note by (`wikiTargetForPath`). */
  wikiName: string;
}

export type LineLinkMode = "url" | "wiki";

/** The link text for the line at `offset`, the id written first where needed; `null` (and a word to the person) where none can be made. */
export function lineLinkText(view: EditorView, offset: number, mode: LineLinkMode, ctx: LineLinkContext): string | null {
  const plan = planBlockLink(view.state.doc.toString(), offset);
  if (plan.kind === "refused") {
    toast.warning(i18n.t(plan.reason === "empty" ? "noteLink.lineEmpty" : "noteLink.blockNotHere"));
    return null;
  }
  let anchor: { heading?: string; block?: string };
  if (plan.kind === "heading") {
    anchor = { heading: plan.text };
  } else {
    if (plan.insert) {
      if (view.state.facet(EditorState.readOnly)) {
        toast.warning(i18n.t("noteLink.readOnly"));
        return null;
      }
      view.dispatch({ changes: { from: plan.insert.at, insert: plan.insert.text }, userEvent: "input" });
    }
    anchor = { block: plan.id };
  }
  if (mode === "wiki") return wikiLinkText(ctx.wikiName, anchor);
  try {
    return noteLinkUrlFor(ctx.vaultName, ctx.notePath, anchor);
  } catch {
    toast.warning(i18n.t("noteLink.invalid"));
    return null;
  }
}

/** `lineLinkText`, then onto the clipboard. */
export async function copyLineLink(view: EditorView, offset: number, mode: LineLinkMode, ctx: LineLinkContext): Promise<boolean> {
  const text = lineLinkText(view, offset, mode, ctx);
  return text === null ? false : copyLinkText(text);
}
