/**
 * Canonical sideband control/data paths for the settings-sync + encryption
 * feature (v3 §3.1). Everything under `.plainva/sync/` is transported by the
 * dedicated sideband step, never through the file queue/reconcile/merge path.
 * The content-E2E decorator passes all of these through unencrypted (they carry
 * their own AEAD where needed, and keyfile/manifest must be readable before the
 * master key is unlocked).
 */

// PROFILE_SYNC_PATH (plaintext `settings.json`) is declared in profileFile.ts and
// re-exported there; keep it in one place to avoid a duplicate `export *` binding.

/** Sealed profile (once any master key exists — sealed under K_settings). */
export const SETTINGS_ENC_PATH = ".plainva/sync/settings.enc";

/**
 * A member's own partition of the profile (bars plan P6). Personal settings —
 * how the bars are arranged, which mailbox is selected, backup rules — live
 * here instead of the shared file, so two people in one encrypted workspace stop
 * overwriting each other. Vault-wide conventions (daily-note folder, template
 * folder, task database) stay in the shared file, because they are shared.
 *
 * Organisationally separate, deliberately NOT secret from the other members:
 * everything here is sealed under the same K_settings. Real confidentiality
 * would have to draw the key from the member's personal group — a separate step
 * and out of scope here.
 */
export const memberProfilePath = (memberId: string, sealed: boolean): string =>
  `.plainva/sync/members/${memberId}/settings.${sealed ? "enc" : "json"}`;
/** Sealed account-secrets bundle (K_secrets). */
export const SECRETS_SYNC_PATH = ".plainva/sync/secrets.enc";
/** Passphrase-wrapped master key(s). Public, travels with the vault. */
export const KEYFILE_SYNC_PATH = ".plainva/sync/keyfile.json";
/** Per-connection content-E2E control manifest (remote-only, HMAC-authenticated). */
export const ENCRYPTION_MANIFEST_PATH = ".plainva/sync/encryption.json";
