# Backups & Version History

Last reviewed: 2026-07-05

Plainva protects your work on two levels: **file versions** (automatic snapshots of every single file as you edit and delete) and **vault backups** (regular ZIP archives of the whole vault, stored outside the vault folder). Both run in the background without any setup and can be tuned in the settings under **Backup & version history**.

## File versions (snapshots)

Before every save Plainva stores a snapshot of the previous state — as a plain text copy under `.plainva/backups/` inside the vault (this folder is hidden from the file tree, search and sync). To avoid hundreds of copies while you type, a **Snapshot interval** applies (default: at most one new version every 2 minutes). **Deleting always snapshots**, regardless of the interval.

Retention (configurable per vault):

- **Snapshot interval**: On every change / 30 s / 2 min / 5 min / 10 min
- **Versions per file**: default 100 — above that the oldest are removed
- **Maximum age**: default 90 days — older versions are removed **permanently** by a daily cleanup run ("Unlimited" turns this off)

When you rename or move a file, its version history moves along with it.

## Viewing and restoring versions

Right-click a file in the file tree (or its tab), or use the **⋮** menu at the top right of the editor → **Version history…** opens the version list:

- The left side lists all snapshots grouped by day, with time and size.
- The right side shows a preview; for text files, **Compare with current** shows the selected version side by side with the current content (old version on the left, current state on the right).
- **Restore** replaces the current content with the selected version. Don't worry: the current state is itself saved as a snapshot first — so a restore can always be undone.
- **Restore as copy** creates the version as a new file next to the original (`Name (Version 2026-07-05 14-30).md`) without touching it.

Images have versions too (with preview); other binary files can be restored without a preview.

## Restoring deleted files

Because every deletion snapshots the file first, Plainva can bring deleted files back: right-click the vault name at the top of the file tree → **Restore deleted files…** (also reachable from the settings). The list shows all files whose snapshots still exist while the original is gone — **Restore** recreates the newest state at the original location (folders are recreated as needed), **Versions…** opens the full history of the deleted file.

Note: deleting a **whole folder** moves it to the operating system's trash — for that case the system trash is the primary way back; in Plainva you may only find older snapshots of the contained files.

## Automatic vault backups (ZIP)

In addition, Plainva backs up the whole vault as a ZIP file — by default **daily** in the background (when opening the vault, if the last backup is older than 24 hours). This protects you even if the vault folder itself is lost or damaged, because the ZIPs live **outside** the vault:

- The default destination is the app data folder (shown under **Destination folder** in the settings; **Open folder** takes you straight there).
- Via **Choose folder…** you can pick an external drive or a NAS instead; **Default** switches back to the app data folder. If the destination is currently unreachable (NAS off), the status bar mentions it quietly and Plainva retries later.
- **Backups to keep** (default: 7) caps the count; older ZIPs of the same vault are deleted automatically. Foreign files in the destination folder are never touched.
- **Back up now** starts a backup manually at any time; the status bar shows the run and its result.

The ZIP files are named `VaultName_2026-07-05_14-30-00.zip` and contain all notes, attachments and your `.obsidian` configuration — they do **not** contain the internal `.plainva` folder (the search index is rebuilt on the next open; file versions are deliberately not part of the ZIP).

**Restoring from a ZIP:** the ZIP is a completely normal archive. Extract it anywhere and open the extracted folder in Plainva as a vault — done.

## Settings at a glance

Settings → your vault → **Backup & version history**:

| Setting | Default | Meaning |
|---|---|---|
| **Automatic vault backup (ZIP)** | On | Daily ZIP in the background |
| **Destination folder** | App data folder | Where the ZIPs are stored, freely choosable |
| **Backups to keep** | 7 | This many ZIPs are kept |
| **Snapshot interval** | 2 min | At most this often a new file version is created while typing |
| **Versions per file** | 100 | Upper bound per file |
| **Maximum age** | 90 days | Older versions are removed permanently |

## Good to know

- File versions are ordinary copies under `.plainva/backups/` — if push comes to shove you can open them without Plainva in any file manager.
- Plainva's own sync never transfers `.plainva`. If you sync the vault folder with a third-party client (e.g. the Nextcloud app), the snapshots travel along — that costs some storage but does no harm.
- Sync conflicts are additionally protected via `.CONFLICT` files (see the [FAQ](FAQ.md)); the version history complements that with the timeline of every file.
