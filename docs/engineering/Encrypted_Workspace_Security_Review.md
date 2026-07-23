# Encrypted Workspace Independent Review Record

Last reviewed: 2026-07-23

Status: **BLOCKED — independent review not yet performed**

This is deliberately not a self-attestation. An independent reviewer must inspect the protocol and threat model, HPKE use, signatures and chain validation, AEAD framing/AAD, recovery/owner-transfer ordering, revocation/full rekey, published-slice isolation, and provider faults.

Surfaces added since 2026-07-23 that the review scope MUST also cover: the invitation codec (`PVINVITE1`) and the offline QR representation of invitation and pairing tokens (a QR must carry no more authority than the copyable text, and reading it must not skip the fingerprint comparison); the device-local decommission and the fail-closed orphan reset (neither may downgrade an encrypted connection to plaintext without explicit confirmation); and the boundary between the content-E2E "reset encryption" and the workspace decommission. The global "lift encryption" action (plaintext re-upload + remote `.pvws/` removal) is not implemented and therefore out of this record's scope until it exists.

| Evidence | Required result | Current result |
|---|---|---|
| Independent crypto review | No open critical/high finding | Missing |
| Android two-device exercise | Pair, revoke, replay rejected, rekey resumes | Missing |
| iOS two-device exercise | Same plus background/pause/kill | Missing |
| Android internal build | Signed internal artifact installed | Missing |
| iOS TestFlight build | Internal build installed | Missing |

Internal development may continue while blocked. Plainva must not claim public encrypted-workspace clearance before this record is complete.
