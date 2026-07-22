# Encrypted Workspace protocol (v1)

Status: **normative P0 specification; P1/P2 implemented on 2026-07-22.**

This document defines the first Plainva encrypted-workspace wire protocol. It is
the security boundary for personal encrypted vaults and future team vaults.
Plaintext vaults keep using ordinary Markdown and the existing sync engine. An
encrypted workspace instead stores opaque, immutable protocol objects below
`.pvws/`; user-visible paths never become provider object names.

The keywords **MUST**, **MUST NOT**, **SHOULD** and **MAY** are normative.

## 1. Version, scope and non-goals

- Protocol version: `1`.
- Minimum implementation version: the client version recorded in genesis and
  policy documents.
- Binary object magic: `PVO1`; chunk magic: `PVC1`.
- Signed control documents use canonical UTF-8 JSON and `protocolVersion: 1`.
- A personal encrypted workspace is a workspace with one member. Team features
  add policies, groups and slices without replacing the object format.

Version 1 protects content, paths, control-document integrity and authorisation
against an untrusted storage provider and untrusted workspace writers. It does
not protect availability, traffic volume, object sizes, access timing, an
already-unlocked endpoint, or data a formerly authorised reader already saw.
The provider can withhold or roll back objects; local checkpoints make this
detectable after a client has observed a newer state, but no backend-free design
can force freshness on first contact.

PVE1 is not a compatibility format for encrypted workspace content. It remains
an implementation detail of the unreleased predecessor until its activation
path is replaced by P3. Settings and account-secret sideband data remain a
separate concern and never share workspace content keys.

## 2. Threat model and security invariants

### 2.1 Adversaries

The protocol assumes any combination of:

1. a storage provider that reads, rewrites, deletes, duplicates, reorders or
   withholds remote bytes;
2. a reader who may upload arbitrary provider objects but lacks write
   capabilities;
3. a writer with a valid device key whose capabilities are limited by policy;
4. a revoked device that retains every key and plaintext it obtained before
   revocation;
5. a network attacker below TLS, including retries and partial responses;
6. malformed objects crafted to trigger parser, allocation or path bugs.

Compromise of the local OS account, keychain, unlocked process or recovery
package is outside the confidentiality boundary. Provider credentials are an
availability mechanism, not workspace authority.

### 2.2 Invariants

Implementations MUST preserve all of the following:

- There is no team-wide master key and no shared writer private key.
- Read authority is possession of a group decryption key for an epoch.
- Write authority is an Ed25519 signature from a currently authorised device
  plus the required capability in the referenced accepted policy.
- Every content revision has a fresh random 32-byte data-encryption key (DEK).
- Every mutation, including rename and delete, is a signed operation.
- Provider absence is never interpreted as a logical delete.
- Immutable objects are content-address checked before acceptance.
- Mutable head files are hints only; immutable signed operations are truth.
- Unknown algorithms, versions, flags, fields and non-canonical encodings fail
  closed.
- Counts and lengths are validated before allocation or iteration.
- A single invalid remote object is quarantinable and does not grant authority
  or make unrelated objects invalid.

## 3. Cryptographic suite

Algorithm-suite identifier `0x01` is fixed to:

| Purpose | Algorithm | Identifier |
| --- | --- | --- |
| Object and chunk AEAD | XChaCha20-Poly1305 | Plainva suite `0x01` |
| Hash | SHA-256 | Plainva suite `0x01` |
| Signatures | Ed25519, RFC 8032 strict verification | Plainva suite `0x01` |
| Grant wrapping | RFC 9180 Base mode, DHKEM(X25519, HKDF-SHA256) | KEM `0x0020` |
| HPKE KDF | HKDF-SHA256 | KDF `0x0001` |
| HPKE AEAD | ChaCha20-Poly1305 | AEAD `0x0003` |
| Passphrase wrapping | scrypt with bounded parameters | keyfile-local |
| Subkey derivation | HKDF-SHA256 | Plainva suite `0x01` |

HPKE is provided by `@hpke/core`, `@hpke/dhkem-x25519` and
`@hpke/chacha20poly1305`; Plainva does not implement RFC 9180 itself. Ed25519 is
provided by `@noble/curves`. Object AEAD and hashes reuse the audited Noble
packages already used by Plainva.

