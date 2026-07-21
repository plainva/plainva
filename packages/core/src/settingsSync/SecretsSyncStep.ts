/**
 * Sideband secrets-sync step (settings-sync plan §3.4, P3). Transports the sealed
 * account-secrets bundle `.plainva/sync/secrets.enc` once per cycle, outside the
 * file queue/reconcile/merge path. Unlike the profile (whole-document LWW),
 * secrets merge PER ENTRY (entryRev → updatedAt → deviceId), so an independent
 * change to a different account is never lost by a bundle-level overwrite.
 *
 * The shell provides a `SecretsPort`: `exportBundle` reads the device's current
 * shareable secrets (already binding-annotated), `importBundle` writes the merged
 * bundle atomically into the OS keychain (binding-checked, rollback on failure —
 * a wrong passphrase, endpoint mismatch or invalid entry causes NO partial
 * import). The core seals/opens the bundle under K_secrets; the MK never leaves
 * this process.
 */
import type { IVaultAdapter } from "../vault/IVaultAdapter.js";
import type { ISyncTarget } from "../sync/ISyncTarget.js";
import type { MasterKeyBundle } from "../crypto/keyfile.js";
import { SECRETS_SYNC_PATH } from "./paths.js";
import {
  mergeSecretsBundles,
  openSecretsBundle,
  sealSecretsBundle,
  type SecretsBundle,
} from "./secretsBundle.js";
import { SecretPolicyError } from "./secretsBundle.js";
import { stableStringify } from "./profileFile.js";

/** Shell bridge between the OS keychain and the shareable secrets bundle. */
export interface SecretsPort {
  /** The device's current shareable secrets (CalDAV/IMAP/static Google BYO). */
  exportBundle(): Promise<SecretsBundle>;
  /** Atomically apply the merged bundle to the keychain (binding-checked). */
  importBundle(bundle: SecretsBundle): Promise<void>;
}

export interface SecretsSyncStepOptions {
  port: SecretsPort;
  masterKey: MasterKeyBundle;
  now?: () => string;
}

/** Runs the secrets-sync sideband against a target + raw vault adapter. */
export class SecretsSyncStep {
  constructor(private readonly options: SecretsSyncStepOptions) {}

  // Secrets live in the OS keychain, not the vault, so the local adapter is
  // unused here; the uniform (target, vault) shape mirrors SettingsSyncStep.
  async run(target: ISyncTarget, _vault: IVaultAdapter): Promise<void> {
    const now = (this.options.now ?? (() => new Date().toISOString()))();
    const local = await this.options.port.exportBundle();

    const remoteBytes = await target.download(SECRETS_SYNC_PATH);
    let remote: SecretsBundle | null = null;
    if (remoteBytes) {
      try {
        remote = openSecretsBundle(this.options.masterKey, remoteBytes);
      } catch (error) {
        // Never replace an unreadable remote secrets bundle with local data. It
        // may belong to another key or be a truncated provider version; either
        // way treating it as "absent" would silently destroy the only copy.
        throw new SecretPolicyError(
          `remote secrets bundle cannot be opened: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }

    const merged = mergeSecretsBundles(local, remote, now);

    // Import into the keychain only when the merge changed the local view.
    if (stableStringify(merged.entries) !== stableStringify(local.entries)) {
      await this.options.port.importBundle(merged);
    }

    // Upload only when the merge changed the remote view (read-compare-retry
    // against concurrent writers is the shell's job via a fresh export next cycle).
    if (!remote || stableStringify(merged.entries) !== stableStringify(remote.entries)) {
      await target.push({
        id: 0,
        file_path: SECRETS_SYNC_PATH,
        operation: "write",
        content: sealSecretsBundle(this.options.masterKey, merged),
        retry_count: 0,
        next_retry_at: 0,
        queued_at: 0,
      });
    }
  }
}
