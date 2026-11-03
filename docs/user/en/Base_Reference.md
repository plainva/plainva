# Database Reference (.base)

Last reviewed: 2026-11-03

This page lists everything a `.base` file can contain and what Plainva does with each part: every top-level key, every filter form, every view type with its options, summaries, sorting, limits, what happens to keys Plainva does not know, and where Plainva behaves differently from Obsidian Bases. It describes what Plainva's code reads, evaluates and writes today — not Obsidian's documentation.

For everyday use, read [Databases (.base)](Databases_Base.md) first. The rules a tool must keep when it writes vault files directly, and the full relation example, are in the [File Format Reference](File_Format_Reference.md).

## At a glance

| Part of the file | What Plainva does |
|---|---|
| `filters` | Reads and applies the sources (folder, tag) and the conditions listed under [Filters](#filters) |
| `views` | Reads all eight view types, their order, sort, filters and summaries |
| `properties` | Reads the column schema, the display name and Plainva's `plainva` block |
| `summaries` (view) | Computes the fourteen built-in summaries |
| `formulas` | Keeps them in the file, does not compute them |
| `summaries` (top level) | Keeps custom summary formulas, does not compute them |
| `this` | Not supported yet |
| Other keys | Keeps them in the file (see [Keys Plainva does not know](#keys-plainva-does-not-know)) |

## Top-level keys

A `.base` file is YAML with these top-level keys. All of them are optional; a file without `views` opens with one table.

| Key | Content | In Plainva |
|---|---|---|
| `filters` | Which notes belong to the database (sources) | Read and applied |
| `properties` | One entry per column, keyed by the property id | Read; Plainva's additions live in its `plainva` block |
| `views` | The list of views | Read; every view needs a `name` |
| `formulas` | Obsidian formulas, `name: expression` | Kept unchanged, not computed |
| `summaries` | Obsidian custom summary formulas | Kept unchanged, not computed |

Plainva never writes another top-level key: Obsidian refuses to open a `.base` with a key it does not know. A top-level `columns:` key written by very old Plainva versions is still read and moved into `properties` the next time the file is saved.

## Properties (`properties`)

### Property ids

A property id names a column. Three kinds exist:

| Id | Means | Example |
|---|---|---|
| `note.<key>` | A key of the notes' frontmatter | `note.status` |
| `file.<field>` | A fact about the file (see [File fields](#file-fields-file)) | `file.mtime` |
| `formula.<name>` | An Obsidian formula from `formulas` | `formula.price_per_unit` |

The keys of `properties`, a view's `order` and `sort[].property` use these ids. Inside a filter expression and inside a `plainva` block a frontmatter key is written bare (`status`); a filter expression understands `note.status` as well.

When a note writes a key in a different case than the column (`Due` against the column `due`), Plainva still shows the value in that column and writes changes back under the note's own spelling.

### Display name

`properties.<id>.displayName` is Obsidian's column label. Plainva shows it as the column header and keeps it. Without it a frontmatter key is shown with a capital first letter (on screen only); the file fields have their own names, for example **Name**, **Modified**, **Size**, **Path**, **Checklist** and **Day from the file name**.

### The `plainva` block of a column

Everything Plainva adds to a column lives under `properties.<id>.plainva`. Obsidian ignores it.

| Key | Value | Meaning |
|---|---|---|
| `input` | a field type (list below) | The column's field type |
| `ratingMax` | number, 1 to 10 | How many marks a rating has (default 5) |
| `ratingGlyph` | one character | The mark a rating draws (default a dot) |
| `options` | list of options | Fixed values for select, status and multi-select |
| `relationBase` | vault-relative `.base` path | The database a relation points into |
| `relationLimit` | `one` | A relation holds exactly one link; absent means no limit |
| `reverseOf` | `{ base, property }` | A computed reverse-relation column |
| `rollup` | `{ through, of, fn, where }` | A computed rollup column (see [Rollups](#rollups)) |
| `previousKeys` | list of up to 8 former names | Lets comments find a renamed column again |

### Field types (`input`)

`text`, `number`, `rating`, `checkbox`, `date`, `datetime`, `select`, `status`, `multiselect`, `list`, `tags`, `url`, `email`, `phone`, `relation`.

Two older spellings are read as well: `multi-select` as `multiselect`, and `link` as `relation`. A column without `input` — or with a value not in this list — gets its type from the values in the notes: `true`/`false` is a checkbox, a number a number, a list of `[[links]]` a relation, `2026-07-03` a date, a web address a URL, and so on. A reverse-relation column and a rollup column have no `input`.

### Options and colours

An option is `{ value, label, color, group }`; only `value` is required. `color` is one of the palette names `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink` — an unknown name falls back to a colour derived from the value. `group` is used by **Status** only: options with the same group form a stage. A plain string is read as an option with that value.

### Rollups

A rollup column computes a value from the notes a link column of this database points at. The value is stored in no file.

- `through` — a relation or reverse-relation column of this database.
- `of` — a property of the linked notes; not needed for `count`.
- `fn` — one of `count`, `countWhere`, `percentWhere`, `sum`, `average`, `median`, `min`, `max`, `earliest`, `latest`, `checked`, `unchecked`, `empty`, `filled`, `unique`.
- `where` — `{ op, value }`, required by `countWhere` and `percentWhere`; `op` is one of `==`, `!=`, `contains`, `notContains`, `>`, `<`, `>=`, `<=`, and an empty `value` means "is empty".

A rollup that misses a required part, or names a function not in this list, is ignored: the column stays empty and the database still opens. A rollup through another computed column stays empty too.

## File fields (`file.*`)

These values come from the file, not from its frontmatter. Each row of a database carries the following:

| Field | Value |
|---|---|
| `file.name` | The note's `title` property if it has one, otherwise the file name without `.md` |
| `file.path` | The vault-relative path |
| `file.mtime` | Last modified, in milliseconds |
| `file.ctime` | Created, in milliseconds, where the file system reports it |
| `file.size` | Size in bytes |
| `file.tags` | All tags of the note, frontmatter and text, each with `#`; filled when a filter or a pinboard needs them |
| `file.tasks` | Checkbox progress as `done/total`; filled for boards and for a view that shows the column |
| `file.day` | The day a daily note's file name stands for, by the vault's folder and format; read-only, and only the date field of a calendar or timeline can use it |
| `file.revision` | An internal change marker; do not rely on it |

`file.folder` works as a source (see [Sources](#sources)) but is no column. `file.basename`, `file.ext`, `file.links`, `file.backlinks`, `file.embeds`, `file.properties` and `file.file` are not provided: a column with one of them stays empty, and a filter reads them as empty.

## Filters

### Where filters live

The top-level `filters` holds the **sources** — which notes belong to the database. Every view can carry its own `filters` with conditions that narrow that view only; Plainva writes the conditions there. Both levels apply together. Conditions a file keeps at the top level still work; the next save in Plainva moves them into each view.

### Sources

| Source | Expression |
|---|---|
| Folder | `file.folder == "Projects/Active"` — the folder and all its subfolders; `"/"` is the whole vault |
| Tag | `file.hasTag("project")` — the note carries exactly this tag; a leading `#` is ignored |

Several sources combine with `and` or `or` like any other condition. A database without sources contains every note of the vault. Attachments, the reserved `index.md` and `log.md`, and files or folders whose name starts with a dot are never rows.

### Conditions

A condition is a string. Values are in double quotes; `\"` and `\\` escape a quote and a backslash. The property is written bare or with `note.`.

| Condition | Expression |
|---|---|
| is | `status == "Done"` |
| is not | `status != "Done"` |
| contains | `contains(labels, "urgent")` or `labels.contains("urgent")` |
| does not contain | `!contains(labels, "urgent")` or `!labels.contains("urgent")` |
| greater than, less than | `effort > "3"`, `effort < "8"` |
| at least, at most | `due >= "2026-07-01"`, `due <= "2026-07-31"` |
| is empty | `status == ""` or `status.isEmpty()` |
| is not empty | `status != ""` or `!status.isEmpty()` |
| has a tag | `file.tags.contains("#work")`, negated with `!` |
| header colour, icon | `note.plainva.header_color == "#2a7f7b"`, `note.plainva.icon == "lucide:pin"` |

### How values compare

- **is** and **is not** compare text. On a list (tags, multi-select, relation) **is** means "the list has this entry", **is not** "it does not". A note without the property never matches **is** and always matches **is not**.
- **contains** looks for the text inside the value, or inside each entry of a list. `labels.contains("x")` on a list wants an entry that is exactly `x`; on `file.tags` both forms want the whole tag, so `#work` does not match `#workshop` or `#work/child`.
- **greater than**, **less than**, **at least**, **at most** compare as numbers when both sides are numbers, otherwise as text — which puts ISO dates (`2026-07-03`) in the right order. A note without a value never matches them.
- **is empty** matches a missing property, an empty value and an empty list.
- A checkbox compares as `"true"` or `"false"`.

### `and`, `or`, `not`

A `filters` object has exactly one of `and`, `or` and `not` on each level; its entries are condition strings or further filter objects.

| Key | Matches when |
|---|---|
| `and` | every entry matches |
| `or` | at least one entry matches |
| `not` | no entry matches |

Plainva evaluates any depth. The filter panel edits one level of groups under **All** or **Any** (**Add group**); a deeper structure appears as **Complex filter (not editable)**, stays in the file and is applied. An older file with `and` and `or` side by side on one level is read as "all of `and` and one of `or`" and written in the valid form on the next save.

### What Plainva cannot read

Only the forms in the two tables above are understood. Anything else — `file.inFolder(…)`, `file.hasLink(…)`, `file.hasProperty(…)`, a number without quotes (`price > 2`), `&&` and `||` inside one string, arithmetic, date functions such as `now()`, or `this` — stays in the file and is shown in the filter panel as written, but Plainva does not apply it. The view then shows more notes than the same filter does in Obsidian.

## Formulas

Plainva does not compute Obsidian formulas. `formulas` stays in the file unchanged, and a `formula.<name>` column in a view's `order` is shown without values. **Export table** → **Formulas (.base)** writes some rollups as formulas so that Obsidian can compute them (see [Databases](Databases_Base.md)).

## Views

### Keys of every view

| Key | Value | In Plainva |
|---|---|---|
| `type` | `table`, `list`, `cards` | The view type; see the next table |
| `name` | text | Required; Plainva gives a view without one a name when it saves |
| `order` | list of property ids | The visible columns, in this order |
| `sort` | list of `{ property, direction }` | Sort rules, `ASC` or `DESC` |
| `filters` | filter object | The view's own conditions |
| `summaries` | map of property id → summary name | The footer of each column |
| `plainva` | map | Plainva's view options, below |

### The eight view types

Obsidian knows `table`, `list` and `cards`. Plainva's other view types are stored as `type: table` plus `plainva.render`, so Obsidian shows them as a table.

| View type | `type` on disk | `plainva.render` |
|---|---|---|
| **Table** (`table`) | `table` | — |
| **List** (`list`) | `list` | — |
| **Gallery** (`gallery`) | `cards` | — |
| **Board** (`board`) | `table` | `board` |
| **Calendar** (`calendar`) | `table` | `calendar` |
| **Timeline** (`timeline`) | `table` | `timeline` |
| **Graph** (`graph`) | `table` | `graph` |
| **Pinboard** (`pinboard`) | `table` | `pinboard` |

Board, Calendar, Timeline, Graph and Pinboard are offered as a **View type** only while **Allow Plainva extensions for .base files** is on. A `type` Plainva does not know is shown as a table.

### View options (`views[i].plainva`)

Inside the `plainva` block a property is written bare (`status`), not as `note.status`.

| Key | View types | Value |
|---|---|---|
| `render` | Board, Calendar, Timeline, Graph, Pinboard | The view type, see above |
| `groupBy` | Board | The property the columns are made of |
| `boardLaneBy` | Board | A second property for **Swimlanes by** |
| `boardWipLimits` | Board | Map of column value → most cards (**WIP limit**), whole numbers above 0 |
| `boardColorMode` | Board | `column` tints the whole column; absent = only the header chip |
| `boardColumnOrder` | Board | Manual column order; `__UNGROUPED__` is the column without a value |
| `colorBy` | Board, Timeline | Cards and bars take this property's option colour (**Colour by**) |
| `dateField` | Calendar, Timeline | The start date (**Date field**, **Start date**); a date property or `file.day` |
| `endField` | Calendar, Timeline | The **End date** |
| `coverImage` | Gallery | The property holding the **Cover image** |
| `subItemsProperty` | Table | The parent relation for **Sub-items** |
| `widths` | Table | Map of column → width in pixels |
| `dateFormat` | all | `long`, `iso` or `relative`; absent = the default short form |
| `graphEdges` | Graph | Relation properties drawn as edges |
| `graphColorBy` | Graph | A select or status property that colours the nodes |
| `graphSizeBy` | Graph | A number property that sizes the nodes |
| `graphShowExternal` | Graph | `true` also shows link targets outside the view |
| `graphShowIncoming` | Graph | `true` also shows links coming in from other databases |
| `pinboardOrder` | Pinboard | Paths of the unpinned cards, in manual order |
| `pinboardPinned` | Pinboard | Paths of the pinned cards, in order |
| `pinboardFilterBy` | Pinboard | **Label source**: a multi-select property; absent = tags |

### File-wide options (first view only)

These keys belong to the whole database. Plainva writes them into the `plainva` block of the first view only and reads the first valid value of each.

| Key | Value |
|---|---|
| `fileIconColor` | Hex colour of the database icon (**Database icon color**) |
| `newItemFolder` | Folder where **Entry** stores new entries |
| `newItemTemplate` | Template for new entries |
| `contextFilters` | Properties that limit an embedded database to the note it is embedded in (**This note**) |
| `taskList` | Account and list (`"<account id> <list id>"`) a new task is also created in |

## Summaries

`views[i].summaries` maps a column to one of these names; the footer computes it over the rows the view shows.

| Name | In Plainva | Result |
|---|---|---|
| `Average` | **Average** | Mean of the numbers |
| `Min` | **Min** | Smallest number |
| `Max` | **Max** | Largest number |
| `Sum` | **Sum** | Total of the numbers |
| `Range` | **Range** | Largest minus smallest number; for dates the span in days |
| `Median` | **Median** | Middle value of the numbers |
| `Stddev` | **Std dev** | Standard deviation of all numbers (population) |
| `Earliest` | **Earliest** | Earliest date |
| `Latest` | **Latest** | Latest date |
| `Checked` | **Checked** | Rows whose value is `true` or `yes` |
| `Unchecked` | **Unchecked** | All other rows |
| `Empty` | **Empty** | Rows without a value |
| `Filled` | **Filled** | Rows with a value |
| `Unique` | **Unique** | Number of different values; list entries count one by one |

Numbers are rounded to two decimals, and a decimal comma is read as well. A column without a usable value shows no footer rather than 0. Any other name is a custom formula from the top-level `summaries`: Plainva keeps it and shows **Custom: …** in the menu, but computes no value.

## Sorting and grouping

- **Sort** — `sort` is a list of rules; the first rule decides first, the next one only between equal rows. Numbers sort as numbers, everything else as text (ISO dates in the right order). Rows without a value come last in both directions. Without a rule, the most recently changed notes come first. Plainva also reads `field` for `property`, and `asc`/`desc` in any case.
- **Grouping** — the board groups by `plainva.groupBy`, with swimlanes by `plainva.boardLaneBy`. Obsidian's own `groupBy` of a view is kept in the file, but Plainva does not group a table by it.

## Embedding a database, and `this`

`![[Projects.base]]` in a note shows the database inside the note, in reading view and in the editor. A part after `#` (a view name, as in `![[Projects.base#Board]]`) is ignored: the embed shows the view last used for this database. A ` ```base ` code block in a note is shown as code, not as a database.

**`this` is not supported yet.** A filter or formula that uses `this` stays in the file, but Plainva does not evaluate it. Two things cover the most common case, "show the entries that belong to this note": `contextFilters` (**This note** in the filter panel) limits an embedded database to the note it is embedded in through a relation property, and an embedded database that relates to the database of its host note offers **Filter this database to the current note** by itself. Both act only inside Plainva; Obsidian shows all rows.

## Limits

- Obsidian's `limit` of a view is kept but not applied: a view shows all its rows.
- The filter panel edits one level of filter groups; deeper ones are applied but can only be deleted there.
- A filter value must be in double quotes (see [What Plainva cannot read](#what-plainva-cannot-read)).
- A folder source always includes the subfolders.
- `ratingMax` is drawn between 1 and 10, `previousKeys` keeps at most 8 names, a **WIP limit** only takes whole numbers above 0, and `relationLimit` only knows `one`.
- A rollup cannot compute over another computed column.

## Keys Plainva does not know

Plainva reads a `.base`, changes only what you changed in the app, and writes the whole file anew — as YAML with LF line endings and without a BOM, so comments and the spacing of a hand-written file are not kept. Of what it does not know:

- **Kept:** any other top-level key, `formulas`, the top-level `summaries`, `displayName` and every other key of a `properties` entry outside its `plainva` block, the keys of a view Plainva does not use (`limit`, `groupBy`, `image`, …), unknown keys in a view's `plainva` block, and filter conditions it cannot read.
- **Not kept:** keys in a column's `plainva` block that this version of Plainva does not know, and a rollup it cannot read — both are gone after the next save. A view of a type Plainva does not know is written back as `type: table`.
- **Position:** the keys a view keeps belong to its place in the list. Currently, deleting or moving a view in Plainva leaves them at the old place, where the next view receives them.

## Differences to Obsidian Bases

| Topic | Obsidian | Plainva |
|---|---|---|
| Formulas, custom summaries | Computed | Kept, not computed |
| `this` | Supported | Not supported yet |
| Filter expressions | The full expression language | The forms in [Conditions](#conditions) |
| `file.folder == "X"` | Only notes directly in `X` | `X` and all its subfolders |
| `file.hasTag("x")` | Also `#x/child` | Exactly `#x` |
| `file.name` | The file name | The `title` property if the note has one |
| View `limit`, `groupBy` | Applied | Kept, not applied |
| View types | `table`, `list`, `cards` and plugin types | Eight types; unknown ones as a table |
| `![[db.base#View]]` | Opens that view | The view last used |
| ` ```base ` code block | A database | A code block |
| Plainva's `plainva` blocks | Ignored | Board, calendar, timeline, graph, pinboard, relations, rollups, field types |

## See also

- [Databases (.base)](Databases_Base.md) — databases in everyday use
- [File Format Reference](File_Format_Reference.md) — the on-disk rules for tools, relations in both directions, `index.md`
- [Notes & Markdown](Notes_and_Markdown.md) — properties in a note
