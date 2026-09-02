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
/**
 * Deletion journal (feedback round 2026-09-01, P1): the deletions a user
 * CONFIRMED, so the other devices mirror them instead of guarding against them.
 * Plain JSON — it carries paths, and the remote listing already shows every
 * path in plaintext (the content decorator seals bytes, not names).
 */
export const DELETIONS_SYNC_PATH = ".plainva/sync/deletions.json";
/**
 * Comments and suggestions for a vault WITHOUT an encrypted workspace (Stufe D).
 *
 * Two paths, never both in use: plaintext until a passphrase exists, sealed
 * afterwards (under K_settings — the frame carries the purpose as a byte, so a
 * new one would be a protocol change older devices could not open). The content
 * deliberately never touches the note: a typed reply must not become a write to
 * the Markdown, or every answer would land in the version history of the note.
 */
export const COMMENTS_SYNC_PATH = ".plainva/sync/comments.json";
export const COMMENTS_ENC_PATH = ".plainva/sync/comments.enc";
/**
 * Local-only recovery copy written before an explicitly confirmed removal of
 * legacy entries from the remote secrets bundle. `.plainva` is excluded from
 * content sync and no sideband step transports this path.
 */
export const SECRETS_LEGACY_SNAPSHOT_PATH = ".plainva/recovery/secrets-legacy.enc";
/** Passphrase-wrapped master key(s). Public, travels with the vault. */
export const KEYFILE_SYNC_PATH = ".plainva/sync/keyfile.json";
/** Per-connection content-E2E control manifest (remote-only, HMAC-authenticated). */
export const ENCRYPTION_MANIFEST_PATH = ".plainva/sync/encryption.json";
