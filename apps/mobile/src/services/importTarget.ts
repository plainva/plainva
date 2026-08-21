import { CapacitorVaultAdapter } from "../adapters/CapacitorVaultAdapter";
import { addVault, newVaultId } from "./vaultRegistry";

/**
 * Creating the container an import writes into (P7).
 *
 * On the desktop "a new vault" is a folder the user picks. On the phone a
 * vault is a CONTAINER — its own file area under `vaults/<id>`, its own index
 * database, its own credential slot — so the same choice cannot be a path
 * picker; it is a name plus this call.
 *
 * Two things are deliberately NOT done here:
 *
 * The vault is not seeded. `boot()` writes three welcome notes into a local
 * vault it finds empty, which is right for someone starting from nothing and
 * wrong for an import: there the imported notes ARE the content, and
 * "Willkommen.md" between four hundred imported ones is litter. Because the
 * import writes before the vault is ever booted, the container is no longer
 * empty when boot() looks — the seeding stays away on its own, without a flag.
 *
 * And it is not switched to. The user is still standing in the wizard looking
 * at a report; swapping the vault under them would tear that screen down. The
 * report offers the switch as a button instead.
 */

export interface ImportTargetVault {
  /** Registry id — what `switchVault` is called with once the run is done. */
  id: string;
  name: string;
  /**
   * The raw sandbox adapter for the new container.
   *
   * Raw is correct here and only here: this vault has no provider, no sync
   * queue and no history to snapshot against, because it did not exist a
   * moment ago. Every other mobile write goes through the chain (S3).
   */
  adapter: CapacitorVaultAdapter;
}

/**
 * Registers a fresh vault and opens its file area, without booting it.
 *
 * Called at the START of an import run, not when the target is chosen: a
 * wizard abandoned in the preview must not leave an empty vault behind in a
 * list the user then has to clean up.
 */
export async function createImportVault(name: string): Promise<ImportTargetVault> {
  const id = newVaultId();
  const trimmed = name.trim();
  await addVault({ id, name: trimmed });
  const adapter = new CapacitorVaultAdapter(`vaults/${id}`);
  await adapter.initialize();
  return { id, name: trimmed, adapter };
}

/**
 * A default name for the new vault, from whatever the wizard recognised.
 *
 * The source name rather than a date: the user knows what they are importing,
 * and "Notion" is a better answer to "which vault is this?" six months later
 * than "Import 2026-08-21". Falls back to the given label when nothing was
 * recognised.
 */
export function suggestVaultName(sourceLabel: string, fallback: string): string {
  const trimmed = sourceLabel.trim();
  if (!trimmed) return fallback;
  // The parenthetical in names like "Notion (API, integration token)" tells the
  // user which IMPORTER they picked; it is noise on a vault.
  const short = trimmed.split("(")[0].trim();
  return short || fallback;
}
