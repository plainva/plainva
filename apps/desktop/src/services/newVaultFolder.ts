/** What `writeNewVault` needs from the disk and from the app's own records. */
export interface NewVaultFolderPorts {
  exists(path: string): Promise<boolean>;
  /** Removes a folder with everything in it. */
  remove(path: string): Promise<void>;
  /** Forgets the per-vault app data a half-made vault may have left. */
  forget(path: string): Promise<void>;
}

/**
 * Writes a new vault into `folder`, and takes it back when the writing fails
 * (second review of O8, 2026-11-17).
 *
 * A tour that failed halfway used to leave its half folder behind, and the
 * next click put "Plainva Tour 2" beside it. Only a folder THIS attempt made
 * is removed: one that was there before was picked by the person and may be
 * theirs, so it is left as it is. The first error is the one that is thrown;
 * a cleanup that fails as well is logged, never in its place.
 */
export async function writeNewVault(folder: string, ports: NewVaultFolderPorts, write: () => Promise<void>): Promise<void> {
  const madeHere = !(await ports.exists(folder));
  try {
    await write();
  } catch (e) {
    if (madeHere) {
      try {
        if (await ports.exists(folder)) await ports.remove(folder);
        await ports.forget(folder);
      } catch (cleanup) {
        console.error("[newVaultFolder] the half-made vault could not be removed:", folder, cleanup);
      }
    }
    throw e;
  }
}
