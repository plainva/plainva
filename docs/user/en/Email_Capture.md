# Email capture

Last reviewed: 2026-09-04

Plainva can read your mailbox to get knowledge out of email and into your vault, and — since 0.4.0 — compose and send mail too. The focus stays on **capturing** messages as notes; a mailbox connected over **IMAP** is only ever read for capture (nothing in it changes, not even the unread markers) unless you configure sending.

> **Experimental.** The mail client talks to live external accounts (IMAP/SMTP and Microsoft) that can't be exercised in Plainva's automated tests. It works and is used daily, but treat it as a preview: keep a backup, and please report anything that looks off.

## Connecting a mailbox

**Settings → your vault → Cloud accounts → Connect account…** and pick the provider:

- **Microsoft** — for Outlook.com and Microsoft 365: tick **Email** in the services step (on request together with **Files** and **Calendar & tasks** — one account, one sign-in) and sign in directly in the browser, with no app password and no IMAP. Plainva uses the central Plainva app registration (you can optionally supply your own app ID in the account details). Reading, capturing and **sending directly** all go through the Microsoft sign-in.
- **Apple iCloud**, **Yahoo**, **AOL**, **Zoho**, **Fastmail**, **mailbox.org**, **Yandex**, **Mail.ru** — dedicated tiles: email address plus an **app password**, the servers are already filled in (most of these tiles also let you tick **Calendar & tasks** in the same step — one app password for every chosen service). The assistant links each provider's official guide for creating the app password.
- **Email server (IMAP)** — for every other provider: host, port and a password or **app password**. Ready-made presets cover providers from all over the world — from **web.de**/**GMX** and **T-Online** through **Orange**, **Libero**, **WP**, **Seznam** and **Comcast** to **QQ Mail**, **NetEase**, **Naver** and **Yahoo! JAPAN**; the **Provider** select has a search line for them, and typing your address picks the matching preset automatically. Where a provider has quirks, the assistant says so right below the form: some require an **app password** or an **authorization code** instead of the account password, others need IMAP enabled in the provider's settings first — each with a link to the official guide. For Gmail that is `imap.gmail.com`, port `993`, with an app password from [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (requires 2-factor authentication) — no OAuth, no verification; the assistant points this out itself for Gmail addresses. **Outlook.com mailboxes** can no longer connect via password IMAP (Microsoft turned that path off) — the preset points to the **Microsoft** tile. **Proton Mail** works only through the locally running, paid Proton Mail Bridge (its own preset). Add an SMTP host to send directly.

Connecting validates the login before anything is saved; the credentials go into your operating system's keychain. The connected mailboxes and the capture settings then live in the **Email** area: the **Mail folder** setting chooses where captured emails are stored (default `Mail`).

**Signing in on a second device.** When a mailbox travels with the settings sync, its password does not come along automatically — sign-ins are only transferred if you switch the credentials sync on yourself. Such a mailbox shows a **Sign in on this device** button in the **Email** area: type the password, and Plainva checks it with the provider before storing it in the keychain. For a Microsoft mailbox the same button leads to **Cloud accounts**, because that is where the browser sign-in happens. When this leaves the message list empty, the same notice and the same button appear there as well — you do not have to go looking for the settings yourself.

## Reading mail

Open the mail tab from the left action rail (mail icon) or the command palette (**Open email**). The list shows your inbox newest-first (unread in bold, **Load more** pages further). Selecting a message opens it in a **sandboxed viewer**:

- **Remote content is blocked** — tracking pixels, remote images and style loaders are removed and counted ("Remote content blocked (n)"). Only self-contained inline images display. **Show images** next to the counter reveals a message's https images once; **Always load remote images** in the mail settings turns that into a standing opt-in. Be aware: loading remote images lets the sender see your IP address and when you opened the mail — that is why blocked is the default.
- **Read means read** — a message you open counts as read after three seconds. If you mark it **unread by hand** while it is open, it stays unread for as long as it is open; the countdown only starts again once you leave it and open it again. The same on both devices — before, the desktop timer took the marking back three seconds later, and the phone marked a message read the instant it opened.
- Links are shown as plain text and are not clickable inside the viewer.
- Scripts and forms never run. The message is rendered in an isolated frame with a strict content policy.
- **Wide messages are fitted** — many newsletters are built for a fixed column width and cannot be reflowed. Rather than cutting such a message off at the left edge, Plainva scales it down to the width of the frame; on the phone the frame grows with it, so you scroll the page as usual.
- **Conversations** — the switch above the list (speech-bubble icon) folds related messages into one row: participants, count and the subject the exchange started with. A tap unfolds it; every message keeps its folder and names it when that is not the open one. Plainva reads **Sent** along for this, so your own replies are part of the conversation. Switched off, everything stays as it was — a flat list — and the switch is remembered per vault, on both devices. Grouping follows the messages' own reply chain (on Microsoft, the conversation the provider itself keeps); only when a reply fails to carry that chain does the subject help out, and then only for a recognisable reply (“Re:”, “Fwd:”) within 30 days, so two mails that merely share a subject do not merge.
- **All inboxes** — the first entry above the folder list shows the inboxes of **every** account in one list, newest first, and each row names the account it belongs to. Read/unread and flagging work here too; moving and deleting stay with the individual mailbox, because every account has its own target folder — open the message and you act in its mailbox. An account whose sign-in is missing is named, and does not empty the list of the others.
- **Selecting several** — Ctrl-click (macOS: ⌘-click) picks individual messages, Shift-click a range; in the conversation view a Ctrl-click on the conversation picks the whole exchange, and every message in it keeps its own folder.
- **Keyboard through the list** — Arrow up/down selects the previous/next message and shows it in the reader, Shift+arrow extends the selection, Home/End jump to the first/last message, arrow left/right collapses/expands a conversation, Enter opens the message in the reader, Delete moves it to the trash (with the same confirmation as the button). All of them are listed in the shortcuts window (F1) under **Email**.

Attachments are listed with name and size; the original `.eml` (below) carries them in full.

When you open a folder you have opened before, the list appears **immediately** from the local cache while the refresh runs in the background; a hint says “updating” until it lands — only what the server sent counts as confirmed. The same goes for a message you have already read. On the phone the **newest** message in a folder is preloaded in the background — it then opens with no wait, even if you had never opened it before.

On the desktop the three columns (folders · list · reader) can be dragged at their dividers; the widths are remembered **per vault** and survive a restart. Every column keeps a minimum width, so the reader can never be squeezed away.

When a refresh fails — no network, or the provider is throttling — the list keeps showing the last copy from this device, with a note saying so, instead of an empty pane. A message you have already read stays readable the same way. This is only ever a cache: the server always wins, nothing here is the only copy of anything, and removing the vault removes it too.

## Getting a message into the vault

Three buttons on every message:

- **Save as note** — creates a note in your mail folder (`YYYY-MM-DD Subject.md`) with the sender and date in the frontmatter and the plain-text body below the subject heading. Capturing the same message twice opens the existing note instead of duplicating it.
- **+ .eml** — additionally stores the raw original next to the note and links it. The `.eml` contains everything, including attachments, and opens in any mail program. If the note already exists, the raw copy is added to it — unless one is already linked.
- **→ Task** — creates an entry in your [standard task database](Tasks.md) with the subject as the title, today's date as the due date and the open status pre-filled.

## Composing and sending

Once an account can send — a **Microsoft** account, or an **IMAP** account with an **SMTP host** configured — you can write and send mail from Plainva:

- **Compose** (in the mail tab) opens a floating window with labelled **From / To / Cc / Bcc** rows. Type an address and press Enter or comma to turn it into a chip; **Cc/Bcc** reveal on demand. The body is a Markdown editor with a formatting toolbar and a "/" command menu. A link `[text](https://…)` renders as a finished link while you write — the markdown characters come back when the caret moves into it, and a click opens the target in your browser. On send the body is converted to HTML anyway: the recipient always receives a real link, whatever it looked like in the window.
- **Insert template…** puts a note template into the body. The template's questions (`{{prompt:…}}`) are asked **once, in one dialog**, rather than travelling along as placeholders; its frontmatter stays out — a mail body has none, and the recipient would otherwise receive YAML. Cancel the dialog and nothing is inserted.
- **Reply**, **reply-all** and **forward** on any message open the same window with the original quoted and the recipients pre-filled; a forward carries the attachments along.
- **Send** goes out over SMTP (IMAP accounts) or Microsoft Graph (Microsoft accounts).
- **Email this note** (a note's `⋮` menu, or the command palette) starts a message with the current note attached, or inlined as text.

## Email in its own window

Right-click **Email** in the ribbon to open the mailbox in a window of its own; **Open communications window** in the command palette puts mail and calendar side by side.

While composing, the pop-out icon lifts the composer into its own window — recipients, subject, body and attachments travel with it, including an address you have just typed and not yet confirmed. **Sending still happens in the main window**: the composer hands the message over and closes, and the notice with **Undo** appears where you keep working. That way closing a window never decides between sending and losing.

A composer window is **not** restored on the next start — what it holds lives in memory. So finish a longer message, or save it as a draft.

## Handing a note off without the mail client

You don't have to send from within Plainva. These work on any note and need no SMTP; the note's YAML frontmatter is never included in the message — only its text:

- **Reply as note** (on a message): creates a note addressed at the sender (`to:` in the frontmatter) with the original quoted — write your reply in Plainva. When you later send that note (or save it as a draft), the `to:` address is filled into the **To** field automatically.
- **Save note as email draft in the mailbox** (command palette, on any open note): stores the note as a **draft in your own mailbox** via IMAP — pick the account, recipient and drafts folder, then open your regular mail program, review and send from there. Formatting is preserved.
- **Send note via email (mailto)** (command palette): opens your default mail program with the note as plain text (long notes are shortened).
- **Copy note as email text** (command palette): puts the note on the clipboard with formatting — paste it into any composer.

## Signature and sender addresses

Under **Settings → E-Mail → Sending** each mailbox carries two settings of its own:

- **Signature** — Markdown, added below what you write when composing (and above a quoted or forwarded original, where a reader expects it). Switching sender in the compose window swaps the signature instead of stacking a second one. The field is the same editor as the compose window, so you see the signature the way it will be sent.
- **Signature per address** — once you have additional sender addresses, a **Signature for** selector appears above the field. “Default (all addresses)” is the account signature; pick an address to write one just for it. Addresses without their own signature keep using the default, and switching sender while composing swaps in the right one — including between two addresses of the same account. Empty an address's field and it falls back to the default.
- **Additional sender addresses** — one per line, e.g. `Name <alias@example.org>`. The compose window's **From** then lists addresses rather than accounts: the mailbox's own first, then its aliases. Whether an address is actually accepted is your provider's decision — a server that refuses to send as an alias says so, and Plainva shows that error rather than silently sending as someone else.

## Mailbox actions

Stars/flags sync through IMAP and Microsoft; **Flagged** shows the server-side selection. Messages can be moved individually or in bulk. Outside Trash, **Delete** always means “move to Trash”; only Trash offers **Delete permanently** after confirmation. With Gmail, moving is a label change, and actions in **All Mail** can affect the message across every label—Plainva warns before the action.

## Unsubscribing and undoing a send

When a message carries a `List-Unsubscribe` header, Plainva shows an **Unsubscribe** button in the reader. What happens next is what the **sender** declared — Plainva guesses nothing from the body and clicks nothing on your behalf: a web address opens in your browser after a confirmation, a mail address lands in the composer so you can see what goes out. Unencrypted `http://` routes are dropped, because unsubscribing over an open line sends your address in the clear.

**Undo send** is a **delay, not a recall**: after you send, Plainva waits a few seconds before handing the message to the server, and during that time a notice keeps an **Undo** button ready. After that it is on its way and cannot be stopped — no mail program can retrieve a delivered message. If you leave Plainva in that moment (on the phone: switch to another app), it **sends immediately** rather than cancelling — a message you asked to send must not disappear because the app went to the background.

## Snoozing

Some mail is not urgent and not done either. **Snooze** takes a message out of the list until a moment you pick — later today, tomorrow morning, this weekend or next week. On the desktop the entry sits in the row's context menu, on the phone it is a swipe action as well. The **Snoozed** button brings them back into view; from there **Bring back now** returns a message to the list immediately.

Two things about it that deserve saying plainly. First, snoozing is **Plainva's own marker**, not a server feature: neither IMAP nor Microsoft has such a thing. The marker travels with the settings sync, so a message snoozed on the phone rests on the desktop too — in another mail program it sits in the inbox as usual. Second, snoozing only hides the **list of the folder** you did it in: search and "All inboxes" still show the message. Snoozed means "not in my way", not "gone".

## Reporting spam

**Spam** moves a message into the account's spam folder and, where the server supports it, marks it with the `$Junk` keyword. Inside the spam folder the same button reads **Not spam** and brings the message back to the inbox. Both are available in the reader, in multi-select, and on the phone as a swipe action on the row.

To be honest about it: **moving alone does not necessarily train the filter.** Some servers learn from it, others merely store the keyword, and others reject it. After the action Plainva tells you what actually happened — “marked as spam and moved” or just “moved”. If your account has no spam folder at all, Plainva offers to create a **Junk** folder rather than pushing mail into an invented folder name.

## Out-of-office notice

An out-of-office notice belongs on the server, not in a program that happens to be open. Plainva therefore offers it **only where it survives the machine being switched off** — for Microsoft accounts and for mailboxes with a Sieve server (mailbox.org, Fastmail, Nextcloud, Mailcow and others). Where a mailbox has neither, there is no switch, just a sentence explaining why.

You will find it under **Settings → Email**, and on the phone in the accounts area: subject, message and a date range. Without a range the notice runs until you switch it off; with one it starts and stops by itself — even if you never open Plainva again.

**Your own filter rules stay untouched.** In a Sieve script Plainva writes only its own section, marked with `# --- BEGIN PLAINVA`, and leaves everything else character for character. If it finds a section there it cannot read safely, it changes **nothing** and tells you.

## Rules

A rule checks sender, recipient or subject and then does something: move, mark as read, flag, report as spam or move to trash. You will find them under **Settings → Email**.

**And here is the part that matters:** rules currently run **only while Plainva is open**, and only over messages Plainva has fetched. On the phone that additionally means: only while the app was in the foreground. So a rule filters nothing while the machine is off — the card says that on the spot instead of implying a server-side filter that is not there yet.

If a rule checks the **message text**, it only takes effect once you open the message: the text is not in the overview. That, too, is stated on the card.

**Storing them with the provider.** Where your mailbox has a Sieve server, **Store with the provider** turns your rules into a server-side filter that also runs while Plainva is closed. Plainva writes only its own marked section and leaves your hand-written rules exactly as they are — the same promise as for the out-of-office notice, because both share that one section.

A rule your server cannot express — a body check on a server without the matching extension, say — stays **local**, and Plainva names it. It is deliberately not uploaded: a script with a requirement the server does not know is rejected **as a whole**, which would take the out-of-office notice down with it.

Gmail rules are still set up in Google's own settings.

**With Microsoft** no extra server is needed: the same button stores your rules as Outlook rules in the mailbox. Plainva replaces only the rules it created itself and leaves your own untouched — and it places them *after* yours, because a hand-written rule was there first. Microsoft compares with “contains” only, so “is exactly”, “begins with”, “ends with”, a rule on Cc recipients and flagging stay local there — and Plainva names them.

**On the phone** you create rules yourself from start to finish: in the mail settings, tap a rule and you get it as **If** and **Then** — every condition and every action is a row, and tapping one asks for field, comparison and value on sheets of their own. That is deliberately not a shrunken form: five controls side by side at phone width is how a rule gets mistyped. The last condition cannot be removed — a rule without one would match every message.

**File as a note** is the action no mail program has: the rule files the message as a note in your vault, with sender, date and text — the same capture as the button in the reader, only automatic. The same mail twice gives you the **same** note, and the message stays in its folder: what is filed is a copy, nothing is moved. A rule with this action always stays **local**, even on a mailbox that could run rules. That is deliberate: storing the rest of the rule with the provider would let the server move the message before there was anything to file.
