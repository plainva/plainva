# Security & Sharing

Last reviewed: 2026-07-22

Plainva can keep a vault as ordinary readable files on your device while storing its cloud copy as opaque encrypted objects. Open **Settings → your vault → Security & Sharing** after connecting a cloud account.

## First setup

1. Choose an owner and device name. Device keys stay in the operating-system keychain; where that is unavailable, Plainva asks for a local passphrase.
2. Save the `.pvrecovery` file, store the displayed recovery code separately, and enter the two requested code groups. You need both parts for recovery; neither contains cloud credentials.
3. Activate the workspace. Plainva publishes its signed owner policy and encrypts every local file into `.pvws/`. The local vault remains readable and migration resumes after interruptions.

Existing plaintext at the provider remains beside `.pvws/` during migration. Only after the status is **Protected** can you explicitly remove it. This action never removes local files.

## Everyday use

Offline changes stay in a durable queue. Every change is signed; remote deletion alone never deletes a local file, while a signed tombstone can. Parallel offline edits are preserved as `.CONFLICT-…` copies. **Lock** removes workspace keys from the current session; **Unlock** uses the system keychain or local passphrase.

Adding/revoking devices, restoring from the recovery package, team roles, groups, invitations, and selective slices arrive in later phases. The current release implements the personal single-owner workspace and its recovery backup.
