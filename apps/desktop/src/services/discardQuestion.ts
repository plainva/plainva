import type { DiscardQuestionHost } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { appConfirm } from "./appDialogs";

/**
 * The desktop's "Discard your input?" (finding 2026-10-22, Sammelplan 3.139
 * Nr. 3): the in-app confirm the mail composer always asked with, now the one
 * every dialog with typed input asks through (`useDiscardGuard`, `Modal`'s
 * `unsaved`). Unsaved input is declared to the window as well, so closing the
 * window or switching its vault asks the same question first.
 *
 * The window guard is loaded when first used: the vitest setup registers this
 * host in front of every test file, and a test's own stand-in for the window
 * guard must be the one it reaches. The question itself is not: it has to be
 * on screen in the same turn, so an Escape right after it answers it.
 */
export const desktopDiscardHost: DiscardQuestionHost = {
  ask: (message) =>
    appConfirm({
      title: i18n.t("mobile.leaveTitle"),
      message,
      kind: "danger",
      confirmLabel: i18n.t("mobile.leaveDiscard"),
    }),
  hold: (question) => {
    let release: (() => void) | null = null;
    let over = false;
    void import("./windowCloseGuard").then(({ holdWindowClose }) => {
      if (!over) release = holdWindowClose(question);
    });
    return () => {
      over = true;
      release?.();
    };
  },
};
