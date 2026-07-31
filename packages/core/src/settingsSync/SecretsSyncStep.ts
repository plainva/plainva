/**
 * Sideband secrets-sync step (settings-sync plan §3.4, P3). Transports the sealed
 * account-secrets bundle `.plainva/sync/secrets.enc` once per cycle, outside the
 * file queue/reconcile/merge path. Unlike the profile (whole-document LWW),
 * secrets merge PER ENTRY (entryRev → updatedAt → deviceId), so an independent
 * change to a different account is never lost by a bundle-level overwrite.
 *
 * The shell provides a `SecretsPort`: `exportBundle` reads the device's current
 * shareable secrets (already binding-annotated), while `importBundle` applies
 * isolated, binding-checked keychain write groups. Cryptographic or structural
 * invalidity rejects the complete bundle before the port runs; entry-local
 * policy/write failures do not block independent entries. The core seals/opens
 * the bundle under K_secrets; the MK never leaves this process.
 */
import type { IVaultAdapter } from "../vault/IVaultAdapter.js";
import type { ISyncTarget } from "../sync/ISyncTarget.js";
import type { MasterKeyBundle } from "../crypto/keyfile.js";
import { SECRETS_LEGACY_SNAPSHOT_PATH, SECRETS_SYNC_PATH } from "./paths.js";
import {
  assertShareable,
  isLegacySecretType,
  mergeSecretsBundles,
  openSecretsBundle,
  sealSecretsBundle,
  type SecretsBundle,
} from "./secretsBundle.js";
import { SecretPolicyError } from "./secretsBundle.js";
import { stableStringify } from "./profileFile.js";

export type SecretImportStatus = "imported" | "unchanged" | "rejected" | "stale" | "error";

export type SecretImportReason =
  | "already-current"
  | "binding-mismatch"
  | "legacy-secret-type"
  | "local-secret-conflict"
  | "local-secret-protected"
  | "older-entry"
  | "slot-read-failed"
  | "slot-write-failed"
  | "tombstone-no-local-secret"
  | "unknown-account"
  | "unsupported-secret-type"
  | "version-collision";

export interface SecretImportEntryResult {
  logicalId: string;
  status: SecretImportStatus;
  /** Stable, non-sensitive code. Raw errors and secret material stay local. */
  reason?: SecretImportReason;
}

/** Structured outcome of an import, without credential values or raw errors. */
export interface SecretsImportResult {
  entries: SecretImportEntryResult[];
  imported: string[];
  unchanged: string[];
  rejected: string[];
  stale: string[];
  errors: string[];
  /**
   * Ids whose account is unknown HERE — skipped, not failed. They apply on a
   * later cycle once the account metadata has arrived through the profile.
   */
  unknownAccounts: string[];
  /** Known obsolete entries that were intentionally not applied locally. */
  legacyEntries: string[];
}

/** Shell bridge between the OS keychain and the shareable secrets bundle. */
export interface SecretsPort {
  /** The device's current shareable secrets (CalDAV/IMAP passwords only). */
  exportBundle(): Promise<SecretsBundle>;
  /** Apply isolated, snapshot-protected write groups (binding-checked). */
  importBundle(bundle: SecretsBundle): Promise<SecretsImportResult>;
}

export interface SecretsSyncStepOptions {
  port: SecretsPort;
  masterKey: MasterKeyBundle;
  now?: () => string;
  /**
   * Called when entries were skipped because their account is unknown here.
   * Not an error — the shell can point at the settings profile, which is what
   * carries the account metadata these entries are waiting for.
   */
  onUnknownAccounts?: (ids: string[]) => void;
  /** Complete, redacted result of an import attempt. */
  onImportResult?: (result: SecretsImportResult) => void | Promise<void>;
}

/** The destructive half of migration is unreachable without this explicit assertion. */
export interface LegacySecretsCleanupConfirmation {
  allDevicesUpdated: true;
}

export interface LegacySecretsCleanupResult {
  changed: boolean;
  /** Count only: account ids do not belong in migration diagnostics. */
  removed: number;
}

/** Runs the secrets-sync sideband against a target + raw vault adapter. */
export class SecretsSyncStep {
  constructor(private readonly options: SecretsSyncStepOptions) {}

  // Secrets live in the OS keychain, not the vault, so the local adapter is
  // unused here; the uniform (target, vault) shape mirrors SettingsSyncStep.
  async run(target: ISyncTarget, _vault: IVaultAdapter): Promise<void> {
    const now = (this.options.now ?? (() => new Date().toISOString()))();
    const local = await this.options.port.exportBundle();
    // Shell bugs must not be able to reintroduce a retired OAuth client
    // registration. Known legacy entries are accepted only from REMOTE data.
    for (const entry of Object.values(local.entries)) {
      if (!entry.tombstone) assertShareable(entry);
    }

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
      const result = await this.options.port.importBundle(merged);
      if (result.unknownAccounts.length > 0) this.options.onUnknownAccounts?.(result.unknownAccounts);
      await this.options.onImportResult?.(result);
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

  /**
   * Removes only retired credential types, and only after the caller explicitly
   * confirms every device was upgraded. The original sealed remote bytes are
   * verified in a local recovery path before the first remote mutation.
   */
  async cleanupLegacyEntries(
    target: ISyncTarget,
    vault: IVaultAdapter,
    confirmation: LegacySecretsCleanupConfirmation,
  ): Promise<LegacySecretsCleanupResult> {
    if (confirmation?.allDevicesUpdated !== true) {
      throw new SecretPolicyError("legacy cleanup requires all devices updated confirmation");
    }
    const remoteBytes = await target.download(SECRETS_SYNC_PATH);
    if (!remoteBytes) return { changed: false, removed: 0 };

    let remote: SecretsBundle;
    try {
      remote = openSecretsBundle(this.options.masterKey, remoteBytes);
    } catch (error) {
      throw new SecretPolicyError(
        `remote secrets bundle cannot be opened: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    const removed = Object.values(remote.entries)
      .filter((entry) => isLegacySecretType(entry.binding.secretType))
      .length;
    if (removed === 0) return { changed: false, removed: 0 };

    if (!(await vault.exists(SECRETS_LEGACY_SNAPSHOT_PATH))) {
      await vault.writeBinaryFile(SECRETS_LEGACY_SNAPSHOT_PATH, remoteBytes);
    }
    const snapshot = await vault.readBinaryFile(SECRETS_LEGACY_SNAPSHOT_PATH);
    if (!sameBytes(snapshot, remoteBytes)) {
      throw new SecretPolicyError("legacy cleanup recovery snapshot verification failed");
    }

    const entries = Object.fromEntries(
      Object.entries(remote.entries).filter(([, entry]) => !isLegacySecretType(entry.binding.secretType)),
    );
    const cleaned: SecretsBundle = {
      ...remote,
      bundleRev: remote.bundleRev + 1,
      updatedAt: (this.options.now ?? (() => new Date().toISOString()))(),
      entries,
    };
    await target.push({
      id: 0,
      file_path: SECRETS_SYNC_PATH,
      operation: "write",
      content: sealSecretsBundle(this.options.masterKey, cleaned),
      retry_count: 0,
      next_retry_at: 0,
      queued_at: 0,
    });
    return { changed: true, removed };
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
