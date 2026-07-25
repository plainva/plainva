# Importing from another app

Last reviewed: 2026-07-25

Plainva can bring notes over from other note apps. The import always writes into the vault you currently have open, in a subfolder you name — so it never touches the rest of your vault, and you can move or delete the imported folder afterwards like any other folder.

## Starting an import

Two ways in:

- **Command palette** (`Mod+P`) → **Import from another app...**
- **Right-click a folder** in the file tree → **Import from another app...**

The wizard has three steps: choose the app you are coming from, choose the export files (or enter a Notion token), and name the target folder. You then get a preview with the number of notes and databases and a list of anything the importer cannot carry over. Nothing is written until you press **Start import**.

## What you can import

| Source | What you select | What comes across |
|---|---|---|
| **Notion (API)** | An integration token | Pages, folder hierarchy, databases with rows, relations, 21 property types |
| **Notion (ZIP export)** | The ZIP or unpacked folder | Pages and folder structure. Databases are created **empty** |
| **Evernote (ENEX)** | One or more `.enex` files | Notes, tags, checklists, created/updated dates |
| **Google Keep (Takeout)** | The Takeout ZIP or the `.json` files | Notes, checklists, labels as tags, colour, pinned/archived |
| **Simplenote** | The exported `.json` file | Active notes and their tags |
| **Logseq** | Your graph folder | The files, copied unchanged |
| **Markdown folder / ZIP** | A folder, files or a ZIP | The `.md` files and their folder structure |

There is no Obsidian importer — and none is needed. Plainva opens an Obsidian vault directly: **Open vault** and pick the folder.

## Notion in detail

Notion is the one source where the two paths differ a lot.

**With an integration token (recommended).** Create a token at `notion.so/my-integrations`. Then open each Notion page you want to import, choose **"..."** at the top right → **Connections**, and add your integration — Notion only exposes pages you have explicitly connected.

Through the API, Plainva sees the structure, not just the text:

- The page hierarchy becomes a folder structure.
- Every database becomes a `.base` file plus a folder with **one note per row**.
- **Relations become wiki links** between those notes, in both directions.
- 21 property types are mapped — select, status, multi-select, date, number, checkbox, URL, email, phone, formula, rollup, relation, people, unique ID and more.
- Table, board, calendar and list views are generated from the database schema.
- Databases embedded inside a page become live `![[Database.base]]` embeds.

**From a ZIP export.** This works offline and needs no token, but Notion's export does not contain the database schema or the page IDs. Pages and their folders come across; databases are created as **empty** `.base` files, and the report says so. If your databases matter, use the API path.

## What imports cannot carry over

Every importer states its limits in the preview and again in the report. The main ones:

- **Attachments and images are not imported.** ZIP archives are read for text files only; Evernote attachments and Keep images stay behind.
- **Very long Notion pages** are read in full, but content nested inside toggles, columns or sub-lists is not followed.
- **Logseq files are copied unchanged** — `key:: value` properties and block references are not converted into Plainva properties or links.
- **Simplenote trash** is skipped.
- **Notion ZIP exports** create empty databases (see above).

## Nothing gets overwritten

The import writes into the vault you have open, so it is built to be non-destructive:

- If a note name is already taken, the imported note is **numbered** (`Meeting (2).md`) instead of replacing the existing one. This also applies when two source notes share a name.
- Imported notes get the usual OKF frontmatter (`type`, `okf_version`), so they behave like any other Plainva note in `.base` filters and views.
- Nothing outside the target subfolder is modified.

If you would rather keep the import completely separate, create a new vault first (**New vault** on the start screen) and import into that.

## The import report

Each run writes an **import report** into the target folder. It lists:

- how many notes and databases were imported,
- what this importer cannot carry over at all,
- everything that arrived **incompletely** or was **skipped**, with the reason,
- and every file, with its status.

The report is the honest record of the run — if something was truncated or dropped, it appears there rather than being silently counted as a success. Worth a read before you delete the export.

## Related pages

- [Databases (.base)](Databases_Base.md) — what happens to imported Notion databases
- [OKF](OKF.md) — the frontmatter imported notes receive
- [Getting Started](Getting_Started.md) — creating a separate vault for an import
