# ADR 0015: Account-sync convergence and installation-local OAuth

Status: Accepted

Date: 2026-07-31

## Context

Desktop, Android and iOS can connect the same logical Google account with
different OAuth client registrations. Treating a client id, client secret or
grant as shared account metadata lets one installation overwrite another
installation's working authentication. Differences between desktop and mobile
profile projections can also create an endless sequence of corrective uploads
even when nobody changed a setting.

Static CalDAV and IMAP app passwords have a different lifecycle. A user may
intentionally share them through the encrypted vault sideband, but a conflict
or malformed entry must not block an unrelated password.

## Decision

- Desktop and mobile use one sparse, canonical, per-field profile projection.
  Known defaults are omitted, remote absence resets a known field to its domain
  default, set-like account collections are deterministically ordered and
  semantically ordered lists retain their order.
- Runtime account ids and keychain slots are installation-local. A persistent
  map relates them to logical profile and secret ids.
- OAuth accounts merge automatically only through an existing logical mapping
  or a provider-owned identity obtained from an authenticated response, such as
  Google `sub` or Microsoft `/me.id`. A label or email-like display string alone
  is never sufficient.
- OAuth client ids, client secrets, refresh/access tokens, grants and pending
  device state remain installation-local. Replacing either half of a local
  client registration invalidates its local grant atomically and requires
  re-authentication only on that installation.
- Only bound CalDAV and IMAP passwords are shareable through `secrets.enc`.
  Entries merge and import independently by logical id. The retired
  `google-pim-client` type is read only for quarantine/migration and can never
  be exported or applied.
- A migration or account repair is non-destructive: ambiguous identities require
  an explicit target choice, every mutation has a recoverable local journal,
  and secret material remains in keychain/keystore slots rather than settings,
  logs or diagnostic snapshots.
- Diagnostics distinguish check, download, local application and a completed
  target upload. Secret diagnostics contain aggregate counts and stable reason
  codes only.

The normative field catalog, migration behavior and executable acceptance
matrix are in
`docs/engineering/Account_Sync_Convergence_and_Credential_Boundary.md`.

## Consequences

One vault can safely connect desktop, Android and iOS even when each
installation uses a different Google client registration. A converged vault
has a fixed point: later unchanged cycles may check and download the remote
profile but perform no new profile or secret upload.

Older v0.6.0 publishers may temporarily reintroduce legacy fields. Current
clients ignore and quarantine those fields, keep local authentication intact
and warn that an older client remains active. Destructive remote cleanup is
available only after all devices are confirmed upgraded and a verified
encrypted recovery copy exists.

The logical-id map and repair journals add local metadata, but they avoid using
physical ids as cross-device identity and make interrupted migrations
recoverable.

## Alternatives

- Sharing one OAuth client/token unit through the vault was rejected because
  platform registrations differ and token rotation or replacement on one
  device can invalidate another.
- Splitting the whole profile into desktop-only and mobile-only account
  documents was rejected because the account is shared even though its
  authentication is local; it would duplicate metadata and make service
  references diverge.
- Matching OAuth accounts by label or email alone was rejected because labels
  are mutable and ambiguous.
- Treating the entire secret bundle as one transaction was rejected because one
  legacy or conflicting entry must not block an independent app password.

## Links

- Supplements ADR 0013 for the settings/secrets account boundary.
- `docs/engineering/Settings_Sync_Encryption_Protocol.md`
- `docs/engineering/Account_Sync_Convergence_and_Credential_Boundary.md`
