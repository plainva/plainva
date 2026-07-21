# ADR 0013: Settings Sync and Content-E2E Lifecycle

- Status: Accepted
- Date: 2026-07-21

## Context

Plainva needs to share vault-scoped preferences and selected static account
secrets without introducing a Plainva account, and optionally hide the remote
vault contents from its storage provider. Local files must remain plain Markdown.
An interrupted migration, stale client or copied credential must never cause
ciphertext to be written into a note or plaintext to be pushed into a strict
encrypted connection.

## Decision

Use the versioned protocol specified in
`docs/engineering/Settings_Sync_Encryption_Protocol.md`:

- one random master-key ring with HKDF-separated content, settings, secrets and
  manifest keys;
- scrypt-wrapped keyfiles and PVE1 XChaCha20-Poly1305 blobs;
- sealed profile and allowlisted static-secret sidebands outside the file merge
  queue; OAuth refresh/access tokens are never shareable;
- an HMAC-authenticated per-connection manifest and a fail-closed pre-cycle guard;
- explicit preparing/migrating/strict/decrypting/rotating/plain lifecycle states,
  durable journals, generations, owner leases, crash resume and expired-lease
  takeover;
- Desktop owns lifecycle initiation; Desktop and mobile both enforce the guard,
  cache keys in their native secure stores and participate in encrypted sync.

## Consequences

The storage provider sees filenames, structure, sizes and access patterns, while
content and selected sideband values are confidential and authenticated. Local
Markdown remains compatible with other tools. Migration and rotation require a
complete remote rewrite and are deliberately conservative: clean queue, stable
matching inventory and per-blob verification before a strict state is committed.

Native two-device/provider acceptance and an independent security review remain
release gates. Losing every passphrase/recovery route makes the remote ciphertext
unrecoverable; an existing local plaintext vault remains usable.

## Alternatives rejected

- Encrypting local vault files: breaks the local-first/Markdown compatibility
  promise.
- Treating the keyfile as an encryption marker: profile encryption can create a
  keyfile without content encryption and old clients could mis-handle ciphertext.
- Sharing OAuth refresh tokens: concurrent rotation would invalidate another
  device and unnecessarily expands credential exposure.
- Best-effort per-file failures during protocol violations: a later push could
  downgrade or corrupt the connection, so protocol errors abort the entire cycle.
