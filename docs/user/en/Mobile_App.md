# The mobile app

Last updated: 2026-09-04

Plainva is also available as an app for Android and iOS. It works on the same Markdown files, the same **OKF** format and the same sync engine as the desktop app — your vault stays identical in both worlds.

## Installing the app

The mobile app runs as an **open test** on Google Play. On **Android** you can join directly: use [plainva.com/android-beta](https://plainva.com/android-beta) to open the test link, tap **Become a tester** and install the app from Google Play — no invitation and no group to join. Plainva is also listed on the Play Store. On **iPhone**, distribution runs through TestFlight; the waiting list is at [plainva.com](https://plainva.com).

**System requirements:** on iPhone and iPad Plainva needs **iOS 16.4** or later — there the engine that draws the app's interface is part of the system, and a newer Safari does not change it. On Android, Android 7 is enough, but **Android System WebView** must be current; if it is too old, Plainva says so at startup and points the way through the Play Store.

It is an early build: keep a backup of your vault, and tell me what breaks.

## Layout

- **Bottom bar:** **two to four** work surfaces of your choice plus the fixed **Areas** entry at the end — together the three to five destinations a bar should carry. **Notes** always stays visible: it is how you reach your files.
- **Every area** (Notes, Today, Tasks, Calendar, Email, Graph, Open comments) stays one tap away through the **areas sheet**: **Areas** in the bar or a **long press on the bar**. The sheet marks the current area and leads straight to **Arrange the navigation bar…** at the bottom. Tags, bookmarks and recently opened are no longer areas of their own — they live under **Notes**.
- **Configuring the bar:** **Settings** → **Navigation bar**. Use **−**/**+** to set how many work surfaces the bar shows (2–4, with a live preview) and the **drag handle** to arrange the list: the top entries form the bar (marked by a frame), dragging one up promotes it. Dragging to the top or bottom edge scrolls the list along, so one movement covers the whole list. Nothing is ever hidden — whatever is not in the bar remains reachable through **Areas**. If the area you are on leaves the bar, the app moves to the first visible one. You can arrange the same bar **on the desktop** as well (Settings → Vault → Bars & areas); with settings sync on, the arrangement travels between your devices.
- **A folder row counts everything below it**, not just the notes lying directly in it — a folder holding nothing but subfolders no longer reads “0 notes” beside a chevron that leads to hundreds.
- **＋** floats as a round button above the bar and opens quick create in two groups: note, "From template…", daily note, folder, database — and below them event and task, which are created in the calendar and the task list. The desktop's **New** menu offers the same entries in the same order.
- **Holding a row opens what that row can do** — a note, a folder, a database, a task all answer the same way, and *Select several* is the first entry in that sheet. Swiping a row left performs its two most frequent actions directly; the sheet and the swipe offer the same things in the same order.
- **The header:** the same everywhere — back on the left (a work surface has none), title and one line of context in the middle, search and ⋮ on the right. It lifts off the content as you scroll, and the navigation bar draws back to its icons; scrolling up opens it again.
- **A ⋮ always means the same thing:** actions on the object that is open. App settings do not live behind it.
- **Settings:** at the very bottom of **Notes**, where the desktop keeps them too. They open the area list first (like the left side of the desktop settings) — a tap opens that page. **Active vault** on top leads to the vault management: switch vaults (check mark = active), **Create a vault** and **Connect to cloud**. The list shows **the same areas as the desktop** — including **Start & behaviour** (show the welcome and the highlights again), **Bars & areas** (the navigation bar) and **Maintenance** (vault statistics, rebuild the index, restore deleted files). Only **Updates** is missing: the app does not update itself, Google Play and TestFlight do that. **Maintenance** also carries the **import from other apps** — on the phone it always writes into a subfolder of the open vault, shows what it would create before it starts, can be stopped while it runs and leaves a report behind.

## Reading and editing notes

Notes open **rendered and read-only**; the pen at the top right switches to editing (with a toolbar above the keyboard: formatting, lists, wiki link, slash commands, insert photo). `![[Note]]` embeds appear as tappable preview cards.

Folders can be **searched** and **sorted** from the toolbar above the list — by **Title**, **Last modified** or **Created**, choosing again reverses the direction; the sort is remembered on the device. On a cold start the last open note opens again, and every note opens where you left it. Lists with nested items fold and unfold with a tap on their bullet.

The **Note details** button in the header (between the bookmark and the ⋮ menu) opens the note's context sheet: properties (directly editable), backlinks, outline, graph and the **version history** — every edit automatically creates snapshots you can inspect, compare and restore. The Markdown source and in-note search live in the ⋮ menu.

On a wide screen (a tablet from 1024 px) that sheet can stay open as a **third column** beside the note instead of opening and closing each time. The switch is called **Dock context panel** and lives under **Settings → Appearance → Layout**; it applies to this device. With it off — or in a narrower window — the same button opens the sheet as before.

## Templates

Templates behave exactly as they do on the desktop: the placeholders (`{{title}}`, `{{date}}`, `{{daily+1}}`, `{{weekday:monday}}` …) are filled in when the note is created, **all** of a template's questions arrive together in **one** sheet — cancel it and nothing is created — and `{{cursor}}` places the caret as the note opens.

The **folder → template** and **note type → template** rules are set on the desktop; they travel with the settings sync and apply here as well — so a note in `Projekte/` starts the same way on both devices, including `＋` capture and **+ Entry** in a database. Two details: `{{weekday:…}}` always counts from Monday on the phone (the first-day-of-week setting does not exist there yet), and `{{clipboard}}` asks for the clipboard's content in the same sheet instead of reading it unasked. The full placeholder list is in [Notes and Markdown](Notes_and_Markdown.md).

## Databases (`.base`)

`.base` databases work like on the desktop: every view (table, list, gallery, board, calendar, timeline), typed cell editing, board cards move via press-and-hold. **Configure** manages views, columns, filters (including groups), sorting and properties.

The **calendar view** has three periods: **month**, **week**, **day**. The month stays the entry point — it is the only one that still shows a shape on a phone screen; week and day are lists, because seven columns of content stop being readable at that width. An entry spanning several days appears as a **bar** instead of once per day, and times come before the title. The **timeline** shows a **row per entry** with a bar from start to end: both ends can be **dragged with a finger**, which writes the note's date field. Under **Configure** you pick the date and end-date field and **colour by** — same setting, same file as on the desktop. Relation schemas (targets, cardinality) are still maintained on the desktop.

**Several entries at once**: hold a row and choose **Select several** — the first entry in the sheet. After that a tap selects instead of opening, and a bar at the bottom says how many. From there you can **delete** the selection (one question, not twelve — with the same overview of connections a single delete gives) or use **Set value…** to set one property on all of them: pick the property, then the value. Where a property says **currently mixed**, the selected entries carry different values. An empty value removes the property. While it runs you see progress and can cancel; what was already written stays. Tags, lists, multi-select and relations are deliberately not included — there "set them all to X" would mean every existing value disappears.

A **Pinboard** view shows the notes as a two-column board of sticky cards: tap opens the note, long-press shows the actions (pin, labels, color, delete), dragging after a long press reorders, and checkboxes tick right on the card. The input field on top captures a new note. Tip: point the database at your inbox folder (**Settings** → **Content & structure**) and the ＋ quick notes as well as texts shared from other apps land straight on the board.

## Tasks

The **Tasks** area collects every checkbox in your vault — all `- [ ]` and `- [x]` lines across all notes, grouped by note. It is the line-based overview a database cannot give you, because a database works on whole notes.

Tapping a task opens the note **at that line**; the box checks it off and writes back exactly the one `[ ]`/`[x]` character. Due dates (`📅`) and `#tags` appear as chips so they are not repeated inside the text.

If your vault has a **task database** (**Settings** → **Content & structure**), the area shows it as its own section above: check off, change status, **+ New task** and **Open as database**. If the database names a provider task list (**Configure** → **Data source** → **Also create new tasks in** — settable here just like on the desktop), the creation sheet also carries a switch **Also create in “…”**: on, because choosing the list already is the decision, and turned off for the one task that should stay in the vault. A promoted checkbox and a mail captured as a task take the same route. Every checkbox row then also carries **To database** in its meta line — the line stays as a wiki link, and the task lives on as a note of its own.

The **task lists** you selected for your accounts are mirrored into that database by the phone itself — it imports new tasks, recognises an existing note by its anchor (rather than creating a second one) and pushes your edits to the provider. Delete a task note deliberately and the task is deleted at the provider too — with eight seconds of **Undo**; send the app to the background within that window and the task stays. A merely missing file never deletes anything. The rules in detail are under [Calendar & tasks](Calendar_and_Tasks.md). When that happens is covered under [Calendar and events](#calendar-and-events): a phone keeps no sync running in the background, so Plainva catches up when you return to the app and when you open this area.

Above the list you get the same filters as on the desktop: **Folder**, **Tag**, **With due date only** and **Show hidden**. Hiding is a property of the **note**, not of the single task — the eye icon on a note heading writes `plainva.tasks: false` into that note's frontmatter and takes it out of the overview; **Hide templates** does the same for the whole template folder in one go. The file keeps its tasks, they just stop counting. Long-pressing **To database** picks the **target database** when your vault has more than one.

A task row gives its title the full width; status, due date, repeat and tags sit below it, and exactly one action sits on the right. **Block time** (the calendar icon on the right) creates a calendar event for the task when a calendar is connected (date, start, duration, plus the calendar picker when several are writable); **Repeat** in the meta line creates the next task with a new due date when you check this one off. Both are described under [Tasks](Tasks.md).

## Today

**Today** is the day surface. The strip at the top selects a day — it runs **in both directions**, two weeks back and two weeks ahead, and a dot marks every day that already has a daily note. Below it sits the **daily note** for the selected day (with its template and folder, to open or create), then that day's **appointments and due dates**, and finally what you edited on that day.

The middle section brings together what otherwise lives on two surfaces: all-day events first, then the timed ones in clock order, and last the tasks due that day. Tapping a task opens its note. Without a connected calendar and without a task database the section is simply not there.

## Tags

The tag list lives under **Notes**. Tapping opens a tag's notes; the chevron expands nested tags. **Long-pressing** a tag offers **Rename tag** — vault-wide, as on the desktop: Plainva rewrites every note that carries it (in the frontmatter and as `#tag` in the text, including its `tag/child` children) and then tells you in how many notes it was replaced. A note that cannot be read or written is skipped — the rest are renamed anyway.

## Find & replace across the vault

The way in is the magnifier in the header, then `>` and **Find & replace in vault**. It searches every note at once. Enter a term, tap **Find**, and the matches appear grouped per note with the hit count; a tap opens one note's lines, and only one note stays open at a time. Untick any note you want to leave out — this is per note, never per line, because a note is replaced wholly or not at all. **Replace in N notes** then rewrites the rest, with a progress bar and a **Cancel** that stops at the next note. Every note is re-read immediately before it is written, so a preview that has gone stale can never overwrite newer content; a note that changed in the meantime is skipped and said out loud. Match case, whole word and regex work here too.

Every match shows two lines — **before** with the hit, **after** with the result, `$1` back-references resolved with a regex — so you can check the change before anything is written.

## Overviews (index.md)

In an OKF vault the `index.md` is a folder's table of contents. The phone offers two ways in, meant for two different moments.

**For the moment you notice it:** hold a folder in the list — the sheet offers **Create overview** when there is none, and **Refresh overview** when Plainva keeps the existing one. The row names its effect rather than asking you to choose. If you wrote that folder's `index.md` yourself, the row does not appear at all: your file is yours.

**For the tidy-up pass:** **Settings → Vault → Maintenance → Overviews** lists every folder with its note count and state — sorted by *where something is missing* rather than alphabetically, so the few folders that need attention are not buried among the finished ones. At the top, **Generate index.md in all N folders without one** creates the missing ones in a single run. If a folder without an `index.md` already holds an overview note (MOC, Overview, README …), you can **adopt** it here — that renames the file and carries the links along vault-wide, which is why it asks first.

**Kept current.** Overviews generated by Plainva carry an invisible marker. Only those files are maintained — and from now on the phone maintains them too: create, move or delete notes there and Plainva rewrites the affected overviews shortly after. Previously only the desktop did that, so a vault tended on the phone quietly went stale.

**Read-only with an exit.** A managed overview opens as a reading view with a band above it: **Refresh** rewrites it, **Edit anyway** removes the marker — after which the file is fully yours and is no longer overwritten automatically. Without that guard the next run would silently write over whatever you typed into it.

## Convert to OKF format

Lifting a whole vault to the [OKF format](OKF.md) now works from the phone as well: **Settings → Vault → Maintenance → Convert to OKF format**. The wizard scans, lets you pick the default `type`, **names the affected notes**, and only writes afterwards — every file goes into the backup folder before it is changed.

Because a phone may end a running app at any moment, the run additionally stops at the next file when you tap **Pause** or the app goes to the background. That Plainva asks the next time you open the vault whether an interrupted run should be **continued** or **rolled back** applies to both devices; **Later** is a valid answer, the question comes back and is not lost.

An interrupted run leaves a partly converted vault, not a broken one: only frontmatter fields are added, every note stays valid Markdown, and every other editor can still read it.

### OKF 0.2 on the phone

The fields of [OKF 0.2](OKF.md) — provenance, review, status, stale-after — are read and shown on the phone exactly as on the desktop: the **Draft**/**Deprecated** badge in the note header, the **Marked as stale** notice above the note, and the **Trust & provenance** section in the note's context sheet with the trust level. **Mark as reviewed** lives there too: it appends `human:<your name>` to the verified list; Plainva asks for the name once per vault, keeps it on the device and lets you change it under **Settings → Vault → Content & structure → Reviewer name**. A vault's bundle version is lifted to 0.2 under **Settings → Vault → Maintenance → Bundle version** — with a preview, a backup and the checkbox that removes the legacy `okf_version` field from the notes.

## Graph

The **vault map** shows your vault as nodes and edges. Tapping a folder bubble expands it, tapping a note opens it; the chips above filter by note type, tag and edge kind. Drag a node and **the map remembers where you put it** — the remembered arrangement lives in `.plainva/graph.json` and deliberately stays on this device, like the search index.

**Long-pressing** a node opens its menu: open (or expand/collapse for a folder), **Focus on selection** and, if the node is pinned, **Unpin**. Long-pressing an **edge** names both ends and opens either note. Drag one note **onto another** and Plainva offers to **link** them — as a text link at the end of the note, or through a relation of the matching database; a relation that allows exactly one entry asks first, because it replaces the current value. The **Select** chip turns a drag on empty space into a selection rectangle (a phone has no modifier key); selected notes can be deleted together, through the same confirmation a single one gets. **Export as SVG…** hands the map to your device's share sheet.

The same cleaning-up in the small is what the **graph in a note's context sheet** does: it shows the open note's neighbourhood and, below it, suggestions for what else might belong to it. **Link** places the link at the passage in the text — not at the end of the note — and a dismissed suggestion stays dismissed, even after the note is closed.

The **Clean up** chip opens the cleanup list: **orphans** (notes nothing points to), **broken links** (references into nowhere) and **mentions** — places where a note is named but not linked. You delete an orphan through the same confirmation as everywhere else, create the missing note for a broken link, and link a mention exactly **at the passage** rather than at the end of the note. What you dismiss stays dismissed: it does not come back on the next pass. The mention scan reads every note and therefore only starts when you ask it to — and can be stopped at any time.

**Focus** can also be set from the node menu: the map then shows only its neighbourhood down to the depth you pick (1 to 3). The chip carrying the depth clears the focus again. Two more chips read the map by age: **Heatmap** tints every node by how recently it changed, and **Time travel** hides everything newer than the slider — so you can watch the vault grow.

## Calendar and events

The **Calendar** area shows your connected calendars in the **Day**, **3 days** and **Agenda** views — the same account model as on the desktop. You reach it from the navigation bar or through **Areas**. Each day column carries its **weekday and date** at the top, and below it a strip for that day's **all-day events**; both scroll away with the grid rather than holding space permanently. Tapping an event opens the **event preview** as a sheet — the same surface as the floating window on the desktop: time span, location, description, attendees with their answers, and for a series its rhythm along with the next occurrence. For an invitation it offers **Accept**, **Tentative** and **Decline**, with **Edit event**, **Meeting note** and **Delete event** below. Swipe down to close the sheet. Daily notes do not live here — they live in **Today**.

Tapping an event reminder opens the event itself — the day view on its day, the event open. The view you last had (day, 3 days, agenda) is remembered on the device, as on the desktop.

**When the phone looks.** A phone runs no clock in the background, so the regular sync stands still for as long as the app is away. Plainva therefore asks of its own accord as soon as you **come back to the app** and whenever you open **Calendars**, **Tasks** or the **Calendar accounts** — at most once a minute, so switching back and forth does not set off a chain of syncs. Coming back also **replans the reminders**, even when nothing new arrived: the clock moved on regardless. If you would rather not wait, **Refresh now** and pulling the list down are still there.

Manage accounts from the gear icon in the event calendar: connect **CalDAV** on the device with an app password (e.g. Fastmail, Nextcloud, iCloud); Google and Microsoft follow via browser sign-in. Per account you can show or hide individual calendars.

From an event, **Meeting note** creates the note that belongs to it — the same note the desktop finds: it carries an anchor to the event, so calling it again reopens it instead of creating a second one, and it lands in the **meetings folder**. You pick that folder in the accounts area under **Calendar settings** with a **folder browser** rather than typing its path; the **default calendar for events** (the one a new event starts in) sits there too; both belong to the vault and travel with the settings sync. The same place lets you pick, per account, which **task lists** mirror into your task database.

**Signing in is per device.** What syncs are your account *settings*, never the sign-in itself — deliberately so: credentials should not leave the device. An account that arrived through settings sync therefore shows up in the list but carries a **sign in** marker, with a line underneath telling you what to do. As long as no account is signed in on this device, the calendar and the mailbox explain that in place instead of simply staying empty, and **Sign in on this device** takes you to the accounts. Signed-in accounts show **active**. If a sign-in later expires or is revoked, the row says **sign-in expired** together with the reason — and **Sign in again** gets it going without removing the account: same account, same calendars. For Google and Microsoft, Plainva looks for the app registration it needs on the device itself — at the account, at the file sync of the same account, or at another account of the same provider. That holds for **Sign in again** and for **adding** an account alike: when Plainva finds one, the form says **Client ID taken from this device** with **Edit** next to it. Only when there really is none does the form ask for it.

**One login for all services — here too.** If a Microsoft or Google account carries several services (files and calendar, say), the **Cloud accounts** overview offers to merge them into a single sign-in. Afterwards one sign-in keeps every service alive instead of just one — before, a service could keep running while another one of the same account had quietly expired. A Gmail mailbox stays out of it: it runs over IMAP with an app password and needs no consent. The offer stays as long as the shared sign-in does not carry every service of the account. If it misses a service, the account details hold two ways out: **Reset shared sign-in** lets every service use its own again, and **Leave wizard** clears a connection attempt that never finished.

**Reminders.** Under **Calendar settings → Reminders** you switch on **Remind me of appointments**; the phone then asks once for notification permission. Whatever reminder the event itself carries wins — only when it says nothing does Plainva remind you 15 minutes ahead, and all-day events the evening before at 19:00. An event that explicitly wants no reminder gets none. The next 14 days are planned, at most 64 reminders ahead — that is what iOS allows; Plainva refills that window every time you open the app and after every calendar refresh, and tells you from when on a period no longer fits instead of quietly swallowing appointments. **The limit that stays:** the phone can only announce what it saw at the last sync — an invitation arriving ten minutes before the start no longer reaches a notification.

**What you set alongside it.** The **Lead time** applies to appointments without a reminder of their own; **All-day appointments** decides which evening or morning they speak up. **Due tasks** additionally takes in the tasks of your task database — with a time like an appointment, without one following the **Tasks without a time** row right below, which by default reminds you **on the due day at 09:00**. **Only these calendars** narrows down where reminders come from at all; select nothing and it reads **All**, and a calendar added later is included by itself; the sheet stays open until you are done, so you tick several calendars in one sitting. The notification carries two actions: for an appointment **Meeting note** (creates it, or opens the existing one), for a task **Tick off** — which completes it right there and, for a repeating task, creates the next one without you opening the app. Under the settings a line also says **what was actually planned** — "Planned: 12 appointments · 3 tasks" — or why nothing was, for instance because no task database is set on this device. When there is nothing to choose from yet, the row says so instead of claiming **All**: **No calendars yet** when an account is connected but no calendars have arrived — tapping there offers **Refresh now** — and **No account connected** for as long as no calendar account is set up at all.

The calendars your phone already knows connect without a login: **Settings → Cloud accounts → Connect account…** offers **On this device** as the first tile while no device account exists yet. A tap asks for the system permission; afterwards every calendar of the device is in the list, and on iOS the reminder lists as task lists. The account card shows the permission state and leads to the system settings when it is missing; **Remove account** only drops the connection, the device's calendars stay.

## Email

Under **Settings → Email** you connect a **Microsoft mailbox** (Outlook.com, Microsoft 365) directly through the browser sign-in — no app password needed. As with the calendar, signing in happens per device.

After that you can open **Email** as its own area from the **areas sheet** and place it in the navigation bar. The line under the title shows folder, unread count and account, and opens the folder picker. Tap a message to read it; **Save as note** files it in the **Mail** folder of your vault (capturing twice opens the same note). Remote images stay blocked until you allow them for that message — a loaded image tells the sender when and where you read. The four actions — **Reply**, **Reply all**, **Forward** and **Save as note** — sit in a docked row along the bottom edge; while a message is open the navigation bar steps back and gives it the room. Hold a row to open its sheet: **Select several** comes first, then the same actions as the desktop's right-click menu — read/unread, flag, move, snooze, spam and delete.

**IMAP mailboxes work on the phone too.** Add one under **Settings → Email**: pick the provider, enter the address and the app password, and Plainva fills in the servers. If your provider is not in the list, **Advanced** lets you type the IMAP and SMTP host, port and a different user name yourself, and an existing account can be edited later. Selecting several messages works by pressing and holding one of them; after that a tap adds more. In the conversation view, holding or tapping the conversation row picks the whole exchange — and every message in it keeps its own folder, so a reply from **Sent** is marked there.

An open message offers **Reply**, **Reply all** and **Forward**. A reply quotes the original below your text; "Reply all" additionally picks up the other recipients and leaves out your own address. When **composing**, **Attach file** adds a file from the vault — on the phone the vault is the storage you can reach, and everything that arrives on the device (a saved attachment, an inserted photo) already lives there. Each attachment gets its own row with **Remove attachment** for as long as the message has not gone out.

A message you have started does not have to be sent: **Save draft** files it in your account's drafts folder — where every mail program on that mailbox will find it, not in a phone-only place. Which folder that is, the server states; only when it stays silent is the name guessed. In the list, two toggles sit next to the folder line: **Unread** narrows what is currently loaded (so the count and **Load more** stay reachable), while **Flagged** asks the server for every flagged message in the folder — including ones far below the loaded page. In **All inboxes** the flagged toggle is deliberately absent: that query names exactly one mailbox.

From an open message, three routes lead into the vault: **Save as note**, **→ Task** in the ⋮ menu (creates an entry in your default task database — with its template, status and the mail's date) and **+ .eml**, which additionally stores the original message and links to it from the note. All three are anchored: capturing the same mail twice opens what is already there. **Delete** now also lives in the ⋮ menu rather than beside the back arrow; in the list a swipe is enough. Moving to Trash offers **Undo**, because it can be taken back — deleting permanently from Trash still asks, because it cannot. And instead of several notices stacked on top of each other there is now **one** line: the error, else the unreachable accounts (from two on, as a count), else the note about the stored copy.

A note can be sent from its own ⋮ menu: **Send note by email (mailto)** hands it to the phone's mail app — Plainva needs no account of its own for that — while **Send by mail** opens Plainva's own composer with subject and text.

## Importing from another app

Under **Settings → Maintenance → Import from another app** you bring notes from another app onto this device — with the same sources as on the desktop.

You first choose where it writes: into a **subfolder** of the open vault, or into a **new vault** on this device. The new vault is the right choice when there is nothing here yet; you only give it a name, and undoing the whole import means removing it again under **More → Vaults**.

Sources that need an account — Notion through its API — ask for a token in the wizard. It is used for that one run and is not stored.

The details of every source are in [Importing from another app](Import.md).

## Sync

The **Settings** (at the bottom of **Notes**) lead through **Active vault** to vault management; that is where you connect cloud storage (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Connect to cloud** brings an existing cloud vault to the device; **Create new vault** first asks **On this device** or **With an online service** and then the starting structure (empty or a template such as PARA) — the online path continues with connecting, the target folder in the cloud can be created fresh via **New folder** in the picker sheet, and the structure is uploaded on the first sync. The first run offers the same choice between an existing and a new cloud vault ("Connect to cloud"). Every connection gets its own, separate vault on the device. The vault page shows status, progress, pending transfers and offers **Export vault** (a ZIP through the share sheet).

The vault page is ordered by what its controls are FOR: a **status card** at the top answers the one question you open this page with — is it running? (state, last run, pending transfers and interval in one line). Below it come named groups — **Connection**, **Contents** — and at the bottom, behind its own edge, the **Danger zone** with **Disconnect sync** and **Delete vault**. Before, up to nine identical buttons sat in one row, with **Restore deleted files** directly beside **Delete vault**.

Under **Contents**, next to **Export vault**, there is now the **automatic vault backup**: one ZIP of the whole vault per day, of which the last **seven** are kept by default (**Retained backups**); **Back up now** creates one immediately. The archives live in the device's documents, not in the cache — something the operating system may empty at any time is not an archive. A phone gets no background alarm: the check runs when you open the app and whenever you return to it, so the backup catches up rather than running at a set hour. The line under the switch therefore says when it last ran — that is how a backup that quietly never happens becomes visible. Until now the phone only had the manual export, so a vault nobody thought to export had no archive at all. After a reinstall on Android the phone can no longer read its older archives — they stay in the folder but are neither counted nor pruned; the card **Older backups cannot be read** says so instead of claiming "0 backups".

How often this vault checks the remote for changes is set on the same page (**sync interval**, at least 5 seconds) — local saves are uploaded immediately regardless. For Google Drive, OneDrive, Dropbox and S3 the **cloud folder** can also be changed later; with WebDAV the folder is part of the server address, so you reconnect instead. If settings sync is encrypted you can additionally turn on **Ask for the passphrase on every start**: the key is then never stored on the device. And **Security & Sharing** now states plainly that encrypted workspaces are experimental and have not been independently reviewed — keep your recovery file and code somewhere safe.

The vault page also states whether your **settings** travel with you — as a card with a clear state rather than a bare button:

- **Not being synced**: settings sync is off for this vault. Turn it on from the desktop.
- **Not encrypted yet**: this vault has no sync passphrase. You can set one **on the phone** now: the wizard shows the recovery code and has you type two randomly chosen groups of it back before anything is written at all. If a passphrase already exists in the cloud, the phone says so and never creates a second one — that would lock every other device out.
- **Not unlocked on this device yet**: your settings are stored encrypted in the cloud. Enter the passphrase chosen when this was set up — on the desktop or here on the phone; this device unlocks them once with it.
- **Being synced**: this device is unlocked; folders, views and backup rules stay in step with your other devices.

Each card also names what does *not* travel: sign-ins always stay on the device (see [Calendar and events](#calendar-and-events)).

**Settings** → **Security & Sharing** names what the connection actually is — and for a plain cloud vault it sets up the encrypted workspace right on the phone (identity → recovery file and code → activation). Without a cloud connection there is nothing to encrypt, and the area says so.

Both setups — the encrypted workspace and the sync passphrase — now run as **their own flow, without the navigation bar**: while one is open there is exactly one way out, and it asks. That is not decoration. Until the final step your key exists only in memory, and leaving discards it; before, a tap on the bar could do that without a word. The last step shows a progress bar where there is something to count — the workspace re-encrypts every file, while the sync passphrase is two writes, and inventing a percentage for the second would be a lie in the shape of a bar.

**Shares are managed here now**, not only on the desktop: under **People & permissions** you invite a member with a role (**Invite** creates them — you pair their device afterwards), create a group, and change a group's role right in its row. Under **Slices** you create a share for a **Folder**. Deliberately not on the phone: slices built from a free selection or a dynamic rule — both would need surfaces that do not exist here. Pick the folder with **Choose folder…** instead of typing the path.

**Letting another app sync the folder (iPhone and iPad).** Plainva's folder shows up in the **Files** app under **On My iPhone** → **Plainva**. Another program — a Syncthing client, for instance — can pick it from there and keep it in sync across your devices without Plainva talking to any cloud service. The vault you created on the device sits inside it as `vault`; every cloud connection gets its own subfolder under `vaults`. The reverse does not hold: Plainva works in its own folder, not in another app's. On Android this folder is not visible to other programs.

**An existing folder as a vault (Android and iOS).** Under **Vaults → Create a vault** there is a third way, **A folder on this device**: you pick a folder another program keeps — Syncthing, the Files app, a second sync client — and Plainva reads and writes there without copying anything. The folder stays the folder: remove the vault and only the connection goes, the files stay. Changes another program makes there are seen when you return to the app and when you open a note. Cloud sync is off for such vaults — a second sync on the same store would overwrite the first — and the card in the vault detail says so. If access expires (folder moved, permission revoked), the card names it and **Reconnect folder** restores it.

## Safety net

Snapshots (version history), a draft journal (after a crash the note offers your last unsaved state) and conflict copies with a comparison view protect your data. Retention is configured under **Settings** → **Backup & version history**.

**If someone changes the same note elsewhere** while you are typing here, Plainva preserves your version as a copy next to it and adopts the one that arrived. That now sits **on the note** and stays until you resolve it: a notice above the text names the copy's path, opens it, and shows the **differences** on request. It used to be a message that faded after seconds — and the save kept retrying, so every round wrote another copy. Exactly one is written now.

**Differences** opens the same comparison surface as on the desktop: the note on the left, your copy on the right, identical lines collapsed, and the same exits — **adopt**, **keep both** (the copy is then named `Note (Version …).md`), **discard copy**, each asking first.

**When you delete a folder**, the prompt names how many files are inside — the number is on the button as well. Plainva snapshots every file in it first, and you can bring those back under **Settings** → **Maintenance** → **Restore deleted files**. The dialog states one limit openly: **only what this phone has written at least once can be preserved.** A note that merely arrived through synchronisation and was never edited here exists in no snapshot. Unlike the desktop, a phone has no system trash to catch that. If the deletion affects more than ten files, or more than a fifth of the vault, Plainva asks a second time — exactly as the desktop does.

## Sharing and shortcuts

On Android and iOS, shared text and URLs become a new note in the inbox folder; shared images and files are taken over as attachments (up to 25 MB per file). On Android, long-pressing the app icon additionally offers **New note** and **Today**.

## Folders, photos, and calendar

The floating **Plus** button remains available inside nested folders, and every quick-create action creates in the folder you have open — new folders included. The ⋮ in the header belongs to the open object instead: it shows that object's actions, never the app settings.

The editor photo button offers **Take photo** or **Choose from library**, preserves the insertion point, and reports permission or file errors visibly. Photos land in the vault's attachments folder — the same one your computer uses.

Events and daily notes are deliberately separate: **Calendar** shows the connected calendars (see [Calendar and events](#calendar-and-events)), **Today** shows the daily note of a chosen day. There is no local month view of daily notes — the strip in **Today** does that job.

## Attachments and images

Besides notes and databases the navigator now shows **attachments** — images, PDFs, whatever else lies in the folder. An image opens inside Plainva; everything else is handed to the system, which knows what a PDF is and Plainva does not. **Share** passes a file to any other app.

A note's ⋮ menu carries **Export as Markdown…**: it hands the file itself to the system share sheet, where you find Print, “Save to Files” and every editor you have installed. **Share** above it sends only the note's text. If the note carries open annotations, Plainva asks first: **Include annotations?** — **As a list at the end (readable everywhere)** or **Marked in the text (CriticMarkup)**; the invisible anchor markers come out either way.

## Swiping

**Swipe a row left** to reveal its actions: **Bookmark** and **Delete** on a note, **Rename** and **Delete** on a folder, **Delete** on a database and in the mailbox. They are the same actions the row offers in its menu (long press) — the swipe is the shorter way there, never the only one. The first time, a line above the list says so; you tap it away, and it appears exactly once per vault.

Deleting asks through the same dialog as everywhere else. While you are selecting several rows, swiping is off — a gesture that means exactly one row has no clear meaning next to a selection you are still assembling. With **conversations** on in the mailbox, a swipe on a conversation means the WHOLE conversation (instead of an undo it then tells you how many messages it was); an expanded single message still swipes on its own. Task rows have no swipe actions — they carry their controls visibly on the row.

## On wide screens

The app follows the window width, not the device name:

- **below 600 px** — one surface after another, as on the phone.
- **600 to 839 px** — the navigation bar becomes a **rail at the side**; still one surface.
- **from 840 px** — navigator and working surface stand **side by side**. It is the same navigator as the **Notes** area, just beside your work instead of in front of it.

**The rail shows every area.** On a phone the bottom bar holds three to five destinations — more than a thumb reliably hits, so the rest live behind **Areas**. Along the edge of a wide surface that limit does not apply: the **whole** list stands there in your order (**Settings → Navigation bar**), the detour through **Areas** falls away, and **Settings** sits at the very bottom. The rail starts below the status bar — on a tablet with a camera cutout its first icon used to sit underneath it.

**The navigator folds away.** While you are looking for a note the left column belongs to it; while you are writing one it belongs to the note. The icon at the bottom of the rail — just above **Settings** — folds it away and back, and the working surface then takes the full width. The switch appears only where there is a second column at all (from 840 px), applies to this device, and stays the way you left it across a restart. On the desktop it is the same move — there it is called **Toggle left sidebar**.

On a tablet, or a large phone turned sideways, you get the same spatial model as on the desktop — navigate on the left, work in the middle — instead of a blown-up phone.


## Databases in the calendar

Above the calendar views sits a row of chips: every `.base` view of type **calendar** or **timeline** that names a date column can be shown there. Shown entries appear among the appointments in the day and agenda lists — with a **diamond and a dashed edge**, so a note never looks like an appointment; in the month grid as a **hollow dot**. A tap opens the note.

**The selection belongs to the vault**, not to the device: what you show on your computer is here once settings sync has run. Scheduling on the phone happens through the entry's sheet — dragging stays on the computer.

The other way round, a database's calendar view can show the **number of real appointments** for a day in the corner of its cell — so you can see what you are planning against.

## Remark notifications

When somebody has written on a note, Plainva can tell you — the same three levels and the same preview switch as on the desktop, under **Settings → Content & structure**. Tapping the message opens the note and highlights the card it means. You silence a single note with the bell in the comments sheet.

When several remarks are new at once, the notification opens **Open comments** on the **New** tab — exactly the threads it meant; **All** and **For me** stand next to it.

**The message arrives later here than on the desktop, and that is a property rather than a fault.** Plainva has no server that could nudge your phone — building one would mean a foreign server learning when who commented on which note. A remark is therefore noticed where the phone looks anyway: after a sync cycle and on returning to the foreground. No timer runs in the background for it; no phone platform allows one.
