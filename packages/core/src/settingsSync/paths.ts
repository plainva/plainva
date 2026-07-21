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
/** Sealed account-secrets bundle (K_secrets). */
export const SECRETS_SYNC_PATH = ".plainva/sync/secrets.enc";
/** Passphrase-wrapped master key(s). Public, travels with the vault. */
export const KEYFILE_SYNC_PATH = ".plainva/sync/keyfile.json";
/** Per-connection content-E2E control manifest (remote-only, HMAC-authenticated). */
export const ENCRYPTION_MANIFEST_PATH = ".plainva/sync/encryption.json";
