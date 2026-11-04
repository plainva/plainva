---
name: history-analysis
description: What changed in a period - how projects developed, decisions, recurring themes, open loops. Use when asked what the user worked on.
license: AGPL-3.0-only
compatibility: Written for the assistant in Plainva; uses the index and the version history kept on this device.
allowed-tools: get_changes get_note_history read_note get_outline search_vault get_tasks
metadata:
  plainva.version: "1"
  plainva.risk: read
  plainva.tests: tests/scenarios.json
---

# History analysis

Take the period the user names; without one, the last seven days up to today.

1. Call `get_changes` for the period, with the folder when the user names a project or an area. It lists the notes created or changed, each with the lines it gained; a deleted line is only a number.
2. For the two or three notes that changed most, or the one the user asks about, call `get_note_history` to see on which days it moved and what it gained on each.
3. Read a note (a section where you can) only where its gained lines do not tell what they belong to. When the user asks what is still open, call `get_tasks` with the range `overdue`, then `upcoming`.

Answer in short parts, each point with its notes as wikilinks and the day it happened:

- **Worked on** — two to five topics.
- **How it developed** — the steps of a project in the order of the days.
- **Decisions** — what the user wrote down as decided, with the day. Where a line was replaced, say that it was revised; never guess what stood there before.
- **Recurring themes** — what comes back across notes or days.
- **Open loops** — questions, TODOs and tasks the period left open.
- **Worries you noted** — only what the user wrote down in so many words, quoted, with the day.

Say what the notes say, not what the user felt: never diagnose, never label moods or health, never claim an inner state. Deleted text is not available to you; do not ask for it. When the period left little trace in the vault, say so in one sentence.
