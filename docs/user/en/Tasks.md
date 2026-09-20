# Tasks

Last updated: 2026-09-20

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

- **Open / Done / All** — by checkbox state (starts on **Open**). This filter belongs to the list **All**; the planner lists **Today**, **Upcoming**, **Inbox** and **Done** answer that question by themselves.
- **Filter tasks…** — free text; matches the task text.
- **All folders** — only tasks in the chosen folder (and its subfolders).
- **All tags** — only tasks carrying a chosen inline `#tag`.
- **With due date** — only tasks that have a `📅` date.

Tags and due dates are read straight from the task line — for example `- [ ] Pay invoice #finance 📅 2026-08-01`.

## Checking tasks off

Click a task's **checkbox** to toggle it between open and done. The change is written straight back to the note (as a normal, safe file write — only the single `[ ]`/`[x]` character changes), so the note, Obsidian and any sync stay in step. Click the task's **text** instead to open the note and jump to that line.

If a note changed since the list was built, an out-of-date toggle is skipped and the list refreshes — use the **refresh** button at the top right to reload at any time.

## Standard task database

Checkboxes are quick to jot down, but sometimes a line grows into a "real" task — with a status, a due date and a note of its own. For that, pick a **Standard task database** in Settings under **Content & structure**: a [database (`.base`)](Databases_Base.md) where such tasks live as their own notes. **Create new database…** scaffolds a ready-made one (storage folder plus a `.base` with a **done checkbox column** (`done`), a status column, a due column, and a table, a board and a timeline view — the timeline puts every task on its due day); you can just as well pick an existing database. The checkbox property is a task's completion truth (on/off, like the providers'); the status column is kept consistent when you check it off. A database without a checkbox column falls back to the status convention: first option = open, last = done.

Once set, the Tasks view shows two sections: the entries of the **Task database** on top, and **From notes** below — the familiar checkbox list. The status is editable right in the overview: the checkbox IS the note's done checkbox property and toggles it (the status column follows), and clicking the status chip opens a menu with every option (**Change status**). The **Open**/**Done**/**All** filters apply to both sections, and **Open as database** jumps to the full database view with its board and filters. **Refresh** additionally triggers a real provider sync when accounts are connected.

## Turning a checkbox into a database task

Every checkbox row carries a database icon: **Move to the task database**. One click

- creates a new note in the database's storage folder (using its default template, if one is set),
- carries a `📅` date into the due column, sets the first status option for open tasks and stores the line's `#tags` as the note's tags,
- links the new note back to its origin note via a `source` property, and
- replaces the checkbox line in the origin note with a wiki link to the new task note — the item stays readable where it was written, and the task now lives in the database.

**Right-click** the icon to pick a different database as the target instead; without a standard database, the click opens that picker right away. Everything stays plain Markdown: the new task is an ordinary note with frontmatter, and the link in the origin note is a normal `[[wiki link]]`.

**+ New task** in the section header puts the cursor into the capture field above the lists (see *Planner, quick capture, priority and states* below). The task is created directly in the task database — same storage folder, template and defaults as a promoted checkbox — and a notice offers **Open**. Checkboxes written in a note stay in that note — they only become database tasks when you move them.

## Blocking time for a task

A task has a due date and may carry a **time of day** (`2026-09-21T14:00`) — that is when Plainva reminds you. A time is a moment, not a span. When you want to reserve a window for one, Plainva creates a **calendar event** — that is the object which owns a time range, renders with overlaps in the grid and syncs with your calendar account.

The calendar icon on a task row opens **Block time**: the date (prefilled with the due date), the start, and the duration (15 min, 30 min, 1 h, 2 h or **Custom**), plus a calendar picker when more than one calendar accepts writes. The event carries the task's title and links back to the note. A **right-click** on the row shows the same actions as the sheet on the phone: done/open, move to database, repeat, block time.

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

<!-- accounts-tasks-2026-09-11 -->
## Keep same-title tasks separate

Provider tasks are matched by identity. Different recurring instances get their own files. Existing false conflicts can be kept as separate tasks.

These files belong to different tasks. Recurring tasks with the same title can be separate instances. Both contents are kept as separate tasks.

**Keep as separate tasks** — This file stays unchanged: Current file  The conflict copy is kept as a separate file: conflict copy

<!-- tasks-jex-2026-09-14 -->
## Tasks metadata and recurrence

