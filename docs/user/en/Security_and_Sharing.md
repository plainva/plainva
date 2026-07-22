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
