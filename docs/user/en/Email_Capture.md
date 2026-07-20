# Email capture

Last reviewed: 2026-07-20

Plainva can read your mailbox to get knowledge out of email and into your vault, and — since 0.4.0 — compose and send mail too. The focus stays on **capturing** messages as notes; a mailbox connected over **IMAP** is only ever read for capture (nothing in it changes, not even the unread markers) unless you configure sending.

> **Experimental.** The mail client talks to live external accounts (IMAP/SMTP and Microsoft) that can't be exercised in Plainva's automated tests. It works and is used daily, but treat it as a preview: keep a backup, and please report anything that looks off.

## Connecting a mailbox

**Settings → your vault → Cloud accounts → Connect account…** and pick the provider:

- **Microsoft** — for Outlook.com and Microsoft 365: tick **Email** in the services step (on request together with **Files** and **Calendar & tasks** — one account, one sign-in) and sign in directly in the browser, with no app password and no IMAP. Plainva uses the central Plainva app registration (you can optionally supply your own app ID in the account details). Reading, capturing and **sending directly** all go through the Microsoft sign-in.
- **Apple iCloud**, **Yahoo**, **AOL**, **Zoho**, **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru** — dedicated tiles: email address plus an **app password**, the servers are already filled in (most of these tiles also let you tick **Calendar & tasks** in the same step — one app password for every chosen service). The assistant links each provider's official guide for creating the app password.
- **Email server (IMAP)** — for every other provider: host, port and a password or **app password**. Ready-made presets cover providers from all over the world — from **web.de**/**GMX** and **T-Online** through **Orange**, **Libero**, **WP**, **Seznam** and **Comcast** to **QQ Mail**, **NetEase**, **Naver** and **Yahoo! JAPAN**; the **Provider** select has a search line for them, and typing your address picks the matching preset automatically. Where a provider has quirks, the assistant says so right below the form: some require an **app password** or an **authorization code** instead of the account password, others need IMAP enabled in the provider's settings first — each with a link to the official guide. For Gmail that is `imap.gmail.com`, port `993`, with an app password from [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (requires 2-factor authentication) — no OAuth, no verification; the assistant points this out itself for Gmail addresses. **Outlook.com mailboxes** can no longer connect via password IMAP (Microsoft turned that path off) — the preset points to the **Microsoft** tile. **Proton Mail** works only through the locally running, paid Proton Mail Bridge (its own preset). Add an SMTP host to send directly.

Connecting validates the login before anything is saved; the credentials go into your operating system's keychain. The connected mailboxes and the capture settings then live in the **Email** area: the **Mail folder** setting chooses where captured emails are stored (default `Mail`).

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

## Composing and sending

Once an account can send — a **Microsoft** account, or an **IMAP** account with an **SMTP host** configured — you can write and send mail from Plainva:

- **Compose** (in the mail tab) opens a floating window with labelled **From / To / Cc / Bcc** rows. Type an address and press Enter or comma to turn it into a chip; **Cc/Bcc** reveal on demand. The body is a Markdown editor with a formatting toolbar and a "/" command menu.
- **Reply**, **reply-all** and **forward** on any message open the same window with the original quoted and the recipients pre-filled; a forward carries the attachments along.
- **Send** goes out over SMTP (IMAP accounts) or Microsoft Graph (Microsoft accounts).
- **Email this note** (a note's `⋮` menu, or the command palette) starts a message with the current note attached, or inlined as text.

## Handing a note off without the mail client

You don't have to send from within Plainva. These work on any note and need no SMTP:

- **Reply as note** (on a message): creates a note addressed at the sender (`to:` in the frontmatter) with the original quoted — write your reply in Plainva.
- **Save note as email draft in the mailbox** (command palette, on any open note): stores the note as a **draft in your own mailbox** via IMAP — pick the account, recipient and drafts folder, then open your regular mail program, review and send from there. Formatting is preserved.
- **Send note via email (mailto)** (command palette): opens your default mail program with the note as plain text (long notes are shortened).
- **Copy note as email text** (command palette): puts the note on the clipboard with formatting — paste it into any composer.
