# Getting Started

Last updated: 2026-08-10

This page takes you from installation to your first real work: opening or creating a vault, learning the interface, and understanding the three editor modes.

## System requirements

Plainva draws its window with the system's web engine, so the engine — not the processor — sets the floor:

- **Windows** 10 or newer with the WebView2 runtime (Windows 11 ships it; on 10 the installer adds it)
- **macOS 12 (Monterey)** or newer with Safari kept current, Apple Silicon or Intel
- **Linux** with WebKitGTK 2.40 or newer (check with `pkg-config --modversion webkit2gtk-4.1`)

On macOS the real bar is **Safari 16.4**, because the engine arrives with Safari rather than with the system: Ventura 13.0 shipped below that bar, while a Monterey with current updates sits above it. If Plainva refuses to start on a Mac, installing the latest Safari is the first thing to try.

On a system below that line Plainva says so at startup instead of opening a blank window.

## What is a vault?

A vault is an ordinary folder on your computer that holds your Markdown notes. Plainva adds a hidden `.plainva/` subfolder for the search index and settings — your notes themselves remain untouched `.md` files. You can have several vaults (e.g. "Personal" and "Work") and switch between them.

## Opening or creating a vault

On the **very first** launch — before you have ever opened a vault — Plainva shows a short welcome, once. It says in three lines what Plainva is built on, shows a small preview of the interface next to it, and offers the three ways in right away: **Open Vault**, **New Vault** and **Import from another app**. **Later** skips it and leaves you on the ordinary welcome screen; it does not come back — unless you ask for it again under **Settings → Startup & behavior → Welcome screen**.

After an update the same spot shows what changed: the biggest change of that release with a headline of its own, the rest as one line each. It appears once per version — you can call it up again anytime under **Settings → Startup & behavior → Show release highlights again**.

On launch, the welcome screen greets you:

- **Open Vault** — Plainva first asks **"Where is your vault?"**: **Local folder** opens an existing folder of Markdown files on this computer (Obsidian vaults work out of the box); **Online vault** syncs an existing vault from the cloud into a local folder — the same three steps for every provider (**Connect**, **choose the folder in the cloud**, **choose the local folder**; see [Sync Setup](Sync_Setup.md)).
- **New Vault** — the first question is **"Where should your vault live?"** (**On this computer** or **With an online service**), then you pick the starter structure: empty or from a prepared folder structure; both are adjustable anytime. The **Empty vault** contains just an `index.md` overview. Available templates: the **Plainva Tour**, **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD**, **Journal** and **Project** — each creates folders, a welcome note with a quick guide and automatically maintained `index.md` overviews in the [OKF format](OKF.md) (folder and file names follow the app language). The **Plainva Tour** is the recommended place to start: it fills nine folders and seven databases with examples, so you see every view in action once — pinboard, calendar, gallery, board, timeline, table and the tree view with sub-items — plus note templates, folder rules and a Markdown cheat sheet. Nothing in it is precious: delete what you do not need and rename the rest. The **Journal** template additionally wires up the vault's daily-notes settings. The **Plainva Tour**, **PARA**, **GTD**, **Zettelkasten**, **Journal** and **Project** templates also ship ready-linked [databases](Databases_Base.md) with matching note templates — for example projects with a status board and an area link, or tasks that point to their project. The **Project** template shows the project tooling in action: four connected databases, a column that counts a project’s open tasks, a footer that sums the planned effort, dependencies between tasks, and milestones that appear as a diamond on the timeline. On the online path the connection follows the template: pick the provider, connect, choose the folder in the cloud or create a fresh one via **New folder**, pick the local folder — the chosen structure is created in the local folder and uploaded to the cloud by the first sync.

**Recent Vaults** lists everything you have opened before. **Remove from list** removes an entry from Plainva only — the files stay on disk. Enable **Automatically open the last vault on start** to skip the welcome screen in the future. When removing, Plainva asks whether to additionally forget all of the vault's app data (search index, settings, window layout, credentials for sync, calendar and mailboxes; automatic ZIP backups only via the extra checkbox) — your vault folder always stays untouched.

