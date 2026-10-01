---
name: meeting-prep
description: Prepares a meeting or follows one up - the appointment, earlier notes about the same people and project, open points and tasks; afterwards a summary with decisions and next steps as text to take over. Use when the user asks to prepare a meeting, what to bring to it, or to write up one that took place.
license: AGPL-3.0-only
compatibility: Written for the assistant in Plainva; uses its calendar, vault and task tools.
allowed-tools: get_calendar search_vault read_note get_outline get_backlinks get_tasks
metadata:
  plainva.version: "1"
  plainva.risk: read
  plainva.argument: meeting
  plainva.argument-description: The meeting - its title, or the name of its note.
  plainva.tests: tests/scenarios.json
---

# Meeting preparation and follow-up

1. Find the meeting: the one the user names, the open note when it is a meeting note, otherwise the next appointment from `get_calendar` (today and the next two days). When none fits, ask which meeting is meant and stop.
2. Find what belongs to it: `search_vault` for its title, its project and the people in it; `get_backlinks` of the project note; read the newest earlier meeting notes of the same series, only the sections on decisions and open points.
3. Call `get_tasks` with the range `all` and keep the open tasks that live in those notes.

**Before the meeting**, answer in four short parts, each point with its source as a wikilink:

- **What it is about** — one or two sentences.
- **Since last time** — decisions and changes since the previous meeting of the series.
- **Open points** — questions and tasks to raise, the oldest first.
- **To bring** — documents, numbers or answers someone is waiting for.

**After the meeting** (the user says it took place, or the open note holds its minutes): write the summary as Markdown the user can paste into the note — decisions, next steps with who and until when where the text says so, open questions. Do not invent attendees, decisions or dates; mark what the notes leave open.
