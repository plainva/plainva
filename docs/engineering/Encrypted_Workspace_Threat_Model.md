# Encrypted Workspace Threat Model

Last reviewed: 2026-07-22

## Assets and trust boundaries

Protected assets are content, path/catalog metadata, identities, group keys, recovery material, comments, suggestions, and history. The local device and OS key storage are trusted only while unlocked. Cloud providers, networks, listings, and provider ACLs are untrusted. A former recipient may retain plaintext already obtained; revocation cannot erase it.

## Adversaries and controls

- A malicious provider can omit, replay, reorder, truncate, duplicate, or mutate objects. Immutable hashes, Ed25519 chains, monotonic policy/checkpoint versions, CAS heads, authenticated PVO1 frames, quarantine, and fail-closed authorization detect these cases. Remote absence alone never means deletion.
- A revoked device can replay old operations. Active policy evaluation binds accepted operations to an active member/device and capability. Epoch rotation blocks future decryption; full rekey rewrites current live content when its cost is accepted.
- A compromised share ACL exposes ciphertext, not plaintext or capabilities. Published slices use an independent encrypted namespace. Sanitization prevents excluded property/link/embed metadata from entering the projection.
- A crash can happen after every rotation, queue, checkpoint, publication, or recovery phase. Durable cursors and immutable operations make retry idempotent. Owner transfer saves replacement recovery before activation.
- A compromised unlocked endpoint can exfiltrate everything granted to it. Native key storage, explicit locking, revocation, and least-privilege slices reduce persistence but cannot defeat malware controlling the unlocked process.

## Non-goals

Traffic-analysis resistance, hiding total ciphertext size/timing, remote deletion of downloaded plaintext, endpoint-malware protection, and anonymous collaboration are not promised. Provider ACLs are not a cryptographic boundary.

## Residual release gate

Automated tests cover malformed documents, tamper, chain gaps, partial listings, poisoned objects, crash resume, revocation, projection leakage, and namespace isolation. Public release remains blocked until an independent review has no open critical finding and physical Android/iOS two-device and store-build evidence is recorded.
