# File Format Reference

Last reviewed: 2026-07-07

This page is the precise, on-disk contract for **every file in a Plainva vault**. It is written so that a tool — or another program, script or AI assistant — can read and safely edit vault files directly, without going through Plainva's user interface. If you only use the app, you never need this page; the [other guide pages](README.md) cover normal use.

Everything here is plain UTF-8 text. Notes are Markdown with YAML frontmatter; databases are YAML. Nothing is proprietary and nothing is hidden.

## Golden rules (read first)

1. **The note is the source of truth. A `.base` is only a view.** Property *values* live in the frontmatter of the individual notes — never inside the `.base`. To change a value, edit the note.
2. **Notes stay Obsidian-native.** In note frontmatter, only ever write plain scalars and lists (string, number, boolean, ISO date, YAML list). Never write a nested object or an "active/selected" flag into a note.
3. **A `.base` uses only Obsidian's four top-level keys** (`filters`, `formulas`, `properties`, `views`). Adding any other top-level key makes Obsidian reject the whole file. All Plainva-specific data goes under nested `plainva:` sub-keys.
4. **Preserve what you do not understand.** Unknown keys must survive a read/write round-trip unchanged. Do not "clean up" keys you do not recognize.
5. **Write UTF-8 without BOM, with LF line endings.**

## The vault at a glance

A vault is an ordinary folder. The file types you will meet:

| File | What it is | Editable as text |
|---|---|---|
| `*.md` | A note: YAML frontmatter + Markdown body | Yes |
| `*.base` | A database view over notes (YAML) | Yes |
| `index.md` | A folder's managed table of contents (reserved name) | Yes, with care — see [index.md](#indexmd-folder-table-of-contents) |
| `log.md` | Reserved name, currently unused | Leave alone |
| images, PDFs, … | Attachments | No (binary) |
| `.plainva/` | Plainva's internal folder (backups, state) | **No — never touch** |

Reserved names `index.md` and `log.md` are never regular notes; do not create ordinary content under those names.

---

## Notes (`.md`)

A note is a Markdown file. An optional YAML frontmatter block (between two `---` lines) at the very top holds its properties; the Markdown body follows.

```markdown
---
type: Note
okf_version: "0.1"
tags: [project, active]
status: In progress
due: 2026-07-20
plainva:
  icon: "🚀"
  header_color: "#2f6f6f"
---
# My Project

A **bold** thought that links to [[Another Note]].

- [ ] First task
```

### OKF frontmatter fields

Plainva follows OKF (Open Knowledge Format), a minimal convention. Two top-level fields:

| Field | Type | Meaning |
|---|---|---|
| `type` | string | What kind of document this is (`Note`, `Daily Note`, `Project`, …). The only field OKF actually requires. |
| `okf_version` | string | The convention version the file was written against, e.g. `"0.1"`. Quote it so YAML keeps it a string. |

A file **without** `type` still opens fine; it is simply "not OKF-conformant". A missing `okf_version` alone is not a violation. When you create a new note, adding `type` (and `okf_version`) is good practice. See [OKF](OKF.md) for the full rationale.

### Property value serialization

Each frontmatter key is one property. Write the value in the native YAML form for its type:

| Property type | YAML form | Example |
|---|---|---|
| Text | scalar string | `title: Hello` |
| Number | number | `priority: 3` |
| Checkbox | boolean | `done: true` |
| Date | ISO date string | `due: 2026-07-20` |
| Date & time | ISO datetime string | `at: 2026-07-20T14:30:00` |
| List | YAML list of strings | `authors: [Ada, Alan]` |
| Tags | YAML list of strings | `tags: [project, active]` |
| Select / Status | single scalar string | `status: Done` |
| Multi-select | YAML list of strings | `labels: [urgent, later]` |
| URL / Email / Phone | scalar string | `site: https://example.org` |
| Relation (single) | wiki-link **string** | `project: "[[Project Alpha]]"` |
| Relation (multiple) | YAML list of wiki-link strings | `related: ["[[A]]", "[[B]]"]` |

