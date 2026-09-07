/**
 * The open comment store on the desktop (Stufe D, D4; Nachschaerfung N0).
 *
 * Everything that decides correctness - the bundle format, the union merge,
 * the mapping into the record the surface renders, the record a post writes -
 * lives in `@plainva/core` (`BundleCommentStore`), shared with the phone.
 * What stays here is only what must: where this device caches its master key,
 * which settings store holds its id and the reviewer name.
 */
import { BundleCommentStore, type BundleCommentsMode, type CommentStore, type IVaultAdapter } from "@plainva/core";
import { hasLocalKeyfile, loadCachedMasterKey } from "./encryptionSession";
import { commentsCryptoFor, getDeviceId } from "./settingsProfile";
import { getSettingsStore } from "./settingsStore";

/** How this device can store comments in `vaultPath` right now - see `BundleCommentsMode`. */
export async function localCommentsMode(vaultPath: string, raw: IVaultAdapter): Promise<BundleCommentsMode> {
  const mk = await loadCachedMasterKey(vaultPath);
  if (mk) return { kind: "sealed", crypto: commentsCryptoFor(mk) };
  return (await hasLocalKeyfile(raw)) ? { kind: "locked" } : { kind: "plain" };
}

/**
 * The store for a vault without an encrypted workspace.
 *
 * `raw` is deliberately the BACKUP adapter, exactly what the sync worker
 * hands the sideband step: the conflict-aware app adapter would mint
 * sync_state rows and `.CONFLICT` copies of the comment bundle.
 * `BackupVaultAdapter` skips `.plainva` for snapshots anyway, so nothing here
 * lands in the version history either.
 */
export function createLocalCommentStore(
  vaultPath: string,
  raw: IVaultAdapter,
  /**
   * The reviewer field this vault already carries - the person at this
   * keyboard, device-local - rather than asking the same question twice.
   * Handed in rather than read here: the key lives in the vault context, and
   * reaching back into it from a service would make the module graph circular
   * for the sake of one string.
   */
  authorName: () => Promise<string | null | undefined>,
  /** Runs after every write: the context kicks the sideband and tells the column. */
  written: (path: string) => void,
): CommentStore {
  return new BundleCommentStore({
    vault: raw,
    deviceId: async () => getDeviceId(await getSettingsStore()),
    mode: () => localCommentsMode(vaultPath, raw),
    authorName,
    written,
  });
}
