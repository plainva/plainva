import { entriesOf, parseProfile, valuesOf, type PimCacheRepository } from "@plainva/core";
import { reportingTo } from "../services/backgroundErrors.js";
import { importAccountMetadata, type AccountImportPorts } from "./accountProfile.js";

/**
 * The calendar and task accounts of an index database rebuilt at the start
 * (both shells, "Rebuild index").
 *
 * Their rows lived in the damaged database and went with it; their sign-ins
 * (keychain) and this device's account map (settings store) did not. The
 * accounts come back from the settings sync, as on a second device — first
 * from this vault's own copy of the profile, before the vault opens
 * (`restoreAccountsAfterRebuild`), then from the document itself at the first
 * settings-sync cycle (`accountFieldsHeldBack`): until that cycle has applied
 * it, what this device exports for them is no edit of its own. Published, the
 * empty list would be the newest entry and win on every device.
 *
 * The damaged database is never read for it.
 */

/** The profile fields that carry the calendar and task accounts, their choices and their removals. */
const ACCOUNT_FIELDS = ["pimAccounts", "pimSelections", "removedAccounts", "accountActs"] as const;

/** The fields held back until the document's accounts were applied (`ProfileSettingsPort.heldBack`). */
export const ACCOUNT_FIELDS_HELD_AFTER_REBUILD = ["pimAccounts", "pimSelections"] as const;

type RebuildState = Pick<PimCacheRepository, "accountsAfterRebuild" | "setAccountsAfterRebuild">;

/**
 * On the first open of a rebuilt index database: brings the accounts back
 * from the vault's copy of the profile through the same import a second
 * device runs — accounts removed on purpose stay removed (the profile's
 * removals count), and each comes back under the id this device knew it by,
 * with its sign-in. A copy that cannot be read, or carries no accounts,
 * restores nothing and stops nothing: the settings sync may still bring them,
 * and what it does not know is connected again.
 */
export async function restoreAccountsAfterRebuild(input: {
  state: RebuildState;
  readProfileCopy: () => Promise<string | null>;
  ports: AccountImportPorts;
  /**
   * Whether a settings-sync cycle can still bring what the copy did not:
   * the settings sync is on and the vault syncs. Where it cannot, nothing is
   * held after the restore — an account that did not come back is gone here,
   * and its card says so instead of keeping it as connected.
   */
  settingsSyncRuns: boolean;
}): Promise<"restored" | "nothing" | "already"> {
  const state = await input.state.accountsAfterRebuild();
  if (state !== null) {
    // Held at an earlier open, and no cycle can come any more: the attempt is over.
    if (state === "held" && !input.settingsSyncRuns) await input.state.setAccountsAfterRebuild("settled");
    return "already";
  }
  await input.state.setAccountsAfterRebuild("held");
  const outcome = await restoreFromCopy(input);
  if (!input.settingsSyncRuns) await input.state.setAccountsAfterRebuild("settled");
  return outcome;
}

async function restoreFromCopy(input: { readProfileCopy: () => Promise<string | null>; ports: AccountImportPorts }): Promise<"restored" | "nothing"> {
  const text = await input.readProfileCopy().catch(() => null);
  const doc = parseProfile(text);
  if (!doc) return "nothing";
  const values = valuesOf(entriesOf(doc));
  if (!Array.isArray(values.pimAccounts)) return "nothing";
  const accounts = Object.fromEntries(ACCOUNT_FIELDS.filter((key) => key in values).map((key) => [key, values[key]]));
  try {
    await importAccountMetadata(accounts, input.ports);
    return "restored";
  } catch (error) {
    reportingTo("accounts:restore-after-rebuild")(error);
    return "nothing";
  }
}

/** What a rebuilt database's device does not speak for yet in the settings sync (`ProfileSettingsPort.heldBack`). */
export async function accountFieldsHeldBack(state: Pick<RebuildState, "accountsAfterRebuild"> | null): Promise<string[]> {
  if (!state) return [];
  return (await state.accountsAfterRebuild().catch(() => null)) === "held" ? [...ACCOUNT_FIELDS_HELD_AFTER_REBUILD] : [];
}

/** After a settings-sync cycle that applied the document while the accounts were held: they are this device's again. */
export async function settleAccountsAfterRebuild(state: RebuildState | null): Promise<void> {
  if (!state) return;
  if ((await state.accountsAfterRebuild().catch(() => null)) === "held") await state.setAccountsAfterRebuild("settled");
}
