import { useCallback, useEffect } from "react";
import i18n from "../i18n";

/**
 * "Discard your input?" — the one question a dialog asks before it closes over
 * what the person typed (finding 2026-10-22, Sammelplan 3.139 Nr. 3).
 *
 * The mail composer asked it on its own (finding 2026-10-09); every other
 * desktop dialog with a field — a journal entry, an event, a recovery code —
 * dropped what was typed on Escape, its X, a click beside it or "Cancel". The
 * phone's sheets ask since 2026-11-02. The question and its single flight live
 * here, the dialog that shows it is the shell's: the desktop registers its
 * `appConfirm` at start (`registerDiscardQuestion`), and the window-close and
 * vault-switch guard beside it (`hold`), so a dialog with unsaved input is
 * asked about when the window closes or changes its vault too.
 *
 * Without a registration the close goes through, as it always did: shared
 * code must not hang a dialog on a shell that never answers.
 */

/** Words for a question that names what is lost, instead of the general "Discard your input?". */
export interface DiscardWording {
  title?: string;
  /** The button that goes back to the input. */
  keepLabel?: string;
}

/** Where a held question belongs: asked also before the note it names is left. */
export interface DiscardScope {
  /** Path of the note the unsaved input belongs to. */
  path?: string;
  wording?: DiscardWording;
}

export interface DiscardQuestionHost {
  /** Shows the question; true = discard. */
  ask(message: string, wording?: DiscardWording): Promise<boolean>;
  /**
   * Declares unsaved work to the window around it until the returned function
   * runs. With a `path`, the work also stands in the way of whatever replaces
   * or closes that note's pane.
   */
  hold?(question: () => Promise<boolean>, scope?: { path?: string }): () => void;
}

let host: DiscardQuestionHost | null = null;
let asking: Promise<boolean> | null = null;

export function registerDiscardQuestion(next: DiscardQuestionHost | null): void {
  host = next;
}

/**
 * Asks "Discard your input?" with `message` saying what would be lost. One
 * question at a time: a second way out taken while it stands (Escape, then the
 * X) joins the question already open.
 */
export function askDiscard(message?: string, wording?: DiscardWording): Promise<boolean> {
  if (!host) return Promise.resolve(true);
  const current = host;
  asking ??= current.ask(message ?? i18n.t("mobile.leaveSheet"), wording).finally(() => {
    asking = null;
  });
  return asking;
}

/**
 * The close of a dialog that holds what the person typed. While `dirty`, it
 * asks first and closes on "Discard"; otherwise it closes at once. The dialog's
 * own exit after saving does not come here — it calls `onClose` itself.
 *
 * While dirty, the work is also declared to the window (`hold`), so closing
 * the window or switching its vault asks the same question. With a note `path`
 * it is asked before that note's pane is closed or shows another note too.
 */
export function useDiscardGuard(dirty: boolean, onClose: () => void, message?: string, scope?: DiscardScope): () => void {
  const path = scope?.path;
  const title = scope?.wording?.title;
  const keepLabel = scope?.wording?.keepLabel;
  useEffect(() => {
    if (!dirty || !host?.hold) return;
    return host.hold(() => askDiscard(message, title || keepLabel ? { title, keepLabel } : undefined), { path });
  }, [dirty, message, path, title, keepLabel]);
  return useCallback(() => {
    if (!dirty) {
      onClose();
      return;
    }
    void askDiscard(message, title || keepLabel ? { title, keepLabel } : undefined).then((discard) => {
      if (discard) onClose();
    });
  }, [dirty, onClose, message, title, keepLabel]);
}

/** Test seam. */
export function resetDiscardQuestionForTest(): void {
  host = null;
  asking = null;
}
