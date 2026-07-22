# Settings-sync & encryption protocol (v1, predecessor content format)

Status: **implemented but unreleased. The profile/secrets sideband remains the
current implementation; the PVE1 content-encryption portion is superseded by
`Encrypted_Workspace_Protocol.md` and was removed from content activation paths
in P3.** This document is the publicly reviewable specification of the
on-disk/on-wire formats, state machine and threat model for Plainva's opt-in
settings-sync and end-to-end vault encryption. The corresponding protocol code
lives in `packages/core/src/crypto/` and `packages/core/src/settingsSync/`; shell
wiring lives in the desktop and mobile apps.

Nothing here requires or implies a Plainva account. The passphrase (or the master
key it protects) is the only factor.

## 1. Scope and building blocks

Three independently opt-in features on one shared crypto base:

1. **Profile sync** — vault-scoped settings travel with the vault as a small
   sideband file. Plaintext `settings.json` while no master key exists; sealed
   `settings.enc` (under `K_settings`) once any master key exists.
2. **Account-secrets sync** — a hard-allowlisted set of *static* secrets
   (CalDAV/IMAP app passwords, optional static Google PIM BYO app credentials)
   travels as `secrets.enc` (under `K_secrets`). **No rotating OAuth token ever
   syncs** (Microsoft, Google OAuth, OneDrive, Dropbox) — a shared rotating token
   would break both devices.
3. **End-to-end vault sync** — the *remote* copy of vault contents is ciphertext;
   the **local vault stays plain Markdown** (Obsidian compatibility, external
   tools, OS search). A per-connection `encryption.json` manifest drives the
   lifecycle. Only Plainva's own sync is transport-encrypted; a third-party mirror
   (Syncthing, an OS cloud folder) mirrors the local plaintext.

## 2. Transport: the sideband channel

All control/data files live under **`.plainva/sync/`** and are moved by a
dedicated step in the sync cycle — targeted `download` + revision compare + `push`
— never through the queue/reconcile/merge path.

| Path | Content | Encryption |
| --- | --- | --- |
| `.plainva/sync/settings.json` | profile (plaintext mode only) | none |
| `.plainva/sync/settings.enc` | profile (once a master key exists) | PVE1, `K_settings` |
| `.plainva/sync/secrets.enc` | account-secrets bundle | PVE1, `K_secrets` |
| `.plainva/sync/keyfile.json` | passphrase-wrapped master key(s) | wrapped under KEK |
| `.plainva/sync/encryption.json` | per-connection E2E manifest (remote-only) | HMAC-authenticated |

The content-E2E decorator (feature 3) passes **all** of these through
unencrypted: `keyfile.json`/`encryption.json` must be readable before unlock, and
`settings.enc`/`secrets.enc` already carry their own AEAD layer. There is no
double content-encryption of sideband files.

- `.plainva` is excluded from pull/reconcile/deletion-mirror/queue
  (`isLocalOnlyPath`), so the sync core's data-safety guards are untouched.
- The sideband files are read/written locally only through the **raw** adapter
  (never the conflict-aware app adapter, which would create `sync_state` rows and
  `.CONFLICT` copies of a settings file).

## 3. Crypto primitives

- **KDF:** scrypt via `@noble/hashes` (`scryptAsync`) is the portable v1 default.
  Default params `N = 2^16, r = 8, p = 1` (~64 MiB). The keyfile header is
  algorithm-agile (`kdf.algo`); a native/WASM Argon2id branch may be added later
  behind cross-platform benchmarks and an audit gate. Readers validate hard
  min/max param bounds **before** any allocation, to reject DoS keyfiles. PBKDF2
  is not a new default.
- **AEAD:** XChaCha20-Poly1305 via `@noble/ciphers`, explicit 24-byte CSPRNG
  nonce, 16-byte tag.
- **Key separation:** a random 32-byte **master key (MK)**. HKDF-SHA256 with fixed
  domain strings derives independent subkeys — `plainva/e2e/content/v1`,
  `.../settings/v1`, `.../secrets/v1`, `.../manifest/v1`. The raw AEAD key is never
  reused across purposes by AAD alone.
- **Passphrase canonicalization:** UTF-8 → NFC, no implicit trimming, confirmation
  field on creation, minimum length + strength hint.
- **Randomness:** `crypto.getRandomValues`; a missing secure RNG is a hard setup
  error (release gate on real Desktop/Android/iOS builds).

### 3.1 PVE1 sealed-blob frame

Binary, network byte order:

```
'P''V''E''1' (4) | frameVersion:u8 | algorithm:u8 | purpose:u8 | flags:u8 |
keyIdLen:u8 | nonceLen:u8 | reserved:u16 | plaintextLen:u64 | ciphertextLen:u64 |
keyId (UTF-8 hex, keyIdLen bytes) | nonce (nonceLen bytes) | ciphertext+tag
```

- `frameVersion = 1`, `algorithm = 1` (XChaCha20-Poly1305). `purpose`:
  `1 = content`, `2 = settings`, `3 = secrets`. Unknown flags or non-zero
  `reserved` are rejected in v1.
