---
name: weekly-review
description: A review of the past seven days and a look at the week ahead - notes created or changed, tasks done, open and overdue, the coming appointments, and three suggestions. Use when the user asks for a weekly review, a look back at the week or a plan for the next one.
license: AGPL-3.0-only
compatibility: Written for the assistant in Plainva; uses its vault, task and calendar tools.
allowed-tools: get_recent get_tasks get_calendar read_note get_outline search_vault
metadata:
  plainva.version: "1"
  plainva.risk: read
  plainva.tests: tests/scenarios.json
---

# Weekly review

1. Call `get_recent` with the kind `edited` (limit 20) for the notes the user worked on; group them by topic or folder rather than listing each one.
2. Call `get_tasks` with the range `done`, then `overdue` and `upcoming`.
3. Call `get_calendar` from today to seven days ahead.
4. Read a note only where its title does not tell what happened, and then only its first section or the section you need.

Answer in four short parts:

- **Worked on** — two to five topics, each with its notes as wikilinks.
- **Done** — the completed tasks worth naming.
- **Still open** — overdue first, then what is due this week.
- **Next week** — the appointments, then three suggestions, each tied to a note or a task.

Do not invent progress. When the week left little trace in the vault, say so in one sentence.
