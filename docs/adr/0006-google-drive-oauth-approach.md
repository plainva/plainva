# ADR 0006: Google Drive OAuth Approach (Loopback vs. Deep Link)

Status: Accepted

Date: 2026-06-25

> Verification note: The native part of this decision (short-lived
> loopback HTTP listener or deep-link registration in Rust/Tauri) was
> **not** compiled or run in the AI harness (no Cargo, app never started
> natively). The decision fixes the approach and the interface contracts;
> the working auth prototype and its native verification remain a
> maintainer task. The ADR can be revised after the first native run.

## Context

Phase 5.1 Group A introduces Google Drive as the second cloud adapter, with
**BYO credentials** (the user sets up their own Google Cloud project + OAuth
client). Google requires OAuth2 for access. Plainva is a Tauri v2 desktop app;
there is no server-side backend that could receive a classic web redirect.
This raises the core question of **how the authorization code gets from the
system browser back into the app**. Two established mechanisms for
installed apps:

1. **Loopback redirect** (`http://127.0.0.1:<ephemeral port>`): the app starts a
   short-lived local HTTP listener, opens the system browser to Google's
   auth endpoint with `redirect_uri=http://127.0.0.1:<port>`, catches the redirect
   with the `code` on the loopback, and then shuts the listener down.
2. **Custom scheme deep link** (`plainva://oauth2callback`): a URI scheme
   registered via `tauri-plugin-deep-link`; the OS routes the redirect to
   the running app instance.

The following also applies regardless of the mechanism:

- **PKCE** (RFC 7636) is mandatory for installed apps: generate `code_verifier`
  (43-128 characters) in the app, send `code_challenge = base64url(SHA-256(code_verifier))`
  with `code_challenge_method=S256` to the auth endpoint, and include the
  `code_verifier` when exchanging the token.
- **Client type**: BYO users create an OAuth client of type **"Desktop app"**.
  Google issues a `client_id` and a `client_secret` for it; for installed
  apps, the secret is explicitly **not considered confidential** (PKCE carries
  the security). Google's token endpoint nevertheless expects `client_id`
  **and** `client_secret` together with the `code_verifier` for desktop clients.

## Decision

1. **Loopback redirect is the primary approach.** Rationale:
   - Google officially supports the loopback flow for the "Desktop app" client type.
   - It requires **no** OS-wide scheme registration. Custom scheme registration
     is installer- and platform-dependent (fragile on Windows/Linux without a
     real installer, and additionally tricky in `tauri dev` mode) and needs
     single-instance routing so the deep link reaches the existing instance.
   - Dev and prod behavior are identical (always `http://127.0.0.1:<port>`),
     which simplifies native verification by the maintainer.
   - The only native building block is a **short-lived** local HTTP listener
     on an ephemeral port that closes after exactly one redirect (a small,
     well-bounded native surface).
2. **Custom scheme deep link remains a documented fallback.** If the native
   loopback variant fails on a target platform (e.g. a local firewall blocks
   `127.0.0.1` listeners), `tauri-plugin-deep-link` with `plainva://oauth2callback`
   is the fallback solution. The TS-side flow orchestration (auth URL
   construction, PKCE, token exchange) is identical for both variants; only
   the code reception differs.
3. **Scope: `https://www.googleapis.com/auth/drive` (full access).** *Revised
   2026-06-25 after maintainer testing:* the originally chosen non-sensitive
   scope `drive.file` only gives the app access to files it **created itself**
   — files placed in the sync folder externally or manually (Drive web UI,
   other devices/apps) remain invisible and never sync. For a genuine folder
   sync tool that is too narrow; the full `drive` scope is therefore used.
   Consequences:
   - `drive` is a **restricted scope**: a centralized (non-BYO) Plainva app
     would require Google verification **plus** an annual independent
     security assessment (CASA). *Revised 2026-07-04 (maintainer):* no
     longer a go-public gate — the launch runs with BYO (every user uses
     their own Google Cloud project in Testing status); verification + CASA
     will follow once the project is financially well established.
   - In **Testing** publishing status (BYO: every user uses their own
     project and registers themselves as a test user, <=100), the scope
     works **without** verification; however, refresh tokens there expire
     after **7 days** (periodic re-authentication).
   - Trade-off deliberately accepted: full feature scope now vs.
     verification/CASA effort or token expiry. `drive.file` remains
     documented as a fallback option.
4. **Token lifecycle.** The code exchange returns `access_token` (short-lived)
   and `refresh_token`. `DriveSyncTarget` renews the `access_token` as needed
   via the token endpoint using the `refresh_token`. **Token storage**
   follows ADR 0005: until the keychain integration (A6), in the app-data
   `tauri-plugin-store` (outside the vault), afterwards in the OS keychain.
5. **Interface contracts defined** (details in `docs/engineering/Drive_Spike.md`):
   - **A2 (`ISyncTarget` extension):** `pull(cursor?: string)`; `PullResult`
     gets optional fields `nextCursor?: string` and `deleted?: string[]`.
     WebDAV ignores `cursor` and does not set the new fields (adapter
     default, behavior unchanged).
   - **A3 (path<->ID mapping):** `remote_id` (already in the `sync_state`
     schema) is populated/queried by path; plus an in-memory ID cache for
     Drive folder-tree resolution.
   - **A4 (`DriveSyncTarget`):** implements `ISyncTarget` against the Drive
     API (`files.create/update/get`, `changes.list` with `startPageToken`),
     injectable `fetchFn` for unit tests with fake responses.

## Consequences

- **Implementable now (verifiable in the harness):** A2/A3 (pure
  `@plainva/core`, unit-testable), A4 as TS logic against a fake `fetchFn`,
  A5 (BYO credential UI).
- **Maintainer-verified (native):** the loopback listener (Rust/Tauri
  command), the real end-to-end OAuth run against Google, and the keychain
  integration (A6).
- **Model remains additive:** the ETag/path path (WebDAV, ADR 0004) remains
  unchanged as the audit-free priority path; the cursor-based path is an
  **optional** addition for Drive, not a replacement.
- **Worker integration of the cursor path** (persistent `startPageToken`,
  incremental `deleted` processing instead of a full-listing diff) is part
  of the Drive worker integration and is delivered with A4, not in A2.

## Alternatives

- **Out-of-band (OOB, `urn:ietf:wg:oauth:2.0:oob`)**: deprecated/discontinued
  by Google — rejected.
- **Custom scheme as the primary path**: rejected due to installer/platform
  dependency and single-instance routing complexity; remains as a fallback
  (item 2).
- **Shared/embedded OAuth client (no BYO)**: rejected — would require a
  project operated and Google-verified by Plainva plus secret management,
  and contradicts the BYO decision (ADR 0004).

## Links

- MVP_Desktop_Plan (Phase 5.1 Group A, A1-A6; internal planning document, maintainer workspace)
- docs/engineering/Drive_Spike.md (breakdown + interface contracts)
- ADR 0004 (BYO Credentials & WebDAV Prioritization)
- ADR 0005 (Credential Storage & OS Keystore; Token Storage, A6)
