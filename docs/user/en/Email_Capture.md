# Email capture

Last reviewed: 2026-07-19

Plainva can read your mailbox to get knowledge out of email and into your vault. The focus stays on **capturing** messages as notes; mailboxes connected over **IMAP** are only ever read (nothing in the mailbox changes, not even the unread markers).

## Connecting a mailbox

**Settings → your vault → Calendar & accounts → Email → Add account…** Under **Connection type** you choose:

- **Microsoft (sign in)** — for Outlook.com and Microsoft 365: you sign in directly in the browser, with no app password and no IMAP. Plainva uses the central Plainva app registration (you can optionally supply your own app ID). Reading, capturing and **sending directly** all go through the Microsoft sign-in.
- **IMAP (app password)** — for every other provider: host, port and an **app password**. For Gmail that is `imap.gmail.com`, port `993`, with an app password from [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (requires 2-factor authentication) — no OAuth, no verification. Ready-made presets are available for **web.de** and **GMX**. Add an SMTP host to send directly.

Connecting validates the login before anything is saved; the credentials go into your operating system's keychain. The **Mail folder** setting chooses where captured emails are stored (default `Mail`).

## Reading mail

Open the mail tab from the left action rail (mail icon) or the command palette (**Open email**). The list shows your inbox newest-first (unread in bold, **Load more** pages further). Selecting a message opens it in a **sandboxed viewer**:

- **Remote content is blocked** — tracking pixels, remote images and style loaders are removed and counted ("Remote content blocked (n)"). Only self-contained inline images display. **Show images** next to the counter reveals a message's https images once; **Always load remote images** in the mail settings turns that into a standing opt-in. Be aware: loading remote images lets the sender see your IP address and when you opened the mail — that is why blocked is the default.
- Links are shown as plain text and are not clickable inside the viewer.
- Scripts and forms never run. The message is rendered in an isolated frame with a strict content policy.

Attachments are listed with name and size; the original `.eml` (below) carries them in full.

## Getting a message into the vault

Three buttons on every message:

- **Save as note** — creates a note in your mail folder (`YYYY-MM-DD Subject.md`) with the sender and date in the frontmatter and the plain-text body below the subject heading. Capturing the same message twice opens the existing note instead of duplicating it.
- **+ .eml** — additionally stores the raw original next to the note and links it. The `.eml` contains everything, including attachments, and opens in any mail program.
- **→ Task** — creates an entry in your [standard task database](Tasks.md) with the subject as the title, today's date as the due date and the open status pre-filled.

## Getting content out — without sending

Plainva never speaks SMTP. Instead:

- **Reply as note** (on a message): creates a note addressed at the sender (`to:` in the frontmatter) with the original quoted — write your reply in Plainva.
- **Save note as email draft in the mailbox** (command palette, on any open note): stores the note as a **draft in your own mailbox** via IMAP — pick the account, recipient and drafts folder, then open your regular mail program, review and send from there. Formatting is preserved.
- **Send note via email (mailto)** (command palette): opens your default mail program with the note as plain text (long notes are shortened).
- **Copy note as email text** (command palette): puts the note on the clipboard with formatting — paste it into any composer.
