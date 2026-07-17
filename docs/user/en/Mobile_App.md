# The mobile app

Last reviewed: 2026-07-17

Plainva is also available as an app for Android and iOS. It works on the same Markdown files, the same **OKF** format and the same sync engine as the desktop app — your vault stays identical in both worlds.

## Layout

- **Bottom bar:** up to four screens of your choice (Notes, Today, Tags, Bookmarks, Calendar, Databases) around the fixed **＋** button. Change the selection under **Settings** → **Tab bar**.
- **＋**: a tap captures a new note right away (into the visible folder, else the inbox folder). Press and hold for quick create: note, daily note, folder, database, "From template…".
- **Top bar:** search and the More menu; the home screen additionally shows "Recently opened" and your bookmarks.

## Reading and editing notes

Notes open **rendered and read-only**; the pen at the top right switches to editing (with a toolbar above the keyboard: formatting, lists, wiki link, slash commands, insert photo). `![[Note]]` embeds appear as tappable preview cards.

The **Note details** button in the header (between the bookmark and the ⋮ menu) opens the note's context sheet: properties (directly editable), backlinks, outline, graph and the **version history** — every edit automatically creates snapshots you can inspect, compare and restore. The Markdown source and in-note search live in the ⋮ menu.

## Databases (`.base`)

`.base` databases work like on the desktop: every view (table, list, gallery, board, calendar, timeline), typed cell editing, board cards move via press-and-hold. **Configure** manages views, columns, filters (including groups), sorting and properties. Relation schemas (targets, cardinality) are still maintained on the desktop.

A **Pinboard** view shows the notes as a two-column board of sticky cards: tap opens the note, long-press shows the actions (pin, labels, color, delete), dragging after a long press reorders, and checkboxes tick right on the card. The input field on top captures a new note. Tip: point the database at your inbox folder (**Settings** → **Folders**) and the ＋ quick notes as well as texts shared from other apps land straight on the board.

## Sync

Under **More** → **Vaults** you connect cloud storage (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). **Connect to cloud** brings an existing cloud vault onto the device; **Create new vault** first asks **On this device** or **With an online service** and then for the starter structure (empty or a template like PARA) — on the online path the connection follows, the target folder in the cloud can be created fresh via **New folder** in the picker sheet, and the structure is uploaded by the first sync. The first launch ("Connect to cloud") offers the same choice between an existing and a new cloud vault. Every connection gets its own, separate vault on the device. The vault page shows status, progress, pending transfers and offers **Export vault** (ZIP through the share sheet).

## Safety net

Snapshots (version history), a draft journal (after a crash the note offers your last unsaved state) and conflict copies with a comparison view protect your data. Retention is configured in **Settings**.

## Sharing and shortcuts (Android)

Text shared from other apps lands as a new note in the inbox folder. Press and hold the app icon for the **New note** and **Today** shortcuts.