The "active" value of a Select/Status property is just that plain scalar. The *palette of allowed options* and their colors do **not** live in the note — they live in the governing `.base` (see [Options and colors](#options-and-colors)). This keeps the note 100 % Obsidian-native.

> Quote wiki-link values (`"[[X]]"`). Unquoted `[[X]]` is a YAML flow sequence and will not parse as you intend.

### The `plainva:` namespace in notes

Presentation-only extras are bundled under a single `plainva:` key so other editors can ignore them:

| Key | Value | Meaning |
|---|---|---|
| `icon` | emoji grapheme, or `lucide:<kebab-name>` | Document icon (Notion-style) |
| `icon_color` | hex color (`#rgb` / `#rrggbb` / `#rrggbbaa`) | Tint for a `lucide:` icon (emoji ignore it) |
| `header_color` | hex color | Full-width header stripe |

All three are optional. If you write none of them, omit the `plainva:` key entirely. Invalid values are ignored on read, never treated as an error.

### Links

- **Wiki link:** `[[Note name]]` — resolved by note name across the vault. With a heading anchor: `[[Note#Section]]`. With display text: `[[Note|shown text]]`.
- **Markdown link:** `[text](relative/path.md)` also works.
- **Backlinks** are derived automatically, including from frontmatter wiki-links (that is what makes relations show up as backlinks).

---

## Databases (`.base`)

A `.base` file is YAML. It stores a *view* over notes — which notes (sources), how to show them (views), how to filter and sort, and the column schema. It stores **no note values**. The format is compatible with Obsidian's Bases plugin.

### Hard rules — break one and Obsidian rejects the whole file

- **Only these top-level keys:** `filters`, `formulas`, `properties`, `views`. Never add another top-level key. (Historically a top-level `columns:` key broke every file — do not reintroduce that pattern.)
- **Every view needs a non-empty string `name`.**
- **A `filters` object carries exactly one of `and` / `or` / `not` at each level** — never two side by side.

Plainva itself heals older files that violate the last two rules the next time it saves them, but a tool writing directly must get them right.

### Property identifiers: when to use the `note.` prefix

This trips people up, so it is explicit:

| Where | Form | Example |
|---|---|---|
| Keys of the `properties:` map | prefixed | `note.status`, `file.name` |
| A view's `order:` list | prefixed | `[file.name, note.status]` |
| A view's `sort[].property` | prefixed | `note.due` |
| Inside **filter** expressions | **bare** | `status == "Done"` |
| Inside `plainva` sub-keys (`groupBy`, `dateField`, `endField`, `subItemsProperty`) | **bare** | `groupBy: status` |

Rule of thumb: the *Obsidian-facing* structural fields use `note.<key>` (and `file.<x>` for built-ins like `file.name`, `file.folder`, `file.mtime`); everything inside a **filter formula** or a **`plainva` block** uses the bare frontmatter key.

### Top-level keys

- **`filters`** — which notes belong to this database. In Plainva this holds only the **sources** (folder/tag); property filter conditions are stored per view under `views[i].filters`. See [Filters](#filters).
- **`properties`** — the column schema, keyed by property id. Native Obsidian sub-keys like `displayName` (column header label) are allowed and preserved; all Plainva richness lives under `properties[id].plainva`.
- **`views`** — an ordered list of views. Each needs a `name` and a `type`.
- **`formulas`** — an Obsidian feature. Plainva does not author these but preserves them untouched.

### The `plainva:` sub-key map

Everything Plainva-specific is namespaced. Three locations:

**`properties[<note.key>].plainva`** — per column:

| Key | Value | Meaning |
|---|---|---|
| `input` | one of the input types below | The column's field type |
| `options` | list of option objects | Curated values for select/status/multiselect |
| `relationBase` | vault-relative `.base` path | Relation target database (see [Relations](#relations-the-two-sided-contract)) |
| `relationLimit` | `one` | Cardinality: single link. Omit for unlimited. |
| `reverseOf` | `{ base, property }` | Marks a **computed reverse-relation** column (no `input`) |

**`views[i].plainva`** — per view:

| Key | Value | Meaning |
|---|---|---|
| `render` | `board` / `calendar` / `timeline` | Plainva-only view kind (see below) |
| `groupBy` | bare property key | Board grouping column |
| `dateField` | bare property key | Calendar/timeline start date |
| `endField` | bare property key | Timeline end date |
| `coverImage` | bare property key | Gallery cover-image property |
| `subItemsProperty` | bare property key | Self-relation parent column for sub-item nesting |
| `widths` | map of id → px | Column widths |
| `dateFormat` | string | Per-view date format (`default` is implicit — omit it) |

Besides the `plainva` block, a view may carry a native **`views[i].filters`** object — the **per-view property filters** (same single-rooted `and`/`or`/`not` grammar as the file-level `filters`). Plainva stores property filter rules here, one set per view, so each view filters independently; the file-level `filters` then keeps only the sources. Obsidian applies `views[i].filters` per view natively.

**`views[0].plainva`** — file-wide keys, allowed **only on the first view**:

| Key | Value | Meaning |
|---|---|---|
| `fileIconColor` | hex color | Tint of the database icon (tree/tabs/header) |
| `newItemFolder` | vault-relative folder | Where the "New" button stores new items |
| `newItemTemplate` | vault-relative `.md` path | Default template for new items |
| `contextFilters` | list of bare property keys | Self-reference ("this note") filters — see below |

`contextFilters` is Plainva's equivalent of Notion's "this page" filter. Each entry is a property key; when the database is embedded in a note, its rows are scoped to that host note through that property (resolved via the link index — an owning/plain-link property matches rows pointing at the host, a computed reverse column matches what the host points at). It is deliberately **not** written into the native `filters`, so Obsidian ignores it and shows all rows; opened standalone in Plainva it is also dropped (no host) and shows all rows. Multiple entries AND-combine.

### Input types

`plainva.input` is one of:

```
text  number  checkbox  date  datetime
select  status  multiselect
list  tags  url  email  phone
relation
```

A computed **reverse** column has **no** `input` — it is identified solely by `reverseOf`.

### Options and colors

Select/Status/Multi-select columns may carry a curated option list. Each option:

```yaml
options:
  - value: Open          # required
    color: amber         # optional palette name (see below)
    group: Active        # optional; STATUS only — orders options into stages
  - value: Done
    color: green
    group: Closed
```

`color` is a **palette name**, not a CSS color. Valid names: `gray`, `teal`, `blue`, `green`, `amber`, `coral`, `purple`, `pink`. An unknown color falls back to a value-derived color.

### View types

`views[i].type` on disk is a native Obsidian type. Plainva-only renders are written as `type: table` plus a `plainva.render` hint, so Obsidian degrades them to a plain table:

| You want | On-disk `type` | `plainva.render` |
|---|---|---|
| Table | `table` | — |
| List | `list` | — |
| Gallery | `cards` | — |
| Board | `table` | `board` |
| Calendar | `table` | `calendar` |
| Timeline | `table` | `timeline` |

### Filters

`filters` selects which notes are in the database and narrows them.

**Source conditions** decide membership:

- Folder: `file.folder == "Path/To/Folder"` (vault-relative; the root folder is `""`).
- Tag: `file.hasTag("project")` (no leading `#`).

Multiple sources are just multiple entries. No `filters` at all = every note in the vault.

**Where property conditions live:** at the file level, `filters` applies to every view. Plainva instead stores property filter rules **per view** in `views[i].filters` (same single-rooted structure) and keeps only the sources at the file level, so each view can filter independently. Both are valid Obsidian; a tool may write either. A legacy file with property conditions at the file level still works — Plainva distributes them into each view on the next save.

**Property conditions** use bare property names and these operators:

| Operator | Expression |
|---|---|
| equals | `status == "Done"` |
| not equals | `status != "Done"` |
| contains | `contains(labels, "urgent")` |
| does not contain | `!contains(labels, "urgent")` |
| greater / less | `priority > "2"`, `priority < "5"` |
| at least / at most | `priority >= "2"`, `priority <= "5"` |
| is empty | `status == ""` |
| is not empty | `status != ""` |

**Structure (single-rooted!):** one of `and` / `or` / `not`, whose entries are condition strings — or one level of nested `{and:[...]}` / `{or:[...]}` group objects (Notion-style groups). Example combining a source, a condition and an OR group:

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
    - 'status != "Done"'
    - or:
        - 'priority == "1"'
        - 'priority == "2"'
```

### A complete annotated `.base`

```yaml
filters:
  and:
    - 'file.folder == "Projects"'          # source: notes in the Projects folder
properties:
  note.status:                             # column id is note.-prefixed
    displayName: Status                    # optional Obsidian column label
    plainva:
      input: status
      options:
        - value: Open
          color: amber
          group: Active
        - value: Done
          color: green
          group: Closed
views:
  - type: table                            # first view: also carries file-wide keys
    name: All projects                     # every view needs a name
    order: [file.name, note.status]        # order uses note.-prefixed ids
    plainva:
      fileIconColor: "#2f6f6f"
      newItemFolder: Projects
  - type: table                            # a board is a native table + render hint
    name: Board
    plainva:
      render: board
      groupBy: status                      # groupBy uses the BARE key
```

---

## Relations (the two-sided contract)

A relation links notes to each other. This is the most error-prone thing to author by hand, because it spans **three** places. Get all three consistent.

1. **The value lives in the source note's frontmatter**, as a wiki-link (or a list of them):

   ```markdown
   ---
   type: Task
   project: "[[Project Alpha]]"
   ---
   ```

2. **The source `.base` declares the relation column** (`relationBase` = the target database; `relationLimit: one` for a single link):

   ```yaml
   properties:
     note.project:
       plainva:
         input: relation
         relationBase: Projects.base
         relationLimit: one
   ```

3. **The target `.base` may show the reverse** with a **computed** column. Its values are **not** stored anywhere — they are derived from the source notes' links:

   ```yaml
   properties:
     note.tasks:
       plainva:
         reverseOf:
           base: Tasks.base       # the source .base (vault-relative path)
           property: project      # the BARE source property key
   ```

### Worked example: Tasks ↔ Projects

**`Tasks.base`**

```yaml
filters:
  and:
    - 'file.folder == "Tasks"'
properties:
  note.status:
    plainva:
      input: status
      options:
        - value: Open
          color: amber
        - value: Done
          color: green
  note.project:
    plainva:
      input: relation
      relationBase: Projects.base
      relationLimit: one
views:
  - type: table
    name: All tasks
    order: [file.name, note.status, note.project]
```

**`Projects.base`**

```yaml
filters:
  and:
    - 'file.folder == "Projects"'
properties:
  note.tasks:
    plainva:
      reverseOf:
        base: Tasks.base
        property: project
views:
  - type: table
    name: All projects
    order: [file.name, note.tasks]
```

**`Tasks/Write proposal.md`**

```markdown
---
type: Task
okf_version: "0.1"
status: Open
project: "[[Project Alpha]]"
---
# Write proposal
```

**`Projects/Project Alpha.md`**

```markdown
---
type: Project
okf_version: "0.1"
---
# Project Alpha
```

Result: in `Projects.base`, the computed `tasks` column of **Project Alpha** lists "Write proposal", because that task's `project` links back to it. Note that `Project Alpha.md` has **no** `tasks:` key — the reverse side is computed, never stored.

### Relation DON'Ts

- **Do not write reverse values into notes.** A `reverseOf` column is computed. Writing a `tasks:` key into `Project Alpha.md` is wrong and will not round-trip.
- **Make link targets resolve.** `"[[Project Alpha]]"` must match an existing note name, or the link shows as broken.
- **Keep paths vault-relative** with forward slashes and no leading `./` (`Projects.base`, `DB/Projects.base`).
- **`reverseOf.property` is the bare source key** (`project`), not `note.project`.

### Self-relations and sub-items

For a relation whose target is the same database, point `relationBase` at that same `.base`. To nest children under parents in a table view, set `views[i].plainva.subItemsProperty` to the bare parent-relation key. Cycles are handled; with sub-items off, the rows stay flat and the values are kept.

---

## `index.md` (folder table of contents)

`index.md` is a reserved name for a folder's table of contents.

- **Only the root `index.md` may carry frontmatter**, and only `okf_version` (it marks the vault as OKF-active). A non-root `index.md` must be **frontmatter-free** — frontmatter there is a reserved-name violation.
- A Plainva-**managed** `index.md` ends with the marker `<!-- plainva:index generated -->` (an HTML comment, invisible in reading view). Its presence means Plainva keeps the file up to date automatically. If you hand-edit such a file, either preserve the marker (and keep the generated shape) or remove it deliberately to take over the file permanently.
- Generated listings are sections of links in the form `* [Title](relative/url) - description`.

If you are generating a folder overview by hand, the safe choice is to **not** add the marker — then Plainva will never overwrite it.

---

### Graph views (`plainva.render: "graph"`)

A graph view is stored like every non-native view: `type: table` plus the render hint. Its options live in the SAME `views[i].plainva` namespace:

```yaml
views:
  - type: table
    name: Net
    plainva:
      render: graph
      graphEdges: [projekt]        # relation property keys drawn as edges
      graphColorBy: status         # select/status property -> node color
      graphSizeBy: prio            # number property -> node size
      graphShowExternal: true      # include relation targets outside the view
      graphShowIncoming: true      # include relations from OTHER databases pointing in (e.g. a project's tasks)
```

All graph option keys are optional; omit them entirely when unset. Obsidian renders the same file as a plain table and must not error.

A **board** view (`plainva.render: "board"`) may additionally carry `views[i].plainva.boardColumnOrder` — a list of group-column keys (`__UNGROUPED__` marks the no-value column) that remembers a manual column order. Select/Status boards instead reorder the property's `options`. Omit the key when unset.

## Do-not-touch and safety

- **`.plainva/`** holds backups and internal state. Never read program logic into it or write to it.
- **Unknown keys are sacred.** When you rewrite a `.base` or a note, carry through every key you did not intend to change. Plainva itself preserves unknown `.base` keys via an internal raw copy; a third-party writer should do the same (parse → change only what you mean → serialize).
- **Values change in the note, not the `.base`.** To set a cell, edit the note's frontmatter. The `.base` only decides which notes and columns are shown.
- **Do not add top-level `.base` keys** beyond `filters` / `formulas` / `properties` / `views`.
- **Encoding:** UTF-8 without BOM, LF newlines, everywhere.

## See also

- [Notes & Markdown](Notes_and_Markdown.md) — the same material from a writing-by-hand-in-the-app angle
- [Databases (.base)](Databases_Base.md) — databases explained for everyday use
- [OKF](OKF.md) — `type`, `okf_version`, index.md and the vault conversion
