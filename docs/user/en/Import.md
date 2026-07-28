# Importing from another app

Last reviewed: 2026-07-28

Plainva can bring notes over from other note apps. The import always writes into the vault you currently have open, in a subfolder you name — so it never touches the rest of your vault, and you can move or delete the imported folder afterwards like any other folder.

**Import runs on the desktop.** The mobile app cannot import: bring the notes in on the desktop and they reach your phone through the sync, like every other file.

## Starting an import

Three ways in:

- **Start screen** → **Import from another app** — the way in when you have no vault yet, which is the normal case when you are switching apps.
- **Command palette** (`Mod+P`) → **Import from another app...**
- **Right-click a folder** in the file tree → **Import from another app...**

The first step asks for your export — **Choose files…** or **Choose folder…**, whichever you have. The wizard then names the app it recognised and you decide where the import writes. A preview follows with the numbers for the run, the limits of this import and the switches for the source. Nothing is written until you press **Start import**.

**You do not have to know which entry fits your export.** Pick the files, and Plainva recognises the source — a Notion export by the long IDs in its paths, a Logseq graph by its `journals/` and `pages/` folders, a Keep or Simplenote export by what is inside the JSON. The wizard says what it recognised; if it guessed wrong, change it in the tiles below and your choice stands.

## Where the import writes

Exactly one of two places per import — never both:

- **New vault**: you choose an empty folder, Plainva creates a fresh vault in it and imports into that. Nothing you already have can be touched, and undoing the whole import is deleting that folder. This is the right choice when you are trying Plainva out.
- **Subfolder of the open vault**: everything lands in one newly created subfolder that you name. The rest of your vault is untouched.

The target line under the choice always spells out the exact folder, so where things will land is never a guess.

## Options for this import

The preview carries the switches **that fit the source it recognised**, below the numbers — every source brings its own, and what a source cannot do never shows up there. They sit there rather than earlier because the questions only make sense once you can see what is coming; a switch that changes the numbers has them recounted at once.

- **Keep the dates from the source** (on) — imported notes keep the created and modified dates from the source. Without this option they are all dated today.
- **Import deleted notes as well** (off) — for Google Keep and Simplenote, whose exports include the trash. By default whatever sits there stays there; the report names it.

## What the preview shows

The preview is the last stop before anything is written, and it names everything that would otherwise be a surprise afterwards:

- the numbers for the run — notes and databases, plus **attachments** and **checklists** where the source has any,
- the exact target folder,
- what this importer **cannot** carry over, and every archive entry that was skipped,
- for a vault with a cloud connection, that the imported notes will be **uploaded** afterwards,
- for very large sources, that the search index and the first sync will take a while.

## Stopping a run

A large workspace can take a while, so an import can be stopped: **Stop import** during the run. What already reached the vault stays there and the report describes it — a partial import is not a broken one. As with a completed import, the folder is the undo.

## What you can import

| Source | What you select | What comes across |
|---|---|---|
| **Notion (API)** | An integration token | Pages, folder hierarchy, databases with rows, relations, 21 property types |
| **Notion (ZIP export)** | The ZIP or unpacked folder | Pages and folder structure. Databases are created **empty** |
| **Evernote (ENEX)** | One or more `.enex` files | Notes, tags, checklists (checked and unchecked), created/updated dates |
| **Google Keep (Takeout)** | The Takeout ZIP or the `.json` files | Notes, checklists, labels as tags, colour, pinned/archived |
| **Simplenote** | The exported `.json` file | Active notes and their tags |
| **Logseq** | Your graph folder | The files, copied unchanged |
| **Markdown folder / ZIP** | A folder, files or a ZIP | The `.md` files and their folder structure |

**Obsidian** is in the list too, but it starts no import — and needs none. Plainva works with the same Markdown files: the entry says so and offers you **Open vault**. Wiki links, tags, frontmatter and `.base` files keep working, and your vault stays usable in Obsidian. Honestly alongside that: there is no plugin ecosystem, no Canvas and no Dataview — you get filters in `.base` instead, and plugin syntax in your notes stays there as plain text.

## Notion in detail

Notion is the one source where the two paths differ a lot.

**With an integration token (recommended).** Create a token at `notion.so/my-integrations` — the wizard spells out the three steps and opens the page for you. Then open each Notion page you want to import, choose **"..."** at the top right → **Connections**, and add your integration — Notion only exposes pages you have explicitly connected.

**Plainva does not store the token.** It is used for that one run and gone afterwards; no connected account is created. For the next import you paste it again.

Through the API, Plainva sees the structure, not just the text:

- The page hierarchy becomes a folder structure.
- Every database becomes a `.base` file plus a folder with **one note per row**.
- **Relations become wiki links** between those notes, in both directions.
- 21 property types are mapped — select, status, multi-select, date, number, checkbox, URL, email, phone, formula, rollup, relation, people, unique ID and more.
- Table, board, calendar and list views are generated from the database schema.
- Databases embedded inside a page become live `![[Database.base]]` embeds.

**From a ZIP export.** This works offline and needs no token, but Notion's export does not contain the database schema or the page IDs. Pages and their folders come across, and **links between the imported pages keep working** — Notion writes them with a long ID in every path segment, and Plainva points them at the notes it actually wrote. Databases are created as **empty** `.base` files, and the report says so. If your databases matter, use the API path.

## What imports cannot carry over

Every importer states its limits in the preview and again in the report. The main ones:

- **Attachments and images are not imported.** The report lists them one by one so you know what stays behind in your export; Evernote attachments and Keep images stay there too.
- **Some archive entries are skipped on purpose:** very large files, symbolic links and entries with an unsafe path. They appear with a reason in the preview, before you start the import.
- **Very long Notion pages** are read in full, but content nested inside toggles, columns or sub-lists is not followed.
- **Logseq files are copied unchanged** — `key:: value` properties and block references are not converted into Plainva properties or links.
- **Deleted notes stay deleted.** The Simplenote and Google Keep trash is skipped — you decided against those notes once, and an import should not quietly hand them back. They are named in the report, so you can see what was left behind.
- **Notion ZIP exports** create empty databases (see above).

## Dates come across

A collection grown over years loses its time axis if everything is dated today after an import. Plainva therefore carries the source's dates over:

- They land as `created` and `updated` in the imported note's frontmatter, which is where the graph's time axis reads them too.
- The file itself also gets the source's modification date, so sorting by date and **Recently opened** are right. File creation time can only be set on Windows; on the other systems the frontmatter is the carrier.
- If a source ships no dates, Plainva uses the date of the export file. It never invents one: with nothing to go on, the field stays empty.

## One failure does not end the whole import

If a single note cannot be written, the import carries on and the report names it with the reason. The report is written even when the run stops early — so you always see what already landed in your vault.

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

At the bottom it says how to **undo** the import: everything from one run sits in a single folder, so deleting that folder removes the import. With the **New vault** target that is the new vault's own folder. No separate undo command is needed for it. The report itself is an ordinary note and can be deleted once you have read it.

## Related pages

- [Databases (.base)](Databases_Base.md) — what happens to imported Notion databases
- [OKF](OKF.md) — the frontmatter imported notes receive
- [Getting Started](Getting_Started.md) — creating a separate vault for an import
