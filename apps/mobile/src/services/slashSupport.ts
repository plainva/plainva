import { setUnavailableSlashCommands } from "@plainva/ui";

/**
 * Slash commands this shell cannot serve yet.
 *
 * Both entries open a picker through a window event that only the desktop
 * listens to (`plainva-open-base-picker`, `plainva-create-inline-base`), so on
 * the phone they appeared in the menu and did nothing at all. Until the mobile
 * insert surface can offer the pickers for real, the menu does not promise
 * them — a missing entry is honest, a dead entry is not.
 */
export const UNAVAILABLE_SLASH_COMMANDS = ["embedbase", "newbase"] as const;

export function applyMobileSlashSupport(): void {
  setUnavailableSlashCommands(UNAVAILABLE_SLASH_COMMANDS);
}
