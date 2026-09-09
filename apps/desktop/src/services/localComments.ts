/**
 * The open comment store on the desktop (Stufe D, D4; Nachschaerfung N0).
 *
 * Everything that decides correctness - the bundle format, the union merge,
 * the mapping into the record the surface renders, the record a post writes -
 * lives in `@plainva/core` (`BundleCommentStore`), shared with the phone.
 * What stays here is only what must: where this device caches its master key,
 * which settings store holds its id and the reviewer name.
 */
import { BundleCommentStore, type BundleCommentsMode, type IVaultAdapter } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
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
 * What this device calls itself when nobody typed a name (finding 2026-09-09):
 * the platform and the first four characters of the device id - "Windows
 * device 4f3a". Honest, because in a plain vault the device IS the author,
 * and stable across every other device that reads the bundle. Without this a
 * remark from a device with an empty name field read "Unknown member".
 */
export function commentDeviceFallbackName(deviceId: string): string {
  const raw = ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "").toLowerCase();
  const platform = raw.includes("win") ? "Windows" : raw.includes("mac") ? "macOS" : raw.includes("linux") ? "Linux" : "Desktop";
  return i18n.t("comments.commentDeviceName", { platform, id: deviceId.slice(0, 4) });
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
): BundleCommentStore {
  return new BundleCommentStore({
    vault: raw,
    vaultKey: vaultPath,
    deviceId: async () => getDeviceId(await getSettingsStore()),
    mode: () => localCommentsMode(vaultPath, raw),
    // The name the person gave, else the device's own label - never nothing.
    authorName: async () => (await authorName())?.trim() || commentDeviceFallbackName(await getDeviceId(await getSettingsStore())),
    written,
    // A comment file that could not be read (N3): the shell shows it once,
    // with the reason and a way to export the diagnosis.
    faulted: (faults) => window.dispatchEvent(new CustomEvent("plainva-comment-faults", { detail: { vaultPath, faults } })),
  });
}
