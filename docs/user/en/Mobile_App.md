# The mobile app

Last updated: 2026-07-12

Plainva is also available as an app for Android and iOS. It works on the same Markdown files, the same **OKF** format and the same sync engine as the desktop app — your vault stays identical in both worlds.

## Layout

- **Bottom bar:** up to four screens of your choice (Notes, Today, Tags, Bookmarks, Calendar, Databases) around the fixed **＋** button. Change the selection under **Settings** → **Tab bar**.
- **＋**: a tap captures a new note right away (into the visible folder, else the inbox folder). Press and hold for quick create: note, daily note, folder, database, "From template…".
- **Top bar:** search and the More menu; the home screen additionally shows "Recently opened" and your bookmarks.

## Reading and editing notes

Notes open **rendered and read-only**; the pen at the top right switches to editing (with a toolbar above the keyboard: formatting, lists, wiki link, slash commands, insert photo). `![[Note]]` embeds appear as tappable preview cards.

The **ⓘ** symbol opens the note's context sheet: properties (directly editable), backlinks, outline, Markdown source, in-note search and the **version history** — every edit automatically creates snapshots you can inspect, compare and restore.

## Databases (`.base`)

`.base` databases work like on the desktop: every view (table, list, gallery, board, calendar, timeline), typed cell editing, board cards move via press-and-hold. **Configure** manages views, columns, filters (including groups), sorting and properties. Relation schemas (targets, cardinality) are still maintained on the desktop.

## Sync

Under **More** → **Vaults** you connect cloud storage (WebDAV/Nextcloud, Google Drive, OneDrive, Dropbox, S3). Every connection gets its own, separate vault on the device. The vault page shows status, progress, pending transfers and offers **Export vault** (ZIP through the share sheet).

## Safety net

Snapshots (version history), a draft journal (after a crash the note offers your last unsaved state) and conflict copies with a comparison view protect your data. Retention is configured in **Settings**.

## Sharing and shortcuts (Android)

Text shared from other apps lands as a new note in the inbox folder. Press and hold the app icon for the **New note** and **Today** shortcuts.