Each device owns an Ed25519 signing pair and an X25519/HPKE receive pair. The
owner recovery identity owns a separate Ed25519 pair plus a stable random
32-byte recovery root. Each group epoch owns an X25519/HPKE pair and an
independent random 32-byte catalog key. The recovery private material and root
are package-only secrets; recovery-package wrapping and restore UX activate in
P3/P4 and do not broaden normal content-signing authority.

All random values MUST come from `crypto.getRandomValues` or a platform CSPRNG.
The deterministic entropy hooks in the core are test-only and MUST NOT be
configured by application code.

### 3.1 Domain separation

All Plainva HKDF and signing contexts are ASCII and versioned:

```text
plainva/workspace/<purpose>/v1/<workspaceId>/<objectId>/<revisionId>[/<index>]
```

Defined purposes are `document-signature`, `object-metadata`, `object-content`,
`object-chunk`, `object-dek`, `catalog`, `checkpoint`, `profile`, `secrets` and
`recovery-wrap`. Raw DEKs MUST NOT be used directly for more than one purpose.

For object keys, HKDF uses the 16-byte workspace ID as salt, the raw DEK as IKM
and the full purpose string as info. Output length is 32 bytes.

## 4. Identifiers, text and canonical paths

- Workspace, member, device, recovery, group, object and revision IDs are 16
  random bytes, rendered as exactly 32 lowercase hexadecimal characters in
  JSON. IDs in binary frames are the raw 16 bytes.
- Document hashes and content hashes are SHA-256, rendered as exactly 64
  lowercase hexadecimal characters.
- Human text MUST be valid Unicode, NFC-normalised UTF-8 with no unpaired UTF-16
  surrogates, NUL or C0/C1 control characters except horizontal tab where a
  payload schema explicitly permits it.
- Display names are at most 128 UTF-8 bytes. MIME hints are at most 255 ASCII
  bytes. Client version strings are at most 64 printable ASCII bytes.

A canonical vault path:

- is NFC-normalised UTF-8, relative, slash-separated and at most 4,096 bytes;
- has 1–255 UTF-8 bytes per segment;
- contains no empty, `.` or `..` segment, backslash, NUL, control character or
  Windows-reserved character `< > : " | ? *`;
- does not end in a space or dot and does not use a Windows device basename
  (`CON`, `PRN`, `AUX`, `NUL`, `COM1`…`COM9`, `LPT1`…`LPT9`);
- does not use `.pvws` (case-insensitively) as its first segment because that
  namespace is reserved for provider-side protocol objects;
- preserves case. Equality in the protocol is byte equality after NFC; any
  platform-specific case collision is a materialisation conflict, never silent
  coalescing.

Provider keys use only ASCII protocol components and MUST begin with `.pvws/`.
They never contain a canonical vault path.

## 5. Canonical signed control documents

Control documents are RFC-8785/JCS-style canonical JSON encoded as UTF-8 without
BOM. Object keys are sorted by UTF-16 code units, numbers are finite safe
integers, negative zero is encoded as `0`, and duplicate JSON keys, unknown
fields or non-canonical input are rejected. Encoders omit no security-relevant
field; optional fields are explicitly `null` where the schema says so.

The outer form is:

```json
{
  "kind": "policy",
  "protocolVersion": 1,
  "workspaceId": "00000000000000000000000000000000",
  "payload": {},
  "signatures": [
    {
      "algorithm": "Ed25519",
      "signerId": "00000000000000000000000000000000",
      "signerKind": "device",
      "value": "base64"
    }
  ]
}
```

Each signature signs:

```text
UTF8("plainva/workspace/document-signature/v1\0") ||
UTF8(canonicalJson({kind, protocolVersion, workspaceId, payload, signer}))
```

where `signer` contains `algorithm`, `signerId` and `signerKind`, but not the
signature value. Verification uses strict RFC-8032 semantics (`zip215: false`).
The SHA-256 of the complete canonical document, including signatures, is its
document hash. Signature order is lexicographic by `signerKind`, then
`signerId`; duplicate signer entries are invalid.

