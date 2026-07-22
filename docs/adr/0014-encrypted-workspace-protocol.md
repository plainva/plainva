# ADR 0014: Encrypted workspace protocol

Status: Accepted

Date: 2026-07-22

## Context

Plainva's unreleased PVE1 content-encryption path was designed for a single
shared master key and path-shaped remote files. Extending it with team roles and
selective vault slices would either distribute excessive read/write authority or
create a second incompatible security model later. The current implementation
has not been released, so compatibility does not justify preserving that shape.

## Decision

Plainva will use one encrypted-workspace protocol for personal and team vaults.
Encrypted remotes are opaque `.pvws/` object stores with immutable encrypted
revisions, signed control documents, signed mutations and tombstones. Each
device has an Ed25519 signing key and an X25519 HPKE receive key. Content uses a
fresh DEK per revision; DEKs are wrapped to group keys per epoch. Write authority
is a device signature plus a policy capability and is never represented by a
shared writer private key.

Protocol v1 fixes XChaCha20-Poly1305, SHA-256, Ed25519 and RFC-9180 Base mode
HPKE with X25519/HKDF-SHA256/ChaCha20-Poly1305. Binary formats, JSON
canonicalisation, path rules, limits and validation order are normative in
`docs/engineering/Encrypted_Workspace_Protocol.md`.

PVE1 is not a public encrypted-workspace legacy format. Its content activation
path was removed during P3. Settings and account-secret sideband encryption
remain separately keyed and may reuse lower-level primitives, but not workspace
content keys or authority.

P3 implements the personal single-owner lifecycle: dual-signed bootstrap,
two-piece recovery backup, resumable plaintext-to-`.pvws/` migration, durable
operation queue/staging, verified local materialisation, checkpoints and a
Desktop Security & Sharing center. Existing remote plaintext remains until the
user removes it after successful migration.

## Consequences

- Personal encryption and future team permissions share one protocol core.
- A provider or reader cannot forge a valid write, rename or delete.
- Group membership and slices do not require distributing a global master key.
- Remote filenames no longer reveal vault paths for encrypted workspaces.
- Storage adapters become object stores; local Markdown materialisation and
  lifecycle migration are separate higher-level work.
- The protocol is more complex and requires independent review, fuzzing and
  multi-device/provider acceptance before release.
- Revocation protects future content but cannot erase plaintext or keys already
  learned by a formerly authorised endpoint.

## Alternatives

- Extend PVE1 with a shared slice writer key: rejected because compromise would
  enable impersonation and writing does not need decryption authority.
- One workspace master key plus UI-only ACLs: rejected because every member
  could decrypt every slice and bypass the UI.
- Provider-native sharing as the primary policy: rejected because provider
  support differs and shared provider credentials bypass it.
- A Plainva coordination backend: deferred; the product remains backend-free
  and accepts the corresponding availability/freshness limits.

## Links

- `docs/engineering/Encrypted_Workspace_Protocol.md`
- `docs/engineering/Settings_Sync_Encryption_Protocol.md`
- `docs/adr/0013-settings-sync-and-content-e2e-lifecycle.md`
