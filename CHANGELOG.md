# Changelog

All notable changes to Plainva are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Plainva aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it
reaches 1.0.

## [Unreleased]

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
