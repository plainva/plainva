/**
 * When the "settings adopted from another device" notice is worth showing.
 *
 * The notice used to appear on nearly every cycle — every ~30 seconds, on a
 * device where nothing had changed (report 2026-07-29). The cause was an export
 * that did not round-trip (see `accountProfile`: device-dependent order and
 * parked device state), and that is fixed at the root. This is the second half:
 * even with a genuine change, an announcement is worth exactly one interruption.
 * Afterwards the diagnostics record carries it, naming the fields.
 *
 * Session memory, per vault: reopening a vault or restarting the app makes the
 * notice possible again, which is the point — it marks the moment settings
 * arrive, not a permanent state.
 */

const announced = new Set<string>();

/**
 * True at most once per session and vault, and only for a real change.
 *
 * @param changedNames the fields that actually differed; an empty list means the
 *        cycle only re-stamped values, which is not something to interrupt over.
 */
export function shouldAnnounceProfileImport(vaultKey: string, changedNames: readonly string[]): boolean {
  if (changedNames.length === 0) return false;
  if (announced.has(vaultKey)) return false;
  announced.add(vaultKey);
  return true;
}

/** Forgets the notice state — the vault was closed, or the device signed out. */
export function clearProfileAnnouncement(vaultKey: string): void {
  announced.delete(vaultKey);
}
