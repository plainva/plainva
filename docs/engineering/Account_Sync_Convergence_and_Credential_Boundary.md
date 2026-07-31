# Account-sync convergence and credential boundary

Status: **implemented; native multi-device acceptance remains a release gate.**

This document is the normative architecture and field catalog for the account
part of Plainva settings sync. It complements
`Settings_Sync_Encryption_Protocol.md`, which specifies the sideband encryption
and wire formats.

## 1. Fixed-point model

Both shells export the same sparse canonical profile:

1. Normalize known values against one domain-default table.
2. Omit values equal to a known default; retain unknown future fields.
3. Sort object keys and set-like account collections deterministically while
   preserving semantic order in bookmarks and template rules.
4. Map local account ids and service references to persistent logical ids.
5. Reconcile each profile field independently by revision, timestamp and
   device-id tie-break.
6. Apply a remote absence as the known domain default/reset, then persist the
   same canonical projection locally.

After adoption, neither a default-filled mobile object nor a different local
account id can create a corrective upload. An unchanged cycle may still check
and download the remote document; it uploads nothing.

Concurrent edits to different fields survive because the profile keeps
per-field revision metadata and tombstones. A local edit to one field cannot
replace an unrelated newer field from another device.

## 2. Account identity and field catalog

The shared id is a transport identity, not a physical database row or keychain
slot. Each installation stores a bidirectional relationship between logical
PIM, mail, cloud and secret ids and its own local ids.

OAuth accounts merge automatically only when a prior map already proves the
relationship or both records carry the same provider-owned identity:

- Google: `sub` from a successful authenticated user-info response.
- Microsoft: `id` from a successful authenticated `/me` response.

Equal labels, display names or unverified email strings do not prove identity.
CalDAV and IMAP can use their normalized server/user binding because those
protocol endpoints define the account.

| Area | Shared profile data | Installation-local data |
| --- | --- | --- |
| PIM account | logical id, provider, label, enabled state, URL/user metadata, verified provider identity | runtime row id, OAuth client id/secret, refresh/access token, pending local selections |
| Mail account | logical id, label, protocol endpoint/user, signatures | runtime row id, local OAuth client field and credential slot |
| Cloud account | logical id, provider family/flavor, label, verified provider identity, logical service references | runtime card id, BYO client id, local service ids and credential slots |
| PIM selections | logical account id, provider calendar/task-list id, selected state | temporary pending rows until provider data exists |
| Profile settings | fields in `PROFILE_FIELDS`, sparse against `PROFILE_DEFAULTS` | absolute paths, runtime timestamps, one-time hints, global device layout and caches |
| Logical mapping | logical ids carried by the profile and secret bundle | local-to-logical PIM/mail/cloud maps, physical-secret-slot map and retired-id aliases |

The executable catalog is `packages/ui/src/lib/profileFields.ts`; the account
DTO classification is `ACCOUNT_FIELD_SCOPE` in
`packages/ui/src/lib/accountProfile.ts`.

## 3. Credential channels

| Credential or metadata | Channel | Rule |
| --- | --- | --- |
| OAuth client id/client secret | Native keychain/keystore on one installation | Never exported; changing either invalidates the local grant atomically |
| OAuth refresh/access token | Native keychain/keystore on one installation | Never exported or combined with another client registration |
| Granted scopes/audience | Local OAuth unit | Used to prevent a Drive-only grant from authorizing Calendar |
| CalDAV password | Encrypted `secrets.enc` | Shareable only with a matching logical id and canonical endpoint binding |
| IMAP app password | Encrypted `secrets.enc` | Shareable only with a matching logical id and canonical endpoint binding |
| `google-pim-client` | Legacy input only | Quarantined as redacted metadata; never exported, applied or used for authentication |

The entire decrypted bundle is structurally validated before the first
keychain/keystore or metadata write. After that boundary, policy and slot
failures are isolated per logical entry. A failed slot group rolls back its own
snapshot; a failed metadata commit rolls back every successful group.

## 4. Migration and repair

