# Security Policy

Plainva is a local-first Markdown vault editor. This document describes the ACTUAL security posture of the app and how to report vulnerabilities. Last reviewed: 2026-07-05.

## Supported Versions

Only the latest released version and the `main` branch receive security fixes. Pre-1.0 releases are beta-quality software — keep backups of important vaults (Plainva additionally snapshots every write under `.plainva/backups/` and creates daily ZIP backups by default).

## Reporting a Vulnerability

Please report security issues PRIVATELY:

- Preferred: GitHub **Security Advisories** ("Report a vulnerability" on the repository's Security tab).
- Alternatively: email the maintainer (address on the GitHub profile of the repository owner).

Do not put secrets, API keys, OAuth credentials, private vault contents, private file paths, screenshots of private notes, or exploit details into public issues, pull requests, logs, discussions or chat transcripts. You will receive an initial response within 7 days; confirmed issues are fixed with priority and credited on request.

## Security Model (current, accurate)

- **Local-first**: the app writes directly into the vault folder you select. There is no server component; sync targets are storage providers you configure yourself.
- **Content Security Policy**: a restrictive CSP is set (`default-src 'self'`; `connect-src` allows `https:` because sync endpoints — WebDAV servers, S3 hosts — are user-chosen; `style-src 'unsafe-inline'` is required by the UI framework).
- **Broad filesystem permissions — a deliberate decision (ADR 0007)**: the Tauri FS/opener capabilities are scoped to `**`. Plainva is a local desktop app operating on user-chosen folders anywhere on disk (like an editor or IDE), not a sandboxed viewer. The trade-off: a compromise of the WebView (e.g. a malicious dependency) would have filesystem-wide reach. Mitigations: the CSP above, a path-traversal guard on every vault-relative path, read-mode embed targets are validated against the vault root, note-supplied HTML is never rendered as HTML, and search/table/snippet renderers build DOM without `innerHTML`.
- **Secrets**: sync credentials and OAuth tokens are stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service; ADR 0005). **Fallback caveat**: on systems without a working keychain service, credentials fall back to an UNENCRYPTED store file in the app data directory — the settings' diagnostics section shows which backend is active.
- **OAuth**: all providers use PKCE (S256) with a `state` check; the loopback listener binds to `127.0.0.1` only.
- **Updates**: release artifacts will be signed from the first public release on; the auto-updater verifies signatures against the public key embedded in the app and refuses unsigned or mismatched artifacts. (Until the first release ships, no update feed exists and the in-app check reports exactly that.)
- **No telemetry**: the app sends no usage data. Network connections are limited to the sync provider you configure and the update check against GitHub Releases (can be disabled in the settings).

## Out of Scope

- Vault content is stored in plain Markdown on your disk and on your chosen sync storage. End-to-end encryption of vault contents is a roadmap item (v1.0+), not a current feature — choose your sync provider accordingly.
- `.plainva/backups/` snapshots are plain text by design (recoverability over secrecy); protect the vault folder with OS-level disk encryption if needed.

## Secrets in the Repository

Plainva must not store credentials, tokens or user secrets in the repository, project docs, issue templates, build logs or generated reports. CI runs a secret scanner on every push.
