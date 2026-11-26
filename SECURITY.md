# Security Policy

Plainva is a local-first Markdown vault editor for the desktop (Windows, macOS, Linux) and for phones and tablets (Android, iOS/iPadOS). This document describes the ACTUAL security posture of the app and how to report vulnerabilities. Last reviewed: 2026-11-26.

## Supported Versions

Only the latest released version and the `main` branch receive security fixes. Pre-1.0 releases are beta-quality software — keep backups of important vaults (Plainva additionally keeps earlier versions of your notes under `.plainva/backups/` and creates daily ZIP backups outside the vault by default).

## Reporting a Vulnerability

Please report security issues PRIVATELY:

- Preferred: GitHub **Security Advisories** ("Report a vulnerability" on the repository's Security tab).
- Alternatively: email the maintainer (address on the GitHub profile of the repository owner).

Do not put secrets, API keys, OAuth credentials, private vault contents, private file paths, screenshots of private notes, or exploit details into public issues, pull requests, logs, discussions or chat transcripts. You will receive an initial response within 7 days; confirmed issues are fixed with priority and credited on request.

## Security Model (current, accurate)

### Your data

- **Local-first**: on the desktop the app writes directly into the vault folder you select; on a phone or tablet a vault lives in the app's own storage. Notes are plain Markdown files.
- **No project service holds your data**: the Plainva project runs no service that stores, relays or sees your notes, credentials or requests. The app talks directly to the services you set up. What the project publishes is static: the releases and the update manifest on GitHub, and the website.
- **No telemetry**: the app sends no usage data, no analytics and no crash reports. Diagnostics are a file you export yourself.

### Network connections

The app connects only to what you set up or start:

- **Sync storage**: Google Drive, OneDrive, Dropbox, a WebDAV server (for example Nextcloud) or S3-compatible storage.
- **Calendar, task and mail accounts**: CalDAV servers, Google, Microsoft, and IMAP/SMTP servers.
- **Sign-in pages** of Google, Microsoft and Dropbox when you connect such an account. The tokens go from the provider to your device directly, not through a service of the project.
- **GitHub, for the update check** — desktop only; on by default, and it can be switched off in the settings. Phones and tablets are updated by Google Play, TestFlight or the App Store.
- **Hosts of remote images in notes**: a note that shows an image by its web address loads it from there when the note is displayed, and that host then sees your IP address.
- **Remote images in e-mails — only when you say so**: remote content in a mail is removed by default; **Show images** or the standing setting loads its `https` images.
- **AI providers, web pages and MCP servers** — only after you switched the AI on for a device; see "AI assistant" below.
- **`huggingface.co`**, when you download a model package for search by meaning; each file is checked against a pinned size and SHA-256 before it is used.
- **Notion**, during an import you start: `api.notion.com` and the file addresses it hands out for attachments.

Links open in the system browser when you click them; the app fetches no link previews. For self-hosted servers an `http` address or one on a local network is possible; a password goes to such an address from a device only after the address was confirmed on that device.

### Desktop: web view and file system

- **Content Security Policy**: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' blob: https: data:; connect-src 'self' https: ipc:; style-src 'self' 'unsafe-inline'`. `'wasm-unsafe-eval'` runs the WebAssembly modules the app bundles, `img-src https:` is what lets a note show a remote image, and `style-src 'unsafe-inline'` is required by the UI framework. Beside the CSP, the app's native HTTP permission covers every `https://` and `http://` address, because sync, calendar and mail servers are user-chosen.
- **Broad filesystem permissions — a deliberate decision (ADR 0007)**: the file permissions of the main window cover the whole disk (`**`). Plainva is a local desktop app operating on user-chosen folders anywhere on disk (like an editor or IDE), not a sandboxed viewer. Additional note windows can only read; the quick-capture window has no file permission at all. The trade-off: a compromise of the web view (e.g. a malicious dependency) would have filesystem-wide reach. Mitigations: the CSP above; a path-traversal guard on every vault-relative path; a file a note names is resolved inside the vault only — never to an absolute path, above the vault or into the app's own folders; note-supplied HTML is never rendered as HTML; diagrams and formulas are drawn by the bundled Mermaid (strict mode) and KaTeX.
- **E-mail is foreign content**: its HTML is sanitized (DOMPurify), stripped of remote content, and shown in a sandboxed frame that runs no scripts, under a `default-src 'none'` policy of its own.

### Phones and tablets

- The app runs in the system's app sandbox; vaults, settings and the search index live in the app's own storage.
- The mobile web view sets no Content Security Policy of its own at present.
- Android also trusts certificate authorities you installed on the device, so that self-hosted servers with a private CA work. Certificate validity and host name are still checked; the app never offers to accept every certificate.
- Android's system backup and device transfer include a vault that exists only on the device, and the app's settings. Stored credentials are excluded.

### Secrets

- **Desktop**: credentials for sync, calendars and mail, and OAuth tokens, are stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service; ADR 0005). **Fallback caveat**: on systems without a working keychain service, these credentials fall back to an UNENCRYPTED store file in the app data directory — the settings show which backend is active.
- **AI provider keys and the credentials of MCP servers** have no such fallback: they are kept in the keychain only, and the web view can set but never read them — native code puts a key into the request (ADR 0017).
- **Phones and tablets**: secrets are kept only in the system's key store — on Android encrypted with a non-exportable Android Keystore key, on iOS in the Keychain. There is no unencrypted fallback.
- **Carrying sign-ins to your other devices** is optional and needs a sync passphrase: app passwords for CalDAV and IMAP then travel in one encrypted file in the vault (`.plainva/sync/secrets.enc`). OAuth tokens, AI keys and MCP credentials never travel. Without a passphrase, a vault's settings and the list of your accounts travel unencrypted; they contain no passwords.
- **OAuth**: browser sign-ins use PKCE (S256) with a `state` check. On the desktop the loopback listener binds to `127.0.0.1` only; a phone returns through the app's own address scheme, and on Android the build's own Google client signs in through the system's Google sign-in.

