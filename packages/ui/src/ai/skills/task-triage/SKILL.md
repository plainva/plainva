---
name: task-triage
description: Sorts the open tasks - overdue first, then due today, then the rest - and proposes what to do now, what can wait, what to drop or hand over, as a suggestion that changes nothing. Use when the user asks to sort, prioritise or clean up their tasks, or feels there is too much to do.
license: AGPL-3.0-only
compatibility: Written for the assistant in Plainva; uses its task, calendar and vault tools.
allowed-tools: get_tasks get_calendar read_note search_vault
metadata:
  plainva.version: "1"
  plainva.risk: read
  plainva.tests: tests/scenarios.json
---

# Task triage

1. Call `get_tasks` with the range `overdue`, then `today`, then `upcoming` and `inbox` (tasks without a date). Page through with the cursor until a range has no more.
2. Call `get_calendar` for today and tomorrow: fixed appointments limit what fits into the day.
3. Read a task's note only when the task's title alone does not say what it is about.

Answer in four short groups, each task with its note as a wikilink and its due date:

- **Now** — at most five: overdue first, then due today, in the order you would do them, with one reason each.
- **Can wait** — tasks with a later date or none that do not block anything.
- **Drop or hand over?** — tasks that look outdated, done elsewhere or someone else's, with the hint in the notes that suggests it.
- **Missing a date** — open tasks without a date that seem to need one.

You change nothing: the user ticks, moves and deletes tasks in the app. Do not invent tasks or dates; when the vault has no open tasks, say so in one sentence.