## The interface

- **Left sidebar** — three views: **Files** (the file tree), **Tags** (all `#tags` in the vault) and **Databases** (every `.base` in the vault, grouped by folder — click one to open it); Bookmarks and Recently opened are sections above the tree. At the very top sits the search field with a **+** beside it for New Note, New Folder, New Base and Daily Note. The search placeholder says what is being searched, and the tabs carry their names as long as the panel is wide enough — as it narrows, first only the active tab keeps its name, then the icons speak alone. At the bottom: the vault switcher, **Open Daily Note** and **Settings**. The double-chevron button next to the three views collapses or expands all folders at once, and **Reveal in file tree** in the editor's ⋮ menu jumps straight to the open note in the tree. In the **Files** view, a header shows the current vault's name and icon, and a **Recently opened** strip above the tree gives one-click access to the notes you had open most recently.
- **Title bar** — your open tabs. Tabs can be reordered by dragging and moved between editor panes.
- **Editor area** — where you read and write. Via the tab menu (**Split right** / **Split down**) or the shortcuts `Ctrl+Alt+V` / `Ctrl+Alt+S` you split the editor into two panes, e.g. a note next to a database.
- **Right sidebar** — four sections, reorderable by drag: **Calendar** (daily notes), **Outline** (headings of the active note), **Backlinks** (who links here) and **Properties** (the note's frontmatter).
- **Status bar** — word/character count, sync status (Local/Online/Offline) and save status (**Saving...** / **Saved**).

## The three editor modes

Switch modes at the top right of the editor:

| Mode | What for |
|---|---|
| **Read Mode** | Fully rendered view for reading and navigating. Links open right inside Plainva. |
| **Live Preview** | The default for writing: Markdown renders as you type; formatting characters only appear where you are working. |
| **Markdown Source** | The raw text without rendering — for full control. |

Which mode notes open in is up to you: pick the **Default view** under **Settings → App → Editor & notes** (read, live or source). Switching the mode in the editor applies to that file for the current session.

You can also toggle between **Readable width** and **Full width**.

## File tree basics

- **Creating:** right-click a folder → **New Note Here**, **New folder** or **New database (.base)**. The big **New** button creates inside the currently selected folder (or the parent folder of a selected file).
- **Selecting:** click selects, `Ctrl`+click adds/removes individually, `Shift`+click selects a range, middle-click opens in a new tab.
- **Context menu:** includes **Rename** (updates links vault-wide), **Duplicate**, **Open in split (right)** / **Open in split (bottom)**, **Add bookmark**, **Copy Path**, **Show in File Manager**, **Delete**.
- **The same actions in the sections above the tree:** right-clicking an entry in **Recently opened** or **Bookmarks** opens the same menu — without the folder entries, and with **Remove from list** added (that drops the entry from the list, never the file). Renaming there runs through a prompt instead of an input field in the row. The calendar and task views can sit in **Recently opened** too; they can be opened and removed from the list, but not renamed or deleted — they are views, not files.
- **Multi-selection:** deleting asks once for all items, duplicating and moving by drag work on the whole selection. Deleted items go to the operating system's trash.
- New notes automatically start with a `# Heading` derived from the file name.
- A folder's own `index.md` (its overview) sorts to the **top** of that folder in the tree, above its subfolders and files — not alphabetically among the other notes.
- **Read again:** the circular arrow in the tree's heading (or **F5**) reads the vault again — Plainva reconciles the index with the folder and, on online vaults, also fetches the cloud files. A short report then states what was new, changed, removed or skipped. For a single folder there is **Read this folder again** in the right-click menu.

## Daily notes

The **Daily Note** button in the left action rail opens or creates today's note. Configure the base folder, date format and an optional template under **Settings → Vault → Content & structure** (**Choose folder…** next to the field lets you pick the folder right inside the vault).

The date format uses the same tokens as Obsidian: `YYYY` year, `MM` month, `DD` day, `dddd` weekday name — `YYYY-MM-DD dddd` gives `2026-07-29 Wednesday`. Text that should stay as it is belongs in square brackets: `[Journal] YYYY-MM-DD`. Month and weekday names are always English, so switching the app language never makes your existing daily notes unfindable.

The **Calendar** on the right is a day overview: **clicking** a date opens the [calendar tab](Calendar_and_Tasks.md) at that day; a **right-click** opens a menu that names the day at the top and offers **Open calendar**, **Daily Note** and that day's events and due tasks. Days with a daily note carry a tiny **sun glyph**, days with events colored dots per calendar. The **Today** button returns to the current month; clicking the month label opens a quick month/year picker. There you can also enable **Show week numbers** to add an ISO week column — the setting is remembered.

## Settings

**Settings** (gear icon at the bottom of the leftmost action rail, or `Ctrl+,`) close via the **X** in the top right, `Esc` or a click outside the window. Changes are saved immediately and automatically — only cloud credentials are applied deliberately via **Sign in** in the **Cloud accounts** area (see [Sync Setup](Sync_Setup.md)). Settings come in two parts; every area in the left rail opens its own page, where the settings sit in named group cards:

- **App** — everything that applies app-wide, in five areas. **Appearance**: the **Theme** picker as preview cards — besides **Petrol** (the default) you get **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Paper** (E-Ink-like, maximally calm), **Sepia** (warm paper), **Forest**, **Midnight** (OLED black), **High Contrast** and **Phosphor Green**/**Phosphor Amber** (retro terminal with subtle scanlines); plus the **Mode** (**Light**/**Dark**/**System Default**; single-mode themes such as **Midnight** pin the mode, and the light/dark switch in the title bar pauses while they are active), **Language**, **Week starts on**, **Density** and **Interface zoom**. **Editor & notes**: **Default view**, **Content font size** and **Content font**. **Startup & behavior**: open the last vault automatically, compatibility warnings. **Updates**: Plainva quietly checks for new versions on startup and shows a notice when one is found — click it to download and install the update straight away (it stays up until Plainva restarts). Opt out via **Check for updates on startup**. **About & diagnostics**: version details, the **OS keychain** status, **Performance metrics**, **Export diagnostics…** (no note content) and **Report a problem**. Keyboard shortcuts stay reachable any time via `F1` or **Show keyboard shortcuts** in the bottom left.
- **Vault** — the selected vault sits as a small card in the rail (the active vault carries a dot); with several vaults, **Switch** below it opens a picker list. Below that, the per-vault areas: **Cloud accounts** is the one place for every cloud sign-in — **Connect account…** picks the provider (Microsoft, Google, Nextcloud, Dropbox, S3, WebDAV or an email mailbox) and the services (**Files**, **Calendar & tasks**, **Email**) that account should carry. The service areas **Sync** (see [Sync Setup](Sync_Setup.md)), **Calendar** (see [Calendar & Tasks](Calendar_and_Tasks.md)) and **Email** (see [Email capture](Email_Capture.md)) only appear once a connected account carries that service. Always present: **Content & structure** (**Daily notes**, **Templates** (the **Template Folder** plus the **folder → template** and **note type → template** rules, which apply on the phone too), **Daily notes** (including their **Template**), the **Inbox folder**, the **Attachments folder**, **Tasks**, **OKF (Open Knowledge Format)** — see [OKF](OKF.md) — and **Extended databases**), **Backup & version history** and **Maintenance** (**Rebuild index**, restore deleted files, vault statistics).

## Tabs

- **Right-click a tab** for its menu: **Pin**, **Reload**, **Open in split (right)**, **Copy path**, **Show in file manager**, and the closing group.
- **Pin** holds a tab in place: it moves to the front of the strip, shows a pin instead of the close cross, and survives every **Close others** / **Close to the left** / **Close to the right** / **Close all**. To close it, **Unpin** first.
- **Reload** discards the view and reads the file from disk again — handy when another program changed it. If the tab has unsaved edits, Plainva refuses to reload rather than overwrite your work.

## Arranging bars & areas

The action rail on the far left, the tabs of the left sidebar, the sections above the file tree and the sections of the right sidebar all work the same way.

The action rail offers **New Note**, **New Folder** and **New Base**. All three create inside the **selected folder** in the file tree; with a file selected, in that file's folder; with nothing selected, at the top level. The **Daily Note** does not follow that — it always belongs in the folder you named for it in the settings. If you do not need one of the three, hide it.

**Right where they are:** **press and hold** a button or a section heading and drag it to its new place — a plain click still just triggers it, and if you scroll while holding, you scroll (the drag is cancelled). `Esc` cancels a drag in progress. A **right-click** offers the same actions without holding: **Move up**, **Hide** and **Customize bars…**.

**In one place:** under **Settings → Vault → Bars & areas** all five bars sit below each other — including the phone's navigation bar, which you can therefore arrange on the big screen. Each is **one** list with a dividing line: everything above it is visible, everything below is hidden. Here you move entries with the drag handle — on this page a list is being arranged, which is exactly what a handle is for. Dragging to the top or bottom edge scrolls the page along, so an entry travels from the very bottom to the very top in one movement.

Two things deliberately cannot be hidden: **Help** and **Settings** at the bottom of the action rail, and the **Files** tab of the left sidebar. Everything else is yours to hide; hidden rail actions stay reachable from the **command palette** (`Ctrl+P`). Right-sidebar sections with nothing to show for the open note never appear in the first place.

The arrangement belongs to the vault and travels to your other devices through [settings sync](Sync_Setup.md). A vault you have not adapted follows your **default** — set it with **Save as default**, and **Reset to default** returns an adapted vault to it.

## Customizing the interface

- **Toggle the sidebars** via the two title-bar buttons or `Ctrl+Alt+B` (left) / `Ctrl+Alt+R` (right) — great for focused writing. Plainva remembers the state.
- **Command palette**: `Ctrl+P` opens **Commands** — type and hit `Enter` to run (new note, daily note, split, sidebars, **Back up now**, and more).
- **Density**: under **Settings → App → Appearance**, choose between **Comfortable** and **Compact** — compact tightens lists, menus and table rows; note content is unaffected.
- **Content font**: under **Settings → App → Editor & notes**, set the **Content font size** (12–24 px) and the **Content font** (theme default, serif, sans-serif, monospace or the name of any installed font) — this scales the editor and reading view only; the interface stays as it is.
- **Interface zoom**: scales the WHOLE interface between 80 % and 150 % — under **Settings → App → Appearance** or via `Ctrl+Plus`/`Ctrl+Minus` (`Ctrl+0` resets).
- **Native-free dialogs**: confirmations appear as Plainva dialogs styled by your theme (destructive actions get a red button), short notices as subtle toasts in the bottom right — no more system popups.

## See also

- [Notes & Markdown](Notes_and_Markdown.md) — everything about writing
- [Keyboard Shortcuts](Keyboard_Shortcuts.md)
- [FAQ & Troubleshooting](FAQ.md)

## The graph

Via **Ctrl/Cmd+Shift+G** (or the **Graph** section in the right sidebar) you see your vault as a map: folders as bubbles, notes as nodes, relations as labeled edges — including a cleanup mode and time travel. Details: [Graph](Graph.md).

## Remembering the right sidebar

Sections with nothing to show for the open note — **Outline**, **Backlinks**, **Properties**, **Databases** — do not appear at all, rather than sitting there greyed out. The whole right sidebar remembers one global preference for notes; full-surface views without note context close it only temporarily.

**When you drag the panel narrow** it changes in three steps, so nothing breaks:

- **280 px and up** — as usual.
- **232–280 px** — properties put the name above the value instead of beside it, long values wrap, the sections tighten up.
- **below 232 px** — the calendar shows **one week instead of the month** (seven days, week number below right); a month grid would have 14-pixel cells here and stop being a calendar. The graph gets shorter, and backlinks show the file name without the path line.

The right panel cannot go below **200 px** — no section is usable under that. The left one still goes down to 150 px, because file names simply truncate.
