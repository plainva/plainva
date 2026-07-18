# Databases (.base)

Last reviewed: 2026-07-18

With `.base` files you turn notes into databases: tables, boards, calendars — with filters, typed properties and relations between databases. The concept resembles Notion databases, with one decisive difference: **the data does not live in the database, it lives in your notes.**

> **Tip:** If you create a new vault from the **PARA**, **GTD**, **Zettelkasten** or **Journal** template (see [Getting Started](Getting_Started.md)), matching databases are already set up and linked together — a good starting point for seeing how everything fits together.

## The core concept

A `.base` file stores only the *view* of your notes: which sources (folders, tags), which views, which filters and columns. The actual values live in the frontmatter of the individual Markdown notes — every table row *is* a note.

Concretely, that means:

- Edit a cell in the table and Plainva writes the value into the note's frontmatter.
- Delete the `.base` file and you only lose the view — all data stays in the notes.
- The same notes can appear in any number of databases at once.

The file format is compatible with Obsidian's Bases format (details at the end of this page).

## Creating a database

- **File tree**: right-click → **New database (.base)** — or via the sidebar's **New** button (**New Base**).
- The **New database** wizard asks two things: the **Data source** (at least one **Folder** or one **Tag**; combining them narrows the result — a live counter shows how many notes match) and the columns (properties found in the matching notes, ready to adopt). Then **Create database**.
- **Inside a note**: slash command **Embed database** (show an existing `.base` inline) or **Create inline database** (create a new `.base` in the folder and embed it).

Every database can carry its own icon with a **Database icon color** — visible in the file tree, tabs and header.

A database can also serve as the vault's **Standard task database** (Settings → **Content & structure**): the [Tasks view](Tasks.md) then shows its entries as an own section and can move checkboxes from notes into it.

## Views

A database can have any number of views; each has a **View type**:

| View | What for |
|---|---|
| **Table** | Classic grid, sortable, with inline editing and optional sub-items |
| **List** | Compact row list |
| **Gallery** | Cards with an optional **Cover image** |
| **Board** | Kanban columns grouped by a property (**Group by**) — dragging cards between columns changes the value; dragging a **column header** reorders the columns |
| **Calendar** | Entries by **Date field** on a month calendar, draggable |
| **Timeline** | Time axis with **Start date** and optional **End date** |
| **Pinboard** | Google-Keep-style board of sticky notes — cards show the rendered note content (own section below) |

**Add view** creates more; **View options** offers **Rename**, **Duplicate**, **Delete** and drag-reordering. Plainva remembers the last active view per file. Calendar and Timeline need a date field (**Date only** or **Date & time** as the **Format**); entries display the fields enabled under **Properties**.

## Configure: tabs for view, columns, filter, sort, data source

The **Configure** button (top right) opens the panel **beside** the running view, so every change shows up immediately in the table or board. **Tabs** at the top pick one area — only one is shown at a time, instead of a long list. A small marker tells you whether each area affects **This view** or the **Whole database**:

