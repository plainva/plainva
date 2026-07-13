# Getting Started

Last reviewed: 2026-07-13

This page takes you from installation to your first real work: opening or creating a vault, learning the interface, and understanding the three editor modes.

## What is a vault?

A vault is an ordinary folder on your computer that holds your Markdown notes. Plainva adds a hidden `.plainva/` subfolder for the search index and settings — your notes themselves remain untouched `.md` files. You can have several vaults (e.g. "Personal" and "Work") and switch between them.

## Opening or creating a vault

On launch, the welcome screen greets you:

- **Open Vault** — Plainva first asks **"Where is your vault?"**: **Local folder** opens an existing folder of Markdown files on this computer (Obsidian vaults work out of the box); **Online vault** syncs an existing vault from the cloud into a local folder — the same three steps for every provider (**Connect**, **choose the folder in the cloud**, **choose the local folder**; see [Sync Setup](Sync_Setup.md)).
- **New Vault** — the first question is **"Where should your vault live?"** (**On this computer** or **With an online service**), then you pick the starter structure: empty or from a prepared folder structure; both are adjustable anytime. The **Empty vault** contains just an `index.md` overview. Available templates: **PARA**, **Zettelkasten**, **ACE (Linking Your Thinking)**, **Johnny.Decimal**, **GTD** and **Journal** — each creates folders, a welcome note with a quick guide and automatically maintained `index.md` overviews in the [OKF format](OKF.md) (folder and file names follow the app language). The **Journal** template additionally wires up the vault's daily-notes settings. The **PARA**, **GTD**, **Zettelkasten** and **Journal** templates also ship ready-linked [databases](Databases_Base.md) with matching note templates — for example projects with a status board and an area link, or tasks that point to their project. On the online path the connection follows the template: pick the provider, connect, choose the folder in the cloud or create a fresh one via **New folder**, pick the local folder — the chosen structure is created in the local folder and uploaded to the cloud by the first sync.

**Recent Vaults** lists everything you have opened before. **Remove from list** removes an entry from Plainva only — the files stay on disk. Enable **Automatically open the last vault on start** to skip the welcome screen in the future. When removing, Plainva asks whether to additionally forget all of the vault's app data (search index, settings, window layout, sync credentials; automatic ZIP backups only via the extra checkbox) — your vault folder always stays untouched.

## The interface

- **Left sidebar** — four views: **Files** (the file tree), **Tags** (all `#tags` in the vault), **Bookmarks** and **Databases** (every `.base` in the vault, grouped by folder — click one to open it). At the top sits the big **New** button (New Note, plus **More options** for New Folder, New Base, Daily Note). At the bottom: the vault switcher, **Open Daily Note** and **Settings**. The double-chevron button next to the three views collapses or expands all folders at once, and **Reveal in file tree** in the editor's ⋮ menu jumps straight to the open note in the tree.
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
- **Multi-selection:** deleting asks once for all items, duplicating and moving by drag work on the whole selection. Deleted items go to the operating system's trash.
- New notes automatically start with a `# Heading` derived from the file name.

## Daily notes

**Open Daily Note** (or clicking a date in the **Calendar** on the right) opens or creates today's note. Configure the base folder, date format and an optional template under **Settings → Vault → Content & structure** (**Choose folder…** next to the field lets you pick the folder right inside the vault).

In the calendar, the **Today** button returns to the current month; clicking the month label opens a quick month/year picker. There you can also enable **Show week numbers** to add an ISO week column — the setting is remembered.

## Settings

**Settings** (gear icon at the bottom of the leftmost action rail, or `Ctrl+,`) close via the **X** in the top right, `Esc` or a click outside the window. Changes are saved immediately and automatically — only sync credentials are applied deliberately via **Save**/**Connect** (see [Sync Setup](Sync_Setup.md)). Settings come in two parts:

- **App** — everything that applies app-wide, in five areas. **Appearance**: the **Theme** picker as preview cards — besides **Petrol** (the default) you get **Nord**, **Solarized**, **Gruvbox**, **Catppuccin**, **Paper** (E-Ink-like, maximally calm), **Sepia** (warm paper), **Forest**, **Midnight** (OLED black), **High Contrast** and **Phosphor Green**/**Phosphor Amber** (retro terminal with subtle scanlines); plus the **Mode** (**Light**/**Dark**/**System Default**; single-mode themes such as **Midnight** pin the mode, and the light/dark switch in the title bar pauses while they are active), **Language**, **Density** and **Interface zoom**. **Editor & notes**: **Default view**, **Content font size** and **Content font**. **Startup & behavior**: open the last vault automatically, compatibility warnings. **Updates**: Plainva quietly checks for new versions on startup and shows a notice when one is found — opt out via **Check for updates on startup**. **About & diagnostics**: version details, the **OS keychain** status, **Performance metrics**, **Export diagnostics…** (no note content) and **Report a problem**. Keyboard shortcuts stay reachable any time via `F1` or **Show keyboard shortcuts** in the bottom left.
- **Vault** — the vault picker sits as a dropdown above; below it, four areas per vault: **Sync** (see [Sync Setup](Sync_Setup.md)), **Content & structure** (**Daily Notes & Templates** including the **Template Folder**, **OKF (Open Knowledge Format)** — see [OKF](OKF.md) — and **Extended databases**), **Backup & version history** and **Maintenance** (**Rebuild index**, restore deleted files, vault statistics).

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
