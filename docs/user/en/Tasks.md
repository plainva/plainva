# Tasks

Last updated: 2026-07-22

The Tasks view collects every checkbox in your vault into one place: all the `- [ ]` and `- [x]` list items across all your notes, grouped by the note they live in. It is the "what do I still have to do?" view over plain Markdown — no plugin, no special file.

## Why a separate view (and not a `.base`)

A [database (`.base`)](Databases_Base.md) works on whole notes — one row per note. A checkbox is a single *line* inside a note, and a note can hold many of them, so a `.base` cannot list them. The Tasks view is line-based: it reads the task lines directly, so a single project note with ten sub-tasks shows all ten.

## Opening the Tasks view

- Click the **checklist icon** in the action rail on the far left, or
- open the **command palette** (`Ctrl/Cmd+P`) and run **Open tasks**.

It opens as a tab, like any note.

## Reading the list

Tasks are grouped by note; the note title is a heading you can click to open the note. Each task shows its checkbox and its text, with a strike-through once it is done. A **due date** written as `📅 2026-08-01` in the task line appears as a small badge.

## Filtering

The bar at the top narrows the list:

- **Open / Done / All** — by checkbox state (starts on **Open**).
- **Filter tasks…** — free text; matches the task text.
- **All folders** — only tasks in the chosen folder (and its subfolders).
- **All tags** — only tasks carrying a chosen inline `#tag`.
- **With due date** — only tasks that have a `📅` date.

Tags and due dates are read straight from the task line — for example `- [ ] Pay invoice #finance 📅 2026-08-01`.

## Checking tasks off

Click a task's **checkbox** to toggle it between open and done. The change is written straight back to the note (as a normal, safe file write — only the single `[ ]`/`[x]` character changes), so the note, Obsidian and any sync stay in step. Click the task's **text** instead to open the note and jump to that line.

If a note changed since the list was built, an out-of-date toggle is skipped and the list refreshes — use the **refresh** button at the top right to reload at any time.

## Standard task database

Checkboxes are quick to jot down, but sometimes a line grows into a "real" task — with a status, a due date and a note of its own. For that, pick a **Standard task database** in Settings under **Content & structure**: a [database (`.base`)](Databases_Base.md) where such tasks live as their own notes. **Create new database…** scaffolds a ready-made one (storage folder plus a `.base` with a **done checkbox column** (`done`), a status column, a due column, a table and a board view); you can just as well pick an existing database. The checkbox property is a task's completion truth (on/off, like the providers'); the status column is kept consistent when you check it off. A database without a checkbox column falls back to the status convention: first option = open, last = done.

Once set, the Tasks view shows two sections: the entries of the **Task database** on top, and **From notes** below — the familiar checkbox list. The status is editable right in the overview: the checkbox IS the note's done checkbox property and toggles it (the status column follows), and clicking the status chip opens a menu with every option (**Change status**). The **Open**/**Done**/**All** filters apply to both sections, and **Open as database** jumps to the full database view with its board and filters. **Refresh** additionally triggers a real provider sync when accounts are connected.

## Turning a checkbox into a database task

Every checkbox row carries a database icon: **Move to the task database**. One click

- creates a new note in the database's storage folder (using its default template, if one is set),
- carries a `📅` date into the due column, sets the first status option for open tasks and stores the line's `#tags` as the note's tags,
- links the new note back to its origin note via a `source` property, and
- replaces the checkbox line in the origin note with a wiki link to the new task note — the item stays readable where it was written, and the task now lives in the database.

**Right-click** the icon to pick a different database as the target instead; without a standard database, the click opens that picker right away. Everything stays plain Markdown: the new task is an ordinary note with frontmatter, and the link in the origin note is a normal `[[wiki link]]`.

## Hiding notes from the Tasks view

Some notes hold checkboxes that are never "real" tasks — **templates** above all. To keep them out of the list, a note can exclude itself. The truth stays in the file: the exclusion is a frontmatter field in the note, not a hidden app setting. It syncs, is visible in Obsidian, and can be checked with any text editor:

```yaml
---
plainva:
  tasks: false
---
```

You do not have to write this field by hand:

- **Hide from tasks** — an eye icon sits at the right of each note's header row; one click writes the marker into that note and hides it.
- **Show hidden** — this option in the filter bar brings the hidden notes back (dimmed), each with an icon to **show it again** (which removes the marker).
- **Hide templates** — if your template folder holds notes with checkboxes, a **Hide templates** button appears at the top right and stamps the marker into all of them at once.

Newly created templates carry the marker automatically. When you create a note **from** a template, it is removed again — the new note is real content and shows its tasks normally.

## Obsidian compatibility

Tasks are ordinary GFM (GitHub-Flavored Markdown) checkboxes. Plainva never adds a special syntax: the same `- [ ]` lines render as checkboxes in Obsidian and read cleanly in any editor. The `📅 date` and `#tag` conventions are the common Obsidian-Tasks style, but they are just text in your note.

## See also

- [Notes & Markdown](Notes_and_Markdown.md) — writing task lists in the editor
- [Search](Search.md) — full-text search across the vault
- [Databases (.base)](Databases_Base.md) — note-level databases

## Completing a task from the overview

Checking a task in the overview writes the checkbox to its source note and refreshes that note in the search index before querying the list again. The task leaves **Open** immediately and cannot reappear from a stale index.
