import { registerDiscardQuestion } from "@plainva/ui";
import { desktopDiscardHost } from "./discardQuestion";

/**
 * Registers the desktop's "Discard your input?" with the shared dialogs
 * (finding 2026-10-22). Kept apart from the host itself: the vitest setup
 * registers the same host without loading the whole UI package.
 */
export function installDiscardQuestion(): void {
  registerDiscardQuestion(desktopDiscardHost);
}
