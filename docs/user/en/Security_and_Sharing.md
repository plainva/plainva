# Security & Sharing

## Security Center, rekeying, and published slices

The dashboard now follows the recovery/device/team cards and the tabbed administration shown in the product mockups. Visible actions stay usable: Plainva opens the selected vault, connection setup, workspace setup, or unlock flow when a prerequisite is missing. Removing a device or member can start a durable full rekey; its object-by-object progress survives pause, crash, and restart. A future-only rotation changes only subsequent writes.

Create a Vault Slice with the four steps **Details → Content → Permissions → Review**. External publications use a separate encrypted workspace namespace. Sanitized projections remove private frontmatter properties, neutralize links to excluded notes, and omit excluded embeds. Google Drive, OneDrive, Nextcloud, Dropbox, WebDAV, and S3 permissions are additional protection, never a replacement for encrypted roles. Public release remains blocked until the independent crypto review and real Android/iOS two-device evidence are recorded.

Last reviewed: 2026-07-22

Plainva can keep a vault as ordinary readable files on your device while storing its cloud copy as opaque encrypted objects. Open **Settings → your vault → Security & Sharing** after connecting a cloud account.

## First setup

1. Choose an owner and device name. Device keys stay in the operating-system keychain; where that is unavailable, Plainva asks for a local passphrase.
2. Save the `.pvrecovery` file and store the displayed recovery code separately. Every code block has a visible group number; enter the values of the two highlighted groups to prove the backup is readable. You need both parts for recovery; neither contains cloud credentials.
3. Activate the workspace. Plainva publishes its signed owner policy and encrypts every local file into `.pvws/`. The local vault remains readable and migration resumes after interruptions.

Existing plaintext at the provider remains beside `.pvws/` during migration. Only after the status is **Protected** can you explicitly remove it. This action never removes local files.

## Everyday use

Offline changes stay in a durable queue. Every change is signed; remote deletion alone never deletes a local file, while a signed tombstone can. Parallel offline edits are preserved as `.CONFLICT-…` copies. **Lock** removes workspace keys from the current session; **Unlock** uses the system keychain or local passphrase.

## Devices and recovery

A new mobile device creates a QR/manual-code request. Enter its short code on an already approved desktop and compare the fingerprint on both devices before approval. A removed device cannot sign new valid changes. If every device is lost, choose **Restore access** and open the `.pvrecovery` file with its separately stored code; Plainva creates a new owner device, can revoke the lost devices, and does not rewrite content objects. **Renew recovery** replaces the old recovery set through a dual-signed anchor chain. Store the new file and code separately again; the old set is invalid afterwards.

## Members, roles, and vault slices

Owners and admins can invite members, create groups, and scope roles to the whole workspace, a slice, or one object. An **Editor** can read and edit, a **Commenter** can read and comment, a **Reader** can only read, and a **Contributor** can only submit new content to the assigned scope. Plainva checks this before every local disk write and again before signing, so it also covers imports, restores, automations, AI actions, and changes made by other local programs.

A slice can contain a folder, an explicit object selection, or a dynamic rule over path, type, tags, and properties. Always use **Preview** before creating it. Only the displayed stable object IDs are materialized; one file can carry encrypted envelopes for several groups. Unauthorized objects are not materialized and never enter search, graph, or preview data.

## Comments, versions, and security review

Commenters get a read-only editor with a comment area. Comments and resolution markers are encrypted and signed workspace objects themselves. **Version history** reads encrypted workspace revisions and restores an older revision as a new signed change or as a copy.

Malformed remote artifacts are isolated under **Integrity & local forks**. You can retry them, export their ciphertext, mark an externally repaired artifact as repaired, or deliberately ignore it. One malformed file does not stop valid synchronization, and remote absence alone is never interpreted as deletion. A local program’s unauthorized change is retained as a private fork copy.

## Removing an encrypted vault the right way

When you no longer need an encrypted vault, decommission it in Plainva **before** you delete the cloud folder. The order matters: the fail-closed guard keeps sync stopped if the cloud copy disappears while Plainva still expects the connection to be encrypted — this protects you from an attacker stripping the encryption to force plain text.

1. Open **Settings → your vault → Security & Sharing**.
2. In the recovery card, choose **Decommission workspace**. Plainva clears the local keys and workspace data on this device and reopens the vault as a normal vault.
3. Only now delete the cloud folder (the `.pvws/` objects) at your provider if you want it gone. Plainva does not delete the encrypted cloud objects for you.

If you already deleted the cloud copy and sync now fails with a "workspace is missing" or "manifest is missing" error, the fix is the same reset, offered where the error appears:

- For an encrypted **workspace**, open **Security & Sharing**. The status shows an error with a recovery note; choose **Decommission workspace** to reset the workspace on this device so sync works again.
- For a content-encrypted **sync connection**, click the sync status to open the sync-error dialog and choose **Reset encryption**. This button only appears when the remote encryption data is missing or invalid.

Both actions are explicit and confirmed. Plainva never silently downgrades an encrypted connection to plain text, and neither action deletes any local files. If the cloud still holds encrypted content you actually want, cancel instead — resetting would resume plain-text sync.

Removing a vault with **Forget app data** (Splash → remove a vault → also forget app data) clears these encryption markers too, so a vault removed that way leaves nothing behind that could block a later re-connection.