- For XChaCha, `nonceLen = 24`, tag = 16, `keyIdLen ≤ 64`.
  `ciphertextLen == plaintextLen + 16`; total/purpose size limits are checked
  before allocation (`MAX_BLOB_BYTES = 512 MiB`).
- **AAD = every header byte up to and including the nonce.** It binds version,
  algorithm, **purpose**, lengths and keyId — deliberately **NOT the path** or any
  device-specific vault id, so renames (metadata-only sync ops) and cross-device
  re-keying keep working. No origin path is stored, so a legitimate rename never
  produces a false "wrong key/path" warning.
- `keyId` is in the clear so a decoder can detect a blob from a *different* master
  key (`readBlobKeyId`) before attempting decryption. Each purpose derives its own
  subkey, so a `settings` blob can never be opened as `content`.

### 3.2 Keyfile

`{ format:"plainva-keyfile", version, activeKeyId, kdf:{params,salt},
keys:[{keyId, wrapped:{nonce,ct}, createdAt}], verifier:{nonce,ct}, createdAt,
updatedAt }`. The passphrase-derived KEK wraps each MK. Outside a rotation `keys`
holds exactly one MK; during `rotating` it holds old + new. A dedicated
`verifier` detects a wrong passphrase cleanly, without unwrapping an MK. A
passphrase change re-wraps the same MK(s) (not a rotation). The **recovery code**
is a versioned Base32 export of keyId+MK with a checksum; a true MK rotation makes
a new recovery code, and the old one only opens data under the old key id.

> Re-wrap/rotation do not securely erase old provider versions; a keyfile kept in
> a provider's version history may still make an old passphrase/MK usable.

## 4. Profile document

`{ format:"plainva-profile", version, rev, updatedAt, deviceId, values }`.
`deviceId` is a locally persisted random UUID (never a host/user name).
Reconciliation is whole-document last-writer-wins: higher `rev` wins; equal
`rev` + equal values = converged; equal `rev` + different values → `updatedAt`,
then a deterministic `deviceId` tiebreak so both devices pick the same winner.
First participation on a device **adopts** the shared remote settings instead of
overwriting them. The loser is surfaced, never written as a `.CONFLICT`.

The syncable set is an explicit registry (logical name ↔ device-local store key,
re-keyed per device). Excluded by design: absolute paths, runtime timestamps,
one-time hints, layout/localStorage, `recents.json`, `graph.json`, and sync
provider credentials.

The desktop projection includes vault content/backup settings, bookmarks and
the metadata for cloud, PIM and mail accounts. Imported account IDs are mapped
to device-local IDs and every dependent reference is rewritten through that
map. Unknown forward-compatible fields are retained. Validation finishes before
the first write; a durable import journal snapshots all affected stores and
rolls them back after a crash or failed multi-store import.

## 5. Secrets bundle

`{ format:"plainva-secrets", version, bundleRev, updatedAt,
entries:{ <id>:{ entryRev, updatedAt, deviceId, tombstone?, binding, secret? } } }`,
sealed once under `K_secrets`.

- **Allowlist:** `caldav-password`, `imap-password`, `google-pim-client`.
  Everything else — every OAuth refresh/access token, session cookie, short-lived
  code — is refused by a code allowlist plus negative tests.
- **Endpoint binding:** each entry binds family/provider, service, secret type,
  normalized user and a **canonical endpoint fingerprint** (lowercase scheme +
  host, default port dropped, no userinfo/fragment, path trailing slash trimmed).
  An import proceeds only when the locally validated account metadata matches, so
  tampered profile metadata can never redirect a real password to a foreign host.
- **Per-entry LWW:** merge by `entryRev`, then `updatedAt`, then `deviceId`.
  Bundle-level LWW is never applied to secrets — an independent change to a
  different account is never lost. Tombstones carry no secret.

## 6. Content-E2E: `EncryptingSyncTarget`

A decorator around any `ISyncTarget`:

- `push`: for a normal write, seal a **copy** of `op.content` under `K_content`
  (the original plaintext must survive so the engine's post-push `base_sha256`
  stays a plaintext hash). Rename/delete/mkdir and sideband paths pass through.
- `download`: decrypt a sealed blob to plaintext; pass `null` and sideband paths
  through; in `strict` mode a plaintext (unsealed) result is a downgrade →
  `FatalSyncProtocolError`; in a mixed sweep plaintext is returned unchanged.
- All reconcile/echo/merge hashes are computed *after* `download()` (plaintext);
  provider etags are opaque change markers and are never crossed with plaintext
  SHAs, so non-deterministic ciphertext is safe.

Filenames and folder structure stay plaintext in v1 (metadata visible).

## 7. Connection manifest & state machine