Grant, operation, catalog and head documents require exactly one device
signature; grant, operation and head signer IDs MUST equal their respective
issuer/author/device payload ID. A checkpoint requires exactly one device or
recovery signature. Policy signer-authority and chain acceptance are evaluated
against the previously accepted policy in P5; framing never makes a signer
authoritative by itself.

### 5.1 Document schemas

All arrays are order-significant and bounded. Set-like arrays MUST already be
sorted by their primary ID and contain no duplicate.

#### Genesis (`genesis.pvgen`, maximum 64 KiB)

Payload fields:

- `createdAt`: RFC-3339 UTC timestamp, informational only;
- `minimumClientVersion`: printable ASCII;
- `algorithmSuites`: exactly `[1]` in v1;
- `initialOwnerMember`: `{memberId, displayName}`;
- `initialOwnerDevice`: `{deviceId, memberId, displayName, platform,
  signingPublicKey, hpkePublicKey}`; keys are 32-byte base64;
- `recovery`: `{recoveryId, signingPublicKey}`;
- `initialPolicyHash`: SHA-256 hex.

Genesis requires one signature from `initialOwnerDevice.deviceId` and one from
`recovery.recoveryId`. Its complete document hash is the workspace fingerprint.
Genesis is immutable.

#### Policy (`policies/<hash>.pvpol`, maximum 4 MiB)

Payload fields:

- `policyVersion`: integer `>= 1`;
- `previousPolicyHash`: SHA-256 hex or `null` for version 1;
- `minimumClientVersion`, `algorithmSuites`;
- `members`: up to 10,000 member records;
- `devices`: up to 50,000 device records containing member binding, public keys
  and state `active|revoked`;
- `groups`: up to 10,000 group records with current key epoch and HPKE public
  key;
- `assignments`: up to 100,000 role/capability scope records;
- `slices`: up to 10,000 bounded slice definitions;
- `objectOverrides`: up to 100,000 explicit object grants;
- `revocations`: up to 100,000 member/device revocation records.

P1 validates the framing, identifiers, keys, ordering and bounds. Capability
semantics and policy-chain acceptance are P5 responsibilities. Concurrent valid
policy successors are never resolved by last-writer-wins.

#### Grant (`grants/<recipientDeviceId>/<hash>.pvgrant`, maximum 64 KiB)

Payload fields: `recipientDeviceId`, `issuerDeviceId`, `policyHash`, `purpose`,
`groupId`, `keyEpoch`, `keyHint`, `enc`, `ciphertext`, `createdAt`, `expiresAt`.
The HPKE plaintext is a typed 32-byte key. `enc` is exactly 32 bytes and the
ciphertext is exactly 48 bytes for a 32-byte key. HPKE info and AAD bind every
identifier, purpose, policy hash and epoch. Grants require an issuer-device
signature in addition to HPKE authentication.

#### Operation (`operations/<deviceId>/<sequence>-<hash>.pvop`, maximum 64 KiB)

Payload fields: `operationId`, `deviceId`, `memberId`, `sequence`,
`previousDeviceOperationHash`, `policyHash`, `capability`, `operation`,
`objectId`, `revisionId`, `parentRevisionIds`, `payloadHash`, `createdAt`.
Operation is one of `create`, `write`, `rename`, `delete`, `mkdir`, `comment` or
`resolve`. IDs are 16-byte IDs; predecessor, policy and payload references are
SHA-256 hashes. A sequence is a positive safe integer, starts at one and MUST
increase per device. Sequence one has a `null` predecessor; later operations
have the complete previous operation-document hash.

The capability is fixed by the operation kind: `create|mkdir` use
`content.create`, `write|resolve` use `content.write`, `rename` uses
`content.rename`, `delete` uses `content.delete`, and `comment` uses
`comment.create`. `create|mkdir` have no revision parents. Ordinary mutations
have at least one parent; `resolve` has at least two. Non-delete operations bind
a new logical `revisionId` and the complete PVO1 `payloadHash`. Delete binds one
or more parent revisions and has `null` revision/payload fields. Timestamps do
not establish authority or ordering.

