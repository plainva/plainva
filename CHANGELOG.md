# Changelog

All notable changes to Plainva are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Plainva aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it
reaches 1.0.

## [Unreleased]

## [0.6.6] — 2026-08-15

Repairs and polish. The one that touches your data is the first: a renamed note
produced a conflict copy the next time you edited it, instead of a merge. On the
phone, every settings surface now follows one grammar — a field is a row, rows
live in cards — and three sync annoyances that had nothing wrong behind them are
gone.

### Added

- **The mobile calendar's day columns carry the weekday and the date.** The time
  grid answered "at what time" and left "on what date" to the period label above
  it; readable for a single day, but with three columns side by side it meant
  counting. The desktop has carried a header row since it was built.
- **All-day appointments appear in the mobile time grid.** The grid positions
  timed blocks, so a whole-day event had nowhere to go and was simply invisible
  in this view. It gets the strip the desktop has, above the hours.
- **Retired account entries can be cleaned up from the phone.** Removing them
  existed only on the desktop, which is why the notice about them was permanent
  by construction here: it could be read on a phone and never acted on.
- **The meeting folder has a folder browser** instead of a text field you had to
  type a vault path into, matching the four folders under Content and structure.

### Fixed

- Renaming a note no longer costs it its merge base. `sync_state` is keyed by
  path exactly like the file index, but only the index moved when a path moved:
  the common ancestor stayed stranded under the old name, so a renamed note
  looked brand-new and was recorded with no base at all. The next time it
  differed from the server there was nothing to merge against, and the local
  version was preserved as a `.CONFLICT` copy instead of being merged (#48).
  Latent until a renamed note is also edited, and hidden on services that return
  an identifier for a move — which many WebDAV servers do not.
- Deleting a note whose folder had been renamed no longer leaves it behind in
  the tree and in search. De-indexing was keyed on a hash of the path, which is
  precisely the value a row loses when its folder moves; it now uses the path
  itself. The same change ends the opposite over-reach, where de-indexing an old
  path could remove a note that still exists under its new one.
- **The red warning triangle appears only for a sync that has actually stopped.**
  A phone in a pocket runs no timers, and the watchdog measured on the wall clock
  alone: twenty minutes of suspension read exactly like twenty minutes of a
  request nobody answered, so the first tick after waking abandoned a healthy
  cycle. The gap between two ticks now tells the watchdog how long it was not
  running. Three messages also raised a final error for something their own
  sentence called a retry — an unresponsive cycle, a cycle abandoned and
  retried, files that could not be pulled and will be next time. All three now
  report as retrying and follow the same three-strikes rule as every other
  transient failure.
- **An account deleted on this device stays deleted here.** The account import
  upserts every account the shared profile carries, and there was no tombstone:
  the list travels as one field, so a device that has not run the new version
  keeps publishing an account it still has, and the next cycle puts it back. The
  tombstone is deliberately local — removing an account for every device is a
  larger promise that needs the other devices to agree. Adding the account back
  lifts it, so nothing becomes unaddable.
- **The notice about retired account entries is said once**, not on every app
  start. Its debounce lived in a module-level map, which holds for a session —
  and a phone starts many sessions a day, while the condition never cleared
  itself.
- **The pencil on a mobile mail account opens a sheet.** It used to change a
  heading four hundred lines below the fold, so tapping it looked like nothing
  had happened at all. The form closes on success only, and a rejected password
  leaves what was typed in place.

### Changed

- The macOS requirement is **13.3 (Ventura)**, corrected from 12 (Monterey). On
  macOS an app draws its window with a system component that moves with OS
  updates and not with Safari, so the system version decides the engine after
  all — a Mac with a fully current Safari can still be below the bar. Reported
  twice from the same machine (#46), the second time with the measurement:
  Safari 17.6 installed, engine below Safari 16.4. The startup message no longer
  suggests updating Safari, which on macOS cannot move it.
- **Every mobile settings surface follows one grammar.** A field used to stand
  loose on the page and draw its own left edge, right beside the cards on the
  surfaces next to it. There are two edges now — the page's and the row's — and
  one rhythm per page instead of a stack of individual margins. Appearance,
  Editor, Content and structure, Backup, About, Security, the sync chain,
  diagnostics, the account, vault and cloud surfaces and mail rules.
- **"Recently opened" and Bookmarks sit above the view switch** in the desktop
  sidebar and stay visible when you switch to Tags or Databases; they used to
  live inside the Files branch and disappear with it. The switch now sits
  directly on top of the tree it switches, and icons and labels line up with the
  file tree below.

## [0.6.5] — 2026-08-14

Three open reports, and behind each of them something that had been built and
then never called. A 90 MB attachment froze the app because its bytes were
routed through a layer that was never meant to carry them. A folder rename
quietly broke the search index, and the error message said the opposite of what
had happened. And creating a task in Plainva never reached your provider —
although the capability to do it was finished in all three of them.

### Added

- **Tasks are created in your provider's list too.** A task database can name
  the list new tasks also go to — Google Tasks, the iCloud reminders, Microsoft
  To Do — with **None — stays a note** as the first option. All three ways a
  task comes into being (**+ New task**, a promoted checkbox, a mail captured as
  a task) go through one service, so it never depends on *where* a task was born
  whether it reaches the provider. On the phone a per-task switch keeps the one
  task that should stay in the vault.
- **Text files open and edit inside Plainva**: `.txt`, `.csv`, `.json`, `.yaml`
  and source code, with syntax highlighting resolved from the file name and a
  lean editor profile (line numbers, indentation, wrapping, find & replace). A
  vault may extend the list of extensions; it cannot shrink it.
- **Encrypted workspaces can be managed from the phone** (experimental):
  decommission, transfer ownership, revoke a device or a member — with the
  choice between "future only" and a full rekey, and the consequences of each
  stated before you confirm. Confirmation is typing the vault's name, not a tap.
- **Several services of one account connect in a single run** on mobile, with a
  "step 2 of 3" banner, and the **first** consent asks for the union of the
  scopes the whole run needs. A Microsoft account with three services costs two
  prompts instead of three; Google files plus calendar costs one instead of two.
- **The calendar pulls only what changed**, per calendar, where the provider
  offers a change feed (Microsoft, CalDAV). A cursor run never infers a deletion
  from something missing in a listing, and any failure drops the cursor so the
  next full refresh heals itself. Google keeps doing windowed full refreshes —
  its API cannot combine a time window with a sync token.
- **A command for the performance measurement** (`scripts/measure-performance.mjs`)
  that generates the test vaults, runs the benchmark over each size and rewrites
  its own block in the notes.

### Fixed

- **Large files reach the server.** Their bytes no longer pass through the app's
  web layer, where a request body became roughly 94 million boxed numbers for a
  90 MB file — over a gigabyte of peak memory, with the interface frozen for
  minutes. A native command streams the file straight to the service, so memory
  stays flat whatever the size. WebDAV, S3, OneDrive, Dropbox and Google Drive,
  on the desktop and on the phone. **Nothing is capped** — each service's own
  limit is the only ceiling left. One exception, stated rather than buried: in
  an **encrypted workspace** the old buffered path still applies, because
  sealing needs the plaintext bytes in hand.
  ([#48](https://github.com/plainva/plainva/issues/48))
- **A request timeout is a deadline, not a speed requirement.** A flat 30 s
  silently demanded 3 MB/s of any upload; the budget now grows with the payload.
  ([#48](https://github.com/plainva/plainva/issues/48))
- **A renamed folder no longer poisons the search index.** The index row kept an
  identity derived from the old path, so the next refresh collided on `UNIQUE
  constraint failed: files.path` — and because a full scan is written as one
  atomic batch, a single such row rolled the entire scan back while every caller
  swallowed the error. Deleting was where it surfaced, and the message was the
  opposite of the truth: the folder **had** been removed from disk. The index
  repairs itself on the next scan, without a migration. Renaming a folder whose
  name contains `%` or `_` no longer rewrites unrelated rows.
  ([#34](https://github.com/plainva/plainva/issues/34))
- **The start-up guard says which capability it found missing**, and prints the
  user agent with it, instead of naming a Safari version that may have nothing
  to do with the engine inside the app.
  ([#46](https://github.com/plainva/plainva/issues/46))
- **The provider you pick reaches the form it was picked for** (mobile). Picking
  Google and tapping "Files" landed on a WebDAV form; for the calendar it was
  quieter and worse, because that form pre-selected Google whichever tile you
  came from.
- **`http://` servers on a home network are reachable on Android** — the release
  build kept the platform default of https-only, so a self-hosted WebDAV server
  or a local MinIO could not be reached at all.
  ([#48](https://github.com/plainva/plainva/issues/48))
- **A dead calendar sign-in stops costing a network round per cycle.** An
  account whose last failure was an *answer* is skipped until you refresh
  manually or sign in again.
- **Mobile:** a conflict is a state on the note rather than a toast that fades ·
  a folder deletion says how much it removes and keeps a copy · imported notes
  sync (the import wrote past the adapter chain) · pending saves land before a
  path changes · a cell edit changes the note's property instead of adding a
  second one · holding a row means the same thing on every kind of row, and the
  task row gained both a sheet and a swipe · four actions that failed silently
  now say so.
- **Desktop:** six surfaces stopped reporting a failed query as "nothing here" ·
  the `.base` views offer their action when empty · the tag rename says how many
  notes it could not write · a mailbox this device never signed in to offers the
  sign-in where the empty list is, instead of a raw `missing mail credentials`.
- **A closed consent tab can be cancelled**, and the app says what happened
  instead of printing `oauth loopback timed out` after three minutes.

### Changed — please note

- **Text files open inside Plainva again.** 0.6.4 handed `.csv`, `.svg` and
  `.txt` to the operating system; they now open in the app's plain-text editor.
  The first bytes still have a veto: a file that does not decode cleanly is
  offered to the system app instead, because saving a lossy decode back would
  destroy it. Line endings and a byte-order mark are preserved exactly as found.
- **The repair for daily notes that inherited `plainva.tasks: false` is gone.**
  It was always transitional and its removal condition was met several times
  over. Already affected notes are **not** fixed by removing the button — the
  FAQ now describes the manual route.
- **Dropbox no longer needs a registration of your own.** The bundled app's user
  limit was raised; Plainva also asks for only the four scopes it actually uses.
- **The start-up guard is English only.** That screen is written to be pasted
  into a report, and a second language only made it longer.

## [0.6.4] — 2026-08-12

Getting a file into a note, and opening it again afterwards. Two reports made
the same point from opposite ends, and behind them sat a rule that existed in
exactly one place: attachments were handed to the operating system when you
clicked them in the file tree, and nowhere else.

### Fixed

- **Attachments open in the system's default program from every route**, not
  just the file tree — through a `[[link]]`, a bookmark, the recents list, the
  tag tree, backlinks, a split, the graph or a peek. Each of those went through
  the same tab-opening path, which loaded a PDF into the editor and failed. On
  the phone a tap on `[[Report.pdf]]` did not resolve at all and **created a new
  note `Report.pdf.md`** — the vault gained a file from merely looking at one.
  The decision now lives in one shared function that every renderer of a vault
  path asks, held together by a test that reads the source rather than a mock.
  ([#55](https://github.com/plainva/plainva/issues/55))
- **The attachments folder is honoured on mobile even when the note sits in the
  vault root.** An empty note folder made the resolver drop attachments beside
  the vault root instead of into the configured folder.
- **Dropping a file on the mobile editor** takes any file, not only images —
  the same rule the paste path uses.

### Added

- **Paste takes any file, not only an image** (`Ctrl+V`). The drop path already
  did; the rule was written twice and the two had drifted apart.
  ([#55](https://github.com/plainva/plainva/issues/55))
- **A file picker in both shells.** The slash command **Attach file…**, the same
  entry in the note's ⋮ menu, and on the phone the ＋ sheet. Images embed
  (`![[…]]`), everything else is linked (`[[…]]`).
  ([#56](https://github.com/plainva/plainva/issues/56))
- **`[[` suggests attachments too**, below the notes and under their own
  heading. The label is the full file name; what gets inserted is the **path** —
  an attachment carries no frontmatter title, and the bare stem would silently
  resolve to a note of the same name.
  ([#56](https://github.com/plainva/plainva/issues/56))

### Changed

- **Text-decodable attachments (`.csv`, `.svg`, `.txt`) now open externally**
  too. They used to load into the editor as a fully editable buffer — a route
  that was never advertised and could write a file Plainva does not own the
  format of. Opening more text formats *inside* Plainva is planned separately.

## [0.6.3] — 2026-08-11

Three days, three finished strands. The calendar and mail grew the things that
make them usable rather than merely present — reminders, rules, spam, an
out-of-office notice — and each of them runs where it takes effect rather than
where it was convenient to build. Databases learned to plan a project. And the
place your credentials live stopped being a write-only drawer.

### Added

- **Reminders on both devices.** Events announce themselves through the
  operating system's own notification centre, with four settings (default lead
  time, whether an event's own alarm wins, quiet hours, per-calendar). On the
  desktop Plainva can optionally keep running in the background so a reminder
  arrives with the window closed — autostart and tray icon, both off by default,
  offered when you switch reminders on. Both systems cap how many notifications
  an app may have pending; Plainva schedules up to that cap and says from which
  date on it can no longer promise one.
- **Mail rules that run on the server.** A rule model shared by both shells,
  translated into Sieve (`ManageSieve`) or Microsoft `messageRules` where the
  provider supports it, and executed locally — labelled as such — where it does
  not. Plainva owns a *section* of your Sieve script, never the file: a script
  it cannot safely read is reported, not overwritten.
- **Report spam and take it back**, an **out-of-office notice** over Sieve
  `vacation` or Graph, **snooze**, **templates in the composer**,
  **unsubscribe** via `List-Unsubscribe`, and **undo send**.
- **Google's status entries** (working location, focus time, out of office) are
  read and drawn as what they are, so a day with three of them and one meeting
  no longer looks like four meetings.
- **An event preview.** A click on an event shows it; editing is a step you
  take. The series question moved to the moment you save, where it has a
  consequence. Multi-day events draw as one bar instead of a chain of identical
  rows, and a task with a time sits in the day grid rather than above it.
- **Project planning in a database.** A **rollup column** computed from the
  notes on the other side of a relation (fifteen functions with a condition that
  uses the same operator grammar as the filters), **column footers** in
  Obsidian's own `summaries` format, **milestones** as a derivation rather than
  a property, **dependencies** in the RFC 9253 format an Obsidian plugin already
  writes, **effort** in minutes and **actual time** read from the calendar
  entries a task blocked. Plus a **project vault template** in all ten languages
  that shows every one of them in operation.
- **The calendar and databases, connected both ways.** Database entries appear
  in the calendar (desktop and phone), an entry can become a real appointment,
  and a `.base` gains a **calendar view** with month, week and day and a
  **timeline view** with periods and edges you can drag — on the phone with your
  finger.
- **A keychain you can see into.** A new surface lists what Plainva has stored
  for this vault, and "forget vault" now takes the account, calendar, mail and
  master-key slots with it. Keychain entries carry readable names
  (`plainva · wiki · Mail · fcb8f9ff`), migrated one at a time: write the new
  name, read it back, and only then delete the old one.
- **The desktop can say "not signed in here."** A mailbox whose password lives
  on another device gets a sign-in row that checks the password against the
  server before storing it; a Microsoft mailbox points at the cloud account
  where its token already is.
- **Your own Dropbox or OneDrive app key on the phone**, which the desktop has
  always accepted. Dropbox's bundled Plainva app has reached its user limit and
  takes no new sign-ins, so this is currently the only way in on mobile.
- **A startup guard.** If the window would otherwise stay blank, an overlay says
  what is missing, in German or English. It runs before the app's modules load,
  catches errors afterwards, and raises the alarm by itself after eight seconds.
- **Windows installers are code-signed** (Azure Trusted Signing).

### Changed

- **The supported floor has a number people can read**: macOS 12 (Monterey) or
  newer with Safari kept current — the requirement that actually decides is
  **Safari 16.4**, because on macOS the engine inside an app arrives with Safari
  rather than with the system. Written into the guide in all ten languages, held
  together across five places by a ratchet, and checked against the built bundle.
- Reading a message marks it read only while it stays open, on both shells.
- A recurring task no longer inherits its predecessor's dependency list, which
  would have left it blocked from birth.

### Fixed

- **A WebDAV server on a non-standard port is no longer refused.** The
  permission scope `http://**` looks like "any http URL" and is not: the pattern
  fills in placeholders for path, query and fragment but *not* for the port, so
  it matched only the default port. Self-hosted servers on `:8080`, `:8082` and
  the like were rejected with "url not allowed on the configured scope".
- **Adding a cloud account on the phone did nothing.** Since 0.6.1.2, and so
  throughout 0.6.2, tapping "Files", "Calendar" or "Mail" after choosing a
  provider opened the sign-in form and closed it again in the same breath: the
  wizard's handler closed itself and opened the target as two operations, and
  closing asks about unsaved input first, so it completed second and took the
  new screen with it. Reported as #47, reproduced on both platforms.
- **An error message that said "Reason:" and nothing else.** Errors crossing
  from the system layer arrive as plain strings; the code asked them for a
  `.message` they do not have, and an undefined value renders as nothing. Six
  places fixed, with a check that fails the build if it returns.
- **A credential is identified by what it is, not by where it was created.** The
  same password could end up in the shared document six times under six names —
  five of them tombstones — so every device thought the others' entries were
  vanished accounts.
- An empty credential slot no longer produces a tombstone that deletes a working
  password on every other device.
- A phone with no profile assignment no longer skips every candidate silently,
  contributing nothing and receiving nothing.
- The secrets transport no longer depends on the calendar runtime: a vault
  without a running calendar never carried a mail password.
- The legacy-format notice no longer blames an absent device for a document that
  belongs to this one.
- An account card without a display name can be merged by hand instead of being
  skipped by the review.
- Switching the settings sync on offers the credential transport instead of
  leaving "never asked" looking like "switched off".

## [0.6.2] — 2026-08-08

The release where the phone stops being a smaller, thinner Plainva. The mobile
app was rebuilt: twenty-four screens became three surfaces, and the twenty
functions that were desktop-only — the import, a calendar you can write to,
mail that can forward and attach, databases you can configure — are there now.
Alongside it, two sync repairs that belong to every device.

### Added

- **A rebuilt mobile app.** Navigator, work surface and context replace
  twenty-four screens and twenty-four sheets. One app bar with one meaning for
  ⋮, a navigation bar you compose from the same shared model as the desktop's
  three bars, one gesture per meaning — a tap opens, a swipe runs the row's
  action — and a command surface that makes the desktop's commands reachable
  without another chrome surface. On a tablet the adaptive layout is literally
  the desktop layout: navigator, work and context side by side.
- **A calendar you can write to on the phone.** Create, edit and delete events,
  recurrence with its rules, attendees and invitations with answers, meeting
  notes, a default calendar and task list selection — plus week and month views
  and one first day of the week shared with the desktop.
- **Mail on the phone, complete.** Reply all, forward, attachments that actually
  send, saving a draft, filtering by unread or flagged, capture as a task or
  `.eml`, and an undoable delete.
- **Import on the phone.** The wizard and all twenty-seven sources, using the
  same writer the desktop uses.
- **Databases you can configure on the phone.** Relations including target,
  cardinality and reverse column, sub-items that nest, a row context menu, the
  peek window, graph as a pickable view type, templates and storage folder, and
  the "this note" filter.
- **The graph, acting instead of only reading.** Pins, focus depth, the age
  heatmap, node and edge menus, the cleanup mode and the `.base` graph brought
  level with the desktop.
- **Attachments, an image viewer and file export on the phone,** so a photo
  pasted into a note is no longer invisible afterwards.
- **Workspace shares managed from the phone,** and the encryption wizards became
  a flow rather than a state.
- **Swipe actions across five kinds of row** — including all three shapes a mail
  row takes in conversation mode, where a swipe means the whole conversation —
  announced once per vault so the gesture is findable.
- **Ticking a task off in the calendar,** on both shells, in all three calendar
  surfaces. Tasks also get the inverse time treatment of events: an overdue task
  is emphasised, a future one dimmed, and a repeating task carries its symbol.

### Changed

- The two dead insert-menu entries on the phone (`/embedbase`, `/newbase`) do
  what they say. The selection toolbar and folding reached the phone as well.
- Pasting and dropping mean the same thing on both shells: an image on the
  clipboard becomes an attachment and an embed, a URL over a selection becomes a
  link.
- The settings on the phone are complete — the four missing areas and twelve
  missing fields are there.
- Sync reports a retry with the wall clock of the next attempt instead of
  turning red on the first failure; the third consecutive temporary failure
  becomes an error.

### Fixed

- **Two names that differ only in spelling no longer collide in Google Drive.**
  Drive resolves name queries case-insensitively, so a push could overwrite the
  other note's content and the following full listing would treat the twin as
  remotely deleted. Byte-exact matching only; ambiguity is reported rather than
  guessed.
- **A pulled note reaches the open editor.** The sync worker set `local_sha256`
  to what it had just written before reporting the paths, so the indexer
  compared equal, no event fired, and the editor's next save overwrote the
  version that had just arrived — and pushed it, without a conflict copy.
- The mobile production bundle mounts again: automatic chunking split
  react-dom's CommonJS wrapper and react-i18next's interop call across two
  chunks that reference each other. The chunk is pinned and a production smoke
  test now guards it.
- A link in the composer renders as a link and opens.
- The mobile navigation bar no longer shakes when you read to the bottom of a
  list, one view no longer shows through another during a change, Today carries
  content again, and Home leads home.

## [0.6.1] — 2026-07-31

### Fixed

- Account settings now converge across desktop and mobile without unchanged
  devices repeatedly uploading a different local representation.
- Google OAuth client registrations and grants stay local to each installation,
  so desktop, Android and iOS can use different clients for the same account.
- Legacy Google credential conflicts no longer block independent IMAP or CalDAV
  app passwords, and account/profile diagnostics report only real transfers.

## [0.6.0] — 2026-07-30

The release where mail stops being a list of individual messages: related
messages group into conversations across folder boundaries, one list can span
every inbox, and a folder you have opened before appears immediately instead of
after a round trip. Alongside it, a sample vault that explains itself, templates
that ask their questions, and the repair of three holes that made two cloud
accounts look incompatible.

### Added

- **Conversations in the mail list.** Messages group by their reference chain
  first, subject only as a fallback and only for a recognisable reply within 30
  days. A conversation reads Sent along with the inbox, so your own replies sit
  where they belong — on both shells.
- **One list across every inbox.** "All inboxes" spans the accounts you choose.
  Every row carries its origin — account and folder — instead of a bare id, and
  every action reads it back: marking, moving and deleting hit the message you
  meant. An IMAP uid is local to its folder *and* to its account; a list that
  forgets where a row came from does not fail loudly, it acts on the wrong
  message.
- **The Plainva tour.** A vault template with nine folders, seven databases and
  about forty linked notes, showing every view once in operation — pinboard,
  calendar, gallery, board, timeline, table and a tree with sub-items — plus
  seven note templates, folder rules, two attachments and a Markdown cheat
  sheet. In all ten languages, and recommended in the chooser.
- **One template engine, with every question in one dialog.** Moment tokens
  (`{{date:DD.MM.YYYY}}`), date arithmetic, `{{daily±N}}` as a wiki link,
  `{{weekday:next friday}}`, `{{selection}}`, `{{clipboard}}`,
  `{{prompt:…|Default}}`, `{{select:…}}` and `{{date_prompt:…}}`. Cancelling
  creates nothing, and an unknown token stays visible so a typo looks like a
  typo.
- **Templates without picking one.** Rule lists map a folder or a note type to a
  template; the longest path wins, a folder beats a type, and an explicit choice
  beats both. The rules live in the settings, travel with the profile, and apply
  on the phone.
- **A signature per sender address,** with the account signature as the default,
  swapped when you change sender — including between two aliases of the same
  account, which the old code did not do even for the account-wide signature.
- **Four calendar states, in every view of both shells.** Cancelled, tentative,
  unanswered and normal are drawn differently instead of looking alike.
- **About 400 curated icons** in ten categories, behind one picker surface that
  looks the same on the desktop and on the phone.
- **Draggable mail columns.** Folder rail, list and reader, with minimum widths
  so the reader cannot be squeezed away; the widths are remembered per vault.
- **A repair for daily notes that inherited their template's settings,** with a
  preview that shows every affected note before anything changes.

### Changed

- **Mail reads the local cache before the network,** not only when the network
  fails — and says "updating" until the server has answered rather than quietly
  implying the list is current.
- **One IMAP session per account instead of one login per command.** Opening a
  folder and reading three messages costs one sign-in instead of four. On the
  phone the session is released when the app goes to the background: a resumed
  connection is dead without saying so, and reusing it would hang the next
  action instead of failing fast.
- **The signature goes above the quoted original,** not inside it.
- **The vault templates demonstrate their method.** PARA grew from 6 to 19
  notes, GTD from 7 to 16, the Zettelkasten from 4 to 11, ACE from 4 to 7,
  Johnny.Decimal from 2 to 5 and the journal from 2 to 4 — boards that have
  cards in them, databases whose views open onto something.
- **A pinned tab stays pinned,** and the special views survive a restart.
- **The graph draws a note's icon** instead of writing its name.

### Fixed

- **A Google Drive vault came up local.** The readiness check demanded a
  per-service refresh token, which an account connected through the union
  consent deliberately keeps empty. Exactly those accounts were declared "not
  ready": no sync target was built, the file sync was silently off, and mail
  fell back to its offline copy.
- **A calendar could be handed another account's token.** The broker lookup
  asked for "a calendar token for this vault" rather than for which account.
  With one account that worked by accident; with two, the Microsoft calendar
  answered 401.
- **Adding an Outlook account broke the Google calendar.** The pending marker of
  a connect outlived it and then answered for everything in the vault, handing
  Google a Microsoft token — which reads exactly like a revoked sign-in and
  cannot be fixed by signing in again. Deleting the Outlook account made it work
  again, which is why the two looked incompatible.
- **The worker skipped accounts whose sign-in is the shared one,** every cycle,
  in silence: no target, no request, no error, and an empty calendar list that
  read like an account with nothing in it.
- **Google now records the scope it was granted** rather than the one that was
  asked for, so a partial grant is no longer invisible.
- **A cancelled Outlook event was dropped on import** and simply vanished from
  the calendar instead of showing up as cancelled.
- **Gallery covers stored in the vault** were never rendered — the view only
  handled `https://` URLs, which made it unusable with local images.
- **A daily note built from a template inherited the template's own frontmatter**
  and hid itself from the task overview.
- **Renaming or deleting a property left the per-view filters untouched.**
- **The settings sync no longer overwrites this device's accounts,** and the
  settings toast is shown once instead of on every exchange.
- **The mail cache lets go of messages that are gone,** and deleting a calendar
  account leaves nothing behind.

## [0.5.2] — 2026-07-29

The release that makes moving in possible: **27 apps** can now be imported
instead of six, attachments arrive at all, and dates come from the source
rather than from today. Alongside it, the sync stopped being a black box — one
catalog decides what travels, and both shells say what the last run did.

### Added

- **Import from 27 apps.** Notion (through the API and from a file export),
  Evernote, Google Keep, Logseq, Simplenote, a generic Markdown folder, ten
  more Markdown-family apps (Joplin, Bear, Notesnook, Capacities, Amplenote,
  Supernotes, Heptabase, UpNote, Craft, Anytype), Standard Notes, the OPML
  outliners (Workflowy, Dynalist), Trilium, Roam, Reflect, TiddlyWiki, Tana,
  RemNote — and an HTML folder importer that reads a Confluence space export
  and rewrites the links between its pages.
- **A native unpacker, so attachments can arrive at all.** The previous
  JavaScript unpacker read text extensions only and silently discarded every
  image, PDF and attachment in an archive. Unpacking now streams through Rust,
  with hard limits against zip bombs and symlink entries skipped.
- **Real timestamps.** Created and modified dates come from the export instead
  of "everything today", so recents, the heatmap and every date sort mean
  something after a move.
- **An import wizard.** It asks for the export first and decides beside the
  numbers: auto-detection of the source, one target as a radio group (a new
  vault or a subfolder of the open one — never both), per-source options, a
  running count and a cancel button. Reachable before a vault exists.
- **A welcome screen** that ends in a decision — open a vault, create one, or
  import — instead of a modal in front of the splash.
- **One folder for attachments,** set per vault under Content & structure,
  shared by drag & drop, paste and the camera. It travels with the settings
  sync.
- **An inbox folder on the desktop.** The folder is a property of the vault,
  and a vault is usually set up at a desk.
- **One catalog of syncable settings.** `PROFILE_FIELDS` decides for both
  shells what the settings sync carries; where a shell has no field for an
  entry it must say why, and a test fails on a missing reason.
- **The sync says what it did.** Both surfaces name the last run and which of
  the three silent states a device is in — not switched on, locked, or no
  provider. Bookmarks now travel too.
- **One sign-in per Google account.** Files, calendar and tasks share one token
  through the broker instead of a copy per service; one renewal brings all
  three back, and the union consent is available on the phone as well.
- **Tasks on the phone, at full parity** — both sections, filters, promotion,
  "+ New task", the status menu, repetition and blocking time.

### Changed

- **Attachments land in the configured folder.** For existing vaults this
  changes where new files go, deliberately and **without a migration**: files
  already filed stay where they are and keep working. Emptying the setting
  restores the old behaviour.
- **The app stopped explaining unprompted.** The one modal that appeared on its
  own is gone; a format violation now announces itself as a toast with a button
  that opens the setting.
- **In-app help links point at plainva.com** instead of GitHub — the guide now
  exists there in ten languages.
- **The calendar names the real reason** when an account stops working, and
  offers the fix, instead of failing quietly.

### Fixed

- **Mail on iPhone works at all again.** The socket plugin was the only one of
  five without a `CAPBridgedPlugin` contract, so the platform could not see it.
- **A second note for the same day.** The phone hard-coded the ISO filename of
  the daily note, so a vault using any other format got a duplicate as soon as
  the phone touched that day.
- **A contradicting second `type`.** The mobile note builder wrote `type` into
  OKF frontmatter unconditionally, including into templates that carried their
  own.
- **Notion attachments never arrived** — and the report claimed complete
  success, which was the one dishonest place in the system. They are downloaded
  now, the API is paced and no longer fetched twice, and CSV exports are read.
- **A broken entry no longer costs the whole run.** Import is fault-tolerant per
  entry, and the report is written even when something failed.
- **Google Keep no longer imports the trash** by default.
- The mail signature is composed in the editor that will send it.

### Documentation

- The user guide states correctly that Plainva does **not** renew Google tokens
  in the background: under the "Testing" consent status they expire with it.
  Corrected in all ten languages.
- plainva.com now carries the whole guide in ten languages — **220 pages**
  instead of 44 — plus the landing page, the legal pages and the switch pages.

## [0.5.1] — 2026-07-28

A consolidation release: **one sign-in per cloud account** instead of one per
service, **one place to arrange every bar and sidebar**, and a set of sync
repairs that put settings and accounts back on all your devices. Tasks learned
to repeat, mail learned signatures, and the phone gained a full mail client.

### Added

- **One sign-in per cloud account.** A Microsoft account consents **once**, and
  files, calendar and mail share that sign-in through a shared, audience-scoped
  token broker — it used to be three consents and three refresh tokens. Google
  covers files and calendar in one. A rotated app password (Nextcloud, Fastmail,
  mailbox.org …) is entered once under **Credentials** and reaches every service
  of the account. Existing accounts are offered a one-time **"one login for all
  services"** migration; the previous per-service path keeps working.
- **Bars and areas, arranged by you.** A new settings area orders all four bars —
  the action bar, both sidebars and the mobile navigation bar — one list each,
  visible above the line, hidden below. In the app you sort by **holding** an
  item rather than by a drag handle; right-click offers the same actions. Stored
  **per vault**, inheriting from a global default.
- **Pinned tabs and a sortable action bar.** Pinned tabs move to the front, carry
  a pin instead of a close button, and survive "close all". Two new action-bar
  entries: **New folder** and **New database**.
- **The Databases sidebar section is an entry inspector.** It renders the open
  note the way its database sees it — the columns of the first view, in order,
  with types and option colours, editable through the same cell layer as the
  table — plus its position ("12 / 34"), a step to the neighbour, and expandable
  sub-items.
- **Repeating tasks.** A task can carry a repeat rule in its own frontmatter
  (`plainva.repeat`); ticking it off creates the next one. Monthly arithmetic
  clamps to the end of the month, and mirrored provider tasks are not offered a
  repeat.
- **Block time for a task.** The calendar icon on a task row creates a linked
  event (date prefilled, duration 15/30/60/120 or custom) instead of teaching a
  deliberately day-granular task about clocks.
- **Mail signatures and sender addresses.** A signature per mailbox, swapped
  rather than stacked when the sender changes; the sender menu lists **addresses**
  across all accounts, as chips.
- **Mail offline.** The inbox writes its first page to a cache after every
  success and falls back to it on failure, with a banner saying it is a stored
  copy.
- **Row actions in database views.** Open, open in split, rename, duplicate and
  delete (through the cascade dialog) from any `.base` view, plus **+ New task**
  and cleanup of a storage folder the deletion just emptied.
- **Right-click in the pinned lists.** *Recently opened* and *Bookmarks* carry
  the file context menu, including *Reveal in file tree* and *Remove from list*.
- **Read the vault again.** A circular arrow in the file tree header, **F5**, the
  command palette and the folder context menu re-read the vault and report what
  was skipped.

### Changed

- **A narrow sidebar degrades in three named steps** instead of clipping; the
  right sidebar has a floor of 200 px.
- **The settings profile merges per field** with tombstones, and personal data —
  accounts, bookmarks, bars — lives per member rather than in the shared
  document. Two people in one vault no longer overwrite each other's settings.
- **Content & structure** is ordered the way it reads: templates folder, then
  daily notes with their template, then tasks.
- **Folders reached through a symlink or junction are now walked.** They could
  never be indexed before, which is why restarting never helped.

### Fixed

- **Settings and accounts converge again.** The profile sync had split into a
  plaintext and a sealed file that never saw each other: an unlocked device wrote
  `settings.enc` and deleted the plaintext one, a locked device wrote
  `settings.json`. A locked device now waits instead of writing a second truth,
  and a left-over plaintext file is read, merged and cleaned up.
- **A deleted folder stays deleted.** Since empty-folder sync landed, every full
  listing recreated any remote folder missing locally — including one whose
  deletion was still queued. (#34)
- **iCloud reminder lists are task lists.** A CalDAV collection holding only
  to-dos was treated as a calendar, so reminder lists appeared among the
  calendars and the **Task lists** section rendered empty; the check that should
  have caught it could never work, because the component names live in XML
  attributes the parser had been told to ignore. Account errors now show on the
  account. (#34)
- **A vanished file is a state, not a note.** The editor used to write the read
  error into the note buffer, from where autosave could have written it to disk.
- **Month cells open what you clicked** — an event row opens the dialog, a task
  row the note, empty space the day.
- **A Microsoft mailbox no longer stalls the account import.** An empty host is
  normal for Graph but failed the profile validator, which aborted the entire
  import every cycle, silently.
- The database create wizard is styled wherever it opens, and the handbook no
  longer claims that step 1 of sync setup needs a passphrase.

### Upgrade notes

- **If you use the sync passphrase, unlock every device once.** A locked device
  no longer writes to the shared profile — deliberate, and what stopped the two
  files from fighting. Afterwards `.plainva/sync/` holds only `keyfile.json` and
  `settings.enc`.
- **Encrypted workspaces remain experimental** and have not been independently
  reviewed. Keep backups.
- Bar arrangements from earlier versions migrate once; the two new action-bar
  buttons are inserted next to the action they belong to, so they arrive visible
  rather than hidden.

## [0.5.0] — 2026-07-25

The biggest release so far. It adds a way **in** — import your notes from Notion,
Evernote, Google Keep, Simplenote, Logseq or a Markdown folder — and a first,
**experimental** take on **encrypted workspaces** you can share across devices.
Deleting finally understands connections, calendar and email got the interaction
polish they were missing, and the mobile app can set up encryption on its own.
Still plain Markdown, still your files: existing vaults and `.base` files are
untouched.

### Added

- **Import from another app.** An import wizard (command palette, or right-click
  a folder in the file tree) brings notes into the vault you have open, in a
  subfolder you name. Six sources: **Notion**, **Evernote (ENEX)**, **Google Keep
  (Takeout)**, **Simplenote**, **Logseq** and any **Markdown folder or ZIP**.
  Nothing in the vault is ever overwritten — a colliding name is numbered instead.
  Every run writes an import report listing what came across, what arrived
  incompletely, and what the importer cannot carry over at all.
- **Notion in depth.** With an integration token Plainva walks the workspace:
  page hierarchy becomes folders, **databases become `.base` files** with one note
  per row, **relations become wiki links**, and 21 property types are mapped.
  Inline databases render as live `![[…]]` embeds, and table/board/calendar/list
  views are generated from the schema. A file-based path (ZIP export) works
  offline; it brings pages across, but not database contents.
- **Encrypted workspaces (experimental).** A vault can become an end-to-end
  encrypted workspace shared across your devices: QR pairing, a printed recovery
  code, device revocation, key rotation, published slices, and clean teardown
  ("lift encryption" re-uploads plaintext to the same cloud folder).
  **Not yet independently reviewed** — treat it as a preview and keep backups.
- **Settings sync (opt-in).** Per-vault settings — daily notes, templates, task
  database, backup retention — travel between your devices through a sideband
  file in the vault. No credentials and no device-specific paths are included.
- **Delete with its connections.** Deleting a note or a `.base` shows what hangs
  off it — assigned items, database entries, linked databases — and lets you
  decide group by group, with per-item control. Shared and multi-database entries
  are excluded by default, and references in surviving notes are cleaned up.
- **Calendar and email interaction.** Right-click menus on events (edit, colour,
  RSVP, block in other calendars, delete), right-click and **multi-select** in the
  mail list with bulk actions, an unread filter, and a **live-preview Markdown
  editor** for mail bodies and event descriptions.
- **Release highlights.** After an update, Plainva shows what changed; newcomers
  get a short welcome instead. Both can be reopened from Settings.

### Changed

- Multi-line selections now apply inline Markdown formatting per logical line,
  preserving headings, quotes, list markers and task checkboxes. Headings and
  tasks stay compatible block types instead of producing invalid hybrid syntax.
- The right sidebar remembers one global note preference while empty contextual
  sections and full-surface views close only temporarily.
- Opening an encrypted vault no longer blocks on re-hashing every file; an mtime
  probe cache skips files that have not changed.
- Mobile: per-vault isolation for folder and backup settings, readable system
  bars with edge-to-edge layout, safe-area insets, automatic keyboard handling,
  larger touch targets and translated accessibility labels.

### Fixed

- Checking a task in the Tasks overview now reindexes its source note before the
  list refreshes, so a completed task no longer disappears briefly and returns.
- Sync errors keep the original provider failure visible across automatic retries;
  successful recovery is shown explicitly and reconnect is suggested only for
  authentication failures. Google Drive HTTP failures now retain API details even
  when the WebView supplies an empty status text.
- Deleting a folder or file that is already gone remotely counts as success, so a
  stale row can be cleared from the tree.
- Unresolved `[[links]]` show a single dashed underline instead of two overlapping
  ones.
- The encryption area now reports the real state of a vault (local, unencrypted
  cloud, encrypted, or unknown) instead of claiming every vault is encrypted.
- Android: the camera permission was missing, so the QR scanner never received an
  image. The calendar tab no longer applies the safe-area inset twice, and the
  settings gear is reachable again.
- Mobile no longer fails to start when a Google Drive token has expired.

## [0.4.1] — 2026-07-21

Everything since 0.4.0 gathered up: all your cloud logins in one **Cloud accounts**
area, a much larger **mail provider catalog** (Apple/iCloud, mailbox.org, Fastmail,
Yahoo, Zoho, Yandex and ~46 more), sturdier mail plumbing, and a top-to-bottom
**design-language** pass that makes the whole app calmer and more consistent.
Calendar and email keep maturing but remain experimental. Still plain Markdown,
still your files — no format changes; existing vaults and `.base` files are
untouched.

### Added

- **Cloud accounts.** A new first Settings area gathers every cloud login for a
  vault in one place. A provider → services → sign-in wizard connects files,
  calendar and mail per provider, with per-service status and a clear files-only
  note. The service pages (Sync, Calendar, Email) become slim references to the
  account and only appear once a service is actually connected; the ribbon buttons
  gate the same way. Mobile gets the overview too.
- **Provider catalog for mail (and more).** 17 wizard tiles with search, plus
  dedicated app-password suites for **Apple/iCloud, mailbox.org, Fastmail, Yahoo,
  AOL, Zoho, Yandex, Mail.ru, Koofr and pCloud** — files, calendar and mail from a
  single form. ~46 verified international IMAP presets are auto-detected from your
  address, each with a setup hint and a link to the provider's own guide. The Apple
  tile sets up iCloud Mail and iCloud Calendar together; iCloud Drive stays out
  (Apple offers no third-party API for it, and the tile says so).
- **STARTTLS + Proton Bridge transport.** IMAP/SMTP can use STARTTLS on non-993
  ports, with a loopback-scoped certificate exception so the Proton Mail Bridge
  (127.0.0.1) works while every real server still verifies strictly.
- **Server-side mail search** returns matches from the whole mailbox, not just the
  messages already loaded.
- **Sidebar sections.** Bookmarks and recently-opened notes are now collapsible,
  reorderable sections above the file tree.
- **Copy / Save images.** Right-click an image in a note to copy it or save it — in
  both live preview and reading mode.

### Changed

- **One design language across the whole app.** A full sweep puts desktop, mobile
  and every theme on one governed set of tokens and primitives: consistent field and
  chip metrics, themed Select panels, clearer menus and selection states, and
  WCAG-AA contrast throughout.
- **Calendar polish.** Rich Markdown event descriptions (read from the full body),
  move a single event to another calendar, a default calendar for new events,
  standards-compliant HTML invitations, and faster, more autonomous background sync.
- **Delimiter-aware mail folders + SEARCH CHARSET**, so folders like
  "mailbox.org Rechnungen" stay whole and non-ASCII search works on strict servers.
- **macOS builds are now signed and notarized** (Developer ID). Windows installers
  stay unsigned for now (first run: "More info" → "Run anyway").

### Fixed

- All-day calendar labels no longer wrap mid-word; untitled events show a placeholder.
- The `plainva` frontmatter namespace no longer shows up in `.base` property settings.
- Pinboard card order is stable across re-index.
- Clearer Google Drive sync errors; throttled foreground sync and newest-first
  ordering on mobile.
- Microsoft mail: folders addressed by role rather than the literal name "INBOX",
  the mailbox bound to its account so a switch can't load a foreign folder, and
  calendar/mail token calls routed through the Origin-free relay.

## [0.4.0] — 2026-07-19

The biggest release since 0.3.0: a new view type (the **Pinboard**), a completely
reorganized **Settings** experience, and two large new areas — **Calendar** and
**Email** — that ship as **experimental**. Still plain Markdown, still your files,
no format changes; existing vaults and `.base` files are untouched.

### Added

- **Pinboard view.** An eighth `.base` view type, in the spirit of Google Keep.
  Cards show the rendered note (text, lists, clickable checkboxes, images) in
  masonry columns with **Pinned** and **Others** sections, drag to arrange, a
  **quick-capture** field (title becomes the file name and H1), **label chips**
  (from tags or a multi-select property), and a per-card colour driven by the
  note's header colour. Ticked properties appear on the cards. It stores as
  `type: table` + `views[i].plainva.render: "pinboard"`, so Obsidian opens it as
  a plain table. Desktop and mobile.
- **Standard task database + checkbox promotion.** Point Plainva at a default
  task database (pick an existing `.base` or create one in a click), then
  **promote** a checkbox from any note into a task note — carrying its status,
  due date, tags and a link back to where it came from — while the original line
  becomes a wiki link. The Tasks view gains a two-section overview.
- **Calendar (experimental).** A calendar tab with a proper time grid
  (Day / 3-day / Week / Month / Agenda), click-to-create and drag-for-duration,
  drag existing events to reschedule or resize, Outlook-style recurring events,
  attendee chips with RSVP, per-event colours, a default calendar, "busy" blocks
  in other calendars, and standards-compliant email invitations. Accounts:
  **CalDAV, Google and Microsoft**, two-way. There's a mobile calendar too
  (Day / 3-day / Agenda), and selected task lists sync into your task database.
- **Email (experimental).** A three-pane mail client. Read over **IMAP**
  (read-only capture) or **Microsoft via Graph** (direct sign-in), with folders,
  flags, move, delete and search; compose with labelled **From / To / Cc / Bcc**
  chip rows and send over SMTP or Graph; reply, reply-all and forward; turn a
  message into a note or a task, and email a note straight from its `⋮` menu.
  Remote content is blocked by default in a sandboxed viewer (images are opt-in).
- **Create a note from an unresolved wiki link.** A `[[link]]` to a note that
  doesn't exist yet shows dimmed and dashed (in both live preview and reading
  mode); clicking it creates the note (its title becomes the H1) and opens it —
  matching Obsidian. A new "ask before creating empty links" setting is optional.

### Changed

- **Redesigned settings.** On the desktop, each navigation entry now opens its
  own page built from named "quiet cards", with a vault identity card instead of
  a dropdown and one window sized to its tallest page. On mobile, the tab bar is
  three freely arrangeable tabs plus a fixed **More**, **＋** is a floating
  action button, **⋮** opens Settings directly, and Settings is a master–detail
  layout with its own Vaults screen.
- **Redesigned `.base` configuration menu.** The config panel is now a tabbed
  panel beside the live view — View / Columns / Filter / Sort / Data source, one
  area at a time — with an icon-tile view-type picker, a visible/hidden column
  split with type badges, readable filter chip-sentences, and the same
  quiet-card look. Mobile mirrors it as master–detail. Pure presentation; no
  `.base` format change, Obsidian compatibility untouched.
- **Type-appropriate `.base` selectors.** View-specific pickers now only offer
  properties of a fitting type (a date field offers date properties, board
  grouping offers select/status/multi-select/relation, a gallery cover offers
  text/URL). The graph "Properties" tab is disabled where it doesn't apply.
- **Empty folders sync in both directions.** A freshly created empty folder is
  now pushed to and pulled from the cloud (all five providers).
- **Browsable folder pickers everywhere.** Choosing a folder (data source,
  storage location, move target) browses the live file system instead of an
  index-backed dropdown — so a just-created empty folder is selectable too.
- **Signed macOS builds.** macOS installers are now signed with a Developer ID.
  (Notarization will follow separately; for now, right-click → Open on the first
  launch on macOS.)
- **Consistent mail & calendar design.** Address chips, view segments and the
  floating compose/preview windows now share the app's central primitives.

### Fixed

- Reading-mode wiki links with parentheses in the target render again.
- Note properties show in a `.base` regardless of the key's casing.

## [0.3.1] — 2026-07-17

A maintenance release: a new template-to-database workflow, a sync data-safety
fix that also benefits the desktop, and a batch of mobile polish. No format
changes; existing vaults and `.base` files are untouched.

### Added

- **Assign templates to databases.** A template can now say which databases it
  belongs to with `plainva.templateFor` in its frontmatter. Assigned templates
  appear directly in that database's **Entry** menu — with quick-assign and a
  **Target databases…** dialog to manage the links — while unassigned templates
  stay reachable under **Show all templates**. Renaming a `.base` carries its
  template assignments along with it (as it already does for body links and
  embeds). The marker lives in the file, so the assignment travels with the
  vault and stays visible in Obsidian.

### Fixed

- **No more spurious `.CONFLICT` files.** Sync could mistake one of its own
  echoed pushes for a remote change and write a `.CONFLICT` copy next to an
  otherwise untouched note; it no longer does (desktop and mobile).
- **Clearer virtual tabs.** The Graph and Tasks tabs now show their localized
  names and dedicated icons in the recents strip, the tab strips and the quick
  switcher, instead of a raw internal path.
- **Mobile sync is responsive again.** Syncing no longer freezes the app; it
  stays interactive throughout a cycle.
- **More native mobile editing.** Text selection uses the platform's own
  handles, and the virtual keyboard behaves more predictably while you edit.
- **Mobile note details.** A button in the note header opens the context sheet
  directly, and the bookmark icon is now consistent across the app.

## [0.3.0] — 2026-07-15

A feature release: a whole new Tasks view, a redesigned graph with a recursive
folder map, a big keyboard-shortcut expansion with a new F1 help window,
vault-wide find & replace, and creating a vault directly in the cloud — plus
fixes from user reports (#13). No format changes; existing vaults and `.base`
files are untouched.

### Added

- **Tasks view.** A virtual tab collects every checkbox across the whole vault,
  grouped by note, with status / text / folder / tag / due filters. The task
  text renders inline markdown, and a note (for example a template) can keep
  itself out of the list with `plainva.tasks: false` in its frontmatter — the
  marker lives in the file, not a hidden app registry.
- **A rebuilt keyboard-shortcut system and a new F1 help window.** A large set
  of new editor and global shortcuts — bold/italic/strikethrough/highlight,
  headings, new note, read/edit and source toggles, tab management, day note and
  more — plus an F1 window that lists them by area with search, mouse and gesture
  help, and automatic OS detection (⌘/⌥ vs Ctrl/Alt) (#13).
- **Vault-wide find & replace** (`Mod+Shift+F`) with a per-note preview and
  regex support, and **renaming a tag across the whole vault** from the Tags
  sidebar.
- **Create a new vault directly on a cloud provider** (Google Drive, OneDrive,
  Dropbox, S3 or WebDAV) with a structure template. The start screen now opens
  with two buttons (Open / New) and a place step, and the cloud folder pickers
  gained a "New folder" row.
- **Syntax highlighting in the reading view.** Fenced code blocks with a
  language are colorized in the reading view too — not just the live editor —
  with language-aware highlighting (CSS, HTML, JavaScript and many more), loaded
  on demand (#13).
- **Delete key in the file tree.** With one or more items selected, `Delete`
  moves the selection to the trash — macOS also honours `⌘`+Backspace — through
  the same confirmation as the right-click menu (#13).
- **Automation & scripting guide** in the user handbook, describing how scripts,
  the command line or AI agents can read and write a vault safely through plain
  files and the open format.

### Changed

- **The graph was redesigned** across the context graph, vault map and `.base`
  graph: an overlap-free layout, node sizes that reflect how connected each note
  is, focus bloom, curved flow edges with arrowheads and subtle motion. Alt+drag
  moves a node together with its linked neighbours, `index.md`/`log.md` are
  hidden by default (with a reveal toggle), and the vault map now packs folders
  recursively into nested circles — the camera follows the folder you open.
- **The update-install toast stays up** until the app relaunches (or an error),
  instead of disappearing after five seconds.
- **Faster cold indexing.** The initial vault index writes each chunk as a
  single atomic transactional batch instead of one statement per row.

### Fixed

- **Selecting a group of files and deleting works on macOS.** `Ctrl`+click was
  treated as a selection toggle on every platform, but on macOS it is the system
  right-click, so it changed the selection the moment the context menu opened and
  the bulk delete never acted on the whole group. The tree's multi-select toggle
  is now `⌘` on macOS and `Ctrl` on Windows/Linux (#13).
- **The vault find & replace dialog** is wider and no longer shows a stray
  divider above an empty result list.
- **Security hardening** (CodeQL): full Drive-query and SQL `LIKE` escaping, a
  gallery cover-image scheme guard, and safer hrefs and token-host checks.

### Mobile (unreleased test builds)

- **Note links are tappable again.** Links were resolved by mapping the tap
  coordinates back to a document offset, which mis-resolved most links on touch
  WebViews while the odd one worked; the target now rides on the link element
  and is read straight off the tap. Markdown relative links — including
  generated `index.md` listing links — resolve too, and external table/embed
  links open through the system browser.

## [0.2.3] — 2026-07-13

A follow-up release with sidebar and editor refinements, plus fixes from user
reports (#9, #11).

### Added

- **Recently opened notes.** A strip above the file tree keeps your last few
  notes one click away (#3).
- **Databases tab.** A fourth view in the left sidebar (next to Files, Tags and
  Bookmarks) lists every `.base` in the vault, grouped by folder — click one to
  open it.
- **Vault icon** next to the vault name in the file-tree header.
- **The update notice is actionable.** When an update is available, the toast
  now carries an **Install now & Restart** button that installs it directly.

### Changed

- **`index.md` sorts to the top of its folder** — below the sub-folders and
  above the other files — instead of alphabetically among them (#9).
- **Faster renames.** Renaming a file now reindexes only the affected paths
  instead of the whole vault, so the sidebar updates without the lag (#9).

### Fixed

- **Markdown links no longer over-reach in the live preview.** A `[…]` before a
  real `[text](url)` link on the same line — such as a footnote marker `[^1]` —
  is no longer pulled into the link; the styling and the click target now stop
  at the actual link. The reading view was already correct (#11).
- **No stray grey background** on the calendar day cells in dark mode.
- **Generated `index.md` sub-folder links** point at the sub-folder's own
  `index.md`, so opening one in Obsidian no longer creates an empty note (#9).

## [0.2.2] — 2026-07-12

A polish release: a batch of editor, sidebar and sync-settings refinements.

### Added

- **Rich-text copy.** Copying from the live preview now also places HTML on the
  clipboard, so pasting into Google Docs, Word or other rich-text targets keeps
  the formatting (bold, headings, lists, links, …); plain-text targets still get
  clean text (#1).
- **Daily-note template picker.** When a template folder is set, the daily-note
  template is chosen from a dropdown of that folder's files instead of typing the
  file name (#4).

### Changed

- **The sidebar remembers its shape.** The file tree keeps its expanded folders
  when you switch to the Tags or Bookmarks tab and back — no more collapsing and
  jumping around (#3).
- **The cloud folder is picker-only.** For a connected Google Drive / OneDrive /
  Dropbox vault, the sync folder is set through the folder picker and can no
  longer be changed by typing a path, so a synced vault can't be re-pointed by
  accident (#2).

### Fixed

- **Graph suggestions link live.** Accepting a link suggestion in the context
  graph now shows the `[[link]]` in the open note immediately, without reopening
  it (#6).
- **A narrow sidebar no longer squashes folder icons.** Folder rows keep their
  icon size when the sidebar is made very narrow; only the label truncates (#5).
- **The content font applies instantly.** A changed content font or size now
  takes effect the moment you pick it, even if saving the setting is slow (#7).

## [0.2.1] — 2026-07-11

A small follow-up to 0.2.0, driven by the first macOS user reports on the new
print path.

### Fixed

- **Print margins on macOS.** The native macOS print path produced pages with
  no margins at all, because it honours only CSS `@page` margins (unlike the
  Windows/Linux print dialog, which adds defaults). Printed pages and PDFs now
  have proper margins on every platform (#6).

### Added

- **Open in default app** in the editor's ⋮ menu: hands the current note to the
  app your system uses for Markdown files (Byword, MacDown, VS Code and so on).
  Since notes are plain `.md` files, this is a natural fit — and Plainva keeps
  watching the file, so edits made in the other editor flow back automatically
  (#6).

## [0.2.0] — 2026-07-11

The first big update after launch, driven by the first external user reports
(thank you!) and a deep review pass: crash-safe file writes, a sturdier sync
engine, a reorganized settings dialog and the most-requested customization
options. No format changes; existing vaults and `.base` files are untouched.

### Fixed

- **Printing on macOS.** `window.print()` is silently ignored by the macOS
  WebView, so *Print / Save as PDF* never worked there (#6). macOS now goes
  through a native print path; Windows and Linux are unchanged.
- The README no longer claims OneDrive and Dropbox need your own app
  registration — they work out of the box; only Google Drive is BYO.

### Added

- **Content font size and font family** (Settings → App → Editor & notes):
  scale the editor and reading view from 12–24 px and pick serif, sans-serif,
  monospace or any installed font — the interface itself stays unchanged (#5).
- **Interface zoom** (80–150 %): scales the whole window via
  `Ctrl/Cmd+Plus/Minus`, `Ctrl/Cmd+0` resets (#5).
- **Export as Markdown…** in the editor menu and command palette saves a copy
  of the note anywhere; PDF export continues via *Print / Save as PDF* (#6).
- **Create templates from the command palette**: *Create new template* and
  *Save current note as template* (#6).
- **Draft recovery.** While you type, Plainva journals the unsaved buffer;
  after a crash or failed save, reopening the note offers to restore the
  draft.
- **In-vault folder pickers** for the daily-notes and template folders: a
  folder button next to each field browses the vault instead of typing the
  path.
- **Pending-transfer view** (Settings → Vault → Sync) shows what is still
  queued for the cloud, and a **Rebuild index** button covers stale
  search/backlinks.
- **Focus mode** command collapses both sidebars and restores the layout on
  the next invocation. The right sidebar now remembers its visibility per
  view (notes, databases, vault map — the map starts collapsed), and the
  vault map's filters moved into a compact popover with an active-count badge.
- **Performance metrics** (Settings → About & diagnostics): local
  median/p95 timings of index, search and typing latency with a JSON export —
  nothing leaves the device.

### Changed

- **The settings dialog is reorganized into two worlds.** The left rail now
  shows the app-wide areas (Appearance, Editor & notes, Startup & behavior,
  Updates, About & diagnostics) and the vault areas (Sync, Content &
  structure, Backup & version history, Maintenance) at once, with a dropdown
  picking the vault — no more one nav row per vault. Three settings moved to
  where they belong: auto-open last vault (startup, not appearance), vault
  statistics (per vault, not global) and rebuild index (maintenance, not
  sync). Nothing was removed and no setting changed behavior.
- **Every note write is atomic now** (temp file + fsync + rename, desktop and
  Android): a crash, full disk or network-share drop can no longer leave a
  torn or half-written note.
- **Sync got tougher**: rate-limit (429) handling with Retry-After across all
  providers, token refreshes no longer stampede (single-flight; rotated
  OneDrive/Dropbox tokens are persisted before the cycle continues), and
  first syncs download several files in parallel within a memory budget while
  writes stay strictly ordered.
- Mobile (unreleased test builds): saves go through a coordinator that
  retries failures and survives leaving the editor; OAuth sign-ins survive
  Android killing the app mid-consent; the native HTTP bridge only talks to
  configured servers; Android backups now include the local vault but never
  credentials or rebuildable indexes.

## [0.1.2] — 2026-07-10

A maintenance release shaped by daily use against real, cloud-synced vaults:
sync data-safety fixes, a more capable graph, and small editor and file-tree
conveniences. No format changes; existing vaults and `.base` files are untouched.

### Added

- **Graph gestures and pin mode.** Pan with the middle mouse button or
  Ctrl/Cmd-drag (even over a node). On the vault map an empty-space drag draws a
  selection lasso, and dragging a selected node moves the whole selection. A pin
  needle in all three graph views toggles whether moved positions are remembered
  (on, the default) or the force layout takes over again (off).
- **Context-graph suggestions link the matching passage inline**, with a preview
  of the exact text that will be linked — instead of always appending the link
  at the end of the note.
- **"Reveal in file tree"** in the editor's ⋮ menu.
- **One-click "collapse / expand all folders"** toggle in the sidebar.
- **"Forget app data"** when removing a vault from the splash screen — clears the
  per-vault index, settings and stored sync credentials (your files stay).

### Fixed

- **No more spurious `.CONFLICT` files** from a race between autosave and the
  sync push.
- **In-app folder deletions now reach the cloud**, with a second confirmation
  when a deletion would remove a large share of your files.
- **Abandoning a browser OAuth login no longer freezes the app** (Google Drive,
  OneDrive, Dropbox); reconnecting works immediately afterward.
- **The context graph remembers moved node positions**, and the `.base` graph
  view no longer jumps when you drag a node.
- **Manually typed `[[links]]` update the graph and backlinks immediately** (no
  restart), and picking a link suggestion no longer inserts a doubled `]]`.
- **The first titlebar tab now lines up with the document surface.**

### Changed

- **Internal groundwork for the mobile app** — shared UI primitives, i18n,
  design tokens/themes and platform-neutral settings/secrets interfaces moved
  into a new `@plainva/ui` package. No change to desktop behavior.

## [0.1.1] — 2026-07-09

A follow-up release focused on sync data-safety and performance, from running
Plainva against real, cloud-synced vaults. No format changes; existing vaults
and `.base` files are untouched.

### Fixed

- **Sync no longer overwrites a newer remote file without a conflict copy.** A
  pending local write no longer short-circuits reconciliation; genuine conflicts
  are kept as `.CONFLICT`, and when a note is open in the editor the draft is
  saved as `.CONFLICT` while the newer external version is loaded.
- **`.plainva/` and `.CONFLICT` paths are never pulled** — protects the local
  index database from corruption when the same folder is also mirrored by a
  cloud desktop client.
- **The file tree updates after the first sync without a restart** — pull
  notifications are now chunked and loss-proof, and externally deleted folders
  are detected.
- **Copy in live preview yields plain text** (Markdown markers are stripped);
  the source view still copies raw.
- **Option colors are selectable again** — the column editor is seeded with the
  values already in use.

### Added

- **Mass-deletion guard** — if a sync would remove more than a small share of
  your synced files, Plainva pauses all remote deletions and asks you to confirm
  before anything is deleted in the cloud (writes and renames keep flowing).
- **Kanban column color mode** — tint the whole column with the status color, or
  keep just the chip (per view).
- **"Create missing index.md in all folders"** button, plus much faster bulk OKF
  conversion.
- **Live sync progress** ("Sync x/y") in the status bar and a one-time
  first-connect notice for large vaults.

### Performance

- **Incremental delta pull** for Google Drive, OneDrive and Dropbox — far fewer
  full listings per sync cycle.
- **Faster saves on network drives** — the index database now lives in app-data,
  and OKF conversion runs concurrently.
- **No app-wide re-render or file-tree rebuild on plain prose edits**, a
  parallelized startup directory walk, and a more robust index-database
  migration.

## [0.1.0] — Initial public release

Released 2026-07-08.

The first public build of Plainva — a local-first Markdown vault editor for
Windows, macOS and Linux. It opens existing Obsidian vaults without migration,
and every file it writes stays readable in any text editor.

> **Beta, pre-1.0.** Keep backups of irreplaceable vaults. Plainva also creates
> local per-file snapshots and daily ZIP backups by default.

### Added

- **Markdown editor** — live preview (Obsidian- or Notion-style syntax display),
  slash menu, tables with inline cell editing, callouts, wiki links with fuzzy
  autocomplete, block drag handles, math (KaTeX), Mermaid diagrams, footnotes,
  emoji via `/emoji` and `:name`, clickable task checkboxes in read mode, and
  print / PDF export.
- **Databases over plain notes (`.base`)** — table, list, card, board, gallery,
  calendar, timeline and graph views over your notes' frontmatter, including
  relations with computed reverse columns and per-view filters. The data is your
  notes; the `.base` format stays Obsidian-compatible.
- **Graph** — a context graph beside every note, a semantic-zoom vault map with
  cleanup tools (orphans, broken links, unlinked mentions) and time travel.
- **Sync through your own storage** — WebDAV/Nextcloud, S3-compatible object
  storage (R2, MinIO, B2, …), Google Drive, OneDrive and Dropbox. Offline queue,
  3-way merge, a visual conflict resolver; credentials live in the OS keychain
  and nothing ever leaves your chosen storage.
- **Versioning and backups** — every write is snapshotted locally; browse, diff
  and restore any version, recover deleted files, and daily ZIP backups with
  retention.
- **Search and performance** — SQLite/FTS5 full-text search as you type with
  operators, incremental indexing, tuned for large vaults.
- **Made yours** — 10 UI languages, 13+ themes, in-app signed auto-updates with
  an opt-out, no telemetry and no account.

### Security

- Content-Security-Policy enforced; the asset protocol is disabled (images load
  as blob URLs with a traversal guard).
- No telemetry, no mandatory cloud; see [`SECURITY.md`](SECURITY.md).

[Unreleased]: https://github.com/plainva/plainva/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/plainva/plainva/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/plainva/plainva/releases/tag/v0.1.0