`encryption.json` (canonical JSON, JCS-style) carries `formatVersion`,
`minGuardVersion`, `connectionId`, `keyId`, `newKeyId?`, `state`, `ownerDeviceId`,
`ownerLeaseUntil`, `generation`, timestamps, and a base64 HMAC-SHA256 (keyed by
`K_manifest`) over the canonicalized body. The parse path is key-free (for the
pre-unlock guard); verification needs the MK. The mere existence of `keyfile.json`
never implies content-E2E — the manifest `state` does.

States: `preparing | migrating | strict | decrypting | rotating | plain`.
`mixed` content (plaintext or valid ciphertext) is allowed only in `migrating`,
`decrypting`, `rotating`; `strict` accepts only valid ciphertext for the active
key/purpose. An authenticated `plain` is the terminal deactivation tombstone.

Desktop activation first requires a clean queue and two stable, matching
local/remote inventories. It publishes and verifies `preparing`, then `migrating`,
persists an exact-path journal and force-enqueues the full rewrite. Completion
requires an empty queue, an unchanged inventory and authenticated inspection of
every remote blob. Deactivation applies the same checks in reverse. True key
rotation publishes the two-key keyfile before `rotating`, reads with both keys,
writes only the new key, verifies every blob under the new key, commits `strict`,
and only then prunes the old key.

The transition owner holds a signed 24-hour lease. Its journal and forced sweep
are reconstructed on restart. Another unlocked device may adopt an expired
lease only with the complete key ring, a clean queue and matching stable
inventories; it keeps the same generation and repeats the idempotent sweep.

## 8. Fail-closed guard

`FatalSyncProtocolError` (reasons: `encrypted-without-key`, `plaintext-in-strict`,
`key-mismatch`, `manifest-invalid`, `guard-too-old`) is thrown by the pre-pull
manifest check and the decorator/reconcile on any protocol violation. It
propagates straight through the per-file pull guard — never counted as an ordinary
single-file failure — aborts the prefetcher and ends the whole cycle **before**
the push phase, so ciphertext never lands in a note and no plaintext is pushed
into an encrypted remote. This guard ships at least one app version before the
E2E activation UI (old clients without it would treat ciphertext as note text).

## 9. Threat model (summary)

- **Protected:** confidentiality of vault contents against the storage provider/a
  leak; confidentiality of secrets and (optionally) profile values; AEAD/MAC
  detects unauthenticated content/manifest tampering after trust-on-first-use.
- **Deliberately not protected:** compromised/unlocked endpoints, local plaintext,
  filenames/structure/sizes/timestamps/access patterns, availability, rollback to
  an older valid generation, and swapping valid same-purpose ciphertext blobs
  between paths (the path is intentionally outside the AAD so existing rename
  metadata works). Stronger freshness/path binding is a follow-up protocol.
- **Trust-on-first-use:** a malicious provider can hide a manifest on first
  contact; after a stored connection fingerprint, a missing/divergent manifest
  fails closed. Covering a compromised provider at first contact needs a second
  authenticated channel / device pairing (out of v1 scope).
- **Passphrase:** scrypt slows offline attacks but is no substitute for a strong
  passphrase. Recovery code + at least one unlocked device are the recovery paths;
  losing all wrap access leaves remote ciphertext unreadable while the local
  plaintext vault remains usable as long as one device/backup exists.
- **External sync tools** mirror the local plaintext vault, not Plainva's E2E
  format.

## 10. Test vectors and negative cases

Deterministic tests live in `packages/core/test/crypto.test.ts` and
`packages/core/test/settings-sync.test.ts`. A pinned scrypt golden vector
(`FAST_KDF = {algo:"scrypt", N:16, r:1, p:1}`, passphrase/salt in the test) is
`d666efb626705c96e3888a057e7f52f56681b74d6e9c2dcd4348350a79337ff7`. Mandatory
negative cases: corrupted/truncated/over-sized/foreign-purpose/foreign-key blobs,
tampered manifest MAC, endpoint-binding mismatch, non-shareable secret refusal,
plaintext-in-strict, and NFC passphrase equivalence.

## 11. Shell integration and remaining release gates

Desktop provides passphrase/recovery setup, OS-keychain-backed key caching,
sealed profile and allowlisted-secret ports, lifecycle controls, crash recovery,
key rotation and fail-closed worker startup. The diagnostic ring redacts common
credential fields, authorization headers and URL userinfo before storing an
error; exporters never query credential stores.

Mobile performs the same connection-fingerprint and manifest guard before its
worker starts, stores its unlocked multi-key ring in the native secure store,
wraps reads/writes for mixed/strict/rotating states, and participates in sealed
profile sync while retaining unknown desktop fields. Lifecycle activation,
deactivation and rotation are initiated on Desktop; mobile safely participates
and can unlock/lock the connection.

The following are verification/release gates, not missing protocol wiring:

- native two-device round trips for WebDAV, Google Drive, S3, OneDrive and
  Dropbox, including interruption/resume and a rotation;
- Android/iOS secure-RNG, key-store and memory-budget acceptance;
- failure-injection/large-file runs beyond the deterministic unit suite;
- an independent security review before declaring the feature Stable.