#### Catalog (`catalogs/<groupId>/<epoch>/<hash>.pvcat`, maximum 16 MiB)

Payload fields: `groupId`, `keyEpoch`, `catalogVersion`,
`previousCatalogHash`, `bodyHash`, `bodySize`, `nonce`, `ciphertext`. The
XChaCha-encrypted canonical body is exactly `{objectRefs:[...]}`; each reference
contains `objectId`, logical `revisionId` and the complete PVO1 `payloadHash`,
and references are sorted and unique. The
signed document binds the ciphertext hash and its public group/epoch/version
context without exposing the object-reference set. The decrypted body is at
most `12 MiB - 4 KiB`, leaving deterministic room for AEAD/base64 expansion and
the signature envelope inside the 16 MiB document limit.

#### Checkpoint (`checkpoints/<hash>.pvcheck`, maximum 4 MiB)

Payload fields: `checkpointVersion`, `policyHash`, `operationHeads`,
`objectRootHash`, `createdAt`. Operation heads are sorted unique tuples of
`deviceId`, `sequence` and `operationHash`. A checkpoint is evidence of an
observed state, not consensus and not a source of deletion by absence.

#### Head (`heads/<deviceId>.pvhead`, maximum 16 KiB)

Payload fields: `deviceId`, `sequence`, `operationHash`, `checkpointHash`.
Heads are replaceable acceleration pointers. Readers validate their signature
and follow only immutable referenced documents.

## 6. PVO1 object frame

All integers are unsigned big-endian. The fixed header is exactly 80 bytes:

| Offset | Size | Field | Constraint |
| ---: | ---: | --- | --- |
| 0 | 4 | magic | ASCII `PVO1` |
| 4 | 1 | frame version | `1` |
| 5 | 1 | algorithm suite | `1` |
| 6 | 2 | flags | only bit `0x0001` (`chunked`) |
| 8 | 16 | workspace ID | raw ID |
| 24 | 16 | object ID | raw ID |
| 40 | 16 | revision ID | raw ID |
| 56 | 4 | chunk size | `0` inline; `1..4,194,304` chunked |
| 60 | 4 | chunk count | `0` inline; `1..65,535` chunked |
| 64 | 8 | plaintext length | `0..2,147,483,648` |
| 72 | 2 | envelope count | `1..1,024` |
| 74 | 4 | metadata block length | `40..1,048,616` |
| 78 | 2 | reserved | zero |

The header is followed by `envelopeCount` fixed 120-byte envelopes:

| Relative offset | Size | Field | Constraint |
| ---: | ---: | --- | --- |
| 0 | 16 | group ID | raw ID |
| 16 | 4 | key epoch | positive |
| 20 | 8 | key hint | opaque bytes |
| 28 | 2 | KEM ID | `0x0020` |
| 30 | 2 | KDF ID | `0x0001` |
| 32 | 2 | AEAD ID | `0x0003` |
| 34 | 2 | encapsulated-key length | `32` |
| 36 | 2 | ciphertext length | `48` |
| 38 | 2 | reserved | zero |
| 40 | 32 | encapsulated key | RFC 9180 `enc` |
| 72 | 48 | wrapped DEK | HPKE ciphertext and tag |

Envelopes are sorted by `(groupId bytes, keyEpoch, keyHint)` and unique. HPKE
info is the `object-dek` domain. AAD is the suite byte followed by workspace,
object, revision and group IDs, key epoch and key hint. This prevents moving an
envelope between objects, revisions, workspaces or group epochs.

The envelope table is followed by:

1. `metadataLength` bytes: 24-byte XChaCha nonce followed by ciphertext/tag of
   canonical object metadata;
2. the payload block: the same `nonce || ciphertext || tag` layout.

Object metadata is canonical JSON with exactly: `path`, `mime`, `parentObjectId`,
`plaintextSha256`, `createdAt`, `modifiedAt`, `contentKind`. Paths follow section
4; parent may be `null`; content kind is `text|binary`.

For inline objects the payload plaintext is the file bytes and MUST be at most
8 MiB. `chunkSize` and `chunkCount` are zero. For chunked objects the payload
plaintext is a canonical manifest:

