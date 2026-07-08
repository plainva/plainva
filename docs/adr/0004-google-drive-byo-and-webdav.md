# ADR 0004: Google Drive Sync via BYO Credentials & Prioritization of WebDAV

Status: Accepted

Date: 2026-06-23

## Context

Plainva aims to synchronize directly with users' cloud storage (e.g. Google Drive) as a pure frontend application, so that they can work with mobile editors like Obsidian.
During the "Google Drive risk spike" in Phase 0, we investigated whether the non-critical OAuth scope `https://www.googleapis.com/auth/drive.file` is sufficient when the user selects a folder (their vault) via the Google Picker.
The test result was unambiguous: this scope does grant access to the folder and to files created in it by the app, but **actively hides all files** that were created manually or by other apps (e.g. Obsidian on a phone) in that folder.
To perform a full sync of a vault, the full `https://www.googleapis.com/auth/drive` scope is mandatory.
Using this scope for a generically published app requires a very expensive, external security audit by Google ($15k-$75k).

## Decision

1. **Google Drive via BYO Credentials:** We forgo a global Plainva API key for Google Drive. Instead, we offer Google Drive sync as a "Bring Your Own (BYO) Credentials" feature. Each user creates a project in "Testing" mode in their own Google Cloud Console, which lets them grant themselves the full `drive` scope without requiring an audit. The app will provide a guide and fields for entering the Client ID and the API key.
2. **Prioritization of WebDAV:** Since the Google Cloud Console setup process is a hurdle for average users, WebDAV moves up significantly in priority. WebDAV is implemented from the start as the primary, generic sync adapter, since it offers much simpler access to many common cloud storage providers (Nextcloud, OwnCloud, etc.).

## Consequences

- **Relief:** We avoid the massive financial and bureaucratic risk of a Google security audit.
- **Hurdle (Google Drive):** Onboarding for Google Drive users becomes more technical (Cloud Console setup). Strong UX writing and excellent guides are needed for this.
- **Development focus:** WebDAV support must be built in parallel with, or ahead of, Google Drive from the start, in order to offer a low-barrier sync alternative.

## Links

- Master_Projektplan.md (Phase 0 spike)
- Google_Drive_Spike_Setup (proof-of-concept guide; internal document, maintainer workspace)