A v0.6.0 profile remains readable. The current client adds a capability stamp
for canonical logical accounts and the installation-local OAuth boundary. This
causes one migration upload; repeated unchanged cycles are quiet.

If an old publisher reintroduces legacy client fields, a current client:

- does not apply them to local authentication;
- records only a redacted legacy reason;
- re-publishes the safe canonical projection when required;
- leaves encrypted legacy bytes remotely recoverable until explicit cleanup.

Verified duplicate account cards are repaired through a durable, secret-free
snapshot journal. Ambiguous cards are not merged automatically and require an
explicit source/target preview. Cleanup moves secret material only between
native credential slots and removes a source only after the merge commits.

Remote legacy-secret cleanup requires an explicit assertion that every device
is upgraded. The exact original encrypted bytes are written and verified in the
local recovery path before the remote bundle is changed.

## 5. Diagnostics and redaction

Profile diagnostics record four separate facts: check, remote download, local
application and completed target upload. A failed push is never reported as an
upload.

Secret diagnostics store only counts for imported, unchanged, rejected, stale,
error, waiting and legacy results plus stable reason-code counts. They never
copy logical ids, addresses, credential values or raw provider errors.
Free-form diagnostic errors are redacted before display or persistence.

## 6. Executable acceptance matrix

Every row has a named executable contract. Native rows add real-provider and
secure-store acceptance in the internal build/device gate; they are not
represented as unit-test success.

| Case | Automated contract | Remaining native observation |
| --- | --- | --- |
| T1 | Desktop → mobile → desktop initial adoption; no default correction and no later upload | Desktop ↔ Android/iOS with one online vault |
| T2 | Remote absence resets a stale mobile value and it is not re-exported | Reset one visible setting on each native shell |
| T3 | Mobile → desktop → mobile adopts the same canonical projection and stays quiet | Reverse native direction |
| T4 | Concurrent edits to different fields merge without loss | Make two offline edits, reconnect both devices |
| T5 | Three installations retain independent client/token units for one provider identity | Desktop, Android and iOS use their own Google registrations |
| T6 | Replacing either half of one local client invalidates only that local grant | Change/re-enter one device's client and observe local re-auth only |
| T7 | Legacy Google client rejection does not block an independent IMAP password | Google PIM plus IMAP/SMTP app password |
| T8 | Different physical ids map to one logical account and the correct local secret slot | Compare native local rows after adoption |
| T9 | Sparse v0.6.0 profile and legacy secret fixture migrate without applying foreign OAuth data | Upgrade a copied v0.6.0 test vault |
| T10 | Repeated legacy publication is healed without changing local authentication | Keep one v0.6.0 client active for one cycle |
| T11 | Equal verified provider identities merge with a journal and preserve usable local auth | Native duplicate fixture with a verified identity |
| T12 | Equal labels without verified identity remain separate and require explicit repair | Cancel, then confirm the native repair dialog |
| T13 | Malformed/unauthentic secret data causes zero writes; diagnostics redact client/token fields | Corrupt a copied encrypted bundle, never the only recovery copy |
| T14 | Repeated unchanged cycles report checks/downloads but no additional target upload | Record at least three native cycles on all participating devices |
| T15 | Android accepts `X.Y.Z.N` only as `versionName`; package/iOS stay three-part and build numbers rise | Verify the distributed AAB/APK and two TestFlight build numbers |

## 7. Release gates

- Run lint, typecheck, unit/integration suites, locale/document parity, design
  guards, desktop E2E and production smoke.
- Build Android and iOS from the same tested commit. Android internal builds use
  `X.Y.Z.N`; a regular release returns to `X.Y.Z`. iOS keeps marketing version
  `1.0` and increments its build number.
- Perform Desktop ↔ Android, Desktop ↔ iOS, Android ↔ iOS and simultaneous
  three-device cycles with distinct Google client registrations.
- Include one Google PIM account and one independent IMAP/SMTP account.
- Do not archive the acceptance work or claim release completion until the
  physical observations are confirmed.