```json
{"chunks":[{"index":0,"plaintextLength":4194304,"sha256":"..."}],"totalPlaintextLength":4194304}
```

The manifest has one ordered entry per chunk and is at most 4 MiB. The sum of
chunk lengths equals the header plaintext length. Object metadata and payload
use distinct HKDF subkeys. Their AEAD AAD is the fixed header followed by the
SHA-256 of the complete envelope table and the ASCII purpose.

The maximum complete inline PVO1 frame is 16 MiB. A chunked object frame is at
most 8 MiB; chunk bytes are stored separately.

## 7. PVC1 chunk frame

Each chunk has a 92-byte fixed header:

| Offset | Size | Field | Constraint |
| ---: | ---: | --- | --- |
| 0 | 4 | magic | ASCII `PVC1` |
| 4 | 1 | frame version | `1` |
| 5 | 1 | algorithm suite | `1` |
| 6 | 2 | flags | zero |
| 8 | 16 | workspace ID | matches object |
| 24 | 16 | object ID | matches object |
| 40 | 16 | revision ID | matches object |
| 56 | 4 | chunk index | `< chunkCount` |
| 60 | 4 | plaintext length | `0..4,194,304` |
| 64 | 24 | XChaCha nonce | unique for the chunk key |
| 88 | 4 | ciphertext length | plaintext length + 16 |

The remaining bytes are ciphertext/tag. The chunk key is derived with the
`object-chunk` domain including the index. The complete 92-byte header is AAD.
The chunk object's SHA-256 is recorded in the encrypted manifest. Readers verify
the frame identifiers, index, lengths, AEAD tag and manifest hash before
releasing plaintext.

## 8. Remote object-store layout and contract

```text
.pvws/genesis.pvgen
.pvws/policies/<policyHash>.pvpol
.pvws/policy-heads/<deviceId>.pvhead
.pvws/grants/<recipientDeviceId>/<grantHash>.pvgrant
.pvws/catalogs/<groupId>/<epoch>/<catalogHash>.pvcat
.pvws/operations/<deviceId>/<sequence>-<operationHash>.pvop
.pvws/heads/<deviceId>.pvhead
.pvws/objects/<objectId>/<payloadHash>.pvobj
.pvws/chunks/<objectId>/<revisionId>/<chunkIndex>-<chunkHash>.pvchunk
.pvws/checkpoints/<checkpointHash>.pvcheck
```

`putImmutable` verifies the caller-supplied SHA-256 before upload, treats
identical existing bytes as success, and fails on different existing bytes.
After upload it reads and verifies the object. Pointer compare-and-swap uses
native conditional writes where available; the v1 compatibility adapters use
read/compare/write/read verification and report a race instead of claiming
success. A pointer is never authoritative without its signature and immutable
target.

List cursors are opaque, prefix-bound and stable only for one listing attempt.
Pagination never implies a complete remote snapshot until the final page.
Cancellation aborts the caller-visible operation; underlying existing sync
transports retain their provider timeout/retry behaviour. No store API exposes
delete in P0–P2.

## 9. Parser and resource limits

Before allocation, parsers enforce:

- control document input: per-kind maximum above;
- PVO1 inline frame: 16 MiB; chunked frame: 8 MiB;
- PVC1 frame: 4 MiB + 108 bytes;
- plaintext file: 2 GiB; metadata: 1 MiB; manifest: 4 MiB;
- 1,024 envelopes; 65,535 chunks; 100,000 policy list entries per bounded list;
- base64 decoded lengths exactly matching the schema;
- all numeric inputs safe integers and all reserved bits/bytes zero.

Decoding does not allocate based on an untrusted count until checked against the
remaining byte length and hard maximum. UTF-8 decoding is fatal on malformed
input. Parser errors are typed and contain no secret or plaintext values.

## 10. Validation order

Readers MUST validate in this order:

1. maximum byte length;
2. magic/version/suite/flags and fixed-header bounds;
3. counts, lengths, integer overflows and exact total length;
4. canonical encoding, IDs, paths, ordering and duplicates;
5. document hashes and references;
6. signatures against an already accepted genesis/policy key;
7. current policy capability and revocation state;
8. HPKE envelope binding;
9. AEAD and plaintext/content hashes.

