# Tasks

Last updated: 2026-08-07
The Tasks view collects every checkbox in your vault into one place: all the `- [ ]` and `- [x]` list items across all your notes, grouped by the note they live in. It is the "what do I still have to do?" view over plain Markdown — no plugin, no special file.

## Why a separate view (and not a `.base`)

A [database (`.base`)](Databases_Base.md) works on whole notes — one row per note. A checkbox is a single *line* inside a note, and a note can hold many of them, so a `.base` cannot list them. The Tasks view is line-based: it reads the task lines directly, so a single project note with ten sub-tasks shows all ten.

## Opening the Tasks view

- Click the **checklist icon** in the action rail on the far left, or
- open the **command palette** (`Ctrl/Cmd+P`) and run **Open tasks**.

It opens as a tab, like any note.

## On the phone

The Tasks view exists on mobile too. You open it through the **▾** next to the title in the top bar, and you can place it in the navigation bar (**Settings** → **Navigation bar**).

It shows the same two sections as the desktop: the **task database** on top, the checkbox list under **From notes** below, with the **Open**/**Done**/**All** filters and the free-text search. Checking off, **Change status**, moving a checkbox **into the database**, **+ New task**, **Block time** and **Repeat** work as described above and write the same files: the same note with frontmatter, the same `[[wiki link]]` in the original line, the same rule under `plainva.repeat`.

Which database your vault uses as its task database is set on the phone under **Settings** → **Content & structure**. The setting travels through [settings sync](Sync_Setup.md), so you only pick it once, on whichever device you like.

The desktop bar's four filters appear on the phone as chips above the list: **Folder**, **Tag**, **With a due date only** and **Show hidden**. Chips rather than select fields, because a filter bar above an already narrow list costs more room than it earns — one tap opens the choice, a second clears it again.

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

**+ New task** in the section header creates an entry directly in the task database (same storage folder, template and defaults as a promoted checkbox) and opens it. Checkboxes written in a note stay in that note — they only become database tasks when you move them.

## Blocking time for a task

Tasks in Plainva are **day-granular**: a task has a due date, not a time of day. When you want to reserve a window for one, Plainva creates a **calendar event** — that is the object which owns a time range, renders with overlaps in the grid and syncs with your calendar account.

The calendar icon on a task row opens **Block time**: the date (prefilled with the due date), the start, and the duration (15 min, 30 min, 1 h, 2 h or **Custom**), plus a calendar picker when more than one calendar accepts writes. The event carries the task's title and links back to the note.

For a task from the database, the note also remembers the block in its frontmatter (`plainva.blocks`), so the link is visible from both ends. A checkbox row has no note of its own — there only the event is created, pointing at the note the row lives in. The icon appears only when a calendar account is connected.

## Repeating tasks

A task that comes back regularly gets a **repeat** via the repeat icon in the **Task database** section. Plainva does not create a **series**: checking the task off creates the **next** one as its own note beside the finished one, with the new due date. That way exactly one task is ever open, the finished one stays as the record of what was done, and there is no invisible series you can delete everything from by accident — delete a task and the chain ends.

The dialog offers three things:

- **Rhythm** — Daily, Weekly, Monthly or Yearly, plus the interval under **Every** (for example "Every 3" + "Daily" = every three days).
- **Counted from: Due date** — a fixed cadence ("every Monday"). Check an overdue task off late and Plainva jumps to the next due date **in the future** instead of filling the list with the ones you missed.
- **Counted from: Completion** — the rhythm starts on the day you check it off ("every three days after I water the plants").

**Do not repeat** removes the repeat again. Monthly tasks never slide past the end of a month: 31 January plus one month is 28 or 29 February, not 3 March.

In the **calendar** a repeating task therefore appears only **once**, on its current due date, with a repeat glyph on the row. That is not a defect but the flip side of the generator: there is no series for the calendar to draw further occurrences from, and rows without a note behind them could not be opened. Setting the repetition on the **linked event** instead (via **Block time**) is a real event series: your provider expands it and you see many occurrences — but it creates **no tasks**, only events.

The rule lives in the note's frontmatter (`plainva.repeat`) and therefore travels with your sync — not in a hidden app setting, and not as a database column either, because it belongs to **this** task, not to every entry of the database. Tasks mirrored from a task list of your provider do not offer the repeat: they repeat there, and a second rhythm on top would push duplicates back at the provider.

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
