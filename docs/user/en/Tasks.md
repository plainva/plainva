# Tasks

Last reviewed: 2026-07-15

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

## Obsidian compatibility

Tasks are ordinary GFM (GitHub-Flavored Markdown) checkboxes. Plainva never adds a special syntax: the same `- [ ]` lines render as checkboxes in Obsidian and read cleanly in any editor. The `📅 date` and `#tag` conventions are the common Obsidian-Tasks style, but they are just text in your note.

## See also

- [Notes & Markdown](Notes_and_Markdown.md) — writing task lists in the editor
- [Search](Search.md) — full-text search across the vault
- [Databases (.base)](Databases_Base.md) — note-level databases
