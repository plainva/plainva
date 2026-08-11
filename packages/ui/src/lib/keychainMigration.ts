import type { ICredentialStore } from "../platform/credentials";

/**
 * Moves one keychain entry from its old, unreadable name to the readable one
 * (plan P6). Shared, because both shells hold the same kinds of credential and
 * a second implementation is a second chance to lose one.
 *
 * The order is the whole design:
 *
 *   read old → write new → READ THE NEW ONE BACK → only then delete the old
 *
 * A keychain write can fail without throwing anything useful: the keyring is
 * locked, a prompt is denied, the store is full. Deleting first — or trusting
 * the write — turns any of those into a lost password. Verifying first means
 * the worst case is a duplicate entry, which costs one line in the "stored
 * credentials" list and nothing else.
 *
 * Idempotent: an entry that has already moved is left alone, and a run that was
 * interrupted resumes simply by being run again.
 */

export type SlotMigrationOutcome =
  /** The entry moved and the old name is gone. */
  | "migrated"
  /** Nothing was stored under the old name — nothing to do. */
  | "absent"
  /** Already under the readable name. */
  | "done"
  /** The new entry could not be written or read back; the OLD ONE IS INTACT. */
  | "kept-old";

export interface SlotMigration {
  from: string;
  to: string;
}

export interface SlotMigrationReport {
  migrated: string[];
  keptOld: string[];
}

/** Moves one slot. Never throws: a failure here must not stop a vault opening. */
export async function migrateKeychainSlot(
  credentials: ICredentialStore,
  { from, to }: SlotMigration
): Promise<SlotMigrationOutcome> {
  if (from === to) return "done";

  let existing: unknown;
  try {
    existing = await credentials.readSecret<unknown>(from);
  } catch {
    // Unreadable is not absent — a locked keychain must not be taken as "there
    // was nothing here", which would silently drop the entry from the run.
    return "kept-old";
  }
  if (existing === null || existing === undefined) return "absent";

  try {
    await credentials.writeSecret(to, existing);
  } catch {
    return "kept-old";
  }

  // The read-back is the point. Without it, "written" is only a claim.
  try {
    const readBack = await credentials.readSecret<unknown>(to);
    if (readBack === null || readBack === undefined) return "kept-old";
  } catch {
    return "kept-old";
  }

  try {
    await credentials.removeSecret(from);
  } catch {
    // The credential is safe under both names; the leftover shows up in the
    // "stored credentials" list, where it can be removed deliberately.
    return "migrated";
  }
  return "migrated";
}

/** Moves a whole vault's slots, reporting only what a human would act on. */
export async function migrateKeychainSlots(
  credentials: ICredentialStore,
  slots: readonly SlotMigration[]
): Promise<SlotMigrationReport> {
  const report: SlotMigrationReport = { migrated: [], keptOld: [] };
  for (const slot of slots) {
    const outcome = await migrateKeychainSlot(credentials, slot);
    if (outcome === "migrated") report.migrated.push(slot.to);
    else if (outcome === "kept-old") report.keptOld.push(slot.from);
  }
  return report;
}