### Updates

- **Desktop**: release artifacts are signed with the project's key. The updater verifies every download against the public key embedded in the app, and against the version the signature was made for, before anything is installed: a changed file, a file signed with another key, the signature of another file, or a new version number put on an older release are all refused. Development builds, and installations a package manager updates (Nix), do not update themselves.
- **Phones and tablets**: the app does not update itself; Google Play, TestFlight or the App Store do. An `.apk` from the GitHub releases is installed by hand.

### AI assistant (beta)

Off on every device until you switch it on there. Then:

- A request goes to the provider you chose — Anthropic, OpenAI, Google Gemini, OpenRouter, or an OpenAI-compatible address you confirmed. The first request of a session shows what goes along before anything is sent; privacy rules can keep notes from the cloud, and **Fully local** keeps everything the AI handles on the device.
- The assistant cannot use the internet until you allow it for the vault and for the conversation. A page is only ever read: one request over `https` to a public address, without cookies or credentials.
- Tools of MCP servers are used only for servers you added yourself, after you looked at what they offer.

### Code that runs

- Plainva has no plugin system that runs third-party code.
- **Scripts** (part of the AI features) are JavaScript in a closed box inside the app: a script cannot open a file or reach the network, and calls only the tools you ticked for it. A new or changed script — also one that arrives through sync — does not run until you approve it on that device.
- **External agents** (desktop, experimental) are another maker's program that Plainva starts in a vault's folder when you ask for it. Such a program is NOT fenced in by Plainva: it runs with your rights, reads and sends on its own, and your privacy rules do not reach what it does itself.
- **Connecting AI apps** (desktop): a helper program lets another AI app reach a vault you allowed, over a private channel of this computer. No network port is opened.

### Encrypted workspaces

**Experimental — not yet independently reviewed.** Plainva can keep a vault as ordinary readable files on your devices while storing its cloud copy as encrypted objects (`.pvws/`). Encrypted workspaces ship as a preview: the cryptographic design has not been audited by an independent reviewer, and two-device evidence on real Android and iOS hardware is still being collected. Try it, but keep a backup of anything you cannot lose, and do not rely on it for material you must protect. Details: [Security & Sharing](docs/user/en/Security_and_Sharing.md).

## Out of Scope

- An ordinary vault is stored as plain Markdown on your disk and on your chosen sync storage — choose your sync provider accordingly. Encrypted workspaces are experimental (see above) and no guarantee.
- Plainva never encrypts the files on your device, also not in an encrypted workspace: the vault, the `.plainva/backups/` snapshots and the ZIP backups are readable by design (recoverability over secrecy). Protect the device with OS-level disk encryption if needed.
- What an external agent, an AI provider or an MCP server you connected does with what it receives is outside Plainva's control.

## Secrets in the Repository

Plainva must not store credentials, tokens or user secrets in the repository, project docs, issue templates, build logs or generated reports. CI runs a secret scanner on every push.