- **View** — the **view type** as an icon tile picker (Table, List, Card, Board, Gallery, Calendar, Timeline, Pinboard) together with its type-specific options: board grouping and column color, the date field for calendar/timeline, the gallery cover image, sub-items, date format.
- **Columns** — the view's properties, split into **Visible** and **Hidden**. Click the eye to show or hide a column; drag the grip to reorder. Each row shows a field-type badge, the gear opens the column editor, **New property** adds one.
- **Filter** — each rule shows as a readable **chip sentence** (e.g. "Status is not Done"); click it to expand the editor (property, operator, value). Operators adapt to the field type: **is** / **is not** / **contains** / **does not contain** / **is empty** / **is not empty**, for numbers **greater than** / **less than** / **at least** / **at most**, for dates **after** / **before** / **from** / **until**. The **Logic** at the top decides whether **All** conditions (AND) or **Any** (OR) must match. **Add group** builds Notion-style filter groups: a box with its own AND/OR logic inside the main logic. Deeply nested filters from Obsidian appear as **Complex filter (not editable)** — they are kept and applied. Filters are saved **per view**; everything lives in the `.base` file, not in a separate store.
- **Sort** — multiple sort rules (**Ascending**/**Descending**); change their priority by dragging.
- **Data source** — the database's folder and tag sources (the **Root folder** can be selected too). No source = all files. This applies to the whole database, not just the active view.

On the phone, **Configure** opens the same areas as a list; tapping one enters that detail area and the back arrow leaves it.

## Properties and field types

Clicking a column header opens the property editor (**Property: X**):

- **Name** — renaming affects the notes: on save, the property is renamed in the frontmatter of every matching note (with confirmation and a progress indicator).
- **Field type** — Text, Number, Checkbox, Date, Date & time, List, Tags, Select, Status, Multi-select, URL, Email, Phone, Relation (the same grouped type menu as in the notes' **Properties** panel).
- **Options** (for Select/Status/Multi-select) — fixed values with a **Color** and, for **Status**, a **Group**/stage (e.g. to-do → in progress → done); reorder by dragging. When you open the column editor, the option list is pre-filled with the values already used in the database, so you can give each one a colour without retyping it first.
- **Delete property** — removes column, schema, filters and sort rules from the database. The checkbox **Also remove it from the notes' frontmatter** (on by default) additionally cleans up the source notes.

Behavioral notes:

- If a property is missing in some notes, Plainva offers to **add it (empty) to N source files**.
- For **Select**, **Status**, **Multi-select**, **List** and **Tags**, a comma in a value separates multiple entries; in the **Text** type a comma stays plain text.
- The OKF system fields `type` and `okf_version` are protected here as well: name, field type and delete are locked, and `okf_version` cells are read-only (background: [OKF](OKF.md)).

## Relations

Relations link notes to each other — like in Notion, but stored as perfectly normal `[[wiki links]]` in the frontmatter (visible in Obsidian as clickable property links).

- **Creating**: add a property of field type **Relation**. Optionally pick a **Target database (.base)** — the picker then only suggests notes from that database (empty = **Any note**; **This database** enables self-relations). The **Cardinality** limits to **Exactly 1** or allows **No limit**.
- **Setting values**: the picker searches notes, excludes the current entry, and can create a target on the fly via **Create new note**. A chip saying "Linked note does not exist" marks a broken link (target deleted/renamed outside Plainva).
- **Reverse relation**: the option **Show on "X"** creates a computed column in the target database showing the links in reverse — it is directly editable (edits write into the linking notes). Deleting the relation removes its reverse column too.
- **Sub-items**: for self-relations you can **Enable sub-items** — entries with a parent relation appear collapsible under their parent entry in the table (cycles are handled; switched off, the list stays flat and the values are kept).
- **Board by relation**: boards can group by a relation; dragging cards between columns rewrites the link.
- **Filtering on relations**: contains / does not contain / is empty / is not empty, with a note picker.
- Backlinks count too: frontmatter links appear in the **Backlinks** panel, and file renames automatically update relation links.

## Creating new entries

The **Entry** button at the top left (formerly **New**; clearly separate from the sidebar's global **New**) creates a new item:

- The file name follows the pattern `{database name}_{running number}` (spaces become `_`); the note starts with a matching heading and inherits the database's tag sources and simple filter values so it appears in the view immediately. The peek window then opens for filling in.
- **Storage folder**: new items always land in a designated folder. If the database has no folder source, a dialog walks you through creating one once; with several folder sources you pick once. Change it anytime via the arrow menu on the button → **Change storage folder…**.
- **Templates**: the arrow menu (**Templates and storage folder**) lists the templates from your vault's template folder — use one once, star it via **Set as default** (then every click on **Entry** uses it for this database), or **Create new template** (a new template starts with a `# {{title}}` heading, so entries created from it inherit their file name as the H1). The same menu also offers **Open templates folder**, which reveals the template folder in the file tree — templates are ordinary notes you can edit, rename or delete there.
- **Templates per database**: templates can be assigned to databases. By default the arrow menu only shows the templates assigned to this database (plus its default template); everything else is reachable via **Show all templates (n)**. Assign right there — the database icon on each row reads **Assign to this database** or **Remove assignment to this database** — or on the template itself: the editor's ⋮ menu offers **Target databases…**, a dialog with a search field where you assign the template to any number of databases. A template created from a database via **Create new template** starts assigned to it. The assignment is stored as a `plainva.templateFor` list in the template's frontmatter (see the [file format reference](File_Format_Reference.md)); it is never copied into entries created from the template, and renaming a `.base` carries the assignments along. The **Insert template** slash command deliberately stays unfiltered — it inserts text into an existing note and has no database context.
- **Template placeholders**: templates interpolate `{{title}}`, `{{date}}` and `{{time}}`. When you *insert* a template into a note (the **Insert template** slash command / `Mod+Alt+T`), two more are resolved: `{{cursor}}` marks where the cursor lands after inserting, and `{{prompt:Label}}` asks you for a value (labelled *Label*) and inserts your answer. Creating a *new* note from a template strips `{{cursor}}` and leaves any `{{prompt:…}}` blank.

## Pinboard (sticky notes like Google Keep)

The **Pinboard** view type shows the database's notes as cards with their rendered content — a board full of sticky notes. Cards render text, lists and clickable checkboxes (a click ticks the task right in the note), images and formatting; tables, formulas and embeds appear as subtle placeholders. Clicking a card opens the note in the preview window.

- **Quick capture**: The **Write a note…** field above the board expands into a small popup with a **Title** field and multi-line note text — like Google Keep. A typed title becomes the file name AND the note's first heading; without one the file gets a timestamp name and the note has no heading. The text is the content either way — no template, no detours (Ctrl/Cmd+Enter saves).
- **Pinning**: The pin button (top right when hovering a card) lifts a card into the **Pinned** section.
- **Arranging**: Drag cards to reorder them; the order lives in the `.base` file and syncs along. Cards not arranged yet (freshly captured or created externally) appear on top, newest first. If a sort rule is set under **Configure**, it wins — dragging is disabled then.
- **Labels**: The chip bar above the board filters the cards — by tags by default, switchable to a multi-select property (**Configure** → **Label source**). Multiple chips filter AND-combined; the selection is ephemeral and never written to the file. Edit a card's labels via **Labels** in the card's context menu.
- **Color**: The context menu tints the card. The color is the note's header color (`plainva.header_color`) — it applies everywhere the note appears, including the editor header.
- **Properties**: the properties ticked under **Configure** → **Properties** render as compact lines at the bottom of each card — dates follow the view's date format, empty values are skipped.
- **Mobile**: On the phone, tap opens the note, long-press shows the actions (pin, labels, color, delete), dragging after a long press reorders. Tip: point the database at your inbox folder (**Settings** → **Folders**) and the ＋ quick notes as well as texts shared from other apps land straight on the board.

Note for synced vaults: if two devices arrange the board at the same time, a `.CONFLICT` copy of the `.base` file can appear — only the arrangement is affected, never the notes' content; delete or merge the copy.

## Everyday usage

- **Inline editing**: a single click into a cell (or onto a card value) makes it editable — in every view.
- **Opening**: clicking an entry title opens the note in the peek window — a free-floating window you can drag by its title bar and resize from the corner. It keeps its own **Back**/**Forward** history for the notes you open inside it, has a toggle that reveals a **Properties** column for the shown note, and offers **Open as tab** and **Open in split**. `Ctrl`+click opens directly in the split; alternatively drag a card onto the drop zone **Drop here: open in split**.
- **Dragging**: while dragging cards (Board, Calendar, Timeline) a ghost card follows the pointer. On a **Board** you can also drag a **column header** to reorder the columns — for **Select**/**Status** boards this reorders the property's options (so the dropdowns everywhere follow); relation and free-text boards remember the order per view.
- **Board colour**: in a board's **View** settings, **Column colour** lets a column take its group's colour — either **Whole list** (the whole column is tinted) or **Chip only** (just the header chip, the default). It applies to Select/Status/Multi-select groups.
- **Embedding**: databases can be embedded in notes (slash command **Embed database** or `@` → **Databases**) and used there with full functionality.
- **Automatic scope inside a related element**: when you embed a database inside a single element of a *related* database, it is automatically filtered to that element — embed the task database inside a project note and you only see that project's tasks. This works in both directions (embed the "many" side to see the rows that point at the host element, or the "one" side to see what the host points at) and for self-referential databases with a parent/sub-items hierarchy (embedding the database inside an element shows that element's sub-items, nested). A small **Filter** chip in the embedded header shows what it is scoped to; use it to switch the relation or choose **Show all**. The scope is never written into the `.base` file, so the same database shows the right rows in every element it is embedded in.
- **New entries inherit the link**: creating an entry with **Entry** inside such a scoped embed automatically links it to the host element (a task you create in a project's embedded task list belongs to that project right away). For the reverse direction the host is linked to the new entry instead; an already assigned single-value relation is left untouched.
- **Explicit "This note" filter (like Notion's "this page")**: instead of relying on the automatic scope, you can make it explicit and permanent. In **Configure → Filter**, add a rule on a relation property and pick the value **This note**. The database is then scoped to whichever note it is embedded in — ideal for **templates**: embed the task database in a project template, and every project created from it shows its own tasks. It works for any wiki-link property, not only detected relations, and an explicit **This note** filter takes precedence over the automatic scope. This filter lives only in Plainva (it is not written into the `.base` as a normal filter), so both Obsidian and a standalone open show all rows.

## Example: what a .base file looks like

`.base` files are YAML — here is a simple project list:

```yaml
filters:
  and:
    - 'file.hasTag("project")'
properties:
  note.status:
    displayName: Status
    plainva:
      input: status
      options:
        - value: open
          color: teal
          group: Active
        - value: done
          color: gray
          group: Completed
views:
  - type: table
    name: All projects
  - type: table
    name: Board
    plainva:
      render: board
      groupBy: status
```

Everything Plainva-specific (colors, board rendering, relations, storage folder) lives under `plainva:` keys.

## Editing .base files directly (tools and AI)

If a script or an AI assistant writes `.base` files without going through Plainva, three hard rules matter — break one and Obsidian refuses to open the whole file:

- **Only the top-level keys `filters`, `formulas`, `properties`, `views`.** Never add another top-level key; all Plainva extras go under nested `plainva:` sub-keys.
- **Every view needs a non-empty string `name`.**
- **A `filters` object carries exactly one of `and` / `or` / `not` per level** (never two side by side).

One more gotcha: property ids are `note.`-prefixed in the `properties:` map and in a view's `order`/`sort` (`note.status`), but **bare** inside filter expressions (`status == "Done"`) and inside `plainva` sub-keys (`groupBy: status`).

The complete on-disk contract — every field, the full two-sided relations example, and the safe-editing rules — is in the [File Format Reference](File_Format_Reference.md).

## What about Obsidian?

The format matches Obsidian's Bases format; Plainva writes its extensions exclusively into `plainva:` sub-keys, which Obsidian ignores ("graceful degradation"):

- Obsidian opens the file without errors; Plainva-only views such as Board/Calendar/Timeline appear there as a plain table.
- Reverse-relation columns appear empty in Obsidian (they are computed); relation values in notes are visible there as clickable links.
- The first time you use a Plainva extension, a dialog (**Plainva extension**) points this out; it can be disabled under **Settings** via **Extended databases** or **Warnings**.

## See also

- [File Format Reference](File_Format_Reference.md) — the exact on-disk `.base` contract for tools and hand-editing
- [Notes & Markdown](Notes_and_Markdown.md) — properties/frontmatter in detail
- [OKF](OKF.md) — what a uniform `type` buys you in practice
