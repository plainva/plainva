import { setUnavailableSlashCommands } from "@plainva/ui";

/**
 * Slash commands this shell cannot serve.
 *
 * The list is EMPTY since S19: `embedbase` and `newbase` were the last two,
 * and both are now wired to real mobile pickers, so the insert menu offers
 * all 46 commands in their five sections. The mechanism stays, because it is
 * the honest answer whenever a shell genuinely cannot serve an entry — a
 * missing entry is honest, a dead entry is not — and the next command that
 * needs a listener the phone lacks belongs here rather than in the menu.
 */
export const UNAVAILABLE_SLASH_COMMANDS = [] as const;

export function applyMobileSlashSupport(): void {
  setUnavailableSlashCommands(UNAVAILABLE_SLASH_COMMANDS);
}