No step grants authority based on data validated only by a later step.

## 11. Golden vectors and portability probe

Machine-readable vectors live in
`packages/core/test/fixtures/workspace-v1-golden.json`. Tests include:

- RFC 9180 Appendix A.2.1 Base mode vector for X25519/HKDF-SHA256/
  ChaCha20-Poly1305;
- RFC 8032 Ed25519 vector plus Plainva strict verification;
- deterministic signed genesis/policy/operation documents;
- inline PVO1, chunked PVO1 and PVC1 bytes and SHA-256 hashes;
- corruption, truncation, length, Unicode, path, wrong-workspace,
  wrong-revision, wrong-group and wrong-epoch negative cases.

`probeWorkspaceCryptoRuntime()` exercises RNG, Ed25519, HPKE and XChaCha in one
shared-core call. P0 runs it in Node tests and verifies that the same module
bundles in Desktop and the Capacitor mobile web application. Native device
round trips remain a release gate in P11 because P0–P2 expose no user workflow.

## 12. Adversarial design review

The P0 review explicitly rejected these designs:

- **Shared writer key:** one compromised writer could impersonate every writer.
  Replaced with per-device signatures.
- **One workspace master key:** every team reader would gain all future slices.
  Replaced with group encryption keys per epoch and per-revision DEKs.
- **Provider ACL as authority:** unavailable on generic WebDAV/S3 and bypassable
  by shared credentials. ACLs are optional defence in depth only.
- **Delete by missing listing entry:** partial listings and provider rollback
  would destroy local data. Only signed tombstones delete.
- **Mutable path-shaped ciphertext tree:** filenames leak, provider renames race
  and traversal mistakes become destructive. Replaced with opaque immutable
  objects and signed rename operations.
- **Timestamp/LWW policies:** clocks are attacker-controlled and concurrent
  administration could silently revoke grants. Policy forks require an explicit
  owner merge in P5.
- **Global failure on one bad object:** lets any writer deny all sync. Invalid
  objects are individually quarantined in P7.
- **Unauthenticated HPKE envelope metadata:** permits cross-object key-envelope
  substitution. All identifiers and the epoch are HPKE AAD.

Residual risks: malicious endpoints, historical reader knowledge, provider
availability/freshness, traffic analysis, JavaScript best-effort memory wiping,
and cryptographic library supply-chain compromise. Independent review, parser
fuzzing and real multi-provider/multi-device testing are mandatory P11 gates.

## 13. P0–P2 boundary

P0 specifies formats and invariants. P1 implements crypto, identities, signed
documents, PVO1/PVC1 and hardened parsers. P2 implements the opaque object-store
contract and adapters over the five existing provider transports. P0–P2 do not
activate encryption, migrate a vault, materialise plaintext, evaluate team
capabilities or expose UI. Those are P3 and later packages.

## 14. Implementation map

- `packages/core/src/workspace/crypto.ts`, `identity.ts`, `grant.ts` and
  `catalog.ts`: device/recovery/group keys, HPKE grants and encrypted catalogs;
- `packages/core/src/workspace/documents.ts`: bounded canonical signed control
  documents and operation-chain framing;
- `packages/core/src/workspace/pvo1.ts`: PVO1/PVC1 encoding, decoding and the
  fuzz entry point;
- `packages/core/src/workspace/objectStore.ts` and `fakeObjectStore.ts`: store
  contract, deterministic fake, and WebDAV/Drive/S3/OneDrive/Dropbox adapters;
- `packages/core/test/fixtures/workspace-v1-golden.json`: checked-in machine
  vectors regenerated by `pnpm --filter @plainva/core vectors:workspace`;
- `pnpm --filter @plainva/core fuzz:workspace -- <iterations>`: prepared parser
  mutation harness.

Provider adapters are intentionally library-only until P3. Real-account
provider round trips and native-device crypto probes remain credential/device
release gates; P0–P2 verify the shared module in Node and production Desktop and
Mobile bundles without exposing an incomplete user workflow.
