# The mobile app

Last updated: 2026-08-04

Plainva is also available as an app for Android and iOS. It works on the same Markdown files, the same **OKF** format and the same sync engine as the desktop app — your vault stays identical in both worlds.

## Installing the app

The mobile app is in **closed beta**. On **Android** you can join in two steps: use [plainva.com/android-beta](https://plainva.com/android-beta) to join the tester group, then opt in on Google Play. On **iPhone**, distribution runs through TestFlight; the waiting list is at [plainva.com](https://plainva.com).

Google only releases the app to the public Play Store once 12 testers stay in for 14 consecutive days — so joining and simply leaving it installed already helps.

## Layout

- **Bottom bar:** **two to four** work surfaces of your choice plus the fixed **Areas** entry at the end — together the three to five destinations a bar should carry. **Notes** always stays visible: it is how you reach your files.
- **Every area** (Notes, Today, Tasks, Calendar, Email, Graph) stays one tap away through the **areas sheet**: **Areas** in the bar, the **▾ next to the title**, or a **long press on the bar**. The sheet marks the current area and leads straight to **Arrange the navigation bar…** at the bottom. Tags, bookmarks and recently opened are no longer areas of their own — they live under **Notes**.
- **Configuring the bar:** **Settings** → **Navigation bar**. Use **−**/**+** to set how many work surfaces the bar shows (2–4, with a live preview) and the **drag handle** to arrange the list: the top entries form the bar (marked by a frame), dragging one up promotes it. Dragging to the top or bottom edge scrolls the list along, so one movement covers the whole list. Nothing is ever hidden — whatever is not in the bar remains reachable through **Areas**. If the area you are on leaves the bar, the app moves to the first visible one. You can arrange the same bar **on the desktop** as well (Settings → Vault → Bars & areas); with settings sync on, the arrangement travels between your devices.
- **＋** floats as a round button above the bar and opens quick create: note, daily note, folder, database, "From template…".
- **The header:** the same everywhere — back on the left (a work surface has none), title and one line of context in the middle, search and ⋮ on the right. It lifts off the content as you scroll, and the navigation bar draws back to its icons; scrolling up opens it again.
- **A ⋮ always means the same thing:** actions on the object that is open. App settings do not live behind it.
- **Settings:** at the very bottom of **Notes**, where the desktop keeps them too. They open the area list first (like the left side of the desktop settings) — a tap opens that page. **Active vault** on top leads to the vault management: switch vaults (check mark = active), **Create a vault** and **Connect to cloud**. The list shows **the same areas as the desktop** — including **Start & behaviour** (show the welcome and the highlights again), **Bars & areas** (the navigation bar) and **Maintenance** (vault statistics, rebuild the index, restore deleted files). Only **Updates** is missing: the app does not update itself, Google Play and TestFlight do that. **Maintenance** also carries the **import from other apps** — on the phone it always writes into a subfolder of the open vault, shows what it would create before it starts, can be stopped while it runs and leaves a report behind.

## Reading and editing notes

Notes open **rendered and read-only**; the pen at the top right switches to editing (with a toolbar above the keyboard: formatting, lists, wiki link, slash commands, insert photo). `![[Note]]` embeds appear as tappable preview cards.

The **Note details** button in the header (between the bookmark and the ⋮ menu) opens the note's context sheet: properties (directly editable), backlinks, outline, graph and the **version history** — every edit automatically creates snapshots you can inspect, compare and restore. The Markdown source and in-note search live in the ⋮ menu.

## Templates

Templates behave exactly as they do on the desktop: the placeholders (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) are filled in when the note is created, **all** of a template's questions arrive together in **one** sheet — cancel it and nothing is created — and `{{cursor}}` places the caret as the note opens.

The **folder → template** and **note type → template** rules are set on the desktop; they travel with the settings sync and apply here as well — so a note in `Projekte/` starts the same way on both devices, including `＋` capture and **+ Entry** in a database. Two details: `{{weekday:…}}` always counts from Monday on the phone (the first-day-of-week setting does not exist there yet), and `{{clipboard}}` asks for the clipboard's content in the same sheet instead of reading it unasked. The full placeholder list is in [Notes and Markdown](Notes_and_Markdown.md).

## Databases (`.base`)

`.base` databases work like on the desktop: every view (table, list, gallery, board, calendar, timeline), typed cell editing, board cards move via press-and-hold. **Configure** manages views, columns, filters (including groups), sorting and properties. Relation schemas (targets, cardinality) are still maintained on the desktop.

A **Pinboard** view shows the notes as a two-column board of sticky cards: tap opens the note, long-press shows the actions (pin, labels, color, delete), dragging after a long press reorders, and checkboxes tick right on the card. The input field on top captures a new note. Tip: point the database at your inbox folder (**Settings** → **Content & structure**) and the ＋ quick notes as well as texts shared from other apps land straight on the board.

## Tasks

The **Tasks** area collects every checkbox in your vault — all `- [ ]` and `- [x]` lines across all notes, grouped by note. It is the line-based overview a database cannot give you, because a database works on whole notes.

Tapping a task opens the note **at that line**; the box checks it off and writes back exactly the one `[ ]`/`[x]` character. Due dates (`📅`) and `#tags` appear as chips so they are not repeated inside the text.

If your vault has a **task database** (**Settings** → **Content & structure**), the area shows it as its own section above: check off, change status, **+ New task** and **Open as database**. Every checkbox row then also carries a button that **moves it into the database** — the line stays as a wiki link, and the task lives on as a note of its own.

Above the list you get the same filters as on the desktop: **Folder**, **Tag**, **With due date only** and **Show hidden**. Hiding is a property of the **note**, not of the single task — the eye icon on a note heading writes `plainva.tasks: false` into that note's frontmatter and takes it out of the overview; **Hide templates** does the same for the whole template folder in one go. The file keeps its tasks, they just stop counting. Long-pressing the move button picks the **target database** when your vault has more than one.

Two more actions on a database task: **Block time** creates a calendar event for the task when a calendar is connected (date, start, duration, plus the calendar picker when several are writable), and **Repeat** creates the next task with a new due date when you check this one off. Both are described under [Tasks](Tasks.md).

## Today

**Today** is the day surface. The strip at the top selects a day — it runs **in both directions**, two weeks back and two weeks ahead, and a dot marks every day that already has a daily note. Below it sits the **daily note** for the selected day (with its template and folder, to open or create), then that day's **appointments and due dates**, and finally what you edited on that day.

The middle section brings together what otherwise lives on two surfaces: all-day events first, then the timed ones in clock order, and last the tasks due that day. Tapping a task opens its note. Without a connected calendar and without a task database the section is simply not there.

## Tags

The tag list lives under **Notes**. Tapping opens a tag's notes; the chevron expands nested tags. **Long-pressing** a tag offers **Rename tag** — vault-wide, as on the desktop: Plainva rewrites every note that carries it (in the frontmatter and as `#tag` in the text, including its `tag/child` children) and then tells you in how many notes it was replaced. A note that cannot be read or written is skipped — the rest are renamed anyway.

## Graph

The **vault map** shows your vault as nodes and edges. Tapping a folder bubble expands it, tapping a note opens it; the chips above filter by note type, tag and edge kind. Drag a node and **the map remembers where you put it** — the remembered arrangement lives in `.plainva/graph.json` and deliberately stays on this device, like the search index.

**Long-pressing** a node opens its menu: open (or expand/collapse for a folder), **Focus on selection** and, if the node is pinned, **Unpin**. Long-pressing an **edge** names both ends and opens either note. Drag one note **onto another** and Plainva offers to **link** them — as a text link at the end of the note, or through a relation of the matching database; a relation that allows exactly one entry asks first, because it replaces the current value. The **Select** chip turns a drag on empty space into a selection rectangle (a phone has no modifier key); selected notes can be deleted together, through the same confirmation a single one gets. **Export as SVG…** hands the map to your device's share sheet.

The same cleaning-up in the small is what the **graph in a note's context sheet** does: it shows the open note's neighbourhood and, below it, suggestions for what else might belong to it. **Link** places the link at the passage in the text — not at the end of the note — and a dismissed suggestion stays dismissed, even after the note is closed.

The **Clean up** chip opens the cleanup list: **orphans** (notes nothing points to), **broken links** (references into nowhere) and **mentions** — places where a note is named but not linked. You delete an orphan through the same confirmation as everywhere else, create the missing note for a broken link, and link a mention exactly **at the passage** rather than at the end of the note. What you dismiss stays dismissed: it does not come back on the next pass. The mention scan reads every note and therefore only starts when you ask it to — and can be stopped at any time.

**Focus** can also be set from the node menu: the map then shows only its neighbourhood down to the depth you pick (1 to 3). The chip carrying the depth clears the focus again. Two more chips read the map by age: **Heatmap** tints every node by how recently it changed, and **Time travel** hides everything newer than the slider — so you can watch the vault grow.

## Calendar and events

The **Calendar** area shows your connected calendars in the **Day**, **3 days** and **Agenda** views — the same account model as on the desktop. You reach it from the navigation bar or through **Areas**. Tapping an event shows its details; for an invitation you can **accept**, accept **tentatively** or **decline** right there. Daily notes do not live here — they live in **Today**.

Manage accounts from the gear icon in the event calendar: connect **CalDAV** on the device with an app password (e.g. Fastmail, Nextcloud, iCloud); Google and Microsoft follow via browser sign-in. Per account you can show or hide individual calendars.

From an event, **Meeting note** creates the note that belongs to it — the same note the desktop finds: it carries an anchor to the event, so calling it again reopens it instead of creating a second one, and it lands in the **meetings folder**. That folder and the **default calendar for events** (the one a new event starts in) are set in the accounts area under **Calendar settings**; both belong to the vault and travel with the settings sync. The same place lets you pick, per account, which **task lists** mirror into your task database.

**Signing in is per device.** What syncs are your account *settings*, never the sign-in itself — deliberately so: credentials should not leave the device. An account that arrived through settings sync therefore shows up in the list but carries a **sign in** marker, with a line underneath telling you what to do. As long as no account is signed in on this device, the calendar explains that in place instead of simply staying empty, and **Sign in on this device** takes you to the accounts. Signed-in accounts show **active**. If a sign-in later expires or is revoked, the row says **sign-in expired** together with the reason — and **Sign in again** gets it going without removing the account: same account, same calendars.

**One login for all services — here too.** If a Microsoft or Google account carries several services (files and calendar, say), the **Cloud accounts** overview offers to merge them into a single sign-in. Afterwards one sign-in keeps every service alive instead of just one — before, a service could keep running while another one of the same account had quietly expired. A Gmail mailbox stays out of it: it runs over IMAP with an app password and needs no consent.

## Email

Under **Settings → Email** you connect a **Microsoft mailbox** (Outlook.com, Microsoft 365) directly through the browser sign-in — no app password needed. As with the calendar, signing in happens per device.

After that you can open **Email** as its own area from the ▾ next to the title and place it in the navigation bar. The line under the title shows folder, unread count and account, and opens the folder picker. Tap a message to read it; **Save as note** files it in the **Mail** folder of your vault (capturing twice opens the same note). Remote images stay blocked until you allow them for that message — a loaded image tells the sender when and where you read.

**IMAP mailboxes work on the phone too.** Add one under **Settings → Email**: pick the provider, enter the address and the app password, and Plainva fills in the servers. If your provider is not in the list, **Advanced** lets you type the IMAP and SMTP host, port and a different user name yourself, and an existing account can be edited later. Selecting several messages works by pressing and holding one of them; after that a tap adds more. In the conversation view, holding or tapping the conversation row picks the whole exchange — and every message in it keeps its own folder, so a reply from **Sent** is marked there.

An open message offers **Reply**, **Reply all** and **Forward**. A reply quotes the original below your text; "Reply all" additionally picks up the other recipients and leaves out your own address. When **composing**, **Attach file** adds a file from the vault — on the phone the vault is the storage you can reach, and everything that arrives on the device (a saved attachment, an inserted photo) already lives there. Each attachment gets its own row with **Remove attachment** for as long as the message has not gone out.

A message you have started does not have to be sent: **Save draft** files it in your account's drafts folder — where every mail program on that mailbox will find it, not in a phone-only place. Which folder that is, the server states; only when it stays silent is the name guessed. In the list, two toggles sit next to the folder line: **Unread** narrows what is currently loaded (so the count and **Load more** stay reachable), while **Flagged** asks the server for every flagged message in the folder — including ones far below the loaded page. In **All inboxes** the flagged toggle is deliberately absent: that query names exactly one mailbox.

From an open message, three routes lead into the vault: **Save as note**, **→ Task** in the ⋮ menu (creates an entry in your default task database — with its template, status and the mail's date) and **+ .eml**, which additionally stores the original message and links to it from the note. All three are anchored: capturing the same mail twice opens what is already there. **Delete** now also lives in the ⋮ menu rather than beside the back arrow; in the list a swipe is enough. Moving to Trash offers **Undo**, because it can be taken back — deleting permanently from Trash still asks, because it cannot. And instead of several notices stacked on top of each other there is now **one** line: the error, else the unreachable accounts (from two on, as a count), else the note about the stored copy.

A note can be sent from its own ⋮ menu: **Send note by email (mailto)** hands it to the phone's mail app — Plainva needs no account of its own for that — while **Send by mail** opens Plainva's own composer with subject and text.

## Sync

The **Settings** (at the bottom of **Notes**) lead through **Active vault** to vault management; that is where you connect cloud storage (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Connect to cloud** brings an existing cloud vault to the device; **Create new vault** first asks **On this device** or **With an online service** and then the starting structure (empty or a template such as PARA) — the online path continues with connecting, the target folder in the cloud can be created fresh via **New folder** in the picker sheet, and the structure is uploaded on the first sync. The first run offers the same choice between an existing and a new cloud vault ("Connect to cloud"). Every connection gets its own, separate vault on the device. The vault page shows status, progress, pending transfers and offers **Export vault** (a ZIP through the share sheet).

The vault page is ordered by what its controls are FOR: a **status card** at the top answers the one question you open this page with — is it running? (state, last run, pending transfers and interval in one line). Below it come named groups — **Connection**, **Contents** — and at the bottom, behind its own edge, the **Danger zone** with **Disconnect sync** and **Delete vault**. Before, up to nine identical buttons sat in one row, with **Restore deleted files** directly beside **Delete vault**.

Under **Contents**, next to **Export vault**, there is now the **automatic vault backup**: one ZIP of the whole vault per day, of which the last **seven** are kept by default (**Retained backups**); **Back up now** creates one immediately. The archives live in the device's documents, not in the cache — something the operating system may empty at any time is not an archive. A phone gets no background alarm: the check runs when you open the app and whenever you return to it, so the backup catches up rather than running at a set hour. The line under the switch therefore says when it last ran — that is how a backup that quietly never happens becomes visible. Until now the phone only had the manual export, so a vault nobody thought to export had no archive at all.

How often this vault checks the remote for changes is set on the same page (**sync interval**, at least 5 seconds) — local saves are uploaded immediately regardless. For Google Drive, OneDrive, Dropbox and S3 the **cloud folder** can also be changed later; with WebDAV the folder is part of the server address, so you reconnect instead. If settings sync is encrypted you can additionally turn on **Ask for the passphrase on every start**: the key is then never stored on the device. And **Security & Sharing** now states plainly that encrypted workspaces are experimental and have not been independently reviewed — keep your recovery file and code somewhere safe.

The vault page also states whether your **settings** travel with you — as a card with a clear state rather than a bare button:

- **Not being synced**: settings sync is off for this vault. Turn it on from the desktop.
- **Not encrypted yet**: this vault has no sync passphrase. You can set one **on the phone** now: the wizard shows the recovery code and has you type two randomly chosen groups of it back before anything is written at all. If a passphrase already exists in the cloud, the phone says so and never creates a second one — that would lock every other device out.
- **Not unlocked on this device yet**: your settings are stored encrypted in the cloud. Enter the passphrase chosen when this was set up — on the desktop or here on the phone; this device unlocks them once with it.
- **Being synced**: this device is unlocked; folders, views and backup rules stay in step with your other devices.

Each card also names what does *not* travel: sign-ins always stay on the device (see [Calendar and events](#calendar-and-events)).

**Settings** → **Security & Sharing** names what the connection actually is — and for a plain cloud vault it sets up the encrypted workspace right on the phone (identity → recovery file and code → activation). Without a cloud connection there is nothing to encrypt, and the area says so.

Both setups — the encrypted workspace and the sync passphrase — now run as **their own flow, without the navigation bar**: while one is open there is exactly one way out, and it asks. That is not decoration. Until the final step your key exists only in memory, and leaving discards it; before, a tap on the bar could do that without a word. The last step shows a progress bar where there is something to count — the workspace re-encrypts every file, while the sync passphrase is two writes, and inventing a percentage for the second would be a lie in the shape of a bar.

**Shares are managed here now**, not only on the desktop: under **People & permissions** you invite a member with a role (**Invite** creates them — you pair their device afterwards), create a group, and change a group's role right in its row. Under **Slices** you create a share for a **Folder**. Deliberately not on the phone: slices built from a free selection or a dynamic rule — both would need surfaces that do not exist here — and rekeying, ownership transfer and decommissioning, which stay on the desktop for now.

## Safety net

Snapshots (version history), a draft journal (after a crash the note offers your last unsaved state) and conflict copies with a comparison view protect your data. Retention is configured under **Settings** → **Backup & version history**.

## Sharing and shortcuts

On Android and iOS, shared text and URLs become a new note in the inbox folder; shared images and files are taken over as attachments (up to 25 MB per file). On Android, long-pressing the app icon additionally offers **New note** and **Today**.

## Folders, photos, and calendar

The floating **Plus** button remains available inside nested folders, and every quick-create action creates in the folder you have open — new folders included. The ⋮ in the header belongs to the open object instead: it shows that object's actions, never the app settings.

The editor photo button offers **Take photo** or **Choose from library**, preserves the insertion point, and reports permission or file errors visibly. Photos land in the vault's attachments folder — the same one your computer uses.

Events and daily notes are deliberately separate: **Calendar** shows the connected calendars (see [Calendar and events](#calendar-and-events)), **Today** shows the daily note of a chosen day. There is no local month view of daily notes — the strip in **Today** does that job.

## Attachments and images

Besides notes and databases the navigator now shows **attachments** — images, PDFs, whatever else lies in the folder. An image opens inside Plainva; everything else is handed to the system, which knows what a PDF is and Plainva does not. **Share** passes a file to any other app.

A note's ⋮ menu carries **Export as Markdown…**: it hands the file itself to the system share sheet, where you find Print, “Save to Files” and every editor you have installed. **Share** above it sends only the note's text.

## Swiping

**Swipe a note row left** in the list to reveal two actions: **Bookmark** and **Delete**. Deleting asks through the same dialog as everywhere else. While you are selecting several rows, swiping is off — a gesture that means exactly one row has no clear meaning next to a selection you are still assembling. The same gesture deletes a message in the mail list.

## On wide screens

The app follows the window width, not the device name:

- **below 600 px** — one surface after another, as on the phone.
- **600 to 839 px** — the navigation bar becomes a **rail at the side**; still one surface.
- **from 840 px** — navigator and working surface stand **side by side**. It is the same navigator as the **Notes** area, just beside your work instead of in front of it.

On a tablet, or a large phone turned sideways, you get the same spatial model as on the desktop — navigate on the left, work in the middle — instead of a blown-up phone.
