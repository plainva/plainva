# Changelog

All notable changes to Plainva are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Plainva aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it
reaches 1.0.

## [Unreleased]

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
