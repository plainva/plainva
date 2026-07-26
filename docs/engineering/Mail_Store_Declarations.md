# Store declarations for the mobile mail client

Last reviewed: 2026-07-26 · Status: **prepared, not yet filed** (mail is not shipped publicly yet)

Shipping mail on mobile changes what data the app touches, so both stores need their privacy
declarations updated **before the first public release that contains mail**. Internal test builds
(Play internal testing, TestFlight) are not affected — G1 through G4 can be tested internally with
the current declarations.

This file is the checklist: it holds the exact answers, so filing them is a matter of ticking boxes
rather than re-deriving the reasoning under release pressure.

## What does NOT change

- **No new OS permission.** Android already declares `INTERNET`; iOS needs no entitlement for
  outbound TCP/TLS.
- **`ITSAppUsesNonExemptEncryption` stays `false`.** Mail uses standard TLS/STARTTLS, which is
  exempt.
- **No new Google verification, no CASA**, as long as Gmail is connected the way the desktop does
  it: **app password over IMAP**. Only OAuth against `https://mail.google.com/` would be a
  restricted scope with annual CASA Tier 2 — deliberately avoided.
- **Microsoft Graph** needs publisher verification only (already the case for the sync app), no
  CASA.

## What DOES change

### 1. iOS — `NSLocalNetworkUsageDescription` (with G2, the native IMAP/SMTP plugin)

Since iOS 14, connecting to another device on the local network requires user consent. Loopback
(Proton Mail Bridge on `127.0.0.1`) is exempt, a self-hosted mail server at `192.168.x.x`
(Mailcow, Synology, a home server) is **not**. Without the key those users hit an unexplainable
failure.

File: `apps/mobile/ios/App/App/Info.plist`

```xml
<key>NSLocalNetworkUsageDescription</key>
<string>Plainva connects to the mail server you configure. If that server runs on your local network, iOS asks for this permission.</string>
```

### 2. Google Play — Data Safety form

Currently the app declares "no data collected". With mail that is no longer true under Google's
definition: **"collected" means the data leaves the device**, regardless of whether the developer
ever sees it. Plainva has no servers, but mail travels between the device and the user's own mail
provider, and captured mail syncs into the user's own cloud vault.

| Field | Answer |
|---|---|
| Data type 1 | **Emails** (category *Messages*) |
| Data type 2 | **Email address**, **Name** (category *Personal info*) — senders/recipients |
| Collected? | **Yes** |
| Shared? | **No** — no third parties, no sale, no advertising, no tracking |
| Purpose | **App functionality** (only) |
| Required or optional? | **Optional** — mail is an account the user adds; the app works without it |
| Encrypted in transit? | **Yes** — TLS/STARTTLS; no cleartext connections except loopback |
| Can the user request deletion? | **Yes** — removing the account deletes credentials and local data |
| Free-text / privacy policy | Plainva runs no servers; the connection is between the device and the mail provider the user chose. |

### 3. Apple — App Privacy labels and `PrivacyInfo.xcprivacy`

`apps/mobile/ios/App/App/PrivacyInfo.xcprivacy` currently declares an **empty**
`NSPrivacyCollectedDataTypes` array. Add:

```xml
<dict>
  <key>NSPrivacyCollectedDataType</key>
  <string>NSPrivacyCollectedDataTypeEmailsOrTextMessages</string>
  <key>NSPrivacyCollectedDataTypeLinked</key><true/>
  <key>NSPrivacyCollectedDataTypeTracking</key><false/>
  <key>NSPrivacyCollectedDataTypePurposes</key>
  <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
</dict>
```

plus `NSPrivacyCollectedDataTypeEmailAddress` with the same three attributes. The matching
App Privacy answers in App Store Connect: *Emails or Text Messages* and *Email Address*, linked to
the user, not used for tracking, purpose App Functionality.

### 4. Release gate

`docs/engineering/Mobile_Release_Gate.md` lists "data-safety form" and "privacy nutrition labels"
as open checkboxes — this document is what ticks them.

## Ordering

1. G1–G4 ship to internal tracks under the current declarations.
2. Before the first public mail release: file sections 1–3, then release.
3. If mail ever gains a background fetch or notifications, revisit — that adds new categories.
