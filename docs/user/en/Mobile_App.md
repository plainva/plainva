# The mobile app

Last updated: 2026-07-26

Plainva is also available as an app for Android and iOS. It works on the same Markdown files, the same **OKF** format and the same sync engine as the desktop app — your vault stays identical in both worlds.

## Layout

- **Bottom bar:** **three to five** areas of your choice — there is no fixed **More** tab any more; the space belongs to your areas.
- **Every area** (Notes, Today, Tags, Bookmarks, Calendar, Databases, Graph) stays one tap away through the **areas sheet**: either the **▾ next to the title** in the top bar or a **long press on the bottom bar**. The sheet marks the current area and leads straight to **Arrange the navigation bar…** at the bottom.
- **Configuring the bar:** **Settings** → **Navigation bar**. Use **−**/**+** to set how many areas the bar shows (3–5, with a live preview) and the **drag handle** to arrange the list: the top entries form the bar (marked by a frame), dragging one up promotes it. Dragging to the top or bottom edge scrolls the list along, so one movement covers the whole list. The preview shows exactly the labels the bar itself uses. Nothing is ever hidden — whatever is not in the bar remains reachable through the areas sheet. If the area you are on leaves the bar, the app moves to the first visible one.
- **＋** floats as a round button above the bar and opens quick create: note, daily note, folder, database, "From template…".
- **Top bar:** the title with **▾** (opens the areas sheet), search and the **Settings** (⋮); the home screen additionally shows "Recently opened" and your bookmarks.
- **Settings:** the ⋮ button opens the area list first (like the left side of the desktop settings) — a tap opens that page. **Active vault** on top leads to the vault management: switch vaults (check mark = active), **Create a vault** and **Connect to cloud**.

## Reading and editing notes

Notes open **rendered and read-only**; the pen at the top right switches to editing (with a toolbar above the keyboard: formatting, lists, wiki link, slash commands, insert photo). `![[Note]]` embeds appear as tappable preview cards.

The **Note details** button in the header (between the bookmark and the ⋮ menu) opens the note's context sheet: properties (directly editable), backlinks, outline, graph and the **version history** — every edit automatically creates snapshots you can inspect, compare and restore. The Markdown source and in-note search live in the ⋮ menu.

## Databases (`.base`)

`.base` databases work like on the desktop: every view (table, list, gallery, board, calendar, timeline), typed cell editing, board cards move via press-and-hold. **Configure** manages views, columns, filters (including groups), sorting and properties. Relation schemas (targets, cardinality) are still maintained on the desktop.

A **Pinboard** view shows the notes as a two-column board of sticky cards: tap opens the note, long-press shows the actions (pin, labels, color, delete), dragging after a long press reorders, and checkboxes tick right on the card. The input field on top captures a new note. Tip: point the database at your inbox folder (**Settings** → **Content & structure**) and the ＋ quick notes as well as texts shared from other apps land straight on the board.

## Calendar and events

The **Calendar** (bottom tab or via "More") shows your daily notes as a month grid. The clock icon in the top right opens the **event calendar** with **Day**, **3-day** and **Agenda** views — your connected calendars use the same account model as the desktop. Tapping an event shows its details; for an invitation you can **accept**, mark it **tentative**, or **decline** right there.

Manage accounts from the gear icon in the event calendar: connect **CalDAV** on the device with an app password (e.g. Fastmail, Nextcloud, iCloud); Google and Microsoft follow via browser sign-in. Per account you can show or hide individual calendars.

**Signing in is per device.** What syncs are your account *settings*, never the sign-in itself — deliberately so: credentials should not leave the device. An account that arrived through settings sync therefore shows up in the list but carries a **sign in** marker, with a line underneath telling you what to do. As long as no account is signed in on this device, the calendar explains that in place instead of simply staying empty, and **Sign in on this device** takes you to the accounts. Signed-in accounts show **active**.

## Email

Under **Settings → Email** you connect a **Microsoft mailbox** (Outlook.com, Microsoft 365) directly through the browser sign-in — no app password needed. As with the calendar, signing in happens per device.

After that you can open **Email** as its own area from the ▾ next to the title and place it in the navigation bar. The line under the title shows folder, unread count and account, and opens the folder picker. Tap a message to read it; **Save as note** files it in the **Mail** folder of your vault (capturing twice opens the same note). Remote images stay blocked until you allow them for that message — a loaded image tells the sender when and where you read.

**IMAP mailboxes work on the phone too.** Add one under **Settings → Email**: pick the provider, enter the address and the app password, and Plainva fills in the servers. If your provider is not in the list, **Advanced** lets you type the IMAP and SMTP host, port and a different user name yourself, and an existing account can be edited later. Selecting several messages works by pressing and holding one of them.

## Sync

In the **Settings** (⋮), **Active vault** leads to the vault management; there you connect cloud storage (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Connect to cloud** brings an existing cloud vault onto the device; **Create a vault** first asks **On this device** or **With an online service** and then for the starter structure (empty or a template like PARA) — on the online path the connection follows, the target folder in the cloud can be created fresh via **New folder** in the picker sheet, and the structure is uploaded by the first sync. The first launch ("Connect to cloud") offers the same choice between an existing and a new cloud vault. Every connection gets its own, separate vault on the device. The vault page shows status, progress, pending transfers and offers **Export vault** (ZIP through the share sheet).

How often this vault checks the remote for changes is set on the same page (**sync interval**, at least 5 seconds) — local saves are uploaded immediately regardless. For Google Drive, OneDrive, Dropbox and S3 the **cloud folder** can also be changed later; with WebDAV the folder is part of the server address, so you reconnect instead. If settings sync is encrypted you can additionally turn on **Ask for the passphrase on every start**: the key is then never stored on the device. And **Security & Sharing** now states plainly that encrypted workspaces are experimental and have not been independently reviewed — keep your recovery file and code somewhere safe.

The vault page also states whether your **settings** travel with you — as a card with a clear state rather than a bare button:

- **Not being synced**: settings sync is off for this vault. Turn it on from the desktop.
- **Not encrypted yet**: this vault has no sync passphrase. You can set one **on the phone** now: the wizard shows the recovery code and has you type two randomly chosen groups of it back before anything is written at all. If a passphrase already exists in the cloud, the phone says so and never creates a second one — that would lock every other device out.
- **Not unlocked on this device yet**: your settings are stored encrypted in the cloud. Enter the passphrase chosen when this was set up — on the desktop or here on the phone; this device unlocks them once with it.
- **Being synced**: this device is unlocked; folders, views and backup rules stay in step with your other devices.

Each card also names what does *not* travel: sign-ins always stay on the device (see [Calendar and events](#calendar-and-events)).

**Settings** → **Security & Sharing** names what the connection actually is — and for a plain cloud vault it sets up the encrypted workspace right on the phone (identity → recovery file and code → activation). Without a cloud connection there is nothing to encrypt, and the area says so.

## Safety net

Snapshots (version history), a draft journal (after a crash the note offers your last unsaved state) and conflict copies with a comparison view protect your data. Retention is configured under **Settings** → **Backup & version history**.

## Sharing and shortcuts

On Android and iOS, shared text and URLs become a new note in the inbox folder; shared images and files are imported as attachments (up to 25 MB per file). On Android, press and hold the app icon for the additional **New note** and **Today** shortcuts. The vault page lets you enable **Sync settings** and securely unlock or lock an encrypted vault with its passphrase.

## Folders, photos, and calendar

The floating **Plus** button remains available inside nested folders, and every quick-create action targets the folder currently open. The folder header uses the **three-dot menu** for Settings; folder creation lives in the **Plus** sheet.

The editor photo button now offers **Take photo** or **Choose from library**, preserves the insertion position, and reports permission or file errors visibly.

**Calendar** now opens the connected provider calendar directly. Daily notes remain in their own **Today** view; the former local month intermediary was removed without changing existing notes or calendar data.