Desktop, mobile and Live Preview understand ➕ created, ✅ completed, 📅 due, ⏳ scheduled, 🛫 start, 🆔 ID and 🔁 recurrence. Dates use YYYY-MM-DD. Existing IDs survive line moves. Unknown fields stay in the Markdown.

Automatic recurrence supports only English `every [N] day/week/month/year[s] [when done]`, with N from 1 to 999. Completion advances one period, even if still overdue; `when done` counts from completion. Relative date distances survive, with month-end clamping. An undated task stays undated. Complex rules, dependencies, block IDs, duplicate IDs, invalid dates and indented content do not generate a successor. Native Plainva recurrence or provider ownership also disables the Tasks generator.

Checking a task with metadata adds its completion date. Supported recurrence adds an ID if needed and gives the successor a distinct `pv-…` ID. Checkbox and successor form one Markdown edit. Reopening the original keeps the successor; checking again preserves its edits. Editor Undo reverses the entire edit.

Native database tasks still skip missed periods. A saved destination plan prevents duplicate successors on rechecking. If a successor is unconfirmed, inspect the task folder. After a write failure, reopening and checking again can resume the plan. A changed source will not produce a different copy; inspect the notes and create the intended successor manually if needed. A confirmed successor deleted later is not restored.

## Restore task filters

Status, search text, folder, tag, “Only with due date” and hidden-task visibility are remembered per vault on this device, including after opening a note or restarting. “Reset filters” returns to open tasks without additional filters. Unavailable folders and tags remain visible and can be removed through the folder/tag selector. Forgetting the vault removes this view state. The standard task database remains the existing vault setting; filters are not synced.

<!-- planner-capture-2026-09-20 -->
## Planner, quick capture, priority and states

The Tasks view opens on **Today**. The lists — a rail on the left on the desktop, a segment above the list on the phone — are **Today** (what is due today, with **Overdue** on top), **Upcoming** (the next 14 days, by day), **Inbox** (open tasks without a date), **All** (the two sections described above, with the **Open**/**Done**/**All** filter) and **Done**. Every list draws from both sources, the task database and the checkboxes in your notes, ordered by priority, then time, then title. The other filters apply to every list, and the chosen list is remembered per vault. On the desktop the rail also lists the most frequent tags as one-click filters; on the phone the **Today** screen leads into the planner's **Today**.

Above the lists sits the capture field; on the phone **+ New task** and the **＋** button open it as a sheet. Type one line — `Send offer tomorrow 2pm !!! #client weekly` — and press Enter: Plainva creates the task in the task database. It understands today, tomorrow, the day after tomorrow, weekdays, "in 3 days", "next week", dates in digits, a time (`14:30`, `2pm`), a rhythm (daily, weekly, monthly, yearly, "every Monday", "every 2 weeks"), `!`, `!!` and `!!!` for low, medium and high priority, and `#tags` — the words in the language of the app, digits and signs in any language. Everything it recognised is marked inside the field and listed below it as a removable brick **before** anything is saved; take a brick away and its words simply count as title again. On the phone, quick buttons write the same words for you. If the task database names a provider list, a chip decides whether the task is created there too.

**Set priority** in a row's menu (right-click on the desktop, press and hold on the phone) offers **high**, **medium**, **low** and **none**; a flag in front of the title shows it. In the task database the priority is a select column: a database created now has it, an older one gets it the first time you set a priority — never by merely being opened. A checkbox carries the mark of the Obsidian Tasks plugin on its line: Plainva reads 🔺 and ⏫ as high, 🔼 as medium, 🔽 and ⏬ as low, and writes ⏫, 🔼 or 🔽.

`- [/]` (**In progress**) and `- [-]` (**Cancelled**) are tasks too. They get a box of their own in the editor, in reading mode and in every list; in progress counts as open, cancelled as closed. A click still only moves between open and done — it completes a task in progress and reopens a cancelled one. **Set state** in the row menu sets the two states; Plainva never writes them on its own.

More ways in: **New task** in the tray menu on the desktop (when Plainva keeps running in the background), on Android the launcher shortcut **New task** (press and hold the app icon), and on the phone **Create as a task** when you share something to Plainva — the text and the attachments end up in the task's note. How a task with a time reminds you is described under [Calendar & external tasks](Calendar_and_Tasks.md).
